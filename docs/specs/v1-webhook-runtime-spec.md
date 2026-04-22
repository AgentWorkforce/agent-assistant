# v1 Webhook Runtime Spec — `@agent-assistant/webhook-runtime`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-22
**Package:** `@agent-assistant/webhook-runtime`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Adoption posture:** direct-import / replaces hand-rolled webhook plumbing in sage, nightcto, My-Senior-Dev

---

## 1. Responsibilities

`@agent-assistant/webhook-runtime` ships a typed primitive that replaces the hand-rolled
webhook → fanout → specialist pipelines each product reimplemented with subtle drift.
It owns the shape of "receive a provider webhook, normalize it, fan it out to registered
consumers, hand it to a specialist." Nothing more.

**Owns:**

- `WebhookRegistry` — `createWebhookRegistry({ logger })` with `register`, `unregister`,
  `clear`, and `fanout(provider, event)`. Fanout semantics mirror the cloud
  `WebhookConsumerRegistry`: per-consumer predicate, per-consumer HTTP timeout, and a
  typed `FanoutResult { total, succeeded, failed, skipped }`.
- `NormalizedWebhook` — the provider-agnostic event shape consumers receive.
- `parseSlackEvent(rawBody)` — handles both raw Slack Event API bodies and Nango
  forward envelopes, populating `connectionId`, `path: "nango.forward"`, and
  `data.nango` when a Nango envelope is detected. `team_id` resolution falls back
  through `event.team_id` → `authorizations[0].team_id` → `payload.team_id` →
  `event.team` for multi-tenant coverage.
- `registerSlackSpecialistConsumer({ registry, specialistFactory, ... })` —
  typed wiring from a parsed Slack event into a `@agent-assistant/specialists`
  run via an injectable factory (so tests and the local sim do not need real
  API keys).
- `startHttpRuntime({ registry, port, logger })` — Hono-based HTTP server exposing
  `POST /webhooks/slack` and `POST /webhooks/nango`. Both routes normalize via
  `parseSlackEvent` and delegate to `registry.fanout`. Returns `{ url, stop() }`.

**Does NOT own:**

- Provider auth / signature verification. Callers verify upstream (e.g. Slack
  signing secret at the ingress edge, or Nango's own signature check).
- Persistence or dedup. Event-id dedup lives in
  `@agent-assistant/surfaces/slack-event-dedup`; the registry is intentionally
  stateless.
- Specialist contracts, coordination, or LLM prompting — those stay in
  `@agent-assistant/specialists`, `@agent-assistant/coordination`, and product
  persona code.
- Retry / backoff / circuit-breaker policy beyond a per-consumer `timeoutMs`.
  Failures are reported truthfully in `FanoutResult.failed`; policy is the
  consumer's concern.
- GitHub, Linear, Notion parsers. Slack is the first provider; others are
  additive follow-ups.

---

## 2. Non-Goals

- No replacement for `@agent-assistant/coordination`'s `SpecialistRegistry`.
  The webhook registry routes webhooks → consumers; the specialist registry
  routes delegations → specialists. They compose, they do not overlap.
- No opinionated rate limiting. The HTTP runtime trusts the upstream edge to
  shed load.
- No event bus / pub-sub abstraction. Fanout is in-process and synchronous from
  the caller's perspective (each consumer awaited or spawned per the consumer's
  `kind`).

---

## 3. Core Contracts

```ts
type NormalizedWebhook = {
  provider: "slack" | "github" | "linear" | "notion" | (string & {});
  connectionId?: string | null;
  workspaceId?: string | null;
  eventType: string;
  objectType?: string;
  objectId?: string;
  payload: Record<string, unknown>;
  path?: string;                    // e.g. "slack.event" | "nango.forward"
  data?: Record<string, unknown>;   // normalized convenience fields
  deliveryId?: string | null;       // stable id for dedup upstream
  headers?: Record<string, string>;
  timestamp?: string;
};

type WebhookConsumer =
  | (Base & { kind: "http"; url: string; headers?: Record<string, string> })
  | (Base & { kind: "local"; handler: (e: NormalizedWebhook) => void | Promise<void> });

interface FanoutResult {
  total: number;
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
  skipped: Array<{ id: string; reason: "predicate" }>;
}
```

