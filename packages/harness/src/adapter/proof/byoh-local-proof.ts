import { RelayAdapter } from '@agent-relay/sdk';
import { createConnectivityLayer } from '@agent-assistant/connectivity';
import { createTraitsProvider, type TraitsProvider } from '@agent-assistant/traits';
import type { ConnectivityLayer, ConnectivitySignal } from '@agent-assistant/connectivity';
import type { BrokerEvent } from '@agent-relay/sdk';

import type {
  ExecutionAdapter,
  ExecutionRequest,
  ExecutionRequirements,
  ExecutionResult,
  ExecutionToolDescriptor,
} from '../types.js';
import { createRelayValidationHandler } from './validation-specialist.js';

export interface ProofTurnContextAssembler {
  assemble(input: {
    assistantId: string;
    turnId: string;
    sessionId?: string;
    userId?: string;
    threadId?: string;
    identity: {
      assistantName?: string;
      traits?: TraitsProvider;
      baseInstructions?: {
        systemPrompt?: string;
        developerPrompt?: string;
      };
    };
    shaping?: {
      mode?: string;
      responseStyle?: {
        preferMarkdown?: boolean;
        maxAnswerChars?: number;
      };
    };
    enrichment?: {
      candidates?: Array<{
        id: string;
        kind:
          | 'specialist_memo'
          | 'handoff'
          | 'review'
          | 'workspace_state'
          | 'external_snapshot'
          | 'culture_context'
          | 'tool_observation'
          | 'other';
        source: string;
        title?: string;
        content: string;
        importance?: 'low' | 'medium' | 'high';
        confidence?: number;
        freshness?: 'stale' | 'recent' | 'current';
        audience?: 'assistant' | 'product' | 'mixed';
        metadata?: Record<string, unknown>;
      }>;
    };
    metadata?: Record<string, unknown>;
  }): Promise<{
    assistantId: string;
    turnId: string;
    sessionId?: string;
    userId?: string;
    threadId?: string;
    identity: {
      assistantName?: string;
      identitySummary: string[];
    };
    harnessProjection: {
      instructions: {
        systemPrompt: string;
        developerPrompt?: string;
        responseStyle?: {
          preferMarkdown?: boolean;
          maxAnswerChars?: number;
        };
      };
    };
    context: {
      blocks: Array<{
        id: string;
        label: string;
        content: string;
        category?: 'memory' | 'session' | 'enrichment' | 'workspace' | 'guardrail' | 'other';
      }>;
    };
  }>;
}

export type ByohProofScenario =
  | { type: 'completed-no-tools'; message: string }
  | { type: 'completed-with-tools'; message: string; tools: ExecutionToolDescriptor[] }
  | { type: 'negotiation-rejected'; message: string; requirements: ExecutionRequirements }
  | { type: 'negotiation-degraded'; message: string; requirements: ExecutionRequirements };

export interface RelayChannelMessage {
  eventId: string;
  from: string;
  channel: string;
  threadId: string;
  text: string;
  receivedAt: string;
}

export interface RelaySubscription {
  waitForMessage(timeoutMs?: number): Promise<RelayChannelMessage>;
  unsubscribe(): void;
}

export interface ProofRelayTransport {
  registerAgent(input: {
    agentId: string;
    channel: string;
    capabilities: string[];
  }): Promise<void>;
  publish(input: {
    channel: string;
    text: string;
    threadId: string;
    from?: string;
  }): Promise<{ eventId?: string; targets?: string[] }>;
  subscribe(input: {
    channel: string;
    agentId: string;
    filter?: (message: RelayChannelMessage) => boolean;
  }): RelaySubscription;
  shutdown?(): Promise<void>;
}

export interface RelayExecutionResultMessage {
  type: 'execution-result';
  scenario: ByohProofScenario['type'];
  executionResult: ExecutionResult;
  turnId: string;
  threadId: string;
}

export interface RelayValidationVerdict {
  output: string;
  confidence: number;
  status: 'complete' | 'partial' | 'failed';
  validatedStatus: string;
  degraded: boolean;
}

export interface RelayValidationVerdictMessage {
  type: 'validation-verdict';
  verdict: RelayValidationVerdict;
  signals: Array<{
    signalClass: string;
    summary: string;
  }>;
  turnId: string;
  threadId: string;
}

export interface ByohLocalProofConfig {
  assembler: ProofTurnContextAssembler;
  adapter: ExecutionAdapter;
  relay: ProofRelayTransport;
  relayConfig: {
    cwd?: string;
    channelId: string;
    workspaceId?: string;
  };
  connectivity?: ConnectivityLayer;
  traitsProvider?: TraitsProvider;
  timeoutMs?: number;
}

export interface ByohLocalProofResult {
  scenario: ByohProofScenario['type'];
  executionResult: ExecutionResult;
  validationVerdict: RelayValidationVerdict;
  signals: ConnectivitySignal[];
  relayCoordinated: boolean;
  relayRoundTrip: {
    resultPublished: boolean;
    resultEventId?: string;
    verdictReceived: boolean;
    verdictEventId?: string;
  };
  identityPreserved: boolean;
  request: ExecutionRequest;
}

