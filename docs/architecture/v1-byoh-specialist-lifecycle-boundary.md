# v1 BYOH Specialist Lifecycle Hardening Boundary

**Date:** 2026-04-15
**Status:** IMPLEMENTATION_READY
**Depends on:**
- `docs/architecture/v1-byoh-relay-native-followup-boundary.md`
- `docs/architecture/v1-byoh-relay-native-followup-review-verdict.md`

---

## 1. Purpose

Harden the Relay-native specialist lifecycle so the proof is not just Relay-central, but Relay-correct under failure and concurrency. The prior slice made Relay structurally mandatory. This slice makes the specialist path fully awaited, failure-transparent, and thread-isolated.

After this slice, a specialist failure propagates to the orchestrator, concurrent proof runs on the same channel do not cross-consume messages, and `start()` represents the complete receive/validate/publish lifecycle rather than only setup.

---

## 2. Problem statement from review verdict

The follow-up review verdict (PARTIAL_ACCEPT) identified two structural gaps:

1. **High: Specialist execution is detached and its failures are swallowed.** In `validation-specialist.ts:210`, `start()` returns after registration/subscription setup, then launches the actual wait/validate/publish flow in a fire-and-forget async block. That block ends with `.catch(() => undefined)` at `validation-specialist.ts:263`, so validation/publish failures are suppressed. `runByohLocalProof()` then treats `await handlerPromise` as if the specialist flow had completed at `byoh-local-proof.ts:487`. The orchestrator only waits for a verdict timeout, not for specialist success/failure.

2. **Medium: The specialist subscription is channel-wide rather than thread-scoped.** The specialist filter only checks `type === 'execution-result'` at `validation-specialist.ts:217`, while the orchestrator verdict subscription is thread-filtered at `byoh-local-proof.ts:466`. Concurrent proofs on the same channel can cross-consume execution results.

---

## 3. Architectural decision

This slice refactors the specialist lifecycle so that:

> **`start()` returns a promise that resolves when the specialist has completed its full receive/validate/publish cycle, or rejects with the actual failure. The specialist subscription is thread-scoped. The orchestrator awaits the specialist lifecycle promise and surfaces its errors.**

This slice does NOT:
- replace `@agent-assistant/coordination` or `@agent-assistant/connectivity`
- add new external backends
- change the execution-adapter seam or Claude Code adapter
- modify any package outside `packages/harness/src/adapter/proof/`
- change the message protocol types (`RelayExecutionResultMessage`, `RelayValidationVerdictMessage`)
- alter the `ProofRelayTransport` interface

---

## 4. Current defects (code-level)

### 4.1 Detached specialist lifecycle

**Location:** `validation-specialist.ts:210-263`

```ts
// CURRENT: start() resolves after setup, lifecycle is fire-and-forget
async start() {
  await config.relay.registerAgent({ ... });
  const subscription = config.relay.subscribe({ ... });
  unsubscribe = () => subscription.unsubscribe();

  // Fire-and-forget: errors suppressed, not awaitable
  void (async () => {
    const message = await subscription.waitForMessage(timeoutMs);
    // ... validate and publish ...
  })().catch(() => undefined);
}
```

**Problem:** The caller of `start()` gets a resolved promise that means "setup is done," not "the specialist finished its work." The `.catch(() => undefined)` swallows every error: timeout, parse failure, publish failure, and runtime exceptions.

### 4.2 Channel-wide specialist subscription

**Location:** `validation-specialist.ts:220-225`

```ts
// CURRENT: filters on type only, no thread scoping
filter(message) {
  try {
    const parsed = JSON.parse(message.text) as Partial<RelayExecutionResultMessage>;
    return parsed.type === 'execution-result';
  } catch {
    return false;
  }
}
```

**Problem:** If two proof runs share a channel with different threadIds, the specialist can consume the wrong execution result.

### 4.3 Orchestrator awaits setup, not lifecycle

**Location:** `byoh-local-proof.ts:487-492`

```ts
// CURRENT: handlerPromise resolves when start() completes setup
const handlerPromise = validationHandler.start();
// ...
await handlerPromise; // This resolves immediately after registration/subscription
```

**Problem:** The orchestrator believes the specialist is "done" when it has only set up its subscription. The specialist's actual work runs in a detached async block.

---

## 5. Revised specialist lifecycle

### 5.1 `RelayValidationHandler` interface change

