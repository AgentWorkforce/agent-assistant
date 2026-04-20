import { HarnessConfigError } from './types.js';
const DEFAULT_LIMITS = {
    maxIterations: 6,
    maxToolCalls: 8,
    maxElapsedMs: 30_000,
    maxConsecutiveInvalidModelOutputs: 2,
};
const defaultClock = {
    now: () => Date.now(),
    nowIso: () => new Date().toISOString(),
};
export function createHarness(config) {
    const normalized = normalizeConfig(config);
    return {
        async runTurn(input) {
            return runTurn(normalized, input);
        },
    };
}
function normalizeConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new HarnessConfigError('Harness config is required');
    }
    if (!config.model || typeof config.model.nextStep !== 'function') {
        throw new HarnessConfigError("Harness config requires a valid 'model' adapter");
    }
    if (config.tools) {
        if (typeof config.tools.listAvailable !== 'function' ||
            typeof config.tools.execute !== 'function') {
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
        maxConsecutiveInvalidModelOutputs: config.limits?.maxConsecutiveInvalidModelOutputs ??
            DEFAULT_LIMITS.maxConsecutiveInvalidModelOutputs,
    };
    validatePositiveInteger(limits.maxIterations, 'limits.maxIterations');
    validatePositiveInteger(limits.maxToolCalls, 'limits.maxToolCalls');
    validatePositiveInteger(limits.maxElapsedMs, 'limits.maxElapsedMs');
    validatePositiveInteger(limits.maxConsecutiveInvalidModelOutputs, 'limits.maxConsecutiveInvalidModelOutputs');
    if (limits.budgetLimit !== undefined && (!Number.isFinite(limits.budgetLimit) || limits.budgetLimit < 0)) {
        throw new HarnessConfigError('limits.budgetLimit must be a finite number >= 0');
    }
    return {
        ...config,
        clock: config.clock ?? defaultClock,
        limits,
    };
}
function validatePositiveInteger(value, label) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new HarnessConfigError(`${label} must be an integer greater than 0`);
    }
}
async function runTurn(config, input) {
    const startedAt = config.clock.now();
    const state = {
        iteration: 0,
        toolCallCount: 0,
        transcript: [],
        modelCalls: [],
        usage: {
            modelCalls: 0,
            toolCalls: 0,
        },
        consecutiveInvalidOutputs: 0,
        finalEventType: 'turn_started',
    };
    let finalResult = null;
    try {
        const availableTools = config.tools
            ? await config.tools.listAvailable({
                assistantId: input.assistantId,
                turnId: input.turnId,
                sessionId: input.sessionId,
                userId: input.userId,
                allowedToolNames: input.allowedToolNames,
            })
            : [];
        await emit(config, input, state, { type: 'turn_started' });
        for (let iteration = 1;; iteration += 1) {
            state.iteration = iteration;
            finalResult = await checkLimits(config, input, state, startedAt);
            if (finalResult) {
                return finalResult;
            }
            const modelInput = {
                assistantId: input.assistantId,
                turnId: input.turnId,
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
                    const unavailableCall = output.calls.find((call) => !availableTools.some((tool) => tool.name === call.name));
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
                        const result = await config.tools.execute(call, {
                            assistantId: input.assistantId,
                            turnId: input.turnId,
                            sessionId: input.sessionId,
                            userId: input.userId,
                            threadId: input.threadId,
                            iteration,
                            toolCallIndex: index,
                        });
                        accumulateUsage(state.usage, result.usage);
                        state.transcript.push({ type: 'tool_result', iteration, result });
                        if (result.status === 'error') {
                            await emit(config, input, state, { type: 'tool_failed', result });
                            await config.hooks?.onToolError?.(result, executionState(input, state, startedAt, config));
                            if (result.error?.retryable !== true) {
                                finalResult = buildResult(input, state, {
                                    outcome: 'failed',
                                    stopReason: 'tool_error_unrecoverable',
                                    metadata: { toolName: result.toolName, code: result.error?.code },
                                });
                                return finalResult;
                            }
                        }
                        else {
                            await emit(config, input, state, { type: 'tool_finished', result });
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
    }
    catch (error) {
        finalResult = buildResult(input, state, {
            outcome: 'failed',
            stopReason: 'runtime_error',
            metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
        });
        return finalResult;
    }
    finally {
        if (finalResult) {
            await emitFinishedSafely(config, input, state, finalResult);
            try {
                await config.hooks?.onTurnFinished?.(finalResult, executionState(input, state, startedAt, config));
            }
            catch (error) {
                console.error('Harness onTurnFinished hook failed', error);
            }
        }
    }
}
async function handleInvalidOutput(config, input, state, startedAt, output) {
    state.consecutiveInvalidOutputs += 1;
    await config.hooks?.onInvalidModelOutput?.(output, executionState(input, state, startedAt, config));
    if (state.consecutiveInvalidOutputs >= config.limits.maxConsecutiveInvalidModelOutputs) {
        return buildResult(input, state, {
            outcome: 'failed',
            stopReason: 'model_invalid_response',
            metadata: { reason: output.reason },
        });
    }
    return checkLimits(config, input, state, startedAt);
}
async function checkLimits(config, input, state, startedAt) {
    if (state.iteration > config.limits.maxIterations) {
        return buildLimitResult(config, input, state, 'max_iterations_reached');
    }
    if (state.toolCallCount >= config.limits.maxToolCalls) {
        return buildLimitResult(config, input, state, 'max_tool_calls_reached');
    }
    if (getElapsedMs(config, startedAt) >= config.limits.maxElapsedMs) {
        return buildLimitResult(config, input, state, 'timeout_reached');
    }
    if (config.limits.budgetLimit !== undefined &&
        (state.usage.totalCostUnits ?? 0) >= config.limits.budgetLimit) {
        return buildLimitResult(config, input, state, 'budget_reached');
    }
    return null;
}
async function buildLimitResult(config, input, state, stopReason) {
    await emit(config, input, state, { type: 'limit_reached', stopReason });
    return buildResult(input, state, {
        outcome: 'deferred',
        stopReason,
        continuation: createContinuation(config, input, 'deferred', {
            stopReason,
            transcript: summarizeTranscript(state.transcript),
            iteration: state.iteration,
            toolCallCount: state.toolCallCount,
        }),
    });
}
function buildResult(input, state, partial) {
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
function buildTraceSummary(state, hadContinuation) {
    return {
        iterationCount: state.iteration,
        toolCallCount: state.toolCallCount,
        hadContinuation,
        finalEventType: state.finalEventType,
    };
}
function executionState(input, state, startedAt, config) {
    return {
        assistantId: input.assistantId,
        turnId: input.turnId,
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
function readModelId(output) {
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
function createContinuation(config, input, type, state) {
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
function summarizeTranscript(transcript) {
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
function toAssistantStep(iteration, output) {
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
            return { type: 'assistant_step', iteration, outputType: output.type, text: output.reason };
        case 'tool_request':
            return { type: 'assistant_step', iteration, outputType: output.type, metadata: output.metadata };
    }
}
function accumulateUsage(target, usage) {
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
function remainingBudget(config, usage) {
    if (config.limits.budgetLimit === undefined) {
        return undefined;
    }
    return Math.max(0, config.limits.budgetLimit - (usage.totalCostUnits ?? 0));
}
function getElapsedMs(config, startedAt) {
    return Math.max(0, config.clock.now() - startedAt);
}
async function emit(config, input, state, partial) {
    if (!config.trace) {
        return;
    }
    const event = {
        timestamp: config.clock.nowIso(),
        assistantId: input.assistantId,
        turnId: input.turnId,
        sessionId: input.sessionId,
        iteration: state.iteration,
        toolCallCount: state.toolCallCount,
        elapsedMs: undefined,
        metadata: input.metadata,
        ...partial,
    };
    state.finalEventType = event.type;
    await config.trace.emit(event);
}
async function emitFinishedSafely(config, input, state, result) {
    try {
        if (!config.trace) {
            return;
        }
        await config.trace.emit({
            type: 'turn_finished',
            timestamp: config.clock.nowIso(),
            assistantId: input.assistantId,
            turnId: input.turnId,
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
    }
    catch {
        // swallow trace sink failures during finalization so runtime result survives
    }
}
