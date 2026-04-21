import { RelayAdapter } from '@agent-relay/sdk';
import type {
  BrokerEvent,
  RelaySpawnRequest,
  SendMessageInput,
} from '@agent-relay/sdk';

import type {
  ExecutionAdapter,
  ExecutionCapabilities,
  ExecutionNegotiation,
  ExecutionNegotiationReason,
  ExecutionRequest,
  ExecutionResult,
  ExecutionTrace,
  ExecutionTraceEvent,
} from './types.js';

export const AGENT_RELAY_EXECUTION_REQUEST_TYPE = 'agent-assistant.execution-request.v1';
export const AGENT_RELAY_EXECUTION_RESULT_TYPE = 'agent-assistant.execution-result.v1';

const DEFAULT_CHANNEL_ID = 'agent-assistant-execution';
const DEFAULT_ORCHESTRATOR_NAME = 'agent-assistant';
const DEFAULT_TIMEOUT_MS = 60_000;

const DEFAULT_CAPABILITIES: ExecutionCapabilities = {
  toolUse: 'adapter-mediated',
  structuredToolCalls: true,
  continuationSupport: 'none',
  approvalInterrupts: 'none',
  traceDepth: 'standard',
  attachments: false,
  maxContextStrategy: 'large',
  notes: [
    'Relay-mediated local execution through a BYOH worker.',
    'The worker owns model/tool iteration and returns a typed ExecutionResult.',
  ],
};

const TRACE_DEPTH_ORDER: Record<ExecutionCapabilities['traceDepth'], number> = {
  minimal: 0,
  standard: 1,
  detailed: 2,
};

export interface AgentRelayExecutionRequestMessage {
  type: typeof AGENT_RELAY_EXECUTION_REQUEST_TYPE;
  turnId: string;
  threadId: string;
  request: ExecutionRequest;
  replyTo: {
    agentId: string;
    channelId: string;
  };
  sentAt: string;
}

export interface AgentRelayExecutionResultMessage {
  type: typeof AGENT_RELAY_EXECUTION_RESULT_TYPE | 'execution-result';
  turnId: string;
  threadId: string;
  executionResult?: ExecutionResult;
  result?: ExecutionResult;
}

export interface AgentRelayExecutionTransport {
  start(): Promise<void>;
  sendMessage(input: SendMessageInput): Promise<{ event_id: string; targets: string[] }>;
  onEvent(listener: (event: BrokerEvent) => void): () => void;
  listAgents?(): Promise<Array<{ name: string }>>;
  spawn?(request: RelaySpawnRequest): Promise<{ success: boolean; name: string; error?: string }>;
  shutdown?(): Promise<void>;
}

export interface AgentRelayWorkerSpawnConfig {
  enabled?: boolean;
  name?: string;
  cli: string;
  task?: string;
  model?: string;
  cwd?: string;
  team?: string;
  includeWorkflowConventions?: boolean;
}

export interface AgentRelayExecutionAdapterConfig {
  backendId?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  binaryPath?: string;
  channelId?: string;
  workerName?: string;
  orchestratorName?: string;
  workspaceId?: string;
  timeoutMs?: number;
  capabilities?: ExecutionCapabilities;
  relay?: AgentRelayExecutionTransport;
  spawnWorker?: AgentRelayWorkerSpawnConfig;
  now?: () => number;
  shutdownAfterExecute?: boolean;
}

function cloneCapabilities(capabilities: ExecutionCapabilities): ExecutionCapabilities {
  return {
    ...capabilities,
    ...(capabilities.notes ? { notes: [...capabilities.notes] } : {}),
  };
}

function requiredUnsupported(
  code: ExecutionNegotiationReason['code'],
  message: string,
): ExecutionNegotiationReason {
  return { code, message, severity: 'blocking' };
}

function preferredDegradation(
  code: ExecutionNegotiationReason['code'],
  message: string,
): ExecutionNegotiationReason {
  return { code, message, severity: 'warning' };
}

