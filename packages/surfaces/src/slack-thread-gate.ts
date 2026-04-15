/**
 * SlackThreadGate — decides whether an agent should respond to an inbound Slack event.
 *
 * Rules:
 *   1. @-mentions always proceed, and the thread is marked active so follow-up replies
 *      in the same thread are also processed.
 *   2. Thread replies (non-mention message events with a thread_ts) only proceed if
 *      the thread was previously engaged by a mention. Otherwise they are dropped.
 *   3. Non-thread message events (no thread_ts) proceed — callers may gate further.
 *
 * Active-thread state is keyed by the composite {workspaceId, channel, threadTs}.
 * Slack's `thread_ts` is only unique within a channel — across workspaces or channels
 * a bare-ts lookup would let a mention in one channel unlock unrelated threads in
 * another. The store is caller-supplied (Cloudflare KV, Redis, in-memory, etc.) so
 * the gate is runtime-agnostic; callers join the key fields into their native key
 * format (e.g. `${workspaceId}:${channel}:${threadTs}`).
 */

export interface ActiveThreadContext {
  workspaceId: string;
  channel: string;
}

export interface ActiveThreadKey extends ActiveThreadContext {
  threadTs: string;
}

export interface ActiveThreadStore {
  isActive(key: ActiveThreadKey): Promise<boolean>;
  markActive(key: ActiveThreadKey, ttlSeconds: number): Promise<void>;
}

export interface ThreadGateEvent {
  type: "mention" | "message" | string;
  channel: string;
  threadTs?: string;
  ts?: string;
}

export type ThreadGateDropReason = "inactive-thread";

export interface ThreadGateDecision {
  proceed: boolean;
  reason?: ThreadGateDropReason;
}

export interface SlackThreadGateOptions {
  store: ActiveThreadStore;
  /** Active-thread TTL. Defaults to 86_400 (24h). */
  ttlSeconds?: number;
}

export class SlackThreadGate {
  private readonly store: ActiveThreadStore;
  private readonly ttlSeconds: number;

  constructor(options: SlackThreadGateOptions) {
    this.store = options.store;
    this.ttlSeconds = options.ttlSeconds ?? 86_400;
  }

  async shouldProcess(
    event: ThreadGateEvent,
    workspaceId: string,
  ): Promise<ThreadGateDecision> {
    if (event.type === "message" && event.threadTs) {
      const active = await this.store.isActive({
        workspaceId,
        channel: event.channel,
        threadTs: event.threadTs,
      });
      if (!active) {
        return { proceed: false, reason: "inactive-thread" };
      }
    }
    return { proceed: true };
  }

  async onEngaged(event: ThreadGateEvent, workspaceId: string): Promise<void> {
    if (event.type !== "mention") return;
    const threadTs = event.threadTs ?? event.ts;
    if (!threadTs) return;
    await this.store.markActive(
      { workspaceId, channel: event.channel, threadTs },
      this.ttlSeconds,
    );
  }

  async refresh(key: ActiveThreadKey): Promise<void> {
    await this.store.markActive(key, this.ttlSeconds);
  }
}
