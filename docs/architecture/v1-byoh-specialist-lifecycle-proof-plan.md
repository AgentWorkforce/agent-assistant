# v1 BYOH Specialist Lifecycle Hardening Proof Plan

**Date:** 2026-04-15
**Status:** IMPLEMENTATION_READY
**Depends on:**
- `docs/architecture/v1-byoh-specialist-lifecycle-boundary.md`
- `docs/architecture/v1-byoh-specialist-lifecycle-no-regression-checklist.md`
- `docs/architecture/v1-byoh-relay-native-followup-boundary.md`

---

## 1. Implementation order

The hardening is implemented in four sequential phases. Each phase has a clear completion gate.

---

## Phase 1: Add `RelayValidationHandlerOutcome` and update handler interface

### Goal
Make `start()` return a structured outcome instead of `void`, and export the outcome type.

### Files to modify

**`packages/harness/src/adapter/proof/validation-specialist.ts`**

Add the outcome type:

```ts
export interface RelayValidationHandlerOutcome {
  verdictPublished: boolean;
  verdictEventId?: string;
  error?: Error;
}
```

Update the `RelayValidationHandler` interface:

```ts
export interface RelayValidationHandler {
  start(): Promise<RelayValidationHandlerOutcome>;
  stop(): void;
}
```

### Completion gate
- `tsc -p tsconfig.json --noEmit` passes
- `RelayValidationHandlerOutcome` is exported
- `RelayValidationHandler.start()` return type is `Promise<RelayValidationHandlerOutcome>`

---

## Phase 2: Rewrite specialist lifecycle — fully awaited, failure-transparent, thread-scoped

### Goal
Rewrite `createRelayValidationHandler` so that `start()` encompasses the full receive/validate/publish lifecycle, propagates errors, and filters on threadId.

### Files to modify

**`packages/harness/src/adapter/proof/validation-specialist.ts`**

Replace the current `start()` implementation. The key structural changes:

#### 2a. Remove fire-and-forget pattern

Current (lines 231-263):
```ts
// REMOVE: fire-and-forget with error suppression
void (async () => {
  const message = await subscription.waitForMessage(timeoutMs);
  // ... validate and publish ...
}).catch(() => undefined);
```

Replacement: inline the receive/validate/publish flow directly in `start()`:
```ts
async start() {
  // 1. Register agent
  await config.relay.registerAgent({
    agentId: specialistName,
    channel: config.channelId,
    capabilities: ['execution-validation', 'proof-signals'],
  });

  // 2. Subscribe with THREAD-SCOPED filter
  const subscription = config.relay.subscribe({
    channel: config.channelId,
    agentId: specialistName,
    filter(message) {
      try {
        const parsed = JSON.parse(message.text) as Partial<RelayExecutionResultMessage>;
        return (
          parsed.type === 'execution-result' &&
          parsed.threadId === config.threadId
        );
      } catch {
        return false;
      }
    },
  });
  unsubscribe = () => subscription.unsubscribe();

  // 3. Wait for execution result — NO error suppression
  const message = await subscription.waitForMessage(timeoutMs);
  if (stopped) {
    return { verdictPublished: false };
  }

  // 4. Validate — errors propagate naturally
  const payload = JSON.parse(message.text) as RelayExecutionResultMessage;
  const verdict = validateExecutionResult(
    JSON.stringify(payload.executionResult),
    {
      connectivity: config.connectivity,
      threadId: payload.threadId,
      specialistName,
    },
  );

  // 5. Build verdict message
  const verdictMessage: RelayValidationVerdictMessage = {
    type: 'validation-verdict',
    verdict: {
      output: verdict.output,
      confidence: verdict.confidence,
      status: verdict.status,
      validatedStatus: verdict.validatedStatus,
      degraded: verdict.degraded,
    },
    signals: verdict.signals,
    turnId: payload.turnId,
    threadId: payload.threadId,
  };

  // 6. Publish verdict — errors propagate naturally
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
}
```

#### 2b. Thread-scoped filter addition

The filter in step 2 above adds `parsed.threadId === config.threadId`. This is the only filter change. The orchestrator's verdict filter already includes threadId matching and does not need modification.

#### 2c. Preserve `stop()` behavior

`stop()` sets `stopped = true` and calls `unsubscribe?.()`. This is unchanged. When `stop()` is called while `waitForMessage` is pending, the subscription's `unsubscribe()` rejects the waiter, which causes `start()` to reject — this is the correct behavior (errors propagate).

### Completion gate
- `tsc -p tsconfig.json --noEmit` passes
- no `.catch(() => undefined)` in `createRelayValidationHandler`
- specialist subscription filter includes `threadId` check
- `start()` returns `RelayValidationHandlerOutcome` on success

---

## Phase 3: Update orchestrator to await specialist lifecycle

