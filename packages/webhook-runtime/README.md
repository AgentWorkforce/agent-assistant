# @agent-assistant/webhook-runtime

Shared webhook runtime primitives for normalizing provider events, registering
local or HTTP consumers, and fanning events out consistently.

This package removes duplicated webhook plumbing that sage / nightcto /
my-senior-dev all hand-roll today.

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
- **`byoh-relay`** — install `@agent-assistant/harness` (declared as an optional peer dep; the persona dynamic-imports `@agent-assistant/harness/agent-relay`). Needs a running Relay broker and a worker already registered on the channel (the adapter rejects `sendMessage` to unknown agent names with `Agent "<name>" not found`). Either spawn the worker yourself before POSTing or set `RELAY_AUTO_SPAWN=true`. Env vars: `RELAY_CHANNEL`, `RELAY_WORKER`, `RELAY_AUTO_SPAWN`, `RELAY_CLI`, `RELAY_MODEL`.
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
