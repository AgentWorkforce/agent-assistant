import { describe, expect, it } from 'vitest';

import { runFollowUpBatch } from './run-follow-up-batch.js';

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

describe('runFollowUpBatch', () => {
  it('returns empty result when given no candidates', async () => {
    const out = await runFollowUpBatch<string, string>({
      candidates: [],
      runOne: async (c) => c.toUpperCase(),
    });
    expect(out.results).toEqual([]);
    expect(out.processed).toEqual([]);
    expect(out.dropped).toEqual([]);
    expect(out.stats).toEqual({
      processed: 0,
      fulfilled: 0,
      rejected: 0,
      timedOut: 0,
      aborted: 0,
      dropped: 0,
    });
  });

  it('runs every candidate when no cap is set and aggregates fulfilled stats', async () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const out = await runFollowUpBatch<string, string>({
      candidates: items,
      runOne: async (c) => c.toUpperCase(),
      concurrency: 2,
    });
    expect(out.processed).toEqual(items);
    expect(out.dropped).toEqual([]);
    expect(out.stats.processed).toBe(5);
    expect(out.stats.fulfilled).toBe(5);
    expect(out.results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
  });

  it('applies maxCandidatesPerRun as a FIFO prefix and returns the tail in dropped', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const seen: number[] = [];
    const out = await runFollowUpBatch<number, number>({
      candidates: items,
      runOne: async (c) => {
        seen.push(c);
        return c * 2;
      },
      maxCandidatesPerRun: 4,
      concurrency: 2,
    });
    expect(out.processed).toEqual([1, 2, 3, 4]);
    expect(out.dropped).toEqual([5, 6, 7, 8, 9, 10]);
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(out.stats.processed).toBe(4);
    expect(out.stats.dropped).toBe(6);
    expect(out.stats.fulfilled).toBe(4);
  });

  it('cap of 0 → drops everything, runs nothing', async () => {
    const fn = async (n: number): Promise<number> => n;
    const out = await runFollowUpBatch<number, number>({
      candidates: [1, 2, 3],
      runOne: fn,
      maxCandidatesPerRun: 0,
    });
    expect(out.processed).toEqual([]);
    expect(out.dropped).toEqual([1, 2, 3]);
    expect(out.stats).toEqual({
      processed: 0,
      fulfilled: 0,
      rejected: 0,
      timedOut: 0,
      aborted: 0,
      dropped: 3,
    });
  });

  it('cap larger than input is harmless (clamps to length)', async () => {
    const out = await runFollowUpBatch<number, number>({
      candidates: [1, 2],
      runOne: async (c) => c,
      maxCandidatesPerRun: 100,
    });
    expect(out.processed).toEqual([1, 2]);
    expect(out.dropped).toEqual([]);
    expect(out.stats.dropped).toBe(0);
  });

  it('counts rejected and timed-out outcomes separately from fulfilled', async () => {
    const out = await runFollowUpBatch<number, string>({
      candidates: [10, 5_000, 20, -1],
      runOne: async (c, signal) => {
        if (c < 0) throw new Error(`bad-${c}`);
        await delay(c, signal);
        return `done-${c}`;
      },
      perCandidateTimeoutMs: 100,
      concurrency: 4,
    });
    expect(out.results[0]).toEqual({ status: 'fulfilled', value: 'done-10' });
    expect(out.results[1]).toEqual({ status: 'timeout' });
    expect(out.results[2]).toEqual({ status: 'fulfilled', value: 'done-20' });
    expect(out.results[3].status).toBe('rejected');
    expect(out.stats).toEqual({
      processed: 4,
      fulfilled: 2,
      rejected: 1,
      timedOut: 1,
      aborted: 0,
      dropped: 0,
    });
  });

  it('threads external abort through to the per-item signal and counts aborted', async () => {
    const controller = new AbortController();
    const promise = runFollowUpBatch<number, number>({
      candidates: [1, 2, 3, 4, 5, 6, 7, 8],
      runOne: async (c, signal) => {
        await delay(200, signal);
        return c;
      },
      concurrency: 2,
      signal: controller.signal,
    });
    await delay(20);
    controller.abort();
    const out = await promise;
    expect(out.stats.fulfilled).toBe(0);
    expect(out.stats.aborted).toBe(8);
    expect(out.stats.processed).toBe(8);
  });

  it('preserves input order in results (parallel completion does not shuffle)', async () => {
    const out = await runFollowUpBatch<number, string>({
      candidates: [50, 10, 30, 5, 20],
      runOne: async (c, signal) => {
        await delay(c, signal);
        return `t${c}`;
      },
      concurrency: 5,
    });
    expect(out.results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([
      't50',
      't10',
      't30',
      't5',
      't20',
    ]);
  });
});
