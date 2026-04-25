# @agent-assistant/webhook-runtime

Shared webhook runtime primitives for normalizing provider events, registering
local or HTTP consumers, and fanning events out consistently.

This package removes duplicated webhook plumbing that sage / nightcto /
my-senior-dev all hand-roll today.

## Persona contract (cf-runtime)

Every persona package that targets the Cloudflare runtime exports two functions
per ingress surface:

```ts
// Ingress side: signature verify + parse + persona-side policy
// (rate-limit, thread-gate, etc.). Returns a turn descriptor that is safe to
// enqueue, or an "ack-only" sentinel.
export function parseSlackWebhook(
  req: Request,
  env: PersonaBindings,
): Promise<PersonaTurnDescriptor | PersonaAckResponse>;

// Consumer side: runs the harness work synchronously relative to the queue
// handler. Any internal ctx.waitUntil is for legitimately out-of-band telemetry
// only; the turn itself is awaited.
export function runPersonaTurn(
  descriptor: PersonaTurnDescriptor,
  env: PersonaBindings,
  ctx: ExecutionContext,
): Promise<void>;
```

Why this shape, matching `cloud/workflows/cf-runtime/SPEC.md` invariant 6:

- Dedup is owned by the cf-runtime ingress wrapper, once per delivery. Personas
  must not re-implement Slack/GitHub event dedup. A descriptor that arrives at
  `runPersonaTurn` is deduped by construction. Use `SlackEventDedupGate`
  (re-exported here from `@agent-assistant/surfaces`) as the canonical
  primitive, with your own KV-backed `SlackEventDedupStore`.
- Signature verification stays inside `parseSlackWebhook` because the persona
  owns the per-workspace signing-secret lookup.
- `runPersonaTurn` must not orphan promises past return. The fake
  `ExecutionContext` provided by cf-runtime collects `waitUntil` promises and
  awaits them before the consumer returns, which fixes the Slack-silence bug.

The first concrete example is sage's W0 split: `parseSlackWebhook` plus
`runSageTurn` shipped in `@agentworkforce/sage@1.5.0`. New personas
(`nightcto`, `my-senior-dev`) follow the same pattern.

Do not wire personas via `registerSlackSpecialistConsumer` from
`./specialist-bridge` in the cf-runtime architecture. That bridge runs the
specialist call synchronously inside the webhook fanout, which is the
orphaned-promise pattern the cf-runtime is designed to remove. Enqueue a
`specialist_call` queue message and resume on a
`specialist_result:<turnId>` trigger instead.

## Interactive CLI

The fastest way to exercise the runtime end-to-end is the REPL at
`examples/cli.ts`:

```bash
cd packages/webhook-runtime
npm install      # first run only
npm run cli      # boots runtime on http://127.0.0.1:3777
```

You will see:

```
webhook-runtime listening at http://127.0.0.1:3777
Registered consumers: echo (all slack), github-sim (app_mention)
Type 'help' for commands.

webhook>
```

### Commands

| command | effect |
|---|---|
| `help` | print the command list |
| `url` | print the webhook URL |
| `personas` | list the persona catalog |
| `use <id>` | register a persona as an active consumer |
| `drop <id>` | unregister a consumer by id |
| `consumers` | list currently active personas |
| `mention <text>` | POST an `app_mention` fixture to `/webhooks/slack` |
| `slack <json>` | POST raw Slack JSON to `/webhooks/slack` |
| `nango <json>` | wrap your JSON as `{from:"slack", payload:<json>}` and POST to `/webhooks/nango` |
| `file <path>` | load JSON from disk and POST to `/webhooks/slack` |
| `quit` / `exit` | shut down (SIGINT also works) |

Every post prints the HTTP status, the fanout result
(`succeeded` / `failed` / `skipped` ids), and any log lines emitted by
active personas.

Override the port with `PORT=4000 npm run cli`. While the REPL is running you
can also hit the same URL from another shell with `curl`.

### Personas — swap SDK knobs live

The CLI ships with a catalog at `examples/personas.ts`. Each persona maps to
a distinct choice an `@agent-assistant/webhook-runtime` consumer can make.
`echo` and `github-stub` are registered on startup; the rest you opt into
with `use <id>`.