```ts
export interface RelayValidationHandler {
  /**
   * Registers the specialist, subscribes to the channel, waits for an
   * execution-result message, validates it, publishes the verdict, and
   * resolves. Rejects on any failure in the lifecycle.
   */
  start(): Promise<RelayValidationHandlerOutcome>;
  stop(): void;
}

export interface RelayValidationHandlerOutcome {
  verdictPublished: boolean;
  verdictEventId?: string;
  error?: Error;
}
```

Key change: `start()` now returns a promise that encompasses the **entire** lifecycle — registration, subscription, receive, validate, publish. It does not resolve after setup. It resolves after the verdict is published, or rejects if any step fails.

### 5.2 Revised `createRelayValidationHandler`

```ts
export function createRelayValidationHandler(config: {
  connectivity: ConnectivityLayer;
  relay: ProofRelayTransport;
  channelId: string;
  threadId: string;           // used for thread-scoped filtering
  specialistName?: string;
  timeoutMs?: number;
}): RelayValidationHandler {
  // ...
  return {
    async start() {
      // 1. Register
      await config.relay.registerAgent({ ... });

      // 2. Subscribe with thread-scoped filter
      const subscription = config.relay.subscribe({
        channel: config.channelId,
        agentId: specialistName,
        filter(message) {
          try {
            const parsed = JSON.parse(message.text);
            return (
              parsed.type === 'execution-result' &&
              parsed.threadId === config.threadId    // <-- thread scoping
            );
          } catch {
            return false;
          }
        },
      });
      unsubscribe = () => subscription.unsubscribe();

      // 3. Wait for execution result (throws on timeout)
      const message = await subscription.waitForMessage(timeoutMs);
      if (stopped) {
        return { verdictPublished: false };
      }

      // 4. Validate (no try/catch suppression — errors propagate)
      const payload = JSON.parse(message.text);
      const verdict = validateExecutionResult(
        JSON.stringify(payload.executionResult),
        { connectivity: config.connectivity, threadId: payload.threadId, specialistName },
      );

      // 5. Publish verdict (errors propagate)
      const published = await config.relay.publish({
        channel: config.channelId,
        threadId: config.threadId,
        from: specialistName,
        text: JSON.stringify(verdictMessage),
      });

      return {
        verdictPublished: true,
        verdictEventId: published.eventId,
      };
    },
    stop() { ... },
  };
}
```

Critical differences from current code:
1. **No fire-and-forget.** The entire receive/validate/publish flow is in the `start()` body.
2. **No `.catch(() => undefined)`.** Errors propagate to the caller.
3. **Thread-scoped filter.** The subscription filter checks both `type === 'execution-result'` AND `threadId === config.threadId`.
4. **Returns outcome.** The caller knows whether the verdict was published and gets the event ID.

### 5.3 Revised orchestrator flow in `runByohLocalProof`

```ts
// Start specialist lifecycle (does not resolve until verdict is published or error)
const handlerPromise = validationHandler.start();

// Publish execution result
const published = await config.relay.publish({ ... });

// Wait for verdict from Relay
const verdictMessage = await verdictSubscription.waitForMessage(timeoutMs);

// Await specialist lifecycle completion (surfaces errors)
const handlerOutcome = await handlerPromise;
```

Critical differences:
1. `handlerPromise` is started before `publish` so the specialist is subscribed before the message arrives.
2. The orchestrator awaits `handlerPromise` **after** receiving the verdict, so specialist errors surface even if the verdict arrived.
3. If the specialist fails, `handlerPromise` rejects and the error propagates to the caller of `runByohLocalProof`.

### 5.4 Orchestrator verdict subscription — thread-scoped (already correct)

The orchestrator's verdict subscription at `byoh-local-proof.ts:466` already filters on `parsed.threadId === threadId`. No change needed.

---

## 6. Thread isolation model

### 6.1 Subscription scoping

| Participant | Current filter | Revised filter |
|---|---|---|
| Specialist (execution-result) | `type === 'execution-result'` | `type === 'execution-result' && threadId === config.threadId` |
| Orchestrator (validation-verdict) | `type === 'validation-verdict' && threadId === threadId` | unchanged |

After this slice, both subscriptions are thread-scoped. Two proof runs on the same channel with different threadIds will not interfere.

### 6.2 Concurrency model

The proof harness is single-run by design. Thread scoping does not enable arbitrary concurrency — it prevents cross-talk when the same channel is reused across sequential or overlapping test runs. The proof does not claim to support concurrent production workloads on a single channel.

---

## 7. Error propagation model

### 7.1 Specialist errors

