import { describe, expect, it, vi } from 'vitest';
import type { ContinuationHarnessAdapter, ContinuationResumedTurnInput } from '@agent-assistant/continuation';
import type { HarnessResult } from '@agent-assistant/harness';
import { GcpIdempotentTurnExecutor } from './gcp-idempotent-turn-executor.js';
import type {
  FirestoreCollectionLike,
  FirestoreDocRef,
  FirestoreDocSnapshot,
  FirestoreQuery,
  FirestoreQuerySnapshot,
} from './gcp-firestore-session-store-adapter.js';

type StashDoc = { result: HarnessResult };

function makeStashCollection(): FirestoreCollectionLike<StashDoc> {
  const docs = new Map<string, StashDoc>();

  function snap(id: string): FirestoreDocSnapshot<StashDoc> {
    const data = docs.get(id);
    return { exists: data !== undefined, id, data: () => data };
  }

  const col: FirestoreCollectionLike<StashDoc> = {
    doc(id: string): FirestoreDocRef<StashDoc> {
      return {
        get: async () => snap(id),
        set: async (data) => { docs.set(id, data); },
        update: async (patch) => { docs.set(id, { ...docs.get(id)!, ...patch } as StashDoc); },
        delete: async () => { docs.delete(id); },
        create: async (data) => { docs.set(id, data); },
      };
    },
    where(_f, _op, _v): FirestoreQuery<StashDoc> { return col as unknown as FirestoreQuery<StashDoc>; },
    limit(_n): FirestoreQuery<StashDoc> { return col as unknown as FirestoreQuery<StashDoc>; },
    async get(): Promise<FirestoreQuerySnapshot<StashDoc>> { return { docs: [] }; },
  };

  return col;
}

const successResult: HarnessResult = {
  outcome: 'complete',
  stopReason: 'end_turn',
  outputMessages: [],
} as unknown as HarnessResult;

function makeInput(resumedTurnId = 'turn-abc'): ContinuationResumedTurnInput {
  return {
    resumedTurnId,
    continuation: {} as never,
    trigger: { type: 'user_reply', message: {} as never, receivedAt: new Date().toISOString() },
  };
}

describe('GcpIdempotentTurnExecutor', () => {
  it('delegates to the inner harness on first run', async () => {
    const inner: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockResolvedValue(successResult),
    };
    const executor = new GcpIdempotentTurnExecutor({
      inner,
      stashCollection: makeStashCollection(),
    });
    const result = await executor.runResumedTurn(makeInput());
    expect(result).toBe(successResult);
    expect(inner.runResumedTurn).toHaveBeenCalledOnce();
  });

  it('returns stashed result without calling inner on recovery', async () => {
    const inner: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockResolvedValue(successResult),
    };
    const stash = makeStashCollection();

    // Simulate a previous run that stashed the result
    await stash.doc('turn-abc').set({ result: successResult });

    const executor = new GcpIdempotentTurnExecutor({ inner, stashCollection: stash });
    const result = await executor.runResumedTurn(makeInput('turn-abc'));
    expect(result).toBe(successResult);
    expect(inner.runResumedTurn).not.toHaveBeenCalled();
  });

  it('stashes the result after the first successful run', async () => {
    const inner: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockResolvedValue(successResult),
    };
    const stash = makeStashCollection();
    const executor = new GcpIdempotentTurnExecutor({ inner, stashCollection: stash });

    await executor.runResumedTurn(makeInput('turn-xyz'));

    const stored = await stash.doc('turn-xyz').get();
    expect(stored.exists).toBe(true);
    expect(stored.data()?.result).toBe(successResult);
  });

  it('propagates errors from the inner harness', async () => {
    const inner: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockRejectedValue(new Error('harness error')),
    };
    const executor = new GcpIdempotentTurnExecutor({
      inner,
      stashCollection: makeStashCollection(),
    });
    await expect(executor.runResumedTurn(makeInput())).rejects.toThrow('harness error');
  });
});
