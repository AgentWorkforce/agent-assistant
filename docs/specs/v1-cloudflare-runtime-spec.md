# v1 Cloudflare Runtime Spec — `@agent-assistant/cloudflare-runtime`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-25
**Package:** `@agent-assistant/cloudflare-runtime`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Adoption posture:** direct-import / Cloudflare-Workers adapter for personas built on `@agent-assistant/continuation`

---

## 1. Responsibilities

`@agent-assistant/cloudflare-runtime` is the platform-specific bridge that lets a persona
built on `@agent-assistant/continuation` run on Cloudflare Workers without each persona
re-implementing webhook ingress, queue dispatch, dedup, ExecutionContext lifetime
management, signature verification, or the wiring that ties the continuation runtime
into Workers Queues + Durable Objects + KV.

**Owns:**

- `wrapCloudflareWorker(opts)` — a `fetch` handler that intercepts persona-declared
  webhook routes, delegates signature-verification + parsing to the persona, runs
  ingress dedup against `@agent-assistant/surfaces`'s `SlackEventDedupGate`, and
  enqueues a turn descriptor onto the persona's Turn Queue. Non-webhook routes fall
  through to `opts.inner.fetch`.
- `handleCfQueue(batch, env, ctx, opts)` — a queue consumer that wraps every
  message in a fake `ExecutionContext` whose `waitUntil(p)` collects `p` onto an
  internal array; the wrapper awaits all collected promises **before** the message
  is acked. This is the direct fix for the production Slack-silence bug where
  Cloudflare cancels `waitUntil` ~30s after the originating fetch returns.
- `createFakeExecutionContext()` — the standalone shim used by `handleCfQueue`,
  exposed so personas writing their own consumers get the same guarantee.
- `CfContinuationStore` — implements `ContinuationStore` from
  `@agent-assistant/continuation` against a Durable Object's storage (primary) plus
  an optional KV namespace acting as the trigger index for cross-DO `findByTrigger`
  lookups. The DO is the single writer for its conversation; KV is a secondary,
  eventually-consistent index.
- `CfContinuationScheduler` — implements `ContinuationSchedulerAdapter` against
  DO alarms (same-DO wakeups) and a Workers Queue with `delaySeconds` (cross-DO
  wakeups).
- `CfDeliveryAdapter` — implements `ContinuationDeliveryAdapter` and dispatches to
  persona-supplied delivery callbacks for `slack`, `github`, and `a2a-callback`
  delivery targets. Returns `{ delivered: false, failureReason }` when the
  matching handler is not registered or when the target kind is unknown — never
  silently swallows.
- `CfSpecialistClient` — typed helper for the async sage↔specialist bridge: enqueue
  a `specialist_call` message and wait for the matching `specialist_result` message
  via the continuation runtime's resume path.
- `TurnExecutorDO` — abstract Durable Object base class personas extend. Owns the
  per-conversation lock that keeps the continuation store consistent under
  concurrent webhooks.
- `verifySlackSignature` / `verifyGitHubSignature` — helpers personas import inside
  their own `parseSlackWebhook` / `parseGitHubWebhook`. The runtime never verifies
  signatures itself (it has no access to the per-workspace signing secrets).
- Observability primitives — `CfLogger` interface plus `consoleJsonLogger`,
  `nullLogger`, `createConsoleJsonLogger`, and `createCapturingLogger` for tests.
  Wired through `wrapCloudflareWorker` and `handleCfQueue` so every step in a
  turn's lifecycle emits a structured event.

**Does NOT own:**

- Persona-specific signature verification logic. Personas hold the signing secrets
  and call the helpers inside their `parse*Webhook` returning a `ParseResult`.
- The shape of `TurnDescriptor`. Personas define their own descriptor type and
  return it from their `parseWebhook`. The runtime treats descriptors as opaque
  payloads inside the queue message.
- The harness loop. Persona packages export `run<Persona>Turn(descriptor, env, ctx)`
  which the runtime invokes from inside the fake `ExecutionContext`.
- Cloudflare Worker secrets, bindings, or SST infra. Those live in the consuming
  repo (e.g. `cloud/packages/cloudflare-agent-bindings`,
  `cloud/infra/agent-persona.ts`).
- Cloudflare-specific app coupling. The package treats `Env` as a generic and only
  reaches into bindings the caller names.

## 2. Invariants

These are load-bearing — violations are bugs the runtime must fail closed on.

1. **`waitUntil` never orphans.** Inside `handleCfQueue`, `ctx.waitUntil(p)` is
   equivalent to `await p` — the consumer awaits all collected promises before the
   message is acked. Direct regression test for the production Slack-silence bug.
2. **Continuation writes are synchronous on suspend.** A turn that suspends MUST
   write its continuation to the store before the consumer returns; losing the
   write loses the turn.
3. **Signature verification belongs to the persona.** `wrapCloudflareWorker` does
   not call signature helpers itself. Each `WebhookRouteConfig` provides
   `verify(req, env)`; if it returns `{ ok: false }` the runtime returns 401.
4. **Dedup runs exactly once, at ingress.** Personas MUST NOT re-implement Slack /
   GitHub event dedup; `wrapCloudflareWorker` claims the dedup key against the
   `dedupBinding` KV via `SlackEventDedupGate` from `@agent-assistant/surfaces`.
5. **The DO is the single writer for its conversation's continuation records.**
   The KV trigger index is eventually consistent and is only used for cross-DO
   `findByTrigger` lookups; record state always lives in DO storage.
6. **The dedup primitive is the upstream `SlackEventDedupGate`** from
   `@agent-assistant/surfaces`. The runtime imports it; it does not fork the gate
   class.
