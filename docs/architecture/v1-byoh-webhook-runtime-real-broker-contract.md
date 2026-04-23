# V1 BYOH Webhook Runtime — Real-Broker Proof Contract

Acceptance contract for an end-to-end proof that exercises the BYOH webhook
runtime against a **real** `agent-relay-broker` subprocess (not a mocked
harness adapter). This contract defines the goal, scope, wiring strategy,
assertions, and residual risks for the proof. It is derived strictly from
the referenced sources: the `byoh-relay` persona, the specialist-bridge
instruction builder, `AgentRelayExecutionAdapter`, the `byoh-local-proof`
real-broker pattern, the existing mocked test (commit `306c1a1`), and the
`RelayAdapter` SDK surface.

---

## 1. Goal

Demonstrate, with no mocked harness, that the byoh-relay wiring carries an
`ExecutionRequest` across a live broker process and carries an
`ExecutionResult` back, with identity (`turnId` / `threadId`) preserved.

The happy-path flow under test:

1. Webhook runtime receives an HTTP POST (Slack `app_mention`) —or, if the
   wiring strategy in §4 forces a bypass, the adapter is invoked directly
   with an equivalent `ExecutionRequest`.
2. The `byoh-relay` persona's Slack consumer fires and calls
   `createAgentRelayExecutionAdapter(...)`.
3. `AgentRelayExecutionAdapter.execute(...)` starts its `RelayAdapter`,
   which spawns/attaches to the **real** `agent-relay-broker` subprocess
   and publishes an `AgentRelayExecutionRequestMessage` (type
   `agent-assistant.execution-request.v1`) to the target channel/worker.
4. An **in-process test worker** — not a real Claude/Codex CLI — is
   subscribed to the same broker via `relay.onEvent(...)`, receives the
   request, and publishes a synthetic `AgentRelayExecutionResultMessage`
   (type `agent-assistant.execution-result.v1` or the legacy
   `execution-result` alias) with matching `turnId` and `threadId` and a
   deterministic `output.text`.
5. The adapter's `execute` promise resolves with an `ExecutionResult` whose
   `status === 'completed'` and whose `output.text` equals what the test
   worker sent.
6. The specialist-bridge `egress` callback is invoked with that
   `ExecutionResult` (when the HTTP → persona path is exercised).
7. Teardown shuts down the broker cleanly and removes the temp cwd.

**Distinction from the mocked proof (commit `306c1a1`, `byoh-relay.e2e.test.ts`):**
The mocked proof `vi.mock('@agent-assistant/harness', ...)` replaces
`createAgentRelayExecutionAdapter` with a synchronous stub. That proof
covers webhook → persona → adapter *invocation* shape (assistantId,
turnId, message.text, systemPrompt). It does **not** cover the relay
transport, the broker subprocess, or the on-the-wire message shapes.
This proof covers exactly what the mocked one skips: the real broker
round-trip and the `AgentRelayExecutionRequestMessage` /
`AgentRelayExecutionResultMessage` envelopes.

---

## 2. Scope IN

The proof MUST exercise all of the following against real code, with no
harness mocks:

- **Real broker subprocess.** `RelayAdapter.start()` is invoked against a
  `mkdtemp`-created working directory. The broker must actually spawn, and
  `${cwd}/.agent-relay/connection.json` must be written before any message
  is published.