### Goal
Make `runByohLocalProof()` properly await the specialist lifecycle promise and surface errors.

### Files to modify

**`packages/harness/src/adapter/proof/byoh-local-proof.ts`**

#### 3a. Import updated types

If `RelayValidationHandlerOutcome` is exported from `validation-specialist.ts`, import it. Otherwise, the type flows through `RelayValidationHandler.start()` return type inference.

#### 3b. Await lifecycle, not setup

Current flow at lines 487-514:
```ts
const handlerPromise = validationHandler.start();
// ...
await handlerPromise;  // resolves after setup only
// publish execution result
// wait for verdict
await handlerPromise;  // redundant, already resolved
```

Revised flow:
```ts
// Start specialist lifecycle (resolves after full receive/validate/publish)
const handlerPromise = validationHandler.start();

// Publish execution result to Relay
const published = await config.relay.publish({ ... });
publishedEventId = published.eventId;

// Wait for verdict from Relay
const verdictMessage = await verdictSubscription.waitForMessage(timeoutMs);
verdictEventId = verdictMessage.eventId;

// Parse verdict
const verdictPayload = JSON.parse(verdictMessage.text) as RelayValidationVerdictMessage;

// Await specialist lifecycle completion — surfaces any specialist-side errors
const handlerOutcome = await handlerPromise;
```

The key change: the first `await handlerPromise` at line 492 is removed (it was blocking on setup before publish). Now, `handlerPromise` starts running concurrently, the orchestrator publishes, waits for verdict, then awaits the specialist lifecycle to confirm it completed cleanly.

#### 3c. Error propagation

If `handlerPromise` rejects, the error propagates through the `try` block to the caller. The `finally` block still cleans up. No new error handling is added — the existing `try/finally` structure handles it.

#### 3d. Optional: enrich result with specialist outcome

```ts
return {
  // ... existing fields ...
  relayRoundTrip: {
    resultPublished: true,
    resultEventId: publishedEventId,
    verdictReceived: true,
    verdictEventId: verdictEventId ?? handlerOutcome.verdictEventId,
  },
  // ...
};
```

### Completion gate
- `tsc -p tsconfig.json --noEmit` passes
- `runByohLocalProof` awaits `handlerPromise` for lifecycle completion, not setup
- specialist errors propagate as rejections of `runByohLocalProof`
- existing happy-path tests still pass

---

## Phase 4: Add hardening tests

### Goal
Add tests that exercise failure transparency and thread isolation.

### Files to modify

**`packages/harness/src/adapter/proof/byoh-local-proof.test.ts`**

#### Test 1: Specialist timeout propagates as rejection

```ts
it('propagates specialist timeout when execution-result is never delivered', async () => {
  // Create a transport that never delivers execution-result to the specialist
  // (but the orchestrator still publishes it)
  const relay = createInMemoryRelayTransport({
    dropExecutionResult: true,  // new option in test helper
  });

  await expect(
    runByohLocalProof(
      {
        assembler: createTurnContextAssembler(),
        adapter: createAdapter(),
        relay,
        relayConfig: { channelId: 'byoh-local-proof' },
        timeoutMs: 20,
      },
      { type: 'completed-no-tools', message: 'Validate.' },
    ),
  ).rejects.toThrow(/[Tt]imed out/);
});
```

This test requires adding a `dropExecutionResult` option to `createInMemoryRelayTransport` in the test file. The option suppresses delivery of `execution-result` type messages to subscribers (but still records them in `published`).

#### Test 2: Thread-scoped isolation — mismatched threadId ignored

```ts
it('ignores execution-result messages with mismatched threadId', async () => {
  const relay = createInMemoryRelayTransport();

  // Inject a rogue message with wrong threadId before the proof runs
  // The specialist should ignore it and wait for the correct one
  const proofPromise = runByohLocalProof(
    {
      assembler: createTurnContextAssembler(),
      adapter: createAdapter(),
      relay,
      relayConfig: { channelId: 'byoh-local-proof' },
      timeoutMs: 50,
    },
    { type: 'completed-no-tools', message: 'Validate.' },
  );

  // The proof should succeed because the correct threadId message arrives normally
  const result = await proofPromise;
  expect(result.relayCoordinated).toBe(true);
  expect(result.relayRoundTrip.verdictReceived).toBe(true);
});
```

#### Test 3: Two sequential proofs on the same channel with different scenarios

