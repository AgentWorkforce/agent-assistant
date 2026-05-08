import type {
  HarnessAggregateUsage,
  HarnessApprovalRequest,
  HarnessAssistantThoughtStep,
  HarnessClock,
  HarnessConfig,
  HarnessContinuation,
  HarnessExecutionState,
  HarnessEvidenceDensityViolation,
  HarnessInvalidOutput,
  HarnessLimits,
  HarnessModelCallRecord,
  HarnessModelInput,
  HarnessModelOutput,
  HarnessResult,
  HarnessStopReason,
  HarnessStreamEvent,
  HarnessStreamSink,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolEvidenceClarification,
  HarnessToolExecutionContext,
  HarnessToolRegistry,
  HarnessToolResult,
  HarnessToolRetryConfig,
  HarnessRuntimePolicy,
  HarnessRuntimePolicyEvent,
  HarnessTraceEvent,
  HarnessTraceSummary,
  HarnessTranscriptItem,
  HarnessTurnInput,
  HarnessRuntime,
} from './types.js';
import { HarnessConfigError } from './types.js';
import { exceedsEvidenceBudget } from './claim-density.js';
import { createRuntimePolicy } from './runtime-policy/index.js';

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

type NormalizedConfig = Omit<
  HarnessConfig,
  'clock' | 'limits' | 'toolRetryConfig' | 'runtimePolicy'
> & {
  limits: Required<Pick<HarnessLimits, 'maxIterations' | 'maxToolCalls' | 'maxElapsedMs' | 'maxConsecutiveInvalidModelOutputs'>> & Pick<HarnessLimits, 'budgetLimit'>;
  clock: HarnessClock;
  toolRetryConfig: HarnessToolRetryConfig;
  runtimePolicy?: HarnessRuntimePolicy;
};

export function createHarness(config: HarnessConfig): HarnessRuntime {
  const normalized = normalizeConfig(config);

  return {
    async runTurn(input) {
      return runTurn(normalized, input);
    },
    runTurnStreaming(input) {
      return iterateTurnStream(normalized, input);
    },
  };
}

/**
 * Wraps {@link runTurn} with a per-call stream sink so callers can consume
 * `HarnessStreamEvent` values as the turn progresses. Trace emissions on
 * `config.trace` continue to fire in parallel — this is purely additive.
 *
 * Implementation: install a stream sink that pushes events into an
 * unbounded async queue, run the turn, and yield events as they arrive.
 * The final `turn_finished` event is emitted from this wrapper (not from
 * `runTurn` itself) so the iterable always closes with the result.
 */
function iterateTurnStream(
  config: NormalizedConfig,
  input: HarnessTurnInput,
): AsyncIterable<HarnessStreamEvent> {
  const queue = createAsyncQueue<HarnessStreamEvent>();
  const userSink = config.stream;
  const teeSink: HarnessStreamSink = {
    async emit(event) {
      queue.push(event);
      try {
        await userSink?.emit(event);
      } catch {
        // Mirror trace-sink behavior: swallow user-supplied sink failures so
        // the turn itself isn't disrupted by an observer fault.
      }
    },
  };

  const wrappedConfig: NormalizedConfig = { ...config, stream: teeSink };

  void runTurn(wrappedConfig, input)
    .then((result) => {
      queue.push({ type: 'turn_finished', result });
      queue.close();
    })
    .catch((error) => {
      queue.push({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      queue.close();
    });

  return queue;
}

interface AsyncQueue<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const buffer: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  return {
    push(value) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value, done: false });
        return;
      }
      buffer.push(value);
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter?.({ value: undefined as unknown as T, done: true });
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (buffer.length > 0) {
            const value = buffer.shift() as T;
            return Promise.resolve({ value, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<T>> {
          closed = true;
          while (waiters.length > 0) {
            const waiter = waiters.shift();
            waiter?.({ value: undefined as unknown as T, done: true });
          }
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        },
      };
    },
  };
}

