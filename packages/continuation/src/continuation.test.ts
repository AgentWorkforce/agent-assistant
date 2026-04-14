import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  HarnessContinuation,
  HarnessResult,
  HarnessUserMessage,
} from '@agent-assistant/harness';
import { createContinuationRuntime } from './continuation.js';
import { InMemoryContinuationStore } from './store.js';
import type {
  ContinuationConfig,
  ContinuationHarnessAdapter,
  ContinuationDeliveryAdapter,
  ContinuationSchedulerAdapter,
  ContinuationTraceSink,
  ContinuationTraceEvent,
  ContinuationRecord,
} from './types.js';
import {
  ContinuationAlreadyTerminalError,
  ContinuationError,
  ContinuationExpiredError,
  ContinuationInvalidInputError,
  ContinuationNotFoundError,
  ContinuationTriggerMismatchError,
} from './types.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeClock(nowMs: number) {
  return {
    nowMs: () => nowMs,
    nowIso: () => new Date(nowMs).toISOString(),
  };
}

function makeHarnessContinuation(overrides: Partial<HarnessContinuation> = {}): HarnessContinuation {
  return {
    id: 'hc-1',
    type: 'clarification',
    createdAt: new Date().toISOString(),
    turnId: 'turn-1',
    resumeToken: 'token-abc',
    state: {},
    ...overrides,
  };
}

function makeHarnessResult(
  outcome: HarnessResult['outcome'],
  overrides: Partial<HarnessResult> = {},
): HarnessResult {
  const needsContinuation =
    outcome === 'needs_clarification' ||
    outcome === 'awaiting_approval' ||
    outcome === 'deferred';

  return {
    outcome,
    stopReason:
      outcome === 'needs_clarification'
        ? 'clarification_required'
        : outcome === 'awaiting_approval'
          ? 'approval_required'
          : outcome === 'deferred'
            ? 'max_iterations_reached'
            : outcome === 'completed'
              ? 'answer_finalized'
              : 'runtime_error',
    turnId: 'turn-1',
    continuation: needsContinuation ? makeHarnessContinuation({ type: outcome === 'awaiting_approval' ? 'approval' : outcome === 'deferred' ? 'deferred' : 'clarification' }) : undefined,
    traceSummary: {
      iterationCount: 1,
      toolCallCount: 0,
      hadContinuation: needsContinuation,
      finalEventType: outcome,
    },
    usage: { modelCalls: 1, toolCalls: 0 },
    ...overrides,
  };
}

