/**
 * Bounded-parallel batch runner with per-item timeout and AbortSignal support.
 *
 * Captures the structural fix from sage's proactive follow-ups loop (PR #200,
 * `runCandidatePool` in src/proactive/follow-up-checker.ts) as a reusable
 * primitive. Every AA consumer that processes a batch of independent items
 * — proactive follow-ups, evidence collection, batched memory recall — can
 * lean on this instead of reimplementing the worker-pool pattern.
 *
 * Properties:
 *   - Bounded concurrency: at most `concurrency` items in flight at any time.
 *     Default 5, picked to leave headroom under Cloudflare Workers' ~6
 *     concurrent outbound HTTP cap (see sage's `.claude/rules/workers-fetch.md`).
 *   - Per-item timeout: items exceeding `perItemTimeoutMs` resolve as
 *     `{ status: 'timeout' }` and the inner `fn` receives an aborted
 *     AbortSignal so it can cancel any in-flight work cleanly.
 *   - Batch-level abort: an external `signal` cancels in-flight workers
 *     (via the per-item signal) AND drops any pending items as
 *     `{ status: 'aborted' }` without ever calling `fn`.
 *   - Settled-not-thrown: like Promise.allSettled, individual rejections do
 *     NOT abort the batch — they surface as `{ status: 'rejected', reason }`
 *     entries. The whole-batch abort is the only mechanism that stops
 *     processing.
 *
 * Returns results in the same order as `items`. Empty input returns an empty
 * array without spawning workers.
 */

const DEFAULT_CONCURRENCY = 5;

export interface BoundedParallelOptions {
  /**
   * Maximum number of in-flight tasks. Capped at `items.length`. Defaults to
   * {@link DEFAULT_CONCURRENCY} (5).
   */
  concurrency?: number;
  /**
   * Per-item budget in milliseconds. When set, items that don't resolve
   * within this window settle as `{ status: 'timeout' }`. The per-item
   * AbortSignal handed to `fn` aborts when the timeout fires, so inner
   * `fetch(..., { signal })` calls can cancel cleanly.
   */
  perItemTimeoutMs?: number;
  /**
   * Optional batch-level AbortSignal. When it aborts:
   *   - In-flight items see their per-item signal abort (combined with
   *     this one) and settle as either `{ status: 'aborted' }` if `fn`
   *     propagates the abort, or `{ status: 'rejected' }` if `fn` swallows
   *     the abort and rejects with something else.
   *   - Pending items (not yet picked up by a worker) settle as
   *     `{ status: 'aborted' }` without ever calling `fn`.
   */
  signal?: AbortSignal;
}

export type BoundedParallelResult<R> =
  | { status: 'fulfilled'; value: R }
  | { status: 'rejected'; reason: unknown }
  | { status: 'timeout' }
  | { status: 'aborted' };

/**
 * Sentinel reason used by the per-item timeout AbortController so callers
 * can distinguish a timeout abort from an external batch-level abort.
 */
export const BOUNDED_PARALLEL_TIMEOUT_REASON = Symbol(
  '@agent-assistant/coordination:bounded-parallel:timeout',
);

/**
 * Sentinel reason used by the per-item AbortController when the external
 * batch-level `signal` aborts.
 */
export const BOUNDED_PARALLEL_ABORTED_REASON = Symbol(
  '@agent-assistant/coordination:bounded-parallel:aborted',
);

function isAbortLike(reason: unknown, sentinel: symbol): boolean {
  if (reason === sentinel) return true;
  if (reason instanceof Error && (reason.name === 'AbortError' || reason.name === 'TimeoutError')) {
    return true;
  }
  return false;
}

function settleAfterAbort<R>(
  reason: unknown,
  externalSignal: AbortSignal | undefined,
): BoundedParallelResult<R> {
  // Distinguish a per-item timeout abort from a batch-level abort. The
  // external signal aborting mid-flight always wins the classification —
  // the user-facing intent was "stop the batch", and a coincident timeout
  // shouldn't relabel that as a per-item failure.
  if (externalSignal?.aborted) return { status: 'aborted' };
  if (isAbortLike(reason, BOUNDED_PARALLEL_TIMEOUT_REASON)) return { status: 'timeout' };
  if (isAbortLike(reason, BOUNDED_PARALLEL_ABORTED_REASON)) return { status: 'aborted' };
  return { status: 'rejected', reason };
}

export async function boundedParallel<T, R>(
  items: ReadonlyArray<T>,
  fn: (item: T, signal: AbortSignal) => Promise<R>,
  options: BoundedParallelOptions = {},
): Promise<BoundedParallelResult<R>[]> {
  if (items.length === 0) return [];

  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, items.length),
  );
  const externalSignal = options.signal;
  const perItemTimeoutMs = options.perItemTimeoutMs;

  const results = new Array<BoundedParallelResult<R>>(items.length);

  // If the batch is aborted before we even start, settle every item without
  // spawning workers. Cheaper than creating N AbortControllers just to
  // tear them down.
  if (externalSignal?.aborted) {
    for (let i = 0; i < items.length; i += 1) {
      results[i] = { status: 'aborted' };
    }
    return results;
  }

  let nextIndex = 0;

  async function runOne(index: number): Promise<void> {
    // If the batch was aborted while this item sat in the queue, mark it
    // aborted without ever calling `fn`. Pending items pay zero cost when
    // the operator yanks the cord.
    if (externalSignal?.aborted) {
      results[index] = { status: 'aborted' };
      return;
    }

    const controller = new AbortController();
    const onExternalAbort = (): void => {
      controller.abort(BOUNDED_PARALLEL_ABORTED_REASON);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (perItemTimeoutMs !== undefined && perItemTimeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        controller.abort(BOUNDED_PARALLEL_TIMEOUT_REASON);
      }, perItemTimeoutMs);
    }

    try {
      const item = items[index] as T;
      const value = await fn(item, controller.signal);
      results[index] = { status: 'fulfilled', value };
    } catch (reason) {
      results[index] = settleAfterAbort<R>(reason, externalSignal);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await runOne(index);
      }
    }),
  );

  return results;
}
