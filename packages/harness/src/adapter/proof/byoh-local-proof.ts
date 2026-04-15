import { RelayAdapter } from '@agent-relay/sdk';
import { createConnectivityLayer } from '@agent-assistant/connectivity';
import {
  createCoordinator,
  createSpecialistRegistry,
  type Coordinator,
  type SpecialistResult,
} from '@agent-assistant/coordination';
import { createTraitsProvider, type TraitsProvider } from '@agent-assistant/traits';
import type { ConnectivityLayer, ConnectivitySignal } from '@agent-assistant/connectivity';

import type {
  ExecutionAdapter,
  ExecutionRequest,
  ExecutionRequirements,
  ExecutionResult,
  ExecutionToolDescriptor,
} from '../types.js';
import { createValidationSpecialist } from './validation-specialist.js';

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

export interface ProofRelayTransport {
  publish(input: {
    channel: string;
    text: string;
    threadId: string;
    from?: string;
  }): Promise<{ eventId?: string; targets?: string[] }>;
  shutdown?(): Promise<void>;
}

export interface ByohLocalProofConfig {
  assembler: ProofTurnContextAssembler;
  adapter: ExecutionAdapter;
  coordinator?: Coordinator;
  connectivity?: ConnectivityLayer;
  relay?: ProofRelayTransport;
  relayConfig?: {
    cwd?: string;
    channelId: string;
    workspaceId?: string;
  };
  traitsProvider?: TraitsProvider;
}

export interface ByohLocalProofResult {
  scenario: ByohProofScenario['type'];
  executionResult: ExecutionResult;
  validationResult: SpecialistResult;
  signals: ConnectivitySignal[];
  relayCoordinated: boolean;
  identityPreserved: boolean;
  relayPublication?: {
    eventId?: string;
    channel: string;
    targets?: string[];
  };
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

function buildDefaultCoordinator(
  connectivity: ConnectivityLayer,
  threadId: string,
): Coordinator {
  const registry = createSpecialistRegistry();
  registry.register(
    createValidationSpecialist({
      connectivity,
      threadId,
    }),
  );

  return createCoordinator({
    registry,
    connectivity,
    synthesis: { strategy: 'last-wins' },
  });
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

  return {
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
  const coordinator = config.coordinator ?? buildDefaultCoordinator(connectivity, request.threadId ?? request.turnId);
  const relay =
    config.relay ??
    (config.relayConfig
      ? createAgentRelayProofTransport(config.relayConfig)
      : undefined);

  const negotiation = config.adapter.negotiate(request);
  const executionResult = negotiation.supported
    ? await config.adapter.execute(request)
    : {
        backendId: config.adapter.backendId,
        status: 'unsupported' as const,
        error: {
          code: 'unsupported_capability' as const,
          message: negotiation.reasons.map((reason) => reason.message).join(' '),
        },
        degradation: negotiation.reasons,
      };

  const relayPublication = relay
    ? await relay.publish({
        channel: config.relayConfig?.channelId ?? 'byoh-local-proof',
        threadId: request.threadId ?? request.turnId,
        from: 'orchestrator',
        text: JSON.stringify(
          {
            scenario: scenario.type,
            executionResult,
          },
          null,
          2,
        ),
      })
    : undefined;

  const turn = await coordinator.execute({
    intent: 'Validate the bounded local BYOH execution result',
    steps: [
      {
        specialistName: 'validation-specialist',
        instruction: JSON.stringify(executionResult),
      },
    ],
  });

  if (relay?.shutdown) {
    await relay.shutdown();
  }

  const signals = turn.signals.observed;

  return {
    scenario: scenario.type,
    executionResult,
    validationResult: turn.results[0]!,
    signals,
    relayCoordinated: relayPublication !== undefined,
    identityPreserved: request.instructions.systemPrompt.includes('Sage'),
    ...(relayPublication
      ? {
          relayPublication: {
            eventId: relayPublication.eventId,
            channel: config.relayConfig?.channelId ?? 'byoh-local-proof',
            targets: relayPublication.targets,
          },
        }
      : {}),
    request,
  };
}
