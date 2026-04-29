import type {
  HarnessAggregateUsage,
  HarnessApprovalRequest,
  HarnessAssistantThoughtStep,
  HarnessClock,
  HarnessConfig,
  HarnessContinuation,
  HarnessExecutionState,
  HarnessInvalidOutput,
  HarnessLimits,
  HarnessModelCallRecord,
  HarnessModelInput,
  HarnessModelOutput,
  HarnessResult,
  HarnessStopReason,
  HarnessToolCall,
  HarnessToolEvidenceClarification,
  HarnessToolExecutionContext,
  HarnessToolRegistry,
  HarnessToolResult,
  HarnessToolRetryConfig,
  HarnessTraceEvent,
  HarnessTraceSummary,
  HarnessTranscriptItem,
  HarnessTurnInput,
  HarnessRuntime,
} from './types.js';
import { HarnessConfigError } from './types.js';

const DEFAULT_LIMITS: Required<Pick<HarnessLimits, 'maxIterations' | 'maxToolCalls' | 'maxElapsedMs' | 'maxConsecutiveInvalidModelOutputs'>> = {
  maxIterations: 6,
  maxToolCalls: 8,
  maxElapsedMs: 30_000,
  maxConsecutiveInvalidModelOutputs: 2,
};

// Default in-turn auto-retry policy for retryable tool failures. Two retries
// (three total attempts), with backoff small enough to stay inside Cloudflare
// Worker subrequest budgets but large enough to absorb a transient blip from
// an upstream specialist worker. Retries are part of the SAME logical tool
// call — they do not consume an iteration or tool-call budget slot.
const DEFAULT_TOOL_RETRY_CONFIG: HarnessToolRetryConfig = {
  maxRetries: 2,
  backoffMs: [200, 500],
};

const defaultClock: HarnessClock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

type MutableState = {
  iteration: number;
  toolCallCount: number;
  transcript: HarnessTranscriptItem[];
  modelCalls: HarnessModelCallRecord[];
  usage: HarnessAggregateUsage;
  recentToolResultHashes?: { toolName: string; outputHash: number }[];
  consecutiveInvalidOutputs: number;
  finalEventType: string;
};

type NormalizedConfig = {
  limits: Required<Pick<HarnessLimits, 'maxIterations' | 'maxToolCalls' | 'maxElapsedMs' | 'maxConsecutiveInvalidModelOutputs'>> & Pick<HarnessLimits, 'budgetLimit'>;
  clock: HarnessClock;
  toolRetryConfig: HarnessToolRetryConfig;
} & HarnessConfig;

export function createHarness(config: HarnessConfig): HarnessRuntime {
  const normalized = normalizeConfig(config);

  return {
    async runTurn(input) {
      return runTurn(normalized, input);
    },
  };
}

function normalizeConfig(config: HarnessConfig): NormalizedConfig {
  if (!config || typeof config !== 'object') {
    throw new HarnessConfigError('Harness config is required');
  }

  if (!config.model || typeof config.model.nextStep !== 'function') {
    throw new HarnessConfigError("Harness config requires a valid 'model' adapter");
  }

  if (config.tools) {
    if (
      typeof config.tools.listAvailable !== 'function' ||
      typeof config.tools.execute !== 'function'
    ) {
      throw new HarnessConfigError("Harness 'tools' adapter must provide listAvailable and execute");
    }
  }

  if (config.approvals && typeof config.approvals.prepareRequest !== 'function') {
    throw new HarnessConfigError("Harness 'approvals' adapter must provide prepareRequest");
  }

  if (config.trace && typeof config.trace.emit !== 'function') {
    throw new HarnessConfigError("Harness 'trace' adapter must provide emit");
  }

  if (config.clock) {
    if (typeof config.clock.now !== 'function' || typeof config.clock.nowIso !== 'function') {
      throw new HarnessConfigError("Harness 'clock' adapter must provide now and nowIso");
    }
  }

  const limits = {
    maxIterations: config.limits?.maxIterations ?? DEFAULT_LIMITS.maxIterations,
    maxToolCalls: config.limits?.maxToolCalls ?? DEFAULT_LIMITS.maxToolCalls,
    maxElapsedMs: config.limits?.maxElapsedMs ?? DEFAULT_LIMITS.maxElapsedMs,
    budgetLimit: config.limits?.budgetLimit,
    maxConsecutiveInvalidModelOutputs:
      config.limits?.maxConsecutiveInvalidModelOutputs ??
      DEFAULT_LIMITS.maxConsecutiveInvalidModelOutputs,
  };

  validatePositiveInteger(limits.maxIterations, 'limits.maxIterations');
  validatePositiveInteger(limits.maxToolCalls, 'limits.maxToolCalls');
  validatePositiveInteger(limits.maxElapsedMs, 'limits.maxElapsedMs');
  validatePositiveInteger(
    limits.maxConsecutiveInvalidModelOutputs,
    'limits.maxConsecutiveInvalidModelOutputs',
  );

  if (limits.budgetLimit !== undefined && (!Number.isFinite(limits.budgetLimit) || limits.budgetLimit < 0)) {
    throw new HarnessConfigError('limits.budgetLimit must be a finite number >= 0');
  }

  const toolRetryConfig = normalizeToolRetryConfig(config.toolRetryConfig);

  return {
    ...config,
    clock: config.clock ?? defaultClock,
    limits,
    toolRetryConfig,
  };
}