| persona | knob exercised |
|---|---|
| `echo` | `kind: "local"` consumer with no predicate. Baseline — shows normalized event shape. |
| `github-stub` | `registerSlackSpecialistConsumer` with a stub `specialistFactory` returning a canned string. Shows specialist-bridge wiring without touching a real specialist. |
| `github-real` | Same consumer but **no factory override** — falls through to the default dynamic import of `@agent-assistant/specialists`. Exercises the real SDK path. |
| `byoh-relay` | Factory dynamic-imports `@agent-assistant/harness` and routes the event through `createAgentRelayExecutionAdapter`. Exercises the BYOH path. |
| `http-forward` | `kind: "http"` consumer that POSTs the normalized event to `HTTP_FORWARD_URL`. Useful for piping into webhook.site / ngrok / a local debug server. |
| `failer` | Factory throws. Shows the `failed[]` fanout entry and `[error]` log line without crafting a broken payload. |

Environment prerequisites for the non-default personas:

- **`github-real`** — `@agent-assistant/specialists` built and its runtime deps resolvable.
- **`byoh-relay`** — install `@agent-assistant/harness` (declared as an optional peer dep; the persona dynamic-imports `@agent-assistant/harness/agent-relay`). Needs a running Relay broker and a worker already registered on the channel (the adapter rejects `sendMessage` to unknown agent names with `Agent "<name>" not found`). Easiest path: run the bundled worker bridge in a separate terminal — see "BYOH end-to-end locally" below. Env vars: `RELAY_CHANNEL`, `RELAY_WORKER`, `RELAY_AUTO_SPAWN`, `RELAY_CLI`, `RELAY_MODEL`.
- **`http-forward`** — `HTTP_FORWARD_URL` pointing at any JSON-accepting endpoint.

Example session:

```
webhook> personas
webhook> use failer
webhook> mention hi                # watch the fanout: github-stub succeeds, failer fails
webhook> drop failer
webhook> use http-forward          # HTTP_FORWARD_URL must be set before this
webhook> mention ping              # same event now fans out to the HTTP target too
```

## BYOH end-to-end locally

The `byoh-relay` persona publishes an `agent-assistant.execution-request.v1`
message over a real Relay broker to a **named worker** that must be registered
on the channel before the request arrives. The bundled bridge at
`examples/byoh-worker.ts` is that worker — it listens, invokes a
non-interactive CLI session (claude / codex / opencode / gemini), and emits a
protocol-compliant `agent-assistant.execution-result.v1` back.

Run it alongside the REPL in two terminals:

**Terminal 1 — the worker:**

```bash
# from the repo root
npm run worker -- --cli claude --model claude-sonnet-4-6

# or whichever CLI you have installed:
npm run worker -- --cli codex
npm run worker -- --cli opencode --model anthropic/claude-sonnet-4-5
npm run worker -- --cli gemini
```

You'll see:

```
[byoh-worker] registered as 'specialist-worker' on channel 'specialists' (cli=claude, cwd=/Users/you/...)
[byoh-worker] invoking 'claude' per request; timeout=120000ms
```

**Terminal 2 — the webhook runtime:**

```bash
# from the repo root
npm run agent
```

That starts the REPL with `RELAY_AUTO_SPAWN=false` (the worker you started in
terminal 1 owns that responsibility) and env set for the `specialists` channel
and `specialist-worker` name. Then at the prompt:

```
webhook> use byoh-relay
webhook> mention summarize the open github issues
```

The `byoh-relay` persona's `createAgentRelayExecutionAdapter` will publish
the request to `specialist-worker`. The worker in terminal 1 receives it,
invokes the configured CLI with the instruction as the prompt, captures stdout,
and replies with the result. You'll see the final response logged back in
terminal 2 as `[byoh-relay] channel=C_CLI eventType=app_mention -> <CLI output>`.

### Bash stub for testing without spending API tokens

```bash
npm run worker -- --cli bash --cli-args 'read -d "" prompt; echo "stub echoed: ${prompt:0:40}"'
```

Useful for validating the transport without invoking any real AI. The same
pattern drives the `src/byoh-worker-bridge.test.ts` smoke tests.

### Worker flags

| flag | meaning | default |
|---|---|---|
| `--cli <name>` | `claude` / `codex` / `opencode` / `gemini` / `bash` | `claude` |
| `--cli-args <string>` | shell-split extra args, only meaningful for `--cli bash` | (empty) |
| `--channel <id>` | Relay channel to listen on | `$RELAY_CHANNEL` or `specialists` |
| `--worker-name <name>` | agent name registered with broker | `$RELAY_WORKER` or `specialist-worker` |
| `--cwd <path>` | broker cwd (for `.agent-relay/connection.json` discovery) | `process.cwd()` |
| `--model <id>` | model passed to the CLI | `$RELAY_MODEL` or CLI default |
| `--timeout-ms <n>` | per-invocation CLI subprocess timeout | `120000` |

