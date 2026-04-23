# v1 BYOH Webhook Runtime — E2E Evidence

This document records the proof that the `byoh-relay` persona wired into
`@agent-assistant/webhook-runtime` routes a Slack `app_mention` webhook through
the harness's `createAgentRelayExecutionAdapter` with a correctly-shaped
`ExecutionRequest`. It is the evidentiary companion to
`docs/architecture/v1-byoh-webhook-runtime-e2e-contract.md`.

## 1. Proof summary

The E2E test at `packages/webhook-runtime/src/byoh-webhook-e2e.test.ts`
registers the real `byoh-relay` persona (from
`packages/webhook-runtime/examples/personas.ts`) against a live
`startHttpRuntime` HTTP listener, posts a normalized Slack `app_mention`
event to `/webhooks/slack`, and asserts that:

- The webhook fanout succeeds for the `byoh-relay` consumer.
- The persona's specialist factory resolves `@agent-assistant/harness` and
  invokes `createAgentRelayExecutionAdapter(...)`.
- `adapter.execute(...)` is called exactly once with an `ExecutionRequest`
  whose fields match the persona's documented construction
  (`assistantId === "slack-specialist"`, `turnId` prefixed `turn-`,
  `message.text` equal to the Slack event text, and a non-empty
  `instructions.systemPrompt`).

Non-`app_mention` Slack events are skipped by the consumer's predicate and
never reach the adapter.

## 2. What was asserted

The following assertions are enumerated verbatim from
`packages/webhook-runtime/src/byoh-webhook-e2e.test.ts`:

### Test: "routes Slack app_mention events to the BYOH relay execution adapter"

- `expect(response.status).toBe(200)` — the HTTP POST to `/webhooks/slack`
  returns HTTP 200.
- `expect(body.succeeded).toContain("byoh-relay")` — the fanout result lists
  `byoh-relay` among successful consumers.
- `expect(body.failed).toEqual([])` — no consumers failed.
- `expect(executeCalls).toHaveLength(1)` (via `singleExecuteCall()`) —
  `adapter.execute` was invoked exactly once.
- `expect(captured.assistantId).toBe("slack-specialist")` — the hardcoded
  assistant id from the persona.
- `expect(captured.turnId).toMatch(/^turn-/)` — the `turnId` uses the
  `turn-${deliveryId ?? Date.now()}` construction.
- `expect(captured.message.text).toBe(instruction)` where
  `instruction === "<@U_BOT> inspect the webhook runtime"` — the Slack
  event text flows through the specialist bridge's `instructionForEvent`
  into `message.text`.
- `expect(captured.instructions.systemPrompt).toEqual(expect.any(String))` —
  the system prompt is a string.
- `expect(captured.instructions.systemPrompt.trim()).not.toBe("")` — the
  system prompt is non-empty after trimming.

### Test: "skips byoh-relay for Slack events that are not app_mention events"

- `expect(response.status).toBe(200)` — the non-`app_mention` event still
  yields HTTP 200.
- `await expect(response.json()).resolves.toEqual({ total: 1, succeeded: [],
  failed: [], skipped: [{ id: "byoh-relay", reason: "predicate" }] })` — the
  fanout result shows a single consumer skipped with reason `"predicate"`.
- `expect(executeCalls).toEqual([])` — `adapter.execute` was never called
  for a non-`app_mention` event.

## 3. Mock scope

The test mocks the `@agent-assistant/harness` module via `vi.mock(...)`. The
mock replaces exactly one export:

- **`createAgentRelayExecutionAdapter`** — replaced with a `vi.fn(() => ({
  execute }))` factory. The returned adapter object exposes a single async
  `execute(request: ExecutionRequest)` method that pushes the incoming
  `request` onto a hoisted `executeCalls` array and resolves to the
  following fixed `ExecutionResult` shape:

```ts
{
  status: "completed",
  output: { text: "mocked specialist response" },
}
```

No other harness export is stubbed. This is consistent with §3 of the
contract: the mock exists to make the persona's dynamic import of
`@agent-assistant/harness` resolve deterministically without starting a
real relay broker.

## 4. Full test suite result

Tail of the `vitest` run, captured verbatim:

