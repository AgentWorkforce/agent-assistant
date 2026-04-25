import type { ExecutionContext } from '@cloudflare/workers-types';

export interface FakeExecutionContextController {
  ctx: ExecutionContext;
  settleAll(): Promise<void>;
  pendingCount(): number;
  settledCount(): number;
}

export function createFakeExecutionContext(): FakeExecutionContextController {
  const pending: Promise<unknown>[] = [];
  let settled = 0;

  const ctx: ExecutionContext = {
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
    passThroughOnException() {
      // Queue consumers do not need Cloudflare's exception passthrough hook.
    },
    props: undefined,
  };

  return {
    ctx,
    async settleAll() {
      while (pending.length > 0) {
        const next = pending.shift();
        if (!next) {
          continue;
        }
        await next;
        settled += 1;
      }
    },
    pendingCount() {
      return pending.length;
    },
    settledCount() {
      return settled;
    },
  };
}
