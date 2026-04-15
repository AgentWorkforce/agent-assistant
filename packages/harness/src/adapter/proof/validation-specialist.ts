import type { ConnectivityLayer } from '@agent-assistant/connectivity';
import type { Specialist } from '@agent-assistant/coordination';

import type { ExecutionResult } from '../types.js';

export interface ValidationSpecialistConfig {
  connectivity: ConnectivityLayer;
  threadId: string;
  specialistName?: string;
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

export function createValidationSpecialist(
  config: ValidationSpecialistConfig,
): Specialist {
  const specialistName = config.specialistName ?? 'validation-specialist';

  return {
    name: specialistName,
    description: 'Validates BYOH execution results and emits connectivity signals.',
    capabilities: ['execution-validation', 'proof-signals'],
    handler: {
      async execute(instruction, context) {
        const parsed = parseExecutionResult(instruction);
        const threadId = context.threadId || config.threadId;

        if (!parsed) {
          config.connectivity.emit({
            threadId,
            source: specialistName,
            audience: 'coordinator',
            messageClass: 'escalation',
            signalClass: 'escalation.uncertainty',
            priority: 'high',
            summary: 'Execution result could not be parsed for validation.',
            details: instruction.slice(0, 200),
          });
          config.connectivity.emit({
            threadId,
            source: specialistName,
            audience: 'coordinator',
            messageClass: 'handoff',
            signalClass: 'handoff.ready',
            priority: 'normal',
            summary: 'Validation completed with parse failure.',
          });

          return {
            specialistName,
            output: 'Execution result was not valid JSON.',
            confidence: 0.2,
            status: 'failed',
          };
        }

        const degraded = (parsed.degradation?.length ?? 0) > 0 || parsed.status !== 'completed';
        const summary = summarize(parsed);

        if (parsed.status === 'completed' && !degraded) {
          config.connectivity.emit({
            threadId,
            source: specialistName,
            audience: 'coordinator',
            messageClass: 'confidence',
            signalClass: 'confidence.high',
            priority: 'normal',
            confidence: 0.95,
            summary,
          });
        } else if (parsed.status === 'unsupported' || parsed.status === 'failed') {
          config.connectivity.emit({
            threadId,
            source: specialistName,
            audience: 'coordinator',
            messageClass: 'confidence',
            signalClass: 'confidence.low',
            priority: 'normal',
            confidence: 0.25,
            summary,
            details: parsed.error?.message,
          });
        } else {
          config.connectivity.emit({
            threadId,
            source: specialistName,
            audience: 'coordinator',
            messageClass: 'escalation',
            signalClass: 'escalation.uncertainty',
            priority: 'high',
            summary,
            details: JSON.stringify(parsed.degradation ?? []),
          });
        }

        config.connectivity.emit({
          threadId,
          source: specialistName,
          audience: 'coordinator',
          messageClass: 'handoff',
          signalClass: 'handoff.ready',
          priority: 'normal',
          summary: 'Validation specialist completed review.',
        });

        return {
          specialistName,
          output: summary,
          confidence: parsed.status === 'completed' && !degraded ? 0.95 : 0.45,
          status: parsed.status === 'failed' ? 'partial' : 'complete',
          metadata: {
            validatedStatus: parsed.status,
            degraded,
          },
        };
      },
    },
  };
}