function makeUserMessage(overrides: Partial<HarnessUserMessage> = {}): HarnessUserMessage {
  return {
    id: 'msg-1',
    text: 'test message',
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeHarnessAdapter(result?: HarnessResult): ContinuationHarnessAdapter {
  return {
    runResumedTurn: vi.fn().mockResolvedValue(
      result ?? makeHarnessResult('completed'),
    ),
  };
}

function makeTraceSink(): { sink: ContinuationTraceSink; events: ContinuationTraceEvent[] } {
  const events: ContinuationTraceEvent[] = [];
  return {
    sink: { emit: (e) => events.push(e) },
    events,
  };
}

function makeBaseConfig(overrides: Partial<ContinuationConfig> = {}): ContinuationConfig {
  return {
    store: new InMemoryContinuationStore(),
    harness: makeHarnessAdapter(),
    clock: makeClock(Date.now()),
    ...overrides,
  };
}

// ─── Creation tests ───────────────────────────────────────────────────────────

describe('create()', () => {
  it('creates a clarification continuation from needs_clarification result', async () => {
    const config = makeBaseConfig();
    const runtime = createContinuationRuntime(config);

    const result = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    expect(result.continuation.status).toBe('pending');
    expect(result.continuation.waitFor.type).toBe('user_reply');
    expect(result.continuation.origin.outcome).toBe('needs_clarification');
    expect(result.continuation.assistantId).toBe('assistant-1');
  });

  it('creates an approval continuation from awaiting_approval result', async () => {
    const config = makeBaseConfig();
    const runtime = createContinuationRuntime(config);

    const harnessResult = makeHarnessResult('awaiting_approval', {
      continuation: makeHarnessContinuation({
        type: 'approval',
        state: { approvalId: 'approval-123' },
      }),
    });

    const result = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult,
    });

    expect(result.continuation.status).toBe('pending');
    expect(result.continuation.waitFor.type).toBe('approval_resolution');
    if (result.continuation.waitFor.type === 'approval_resolution') {
      expect(result.continuation.waitFor.approvalId).toBe('approval-123');
    }
  });

  it('creates a deferred continuation from deferred result with external_result', async () => {
    const config = makeBaseConfig();
    const runtime = createContinuationRuntime(config);

    const harnessResult = makeHarnessResult('deferred', {
      continuation: makeHarnessContinuation({
        type: 'deferred',
        state: { operationId: 'op-456' },
      }),
    });

    const result = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult,
    });

    expect(result.continuation.status).toBe('pending');
    expect(result.continuation.waitFor.type).toBe('external_result');
    if (result.continuation.waitFor.type === 'external_result') {
      expect(result.continuation.waitFor.operationId).toBe('op-456');
    }
  });

  it('creates a scheduled-wake continuation and invokes scheduler', async () => {
    const scheduler: ContinuationSchedulerAdapter = {
      scheduleWake: vi.fn().mockResolvedValue({ wakeUpId: 'wake-789' }),
    };
    const config = makeBaseConfig({ scheduler });
    const runtime = createContinuationRuntime(config);

    const harnessResult = makeHarnessResult('deferred', {
      continuation: makeHarnessContinuation({ type: 'deferred', state: {} }),
    });

    const result = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult,
      metadata: { scheduledWake: true },
    });

    expect(result.continuation.waitFor.type).toBe('scheduled_wake');
    expect(result.scheduledWakeId).toBe('wake-789');
    expect(scheduler.scheduleWake).toHaveBeenCalled();
  });

  it('rejects completed harness result', async () => {
    const config = makeBaseConfig();
    const runtime = createContinuationRuntime(config);

    await expect(
      runtime.create({
        assistantId: 'assistant-1',
        originTurnId: 'turn-1',
        harnessResult: makeHarnessResult('completed'),
      }),
    ).rejects.toThrow(ContinuationInvalidInputError);
  });

  it('rejects failed harness result', async () => {
    const config = makeBaseConfig();
    const runtime = createContinuationRuntime(config);

    await expect(
      runtime.create({
        assistantId: 'assistant-1',
        originTurnId: 'turn-1',
        harnessResult: makeHarnessResult('failed'),
      }),
    ).rejects.toThrow(ContinuationInvalidInputError);
  });

  it('applies correct TTL per outcome type — clarification gets 1h, approval gets 24h', async () => {
    const nowMs = 1_000_000_000;
    const config = makeBaseConfig({ clock: makeClock(nowMs) });
    const runtime = createContinuationRuntime(config);

    const clarResult = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });
    const clarExpiry = new Date(clarResult.continuation.bounds.expiresAt).getTime();
    expect(clarExpiry - nowMs).toBe(3_600_000); // 1 hour

    const approvalResult = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-2',
      harnessResult: makeHarnessResult('awaiting_approval', {
        continuation: makeHarnessContinuation({
          type: 'approval',
          state: { approvalId: 'appr-1' },
        }),
      }),
    });
    const approvalExpiry = new Date(approvalResult.continuation.bounds.expiresAt).getTime();
    expect(approvalExpiry - nowMs).toBe(86_400_000); // 24 hours
  });

  it('emits continuation_created trace event', async () => {
    const { sink, events } = makeTraceSink();
    const config = makeBaseConfig({ trace: sink });
    const runtime = createContinuationRuntime(config);

    await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    const created = events.find((e) => e.type === 'continuation_created');
    expect(created).toBeDefined();
    if (created?.type === 'continuation_created') {
      expect(created.outcome).toBe('needs_clarification');
      expect(created.waitFor).toBe('user_reply');
    }
  });

  it('rejects awaiting_approval without approvalId', async () => {
    const config = makeBaseConfig();
    const runtime = createContinuationRuntime(config);

    await expect(
      runtime.create({
        assistantId: 'a',
        originTurnId: 'turn-1',
        harnessResult: makeHarnessResult('awaiting_approval', {
          continuation: makeHarnessContinuation({ type: 'approval', state: {} }),
        }),
      }),
    ).rejects.toThrow(ContinuationInvalidInputError);
  });
});

