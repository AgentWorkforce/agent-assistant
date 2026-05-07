import {
  filterParentContextForSubagent,
  type CreateSubagentToolRegistryOptions,
  type HarnessSubagent,
  type HarnessTurnContext,
  type RunSubagentInput,
  type TaskToolInput,
  type TaskToolResult,
} from './subagent-registry.js';
import type {
  HarnessInstructions,
  HarnessResult,
  HarnessRuntime,
  HarnessStopReason,
  HarnessTurnInput,
} from './types.js';

export interface CreateNestedHarnessInput {
  subagent: HarnessSubagent;
  parentContext: HarnessTurnContext;
  parentTraceId: string;
  filteredParentContext: HarnessTurnContext;
  toolAllowlist: ReadonlySet<string>;
  signal?: AbortSignal;
}

export interface ComposeNestedSubagentInstructionsInput {
  subagent: HarnessSubagent;
  taskInput: TaskToolInput;
  parentContext: HarnessTurnContext;
}

export interface CreateNestedSubagentRunnerOptions {
  createHarness(input: CreateNestedHarnessInput): HarnessRuntime;
  composeInstructions(
    input: ComposeNestedSubagentInstructionsInput,
  ): HarnessInstructions;
  now?(): string;
}

function childCounterKey(input: RunSubagentInput, parentTraceId: string): string {
  return `${parentTraceId}::${input.parentContext.turnId}`;
}

function readTraceIdCandidate(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveParentTraceId(input: RunSubagentInput): string {
  if (input.parentTraceId) {
    return input.parentTraceId;
  }

  const metadata =
    typeof input.parentContext.metadata === 'object' && input.parentContext.metadata !== null
      ? (input.parentContext.metadata as Record<string, unknown>)
      : undefined;

  return (
    readTraceIdCandidate(input.parentContext.traceId) ??
    readTraceIdCandidate(input.parentContext.parentTraceId) ??
    readTraceIdCandidate(input.parentContext.childTraceId) ??
    readTraceIdCandidate(metadata?.traceId) ??
    readTraceIdCandidate(metadata?.childTraceId) ??
    readTraceIdCandidate(metadata?.parentTraceId) ??
    input.parentContext.turnId
  );
}

function readResultMessage(result: HarnessResult): string | undefined {
  if (typeof result.assistantMessage?.text === 'string' && result.assistantMessage.text.length > 0) {
    return result.assistantMessage.text;
  }

  const reason = result.metadata?.reason;
  return typeof reason === 'string' && reason.length > 0 ? reason : undefined;
}

function failureMessageForStopReason(stopReason: HarnessStopReason): string {
  switch (stopReason) {
    case 'max_iterations_reached':
      return 'Subagent reached its maximum iteration limit.';
    case 'cancelled':
      return 'Subagent run was cancelled.';
    case 'model_invalid_response':
      return 'Subagent produced invalid output.';
    case 'model_refused':
      return 'Subagent refused the request.';
    default:
      return `Subagent ended without a final answer (${stopReason}).`;
  }
}

function classifyThrownError(error: unknown): { code: string; message: string } {
  if (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return {
      code: 'aborted',
      message: error instanceof Error && error.message ? error.message : String(error),
    };
  }

  const message = error instanceof Error && error.message ? error.message : String(error);
  if (message.includes('max_iterations') || message.includes('MaxIterationsReached')) {
    return {
      code: 'max_iterations',
      message,
    };
  }

  return {
    code: 'subagent_error',
    message,
  };
}

function toFailureResult(
  subagent: HarnessSubagent,
  result: HarnessResult,
): TaskToolResult {
  const message = readResultMessage(result) ?? failureMessageForStopReason(result.stopReason);
  const code =
    result.stopReason === 'max_iterations_reached'
      ? 'max_iterations'
      : result.stopReason === 'cancelled'
        ? 'aborted'
        : result.stopReason === 'model_invalid_response'
          ? 'invalid_output'
          : 'subagent_error';

  return {
    ok: false,
    error: { code, message },
    iterations: result.traceSummary.iterationCount,
    subagent: subagent.name,
  };
}

function toSuccessResult(
  subagent: HarnessSubagent,
  result: HarnessResult,
): TaskToolResult {
  return {
    ok: true,
    output: result.assistantMessage?.text ?? '',
    iterations: result.traceSummary.iterationCount,
    subagent: subagent.name,
  };
}

function buildChildMetadata(
  parentContext: HarnessTurnContext,
  parentTraceId: string,
  childTraceId: string,
  subagentName: string,
): Record<string, unknown> {
  const metadata =
    typeof parentContext.metadata === 'object' && parentContext.metadata !== null
      ? { ...(parentContext.metadata as Record<string, unknown>) }
      : {};

  return {
    ...metadata,
    parentTraceId,
    childTraceId,
    subagentName,
  };
}

export function createNestedSubagentRunner(
  options: CreateNestedSubagentRunnerOptions,
): CreateSubagentToolRegistryOptions['runSubagent'] {
  const childCounters = new Map<string, number>();
  const now = options.now ?? (() => new Date().toISOString());

  return async (input) => {
    const filteredParentContext = filterParentContextForSubagent(input.parentContext);
    const parentTraceId = resolveParentTraceId(input);
    const counterKey = childCounterKey(input, parentTraceId);
    const nextIndex = (childCounters.get(counterKey) ?? 0) + 1;
    childCounters.set(counterKey, nextIndex);
    const childTraceId = `${parentTraceId}.sa-${nextIndex}`;
    const childTurnId = `${input.parentContext.turnId}.sa-${nextIndex}`;
    const toolAllowlist = new Set(input.subagent.toolAllowlist);
    try {
      const runtime = options.createHarness({
        subagent: input.subagent,
        parentContext: input.parentContext,
        parentTraceId,
        filteredParentContext,
        toolAllowlist,
        signal: input.signal,
      });
      const instructions = options.composeInstructions({
        subagent: input.subagent,
        taskInput: input.taskInput,
        parentContext: input.parentContext,
      });
      const turnInput: HarnessTurnInput = {
        assistantId: input.parentContext.assistantId,
        turnId: childTurnId,
        workspaceId: input.parentContext.workspaceId,
        sessionId: input.parentContext.sessionId,
        userId: input.parentContext.userId,
        threadId: input.parentContext.threadId,
        message: {
          id: `${childTurnId}.msg-1`,
          text: input.description,
          receivedAt: now(),
        },
        instructions,
        allowedToolNames: [...toolAllowlist],
        signal: input.signal,
        metadata: buildChildMetadata(
          input.parentContext,
          parentTraceId,
          childTraceId,
          input.subagent.name,
        ),
      };
      const result = await runtime.runTurn(turnInput);
      return result.outcome === 'completed' && result.stopReason === 'answer_finalized'
        ? toSuccessResult(input.subagent, result)
        : toFailureResult(input.subagent, result);
    } catch (error) {
      const classified = classifyThrownError(error);
      return {
        ok: false,
        error: classified,
        iterations: 0,
        subagent: input.subagent.name,
      };
    }
  };
}
