import {
  EXECUTION_CONTRACT_SCHEMA_VERSION,
  type ExecutionAdapter,
  type ExecutionCapabilities,
  type ExecutionNegotiation,
  type ExecutionNegotiationReason,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutionStreamEvent,
  type ExecutionToolResult,
  type ExecutionTrace,
} from './types.js';
import type {
  HarnessApprovalAdapter,
  HarnessHooks,
  HarnessLimits,
  HarnessModelAdapter,
  HarnessResult,
  HarnessRuntime,
  HarnessToolRegistry,
  HarnessTraceSink,
  HarnessTurnInput,
  HarnessUserMessage,
  HarnessInstructions,
  HarnessPreparedContext,
  HarnessContextBlock,
  HarnessContinuation,
  HarnessStreamEvent,
} from '../types.js';
import { createHarness } from '../harness.js';

const DEFAULT_BACKEND_ID = 'built-in-harness';

const DEFAULT_CAPABILITIES: ExecutionCapabilities = {
  schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
  toolUse: 'native-iterative',
  structuredToolCalls: true,
  continuationSupport: 'structured',
  approvalInterrupts: 'native',
  traceDepth: 'detailed',
  attachments: false,
  streaming: 'adapter-mediated',
  maxContextStrategy: 'large',
  notes: ['First-party harness adapter routing through @agent-assistant/harness.'],
};