// ─── Resume tests — Clarification ─────────────────────────────────────────────

describe('resume() — clarification', () => {
  async function makePendingClarification(config: ContinuationConfig, turnId = 'turn-1') {
    const runtime = createContinuationRuntime(config);
    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: turnId,
      harnessResult: makeHarnessResult('needs_clarification'),
    });
    return { runtime, continuation };
  }

  it('resumes with matching user_reply trigger and completes record', async () => {
    const harness = makeHarnessAdapter(makeHarnessResult('completed'));
    const config = makeBaseConfig({ harness });
    const { runtime, continuation } = await makePendingClarification(config);

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'user_reply',
        message: makeUserMessage(),
        receivedAt: new Date().toISOString(),
      },
    });

    expect(result.continuation.status).toBe('completed');
    expect(result.harnessResult.outcome).toBe('completed');
    expect(harness.runResumedTurn).toHaveBeenCalledOnce();
  });

  it('rejects resume with wrong trigger type', async () => {
    const config = makeBaseConfig();
    const { runtime, continuation } = await makePendingClarification(config);

    await expect(
      runtime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'scheduled_wake',
          firedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationTriggerMismatchError);
  });

  it('rejects resume on expired record', async () => {
    const nowMs = Date.now();
    const config = makeBaseConfig({ clock: makeClock(nowMs) });
    const { continuation } = await makePendingClarification(config);

    // Advance clock past expiry
    const futureConfig = makeBaseConfig({
      store: (config.store as InMemoryContinuationStore),
      clock: makeClock(nowMs + 4_000_000), // past 1h TTL
      harness: makeHarnessAdapter(),
    });
    const futureRuntime = createContinuationRuntime(futureConfig);

    await expect(
      futureRuntime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'user_reply',
          message: makeUserMessage(),
          receivedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationExpiredError);
  });

  it('rejects resume on already-terminal record', async () => {
    const harness = makeHarnessAdapter(makeHarnessResult('completed'));
    const config = makeBaseConfig({ harness });
    const { runtime, continuation } = await makePendingClarification(config);

    // First resume completes it
    await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'user_reply',
        message: makeUserMessage(),
        receivedAt: new Date().toISOString(),
      },
    });

    // Second resume should fail
    await expect(
      runtime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'user_reply',
          message: makeUserMessage(),
          receivedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationAlreadyTerminalError);
  });

  it('rejects resume when max attempts exhausted', async () => {
    const nowMs = Date.now();
    const store = new InMemoryContinuationStore();
    const harness = makeHarnessAdapter(makeHarnessResult('needs_clarification', {
      continuation: makeHarnessContinuation({ type: 'clarification', state: {} }),
    }));
    const config = makeBaseConfig({
      store,
      harness,
      clock: makeClock(nowMs),
      defaults: { maxResumeAttempts: 2 },
    });
    const { runtime, continuation } = await makePendingClarification(config);

    const trigger = {
      type: 'user_reply' as const,
      message: makeUserMessage(),
      receivedAt: new Date().toISOString(),
    };

    // Use all 2 attempts (each re-pends since harness returns needs_clarification)
    await runtime.resume({ continuationId: continuation.id, trigger });
    await runtime.resume({ continuationId: continuation.id, trigger });

    // Third attempt should be rejected
    await expect(
      runtime.resume({ continuationId: continuation.id, trigger }),
    ).rejects.toThrow(ContinuationError);
  });

  it('increments resumeAttempts on each attempt', async () => {
    const store = new InMemoryContinuationStore();
    const harness = makeHarnessAdapter(makeHarnessResult('needs_clarification', {
      continuation: makeHarnessContinuation({ type: 'clarification', state: {} }),
    }));
    const config = makeBaseConfig({ store, harness });
    const { runtime, continuation } = await makePendingClarification(config);

    const trigger = {
      type: 'user_reply' as const,
      message: makeUserMessage(),
      receivedAt: new Date().toISOString(),
    };

    const r1 = await runtime.resume({ continuationId: continuation.id, trigger });
    expect(r1.continuation.bounds.resumeAttempts).toBe(1);

    const r2 = await runtime.resume({ continuationId: continuation.id, trigger });
    expect(r2.continuation.bounds.resumeAttempts).toBe(2);
  });
});