```
---FINAL SUITE---
stdout | src/byoh-webhook-e2e.test.ts > byoh-relay webhook e2e > routes Slack app_mention events to the BYOH relay execution adapter
Webhook fanout completed {
  area: 'webhook-fanout',
  provider: 'slack',
  eventType: 'app_mention',
  total: 1,
  succeeded: 1,
  failed: 0,
  skipped: 0
}

stdout | src/byoh-webhook-e2e.test.ts > byoh-relay webhook e2e > skips byoh-relay for Slack events that are not app_mention events
Webhook fanout completed {
  area: 'webhook-fanout',
  provider: 'slack',
  eventType: 'message',
  total: 1,
  succeeded: 0,
  failed: 0,
  skipped: 1
}

 ✓ src/http-runtime.test.ts (5 tests) 48ms
 ✓ src/byoh-webhook-e2e.test.ts (2 tests) 43ms

 Test Files  5 passed (5)
      Tests  22 passed (22)
   Start at  11:57:10
   Duration  333ms (transform 165ms, setup 0ms, collect 278ms, tests 109ms, environment 1ms, prepare 351ms)


---E2E ONLY---

> @agent-assistant/webhook-runtime@0.1.1 test
> vitest run byoh-webhook-e2e


 RUN  v3.2.4 /Users/khaliqgant/Projects/AgentWorkforce/agent-assistant/packages/webhook-runtime

stdout | src/byoh-webhook-e2e.test.ts > byoh-relay webhook e2e > routes Slack app_mention events to the BYOH relay execution adapter
[byoh-relay] channel=C_BYOH eventType=app_mention -> {"status":"completed","output":{"text":"mocked specialist response"}}

stdout | src/byoh-webhook-e2e.test.ts > byoh-relay webhook e2e > routes Slack app_mention events to the BYOH relay execution adapter
Webhook fanout completed {
  area: 'webhook-fanout',
  provider: 'slack',
  eventType: 'app_mention',
  total: 1,
  succeeded: 1,
  failed: 0,
  skipped: 0
}

stdout | src/byoh-webhook-e2e.test.ts > byoh-relay webhook e2e > skips byoh-relay for Slack events that are not app_mention events
Webhook fanout completed {
  area: 'webhook-fanout',
  provider: 'slack',
  eventType: 'message',
  total: 1,
  succeeded: 0,
  failed: 0,
  skipped: 1
}

 ✓ src/byoh-webhook-e2e.test.ts (2 tests) 25ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  11:56:44
   Duration  362ms (transform 60ms, setup 0ms, collect 86ms, tests 25ms, environment 0ms, prepare 43ms)
```

## 5. Before / after

- **Before this workflow:** the CLI in `packages/webhook-runtime/examples/cli.ts`
  only exercised a stub factory path. There was no automated assertion that
  the `byoh-relay` persona resolved `@agent-assistant/harness` and invoked
  `createAgentRelayExecutionAdapter` with a well-formed `ExecutionRequest`;
  the wiring was effectively validated only by manual CLI runs against a
  stub.
- **After this workflow:** the new E2E test in
  `packages/webhook-runtime/src/byoh-webhook-e2e.test.ts` proves, as part
  of the standard `vitest` suite, that a Slack `app_mention` posted to the
  live HTTP runtime drives the `byoh-relay` persona through to a single
  `adapter.execute` call with a correctly-shaped `ExecutionRequest`
  (`assistantId`, `turnId`, `message.text`, non-empty
  `instructions.systemPrompt`) and that non-`app_mention` events are
  predicate-skipped before reaching the adapter.

## 6. Residual risks NOT covered by this proof

This proof mocks the harness and therefore does not exercise:

1. **Real broker message serialization.** The
   `AgentRelayExecutionRequestMessage` envelope (type tag, `replyTo`,
   `sentAt`, `threadId` fallback to `turnId`) is constructed only inside the
   real `AgentRelayExecutionAdapter.execute`. Drift in that envelope will not
   be caught here.
2. **Worker spawn auth and CLI resolution.** The `spawnWorker` config is
   asserted only for shape; whether the named CLI is present on `$PATH`,
   whether the broker accepts the `RelaySpawnRequest`, and whether the worker
   actually boots are untested.
3. **End-to-end latency and timeout semantics.** The adapter's
   `DEFAULT_TIMEOUT_MS` (60s) and `setTimeout`-based failure path are not
   exercised; the mock resolves synchronously.
4. **Harness package version skew.** The persona dynamic-imports
   `@agent-assistant/harness` by name. If the installed version does not
   export `createAgentRelayExecutionAdapter`, production will throw at
   runtime. The mock replaces the import wholesale, so a missing export in a
   real installed version is undetected here.
5. **Relay transport negotiation.** `negotiate()` degradation reasons, capability
   mismatch handling, and the `unsupported`/`failed` result branches inside
   the real adapter are not invoked.
6. **Env-var parsing edge cases beyond the documented truthy check.** Only
   the literal string `"true"` enables `spawnWorker.enabled`; other truthy
   strings (`"1"`, `"TRUE"`) are intentionally out of scope but may surprise
   operators.
7. **Concurrency.** A single delivery is asserted; ordering and isolation
   across concurrent deliveries are not.
8. **Slack signature verification and replay protection** at the HTTP ingress
   boundary (explicitly out per §2).

Each residual risk must be addressed by a distinct proof or operator
runbook; this contract does not claim to cover them.

## 7. How to run locally

From the repository root:

```
npm --workspace @agent-assistant/webhook-runtime run test -- byoh-webhook-e2e
```

V1_BYOH_WEBHOOK_E2E_PROVEN