function normalizeToolRetryConfig(
  override: HarnessToolRetryConfig | undefined,
): HarnessToolRetryConfig {
  if (!override) {
    return DEFAULT_TOOL_RETRY_CONFIG;
  }

  if (!Number.isInteger(override.maxRetries) || override.maxRetries < 0) {
    throw new HarnessConfigError('toolRetryConfig.maxRetries must be a non-negative integer');
  }

  if (!Array.isArray(override.backoffMs) || override.backoffMs.some((ms) => !Number.isFinite(ms) || ms < 0)) {
    throw new HarnessConfigError(
      'toolRetryConfig.backoffMs must be an array of finite non-negative numbers',
    );
  }

  // Empty backoff array is fine when maxRetries is 0; otherwise we need at
  // least one entry to know how long to wait between attempts.
  if (override.maxRetries > 0 && override.backoffMs.length === 0) {
    throw new HarnessConfigError(
      'toolRetryConfig.backoffMs must contain at least one entry when maxRetries > 0',
    );
  }

  return { maxRetries: override.maxRetries, backoffMs: override.backoffMs.slice() };
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new HarnessConfigError(`${label} must be an integer greater than 0`);
  }
}

async function runTurn(config: NormalizedConfig, input: HarnessTurnInput): Promise<HarnessResult> {
  const startedAt = config.clock.now();
  const state: MutableState = {
    iteration: 0,
    toolCallCount: 0,
    transcript: [],
    modelCalls: [],
    usage: {
      modelCalls: 0,
      toolCalls: 0,
    },
    recentToolResultHashes: [],
    consecutiveInvalidOutputs: 0,
    finalEventType: 'turn_started',
  };

  let finalResult: HarnessResult | null = null;

  try {
    const availableTools = config.tools
      ? await config.tools.listAvailable({
          assistantId: input.assistantId,
          turnId: input.turnId,
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          userId: input.userId,
          allowedToolNames: input.allowedToolNames,
        })
      : [];

    await emit(config, input, state, { type: 'turn_started' });

    for (let iteration = 1; ; iteration += 1) {
      state.iteration = iteration;

      finalResult = await checkLimits(config, input, state, startedAt);
      if (finalResult) {
        return finalResult;
      }

      const modelInput: HarnessModelInput = {
        assistantId: input.assistantId,
        turnId: input.turnId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        userId: input.userId,
        threadId: input.threadId,
        message: input.message,
        instructions: input.instructions,
        context: input.context,
        continuation: input.continuation,
        transcript: [...state.transcript],
        availableTools,
        iteration,
        toolCallCount: state.toolCallCount,
        elapsedMs: getElapsedMs(config, startedAt),
        remainingBudget: remainingBudget(config, state.usage),
        metadata: input.metadata,
      };

      await emit(config, input, state, { type: 'model_step_started' });
      const output = await config.model.nextStep(modelInput);
      state.usage.modelCalls += 1;
      state.modelCalls.push({
        iteration,
        outputType: output.type,
        modelId: readModelId(output),
        usage: output.usage,
      });
      accumulateUsage(state.usage, output.usage);
      await emit(config, input, state, {
        type: 'model_step_finished',
        outputType: output.type,
        usage: output.usage,
      });

      const assistantStep = toAssistantStep(iteration, output);
      state.transcript.push(assistantStep);

      switch (output.type) {
        case 'final_answer':
          finalResult = buildResult(input, state, {
            outcome: 'completed',
            stopReason: 'answer_finalized',
            assistantMessage: { text: output.text },
          });
          return finalResult;

        case 'clarification': {
          const continuation = createContinuation(config, input, 'clarification', {
            stopReason: 'clarification_required',
            question: output.question,
            transcript: summarizeTranscript(state.transcript),
          });
          state.transcript.push({
            type: 'clarification_request',
            iteration,
            question: output.question,
          });
          await emit(config, input, state, {
            type: 'clarification_requested',
            question: output.question,
          });
          finalResult = buildResult(input, state, {
            outcome: 'needs_clarification',
            stopReason: 'clarification_required',
            assistantMessage: { text: output.question },
            continuation,
          });
          return finalResult;
        }

        case 'approval_request': {
          state.transcript.push({
            type: 'approval_request',
            iteration,
            request: output.request,
          });
          const prepared = config.approvals
            ? await config.approvals.prepareRequest({
                assistantId: input.assistantId,
                turnId: input.turnId,
                workspaceId: input.workspaceId,
                sessionId: input.sessionId,
                userId: input.userId,
                request: output.request,
              })
            : {
                request: output.request,
                continuation: createContinuation(config, input, 'approval', {
                  stopReason: 'approval_required',
                  request: output.request,
                  transcript: summarizeTranscript(state.transcript),
                }),
              };
          await emit(config, input, state, {
            type: 'approval_requested',
            request: prepared.request,
          });
          finalResult = buildResult(input, state, {
            outcome: 'awaiting_approval',
            stopReason: 'approval_required',
            continuation: prepared.continuation,
            metadata: { approvalRequest: prepared.request },
          });
          return finalResult;
        }

        case 'tool_request': {
          if (output.calls.length === 0) {
            finalResult = await handleInvalidOutput(config, input, state, startedAt, {
              type: 'invalid',
              reason: 'Tool request contained zero calls',
              raw: output,
              usage: output.usage,
            });
            if (finalResult) {
              return finalResult;
            }
            continue;
          }

          const unavailableCall = output.calls.find(
            (call) => !availableTools.some((tool) => tool.name === call.name),
          );
          if (unavailableCall) {
            finalResult = buildResult(input, state, {
              outcome: 'failed',
              stopReason: 'tool_unavailable',
              metadata: { toolName: unavailableCall.name },
            });
            return finalResult;
          }

          if (state.toolCallCount + output.calls.length > config.limits.maxToolCalls) {
            finalResult = await buildLimitResult(config, input, state, 'max_tool_calls_reached');
            return finalResult;
          }

          await emit(config, input, state, { type: 'tool_requested', calls: output.calls });

          for (const [index, call] of output.calls.entries()) {
            const nextToolCallCount = state.toolCallCount + 1;
            state.toolCallCount = nextToolCallCount;
            state.usage.toolCalls = nextToolCallCount;
            await emit(config, input, state, { type: 'tool_started', call });
            const result = await executeToolWithRetry(config, input, state, call, {
              assistantId: input.assistantId,
              turnId: input.turnId,
              workspaceId: input.workspaceId,
              sessionId: input.sessionId,
              userId: input.userId,
              threadId: input.threadId,
              iteration,
              toolCallIndex: index,
            });
            accumulateUsage(state.usage, result.usage);
            state.transcript.push({ type: 'tool_result', iteration, result });

            if (result.status === 'error') {
              state.recentToolResultHashes = [];
              await emit(config, input, state, { type: 'tool_failed', result });
              await config.hooks?.onToolError?.(result, executionState(input, state, startedAt, config));
              finalResult = await maybeClarifyFromToolResult(config, input, state, startedAt, result);
              if (finalResult) {
                return finalResult;
              }
              if (result.error?.retryable !== true) {
                finalResult = buildResult(input, state, {
                  outcome: 'failed',
                  stopReason: 'tool_error_unrecoverable',
                  metadata: { toolName: result.toolName, code: result.error?.code },
                });
                return finalResult;
              }
            } else {
              await emit(config, input, state, { type: 'tool_finished', result });
              finalResult = await maybeClarifyFromToolResult(config, input, state, startedAt, result);
              if (finalResult) {
                return finalResult;
              }
              // Compute a hash signature of the tool result so we can detect
              // the model dead-looping on the same tool call. Two safety
              // guards (codex P1 + P2 review on PR #63):
              //
              // 1. Skip the detector when the tool returned no payload (no
              //    `output`, no `structuredOutput`). Side-effect tools that
              //    intentionally return nothing would otherwise all hash to
              //    `"{}"` and trip the detector after 3 calls even though
              //    each call had different inputs and made real progress.
              //
              // 2. Wrap JSON.stringify in try/catch so non-serializable values
              //    (BigInt, circular refs) cannot throw and convert a
              //    successful tool execution into a runtime_error.
              const signature = computeToolResultSignature(result);
              if (signature !== null) {
                state.recentToolResultHashes ??= [];
                state.recentToolResultHashes.push({ toolName: result.toolName, outputHash: signature });
                if (state.recentToolResultHashes.length > 5) state.recentToolResultHashes.shift();

                const lastThree = state.recentToolResultHashes.slice(-3);
                const [first] = lastThree;
                if (
                  first &&
                  lastThree.length === 3 &&
                  lastThree.every(
                    (entry) =>
                      entry.toolName === first.toolName && entry.outputHash === first.outputHash,
                  )
                ) {
                  finalResult = await buildLimitResult(
                    config,
                    input,
                    state,
                    'redundant_tool_loop',
                  );
                  return finalResult;
                }
              }
            }

            finalResult = await checkLimits(config, input, state, startedAt);
            if (finalResult) {
              return finalResult;
            }
          }

          state.consecutiveInvalidOutputs = 0;
          continue;
        }

        case 'refusal':
          finalResult = buildResult(input, state, {
            outcome: 'failed',
            stopReason: 'model_refused',
            assistantMessage: { text: output.reason },
          });
          return finalResult;

        case 'invalid':
          finalResult = await handleInvalidOutput(config, input, state, startedAt, output);
          if (finalResult) {
            return finalResult;
          }
          continue;
      }
    }
  } catch (error) {
    finalResult = buildResult(input, state, {
      outcome: 'failed',
      stopReason: 'runtime_error',
      metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
    });
    return finalResult;
  } finally {
    if (finalResult) {
      await emitFinishedSafely(config, input, state, finalResult);
      try {
        await config.hooks?.onTurnFinished?.(
          finalResult,
          executionState(input, state, startedAt, config),
        );
      } catch (error) {
        console.error('Harness onTurnFinished hook failed', error);
      }
    }
  }
}