// ─── Resume tests — Approval ──────────────────────────────────────────────────

describe('resume() — approval', () => {
  const APPROVAL_ID = 'approval-xyz';

  async function makePendingApproval(config: ContinuationConfig) {
    const runtime = createContinuationRuntime(config);
    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('awaiting_approval', {
        continuation: makeHarnessContinuation({
          type: 'approval',
          state: { approvalId: APPROVAL_ID },
        }),
      }),
    });
    return { runtime, continuation };
  }

  it('resumes with approved decision and completes record', async () => {
    const harness = makeHarnessAdapter(makeHarnessResult('completed'));
    const config = makeBaseConfig({ harness });
    const { runtime, continuation } = await makePendingApproval(config);

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'approval_resolution',
        approvalId: APPROVAL_ID,
        decision: 'approved',
        resolvedAt: new Date().toISOString(),
      },
    });

    expect(result.continuation.status).toBe('completed');
    expect(harness.runResumedTurn).toHaveBeenCalledOnce();
  });

  it('stops with denied decision without calling harness', async () => {
    const harness = makeHarnessAdapter();
    const config = makeBaseConfig({ harness });
    const { runtime, continuation } = await makePendingApproval(config);

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'approval_resolution',
        approvalId: APPROVAL_ID,
        decision: 'denied',
        resolvedAt: new Date().toISOString(),
      },
    });

    expect(result.continuation.status).toBe('cancelled');
    expect(result.continuation.terminalReason).toBe('approval_denied');
    expect(harness.runResumedTurn).not.toHaveBeenCalled();
  });

  it('rejects mismatched approvalId', async () => {
    const config = makeBaseConfig();
    const { runtime, continuation } = await makePendingApproval(config);

    await expect(
      runtime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'approval_resolution',
          approvalId: 'wrong-id',
          decision: 'approved',
          resolvedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationTriggerMismatchError);
  });

  it('handles approval after expiry — expired wins', async () => {
    const nowMs = Date.now();
    const store = new InMemoryContinuationStore();
    const config = makeBaseConfig({ store, clock: makeClock(nowMs) });
    const { continuation } = await makePendingApproval(config);

    const futureConfig = makeBaseConfig({
      store,
      clock: makeClock(nowMs + 90_000_000), // past 24h TTL
    });
    const futureRuntime = createContinuationRuntime(futureConfig);

    await expect(
      futureRuntime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'approval_resolution',
          approvalId: APPROVAL_ID,
          decision: 'approved',
          resolvedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationExpiredError);
  });

  it('emits trace events for approval resume', async () => {
    const { sink, events } = makeTraceSink();
    const harness = makeHarnessAdapter(makeHarnessResult('completed'));
    const config = makeBaseConfig({ harness, trace: sink });
    const { runtime, continuation } = await makePendingApproval(config);

    await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'approval_resolution',
        approvalId: APPROVAL_ID,
        decision: 'approved',
        resolvedAt: new Date().toISOString(),
      },
    });

    const resumeRequested = events.find((e) => e.type === 'continuation_resume_requested');
    const turnStarted = events.find((e) => e.type === 'continuation_resumed_turn_started');
    const terminated = events.find((e) => e.type === 'continuation_terminated');

    expect(resumeRequested).toBeDefined();
    expect(turnStarted).toBeDefined();
    expect(terminated).toBeDefined();
  });
});

// ─── Resume tests — External result ──────────────────────────────────────────