## What the CLI proves

Running the REPL exercises these code paths end-to-end:

- **HTTP ingestion** — the Hono routes on `/webhooks/slack` and
  `/webhooks/nango` in `src/http-runtime.ts`, including 400 handling for
  malformed bodies.
- **Payload parsing and normalization** — `parseSlackEvent` in
  `src/slack-parser.ts`. Lets you confirm what the detected `eventType`,
  `workspaceId`, `channel`, `deliveryId`, and `data` fields look like for a
  given raw Slack payload.
- **Nango envelope unwrapping** — the `/webhooks/nango` route strips
  `{from, connectionId, payload}` and re-normalizes the inner Slack event.
- **Registry fanout semantics** — `webhook-registry.ts`: predicate matching,
  error isolation across consumers, and the `total` / `succeeded` / `failed`
  / `skipped` counts returned to the HTTP caller.
- **Specialist-bridge wiring shape** — `registerSlackSpecialistConsumer`
  constructs a consumer that builds an `instruction` from the event, calls
  `specialistFactory`, invokes `handler.execute`, and hands the result to
  `egress`.

In other words, if your incident is "events aren't reaching the right
consumer" or "my payload normalizes wrong", the CLI is a complete
reproduction.

## What the CLI does NOT prove by default

With only the default personas registered (`echo` + `github-stub`), the
REPL does **not** validate:

- That the real specialist from `@agent-assistant/specialists` handles the
  event correctly (the stub factory never touches it). → use `github-real`.
- That the BYOH / Relay execution adapter routes events to a worker and
  returns a real `ExecutionResult`. → use `byoh-relay`.
- That external egress — posting back into Slack, writing to a DB,
  notifying a queue — works. `github-stub`'s egress just logs. → use
  `http-forward`.
- Slack request-signature verification. There is no signing middleware
  wired into the HTTP runtime today. No persona covers this.
- Any provider other than Slack. `/webhooks/nango` only accepts
  `from: slack` today.

Each persona above is an opt-in probe. The first three bullets are fully
addressable by swapping personas; the last two still require code changes.

## Triage guide

When triaging an issue, reach for the CLI first and use the output to
localize:

| symptom | likely cause | where to look |
|---|---|---|
| `POST` returns `[400] {"error":"..."}` | payload did not parse | `src/slack-parser.ts` |
| `[200]` but your consumer is in `skipped` | predicate did not match | predicate passed to `registerSlackSpecialistConsumer` / `registry.register` |
| `[200]` but your consumer is in `failed` | handler threw | stack logged via `[error]` — inspect the `area` field for the source module |
| normalized `event.data` missing fields you expected | Slack event shape drift | `src/slack-parser.ts` — extend the normalizer |
| `/webhooks/nango` returns `Unsupported Nango provider` | envelope `from` was not `slack` | `src/http-runtime.ts` `validateNangoSlackEnvelope` |
| `succeeded` empty when you expected a hit | consumer not registered, or registered on the wrong provider | `registry.register(...)` call site |

Each of these maps to a file you can edit and re-test in the same REPL —
there is no build step between iterations because the CLI runs via `tsx`.

## Running the test suite

```bash
npm test                       # all suites
npm test -- slack-parser       # filter to one file
npm test -- --reporter=verbose
```

Four suites cover the primitives directly: `webhook-registry`,
`slack-parser`, `http-runtime`, `specialist-bridge`.

## Using the primitives directly

If you want to embed the runtime in your own process instead of using the
CLI, the shape looks like:

```ts
import {
  createWebhookRegistry,
  parseSlackEvent,
  startHttpRuntime,
} from "@agent-assistant/webhook-runtime";

const registry = createWebhookRegistry();
registry.register({
  id: "my-consumer",
  kind: "local",
  provider: "slack",
  handler: (event) => console.log(event.eventType, event.data),
});

const runtime = startHttpRuntime({ registry, port: 3777 });
console.log(`listening at ${runtime.url}`);
```

## Consumer lifecycle

`WebhookRegistry` keeps registered consumer ids in a long-lived in-memory map.
Register stable process-level consumers once at startup. If a caller creates
consumer ids dynamically, it must call `unregister(id)` when that consumer is
no longer needed or `clear()` during teardown to release the entries.
