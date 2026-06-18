import type {
  ContinuationHarnessAdapter,
  ContinuationResumedTurnInput,
} from '@agent-assistant/continuation';
import type { HarnessResult } from '@agent-assistant/harness';

import type { FirestoreCollectionLike } from './gcp-firestore-session-store-adapter.js';

export interface GcpIdempotentTurnExecutorOptions {
  /** The underlying harness adapter that executes resumed turns. */
  inner: ContinuationHarnessAdapter;
  /**
   * Firestore collection used to stash completed turn results.
   * Documents are keyed by resumedTurnId and contain { result: HarnessResult }.
   * TTL policy on this collection is recommended (e.g. 24 hours).
   */
  stashCollection: FirestoreCollectionLike<{ result: HarnessResult }>;
}

/**
 * ContinuationHarnessAdapter that makes resumed turns idempotent via Firestore.
 *
 * Equivalent to CfFiberTurnExecutor from the Cloudflare adapter — same safety
 * guarantee, different storage backend. If the process dies after a turn
 * completes but before the result is written to the continuation store, the
 * next attempt finds the stashed result in Firestore and returns it immediately
 * without re-running model or tool calls.
 */
export class GcpIdempotentTurnExecutor implements ContinuationHarnessAdapter {
  private readonly inner: ContinuationHarnessAdapter;
  private readonly stash: FirestoreCollectionLike<{ result: HarnessResult }>;

  constructor(options: GcpIdempotentTurnExecutorOptions) {
    this.inner = options.inner;
    this.stash = options.stashCollection;
  }

  async runResumedTurn(input: ContinuationResumedTurnInput): Promise<HarnessResult> {
    const ref = this.stash.doc(input.resumedTurnId);
    const snap = await ref.get();

    if (snap.exists) {
      const stashed = snap.data();
      if (stashed) return stashed.result;
    }

    const result = await this.inner.runResumedTurn(input);
    await ref.set({ result });
    return result;
  }
}
