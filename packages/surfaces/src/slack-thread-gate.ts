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
 * The store is caller-supplied (Cloudflare KV, Redis, in-memory, etc.) so the gate is
 * runtime-agnostic. Every Slack-surfaced agent should use this instead of inlining the
 * same KV reads/writes in its webhook handler.
 */

export interface ActiveThreadContext {
  workspaceId: string;
  channel: string;
}

export interface ActiveThreadStore {
  isActive(threadTs: string): Promise<boolean>;
  markActive(threadTs: string, ctx: ActiveThreadContext, ttlSeconds: number): Promise<void>;
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

  async shouldProcess(event: ThreadGateEvent): Promise<ThreadGateDecision> {
    if (event.type === "message" && event.threadTs) {
      const active = await this.store.isActive(event.threadTs);
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
      threadTs,
      { workspaceId, channel: event.channel },
      this.ttlSeconds,
    );
  }

  async refresh(threadTs: string, ctx: ActiveThreadContext): Promise<void> {
    await this.store.markActive(threadTs, ctx, this.ttlSeconds);
  }
}