describe('resume() — external_result', () => {
  const OP_ID = 'op-abc';

  async function makePendingExternal(config: ContinuationConfig) {
    const runtime = createContinuationRuntime(config);
    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('deferred', {
        continuation: makeHarnessContinuation({
          type: 'deferred',
          state: { operationId: OP_ID },
        }),
      }),
    });
    return { runtime, continuation };
  }

  it('resumes with matching external_result trigger', async () => {
    const harness = makeHarnessAdapter(makeHarnessResult('completed'));
    const config = makeBaseConfig({ harness });
    const { runtime, continuation } = await makePendingExternal(config);

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'external_result',
        operationId: OP_ID,
        resolvedAt: new Date().toISOString(),
        payload: { value: 42 },
      },
    });

    expect(result.continuation.status).toBe('completed');
    expect(harness.runResumedTurn).toHaveBeenCalledOnce();
  });

  it('rejects mismatched operationId', async () => {
    const config = makeBaseConfig();
    const { runtime, continuation } = await makePendingExternal(config);

    await expect(
      runtime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'external_result',
          operationId: 'wrong-op',
          resolvedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationTriggerMismatchError);
  });

  it('handles harness runtime error during resume', async () => {
    const harness: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockRejectedValue(new Error('harness exploded')),
    };
    const config = makeBaseConfig({ harness });
    const { runtime, continuation } = await makePendingExternal(config);

    await expect(
      runtime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'external_result',
          operationId: OP_ID,
          resolvedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationError);

    const record = await runtime.get({ continuationId: continuation.id });
    expect(record?.status).toBe('failed');
    expect(record?.terminalReason).toBe('resume_runtime_error');
  });

  it('re-pends when harness returns another resumable outcome', async () => {
    const harness = makeHarnessAdapter(
      makeHarnessResult('needs_clarification', {
        continuation: makeHarnessContinuation({ type: 'clarification', state: {} }),
      }),
    );
    const config = makeBaseConfig({ harness });
    const { runtime, continuation } = await makePendingExternal(config);

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'external_result',
        operationId: OP_ID,
        resolvedAt: new Date().toISOString(),
      },
    });

    expect(result.continuation.status).toBe('pending');
    expect(result.continuation.waitFor.type).toBe('user_reply');
  });
});

// ─── Resume tests — Scheduled wake ───────────────────────────────────────────

describe('resume() — scheduled_wake', () => {
  async function makePendingScheduled(config: ContinuationConfig) {
    const runtime = createContinuationRuntime(config);
    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('deferred', {
        continuation: makeHarnessContinuation({ type: 'deferred', state: {} }),
      }),
      metadata: { scheduledWake: true },
    });
    return { runtime, continuation };
  }

  it('resumes on scheduled_wake trigger', async () => {
    const harness = makeHarnessAdapter(makeHarnessResult('completed'));
    const config = makeBaseConfig({ harness });
    const { runtime, continuation } = await makePendingScheduled(config);

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'scheduled_wake',
        firedAt: new Date().toISOString(),
      },
    });

    expect(result.continuation.status).toBe('completed');
    expect(harness.runResumedTurn).toHaveBeenCalledOnce();
  });

  it('rejects scheduled_wake trigger for non-scheduled continuation', async () => {
    const config = makeBaseConfig();
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    await expect(
      runtime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'scheduled_wake',
          firedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationTriggerMismatchError);
  });

  it('ignores wake for already-expired continuation', async () => {
    const nowMs = Date.now();
    const store = new InMemoryContinuationStore();
    const config = makeBaseConfig({ store, clock: makeClock(nowMs) });
    const { continuation } = await makePendingScheduled(config);

    const futureConfig = makeBaseConfig({
      store,
      clock: makeClock(nowMs + 4_000_000), // past TTL
    });
    const futureRuntime = createContinuationRuntime(futureConfig);

    await expect(
      futureRuntime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'scheduled_wake',
          firedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationExpiredError);
  });
});

// ─── Stop tests ───────────────────────────────────────────────────────────────