export interface BuiltInHarnessAdapterConfig {
  model: HarnessModelAdapter;
  tools?: HarnessToolRegistry;
  approvals?: HarnessApprovalAdapter;
  trace?: HarnessTraceSink;
  hooks?: HarnessHooks;
  limits?: HarnessLimits;
  backendId?: string;
  capabilities?: ExecutionCapabilities;
  /**
   * Optional pre-built {@link HarnessRuntime}. When supplied, the adapter
   * wraps it directly instead of constructing one via {@link createHarness}.
   * The runtime MUST honor the provided HarnessConfig surface — tool/model
   * adapters set on `BuiltInHarnessAdapterConfig` are ignored when this is
   * set.
   */
  runtime?: HarnessRuntime;
  now?: () => number;
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

function negotiateRequest(
  request: ExecutionRequest,
  capabilities: ExecutionCapabilities,
): ExecutionNegotiation {
  const reasons: ExecutionNegotiationReason[] = [];
  const requirements = request.requirements;
  const hasAttachments = (request.message.attachments?.length ?? 0) > 0;

  const requestedSchema = request.schemaVersion ?? EXECUTION_CONTRACT_SCHEMA_VERSION;
  const supportedSchema = capabilities.schemaVersion ?? EXECUTION_CONTRACT_SCHEMA_VERSION;
  if (requestedSchema > supportedSchema) {
    reasons.push(
      requiredUnsupported(
        'other',
        `Request schemaVersion ${requestedSchema} exceeds adapter-supported ${supportedSchema}.`,
      ),
    );
  }

  if (hasAttachments && !capabilities.attachments) {
    reasons.push(requiredUnsupported('attachments_unsupported', 'Built-in harness adapter does not relay attachments.'));
  }
  if (requirements?.attachments === 'required' && !capabilities.attachments) {
    reasons.push(requiredUnsupported('attachments_unsupported', 'Attachments are required but unsupported.'));
  }

  if (requirements?.streaming === 'required' && (capabilities.streaming ?? 'none') === 'none') {
    reasons.push(requiredUnsupported('other', 'Streaming was required but is unavailable.'));
  } else if (requirements?.streaming === 'preferred' && (capabilities.streaming ?? 'none') === 'none') {
    reasons.push(preferredDegradation('other', 'Streaming was preferred but unavailable.'));
  }

  return {
    supported: !reasons.some((reason) => reason.severity === 'blocking'),
    degraded: reasons.some((reason) => reason.severity !== 'blocking'),
    reasons,
    effectiveCapabilities: cloneCapabilities(capabilities),
  };
}

function toUserMessage(request: ExecutionRequest): HarnessUserMessage {
  return {
    id: request.message.id,
    text: request.message.text,
    receivedAt: request.message.receivedAt,
    attachments: request.message.attachments,
  };
}

function toInstructions(request: ExecutionRequest): HarnessInstructions {
  return {
    systemPrompt: request.instructions.systemPrompt,
    developerPrompt: request.instructions.developerPrompt,
    responseStyle: request.instructions.responseStyle,
  };
}

function toContext(request: ExecutionRequest): HarnessPreparedContext | undefined {
  if (!request.context) return undefined;
  const blocks: HarnessContextBlock[] = (request.context.blocks ?? []).map((block) => ({
    id: block.id,
    label: block.label,
    content: block.text,
    importance: undefined,
    source: block.category,
  }));
  return { blocks, structured: request.context.structured };
}

function toContinuation(request: ExecutionRequest): HarnessContinuation | undefined {
  if (!request.continuation) return undefined;
  const kind = request.continuation.kind;
  if (kind !== 'clarification' && kind !== 'approval' && kind !== 'deferred') return undefined;
  const id = request.continuation.continuationId ?? `${request.turnId}:${kind}`;
  return {
    id,
    type: kind,
    createdAt: new Date().toISOString(),
    turnId: request.turnId,
    sessionId: request.sessionId,
    resumeToken: id,
    state: request.continuation.state ?? {},
    metadata: request.continuation.metadata,
  };
}

function toHarnessTurnInput(request: ExecutionRequest): HarnessTurnInput {
  return {
    assistantId: request.assistantId,
    turnId: request.turnId,
    workspaceId: undefined,
    sessionId: request.sessionId,
    userId: request.userId,
    threadId: request.threadId,
    message: toUserMessage(request),
    instructions: toInstructions(request),
    context: toContext(request),
    continuation: toContinuation(request),
    allowedToolNames: request.tools?.map((tool) => tool.name),
    metadata: request.metadata,
    signal: request.signal,
  };
}

function harnessResultToExecutionResult(
  result: HarnessResult,
  backendId: string,
  startedAt: number,
  completedAt: number,
  degraded: boolean,
  degradation: ExecutionNegotiationReason[] | undefined,
): ExecutionResult {
  const status = mapOutcome(result);
  const trace: ExecutionTrace = {
    summary: {
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      stepCount: result.traceSummary.iterationCount,
      toolCallCount: result.traceSummary.toolCallCount,
      degraded,
    },
  };
  const base: ExecutionResult = {
    schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
    backendId,
    status,
    trace,
    degradation,
    metadata: { stopReason: result.stopReason, ...(result.metadata ?? {}) },
  };
  if (status === 'completed') {
    base.output = { text: result.assistantMessage?.text };
  }
  if (status === 'needs_clarification') {
    base.output = { text: result.assistantMessage?.text };
    if (result.continuation) {
      base.continuation = {
        kind: result.continuation.type,
        state: result.continuation.state,
        metadata: result.continuation.metadata,
      };
    }
  }
  if (status === 'awaiting_approval' && result.continuation) {
    base.continuation = {
      kind: result.continuation.type,
      state: result.continuation.state,
      metadata: result.continuation.metadata,
    };
    const approvalMeta = result.metadata?.approvalRequest;
    if (approvalMeta && typeof approvalMeta === 'object') {
      base.approvalRequest = approvalMeta as ExecutionResult['approvalRequest'];
    }
  }
  if (status === 'deferred' && result.continuation) {
    base.continuation = {
      kind: result.continuation.type,
      state: result.continuation.state,
      metadata: result.continuation.metadata,
    };
  }
  if (status === 'failed') {
    base.error = mapError(result);
  }
  if (result.metadata && typeof result.metadata === 'object') {
    const evidence = (result.metadata as Record<string, unknown>).evidenceDensity;
    if (evidence) {
      base.degradation = [
        ...(base.degradation ?? []),
        { code: 'other', severity: 'warning', message: 'Evidence density violation detected.', metadata: { evidenceDensity: evidence } },
      ];
    }
  }
  return base;
}

function mapOutcome(result: HarnessResult): ExecutionResult['status'] {
  switch (result.outcome) {
    case 'completed':
      return 'completed';
    case 'needs_clarification':
      return 'needs_clarification';
    case 'awaiting_approval':
      return 'awaiting_approval';
    case 'deferred':
      return 'deferred';
    case 'failed':
    default:
      return 'failed';
  }
}

function mapError(result: HarnessResult): ExecutionResult['error'] {
  const message = result.assistantMessage?.text ?? `Harness turn failed: ${result.stopReason}`;
  if (result.stopReason === 'cancelled') {
    return { code: 'cancelled', message, retryable: false };
  }
  if (result.stopReason === 'timeout_reached') {
    return { code: 'timeout', message, retryable: true };
  }
  if (result.stopReason === 'budget_reached') {
    return { code: 'budget_exceeded', message, retryable: false };
  }
  return { code: 'backend_execution_error', message, metadata: { stopReason: result.stopReason } };
}

function harnessStreamToExecution(
  event: HarnessStreamEvent,
  backendId: string,
  startedAt: number,
  now: () => number,
  degraded: boolean,
  degradation: ExecutionNegotiationReason[] | undefined,
): ExecutionStreamEvent | null {
  switch (event.type) {
    case 'text_delta':
      // Only stream text for completed/clarification/refusal/approval — other
      // step shapes don't carry user-visible text.
      return { type: 'text_delta', text: event.text, index: event.iteration };
    case 'tool_started':
      return { type: 'tool_started', callId: event.call.id, name: event.call.name, input: event.call.input };
    case 'tool_finished': {
      const result: ExecutionToolResult = {
        callId: event.result.callId,
        toolName: event.result.toolName,
        status: event.result.status,
        output: event.result.output,
        structuredOutput: event.result.structuredOutput,
        usage: event.result.usage,
      };
      return { type: 'tool_finished', callId: event.result.callId, result };
    }
    case 'tool_failed':
      return {
        type: 'tool_failed',
        callId: event.result.callId,
        error: {
          code: 'tool_bridge_error',
          message: event.result.error?.message ?? 'tool failed',
          retryable: event.result.error?.retryable ?? false,
        },
      };
    case 'step_finished':
      return { type: 'step_finished', iteration: event.iteration, usage: event.usage };
    case 'turn_finished': {
      const completedAt = now();
      const executionResult = harnessResultToExecutionResult(
        event.result,
        backendId,
        startedAt,
        completedAt,
        degraded,
        degradation,
      );
      return { type: 'turn_finished', result: executionResult };
    }
    case 'error':
      return {
        type: 'error',
        error: {
          code: 'backend_execution_error',
          message: event.message,
          retryable: event.retryable ?? false,
        },
      };
  }
}

export class BuiltInHarnessAdapter implements ExecutionAdapter {
  readonly backendId: string;
  private readonly capabilities: ExecutionCapabilities;
  private readonly runtime: HarnessRuntime;
  private readonly now: () => number;