function isTraceDepthReduced(
  requested: NonNullable<ExecutionRequest['requirements']>['traceDepth'],
  available: ExecutionCapabilities['traceDepth'],
): boolean {
  if (!requested) {
    return false;
  }

  return TRACE_DEPTH_ORDER[requested] > TRACE_DEPTH_ORDER[available];
}

function negotiateRequest(
  request: ExecutionRequest,
  capabilities: ExecutionCapabilities,
): ExecutionNegotiation {
  const reasons: ExecutionNegotiationReason[] = [];
  const requirements = request.requirements;
  const hasTools = (request.tools?.length ?? 0) > 0;
  const hasAttachments = (request.message.attachments?.length ?? 0) > 0;

  if (hasTools && requirements?.toolUse === 'forbidden') {
    reasons.push(requiredUnsupported('tool_use_unsupported', 'Request forbids tool use but tools were supplied.'));
  }

  if ((hasTools || requirements?.toolUse === 'required') && capabilities.toolUse === 'none') {
    reasons.push(requiredUnsupported('tool_use_unsupported', 'Backend does not support tool use.'));
  }

  if (requirements?.structuredToolCalls === 'required' && !capabilities.structuredToolCalls) {
    reasons.push(
      requiredUnsupported(
        'structured_tool_calls_unsupported',
        'Structured tool calls are required but unsupported.',
      ),
    );
  } else if (requirements?.structuredToolCalls === 'preferred' && !capabilities.structuredToolCalls) {
    reasons.push(
      preferredDegradation(
        'structured_tool_calls_unsupported',
        'Structured tool calls are preferred but unsupported.',
      ),
    );
  }

  if (requirements?.continuationSupport === 'required' && capabilities.continuationSupport === 'none') {
    reasons.push(
      requiredUnsupported(
        'continuation_unsupported',
        'Structured continuation support is required but unavailable.',
      ),
    );
  } else if (requirements?.continuationSupport === 'preferred' && capabilities.continuationSupport === 'none') {
    reasons.push(
      preferredDegradation(
        'continuation_unsupported',
        'Continuation support is preferred but unavailable.',
      ),
    );
  }

  if (requirements?.approvalInterrupts === 'required' && capabilities.approvalInterrupts === 'none') {
    reasons.push(
      requiredUnsupported(
        'approval_interrupt_unsupported',
        'Approval interrupts are required but unsupported.',
      ),
    );
  } else if (requirements?.approvalInterrupts === 'preferred' && capabilities.approvalInterrupts === 'none') {
    reasons.push(
      preferredDegradation(
        'approval_interrupt_unsupported',
        'Approval interrupts are preferred but unavailable.',
      ),
    );
  }

  if ((hasAttachments || requirements?.attachments === 'required') && !capabilities.attachments) {
    reasons.push(
      requiredUnsupported(
        'attachments_unsupported',
        'Attachments are required by the request but unsupported by this adapter path.',
      ),
    );
  }

  if (isTraceDepthReduced(requirements?.traceDepth, capabilities.traceDepth)) {
    reasons.push(
      preferredDegradation(
        'trace_depth_reduced',
        `${requirements?.traceDepth ?? 'Requested'} trace depth was requested but only ${
          capabilities.traceDepth
        } trace facts are available.`,
      ),
    );
  }

  const supported = !reasons.some((reason) => reason.severity === 'blocking');
  const degraded = reasons.some((reason) => reason.severity !== 'blocking');

  return {
    supported,
    degraded,
    reasons,
    effectiveCapabilities: cloneCapabilities(capabilities),
  };
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function buildTrace(
  startedAt: number,
  completedAt: number,
  degraded: boolean,
  events?: ExecutionTraceEvent[],
): ExecutionTrace {
  return {
    summary: {
      startedAt: toIso(startedAt),
      completedAt: toIso(completedAt),
      stepCount: 1,
      degraded,
    },
    ...(events && events.length > 0 ? { events } : {}),
  };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isCanonicalExecutionStatus(status: unknown): status is ExecutionResult['status'] {
  return (
    status === 'completed' ||
    status === 'needs_clarification' ||
    status === 'awaiting_approval' ||
    status === 'deferred' ||
    status === 'failed' ||
    status === 'unsupported'
  );
}

function isExecutionResult(value: unknown): value is ExecutionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ExecutionResult>;

  return typeof candidate.backendId === 'string' && isCanonicalExecutionStatus(candidate.status);
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function readOutputText(record: Record<string, unknown>): string | undefined {
  const directText = readString(record, ['text', 'answer', 'output_text', 'outputText', 'result']);

  if (directText) {
    return directText;
  }

  const output = record.output;

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return readString(output as Record<string, unknown>, ['text', 'answer', 'output_text', 'outputText']);
  }

  return undefined;
}

function normalizeWorkerStatus(status: unknown): ExecutionResult['status'] | undefined {
  if (isCanonicalExecutionStatus(status)) {
    return status;
  }

  if (status === 'ok' || status === 'success' || status === 'done') {
    return 'completed';
  }

  if (status === undefined || status === null) {
    return undefined;
  }

  return 'failed';
}

function coerceExecutionResult(value: unknown): ExecutionResult | null {
  if (isExecutionResult(value)) {
    return value;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeWorkerStatus(record.status);
  const text = readOutputText(record);

  if (!status || !text) {
    return null;
  }

  const structured: Record<string, unknown> = {};
  const structuredValue = record.structured;

  if (structuredValue && typeof structuredValue === 'object' && !Array.isArray(structuredValue)) {
    Object.assign(structured, structuredValue);
  }

  for (const key of ['toolCalls', 'tool_calls']) {
    const valueForKey = record[key];

    if (valueForKey !== undefined) {
      structured[key] = valueForKey;
    }
  }

  return {
    backendId: readString(record, ['backendId', 'backend_id', 'backend']) ?? 'agent-relay-worker',
    status,
    output: {
      text,
      ...(Object.keys(structured).length > 0 ? { structured } : {}),
    },
    metadata: {
      normalizedFromRelayWorker: true,
    },
  };
}

function parseResultMessage(raw: string): AgentRelayExecutionResultMessage | null {
  const record = parseJsonObject(raw);

  if (!record) {
    return null;
  }

  if (record.type !== AGENT_RELAY_EXECUTION_RESULT_TYPE && record.type !== 'execution-result') {
    return null;
  }

  const result = record.executionResult ?? record.result;
  const executionResult = coerceExecutionResult(result);

  if (!executionResult) {
    return null;
  }

  const turnId = typeof record.turnId === 'string' ? record.turnId : undefined;
  const threadId = typeof record.threadId === 'string' ? record.threadId : undefined;

  if (!turnId || !threadId) {
    return null;
  }

  return {
    type: record.type,
    turnId,
    threadId,
    executionResult,
  } as AgentRelayExecutionResultMessage;
}

function buildDefaultWorkerTask(input: {
  orchestratorName: string;
  channelId: string;
}): string {
  return [
    'You are an Agent Assistant local execution worker connected through Agent Relay.',
    `Wait for Relay messages from ${input.orchestratorName} containing JSON with type "${AGENT_RELAY_EXECUTION_REQUEST_TYPE}".`,
    'For each request, preserve the assistant identity and instructions inside request.instructions.',
    'Use only the tools described by request.tools and respect read-only metadata.',
    'Send the result back to the sender on the same thread using Relay messaging.',
    `The response body must be JSON with type "${AGENT_RELAY_EXECUTION_RESULT_TYPE}", the same turnId/threadId, and an executionResult shaped exactly like Agent Assistant ExecutionResult.`,
    'Use executionResult.status "completed" for successful turns, not "ok" or "success".',
    'Put the final assistant response in executionResult.output.text, not top-level answer/text.',
    'Minimum successful response shape: {"type":"agent-assistant.execution-result.v1","turnId":"<same>","threadId":"<same>","executionResult":{"backendId":"agent-relay-worker","status":"completed","output":{"text":"<final response>"}}}.',
    `Default channel: ${input.channelId}.`,
  ].join('\n');
}

function relayInbound(event: BrokerEvent): Extract<BrokerEvent, { kind: 'relay_inbound' }> | null {
  return event.kind === 'relay_inbound' ? event : null;
}

export class AgentRelayExecutionAdapter implements ExecutionAdapter {
  readonly backendId: string;

  private readonly relay: AgentRelayExecutionTransport;
  private readonly channelId: string;
  private readonly workerName?: string;
  private readonly orchestratorName: string;
  private readonly workspaceId?: string;
  private readonly timeoutMs: number;
  private readonly capabilities: ExecutionCapabilities;
  private readonly spawnWorker?: AgentRelayWorkerSpawnConfig;
  private readonly now: () => number;
  private readonly shutdownAfterExecute: boolean;

  constructor(config: AgentRelayExecutionAdapterConfig = {}) {
    this.backendId = config.backendId ?? 'agent-relay';
    this.channelId = config.channelId ?? DEFAULT_CHANNEL_ID;
    this.workerName = config.workerName;
    this.orchestratorName = config.orchestratorName ?? DEFAULT_ORCHESTRATOR_NAME;
    this.workspaceId = config.workspaceId;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.capabilities = cloneCapabilities(config.capabilities ?? DEFAULT_CAPABILITIES);
    this.spawnWorker = config.spawnWorker;
    this.now = config.now ?? Date.now;
    this.shutdownAfterExecute = config.shutdownAfterExecute ?? false;
    this.relay =
      config.relay ??
      new RelayAdapter({
        cwd: config.cwd ?? process.cwd(),
        channels: [this.channelId],
        binaryPath: config.binaryPath,
        env: config.env,
      });
  }

  describeCapabilities(): ExecutionCapabilities {
    return cloneCapabilities(this.capabilities);
  }

  negotiate(request: ExecutionRequest): ExecutionNegotiation {
    return negotiateRequest(request, this.capabilities);
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const negotiation = this.negotiate(request);
    if (!negotiation.supported) {
      return {
        backendId: this.backendId,
        status: 'unsupported',
        error: {
          code: 'unsupported_capability',
          message: negotiation.reasons.map((reason) => reason.message).join(' '),
        },
        degradation: negotiation.reasons,
        trace: {
          summary: {
            degraded: false,
          },
        },
      };
    }

    const startedAt = this.now();
    const threadId = request.threadId ?? request.turnId;
    const target = this.workerName ?? this.channelId;
    const degraded = negotiation.degraded;

    let unsubscribe: (() => void) | undefined;
    let settled = false;

    const finish = (result: ExecutionResult): ExecutionResult => ({
      ...result,
      backendId: this.backendId,
      degradation: negotiation.degraded
        ? [...(result.degradation ?? []), ...negotiation.reasons]
        : result.degradation,
      metadata: {
        ...(result.metadata ?? {}),
        relay: {
          adapterBackendId: this.backendId,
          workerBackendId: result.backendId,
          channelId: this.channelId,
          target,
          threadId,
        },
      },
    });

    try {
      await this.relay.start();
      await this.ensureWorker();

      return await new Promise<ExecutionResult>((resolve) => {
        const complete = (result: ExecutionResult) => {
          if (settled) {
            return;
          }

          settled = true;
          unsubscribe?.();
          resolve(result);
        };

        const timeout = setTimeout(() => {
          const completedAt = this.now();
          complete({
            backendId: this.backendId,
            status: 'failed',
            error: {
              code: 'timeout',
              message: `Timed out waiting for Relay execution result after ${this.timeoutMs}ms.`,
              retryable: true,
              metadata: { channelId: this.channelId, target, threadId },
            },
            trace: buildTrace(startedAt, completedAt, degraded, [
              {
                type: 'failure',
                at: toIso(completedAt),
                data: { channelId: this.channelId, target, threadId },
              },
            ]),
            degradation: negotiation.degraded ? negotiation.reasons : undefined,
          });
        }, this.timeoutMs);

        const completeAndClear = (result: ExecutionResult) => {
          clearTimeout(timeout);
          complete(result);
        };

        unsubscribe = this.relay.onEvent((event) => {
          const inbound = relayInbound(event);
          if (!inbound) {
            return;
          }

          if (this.workerName && inbound.from !== this.workerName) {
            return;
          }

          const parsed = parseResultMessage(inbound.body);
          if (!parsed || parsed.turnId !== request.turnId || parsed.threadId !== threadId) {
            return;
          }

          const completedAt = this.now();
          const executionResult = parsed.executionResult ?? parsed.result;
          if (!executionResult) {
            return;
          }

          completeAndClear(
            finish({
              ...executionResult,
              trace:
                executionResult.trace ??
                buildTrace(startedAt, completedAt, degraded, [
                  { type: 'model_started', at: toIso(startedAt) },
                  {
                    type: 'model_completed',
                    at: toIso(completedAt),
                    data: {
                      channelId: this.channelId,
                      target,
                      eventId: inbound.event_id,
                    },
                  },
                ]),
            }),
          );
        });

        const message: AgentRelayExecutionRequestMessage = {
          type: AGENT_RELAY_EXECUTION_REQUEST_TYPE,
          turnId: request.turnId,
          threadId,
          request,
          replyTo: {
            agentId: this.orchestratorName,
            channelId: this.channelId,
          },
          sentAt: toIso(startedAt),
        };

        void this.relay
          .sendMessage({
            to: target,
            text: JSON.stringify(message),
            from: this.orchestratorName,
            threadId,
            ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
            data: {
              type: AGENT_RELAY_EXECUTION_REQUEST_TYPE,
              turnId: request.turnId,
              threadId,
            },
          })
          .catch((error) => {
            const completedAt = this.now();
            completeAndClear({
              backendId: this.backendId,
              status: 'failed',
              error: {
                code: 'backend_execution_error',
                message: error instanceof Error ? error.message : 'Failed to publish Relay execution request.',
                retryable: true,
              },
              trace: buildTrace(startedAt, completedAt, degraded, [
                {
                  type: 'failure',
                  at: toIso(completedAt),
                  data: { channelId: this.channelId, target },
                },
              ]),
              degradation: negotiation.degraded ? negotiation.reasons : undefined,
            });
          });
      });
    } catch (error) {
      const completedAt = this.now();
      return {
        backendId: this.backendId,
        status: 'failed',
        error: {
          code: 'backend_execution_error',
          message: error instanceof Error ? error.message : 'Agent Relay execution failed.',
          retryable: true,
        },
        trace: buildTrace(startedAt, completedAt, degraded, [
          {
            type: 'failure',
            at: toIso(completedAt),
            data: { channelId: this.channelId, target, threadId },
          },
        ]),
        degradation: negotiation.degraded ? negotiation.reasons : undefined,
      };
    } finally {
      if (this.shutdownAfterExecute && this.relay.shutdown) {
        await this.relay.shutdown();
      }
    }
  }

  private async ensureWorker(): Promise<void> {
    if (!this.spawnWorker?.enabled) {
      return;
    }

    const workerName = this.spawnWorker.name ?? this.workerName;
    if (!workerName) {
      throw new Error('Agent Relay worker auto-spawn requires workerName or spawnWorker.name.');
    }

    if (!this.relay.spawn) {
      throw new Error('Configured Agent Relay transport does not support worker spawning.');
    }

    if (this.relay.listAgents) {
      const agents = await this.relay.listAgents();
      if (agents.some((agent) => agent.name === workerName)) {
        return;
      }
    }

    const result = await this.relay.spawn({
      name: workerName,
      cli: this.spawnWorker.cli,
      task:
        this.spawnWorker.task ??
        buildDefaultWorkerTask({
          orchestratorName: this.orchestratorName,
          channelId: this.channelId,
        }),
      model: this.spawnWorker.model,
      cwd: this.spawnWorker.cwd,
      team: this.spawnWorker.team,
      includeWorkflowConventions: this.spawnWorker.includeWorkflowConventions ?? true,
    });

    if (!result.success) {
      throw new Error(result.error ?? `Failed to spawn Agent Relay worker "${workerName}".`);
    }
  }
}

export function createAgentRelayExecutionAdapter(
  config: AgentRelayExecutionAdapterConfig = {},
): ExecutionAdapter {
  return new AgentRelayExecutionAdapter(config);
}