function defaultTraitsProvider(): TraitsProvider {
  return createTraitsProvider(
    {
      voice: 'technical',
      formality: 'professional',
      proactivity: 'high',
      riskPosture: 'moderate',
      domain: 'byoh-local-proof',
      vocabulary: ['relay', 'proof', 'execution'],
    },
    {
      preferMarkdown: true,
      preferredResponseLength: 600,
    },
  );
}

function buildExecutionRequest(
  assembler: ProofTurnContextAssembler,
  traitsProvider: TraitsProvider,
  scenario: ByohProofScenario,
): Promise<ExecutionRequest> {
  return assembler
    .assemble({
      assistantId: 'sage-proof-assistant',
      turnId: `turn-${scenario.type}`,
      sessionId: 'session-byoh-proof',
      userId: 'user-proof',
      threadId: `thread-${scenario.type}`,
      identity: {
        assistantName: 'Sage Proof Assistant',
        traits: traitsProvider,
        baseInstructions: {
          systemPrompt: 'You are Sage, a bounded proving assistant that preserves product identity.',
          developerPrompt: 'Preserve Relay-native coordination and report proof-slice results directly.',
        },
      },
      shaping: {
        mode: 'proof-validation',
        responseStyle: {
          preferMarkdown: true,
          maxAnswerChars: 1500,
        },
      },
      enrichment: {
        candidates: [
          {
            id: 'relay-proof-scope',
            kind: 'workspace_state',
            source: 'proof-plan',
            content: 'Scope is limited to one local Claude Code backend and one Relay-native validation specialist.',
            importance: 'high',
          },
        ],
      },
      metadata: {
        scenario: scenario.type,
      },
    })
    .then((assembly) => ({
      assistantId: assembly.assistantId,
      turnId: assembly.turnId,
      sessionId: assembly.sessionId,
      userId: assembly.userId,
      threadId: assembly.threadId,
      message: {
        id: `msg-${scenario.type}`,
        text: scenario.message,
        receivedAt: '2026-04-15T12:00:00.000Z',
      },
      instructions: {
        systemPrompt: assembly.harnessProjection.instructions.systemPrompt,
        developerPrompt: assembly.harnessProjection.instructions.developerPrompt,
        responseStyle: assembly.harnessProjection.instructions.responseStyle,
      },
      context: {
        blocks: assembly.context.blocks.map((block) => ({
          id: block.id,
          label: block.label,
          text: block.content,
          category:
            block.category === 'session'
              ? 'other'
              : block.category === 'memory' ||
                  block.category === 'workspace' ||
                  block.category === 'enrichment' ||
                  block.category === 'guardrail'
                ? block.category
                : 'other',
        })),
      },
      ...(scenario.type === 'completed-with-tools' ? { tools: scenario.tools } : {}),
      ...(scenario.type === 'negotiation-rejected' || scenario.type === 'negotiation-degraded'
        ? { requirements: scenario.requirements }
        : {}),
      metadata: {
        identitySummary: assembly.identity.identitySummary,
        assistantName: assembly.identity.assistantName,
      },
    }));
}

function toRelayChannelMessage(event: BrokerEvent): RelayChannelMessage | null {
  if (event.kind !== 'relay_inbound') {
    return null;
  }

  return {
    eventId: event.event_id,
    from: event.from,
    channel: event.target,
    threadId: event.thread_id ?? '',
    text: event.body,
    receivedAt: new Date().toISOString(),
  };
}

function isValidationVerdictMessage(value: unknown): value is RelayValidationVerdictMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<RelayValidationVerdictMessage>;
  return candidate.type === 'validation-verdict' && typeof candidate.threadId === 'string';
}

