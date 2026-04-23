# v1 BYOH Webhook Runtime — Real Broker Proof Evidence

This document records the outcome of the real-broker byoh-relay proof defined
by `v1-byoh-webhook-runtime-real-broker-contract.md`.

## 1. Proof summary

A real `agent-relay-broker` subprocess is spawned via `RelayAdapter.start()`
into a `mkdtemp` cwd. Two agent names (`test-worker` and `agent-assistant`)
are pre-registered with the broker via `relay.spawn({ cli: 'bash', task: 'cat
>/dev/null' })`. A test worker harness subscribes to the channel via
`relay.onEvent` and responds to `agent-assistant.execution-request.v1`
messages with a typed `agent-assistant.execution-result.v1` payload. The
`createAgentRelayExecutionAdapter` is invoked with the harness relay
injected, its `execute()` round-trips a real message through the broker, and
the returned `ExecutionResult` matches the typed shape the worker produced.

Test: `packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts`
(2 tests, both passing).

## 2. What was asserted

Happy path (`round-trips an ExecutionRequest ...`):

- HTTP-level: the adapter's `execute()` returns `status: 'completed'`.
- `result.output.text === 'real-broker test response'` (matches what the test
  worker produced).
- `result.metadata.relay` includes `channelId`, `target: 'test-worker'`,
  `threadId: 'thread-rb-1'` — proving the adapter wrapped the result with
  the relay metadata it observed on the wire.
- The worker harness captured exactly one request.
- The captured request's `type` is `AGENT_RELAY_EXECUTION_REQUEST_TYPE`
  (`agent-assistant.execution-request.v1`).
- `turnId === 'turn-rb-1'`, `threadId === 'thread-rb-1'`.
- `replyTo.agentId === 'agent-assistant'`, `replyTo.channelId === <channel>`.
- `request.assistantId === 'slack-specialist'`.
- `request.message.text === 'hello via real broker'`.
- `request.instructions.systemPrompt` is defined.

Timeout path (`times out with a retryable error when no worker responds`):

- Target `silent-worker` is pre-registered with the broker so
  `sendMessage` succeeds at the broker level (no 404).
- The harness listener filters on `event.target === WORKER_NAME` so the
  response never fires.
- Adapter returns `status: 'failed'` with `error.code === 'timeout'` and
  `error.retryable === true`.
- Worker harness `received` stays empty (the filter was correct).

## 3. Wiring actually used (fallback path taken)

The contract (§5) permitted a fallback from the full HTTP → persona chain
to **adapter-direct testing** if discovery of the persona's broker via the
shared `cwd` did not work. The fallback was taken. Two broker behaviors
prompted it:

1. **Unregistered agent rejection.** `relay.sendMessage({ to: 'test-worker' })`
   fails with `Agent "test-worker" not found` unless `test-worker` is first
   registered via `relay.spawn(...)`. The persona's factory does not spawn
   its worker (it relies on a pre-existing worker in production).
2. **Cross-relay `from` rewrite.** When two `RelayAdapter` instances on the
   same `cwd` exchange messages through the broker, the sender's explicit
   `from` is replaced with the sender-relay's auto-registered agent name
   on the receiving side. The adapter filters responses by
   `inbound.from !== this.workerName`, so a worker response arriving on a
   different relay would be rejected even though the `turnId`/`threadId`
   match.

The workaround that makes the proof deterministic: **inject a single shared
`RelayAdapter`** into the adapter config (`relay: harness.workerRelay`).
Same-relay sends preserve the explicit `from`, so the adapter's filter
accepts the worker's response.

The persona-level wiring (webhook POST → persona → adapter call) is already
covered by the mocked proof committed in `306c1a1` (test
`src/byoh-webhook-e2e.test.ts`). THIS proof covers the layer that sits
below — the adapter ↔ broker transport. Together the two proofs cover the
whole byoh-relay stack minus a real worker process.

## 4. Test output

```
 ✓ src/byoh-webhook-real-broker-e2e.test.ts (2 tests) 17581ms
   ✓ byoh real-broker E2E > round-trips an ExecutionRequest through the real agent-relay broker and returns a typed ExecutionResult  7811ms
   ✓ byoh real-broker E2E > times out with a retryable error when no worker responds  9770ms

 Test Files  6 passed (6)
      Tests  24 passed (24)
```

## 5. Before / after

- **Before.** The byoh-relay path was only proven by a mocked-harness test
  that intercepted `createAgentRelayExecutionAdapter`. The transport layer
  between `execute()` and a real `agent-relay-broker` subprocess was
  uncovered.
- **After.** A real broker subprocess participates in every test run. The
  request message published on the wire is inspected in-test. The response
  message is produced by a separate handler registered on the broker. The
  adapter's timeout path is exercised against the same broker.

## 6. Residual risks (carried from contract)

- CLI-worker behavior (`spawnWorker.enabled === true`) is not exercised.
- Slack HMAC signature verification is not wired or tested.
- Multi-turn / multi-thread conversations not exercised.
- `backend_execution_error` (sendMessage rejection) not positively asserted.
- Non-Slack providers out of scope.
- OS-level worker isolation not exercised (worker runs in-process).
- Broker version drift: proof pins whatever `agent-relay-broker` resolves
  at test time.
- Full HTTP → persona → real-broker chain not observed in one flow; it is
  inferred from the mocked proof (persona wiring) + this proof
  (adapter ↔ broker transport).
- Broker `from`-rewrite behavior (§3) means any future change to the
  adapter's response filter will need coordinated updates here.

## 7. How to run

```bash
cd packages/webhook-runtime
npm install
npm test -- byoh-webhook-real-broker-e2e --testTimeout=60000
```

Prerequisites: `agent-relay-broker` binary on `PATH` (the preflight step
of the parent workflow verifies this).

V1_BYOH_WEBHOOK_REAL_BROKER_PROVEN