describe('stop()', () => {
  async function makePendingRecord(config: ContinuationConfig): Promise<{ runtime: ReturnType<typeof createContinuationRuntime>; continuation: ContinuationRecord }> {
    const runtime = createContinuationRuntime(config);
    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });
    return { runtime, continuation };
  }

  it('stops with cancelled_by_user', async () => {
    const config = makeBaseConfig();
    const { runtime, continuation } = await makePendingRecord(config);

    const result = await runtime.stop({
      continuationId: continuation.id,
      reason: 'cancelled_by_user',
    });

    expect(result.continuation.status).toBe('cancelled');
    expect(result.continuation.terminalReason).toBe('cancelled_by_user');
  });

  it('stops with cancelled_by_product', async () => {
    const config = makeBaseConfig();
    const { runtime, continuation } = await makePendingRecord(config);

    const result = await runtime.stop({
      continuationId: continuation.id,
      reason: 'cancelled_by_product',
    });

    expect(result.continuation.status).toBe('cancelled');
  });

  it('stops with superseded_by_newer_turn sets status superseded', async () => {
    const config = makeBaseConfig();
    const { runtime, continuation } = await makePendingRecord(config);

    const result = await runtime.stop({
      continuationId: continuation.id,
      reason: 'superseded_by_newer_turn',
    });

    expect(result.continuation.status).toBe('superseded');
    expect(result.continuation.terminalReason).toBe('superseded_by_newer_turn');
  });

  it('stops with expired_ttl sets status expired', async () => {
    const config = makeBaseConfig();
    const { runtime, continuation } = await makePendingRecord(config);

    const result = await runtime.stop({
      continuationId: continuation.id,
      reason: 'expired_ttl',
    });

    expect(result.continuation.status).toBe('expired');
  });

  it('stop is idempotent on already-terminal record', async () => {
    const config = makeBaseConfig();
    const { runtime, continuation } = await makePendingRecord(config);

    await runtime.stop({ continuationId: continuation.id, reason: 'cancelled_by_user' });
    // second stop should not throw
    const result = await runtime.stop({
      continuationId: continuation.id,
      reason: 'cancelled_by_product',
    });
    expect(result.continuation.status).toBe('cancelled');
    expect(result.continuation.terminalReason).toBe('cancelled_by_user'); // original reason preserved
  });

  it('cancels scheduled wake on stop', async () => {
    const cancelWake = vi.fn().mockResolvedValue(undefined);
    const scheduler: ContinuationSchedulerAdapter = {
      scheduleWake: vi.fn().mockResolvedValue({ wakeUpId: 'wake-1' }),
      cancelWake,
    };
    const config = makeBaseConfig({ scheduler });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('deferred', {
        continuation: makeHarnessContinuation({ type: 'deferred', state: {} }),
      }),
      metadata: { scheduledWake: true },
    });

    await runtime.stop({ continuationId: continuation.id, reason: 'cancelled_by_product' });
    expect(cancelWake).toHaveBeenCalledWith('wake-1');
  });
});

// ─── Delivery tests ───────────────────────────────────────────────────────────