- **In-process test worker.** A single listener is attached via
  `relay.onEvent(...)` (through a second `RelayAdapter` in the same
  process, or via the adapter's own transport hook) that:
  - filters for `relay_inbound` events targeted at the worker name or the
    shared channel,
  - parses the inbound body as `AgentRelayExecutionRequestMessage`,
  - replies by calling `relay.sendMessage` with a JSON-serialized
    `AgentRelayExecutionResultMessage` whose `turnId` and `threadId`
    match the request, and whose `executionResult.status === 'completed'`
    with a deterministic `output.text`.
- **Real adapter path.** One of:
  - **(Preferred)** The full HTTP → `byoh-relay` persona → adapter chain,
    with the runtime started against the same cwd the broker runs in, so
    the adapter's default `RelayAdapter` discovers the existing
    `connection.json` and shares the broker subprocess. See §4 for the
    wiring decision.
  - **(Fallback, see §5)** A direct call to
    `createAgentRelayExecutionAdapter({ channelId, workerName, relay,
    spawnWorker: { enabled: false, ... } })` with `relay` either defaulted
    (shared cwd) or an explicit `RelayAdapter` instance built from the
    same cwd.
- **On-the-wire shape assertions.** The test captures the raw inbound
  message body observed by the worker and asserts it parses as an
  `AgentRelayExecutionRequestMessage` with:
  - `type === 'agent-assistant.execution-request.v1'` (the constant the
    adapter sends via `AGENT_RELAY_EXECUTION_REQUEST_TYPE`),
  - `request` matching the `ExecutionRequest` the adapter was given (at
    minimum: `turnId`, `assistantId`, `message.text`,
    `instructions.systemPrompt`),
  - `replyTo.channelId` equal to the configured channel,
  - `sentAt` parseable as ISO-8601.
  The returned `ExecutionResult` must preserve `turnId`/`threadId` and
  include the adapter's own `metadata.relay` block
  (`adapterBackendId`, `channelId`, `target`, `threadId`) per the adapter's
  `finish(...)` wrapping.
- **No-timeout assertion.** The adapter must resolve within the test's
  timeout budget with `status !== 'failed'` and no `error.code === 'timeout'`.
- **Clean teardown.** After the test, `relay.shutdown()` is awaited, the
  broker subprocess is no longer running, and the temp cwd is removed.
  Only paths under `${cwd}/.agent-relay/` may exist inside cwd at teardown
  time; no other files are written to cwd by the runtime under test.

---

## 3. Scope OUT (residual risks)

The proof explicitly does **not** cover, and these remain residual risks
to be acknowledged in the evidence doc:

- **Real Claude / Codex / MCP worker execution.** The worker in the test
  is a synchronous in-process responder. Real CLI workers spawned via
  `RelayAdapter.spawn(...)` with `spawnWorker.enabled === true` are NOT
  exercised. `RELAY_AUTO_SPAWN` is fixed to `"false"`.
- **Model billing / API authentication.** No model calls are made; no
  Anthropic / OpenAI / provider keys are required or asserted on.
- **Slack signature verification.** The webhook runtime's signature-check
  paths are not exercised; the POST uses the test-mode path already used
  by the mocked e2e test.
- **Non-Slack providers.** GitHub, Linear, and other providers are out of
  scope. Only the Slack `app_mention` → `byoh-relay` path is covered.
- **Broker failover, reconnect, and high-concurrency.** Single request,
  single response, single broker instance. No crash-restart, no parallel
  turns, no backpressure.
- **Cross-process orchestrator / worker isolation.** Orchestrator and
  worker run in the same Node process. True multi-process behavior is
  not exercised.

---

## 4. Wiring strategy decision

**Decision: drive the full HTTP → persona chain when feasible; fall back
to direct adapter invocation (see §5) if and only if persona wiring
prevents broker sharing.**

**Reasoning.** The persona's factory (per the sources) constructs its
adapter inline:

```ts
mod.createAgentRelayExecutionAdapter({
  channelId: process.env.RELAY_CHANNEL ?? "specialists",
  workerName: process.env.RELAY_WORKER ?? "specialist-worker",
  spawnWorker: {
    enabled: process.env.RELAY_AUTO_SPAWN === "true",
    cli: process.env.RELAY_CLI ?? "claude",
    name: process.env.RELAY_WORKER,
    model: process.env.RELAY_MODEL,
  },
});
```

The persona does NOT pass an explicit `relay` transport, so the adapter
falls back to constructing a `new RelayAdapter({ cwd: config.cwd ??
process.cwd(), channels: [this.channelId], ... })`. That default
`RelayAdapter` locks per project cwd (per `RelayAdapter` doc) and
discovers the broker via `${cwd}/.agent-relay/connection.json`. If the
test:

1. creates `cwd = await mkdtemp(...)`,
2. starts a "harness" `RelayAdapter` in that same cwd to spawn the broker
   and attach the test worker, then
3. invokes the webhook runtime from code running with
   `process.cwd() === cwd` (or arranges for the runtime/persona to be
   loaded in that cwd, e.g. via `child_process` / `process.chdir` in the
   test harness) **before** POSTing,

then the adapter instantiated by the persona SHOULD attach to the same
broker instance already running in that cwd, and no code changes to the
persona are required.

**Env vars the test MUST set before the HTTP POST:**

| Env var              | Value                   | Reason                                              |
|----------------------|-------------------------|-----------------------------------------------------|
| `RELAY_CHANNEL`      | test-chosen channel id  | Pin channel so the test worker and adapter agree.   |
| `RELAY_WORKER`       | test-chosen worker name | Pin the adapter's `target` so routing is deterministic. |
| `RELAY_AUTO_SPAWN`   | `"false"`               | Prevent the adapter from spawning a real CLI worker; the test provides the responder. |
| `RELAY_CLI`          | (unset) / arbitrary     | Irrelevant when auto-spawn is false.                |
| `RELAY_MODEL`        | (unset)                 | Irrelevant; no model is invoked.                    |

**cwd strategy:**

- `cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'byoh-real-broker-'))`
- The test's harness `RelayAdapter` is constructed with
  `{ cwd, channels: [RELAY_CHANNEL] }` and `.start()`-ed first — this is
  what writes `${cwd}/.agent-relay/connection.json`.
- The runtime-under-test (persona + webhook-runtime) must run with that
  same cwd so its internal `new RelayAdapter({ cwd: process.cwd(), ... })`
  attaches to the existing broker instead of spawning a second one. In
  practice this means either:
  - running the whole Vitest process with `process.chdir(cwd)` before
    `startHttpRuntime` is invoked (and restoring cwd on teardown), or
  - injecting `cwd` explicitly if/when the persona gains a config hook.

If `process.chdir` is not acceptable (test-runner parallelism, etc.), the
fallback in §5 applies.

---

## 5. Fallback wiring

If during implementation the agents determine that the persona cannot
share the broker without code changes — e.g. because the persona's
adapter construction is hoisted before the test can influence cwd, or
because the webhook runtime pins a different cwd — the acceptable
fallback is:

> Test `createAgentRelayExecutionAdapter` **directly** with the same
> real-broker + test-worker harness, bypassing the HTTP and persona
> layers. Use an `ExecutionRequest` whose fields mirror what the
> persona's specialist-bridge instruction builder would produce for an
> `app_mention` (`assistantId: 'slack-specialist'`, `turnId: 'turn-...'`,
> `message.text` = the instruction, `instructions.systemPrompt` set).

When this fallback is taken, the evidence doc produced by the proof
MUST state explicitly:

- **Covered by this proof:** adapter ↔ broker transport, on-the-wire
  `AgentRelayExecutionRequestMessage` / `AgentRelayExecutionResultMessage`
  shapes, `turnId`/`threadId` preservation, clean broker lifecycle.
- **Covered only by the mocked proof (`306c1a1`):** webhook HTTP →
  `byoh-relay` persona → `createAgentRelayExecutionAdapter` invocation
  shape (`assistantId`, `message.text`, `systemPrompt`, predicate skip
  for non-`app_mention`).
- **Gap:** no single automated test covers HTTP → persona → real broker
  end-to-end; that composition is argued by combining the two proofs.

---

## 6. Assertions the test MUST make

The following assertions are mandatory. A proof that omits any of these
does not satisfy this contract.

1. **Broker lifecycle — start.**
   `${cwd}/.agent-relay/connection.json` exists on disk after the
   harness `RelayAdapter.start()` resolves and before the first message
   is published. (Equivalently: attempting to publish before `start`
   completes is not relied upon.)
2. **Worker sees the request.** The in-process test worker observes at
   least one `relay_inbound` event whose parsed body has
   `type === 'agent-assistant.execution-request.v1'` (matching
   `AGENT_RELAY_EXECUTION_REQUEST_TYPE`). The parsed message is a
   well-formed `AgentRelayExecutionRequestMessage`:
   - `turnId` is a non-empty string,
   - `threadId` equals `request.threadId ?? request.turnId`,
   - `replyTo.channelId === RELAY_CHANNEL`,
   - `request.assistantId === 'slack-specialist'` (HTTP path) or the
     explicit value used by the fallback direct-invocation path,
   - `request.message.text` equals the instruction derived from the
     webhook (HTTP path) or the test's chosen instruction (fallback).
3. **Identity preserved on the response.** The adapter's resolved
   `ExecutionResult` corresponds to a response whose message
   `turnId === request.turnId` and `threadId === (request.threadId ??
   request.turnId)`. (Verified via the message the worker sent and the
   adapter's matching filter.)
4. **Adapter returns a completed ExecutionResult.**
   `result.status === 'completed'` and `result.output.text` strictly
   equals the deterministic string the test worker emitted (e.g.
   `'real-broker responder ack'`). `result.error` is undefined and
   `result.metadata.relay.channelId === RELAY_CHANNEL`,
   `result.metadata.relay.target === RELAY_WORKER`,
   `result.metadata.relay.adapterBackendId === 'agent-relay'` (the
   adapter default).
5. **No timeout.** The adapter's promise resolves without hitting its
   `timeoutMs`. No result has `error.code === 'timeout'`. The test's
   outer timeout is set generously above the adapter's configured
   timeout so the distinction is observable.
6. **Specialist-bridge egress invoked (HTTP path only).** When the
   full HTTP path is exercised, the persona's `egress` callback is
   called exactly once with `{ consumerId: 'byoh-relay', specialistKind,
   event, response }` where `response` is the adapter's returned
   `ExecutionResult`. Under the §5 fallback, this assertion is
   relocated to the mocked proof and is not required here.
7. **Broker subprocess exits on teardown.** After `relay.shutdown()`
   awaits complete, the broker process is no longer alive (its PID is
   not running, or the `RelayAdapter` status indicates stopped). No
   stray child processes remain attributable to this test.
8. **cwd is clean.** After teardown and `rm -rf cwd`, the directory
   is gone. During the run, the only files the runtime wrote inside
   cwd are under `${cwd}/.agent-relay/`. No other artifacts (logs,
   pid files, sockets outside `.agent-relay/`) appear at the top of
   cwd.

---

## 7. Residual risks

Explicit, non-exhaustive list of what the proof does NOT eliminate.
Any regression in these areas will not be caught by this test alone.

- **CLI-worker behavior.** We exercise `spawnWorker.enabled === false`.
  A regression in `AgentRelayExecutionAdapter.ensureWorker` (list /
  spawn / error propagation) would not be caught.
- **Slack signature / request-auth paths.** Not exercised; a
  regression in Slack HMAC verification is invisible to this proof.
- **Multi-turn / multi-thread conversations.** Single `turnId`,
  single `threadId`. Crosstalk between concurrent turns is not
  exercised.
- **Timeout handling.** We assert no timeout occurs on the happy
  path. The failure path (adapter timeout, `error.code === 'timeout'`,
  `retryable: true`) is not asserted positively.
- **Transport failure paths.** `relay.sendMessage` rejection,
  `relay.start` failure, unsubscribe leaks on the happy path are
  implicitly exercised but their failure branches
  (`backend_execution_error`) are not.
- **Non-Slack providers and the `http-forward` consumer.** Out of
  scope.
- **Process-model fidelity.** Worker runs in-process; OS-level
  isolation (PTY runtime, separate process memory, signal handling)
  is not exercised.
- **Broker version drift.** The proof pins whatever broker binary
  `RelayAdapter` resolves at test time; a change in broker wire
  format shipped independently could pass this proof while breaking
  production.
- **Persona/cwd coupling.** If the §5 fallback is taken, the HTTP →
  persona → adapter composition against a real broker is inferred
  from two separate proofs rather than observed directly.

---

V1_BYOH_WEBHOOK_REAL_BROKER_CONTRACT_READY