async function handleInvalidOutput(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  startedAt: number,
  output: HarnessInvalidOutput,
): Promise<HarnessResult | null> {
  state.consecutiveInvalidOutputs += 1;
  await config.hooks?.onInvalidModelOutput?.(output, executionState(input, state, startedAt, config));

  if (state.consecutiveInvalidOutputs >= config.limits.maxConsecutiveInvalidModelOutputs) {
    return buildResult(input, state, {
      outcome: 'failed',
      stopReason: 'model_invalid_response',
      metadata: {
        reason: output.reason,
        ...(output.kind ? { kind: output.kind } : {}),
        ...(output.httpStatus !== undefined ? { httpStatus: output.httpStatus } : {}),
        ...(output.retriedAt ? { retriedAt: output.retriedAt } : {}),
      },
    });
  }

  return checkLimits(config, input, state, startedAt);
}

async function checkLimits(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  startedAt: number,
): Promise<HarnessResult | null> {
  if (state.iteration > config.limits.maxIterations) {
    return buildLimitResult(config, input, state, 'max_iterations_reached');
  }

  if (state.toolCallCount >= config.limits.maxToolCalls) {
    return buildLimitResult(config, input, state, 'max_tool_calls_reached');
  }

  if (getElapsedMs(config, startedAt) >= config.limits.maxElapsedMs) {
    return buildLimitResult(config, input, state, 'timeout_reached');
  }

  if (
    config.limits.budgetLimit !== undefined &&
    (state.usage.totalCostUnits ?? 0) >= config.limits.budgetLimit
  ) {
    return buildLimitResult(config, input, state, 'budget_reached');
  }

  return null;
}