describe('delivery', () => {
  async function makePendingWithDelivery(
    deliveryAdapter: ContinuationDeliveryAdapter,
  ): Promise<{ runtime: ReturnType<typeof createContinuationRuntime>; continuation: ContinuationRecord }> {
    const harness = makeHarnessAdapter(makeHarnessResult('completed'));
    const config = makeBaseConfig({ harness, delivery: deliveryAdapter });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
      delivery: { surfaceIds: ['surface-1'], fanoutMode: 'originating_surface' },
    });

    return { runtime, continuation };
  }

  it('delivers follow-up after successful resume', async () => {
    const deliveryAdapter: ContinuationDeliveryAdapter = {
      deliver: vi.fn().mockResolvedValue({ delivered: true }),
    };
    const { runtime, continuation } = await makePendingWithDelivery(deliveryAdapter);

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'user_reply',
        message: makeUserMessage(),
        receivedAt: new Date().toISOString(),
      },
    });

    expect(result.delivered).toBe(true);
    expect(result.continuation.delivery.status).toBe('delivered');
    expect(deliveryAdapter.deliver).toHaveBeenCalledOnce();
  });

  it('marks delivery_failed when adapter rejects', async () => {
    const deliveryAdapter: ContinuationDeliveryAdapter = {
      deliver: vi.fn().mockResolvedValue({ delivered: false, failureReason: 'transport error' }),
    };
    const { runtime, continuation } = await makePendingWithDelivery(deliveryAdapter);

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'user_reply',
        message: makeUserMessage(),
        receivedAt: new Date().toISOString(),
      },
    });

    expect(result.delivered).toBe(false);
    expect(result.continuation.delivery.status).toBe('delivery_failed');
  });

  it('skips delivery when no adapter configured', async () => {
    const harness = makeHarnessAdapter(makeHarnessResult('completed'));
    const config = makeBaseConfig({ harness }); // no delivery adapter
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'user_reply',
        message: makeUserMessage(),
        receivedAt: new Date().toISOString(),
      },
    });

    expect(result.continuation.delivery.status).toBe('not_applicable');
    expect(result.delivered).toBe(false);
  });

  it('sets suppressed_expired delivery state on expiry', async () => {
    const nowMs = Date.now();
    const store = new InMemoryContinuationStore();
    const deliveryAdapter: ContinuationDeliveryAdapter = {
      deliver: vi.fn().mockResolvedValue({ delivered: true }),
    };
    const config = makeBaseConfig({ store, delivery: deliveryAdapter, clock: makeClock(nowMs) });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    const futureConfig = makeBaseConfig({
      store,
      delivery: deliveryAdapter,
      clock: makeClock(nowMs + 4_000_000),
    });
    const futureRuntime = createContinuationRuntime(futureConfig);

    await expect(
      futureRuntime.resume({
        continuationId: continuation.id,
        trigger: {
          type: 'user_reply',
          message: makeUserMessage(),
          receivedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(ContinuationExpiredError);

    const expired = await futureRuntime.get({ continuationId: continuation.id });
    expect(expired?.delivery.status).toBe('suppressed_expired');
    expect(deliveryAdapter.deliver).not.toHaveBeenCalled();
  });

  it('sets suppressed_superseded delivery state on supersession', async () => {
    const deliveryAdapter: ContinuationDeliveryAdapter = {
      deliver: vi.fn().mockResolvedValue({ delivered: true }),
    };
    const harness = makeHarnessAdapter(makeHarnessResult('completed'));
    const config = makeBaseConfig({ harness, delivery: deliveryAdapter });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'assistant-1',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    await runtime.stop({
      continuationId: continuation.id,
      reason: 'superseded_by_newer_turn',
    });

    const record = await runtime.get({ continuationId: continuation.id });
    expect(record?.delivery.status).toBe('suppressed_superseded');
    expect(deliveryAdapter.deliver).not.toHaveBeenCalled();
  });
});

// ─── Bounding and liveness tests ──────────────────────────────────────────────

describe('bounding and liveness', () => {
  it('default TTL values applied correctly', async () => {
    const nowMs = 5_000_000_000;
    const config = makeBaseConfig({ clock: makeClock(nowMs) });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    const expiryMs = new Date(continuation.bounds.expiresAt).getTime();
    expect(expiryMs - nowMs).toBe(3_600_000);
    expect(continuation.bounds.maxResumeAttempts).toBe(3);
    expect(continuation.bounds.resumeAttempts).toBe(0);
  });

  it('custom TTL overrides defaults', async () => {
    const nowMs = 5_000_000_000;
    const customExpiry = new Date(nowMs + 7_200_000).toISOString(); // 2 hours
    const config = makeBaseConfig({ clock: makeClock(nowMs) });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
      bounds: { expiresAt: customExpiry, maxResumeAttempts: 5, resumeAttempts: 0 },
    });

    expect(continuation.bounds.expiresAt).toBe(customExpiry);
    expect(continuation.bounds.maxResumeAttempts).toBe(5);
  });

  it('max resume attempts enforced across multiple resumes', async () => {
    const store = new InMemoryContinuationStore();
    const harness = makeHarnessAdapter(makeHarnessResult('needs_clarification', {
      continuation: makeHarnessContinuation({ type: 'clarification', state: {} }),
    }));
    const config = makeBaseConfig({
      store,
      harness,
      defaults: { maxResumeAttempts: 2 },
    });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    const trigger = {
      type: 'user_reply' as const,
      message: makeUserMessage(),
      receivedAt: new Date().toISOString(),
    };

    await runtime.resume({ continuationId: continuation.id, trigger });
    await runtime.resume({ continuationId: continuation.id, trigger });

    await expect(
      runtime.resume({ continuationId: continuation.id, trigger }),
    ).rejects.toThrow(ContinuationError);

    const record = await runtime.get({ continuationId: continuation.id });
    expect(record?.status).toBe('failed');
    expect(record?.terminalReason).toBe('max_resume_attempts_reached');
  });

  it('get() returns null for nonexistent id', async () => {
    const config = makeBaseConfig();
    const runtime = createContinuationRuntime(config);

    const result = await runtime.get({ continuationId: 'does-not-exist' });
    expect(result).toBeNull();
  });
});