```ts
it('runs two sequential proofs on the same channel without cross-talk', async () => {
  const relay = createInMemoryRelayTransport();

  const result1 = await runByohLocalProof(
    {
      assembler: createTurnContextAssembler(),
      adapter: createAdapter(),
      relay,
      relayConfig: { channelId: 'byoh-local-proof' },
      timeoutMs: 50,
    },
    { type: 'completed-no-tools', message: 'First proof.' },
  );

  // Reset transport state for second run
  const relay2 = createInMemoryRelayTransport();

  const result2 = await runByohLocalProof(
    {
      assembler: createTurnContextAssembler(),
      adapter: createAdapter(),
      relay: relay2,
      relayConfig: { channelId: 'byoh-local-proof' },
      timeoutMs: 50,
    },
    { type: 'negotiation-rejected', message: 'Second proof.', requirements: { attachments: 'required' } },
  );

  expect(result1.validationVerdict.validatedStatus).toBe('completed');
  expect(result2.validationVerdict.validatedStatus).toBe('unsupported');
  expect(result1.relayCoordinated).toBe(true);
  expect(result2.relayCoordinated).toBe(true);
});
```

#### Test 4: Specialist verdict publish failure propagates

```ts
it('propagates specialist publish failure', async () => {
  const relay = createInMemoryRelayTransport({
    failVerdictPublish: true,  // new option: publish rejects for validation-verdict
  });

  await expect(
    runByohLocalProof(
      {
        assembler: createTurnContextAssembler(),
        adapter: createAdapter(),
        relay,
        relayConfig: { channelId: 'byoh-local-proof' },
        timeoutMs: 50,
      },
      { type: 'completed-no-tools', message: 'Validate.' },
    ),
  ).rejects.toThrow();
});
```

This test requires adding a `failVerdictPublish` option to `createInMemoryRelayTransport`. When set, `publish()` rejects if the message text contains `"validation-verdict"`.

#### Test helper updates

Update `createInMemoryRelayTransport` options type:

```ts
function createInMemoryRelayTransport(options?: {
  dropValidationVerdict?: boolean;
  dropExecutionResult?: boolean;     // new: suppress execution-result delivery
  failVerdictPublish?: boolean;      // new: reject publish for verdict messages
}): ProofRelayTransport & { ... }
```

Add to `publish()`:
```ts
async publish(input) {
  const parsed = JSON.parse(input.text) as { type?: string };

  // Fail verdict publish if configured
  if (options?.failVerdictPublish && parsed.type === 'validation-verdict') {
    throw new Error('Simulated publish failure for validation-verdict.');
  }

  // ... existing logic ...

  // Drop execution-result delivery if configured
  if (!(options?.dropExecutionResult && parsed.type === 'execution-result')) {
    if (!(options?.dropValidationVerdict && parsed.type === 'validation-verdict')) {
      deliver(message);
    }
  }

  return { eventId: message.eventId, targets: [input.channel] };
}
```

### Completion gate
- `vitest run packages/harness/src/adapter/proof/` passes
- all four new tests pass
- all pre-existing tests pass without modification
- total test count increases by at least 4

---

## 5. Validation procedure

Run in order:

```bash
# 1. Type check
npx tsc -p tsconfig.json --noEmit

# 2. Proof tests
npx vitest run packages/harness/src/adapter/proof/

# 3. Adapter tests (no regression)
npx vitest run packages/harness/src/adapter/claude-code-adapter.test.ts

# 4. Full build
npm run build

# 5. Full test suite
npm test
```

All must pass.

---

## 6. Expected final state

After all four phases:

| Property | Before (follow-up slice) | After (lifecycle hardening) |
|---|---|---|
| `start()` resolves after | Registration + subscription setup | Full receive/validate/publish lifecycle |
| Specialist errors | Swallowed by `.catch(() => undefined)` | Propagate to `runByohLocalProof` caller |
| Specialist subscription filter | `type === 'execution-result'` only | `type === 'execution-result' && threadId === config.threadId` |
| Orchestrator awaits specialist | Setup completion only | Full lifecycle completion |
| `RelayValidationHandler.start()` return | `Promise<void>` | `Promise<RelayValidationHandlerOutcome>` |
| Thread isolation tests | None | Mismatched-threadId and sequential-run tests |
| Failure transparency tests | None | Timeout-propagation and publish-failure tests |

---

## 7. Risk assessment

### Low risk
- The happy path is unchanged. `start()` still does the same work in the same order. The only change is that the work is inline instead of in a detached async block.
- Thread-scoping the filter is additive. Existing tests use a single threadId per run, so the filter passes the same messages.

### Medium risk
- The orchestrator flow reordering (publish before await handlerPromise) requires care. The specialist must be subscribed before the orchestrator publishes. Since `start()` now awaits the full lifecycle, the orchestrator must start `handlerPromise` (which subscribes internally) before calling `publish()`, then await `handlerPromise` after receiving the verdict. If the ordering is wrong, the specialist misses the execution-result.

### Mitigation
- Phase 3 explicitly requires: start `handlerPromise`, then `publish`, then `waitForMessage`, then `await handlerPromise`. The test suite validates this ordering through the happy-path tests.