| Error source | Current behavior | Revised behavior |
|---|---|---|
| Timeout waiting for execution-result | Swallowed by `.catch(() => undefined)` | `start()` rejects with timeout error |
| JSON parse failure on received message | Swallowed | `start()` rejects with parse error |
| Validation logic throws | Swallowed | `start()` rejects with validation error |
| Publish verdict fails | Swallowed | `start()` rejects with publish error |
| `stop()` called before completion | Swallowed (returns silently) | `start()` resolves with `{ verdictPublished: false }` |

### 7.2 Orchestrator error handling

The orchestrator wraps `handlerPromise` in the existing `try/finally` block. If the specialist rejects, the error propagates as a rejection of `runByohLocalProof()`. The `finally` block still calls `validationHandler.stop()` and `verdictSubscription.unsubscribe()`.

### 7.3 No new error types

No custom error classes are introduced. Standard `Error` instances with descriptive messages are sufficient for the proof harness.

---

## 8. Exact implementation files

### 8.1 Files to modify

#### `packages/harness/src/adapter/proof/validation-specialist.ts`

Changes:
1. Add `RelayValidationHandlerOutcome` interface export
2. Rewrite `createRelayValidationHandler().start()` to encompass the full lifecycle (no fire-and-forget, no `.catch(() => undefined)`)
3. Add `threadId` matching to the specialist subscription filter
4. Return `RelayValidationHandlerOutcome` from `start()` instead of `void`
5. Preserve `createValidationSpecialist()` and all internal validation logic unchanged

#### `packages/harness/src/adapter/proof/byoh-local-proof.ts`

Changes:
1. Update `import` of `RelayValidationHandler` if its shape changes (add `RelayValidationHandlerOutcome`)
2. Update the orchestrator flow in `runByohLocalProof()`:
   - Await `handlerPromise` as `RelayValidationHandlerOutcome` after verdict receipt
   - Use `handlerOutcome.verdictEventId` if available
   - Let specialist errors propagate (no new suppression)
3. Optionally add `specialistOutcome` to `ByohLocalProofResult` for observability

#### `packages/harness/src/adapter/proof/byoh-local-proof.test.ts`

Changes:
1. Add test: specialist timeout error propagates to `runByohLocalProof` rejection
2. Add test: specialist publish failure propagates to `runByohLocalProof` rejection
3. Add test: concurrent proof runs on the same channel with different threadIds do not cross-consume
4. Add test: message with mismatched threadId is ignored by the specialist
5. Existing tests remain unchanged (the happy path is unaffected)

### 8.2 Files NOT modified

- `packages/harness/src/adapter/types.ts`
- `packages/harness/src/adapter/claude-code-adapter.ts`
- `packages/harness/src/adapter/claude-code-adapter.test.ts`
- `packages/harness/src/adapter/index.ts`
- `packages/harness/src/index.ts`
- All packages outside `packages/harness/src/adapter/proof/`

---

## 9. Test plan summary

### 9.1 Existing tests (no regression)

All four scenario tests continue to pass. The happy path is unchanged — `start()` still resolves after the specialist publishes its verdict. The only difference is that `start()` now resolves with `RelayValidationHandlerOutcome` instead of `void`.

### 9.2 New tests

| Test | Purpose | Mechanism |
|---|---|---|
| Specialist timeout propagates | Prove errors are not swallowed | Drop execution-result delivery; expect `runByohLocalProof` rejection with timeout message |
| Specialist publish failure propagates | Prove publish errors surface | Mock relay.publish to reject on verdict; expect rejection |
| Thread-scoped isolation | Prove concurrent safety | Run two proofs on same channel with different threadIds; verify each gets its own verdict |
| Mismatched threadId ignored | Prove filter correctness | Publish execution-result with wrong threadId; specialist ignores it and times out |

---

## 10. Acceptance criteria

1. `createRelayValidationHandler().start()` resolves only after the full receive/validate/publish lifecycle completes, or rejects on failure
2. No `.catch(() => undefined)` or equivalent error suppression exists in the specialist path
3. The specialist subscription filter includes `threadId === config.threadId`
4. A test proves that specialist timeout errors propagate to `runByohLocalProof`
5. A test proves that mismatched-thread messages are ignored
6. All pre-existing tests pass without modification
7. `tsc -p tsconfig.json` passes
8. `vitest run` passes

---

## 11. Out of scope

- Multi-message specialist flows (the specialist handles one execution-result per lifecycle)
- Specialist retry or reconnection logic
- Channel management (create/destroy channels)
- Any changes to packages outside `packages/harness/src/adapter/proof/`
- Production concurrency guarantees (this is proof hardening, not production scaling)
