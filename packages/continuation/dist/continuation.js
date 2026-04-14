import { ContinuationAlreadyTerminalError, ContinuationError, ContinuationExpiredError, ContinuationInvalidInputError, ContinuationNotFoundError, ContinuationTriggerMismatchError, } from './types.js';
// ─── Resumable harness outcomes ───────────────────────────────────────────────
const RESUMABLE_OUTCOMES = new Set([
    'needs_clarification',
    'awaiting_approval',
    'deferred',
]);
const TERMINAL_STATUSES = new Set([
    'completed',
    'cancelled',
    'expired',
    'superseded',
    'failed',
]);
// ─── Factory ──────────────────────────────────────────────────────────────────
export function createContinuationRuntime(config) {
    const resolved = resolveConfig(config);
    return {
        create: (input) => createContinuation(resolved, input),
        resume: (input) => resumeContinuation(resolved, input),
        stop: (input) => stopContinuation(resolved, input),
        get: ({ continuationId }) => resolved.store.get(continuationId),
    };
}
// ─── Config normalization ─────────────────────────────────────────────────────
function resolveConfig(config) {
    return {
        ...config,
        clock: config.clock ?? defaultClock(),
        defaults: {
            clarificationTtlMs: config.defaults?.clarificationTtlMs ?? 3_600_000,
            approvalTtlMs: config.defaults?.approvalTtlMs ?? 86_400_000,
            deferredTtlMs: config.defaults?.deferredTtlMs ?? 3_600_000,
            scheduledWakeTtlMs: config.defaults?.scheduledWakeTtlMs ?? 3_600_000,
            maxResumeAttempts: config.defaults?.maxResumeAttempts ?? 3,
        },
    };
}
function defaultClock() {
    return {
        nowMs: () => Date.now(),
        nowIso: () => new Date().toISOString(),
    };
}
// ─── ID generation ────────────────────────────────────────────────────────────
function generateContinuationId(originTurnId, nowMs) {
    return `cont_${originTurnId}_${nowMs}`;
}
function generateResumedTurnId(continuationId, attemptNumber) {
    return `${continuationId}:resume:${attemptNumber}`;
}
// ─── Outcome classification ───────────────────────────────────────────────────
function classifyOutcome(outcome) {
    if (outcome === 'needs_clarification' ||
        outcome === 'awaiting_approval' ||
        outcome === 'deferred') {
        return outcome;
    }
    return null;
}
// ─── Wait condition derivation ────────────────────────────────────────────────
function deriveWaitCondition(outcome, input) {
    switch (outcome) {
        case 'needs_clarification':
            return { type: 'user_reply' };
        case 'awaiting_approval': {
            const approvalId = input.harnessResult.continuation?.state?.['approvalId'] ??
                input.metadata?.['approvalId'];
            if (approvalId === undefined || approvalId === null || approvalId === '') {
                throw new ContinuationInvalidInputError('awaiting_approval continuation requires an approvalId in continuation.state or metadata');
            }
            return { type: 'approval_resolution', approvalId };
        }
        case 'deferred': {
            const useScheduledWake = Boolean(input.metadata?.['scheduledWake']);
            if (useScheduledWake) {
                return { type: 'scheduled_wake' };
            }
            const operationId = input.harnessResult.continuation?.state?.['operationId'] ??
                input.metadata?.['operationId'];
            if (operationId === undefined || operationId === null || operationId === '') {
                throw new ContinuationInvalidInputError('deferred continuation requires an operationId (in continuation.state or metadata) or scheduledWake=true in metadata');
            }
            return { type: 'external_result', operationId };
        }
    }
}
// ─── TTL derivation ───────────────────────────────────────────────────────────
function deriveTtlMs(outcome, waitFor, defaults) {
    switch (outcome) {
        case 'needs_clarification':
            return defaults.clarificationTtlMs;
        case 'awaiting_approval':
            return defaults.approvalTtlMs;
        case 'deferred':
            return waitFor.type === 'scheduled_wake' ? defaults.scheduledWakeTtlMs : defaults.deferredTtlMs;
    }
}
// ─── Bounds construction ──────────────────────────────────────────────────────
function buildBounds(outcome, waitFor, clock, defaults, overrides) {
    const ttlMs = deriveTtlMs(outcome, waitFor, defaults);
    const expiresAt = overrides?.expiresAt ?? new Date(clock.nowMs() + ttlMs).toISOString();
    const maxResumeAttempts = overrides?.maxResumeAttempts ?? defaults.maxResumeAttempts;
    const resumeAttempts = overrides?.resumeAttempts ?? 0;
    if (new Date(expiresAt).getTime() <= clock.nowMs()) {
        throw new ContinuationInvalidInputError('bounds.expiresAt must be in the future');
    }
    if (maxResumeAttempts < 1) {
        throw new ContinuationInvalidInputError('bounds.maxResumeAttempts must be >= 1');
    }
    if (resumeAttempts < 0) {
        throw new ContinuationInvalidInputError('bounds.resumeAttempts must be >= 0');
    }
    return { expiresAt, maxResumeAttempts, resumeAttempts };
}
// ─── Trace helpers ────────────────────────────────────────────────────────────
function emitTrace(config, event) {
    config.trace?.emit(event);
}
// ─── create ───────────────────────────────────────────────────────────────────
async function createContinuation(config, input) {
    const { harnessResult } = input;
    const outcome = classifyOutcome(harnessResult.outcome);
    if (outcome === null) {
        emitTrace(config, {
            type: 'continuation_creation_rejected',
            assistantId: input.assistantId,
            sessionId: input.sessionId,
            originTurnId: input.originTurnId,
            reason: `non-resumable harness outcome: ${harnessResult.outcome}`,
            timestamp: config.clock.nowIso(),
        });
        throw new ContinuationInvalidInputError(`Cannot create a continuation from non-resumable harness outcome: ${harnessResult.outcome}`);
    }
    if (harnessResult.continuation === undefined || harnessResult.continuation === null) {
        emitTrace(config, {
            type: 'continuation_creation_rejected',
            assistantId: input.assistantId,
            sessionId: input.sessionId,
            originTurnId: input.originTurnId,
            reason: 'harness result has no continuation payload',
            timestamp: config.clock.nowIso(),
        });
        throw new ContinuationInvalidInputError('Cannot create a continuation: harness result has no continuation payload');
    }
    const waitFor = deriveWaitCondition(outcome, input);
    const now = config.clock.nowIso();
    const nowMs = config.clock.nowMs();
    const bounds = buildBounds(outcome, waitFor, config.clock, config.defaults, input.bounds);
    const deliveryStatus = config.delivery !== undefined ? 'pending_delivery' : 'not_applicable';
    const delivery = {
        target: input.delivery,
        status: deliveryStatus,
    };
    const origin = {
        turnId: input.originTurnId,
        outcome,
        stopReason: harnessResult.stopReason,
        createdAt: now,
    };
    const id = generateContinuationId(input.originTurnId, nowMs);
    const record = {
        id,
        assistantId: input.assistantId,
        sessionId: input.sessionId,
        threadId: input.threadId,
        userId: input.userId,
        origin,
        status: 'pending',
        waitFor,
        continuation: harnessResult.continuation,
        delivery,
        bounds,
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata,
    };
    await config.store.put(record);
    // Schedule wake if applicable
    let scheduledWakeId;
    if (waitFor.type === 'scheduled_wake' && config.scheduler !== undefined) {
        const result = await config.scheduler.scheduleWake({
            continuationId: id,
            wakeAtMs: new Date(bounds.expiresAt).getTime(),
        });
        scheduledWakeId = result.wakeUpId;
        // Persist the wakeUpId on the record's waitFor
        const updatedRecord = {
            ...record,
            waitFor: { type: 'scheduled_wake', wakeUpId: scheduledWakeId },
            updatedAt: config.clock.nowIso(),
        };
        await config.store.put(updatedRecord);
        emitTrace(config, {
            type: 'continuation_created',
            continuationId: id,
            assistantId: input.assistantId,
            sessionId: input.sessionId,
            originTurnId: input.originTurnId,
            outcome,
            waitFor: waitFor.type,
            status: 'pending',
            timestamp: config.clock.nowIso(),
        });
        return { continuation: updatedRecord, scheduledWakeId };
    }
    emitTrace(config, {
        type: 'continuation_created',
        continuationId: id,
        assistantId: input.assistantId,
        sessionId: input.sessionId,
        originTurnId: input.originTurnId,
        outcome,
        waitFor: waitFor.type,
        status: 'pending',
        timestamp: config.clock.nowIso(),
    });
    return { continuation: record };
}
// ─── Trigger validation ───────────────────────────────────────────────────────
function validateTrigger(record, trigger) {
    if (trigger.type !== record.waitFor.type) {
        throw new ContinuationTriggerMismatchError(record.id, record.waitFor.type, trigger.type);
    }
    // Correlation checks
    if (trigger.type === 'approval_resolution' && record.waitFor.type === 'approval_resolution') {
        if (trigger.approvalId !== record.waitFor.approvalId) {
            throw new ContinuationTriggerMismatchError(record.id, `approval_resolution(approvalId=${record.waitFor.approvalId})`, `approval_resolution(approvalId=${trigger.approvalId})`);
        }
    }
    if (trigger.type === 'external_result' && record.waitFor.type === 'external_result') {
        if (trigger.operationId !== record.waitFor.operationId) {
            throw new ContinuationTriggerMismatchError(record.id, `external_result(operationId=${record.waitFor.operationId})`, `external_result(operationId=${trigger.operationId})`);
        }
    }
}
// ─── Terminal status derivation ───────────────────────────────────────────────
function terminalStatusForReason(reason) {
    switch (reason) {
        case 'completed':
            return 'completed';
        case 'superseded_by_newer_turn':
            return 'superseded';
        case 'expired_ttl':
            return 'expired';
        case 'cancelled_by_user':
        case 'cancelled_by_product':
        case 'approval_denied':
            return 'cancelled';
        default:
            return 'failed';
    }
}
function deliveryStatusForTerminalReason(reason, currentDelivery) {
    if (currentDelivery.status === 'not_applicable')
        return 'not_applicable';
    if (currentDelivery.status === 'delivered')
        return 'delivered';
    switch (reason) {
        case 'superseded_by_newer_turn':
            return 'suppressed_superseded';
        case 'expired_ttl':
            return 'suppressed_expired';
        case 'session_no_longer_deliverable':
            return 'suppressed_session_reengaged';
        case 'delivery_failed':
            return 'delivery_failed';
        default:
            return currentDelivery.status;
    }
}
// ─── resume ───────────────────────────────────────────────────────────────────
async function resumeContinuation(config, input) {
    const { continuationId, trigger } = input;
    const now = config.clock.nowIso();
    const nowMs = config.clock.nowMs();
    emitTrace(config, {
        type: 'continuation_resume_requested',
        continuationId,
        assistantId: '',
        originTurnId: '',
        triggerType: trigger.type,
        status: 'pending',
        timestamp: now,
    });
    // 1. Load record
    const record = await config.store.get(continuationId);
    if (record === null) {
        throw new ContinuationNotFoundError(continuationId);
    }
    // 2. Check already terminal or in-progress
    if (TERMINAL_STATUSES.has(record.status) || record.status === 'resuming') {
        emitTrace(config, {
            type: 'continuation_resume_rejected',
            continuationId,
            assistantId: record.assistantId,
            sessionId: record.sessionId,
            originTurnId: record.origin.turnId,
            reason: `already terminal or in progress: ${record.status}`,
            timestamp: now,
        });
        throw new ContinuationAlreadyTerminalError(continuationId, record.status);
    }
    // 3. Check expiry
    if (nowMs >= new Date(record.bounds.expiresAt).getTime()) {
        const expired = {
            ...record,
            status: 'expired',
            terminalReason: 'expired_ttl',
            delivery: {
                ...record.delivery,
                status: record.delivery.status === 'not_applicable' ? 'not_applicable' : 'suppressed_expired',
            },
            updatedAt: now,
        };
        await config.store.put(expired);
        emitTrace(config, {
            type: 'continuation_expired',
            continuationId,
            assistantId: record.assistantId,
            sessionId: record.sessionId,
            originTurnId: record.origin.turnId,
            timestamp: now,
        });
        emitTrace(config, {
            type: 'continuation_terminated',
            continuationId,
            assistantId: record.assistantId,
            sessionId: record.sessionId,
            originTurnId: record.origin.turnId,
            status: 'expired',
            terminalReason: 'expired_ttl',
            timestamp: now,
        });
        throw new ContinuationExpiredError(continuationId, record.bounds.expiresAt);
    }
    // 4. Check max resume attempts
    if (record.bounds.resumeAttempts >= record.bounds.maxResumeAttempts) {
        const exhausted = {
            ...record,
            status: 'failed',
            terminalReason: 'max_resume_attempts_reached',
            updatedAt: now,
        };
        await config.store.put(exhausted);
        emitTrace(config, {
            type: 'continuation_terminated',
            continuationId,
            assistantId: record.assistantId,
            sessionId: record.sessionId,
            originTurnId: record.origin.turnId,
            status: 'failed',
            terminalReason: 'max_resume_attempts_reached',
            timestamp: now,
        });
        throw new ContinuationError(`Continuation ${continuationId} has exhausted max resume attempts (${record.bounds.maxResumeAttempts})`, continuationId);
    }
    // 5 & 6. Validate trigger type and correlations
    try {
        validateTrigger(record, trigger);
    }
    catch (err) {
        emitTrace(config, {
            type: 'continuation_resume_rejected',
            continuationId,
            assistantId: record.assistantId,
            sessionId: record.sessionId,
            originTurnId: record.origin.turnId,
            reason: err instanceof Error ? err.message : String(err),
            timestamp: now,
        });
        throw err;
    }
    // Handle approval denied — terminal without harness call
    if (trigger.type === 'approval_resolution' && trigger.decision === 'denied') {
        const denied = {
            ...record,
            status: 'cancelled',
            terminalReason: 'approval_denied',
            delivery: {
                ...record.delivery,
                status: record.delivery.status === 'not_applicable' ? 'not_applicable' : record.delivery.status,
            },
            updatedAt: now,
        };
        await config.store.put(denied);
        emitTrace(config, {
            type: 'continuation_terminated',
            continuationId,
            assistantId: record.assistantId,
            sessionId: record.sessionId,
            originTurnId: record.origin.turnId,
            status: 'cancelled',
            terminalReason: 'approval_denied',
            timestamp: now,
        });
        // Return a synthetic harness result for the denied case
        const deniedHarnessResult = buildApprovalDeniedHarnessResult(record);
        return { continuation: denied, harnessResult: deniedHarnessResult, delivered: false };
    }
    // 7. Transition to resuming
    const newAttempts = record.bounds.resumeAttempts + 1;
    const resuming = {
        ...record,
        status: 'resuming',
        bounds: { ...record.bounds, resumeAttempts: newAttempts },
        lastResumedAt: now,
        updatedAt: now,
    };
    await config.store.put(resuming);
    // 8. Generate resumed turn id
    const resumedTurnId = generateResumedTurnId(continuationId, newAttempts);
    // 9. Invoke harness
    emitTrace(config, {
        type: 'continuation_resumed_turn_started',
        continuationId,
        assistantId: record.assistantId,
        sessionId: record.sessionId,
        originTurnId: record.origin.turnId,
        resumedTurnId,
        timestamp: config.clock.nowIso(),
    });
    let harnessResult;
    try {
        harnessResult = await config.harness.runResumedTurn({
            continuation: resuming,
            trigger,
            resumedTurnId,
        });
    }
    catch (err) {
        const failed = {
            ...resuming,
            status: 'failed',
            terminalReason: 'resume_runtime_error',
            updatedAt: config.clock.nowIso(),
        };
        await config.store.put(failed);
        emitTrace(config, {
            type: 'continuation_terminated',
            continuationId,
            assistantId: record.assistantId,
            sessionId: record.sessionId,
            originTurnId: record.origin.turnId,
            status: 'failed',
            terminalReason: 'resume_runtime_error',
            timestamp: config.clock.nowIso(),
        });
        throw new ContinuationError(`Harness threw during resume of continuation ${continuationId}: ${err instanceof Error ? err.message : String(err)}`, continuationId);
    }
    emitTrace(config, {
        type: 'continuation_resumed_turn_finished',
        continuationId,
        assistantId: record.assistantId,
        sessionId: record.sessionId,
        originTurnId: record.origin.turnId,
        resumedTurnId,
        harnessOutcome: harnessResult.outcome,
        timestamp: config.clock.nowIso(),
    });
    // 10. Handle harness result outcome
    const afterNow = config.clock.nowIso();
    let finalRecord;
    let delivered = false;
    const isTerminalOutcome = harnessResult.outcome === 'completed' ||
        harnessResult.outcome === 'failed';
    if (isTerminalOutcome) {
        // Determine terminal reason and delivery
        const terminalReason = harnessResult.outcome === 'completed' ? 'completed' : 'resume_runtime_error';
        const terminalStatus = harnessResult.outcome === 'completed' ? 'completed' : 'failed';
        let deliveryState = resuming.delivery;
        // 11. Attempt delivery if adapter is present
        if (config.delivery !== undefined &&
            resuming.delivery.status === 'pending_delivery') {
            emitTrace(config, {
                type: 'continuation_delivery_attempted',
                continuationId,
                assistantId: record.assistantId,
                sessionId: record.sessionId,
                originTurnId: record.origin.turnId,
                timestamp: config.clock.nowIso(),
            });
            try {
                const deliveryResult = await config.delivery.deliver({
                    continuation: resuming,
                    harnessResult,
                });
                if (deliveryResult.delivered) {
                    deliveryState = {
                        ...deliveryState,
                        status: 'delivered',
                        deliveredAt: config.clock.nowIso(),
                        lastDeliveryAttemptAt: config.clock.nowIso(),
                    };
                    delivered = true;
                }
                else {
                    deliveryState = {
                        ...deliveryState,
                        status: 'delivery_failed',
                        lastDeliveryAttemptAt: config.clock.nowIso(),
                    };
                }
            }
            catch {
                deliveryState = {
                    ...deliveryState,
                    status: 'delivery_failed',
                    lastDeliveryAttemptAt: config.clock.nowIso(),
                };
            }
            emitTrace(config, {
                type: 'continuation_delivery_finalized',
                continuationId,
                assistantId: record.assistantId,
                sessionId: record.sessionId,
                originTurnId: record.origin.turnId,
                deliveryStatus: deliveryState.status,
                timestamp: config.clock.nowIso(),
            });
        }
        finalRecord = {
            ...resuming,
            status: terminalStatus,
            terminalReason,
            delivery: deliveryState,
            updatedAt: afterNow,
        };
        await config.store.put(finalRecord);
        emitTrace(config, {
            type: 'continuation_terminated',
            continuationId,
            assistantId: record.assistantId,
            sessionId: record.sessionId,
            originTurnId: record.origin.turnId,
            status: terminalStatus,
            terminalReason,
            timestamp: afterNow,
        });
    }
    else if (RESUMABLE_OUTCOMES.has(harnessResult.outcome)) {
        // Re-pend: harness returned another resumable outcome — update wait condition
        const newOutcome = classifyOutcome(harnessResult.outcome);
        if (newOutcome === null || harnessResult.continuation === undefined) {
            // Treat as failed if we can't re-pend properly
            finalRecord = {
                ...resuming,
                status: 'failed',
                terminalReason: 'resume_runtime_error',
                updatedAt: afterNow,
            };
        }
        else {
            // Build new wait condition from the new harness result
            let newWaitFor;
            try {
                newWaitFor = deriveWaitCondition(newOutcome, {
                    assistantId: record.assistantId,
                    originTurnId: resumedTurnId,
                    harnessResult,
                    metadata: input.metadata,
                });
            }
            catch {
                newWaitFor = { type: 'user_reply' }; // fallback for clarification
            }
            const newTtlMs = deriveTtlMs(newOutcome, newWaitFor, config.defaults);
            finalRecord = {
                ...resuming,
                status: 'pending',
                waitFor: newWaitFor,
                continuation: harnessResult.continuation,
                origin: {
                    turnId: resumedTurnId,
                    outcome: newOutcome,
                    stopReason: harnessResult.stopReason,
                    createdAt: afterNow,
                },
                bounds: {
                    ...resuming.bounds,
                    expiresAt: new Date(config.clock.nowMs() + newTtlMs).toISOString(),
                },
                terminalReason: undefined,
                updatedAt: afterNow,
            };
        }
        await config.store.put(finalRecord);
    }
    else {
        // Unknown outcome — treat as failed
        finalRecord = {
            ...resuming,
            status: 'failed',
            terminalReason: 'resume_runtime_error',
            updatedAt: afterNow,
        };
        await config.store.put(finalRecord);
    }
    return { continuation: finalRecord, harnessResult, delivered };
}
// ─── stop ─────────────────────────────────────────────────────────────────────
async function stopContinuation(config, input) {
    const { continuationId, reason } = input;
    const now = config.clock.nowIso();
    const record = await config.store.get(continuationId);
    if (record === null) {
        throw new ContinuationNotFoundError(continuationId);
    }
    // Idempotent — if already terminal, return as-is
    if (TERMINAL_STATUSES.has(record.status)) {
        return { continuation: record };
    }
    const terminalStatus = terminalStatusForReason(reason);
    const deliveryStatus = deliveryStatusForTerminalReason(reason, record.delivery);
    // Cancel scheduled wake if applicable
    if (record.waitFor.type === 'scheduled_wake' &&
        record.waitFor.wakeUpId !== undefined &&
        config.scheduler?.cancelWake !== undefined) {
        await config.scheduler.cancelWake(record.waitFor.wakeUpId);
    }
    const stopped = {
        ...record,
        status: terminalStatus,
        terminalReason: reason,
        delivery: {
            ...record.delivery,
            status: deliveryStatus,
        },
        updatedAt: now,
        metadata: input.metadata !== undefined ? { ...record.metadata, ...input.metadata } : record.metadata,
    };
    await config.store.put(stopped);
    emitTrace(config, {
        type: 'continuation_terminated',
        continuationId,
        assistantId: record.assistantId,
        sessionId: record.sessionId,
        originTurnId: record.origin.turnId,
        status: terminalStatus,
        terminalReason: reason,
        timestamp: now,
    });
    return { continuation: stopped };
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildApprovalDeniedHarnessResult(record) {
    return {
        outcome: 'failed',
        stopReason: 'cancelled',
        turnId: record.origin.turnId,
        sessionId: record.sessionId,
        assistantMessage: {
            text: 'The requested action was not approved.',
        },
        continuation: undefined,
        traceSummary: {
            iterationCount: 0,
            toolCallCount: 0,
            hadContinuation: true,
            finalEventType: 'approval_denied',
        },
        usage: {
            modelCalls: 0,
            toolCalls: 0,
        },
    };
}