### 3.1 Nango envelope handling

`parseSlackEvent` accepts either a raw Slack body or a Nango envelope whose
`payload` is the Slack body. When the envelope is detected (`from === "slack"`
or the nested `payload` looks like a Slack event), the normalizer preserves
Nango-specific metadata:

- `connectionId` from `envelope.connectionId` or `envelope.connection_id`
- `path` is set to `"nango.forward"` (vs. `"slack.event"` for direct delivery)
- `data.nango` carries `{ type, from, providerConfigKey, connectionId }`

The `/webhooks/nango` HTTP route validates `from === "slack"` and the presence
of `payload`, then passes the **full envelope** (not the extracted payload) to
`parseSlackEvent` so none of the envelope metadata is dropped before
normalization. Extracting `envelope.payload` before normalization is a
regression and loses tenant/routing context.

---

## 4. Fanout Semantics

- Consumers are identified by a stable `id`. Registration replaces any prior
  entry with the same id.
- `fanout(provider, event)` filters by the consumer's `provider` / `providers`
  selector, then by optional `predicate`. Predicates return `false` to record
  a `skipped` outcome (`reason: "predicate"`).
- `kind: "http"` fan-outs `POST` the event as JSON with `timeoutMs` (default
  10s). Non-2xx responses are reported as `failed` with the response text
  truncated.
- `kind: "local"` fan-outs await the handler. Thrown errors are reported as
  `failed` and do not interrupt other consumers.
- The registry keeps consumer entries in a long-lived map. Callers creating
  dynamic ids must `unregister(id)` to avoid leaks; `clear()` resets the full
  map.

---

## 5. HTTP Runtime

`startHttpRuntime({ registry, port, logger })` returns `{ url, stop() }`:

- `POST /webhooks/slack` — body is a Slack Events API callback. 400 on
  malformed JSON or missing `event.type`.
- `POST /webhooks/nango` — body is a Nango forward envelope. 400 when `from`
  is not `slack` or `payload` is absent.
- Both routes respond with the `FanoutResult` JSON on success.
- `port: 0` is supported for ephemeral test servers; `url` reflects the bound
  address.

Signature verification is intentionally out of scope. Deployments that need
it should terminate verification at their ingress edge or wrap `startHttpRuntime`
with their own Hono middleware.

---

## 6. Testing Posture

The package ships a runnable end-to-end sim
(`examples/slack-to-github-sim.ts`) that boots the HTTP runtime, POSTs a
fixture Slack `app_mention`, exercises the registered specialist consumer
(with a stubbed factory), and exits 0. The sim is the "laptop reproduction"
for any future bug in this path and MUST stay green.

Vitest coverage:

- `webhook-registry.test.ts` — registration, predicate skipping, http/local
  fanout, timeout, and failure isolation.
- `slack-parser.test.ts` — raw Slack body, Nango envelope, multi-tenant
  `team_id` fallback, missing `event.type` rejection.
- `specialist-bridge.test.ts` — factory injection and error surfacing.
- `http-runtime.test.ts` — malformed JSON rejection, Slack happy path, Nango
  envelope metadata preservation, and non-Slack Nango rejection.

---

## 7. Migration Notes (Out of Scope for v0.1.0)

The primitive ships alone. Each consumer migrates in a follow-up PR:

- **sage** — replace `src/app/slack-webhooks.ts` + the `WEBHOOK_CONSUMERS_JSON`
  env path with `WebhookRegistry` + typed consumers. Closes the
  `WEBHOOK_CONSUMERS_JSON` footgun class.
- **nightcto** — `packages/relay-entrypoint` becomes a thin consumer over this
  registry.
- **My-Senior-Dev** — `packages/backend/src/routes/webhooks.ts` likewise.

Each migration preserves its own dedup / auth / persistence seams; this
package does not subsume them.