7. **Personas expose a two-function contract** — `parse<Surface>Webhook(req, env)`
   returning a `ParseResult` and `run<Persona>Turn(descriptor, env, ctx)` running
   the harness. The runtime composes them.

## 3. Persona contract

Each persona built on this runtime exports two functions per surface (Slack,
GitHub, Nango, …) plus a `<Persona>TurnDescriptor` type:

```ts
export interface ParseResult {
  kind: 'ack' | 'dispatch';
  response: Response;            // sent back to the caller (challenge, ack, dispatch)
  turn?: unknown;                // present when kind === 'dispatch'
  dedupKey?: { eventId?: string; ts?: string };  // for ingress dedup
}

export async function parseSlackWebhook(
  req: Request,
  env: PersonaEnv,
): Promise<ParseResult>;

export async function runSageTurn(
  descriptor: SageTurnDescriptor,
  env: SageEnv,
  ctx: ExecutionContext,   // may be the fake-ctx in queue consumers
): Promise<void>;
```

`parseSlackWebhook` is responsible for signature verification, Slack URL-verification
challenge handling, persona policy gates (rate limit, mention/thread gate), and
returning either an ack-only `Response` or a `dispatch` payload that the runtime
will dedup-claim and enqueue.

`run<Persona>Turn` runs the harness work synchronously relative to its caller. Any
internal use of `ctx.waitUntil` is for genuinely out-of-band work (telemetry,
status reactions); the **turn itself** must be awaited.

## 4. Queue message shape

```ts
type WebhookQueueMessage = {
  type: 'webhook';
  provider: 'slack' | 'github' | 'nango';
  descriptor: unknown;       // persona-defined TurnDescriptor
  receivedAt: string;
};

type ResumeQueueMessage = {
  type: 'resume';
  continuationId: string;
  trigger: ContinuationResumeTrigger;
};

type SpecialistCallQueueMessage = { ... };
type SpecialistResultQueueMessage = { ... };

type TurnQueueMessage =
  | WebhookQueueMessage
  | ResumeQueueMessage
  | SpecialistCallQueueMessage
  | SpecialistResultQueueMessage;
```

`handleCfQueue` is generic over message type so personas can extend the union
with their own variants.

## 5. Trigger index keying

`CfContinuationStore.findByTrigger(trigger)` looks up continuations via a KV
secondary index. Both sides of the lookup (`continuationTriggerIndexKey` and
`resumeTriggerIndexKey`) **must agree on key shape**. Today:

| Trigger type | Key | Notes |
| --- | --- | --- |
| `approval_resolution` | `trigger:approval_resolution:${approvalId}` | symmetric |
| `external_result` | `trigger:external_result:${operationId}` | symmetric |
| `scheduled_wake` | `trigger:scheduled_wake:${wakeUpId ?? recordId-or-empty}` | wake by id or fallback |
| `user_reply` | `trigger:user_reply:${correlationKey}` (if set) | **see below** |

For `user_reply`: the upstream `ContinuationResumeTrigger` does not carry a
`correlationKey` field — only the `waitFor` side has one. `findByTrigger` for
user_reply therefore returns `null` unless callers wire correlation themselves
(e.g. via `listBySession`). Both `continuationTriggerIndexKey` and
`resumeTriggerIndexKey` return `undefined` for user_reply when no correlation key
is available; the lookup is a no-op rather than a false miss against a synthetic
key. Personas with thread/channel correlation should either extend the trigger
shape upstream or use `listBySession` to fan out.

When `put` updates an existing record whose trigger key has changed, the store
deletes the prior trigger index entry before writing the new one, so stale keys
never resolve to the wrong record.

## 6. Observability

`wrapCloudflareWorker` and `handleCfQueue` both accept an optional `logger:
CfLogger`. When omitted, they default to `consoleJsonLogger` which emits one
structured JSON line per event to stdout (renders cleanly in
`wrangler tail --format json`).

Lifecycle events emitted:

- `webhook received` — info — at every webhook ingress
- `signature verification failed` — warn — verify returned ok: false
- `parse complete` — debug — kind, hasDedupKey
- `ack-only response` — info — when parse returns `kind: 'ack'`
- `duplicate event — skipping enqueue` — info — dedup gate said skip
- `turn enqueued` — info — message sent to Turn Queue
- `dispatch start` — debug — queue consumer began running runTurn
- `dispatch complete` — info — runTurn returned, includes `durationMs`,
  `waitUntilCount`
- `dispatch failed` — error — runTurn threw

Persona-injectable hatches:

- Custom `CfLogger` ships events anywhere (Workers Analytics Engine, Datadog).
- `child(bindings)` correlates log lines by turnId / conversationId / component.
- `resolveTurnId(message)` extracts a stable id so every log line for one turn
  greps with the same key.
- `nullLogger` silences in tests; `createCapturingLogger()` returns the logger +
  a records array for assertions.

## 7. Out of scope for v1

- Cloudflare Workflows. Continuations + DO alarms cover the same ground without
  a second checkpointed-step abstraction.
- Cron-driven workloads (cataloging agents). Different shape; reusable
  `CfContinuationStore` / `CfContinuationScheduler` only if a sync truly outgrows
  a single DO alarm.
- Per-workspace rate limiting at the runtime layer. Personas own rate limiting
  inside `parse*Webhook` (they own the workspace identity).

## 8. Reference

Full architecture and workflow runbook live in the consuming repo at
`workflows/cf-runtime/SPEC.md` and `workflows/cf-runtime/ARCHITECTURE.md`
(`AgentWorkforce/cloud`).
