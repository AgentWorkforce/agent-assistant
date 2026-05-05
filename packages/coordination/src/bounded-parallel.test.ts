import { describe, expect, it, vi } from 'vitest';

import {
  boundedParallel,
  BOUNDED_PARALLEL_TIMEOUT_REASON,
  type BoundedParallelResult,
} from './bounded-parallel.js';

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const handle = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(handle);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}

describe('boundedParallel', () => {
  it('returns [] for empty input without invoking fn', async () => {
    const fn = vi.fn(async (n: number) => n * 2);
    const results = await boundedParallel<number, number>([], fn);
    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('preserves input order in results', async () => {
    const items = [10, 50, 30, 5, 20];
    const results = await boundedParallel<number, number>(
      items,
      async (n, signal) => {
        await delay(n, signal);
        return n * 2;
      },
      { concurrency: 3 },
    );
    expect(results).toEqual([
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 100 },
      { status: 'fulfilled', value: 60 },
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 40 },
    ]);
  });

  it('caps in-flight concurrency at the configured limit', async () => {
    let inFlight = 0;
    let observedMax = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);

    await boundedParallel(
      items,
      async () => {
        inFlight += 1;
        observedMax = Math.max(observedMax, inFlight);
        await delay(20);
        inFlight -= 1;
      },
      { concurrency: 3 },
    );

    expect(observedMax).toBe(3);
  });

  it('settles per-item timeouts as { status: "timeout" } without poisoning the rest', async () => {
    const results = await boundedParallel<number, string>(
      [10, 5_000, 20],
      async (n, signal) => {
        await delay(n, signal);
        return `done-${n}`;
      },
      { concurrency: 3, perItemTimeoutMs: 100 },
    );

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'done-10' });
    expect(results[1]).toEqual({ status: 'timeout' });
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'done-20' });
  });

  it('passes a signal to fn that aborts on per-item timeout', async () => {
    let observedReason: unknown;
    const results = await boundedParallel<number, string>(
      [5_000],
      async (_n, signal) => {
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              observedReason = signal.reason;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
      { perItemTimeoutMs: 50 },
    );

    expect(results[0]).toEqual({ status: 'timeout' });
    expect(observedReason).toBe(BOUNDED_PARALLEL_TIMEOUT_REASON);
  });

  it('surfaces synchronous and async rejections as { status: "rejected", reason }', async () => {
    const results = await boundedParallel<number, number>(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error(`boom-${n}`);
        return n;
      },
    );

    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') {
      expect((results[1].reason as Error).message).toBe('boom-2');
    }
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
  });

  it('aborts in-flight items and drops pending items when external signal aborts', async () => {
    const controller = new AbortController();
    const startedIndices: number[] = [];

    const promise = boundedParallel<number, number>(
      [0, 1, 2, 3, 4, 5, 6, 7],
      async (n, signal) => {
        startedIndices.push(n);
        await delay(200, signal);
        return n;
      },
      { concurrency: 2, signal: controller.signal },
    );

    // Let the first 2 workers pick up items 0 and 1, then yank the cord.
    await delay(20);
    controller.abort();

    const results = await promise;

    // Items 0 and 1 were in-flight: their inner delay throws on abort;
    // settleAfterAbort sees externalSignal.aborted=true and returns 'aborted'.
    expect(results[0]).toEqual({ status: 'aborted' });
    expect(results[1]).toEqual({ status: 'aborted' });
    // Items 2..7 may or may not have been picked up by a worker before the
    // abort fired; in either branch they settle as 'aborted' (pending → never
    // called fn; in-flight → fn aborted). What we care about is no rejections
    // surface and no fulfilled values get through.
    for (let i = 2; i < 8; i += 1) {
      expect(results[i]).toEqual({ status: 'aborted' });
    }
    // At least the first 2 items got picked up before the abort.
    expect(startedIndices.length).toBeGreaterThanOrEqual(2);
  });

  it('settles every item as aborted when the signal is already aborted at call time', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn();

    const results = await boundedParallel<number, number>(
      [1, 2, 3],
      fn,
      { signal: controller.signal },
    );

    expect(results).toEqual<BoundedParallelResult<number>[]>([
      { status: 'aborted' },
      { status: 'aborted' },
      { status: 'aborted' },
    ]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('caps concurrency to items.length when concurrency exceeds it', async () => {
    let inFlight = 0;
    let observedMax = 0;
    await boundedParallel(
      [1, 2, 3],
      async () => {
        inFlight += 1;
        observedMax = Math.max(observedMax, inFlight);
        await delay(10);
        inFlight -= 1;
      },
      { concurrency: 100 },
    );
    expect(observedMax).toBe(3);
  });

  it('coerces non-positive concurrency to 1', async () => {
    let inFlight = 0;
    let observedMax = 0;
    await boundedParallel(
      [1, 2, 3, 4],
      async () => {
        inFlight += 1;
        observedMax = Math.max(observedMax, inFlight);
        await delay(10);
        inFlight -= 1;
      },
      { concurrency: 0 },
    );
    expect(observedMax).toBe(1);
  });
});