/**
 * Execute a single tool call, transparently retrying when the registry
 * returns `{ status: 'error', error: { retryable: true } }`. Retries are
 * bounded by `config.toolRetryConfig` and are part of the SAME logical tool
 * call — they do not increment `state.toolCallCount` or `state.iteration`.
 *
 * Each retry attempt emits a `tool_retried` trace event before the attempt
 * fires (so observers see retry attempts even if all of them ultimately
 * fail). After the configured retries are exhausted, this returns the last
 * failed result and the caller propagates the existing `tool_failed` event
 * + tool-error handling unchanged.
 */
async function executeToolWithRetry(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  call: HarnessToolCall,
  context: HarnessToolExecutionContext,
): Promise<HarnessToolResult> {
  const tools = config.tools as HarnessToolRegistry;
  const { maxRetries, backoffMs } = config.toolRetryConfig;
  const maxAttempts = maxRetries + 1;

  let lastResult = await tools.execute(call, context);
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    if (lastResult.status !== 'error' || lastResult.error?.retryable !== true) {
      return lastResult;
    }

    const previousError = lastResult.error;
    const backoff = pickBackoff(backoffMs, attempt - 1);
    await emit(config, input, state, {
      type: 'tool_retried',
      call,
      attempt: attempt + 1,
      maxAttempts,
      backoffMs: backoff,
      previousError,
    });
    if (backoff > 0) {
      await sleep(backoff);
    }
    lastResult = await tools.execute(call, context);
  }

  return lastResult;
}

