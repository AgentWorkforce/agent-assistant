import type { ConnectivityLayer } from '@agent-assistant/connectivity';
import type { Specialist } from '@agent-assistant/coordination';

import type {
  ProofRelayTransport,
  RelayExecutionResultMessage,
  RelayValidationVerdict,
  RelayValidationVerdictMessage,
} from './byoh-local-proof.js';
import type { ExecutionResult } from '../types.js';

export interface ValidationSpecialistConfig {
  connectivity: ConnectivityLayer;
  threadId: string;
  specialistName?: string;
}

export interface RelayValidationHandler {
  start(): Promise<RelayValidationHandlerOutcome>;
  stop(): void;
}

export interface RelayValidationHandlerOutcome {
  verdictPublished: boolean;
  verdictEventId?: string;
  error?: Error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseExecutionResult(instruction: string): ExecutionResult | null {
  try {
    const parsed = JSON.parse(instruction) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    if (typeof parsed.backendId !== 'string' || typeof parsed.status !== 'string') {
      return null;
    }

    return parsed as unknown as ExecutionResult;
  } catch {
    return null;
  }
}

function summarize(result: ExecutionResult): string {
  switch (result.status) {
    case 'completed':
      return 'Execution result is complete and structurally valid.';
    case 'failed':
      return 'Execution result captured a backend failure and remained structurally valid.';
    case 'unsupported':
      return 'Execution result truthfully reported unsupported execution semantics.';
    default:
      return `Execution result has status ${result.status}.`;
  }
}

function validateExecutionResult(
  instruction: string,
  config: ValidationSpecialistConfig,
): RelayValidationVerdict & {
  signals: Array<{ signalClass: string; summary: string }>;
} {
  const specialistName = config.specialistName ?? 'validation-specialist';
  const parsed = parseExecutionResult(instruction);

  if (!parsed) {
    const parseFailure = config.connectivity.emit({
      threadId: config.threadId,
      source: specialistName,
      audience: 'coordinator',
      messageClass: 'escalation',
      signalClass: 'escalation.uncertainty',
      priority: 'high',
      summary: 'Execution result could not be parsed for validation.',
      details: instruction.slice(0, 200),
    });
    const handoff = config.connectivity.emit({
      threadId: config.threadId,
      source: specialistName,
      audience: 'coordinator',
      messageClass: 'handoff',
      signalClass: 'handoff.ready',
      priority: 'normal',
      summary: 'Validation completed with parse failure.',
    });

    return {
      output: 'Execution result was not valid JSON.',
      confidence: 0.2,
      status: 'failed',
      validatedStatus: 'unparseable',
      degraded: true,
      signals: [
        { signalClass: parseFailure.signalClass, summary: parseFailure.summary },
        { signalClass: handoff.signalClass, summary: handoff.summary },
      ],
    };
  }

  const degraded = (parsed.degradation?.length ?? 0) > 0 || parsed.status !== 'completed';
  const summary = summarize(parsed);
  const emittedSignals: Array<{ signalClass: string; summary: string }> = [];

  if (parsed.status === 'completed' && !degraded) {
    const signal = config.connectivity.emit({
      threadId: config.threadId,
      source: specialistName,
      audience: 'coordinator',
      messageClass: 'confidence',
      signalClass: 'confidence.high',
      priority: 'normal',
      confidence: 0.95,
      summary,
    });
    emittedSignals.push({ signalClass: signal.signalClass, summary: signal.summary });
  } else if (parsed.status === 'unsupported' || parsed.status === 'failed') {
    const signal = config.connectivity.emit({
      threadId: config.threadId,
      source: specialistName,
      audience: 'coordinator',
      messageClass: 'confidence',
      signalClass: 'confidence.low',
      priority: 'normal',
      confidence: 0.25,
      summary,
      details: parsed.error?.message,
    });
    emittedSignals.push({ signalClass: signal.signalClass, summary: signal.summary });
  } else {
    const signal = config.connectivity.emit({
      threadId: config.threadId,
      source: specialistName,
      audience: 'coordinator',
      messageClass: 'escalation',
      signalClass: 'escalation.uncertainty',
      priority: 'high',
      summary,
      details: JSON.stringify(parsed.degradation ?? []),
    });
    emittedSignals.push({ signalClass: signal.signalClass, summary: signal.summary });
  }

  const handoff = config.connectivity.emit({
    threadId: config.threadId,
    source: specialistName,
    audience: 'coordinator',
    messageClass: 'handoff',
    signalClass: 'handoff.ready',
    priority: 'normal',
    summary: 'Validation specialist completed review.',
  });
  emittedSignals.push({ signalClass: handoff.signalClass, summary: handoff.summary });

  return {
    output: summary,
    confidence: parsed.status === 'completed' && !degraded ? 0.95 : 0.45,
    status: parsed.status === 'failed' ? 'partial' : 'complete',
    validatedStatus: parsed.status,
    degraded,
    signals: emittedSignals,
  };
}

export function createValidationSpecialist(
  config: ValidationSpecialistConfig,
): Specialist {
  const specialistName = config.specialistName ?? 'validation-specialist';

  return {
    name: specialistName,
    description: 'Validates BYOH execution results and emits connectivity signals.',
    capabilities: ['execution-validation', 'proof-signals'],
    handler: {
      async execute(instruction: string, context: { threadId?: string }) {
        const result = validateExecutionResult(instruction, {
          ...config,
          threadId: context.threadId || config.threadId,
          specialistName,
        });

        return {
          specialistName,
          output: result.output,
          confidence: result.confidence,
          status: result.status,
          metadata: {
            validatedStatus: result.validatedStatus,
            degraded: result.degraded,
          },
        };
      },
    },
  };
}

export function createRelayValidationHandler(config: {
  connectivity: ConnectivityLayer;
  relay: ProofRelayTransport;
  channelId: string;
  threadId: string;
  specialistName?: string;
  timeoutMs?: number;
}): RelayValidationHandler {
  const specialistName = config.specialistName ?? 'validation-specialist';
  const timeoutMs = config.timeoutMs ?? 30_000;
  let stopped = false;
  let unsubscribe: (() => void) | undefined;

  return {
    async start() {
      const registerAgentPromise = config.relay.registerAgent({
        agentId: specialistName,
        channel: config.channelId,
        capabilities: ['execution-validation', 'proof-signals'],
      });

      const subscription = config.relay.subscribe({
        channel: config.channelId,
        agentId: specialistName,
        filter(message) {
          try {
            const parsed = JSON.parse(message.text) as Partial<RelayExecutionResultMessage>;
            return parsed.type === 'execution-result' && parsed.threadId === config.threadId;
          } catch {
            return false;
          }
        },
      });
      unsubscribe = () => subscription.unsubscribe();

      await registerAgentPromise;

      const message = await subscription.waitForMessage(timeoutMs);
      if (stopped) {
        return { verdictPublished: false };
      }

      const payload = JSON.parse(message.text) as RelayExecutionResultMessage;
      const verdict = validateExecutionResult(JSON.stringify(payload.executionResult), {
        connectivity: config.connectivity,
        threadId: payload.threadId,
        specialistName,
      });
      const verdictMessage: RelayValidationVerdictMessage = {
        type: 'validation-verdict',
        verdict: {
          output: verdict.output,
          confidence: verdict.confidence,
          status: verdict.status,
          validatedStatus: verdict.validatedStatus,
          degraded: verdict.degraded,
        },
        signals: verdict.signals,
        turnId: payload.turnId,
        threadId: payload.threadId,
      };

      const published = await config.relay.publish({
        channel: config.channelId,
        threadId: config.threadId,
        from: specialistName,
        text: JSON.stringify(verdictMessage),
      });

      return {
        verdictPublished: true,
        verdictEventId: published.eventId,
      };
    },
    stop() {
      stopped = true;
      unsubscribe?.();
    },
  };
}
