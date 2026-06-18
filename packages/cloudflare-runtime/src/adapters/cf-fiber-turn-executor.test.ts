import { describe, expect, it, vi } from 'vitest';
import type { ContinuationHarnessAdapter, ContinuationResumedTurnInput } from '@agent-assistant/continuation';
import type { HarnessResult } from '@agent-assistant/harness';
import { CfFiberTurnExecutor, type FiberContextLike, type RunFiberFn } from './cf-fiber-turn-executor.js';
import type { DurableObjectStorageLike } from './cf-continuation-store.js';

function makeStorage(): DurableObjectStorageLike {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { map.set(key, value); },
    async delete(key: string) { map.delete(key); return true; },
    async list<T>() { return new Map<string, T>(); },
  };
}

function makeRunFiber(): RunFiberFn {
  return async <T>(_storage: DurableObjectStorageLike, fn: (ctx: FiberContextLike) => Promise<T>): Promise<T> => {
    const stash = new Map<string, unknown>();
    const ctx: FiberContextLike = {
      stash<V>(key: string, value: V) { stash.set(key, value); },
      stashed<V>(key: string): V | undefined { return stash.get(key) as V | undefined; },
    };
    return fn(ctx);
  };
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

describe('CfFiberTurnExecutor', () => {
  it('delegates to the inner harness adapter', async () => {
    const inner: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockResolvedValue(successResult),
    };
    const executor = new CfFiberTurnExecutor({
      inner,
      storage: makeStorage(),
      runFiber: makeRunFiber(),
    });
    const result = await executor.runResumedTurn(makeInput());
    expect(result).toBe(successResult);
    expect(inner.runResumedTurn).toHaveBeenCalledOnce();
  });

  it('returns stashed result without calling inner on recovery', async () => {
    const inner: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockResolvedValue(successResult),
    };

    const stash = new Map<string, unknown>();
    // Simulate a fiber that already has a stashed result (recovery scenario)
    const recoveryRunFiber: RunFiberFn = async <T>(
      _storage: DurableObjectStorageLike,
      fn: (ctx: FiberContextLike) => Promise<T>,
    ): Promise<T> => {
      const ctx: FiberContextLike = {
        stash<V>(key: string, value: V) { stash.set(key, value); },
        stashed<V>(key: string): V | undefined { return stash.get(key) as V | undefined; },
      };
      return fn(ctx);
    };

    // Pre-populate the stash with the result for this turn
    stash.set('turn:turn-abc', successResult);

    const executor = new CfFiberTurnExecutor({
      inner,
      storage: makeStorage(),
      runFiber: recoveryRunFiber,
    });

    const result = await executor.runResumedTurn(makeInput('turn-abc'));
    expect(result).toBe(successResult);
    expect(inner.runResumedTurn).not.toHaveBeenCalled();
  });

  it('stashes result after a successful turn', async () => {
    const stash = new Map<string, unknown>();
    const inner: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockResolvedValue(successResult),
    };

    const trackingRunFiber: RunFiberFn = async <T>(
      _storage: DurableObjectStorageLike,
      fn: (ctx: FiberContextLike) => Promise<T>,
    ): Promise<T> => {
      const ctx: FiberContextLike = {
        stash<V>(key: string, value: V) { stash.set(key, value); },
        stashed<V>(key: string): V | undefined { return stash.get(key) as V | undefined; },
      };
      return fn(ctx);
    };

    const executor = new CfFiberTurnExecutor({
      inner,
      storage: makeStorage(),
      runFiber: trackingRunFiber,
    });

    await executor.runResumedTurn(makeInput('turn-xyz'));
    expect(stash.has('turn:turn-xyz')).toBe(true);
    expect(stash.get('turn:turn-xyz')).toBe(successResult);
  });

  it('propagates errors from the inner harness', async () => {
    const inner: ContinuationHarnessAdapter = {
      runResumedTurn: vi.fn().mockRejectedValue(new Error('harness failed')),
    };
    const executor = new CfFiberTurnExecutor({
      inner,
      storage: makeStorage(),
      runFiber: makeRunFiber(),
    });
    await expect(executor.runResumedTurn(makeInput())).rejects.toThrow('harness failed');
  });
});