function pickBackoff(backoffMs: number[], retryIndex: number): number {
  if (backoffMs.length === 0) {
    return 0;
  }
  return backoffMs[Math.min(retryIndex, backoffMs.length - 1)] ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeClarifyFromToolResult(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  startedAt: number,
  result: HarnessToolResult,
): Promise<HarnessResult | null> {
  if (!config.hooks?.clarifyOnToolResult) {
    return null;
  }

  const clarification = await config.hooks.clarifyOnToolResult(
    result,
    executionState(input, state, startedAt, config),
  );
  const question = normalizeClarificationQuestion(clarification);
  if (!question) {
    return null;
  }

  const limitResult = await checkLimits(config, input, state, startedAt);
  if (limitResult) {
    return limitResult;
  }

  state.transcript.push({
    type: 'clarification_request',
    iteration: state.iteration,
    question,
  });
  await emit(config, input, state, {
    type: 'clarification_requested',
    question,
  });

  const toolEvidence = {
    callId: result.callId,
    toolName: result.toolName,
    status: result.status,
    reason: clarification?.reason,
    metadata: clarification?.metadata,
  };
  return buildResult(input, state, {
    outcome: 'needs_clarification',
    stopReason: 'clarification_required',
    assistantMessage: { text: question },
    continuation: createContinuation(config, input, 'clarification', {
      stopReason: 'clarification_required',
      question,
      toolEvidence,
      transcript: summarizeTranscript(state.transcript),
    }),
    metadata: { clarification: toolEvidence },
  });
}

function normalizeClarificationQuestion(
  clarification: HarnessToolEvidenceClarification | null | undefined,
): string | null {
  if (!clarification || typeof clarification.question !== 'string') {
    return null;
  }

  const question = clarification.question.trim();
  return question.length > 0 ? question : null;
}

async function buildLimitResult(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  stopReason: Extract<
    HarnessStopReason,
    | 'max_iterations_reached'
    | 'max_tool_calls_reached'
    | 'timeout_reached'
    | 'budget_reached'
    | 'redundant_tool_loop'
  >,
): Promise<HarnessResult> {
  await emit(config, input, state, { type: 'limit_reached', stopReason });
  const outcome = stopReason === 'redundant_tool_loop' ? 'failed' : 'deferred';
  return buildResult(input, state, {
    outcome,
    stopReason,
    continuation:
      outcome === 'deferred'
        ? createContinuation(config, input, 'deferred', {
            stopReason,
            transcript: summarizeTranscript(state.transcript),
            iteration: state.iteration,
            toolCallCount: state.toolCallCount,
          })
        : undefined,
  });
}

function buildResult(
  input: HarnessTurnInput,
  state: MutableState,
  partial: Pick<HarnessResult, 'outcome' | 'stopReason' | 'assistantMessage' | 'continuation' | 'metadata'>,
): HarnessResult {
  state.finalEventType = 'turn_finished';
  return {
    outcome: partial.outcome,
    stopReason: partial.stopReason,
    turnId: input.turnId,
    sessionId: input.sessionId,
    assistantMessage: partial.assistantMessage,
    continuation: partial.continuation,
    traceSummary: buildTraceSummary(state, Boolean(input.continuation || partial.continuation)),
    usage: { ...state.usage },
    metadata: partial.metadata,
  };
}

function buildTraceSummary(state: MutableState, hadContinuation: boolean): HarnessTraceSummary {
  return {
    iterationCount: state.iteration,
    toolCallCount: state.toolCallCount,
    hadContinuation,
    finalEventType: state.finalEventType,
  };
}

function executionState(
  input: HarnessTurnInput,
  state: MutableState,
  startedAt: number,
  config: NormalizedConfig,
): HarnessExecutionState {
  return {
    assistantId: input.assistantId,
    turnId: input.turnId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    userId: input.userId,
    threadId: input.threadId,
    iteration: state.iteration,
    toolCallCount: state.toolCallCount,
    elapsedMs: getElapsedMs(config, startedAt),
    input: {
      message: input.message,
      instructions: input.instructions,
    },
    transcript: state.transcript.slice(),
    modelCalls: state.modelCalls.slice(),
  };
}

function readModelId(output: HarnessModelOutput): string | undefined {
  if (output.type === 'invalid') {
    return undefined;
  }

  const metadata = output.metadata;
  if (!metadata) {
    return undefined;
  }

  const raw = metadata.modelId ?? metadata.model;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function createContinuation(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  type: HarnessContinuation['type'],
  state: Record<string, unknown>,
): HarnessContinuation {
  const timestamp = config.clock.nowIso();
  return {
    id: `${input.turnId}:${type}`,
    type,
    createdAt: timestamp,
    turnId: input.turnId,
    sessionId: input.sessionId,
    resumeToken: `${input.turnId}:${type}:${timestamp}`,
    state,
    metadata: {
      assistantId: input.assistantId,
      threadId: input.threadId,
    },
  };
}

function summarizeTranscript(transcript: HarnessTranscriptItem[]): Record<string, unknown> {
  return {
    steps: transcript.slice(-6).map((step) => {
      if (step.type === 'assistant_step') {
        return { type: step.type, outputType: step.outputType, text: step.text };
      }
      if (step.type === 'tool_result') {
        return {
          type: step.type,
          toolName: step.result.toolName,
          status: step.result.status,
        };
      }
      if (step.type === 'clarification_request') {
        return { type: step.type, question: step.question };
      }
      return { type: step.type, requestId: step.request.id, kind: step.request.kind };
    }),
  };
}

function toAssistantStep(iteration: number, output: HarnessModelOutput): HarnessAssistantThoughtStep {
  switch (output.type) {
    case 'final_answer':
      return { type: 'assistant_step', iteration, outputType: output.type, text: output.text, metadata: output.metadata };
    case 'clarification':
      return { type: 'assistant_step', iteration, outputType: output.type, text: output.question, metadata: output.metadata };
    case 'approval_request':
      return { type: 'assistant_step', iteration, outputType: output.type, text: output.request.summary, metadata: output.metadata };
    case 'refusal':
      return { type: 'assistant_step', iteration, outputType: output.type, text: output.reason, metadata: output.metadata };
    case 'invalid':
      return { type: 'assistant_step', iteration, outputType: output.type, text: output.reason, metadata: output.metadata };
    case 'tool_request':
      return { type: 'assistant_step', iteration, outputType: output.type, metadata: output.metadata };
  }
}

function accumulateUsage(target: HarnessAggregateUsage, usage?: { inputTokens?: number; outputTokens?: number; costUnits?: number; latencyMs?: number }): void {
  if (!usage) {
    return;
  }

  if (usage.inputTokens !== undefined) {
    target.totalInputTokens = (target.totalInputTokens ?? 0) + usage.inputTokens;
  }
  if (usage.outputTokens !== undefined) {
    target.totalOutputTokens = (target.totalOutputTokens ?? 0) + usage.outputTokens;
  }
  if (usage.costUnits !== undefined) {
    target.totalCostUnits = (target.totalCostUnits ?? 0) + usage.costUnits;
  }
  if (usage.latencyMs !== undefined) {
    target.totalLatencyMs = (target.totalLatencyMs ?? 0) + usage.latencyMs;
  }
}

function remainingBudget(config: NormalizedConfig, usage: HarnessAggregateUsage): number | undefined {
  if (config.limits.budgetLimit === undefined) {
    return undefined;
  }

  return Math.max(0, config.limits.budgetLimit - (usage.totalCostUnits ?? 0));
}

function getElapsedMs(config: NormalizedConfig, startedAt: number): number {
  return Math.max(0, config.clock.now() - startedAt);
}

function djb2Hash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = ((hash * 33) ^ s.charCodeAt(i)) | 0;
  return hash;
}

/**
 * Compute a stable signature for a tool result, used by the redundant-tool-loop
 * detector. Returns null when the result has no payload to compare — side-effect
 * tools that intentionally return nothing should NOT trigger loop detection
 * just because their empty results all hash identically.
 *
 * Wraps JSON.stringify in try/catch so non-serializable values (BigInt,
 * circular references) in structuredOutput cannot throw. A serialization
 * failure is treated as "no comparable signature" — the detector skips this
 * call rather than risk converting a successful tool execution into a
 * runtime_error via the outer catch.
 */
function computeToolResultSignature(result: HarnessToolResult): number | null {
  if (typeof result.output === 'string' && result.output.length > 0) {
    return djb2Hash(result.output);
  }
  if (result.structuredOutput !== undefined) {
    try {
      const serialized = JSON.stringify(result.structuredOutput);
      // JSON.stringify returns undefined for values that cannot be
      // serialized (e.g. plain `BigInt` at the root). Treat that as no
      // comparable signature too.
      if (typeof serialized !== 'string' || serialized.length === 0 || serialized === '{}') {
        return null;
      }
      return djb2Hash(serialized);
    } catch {
      return null;
    }
  }
  return null;
}

async function emit(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  partial: Record<string, unknown> & { type: HarnessTraceEvent['type'] },
): Promise<void> {
  if (!config.trace) {
    return;
  }

  const event = {
    timestamp: config.clock.nowIso(),
    assistantId: input.assistantId,
    turnId: input.turnId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    iteration: state.iteration,
    toolCallCount: state.toolCallCount,
    elapsedMs: undefined,
    metadata: input.metadata,
    ...partial,
  } as HarnessTraceEvent;

  state.finalEventType = event.type;
  await config.trace.emit(event);
}

async function emitFinishedSafely(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  result: HarnessResult,
): Promise<void> {
  try {
    if (!config.trace) {
      return;
    }

    await config.trace.emit({
      type: 'turn_finished',
      timestamp: config.clock.nowIso(),
      assistantId: input.assistantId,
      turnId: input.turnId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      iteration: state.iteration,
      toolCallCount: state.toolCallCount,
      elapsedMs: 0,
      metadata: input.metadata,
      outcome: result.outcome,
      stopReason: result.stopReason,
    });
    state.finalEventType = 'turn_finished';
    result.traceSummary.finalEventType = 'turn_finished';
  } catch {
    // swallow trace sink failures during finalization so runtime result survives
  }
}