async function emitStream(
  config: NormalizedConfig,
  event: HarnessStreamEvent,
): Promise<void> {
  if (!config.stream) return;
  try {
    await config.stream.emit(event);
  } catch {
    // Stream sink failures are non-fatal: the trace path is the source of
    // truth for correctness, the stream is purely a UX convenience.
  }
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
  const runtimePolicy = normalizeRuntimePolicy(config.runtimePolicy);

  return {
    ...config,
    clock: config.clock ?? defaultClock,
    limits,
    toolRetryConfig,
    runtimePolicy,
  };
}

function normalizeRuntimePolicy(
  runtimePolicy: HarnessConfig['runtimePolicy'],
): HarnessRuntimePolicy | undefined {
  if (!runtimePolicy) {
    return undefined;
  }

  if (isHarnessRuntimePolicy(runtimePolicy)) {
    return runtimePolicy;
  }

  return createRuntimePolicy(runtimePolicy);
}

function isHarnessRuntimePolicy(value: unknown): value is HarnessRuntimePolicy {
  return (
    typeof value === 'object' &&
    value !== null &&
    'beforeToolCall' in value &&
    typeof value.beforeToolCall === 'function' &&
    'afterToolResult' in value &&
    typeof value.afterToolResult === 'function' &&
    'sanitizeFinalOutput' in value &&
    typeof value.sanitizeFinalOutput === 'function' &&
    'finalizeTurn' in value &&
    typeof value.finalizeTurn === 'function' &&
    'reset' in value &&
    typeof value.reset === 'function'
  );
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
    config.runtimePolicy?.reset(input.turnId);
    const availableTools = config.tools
      ? (
          await config.tools.listAvailable({
            assistantId: input.assistantId,
            turnId: input.turnId,
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            userId: input.userId,
            allowedToolNames: input.allowedToolNames,
          })
        ).map((tool) => config.runtimePolicy?.wrapTool(tool) ?? tool)
      : [];

    await emit(config, input, state, { type: 'turn_started' });
    finalResult = buildCancelledResult(input, state);
    if (finalResult) {
      return finalResult;
    }

    for (let iteration = 1; ; iteration += 1) {
      state.iteration = iteration;

      finalResult = buildCancelledResult(input, state);
      if (finalResult) {
        return finalResult;
      }

      finalResult = await checkLimits(config, input, state, startedAt);
      if (finalResult) {
        return finalResult;
      }

      const visibleTranscript = await transformTranscriptSafely(
        config,
        input,
        state,
        startedAt,
      );

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
        transcript: visibleTranscript,
        availableTools,
        iteration,
        toolCallCount: state.toolCallCount,
        elapsedMs: getElapsedMs(config, startedAt),
        remainingBudget: remainingBudget(config, state.usage),
        signal: input.signal,
        metadata: input.metadata,
      };

      await emit(config, input, state, { type: 'model_step_started' });
      // When the model adapter exposes a native `streamStep` AND the caller
      // wired a stream sink, use streaming so users see token-by-token
      // text deltas. Otherwise fall back to batch nextStep.
      let streamingHandled = false;
      const output = config.model.streamStep && config.stream
        ? await config.model.streamStep(modelInput, (delta) => {
            streamingHandled = true;
            void emitStream(config, { type: 'text_delta', iteration, text: delta });
          })
        : await config.model.nextStep(modelInput);
      finalResult = buildCancelledResult(input, state);
      if (finalResult) {
        return finalResult;
      }
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
      await emitStream(config, {
        type: 'step_finished',
        iteration,
        outputType: output.type,
        usage: output.usage,
      });

      const assistantStep = toAssistantStep(iteration, output);
      state.transcript.push(assistantStep);

      switch (output.type) {
        case 'final_answer': {
          const sanitizedText = await applyRuntimePolicyToText(
            config,
            input,
            state,
            output.text,
            readModelId(output),
          );
          replaceLatestAssistantText(state, sanitizedText);
          if (!streamingHandled) {
            await emitStream(config, {
              type: 'text_delta',
              iteration,
              text: sanitizedText,
              outputType: 'final_answer',
            });
          }
          finalResult = buildAnswerResult(input, state, sanitizedText);
          return finalResult;
        }

        case 'clarification': {
          const sanitizedQuestion = await applyRuntimePolicyToText(
            config,
            input,
            state,
            output.question,
            readModelId(output),
          );
          replaceLatestAssistantText(state, sanitizedQuestion);
          const continuation = createContinuation(config, input, 'clarification', {
            stopReason: 'clarification_required',
            question: sanitizedQuestion,
            transcript: summarizeTranscript(state.transcript),
          });
          state.transcript.push({
            type: 'clarification_request',
            iteration,
            question: sanitizedQuestion,
          });
          await emit(config, input, state, {
            type: 'clarification_requested',
            question: sanitizedQuestion,
          });
          if (!streamingHandled) {
            await emitStream(config, {
              type: 'text_delta',
              iteration,
              text: sanitizedQuestion,
              outputType: 'clarification',
            });
          }
          finalResult = buildResult(input, state, {
            outcome: 'needs_clarification',
            stopReason: 'clarification_required',
            assistantMessage: { text: sanitizedQuestion },
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
                signal: input.signal,
              })
            : {
                request: output.request,
                continuation: createContinuation(config, input, 'approval', {
                  stopReason: 'approval_required',
                  request: output.request,
                  transcript: summarizeTranscript(state.transcript),
                }),
              };
          finalResult = buildCancelledResult(input, state);
          if (finalResult) {
            return finalResult;
          }
          await emit(config, input, state, {
            type: 'approval_requested',
            request: prepared.request,
          });
          const sanitizedSummary = await applyRuntimePolicyToText(
            config,
            input,
            state,
            prepared.request.summary,
            readModelId(output),
          );
          replaceLatestAssistantText(state, sanitizedSummary);
          if (!streamingHandled) {
            await emitStream(config, {
              type: 'text_delta',
              iteration,
              text: sanitizedSummary,
              outputType: 'approval_request',
            });
          }
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

          const batchResult = await executeToolBatch(
            config,
            input,
            state,
            startedAt,
            output.calls,
            availableTools,
            iteration,
          );
          if (batchResult) {
            finalResult = batchResult;
            return finalResult;
          }

          state.consecutiveInvalidOutputs = 0;
          continue;
        }

        case 'refusal': {
          const sanitizedReason = await applyRuntimePolicyToText(
            config,
            input,
            state,
            output.reason,
            readModelId(output),
          );
          replaceLatestAssistantText(state, sanitizedReason);
          if (!streamingHandled) {
            await emitStream(config, {
              type: 'text_delta',
              iteration,
              text: sanitizedReason,
              outputType: 'refusal',
            });
          }
          finalResult = buildResult(input, state, {
            outcome: 'failed',
            stopReason: 'model_refused',
            assistantMessage: { text: sanitizedReason },
          });
          return finalResult;
        }

        case 'invalid':
          finalResult = await handleInvalidOutput(config, input, state, startedAt, output);
          if (finalResult) {
            return finalResult;
          }
          continue;
      }
    }
  } catch (error) {
    if (isAbortError(error) || input.signal?.aborted) {
      finalResult = buildResult(input, state, {
        outcome: 'failed',
        stopReason: 'cancelled',
      });
      return finalResult;
    }
    finalResult = buildResult(input, state, {
      outcome: 'failed',
      stopReason: 'runtime_error',
      metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
    });
    return finalResult;
  } finally {
    if (finalResult) {
      await emitRuntimePolicyEvents(
        config,
        input,
        state,
        config.runtimePolicy?.finalizeTurn({
          turnId: input.turnId,
          outcome: finalResult.outcome,
          stopReason: finalResult.stopReason,
        }) ?? [],
      );
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
    config.runtimePolicy?.reset(input.turnId);
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

async function transformTranscriptSafely(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  startedAt: number,
): Promise<HarnessTranscriptItem[]> {
  const transcript = state.transcript.slice();
  if (!config.hooks?.transformTranscript) {
    return transcript;
  }

  try {
    const transformed = await config.hooks.transformTranscript(
      transcript,
      executionState(input, state, startedAt, config),
    );
    return Array.isArray(transformed) ? transformed.slice() : transcript;
  } catch (error) {
    console.warn('Harness transformTranscript hook failed; using untransformed transcript', error);
    return transcript;
  }
}

async function executeToolBatch(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  startedAt: number,
  calls: HarnessToolCall[],
  availableTools: HarnessToolDefinition[],
  iteration: number,
): Promise<HarnessResult | null> {
  const mode = resolveToolBatchMode(calls, availableTools);
  const toolDefinitions = new Map(availableTools.map((tool) => [tool.name, tool]));
  await emit(config, input, state, {
    type: 'tool_batch_started',
    mode,
    callCount: calls.length,
  });

  const results =
    mode === 'parallel'
      ? await executeParallelToolBatch(config, input, state, calls, toolDefinitions, iteration)
      : await executeSequentialToolBatch(config, input, state, calls, toolDefinitions, iteration);

  const cancelled = buildCancelledResult(input, state);
  if (cancelled) {
    return cancelled;
  }

  if (
    results.length > 0 &&
    results.every((result) => result.status === 'success' && result.terminate === true)
  ) {
    for (const result of results) {
      accumulateUsage(state.usage, result.usage);
      state.transcript.push({ type: 'tool_result', iteration, result });
      await emit(config, input, state, { type: 'tool_finished', result });
      recordToolResultSignature(state, result);
    }

    const text = await applyRuntimePolicyToText(
      config,
      input,
      state,
      results.map(readTerminatingToolText).join(''),
    );
    state.transcript.push({
      type: 'assistant_step',
      iteration,
      outputType: 'final_answer',
      text,
    });
    return buildAnswerResult(input, state, text);
  }

  for (const result of results) {
    const processed = await processToolResult(
      config,
      input,
      state,
      startedAt,
      iteration,
      result,
    );
    if (processed) {
      return processed;
    }
  }

  return null;
}

function resolveToolBatchMode(
  calls: HarnessToolCall[],
  availableTools: HarnessToolDefinition[],
): 'sequential' | 'parallel' {
  const definitions = new Map(availableTools.map((tool) => [tool.name, tool]));
  return calls.every((call) => definitions.get(call.name)?.executionMode === 'parallel')
    ? 'parallel'
    : 'sequential';
}

async function executeSequentialToolBatch(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  calls: HarnessToolCall[],
  toolDefinitions: Map<string, HarnessToolDefinition>,
  iteration: number,
): Promise<HarnessToolResult[]> {
  const results: HarnessToolResult[] = [];
  for (const [index, call] of calls.entries()) {
    results.push(
      await executeSingleToolCall(
        config,
        input,
        state,
        call,
        toolDefinitions.get(call.name),
        iteration,
        index,
      ),
    );
    if (input.signal?.aborted) {
      break;
    }
  }
  return results;
}

async function executeParallelToolBatch(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  calls: HarnessToolCall[],
  toolDefinitions: Map<string, HarnessToolDefinition>,
  iteration: number,
): Promise<HarnessToolResult[]> {
  const completed: HarnessToolResult[] = [];
  const tasks = calls.map(async (call, index) => {
    const result = await executeSingleToolCall(
      config,
      input,
      state,
      call,
      toolDefinitions.get(call.name),
      iteration,
      index,
    );
    completed.push(result);
  });

  await Promise.all(tasks);
  return completed;
}

async function executeSingleToolCall(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  call: HarnessToolCall,
  tool: HarnessToolDefinition | undefined,
  iteration: number,
  index: number,
): Promise<HarnessToolResult> {
  const decision = config.runtimePolicy?.beforeToolCall({
    turnId: input.turnId,
    call,
    tool,
    toolCallCount: state.toolCallCount,
    maxToolCalls: config.limits.maxToolCalls,
  });
  if (decision && decision.action !== 'allow') {
    await emitRuntimePolicyEvents(config, input, state, decision.events);
    return decision.result;
  }

  const nextToolCallCount = state.toolCallCount + 1;
  state.toolCallCount = nextToolCallCount;
  state.usage.toolCalls = nextToolCallCount;
  await emit(config, input, state, { type: 'tool_started', call });
  await emitStream(config, { type: 'tool_started', iteration, call });
  const result = await executeToolWithRetry(config, input, state, call, {
    assistantId: input.assistantId,
    turnId: input.turnId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    userId: input.userId,
    threadId: input.threadId,
    iteration,
    toolCallIndex: index,
    signal: input.signal,
  });
  await emitRuntimePolicyEvents(
    config,
    input,
    state,
    config.runtimePolicy?.afterToolResult({
      turnId: input.turnId,
      call,
      tool,
      result,
    }) ?? [],
  );
  return result;
}

async function processToolResult(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  startedAt: number,
  iteration: number,
  result: HarnessToolResult,
): Promise<HarnessResult | null> {
  accumulateUsage(state.usage, result.usage);
  state.transcript.push({ type: 'tool_result', iteration, result });

  if (result.status === 'error') {
    state.recentToolResultHashes = [];
    await emit(config, input, state, { type: 'tool_failed', result });
    await emitStream(config, { type: 'tool_failed', iteration, result });
    await config.hooks?.onToolError?.(result, executionState(input, state, startedAt, config));
    const clarification = await maybeClarifyFromToolResult(config, input, state, startedAt, result);
    if (clarification) {
      return clarification;
    }
    if (result.error?.retryable !== true) {
      return buildResult(input, state, {
        outcome: 'failed',
        stopReason: 'tool_error_unrecoverable',
        metadata: { toolName: result.toolName, code: result.error?.code },
      });
    }
  } else {
    await emit(config, input, state, { type: 'tool_finished', result });
    await emitStream(config, { type: 'tool_finished', iteration, result });
    const clarification = await maybeClarifyFromToolResult(config, input, state, startedAt, result);
    if (clarification) {
      return clarification;
    }
    if (recordToolResultSignature(state, result)) {
      const limit = await buildLimitResult(config, input, state, 'redundant_tool_loop');
      return limit;
    }
  }

  return checkLimits(config, input, state, startedAt);
}

function recordToolResultSignature(state: MutableState, result: HarnessToolResult): boolean {
  const runtimePolicyMeta = result.metadata?.runtimePolicy;
  if (
    typeof runtimePolicyMeta === 'object' &&
    runtimePolicyMeta !== null &&
    'synthetic' in runtimePolicyMeta &&
    runtimePolicyMeta.synthetic === true
  ) {
    return false;
  }

  const signature = computeToolResultSignature(result);
  if (signature === null) {
    return false;
  }

  state.recentToolResultHashes ??= [];
  state.recentToolResultHashes.push({ toolName: result.toolName, outputHash: signature });
  if (state.recentToolResultHashes.length > 5) state.recentToolResultHashes.shift();

  const lastThree = state.recentToolResultHashes.slice(-3);
  const [first] = lastThree;
  return Boolean(
    first &&
      lastThree.length === 3 &&
      lastThree.every(
        (entry) => entry.toolName === first.toolName && entry.outputHash === first.outputHash,
      ),
  );
}

function readTerminatingToolText(result: HarnessToolResult): string {
  if (typeof result.output === 'string') {
    return result.output;
  }
  const structured = result.structuredOutput;
  if (typeof structured?.text === 'string') {
    return structured.text;
  }
  if (typeof structured?.message === 'string') {
    return structured.message;
  }
  return '';
}

/**
 * Execute a single tool call, transparently retrying when the registry
 * returns `{ status: 'error', error: { retryable: true } }`. Retries are
 * bounded by `config.toolRetryConfig` and are part of the SAME logical tool
 * call — they do not increment `state.toolCallCount` or `state.iteration`.
 *
 * Each retry attempt emits a `tool_retried` trace event before the attempt
 * fires (so observers see retry attempts even if all of them ultimately
 * fail). Usage data from failed intermediate attempts is accumulated into
 * `state.usage` before retrying, so budget enforcement sees the true total
 * cost. After the configured retries are exhausted, this returns the last
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
  if (context.signal?.aborted) {
    return lastResult;
  }
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    if (lastResult.status !== 'error' || lastResult.error?.retryable !== true) {
      return lastResult;
    }

    // Accumulate usage from the failed intermediate attempt so budget
    // enforcement sees the true total cost including retries.
    accumulateUsage(state.usage, lastResult.usage);

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
    if (context.signal?.aborted) {
      return lastResult;
    }
    lastResult = await tools.execute(call, context);
    if (context.signal?.aborted) {
      return lastResult;
    }
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

function buildAnswerResult(
  input: HarnessTurnInput,
  state: MutableState,
  text: string,
): HarnessResult {
  const evidenceDensity = buildEvidenceDensityViolation(state, text);
  if (evidenceDensity) {
    return buildResult(input, state, {
      outcome: 'failed',
      stopReason: 'evidence_density_violation',
      assistantMessage: { text },
      metadata: { evidenceDensity },
    });
  }

  return buildResult(input, state, {
    outcome: 'completed',
    stopReason: 'answer_finalized',
    assistantMessage: { text },
  });
}

async function applyRuntimePolicyToText(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  text: string,
  modelId?: string,
): Promise<string> {
  if (!config.runtimePolicy) {
    return text;
  }

  const sanitized = config.runtimePolicy.sanitizeFinalOutput({
    turnId: input.turnId,
    text,
    modelId,
  });
  await emitRuntimePolicyEvents(config, input, state, sanitized.events);
  return sanitized.text;
}

function replaceLatestAssistantText(state: MutableState, text: string): void {
  const latest = state.transcript[state.transcript.length - 1];
  if (latest?.type === 'assistant_step') {
    latest.text = text;
  }
}

function buildEvidenceDensityViolation(
  state: MutableState,
  assistantText: string,
): HarnessEvidenceDensityViolation | null {
  const toolCalls = state.transcript
    .filter((item): item is Extract<HarnessTranscriptItem, { type: 'tool_result' }> =>
      item.type === 'tool_result',
    )
    .map((item) => ({
      name: item.result.toolName,
      outputChars: toolResultOutputChars(item.result),
    }));

  const verdict = exceedsEvidenceBudget({ toolCalls, assistantText });
  if (!verdict.exceeds || !verdict.detail) {
    return null;
  }

  const claimsCount = verdict.detail.claimMarkers.length;
  const evidenceUnits = verdict.detail.outputChars;
  return {
    claimsCount,
    evidenceUnits,
    ratio: claimsCount / Math.max(1, evidenceUnits),
    violatingClaims: verdict.detail.claimMarkers.map((marker) => ({
      text: marker,
      offset: Math.max(0, assistantText.indexOf(marker)),
      category: verdict.reason,
    })),
  };
}

function toolResultOutputChars(result: HarnessToolResult): number {
  if (typeof result.output === 'string') {
    return result.output.length;
  }
  if (result.structuredOutput !== undefined) {
    try {
      return JSON.stringify(result.structuredOutput)?.length ?? 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function buildCancelledResult(
  input: HarnessTurnInput,
  state: MutableState,
): HarnessResult | null {
  if (!input.signal?.aborted) {
    return null;
  }

  return buildResult(input, state, {
    outcome: 'failed',
    stopReason: 'cancelled',
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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
  try {
    await config.trace.emit(event);
  } catch {
    // Observability failures should not change turn execution semantics.
  }
}

async function emitRuntimePolicyEvents(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  events: HarnessRuntimePolicyEvent[],
): Promise<void> {
  for (const event of events) {
    await emit(config, input, state, {
      type: event.kind,
      reason: event.reason,
      ...(event.toolName ? { toolName: event.toolName } : {}),
      ...(event.metadata ? { metadata: event.metadata } : {}),
    });
  }
}

async function emitFinishedSafely(
  config: NormalizedConfig,
  input: HarnessTurnInput,
  state: MutableState,
  result: HarnessResult,
): Promise<void> {
  if (!config.trace) {
    return;
  }

  try {
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
  } catch {
    // swallow trace sink failures during finalization so runtime result survives
  }

  state.finalEventType = 'turn_finished';
  result.traceSummary.finalEventType = 'turn_finished';

  try {
    await config.trace.flush?.();
  } catch {
    // flush failures are observational only
  }
}
