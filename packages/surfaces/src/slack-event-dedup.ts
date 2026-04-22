/**
 * Slack Events API delivers retries when the receiver doesn't ack within 3s, when
 * the `x-slack-retry-num` header fires, or during at-least-once delivery windows.
 * Without dedup, a single user message produces multiple assistant replies.
 *
 * `SlackEventDedupGate` centralizes the check: given a Slack event envelope, it
 * derives a stable key (preferring `event_id`, falling back to `ts`) and consults
 * a caller-supplied store. The store interface is runtime-agnostic (Cloudflare
 * KV, Redis, Postgres, in-memory) — the same shape we use for
 * {@link ActiveThreadStore}.
 *
 * Ported from sage's `src/app/slack-state.ts` so every consumer of
 * `@agent-assistant/surfaces` gets the same guarantee.
 *
 * @see https://api.slack.com/apis/events-api#retries
 */

export interface SlackEventDedupStore {
  /**
   * Return true when the key has already been recorded (within its TTL window).
   * Returning `false` when the key has expired is expected and correct.
   */
  hasBeenProcessed(key: string): Promise<boolean>;

  /**
   * Record the key. Implementations should honor `ttlSeconds` so stale keys can
   * be garbage-collected — the gate only needs dedup inside Slack's retry window
   * (a few minutes), so callers typically pick 600s.
   */
  markProcessed(key: string, ttlSeconds: number): Promise<void>;
}

export interface SlackEventDedupInput {
  eventId?: string;
  ts?: string;
}

export interface SlackEventDedupGateOptions {
  store: SlackEventDedupStore;
  /** Dedup window. Defaults to 600s — wider than any observed Slack retry window. */
  ttlSeconds?: number;
}

export type SlackEventDedupDropReason = 'duplicate-event' | 'no-dedup-key';

export interface SlackEventDedupDecision {
  proceed: boolean;
  reason?: SlackEventDedupDropReason;
  key?: string;
}

/**
 * Derive the dedup key for a Slack event envelope. Prefers the immutable
 * `event_id` Slack assigns on delivery; falls back to the message `ts` for older
 * envelopes that lack it. Returns `undefined` when neither field is present, in
 * which case callers should let the event proceed (there's nothing safe to key
 * on — duplicates are still possible but can't be detected here).
 */
export function getSlackDeduplicationKey(event: SlackEventDedupInput): string | undefined {
  const eventId = typeof event.eventId === 'string' && event.eventId.length > 0
    ? event.eventId
    : undefined;
  if (eventId) return eventId;
  const ts = typeof event.ts === 'string' && event.ts.length > 0 ? event.ts : undefined;
  return ts;
}

export class SlackEventDedupGate {
  static readonly DEFAULT_TTL_SECONDS = 600;

  private readonly store: SlackEventDedupStore;

  private readonly ttlSeconds: number;

  constructor(options: SlackEventDedupGateOptions) {
    this.store = options.store;
    this.ttlSeconds = options.ttlSeconds ?? SlackEventDedupGate.DEFAULT_TTL_SECONDS;
  }

  /**
   * Single-call API: atomically check + claim the dedup slot. Returns a decision
   * describing whether the caller should proceed to handle the event.
   *
   * Non-atomic by design — stores are caller-supplied and may be eventually
   * consistent (KV). Duplicate deliveries within the same millisecond can slip
   * through; for strict once-only semantics layer a mutex above this gate.
   */
  async claim(event: SlackEventDedupInput): Promise<SlackEventDedupDecision> {
    const key = getSlackDeduplicationKey(event);
    if (!key) return { proceed: true, reason: 'no-dedup-key' };
    const seen = await this.store.hasBeenProcessed(key);
    if (seen) return { proceed: false, reason: 'duplicate-event', key };
    await this.store.markProcessed(key, this.ttlSeconds);
    return { proceed: true, key };
  }
}
