# v1 BYOH Webhook Runtime — E2E Contract

This document defines the acceptance contract the `byoh-relay` persona proof
must satisfy. It is derived directly from the persona wiring at
`packages/webhook-runtime/examples/personas.ts`, the specialist bridge at
`packages/webhook-runtime/src/specialist-bridge.ts`, and the
`AgentRelayExecutionAdapter` in the harness package. Nothing in this contract
is inferred beyond those sources.

## 1. Goal

Prove that a single inbound Slack `app_mention` webhook, delivered through the
`webhook-runtime` package with the `byoh-relay` persona registered, results in:

1. HTTP POST of a normalized Slack event reaching the runtime.
2. The `byoh-relay` consumer's `predicate` firing (i.e. `eventType === "app_mention"`).
3. The specialist bridge building an `instruction` from the event and invoking
   the persona's `specialistFactory`.
4. The factory dynamic-importing `@agent-assistant/harness` and calling
   `createAgentRelayExecutionAdapter(...)` with config sourced from env vars.
5. `adapter.execute(...)` being called exactly once with the documented
   `ExecutionRequest` shape (see §4).
6. The `ExecutionResult` returned by the adapter being forwarded to the
   persona's `egress` callback with the correct `consumerId` and `event` (see §5).

The proof asserts wiring and shape, not transport or model behavior.

## 2. Scope

### In scope

- Shape of the `ExecutionRequest` passed to `adapter.execute`, as constructed
  inside the `byoh-relay` persona's factory in
  `packages/webhook-runtime/examples/personas.ts`.
- Predicate gating: non-`app_mention` Slack events must NOT reach the factory
  or `adapter.execute`.
- Egress invocation: the `ExecutionResult` produced by `adapter.execute` must
  flow through the consumer's `egress` callback with the expected `consumerId`
  and the same `event` object that was dispatched.
- Dynamic-import resolution of `@agent-assistant/harness` and the presence of
  the `createAgentRelayExecutionAdapter` export (guarded by the persona's
  explicit `throw` when the export is missing).
- Env-var driven construction of the adapter config (`RELAY_CHANNEL`,
  `RELAY_WORKER`, `RELAY_AUTO_SPAWN`, `RELAY_CLI`, `RELAY_MODEL`).

### Out of scope

- A real Agent Relay broker. No broker process is started; no TCP/IPC is
  attempted.
- Real worker spawn (`spawnWorker.enabled = true` path executing `cli`).
- Slack signature verification and request authentication.
- Any provider other than `slack` (GitHub, Linear, etc.).
- Real `@agent-assistant/specialists` execution (the default factory path).
- End-to-end round-trip of `AgentRelayExecutionRequestMessage` /
  `AgentRelayExecutionResultMessage` over the relay transport.
- Trace shape, negotiation degradation, and timeout behavior inside the
  adapter — these are the subject of the separate
  `v1-execution-adapter-proof-*` contracts.

## 3. Mocking strategy

The test MUST mock `@agent-assistant/harness` so that the dynamic import inside
the persona resolves to a stub exporting `createAgentRelayExecutionAdapter`.
The stub returns an object with an `execute` spy that:

- Captures the `ExecutionRequest` argument.
- Returns a fixed, well-formed `ExecutionResult` (`status: "completed"`, known
  `output.text`, known `backendId`).

### Why mock

1. **Determinism.** The real adapter constructs a `RelayAdapter` from
   `@agent-relay/sdk`, which tries to start a broker transport. Without a
   broker process, `relay.start()` will fail non-deterministically.
2. **Scope isolation.** This proof asserts *webhook → persona → adapter call
   shape*. Broker serialization, worker spawn, and event-loop resolution are
   covered by the harness's own adapter contract and must not be re-proven
   here. Conflating the two scopes produces a brittle test that fails for
   reasons unrelated to the webhook-runtime wiring under review.
3. **Fast feedback.** The test must run in the standard `vitest` pass for
   `@agent-assistant/webhook-runtime` without external services.

A separate proof — owned by the harness package — exercises the real
`RelayAdapter` transport against a live broker. That proof is explicitly the
complement of this one; neither is complete without the other.

## 4. Assertions on the captured `ExecutionRequest`