  constructor(config: BuiltInHarnessAdapterConfig) {
    this.backendId = config.backendId ?? DEFAULT_BACKEND_ID;
    this.capabilities = cloneCapabilities(config.capabilities ?? DEFAULT_CAPABILITIES);
    this.now = config.now ?? Date.now;
    this.runtime =
      config.runtime ??
      createHarness({
        model: config.model,
        tools: config.tools,
        approvals: config.approvals,
        trace: config.trace,
        hooks: config.hooks,
        limits: config.limits,
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
        schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
        backendId: this.backendId,
        status: 'unsupported',
        error: {
          code: 'unsupported_capability',
          message: negotiation.reasons.map((reason) => reason.message).join(' '),
        },
        degradation: negotiation.reasons,
        trace: { summary: { degraded: false } },
      };
    }

    if (request.signal?.aborted) {
      return {
        schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
        backendId: this.backendId,
        status: 'failed',
        error: { code: 'cancelled', message: 'Execution request was cancelled before it started.', retryable: false },
        trace: { summary: { degraded: false } },
        degradation: negotiation.degraded ? negotiation.reasons : undefined,
      };
    }

    const startedAt = this.now();
    const result = await this.runtime.runTurn(toHarnessTurnInput(request));
    const completedAt = this.now();
    return harnessResultToExecutionResult(
      result,
      this.backendId,
      startedAt,
      completedAt,
      negotiation.degraded,
      negotiation.degraded ? negotiation.reasons : undefined,
    );
  }

  executeStreaming(request: ExecutionRequest): AsyncIterable<ExecutionStreamEvent> {
    const negotiation = this.negotiate(request);
    const backendId = this.backendId;
    const now = this.now;
    const startedAt = this.now();
    const runtime = this.runtime;

    if (!negotiation.supported) {
      const reasons = negotiation.reasons;
      return {
        async *[Symbol.asyncIterator]() {
          const errorEvent: ExecutionStreamEvent = {
            type: 'error',
            error: {
              code: 'unsupported_capability',
              message: reasons.map((reason) => reason.message).join(' '),
              retryable: false,
            },
          };
          yield errorEvent;
          const finishEvent: ExecutionStreamEvent = {
            type: 'turn_finished',
            result: {
              schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
              backendId,
              status: 'unsupported',
              error: { code: 'unsupported_capability', message: errorEvent.type === 'error' ? errorEvent.error.message : '' },
              degradation: reasons,
              trace: { summary: { degraded: false } },
            },
          };
          yield finishEvent;
        },
      };
    }

    if (!runtime.runTurnStreaming) {
      // Runtime doesn't support streaming; fall back to a single batch
      // execute() and project text+turn_finished. This still satisfies the
      // capability contract because we declared 'adapter-mediated', not 'native'.
      return {
        async *[Symbol.asyncIterator]() {
          const result = await runtime.runTurn(toHarnessTurnInput(request));
          const completedAt = now();
          if (result.assistantMessage?.text) {
            yield { type: 'text_delta', text: result.assistantMessage.text };
          }
          yield {
            type: 'turn_finished',
            result: harnessResultToExecutionResult(
              result,
              backendId,
              startedAt,
              completedAt,
              negotiation.degraded,
              negotiation.degraded ? negotiation.reasons : undefined,
            ),
          };
        },
      };
    }

    const harnessIterable = runtime.runTurnStreaming(toHarnessTurnInput(request));
    const degraded = negotiation.degraded;
    const degradation = negotiation.degraded ? negotiation.reasons : undefined;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of harnessIterable) {
          const projected = harnessStreamToExecution(event, backendId, startedAt, now, degraded, degradation);
          if (projected) yield projected;
          if (event.type === 'turn_finished') return;
        }
      },
    };
  }
}

export function createBuiltInHarnessAdapter(config: BuiltInHarnessAdapterConfig): ExecutionAdapter {
  return new BuiltInHarnessAdapter(config);
}
