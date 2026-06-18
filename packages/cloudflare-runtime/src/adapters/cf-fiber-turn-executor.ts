import type {
  ContinuationHarnessAdapter,
  ContinuationResumedTurnInput,
} from '@agent-assistant/continuation';
import type { HarnessResult } from '@agent-assistant/harness';

import type { DurableObjectStorageLike } from './cf-continuation-store.js';

/**
 * Minimal interface for the Cloudflare Flue SDK fiber context.
 * Provided by `runFiber()` — each key maps to a SQLite-backed checkpoint slot.
 */
export interface FiberContextLike {
  stash<T>(key: string, value: T): void;
  stashed<T>(key: string): T | undefined;
}

/**
 * Signature for Cloudflare's `runFiber()` from the Flue SDK.
 * Wraps an async function in a durable fiber that checkpoints to SQLite via
 * the provided Durable Object storage. If the Worker process is interrupted,
 * `runFiber` re-invokes `fn` with the same FiberContext — stashed values are
 * restored from SQLite so completed work is not repeated.
 */
export type RunFiberFn = <T>(
  storage: DurableObjectStorageLike,
  fn: (ctx: FiberContextLike) => Promise<T>,
) => Promise<T>;

export interface CfFiberTurnExecutorOptions {
  /** The underlying harness adapter that actually executes resumed turns. */
  inner: ContinuationHarnessAdapter;
  /** Durable Object storage used by runFiber for checkpointing. */
  storage: DurableObjectStorageLike;
  /**
   * The Cloudflare Flue `runFiber` function.
   * Pass `runFiber` imported from `@cloudflare/agents` (or equivalent).
   */
  runFiber: RunFiberFn;
}

/**
 * ContinuationHarnessAdapter that wraps turn execution in a Cloudflare fiber.
 *
 * Once a resumed turn completes its result is stashed to SQLite. If the
 * Worker crashes after the turn finishes but before the result is persisted to
 * the continuation store, the next invocation recovers the stashed result
 * immediately — no model or tool calls are re-issued.
 */
export class CfFiberTurnExecutor implements ContinuationHarnessAdapter {
  private readonly inner: ContinuationHarnessAdapter;
  private readonly storage: DurableObjectStorageLike;
  private readonly runFiber: RunFiberFn;

  constructor(options: CfFiberTurnExecutorOptions) {
    this.inner = options.inner;
    this.storage = options.storage;
    this.runFiber = options.runFiber;
  }

  async runResumedTurn(input: ContinuationResumedTurnInput): Promise<HarnessResult> {
    return this.runFiber(this.storage, async (ctx) => {
      const key = `turn:${input.resumedTurnId}`;
      const stashed = ctx.stashed<HarnessResult>(key);
      if (stashed !== undefined) return stashed;

      const result = await this.inner.runResumedTurn(input);
      ctx.stash(key, result);
      return result;
    });
  }
}
