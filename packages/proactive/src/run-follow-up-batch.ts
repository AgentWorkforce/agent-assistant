/**
 * Bounded-parallel batch runner for per-candidate proactive work.
 *
 * Layered on top of `boundedParallel` from `@agent-assistant/coordination`
 * (since v0.4.25). Adds the per-run cap + overflow-tracking pattern that
 * sage's `runCandidatePool` shipped in PR #200, plus aggregated batch
 * stats so operators can read failure-class counts off a single object.
 *
 * What this primitive does:
 *   1. Apply a FIFO cap (`maxCandidatesPerRun`) — overflow is returned
 *      as `dropped` so the caller can preserve provenance (e.g. sage
 *      seeds `deferredSessionIds` with sliced-off signal candidates so
 *      `clearProcessedSignals` doesn't remove them from the inbox).
 *   2. Run the surviving candidates through `boundedParallel` with the
 *      configured concurrency, per-candidate timeout, and external
 *      AbortSignal.
 *   3. Return a structured result: per-item outcomes (preserving order)
 *      plus an aggregated `stats` block for /health-style surfaces.
 *
 * What this primitive deliberately does NOT do:
 *   - The per-candidate pipeline itself (evidence collection, LLM
 *     verification, policy gate, post, persistence). Caller's `runOne`
 *     owns that. Keeping the primitive thin lets each AA surface compose
 *     its own pipeline without dragging the whole follow-up loop into AA.
 *   - Sort the candidates. Caller controls ordering; the cap takes the
 *     prefix. Pass FIFO-sorted input for "oldest first" behavior.
 *   - Dedup. Caller dedups before passing in (sage uses thread/session
 *     identity which is sage-specific).
 */

import {
  boundedParallel,
  type BoundedParallelResult,
} from '@agent-assistant/coordination';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_PER_CANDIDATE_TIMEOUT_MS = 8_000;

export interface RunFollowUpBatchInput<C, R> {
  /**
   * Candidates to process this run, already sorted + deduped by the caller.
   * The first `maxCandidatesPerRun` items are run; the remainder is
   * returned as `dropped` for caller-side overflow handling.
   */
  candidates: ReadonlyArray<C>;
  /**
   * Per-candidate work. Receives an AbortSignal that fires on per-candidate
   * timeout OR external batch abort — propagate it to inner `fetch(..., { signal })`
   * calls so they cancel cleanly.
   */
  runOne: (candidate: C, signal: AbortSignal) => Promise<R>;
  /** Bounded concurrency for the batch. Default 5. */
  concurrency?: number;
  /** Per-candidate budget in ms. Default 8000. */
  perCandidateTimeoutMs?: number;
  /**
   * FIFO cap on candidates processed this run. Items beyond the cap are
   * returned in `dropped` for the caller to handle (re-queue, defer,
   * etc.). Default: no cap (every candidate runs).
   */
  maxCandidatesPerRun?: number;
  /**
   * Optional batch-level AbortSignal. Cancels in-flight workers AND drops
   * pending items as `{ status: 'aborted' }` without ever calling `runOne`.
   */
  signal?: AbortSignal;
}

export interface RunFollowUpBatchStats {
  /** Number of candidates handed to the pool (post-cap). */
  processed: number;
  /** Number whose `runOne` resolved successfully. */
  fulfilled: number;
  /** Number whose `runOne` rejected with a non-abort, non-timeout error. */
  rejected: number;
  /** Number that exceeded `perCandidateTimeoutMs`. */
  timedOut: number;
  /** Number aborted via the external `signal`. */
  aborted: number;
  /** Number sliced off by `maxCandidatesPerRun`. */
  dropped: number;
}

export interface RunFollowUpBatchResult<C, R> {
  /** Per-item outcomes, in input order, for the processed prefix. */
  results: BoundedParallelResult<R>[];
  /** Candidates handed to the pool (the `processed` prefix). */
  processed: ReadonlyArray<C>;
  /**
   * Candidates that overflowed `maxCandidatesPerRun`. Caller decides
   * whether to defer, re-queue, or surface them in operator output.
   */
  dropped: ReadonlyArray<C>;
  /** Aggregated counts for /health-style surfaces. */
  stats: RunFollowUpBatchStats;
}

export async function runFollowUpBatch<C, R>(
  input: RunFollowUpBatchInput<C, R>,
): Promise<RunFollowUpBatchResult<C, R>> {
  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
  const perCandidateTimeoutMs = input.perCandidateTimeoutMs ?? DEFAULT_PER_CANDIDATE_TIMEOUT_MS;
  const cap = input.maxCandidatesPerRun ?? input.candidates.length;
  const safeCap = Math.max(0, Math.min(cap, input.candidates.length));

  const processed = input.candidates.slice(0, safeCap);
  const dropped = input.candidates.slice(safeCap);

  const results =
    processed.length === 0
      ? []
      : await boundedParallel<C, R>(processed, input.runOne, {
          concurrency,
          perItemTimeoutMs: perCandidateTimeoutMs,
          ...(input.signal ? { signal: input.signal } : {}),
        });

  const stats: RunFollowUpBatchStats = {
    processed: processed.length,
    fulfilled: 0,
    rejected: 0,
    timedOut: 0,
    aborted: 0,
    dropped: dropped.length,
  };
  for (const result of results) {
    switch (result.status) {
      case 'fulfilled':
        stats.fulfilled += 1;
        break;
      case 'rejected':
        stats.rejected += 1;
        break;
      case 'timeout':
        stats.timedOut += 1;
        break;
      case 'aborted':
        stats.aborted += 1;
        break;
    }
  }

  return { results, processed, dropped, stats };
}