The mocked `adapter.execute` MUST be called exactly once. The test MUST assert
the following on the single captured argument. These values are derived from
the literal construction at
`packages/webhook-runtime/examples/personas.ts` in the `byoh-relay` factory
and from the `instructionForEvent` helper in
`packages/webhook-runtime/src/specialist-bridge.ts`.

| Field | Required value |
|---|---|
| `assistantId` | `"slack-specialist"` (hardcoded in the persona) |
| `turnId` | `` `turn-${event.deliveryId ?? Date.now()}` ``. The test MUST inject a fixture event with a known `deliveryId` (e.g. `"delivery-123"`) and assert `turnId === "turn-delivery-123"`, proving the `deliveryId` branch is taken (not the `Date.now()` fallback). |
| `message.id` | `String(event.deliveryId ?? "")`. With `deliveryId: "delivery-123"`, assert `message.id === "delivery-123"`. |
| `message.text` | MUST equal the `instruction` that the specialist bridge computes via `instructionForEvent(event)`. Concretely: when `event.data.text` is a non-empty trimmed string, `instruction === event.data.text.trim()`; otherwise `instruction === JSON.stringify({ eventType, workspaceId, payload })`. The test MUST cover the `data.text` branch (fixture sets `data.text = "hello bot"`, asserts `message.text === "hello bot"`). |
| `message.receivedAt` | Parseable ISO-8601 string. Assert via `!Number.isNaN(Date.parse(message.receivedAt))`. The value is produced by `new Date().toISOString()` at call time, so an exact-equality assertion is not appropriate; shape is what matters. |
| `instructions.systemPrompt` | `"Relay-hosted specialist responding to Slack."` (literal, hardcoded). |
| `message.attachments` | MUST be absent/undefined (the persona does not set it). |
| `context` | MUST be absent/undefined. |
| `continuation` | MUST be absent/undefined. |
| `tools` | MUST be absent/undefined. |
| `requirements` | MUST be absent/undefined. |

Additionally, the test MUST assert `createAgentRelayExecutionAdapter` was
called exactly once, with a config object that reflects the documented env
vars. With the fixture setting `RELAY_CHANNEL=specialists-test`,
`RELAY_WORKER=worker-test`, `RELAY_AUTO_SPAWN=true`, `RELAY_CLI=claude`,
`RELAY_MODEL=opus`, assert the captured config equals:

```
{
  channelId: "specialists-test",
  workerName: "worker-test",
  spawnWorker: {
    enabled: true,
    cli: "claude",
    name: "worker-test",
    model: "opus",
  },
}
```

When `RELAY_CHANNEL` is unset, assert `channelId === "specialists"` (persona
default). When `RELAY_WORKER` is unset, assert `workerName === "specialist-worker"`.
When `RELAY_AUTO_SPAWN` is anything other than the literal string `"true"`,
assert `spawnWorker.enabled === false`. These are the three explicit default
paths in the persona source.

Finally, the test MUST include a negative case: a Slack event whose
`eventType !== "app_mention"` does NOT cause the factory to run and does NOT
cause `adapter.execute` to be called. Asserted via call-count `=== 0` on the
adapter factory spy for that delivery.

## 5. Assertions on egress

The `egress` callback supplied to `registerSlackSpecialistConsumer` for
`byoh-relay` MUST be invoked exactly once per successful delivery with an
input object satisfying:

- `consumerId === "byoh-relay"`.
- `specialistKind === "github"` (the persona's declared kind).
- `event` is strictly the same `NormalizedWebhook` object the runtime
  dispatched (identity check, not deep-equal).
- `response` is strictly the `ExecutionResult` object returned by the mocked
  `adapter.execute` (identity check). In particular, if the mock returns
  `{ backendId: "agent-relay", status: "completed", output: { text: "ok" } }`,
  assert all three fields round-trip through egress unchanged.

The test MUST also assert egress is NOT called when the predicate rejects the
event (non-`app_mention`), and that egress is NOT called on the predicate-pass
path until after `adapter.execute` resolves (ordering: await the dispatch,
then snapshot call order of the two spies).

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

V1_BYOH_WEBHOOK_CONTRACT_READY