export function createAgentRelayProofTransport(config: {
  cwd?: string;
  channelId: string;
  workspaceId?: string;
}): ProofRelayTransport {
  const relay = new RelayAdapter({
    cwd: config.cwd ?? process.cwd(),
    channels: [config.channelId],
  });
  const registeredAgents = new Set<string>();

  return {
    async registerAgent(input) {
      await relay.start();
      registeredAgents.add(input.agentId);
    },
    async publish(input) {
      await relay.start();
      const published = await relay.sendMessage({
        to: input.channel,
        text: input.text,
        from: input.from,
        threadId: input.threadId,
        ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
      });

      return {
        eventId: published.event_id,
        targets: published.targets,
      };
    },
    subscribe(input) {
      if (!registeredAgents.has(input.agentId)) {
        throw new Error(`Relay agent "${input.agentId}" must be registered before subscribing.`);
      }

      const queued: RelayChannelMessage[] = [];
      const waiters: Array<{
        resolve: (message: RelayChannelMessage) => void;
        reject: (error: Error) => void;
        timer?: ReturnType<typeof setTimeout>;
      }> = [];
      let active = true;

      const deliver = (message: RelayChannelMessage) => {
        if (!active) {
          return;
        }

        if (input.filter && !input.filter(message)) {
          return;
        }

        const waiter = waiters.shift();
        if (waiter) {
          if (waiter.timer) {
            clearTimeout(waiter.timer);
          }
          waiter.resolve(message);
          return;
        }

        queued.push(message);
      };

      const unsubscribeFromEvents = relay.onEvent((event) => {
        const message = toRelayChannelMessage(event);
        if (!message || message.channel !== input.channel) {
          return;
        }
        deliver(message);
      });

      return {
        waitForMessage(timeoutMs = 30_000) {
          const next = queued.shift();
          if (next) {
            return Promise.resolve(next);
          }

          return new Promise<RelayChannelMessage>((resolve, reject) => {
            const waiter = { resolve, reject } as {
              resolve: (message: RelayChannelMessage) => void;
              reject: (error: Error) => void;
              timer?: ReturnType<typeof setTimeout>;
            };
            waiter.timer = setTimeout(() => {
              const index = waiters.indexOf(waiter);
              if (index >= 0) {
                waiters.splice(index, 1);
              }
              reject(new Error(`Timed out waiting for Relay message on channel "${input.channel}".`));
            }, timeoutMs);
            waiters.push(waiter);
          });
        },
        unsubscribe() {
          active = false;
          unsubscribeFromEvents();
          for (const waiter of waiters.splice(0)) {
            if (waiter.timer) {
              clearTimeout(waiter.timer);
            }
            waiter.reject(new Error(`Relay subscription for "${input.agentId}" was closed.`));
          }
        },
      };
    },
    async shutdown() {
      await relay.shutdown();
    },
  };
}

export async function runByohLocalProof(
  config: ByohLocalProofConfig,
  scenario: ByohProofScenario,
): Promise<ByohLocalProofResult> {
  const traitsProvider = config.traitsProvider ?? defaultTraitsProvider();
  const request = await buildExecutionRequest(config.assembler, traitsProvider, scenario);
  const connectivity = config.connectivity ?? createConnectivityLayer();
  const timeoutMs = config.timeoutMs ?? 30_000;
  const channelId = config.relayConfig.channelId;
  const threadId = request.threadId ?? request.turnId;

  const negotiation = config.adapter.negotiate(request);
  const executionResult = negotiation.supported
    ? await config.adapter.execute(request).then((result) =>
        negotiation.degraded
          ? {
              ...result,
              degradation: [...(result.degradation ?? []), ...negotiation.reasons],
            }
          : result,
      )
    : {
        backendId: config.adapter.backendId,
        status: 'unsupported' as const,
        error: {
          code: 'unsupported_capability' as const,
          message: negotiation.reasons.map((reason) => reason.message).join(' '),
        },
        degradation: negotiation.reasons,
      };

  await config.relay.registerAgent({
    agentId: 'orchestrator',
    channel: channelId,
    capabilities: ['execution-request', 'proof-synthesis'],
  });

  const verdictSubscription = config.relay.subscribe({
    channel: channelId,
    agentId: 'orchestrator',
    filter(message) {
      try {
        const parsed = JSON.parse(message.text) as unknown;
        return isValidationVerdictMessage(parsed) && parsed.threadId === threadId;
      } catch {
        return false;
      }
    },
  });

  const validationHandler = createRelayValidationHandler({
    connectivity,
    relay: config.relay,
    channelId,
    threadId,
    timeoutMs,
  });

  const handlerPromise = validationHandler.start();
  let publishedEventId: string | undefined;
  let verdictEventId: string | undefined;

  try {
    await handlerPromise;

    const executionMessage: RelayExecutionResultMessage = {
      type: 'execution-result',
      scenario: scenario.type,
      executionResult,
      turnId: request.turnId,
      threadId,
    };

    const published = await config.relay.publish({
      channel: channelId,
      threadId,
      from: 'orchestrator',
      text: JSON.stringify(executionMessage),
    });
    publishedEventId = published.eventId;

    const verdictMessage = await verdictSubscription.waitForMessage(timeoutMs);
    verdictEventId = verdictMessage.eventId;

    const verdictPayload = JSON.parse(verdictMessage.text) as RelayValidationVerdictMessage;
    await handlerPromise;

    return {
      scenario: scenario.type,
      executionResult,
      validationVerdict: verdictPayload.verdict,
      signals: connectivity.query({ threadId }),
      relayCoordinated: true,
      relayRoundTrip: {
        resultPublished: true,
        resultEventId: publishedEventId,
        verdictReceived: true,
        verdictEventId,
      },
      identityPreserved: request.instructions.systemPrompt.includes('Sage'),
      request,
    };
  } finally {
    validationHandler.stop();
    verdictSubscription.unsubscribe();
    await Promise.allSettled([handlerPromise]);
    if (config.relay.shutdown) {
      await config.relay.shutdown();
    }
  }
}