// ─── Edge case tests ──────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('concurrent resume — second attempt finds record already resuming', async () => {
    let resolveFirst!: () => void;
    const firstCallStarted = new Promise<void>((res) => { resolveFirst = res; });

    const harness: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockImplementation(async () => {
        resolveFirst();
        // slight delay to let second resume attempt be made against the store
        await new Promise((r) => setTimeout(r, 10));
        return makeHarnessResult('completed');
      }),
    };
    const config = makeBaseConfig({ harness });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    const trigger = {
      type: 'user_reply' as const,
      message: makeUserMessage(),
      receivedAt: new Date().toISOString(),
    };

    const first = runtime.resume({ continuationId: continuation.id, trigger });
    await firstCallStarted; // wait until record is in 'resuming' state
    const second = runtime.resume({ continuationId: continuation.id, trigger });

    const [, secondResult] = await Promise.allSettled([first, second]);
    expect(secondResult.status).toBe('rejected');
    if (secondResult.status === 'rejected') {
      expect(secondResult.reason).toBeInstanceOf(ContinuationAlreadyTerminalError);
    }
  });

  it('resume with approval_denied stops record without invoking harness', async () => {
    const harness = makeHarnessAdapter();
    const config = makeBaseConfig({ harness });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('awaiting_approval', {
        continuation: makeHarnessContinuation({
          type: 'approval',
          state: { approvalId: 'appr-999' },
        }),
      }),
    });

    const result = await runtime.resume({
      continuationId: continuation.id,
      trigger: {
        type: 'approval_resolution',
        approvalId: 'appr-999',
        decision: 'denied',
        resolvedAt: new Date().toISOString(),
      },
    });

    expect(result.continuation.status).toBe('cancelled');
    expect(result.continuation.terminalReason).toBe('approval_denied');
    expect(harness.runResumedTurn).not.toHaveBeenCalled();
  });

  it('trace sink is optional — no error when omitted', async () => {
    const config = makeBaseConfig(); // no trace sink
    const runtime = createContinuationRuntime(config);

    // Should not throw
    const { continuation } = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    expect(continuation).toBeDefined();
  });
});

// ─── InMemoryContinuationStore tests ─────────────────────────────────────────

describe('InMemoryContinuationStore', () => {
  it('put and get round-trip', async () => {
    const store = new InMemoryContinuationStore();
    const config = makeBaseConfig({ store });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    const fetched = await store.get(continuation.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(continuation.id);
  });

  it('structuredClone prevents external mutation', async () => {
    const store = new InMemoryContinuationStore();
    const config = makeBaseConfig({ store });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    const fetched = await store.get(continuation.id);
    if (fetched) {
      // mutate the fetched copy
      (fetched as { status: string }).status = 'completed';
    }

    const refetched = await store.get(continuation.id);
    expect(refetched?.status).toBe('pending'); // store not affected
  });

  it('listBySession returns only matching session records', async () => {
    const store = new InMemoryContinuationStore();

    for (let i = 0; i < 3; i++) {
      const config = makeBaseConfig({ store });
      const runtime = createContinuationRuntime(config);
      await runtime.create({
        assistantId: 'a',
        sessionId: i < 2 ? 'session-A' : 'session-B',
        originTurnId: `turn-${i}`,
        harnessResult: makeHarnessResult('needs_clarification'),
      });
    }

    const sessionA = await store.listBySession('session-A');
    expect(sessionA).toHaveLength(2);

    const sessionB = await store.listBySession('session-B');
    expect(sessionB).toHaveLength(1);
  });

  it('delete removes the record', async () => {
    const store = new InMemoryContinuationStore();
    const config = makeBaseConfig({ store });
    const runtime = createContinuationRuntime(config);

    const { continuation } = await runtime.create({
      assistantId: 'a',
      originTurnId: 'turn-1',
      harnessResult: makeHarnessResult('needs_clarification'),
    });

    await store.delete(continuation.id);
    const result = await store.get(continuation.id);
    expect(result).toBeNull();
  });
});
