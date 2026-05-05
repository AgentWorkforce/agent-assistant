/**
 * Best-effort operational counter for proactive surfaces. Lets sage (and
 * future AA consumers) record that a proactive action was blocked or
 * degraded without coupling to a specific storage backend.
 *
 * Adapter implementations live in the consuming app — sage's KV-backed
 * implementation is at `src/cloudflare/kv-proactive-block-counter.ts`. The
 * `/api/proactive/health` route reads a sliding 24-hour count off the
 * adapter to surface degraded states to operators.
 *
 * Conventions:
 *   - Increment is fire-and-forget. Errors thrown by the adapter MUST be
 *     swallowed by the caller so a flaky counter never blocks a proactive
 *     decision. The contract is "do your best to record".
 *   - Event names are short snake_case strings. Common values include
 *     `follow_up_post_blocked`, `follow_up_verification_degraded`,
 *     `pr_match_post_blocked`, `pr_match_verification_degraded`,
 *     `specialist_unavailable`, `github_specialist_sync_verification_degraded`.
 *     Adapters do not validate the value — adding new events is just a
 *     matter of calling `increment(newName)`.
 *   - `countLast24h` returns a sliding window count. Implementations may
 *     bucket arbitrarily (per-hour KV keys are typical) but the surface
 *     guarantees a 24-hour window.
 */

export interface ProactiveBlockCounter {
  increment(event: string): Promise<void>;
}

export interface ProactiveBlockCounterReader {
  countLast24h(event: string): Promise<number>;
}
