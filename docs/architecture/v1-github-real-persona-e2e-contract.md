# v1 — `github-real` Persona E2E Contract

Acceptance contract for proving the `github-real` persona exercises the real
SDK default path end-to-end through the webhook runtime. Derived strictly from
the sources provided (persona catalog entry, `specialist-bridge.ts`, specialists
entry + `createGitHubLibrarian`, and the existing mocked `byoh-relay` webhook
e2e test). No speculation.

## 1. Goal

Prove the following flow with a single HTTP request:

```
HTTP POST /webhooks/slack (Slack app_mention event)
  → webhook runtime fan-out
  → github-real consumer (registered via registerSlackSpecialistConsumer; NO specialistFactory override)
  → defaultSpecialistFactory in specialist-bridge.ts
  → dynamic import("@agent-assistant/specialists")
  → createGitHubLibrarian({ vfs: emptyVfs })
  → specialist.handler.execute(instruction, context)
  → opts.egress({ consumerId, specialistKind, event, response })
```

Where:

- `instruction` is produced by `instructionForEvent(event)`.
- `context` is `{ source: "webhook-runtime", consumerId: "github-real", specialistKind: "github", webhookEvent: event }`.
- `response` is the value returned from `handler.execute`.

The `github-real` persona is distinguished from `byoh-relay` by the fact that
it passes **no `specialistFactory`**, so `opts.specialistFactory ??
defaultSpecialistFactory` resolves to `defaultSpecialistFactory`.

## 2. Scope — IN

The e2e test must prove, for a single Slack `app_mention` event posted to the
runtime:

1. The dynamic import of `@agent-assistant/specialists` is invoked (asserted via
   `vi.mock` of the module being hit — any call into the mocked module is proof
   the import resolved).
2. `createGitHubLibrarian` is called with exactly `{ vfs }`, where `vfs` is the
   `emptyVfs` instance from `specialist-bridge.ts`:
   - `typeof vfs.list === "function"`
   - `typeof vfs.search === "function"`
   - `await vfs.list("anything")` resolves to `[]`
   - `await vfs.search("anything")` resolves to `[]`
3. `specialist.handler.execute` is invoked with `(instruction, context)` where:
   - `instruction` equals what `instructionForEvent(event)` produces for the
     normalized webhook (for an `app_mention` with a non-empty `text`, this is
     exactly `event.data?.text`).
   - `context` is an object with:
     - `source === "webhook-runtime"`
     - `consumerId === "github-real"`
     - `specialistKind === "github"`
     - `webhookEvent` is the normalized `NormalizedWebhook` event delivered by
       the runtime.
4. `opts.egress` is called once with an object containing:
   - `consumerId === "github-real"`
   - `specialistKind === "github"`
   - `event` equal to the normalized event
   - `response` equal to the value returned by the mocked `handler.execute`
5. Predicate gating: a Slack webhook whose event is **not** `app_mention` is
   skipped by the consumer's predicate — the specialists module is never
   imported, `createGitHubLibrarian` is never called, `handler.execute` is
   never called, and `egress` is never called.

## 3. Scope — OUT (residual risks)

These are explicitly **not** proven by this contract:

- Real GitHub authentication, network calls, or live repository enumeration —
  the entire `@agent-assistant/specialists` module is mocked, so the real
  `createGitHubLibrarian` implementation is never executed.
- The actual behavior of `createGitHubLibrarian` internals (librarian engine,
  adapter, filter inference, evidence shaping, API fallback). Covered — if at
  all — by specialists package tests, not by this e2e.
- The Linear specialist variant (`specialistKind: "linear"` →
  `createLinearLibrarian`). Covered separately if required.
- Error handling when `@agent-assistant/specialists` is not installed or fails
  to resolve at dynamic-import time. The mock guarantees resolution in the
  test; broken installations are a build/packaging concern.
- Egress transport correctness (e.g., Slack posting). The contract only asserts
  `opts.egress` is invoked with the documented shape; the provided `logEgress`
  is a logging egress, not a network egress.
- Turn/assistant identifiers (`assistantId`, `turnId`, `systemPrompt`) — those
  belong to the BYOH adapter path in `byoh-relay`, not to the default factory
  path. The default factory does not wrap the instruction in an
  `ExecutionRequest`.

## 4. Mocking Strategy

Shape, modeled on the existing `byoh-webhook` test (`vi.hoisted` + `vi.mock`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedWebhook } from "…";

const createGitHubLibrarianCalls = vi.hoisted(
  () => [] as Array<{ vfs: unknown }>,
);
const executeCalls = vi.hoisted(
  () => [] as Array<{ instruction: string; context: unknown }>,
);
const executeResult = vi.hoisted(() => ({
  capability: "github.enumerate" as const,
  status: "ok",
  evidence: [] as const,
}));

vi.mock("@agent-assistant/specialists", () => ({
  createGitHubLibrarian: vi.fn((opts: { vfs: unknown }) => {
    createGitHubLibrarianCalls.push({ vfs: opts.vfs });
    return {
      handler: {
        async execute(instruction: string, context: unknown) {
          executeCalls.push({ instruction, context });
          return executeResult;
        },
      },
    };
  }),
}));
```

Notes:

- The mock replaces the entire dynamic-imported module. Any invocation of the
  factory is proof the dynamic import path was hit.
- Egress is captured by installing a custom egress when registering the
  consumer (either by re-registering via `registerSlackSpecialistConsumer`
  directly with a spy egress, or by wrapping `personaCatalog["github-real"]`
  and swapping the egress). The simplest form records calls in an
  `egressCalls` array hoisted alongside the other arrays.

The `vfs` argument captured in `createGitHubLibrarianCalls[0].vfs` is the
reference used to verify the empty-VFS shape in §5.

## 5. Exact Assertions the Test MUST Make

### Test A — happy path: `app_mention` routes to the real default factory

Given a POST to `/webhooks/slack` with body:

```json
{
  "type": "event_callback",
  "event_id": "Ev_GH_REAL_E2E",
  "event_time": 1700000500,
  "event": {
    "type": "app_mention",
    "team_id": "T_GH",
    "channel": "C_GH",
    "user": "U_GH",
    "text": "<@U_BOT> find open PRs in repo acme/widgets",
    "ts": "1700000500.000001",
    "event_ts": "1700000500.000001"
  }
}
```

Assertions:

1. HTTP response status is `200`.
2. Fanout body: `body.succeeded` contains `"github-real"`; `body.failed` equals
   `[]`.
3. `createGitHubLibrarian` called exactly once:
   - `expect(createGitHubLibrarianCalls).toHaveLength(1)`.
4. The config arg to `createGitHubLibrarian` matches the empty VFS shape:
   - `const { vfs } = createGitHubLibrarianCalls[0];`
   - `expect(typeof vfs.list).toBe("function")`
   - `expect(typeof vfs.search).toBe("function")`
   - `await expect(vfs.list("whatever")).resolves.toEqual([])`
   - `await expect(vfs.search("whatever")).resolves.toEqual([])`
5. `handler.execute` called exactly once:
   - `expect(executeCalls).toHaveLength(1)`.
6. First arg (`instruction`) equals the event's `text` field:
   - `expect(executeCalls[0].instruction).toBe("<@U_BOT> find open PRs in repo acme/widgets")`.
7. Second arg (`context`) matches the documented shape:
   - `expect(executeCalls[0].context).toMatchObject({ source: "webhook-runtime", consumerId: "github-real", specialistKind: "github" })`.
   - `expect(executeCalls[0].context.webhookEvent).toMatchObject({ eventType: "app_mention" })`
     (the normalized event the runtime delivered to the handler).
8. Egress called exactly once with:
   - `consumerId === "github-real"`
   - `specialistKind === "github"`
   - `event` deep-equal to the same normalized event passed into
     `handler.execute` as `context.webhookEvent`
   - `response` strictly equal (`===` or deep-equal) to `executeResult`, i.e.
     the value the mocked `handler.execute` returned.

### Test B — predicate skip: non-`app_mention` event

Given a POST to `/webhooks/slack` with a `message` (not `app_mention`) event:

```json
{
  "type": "event_callback",
  "event_id": "Ev_GH_REAL_SKIP",
  "event_time": 1700000600,
  "event": {
    "type": "message",
    "team_id": "T_GH",
    "channel": "C_GH",
    "user": "U_GH",
    "text": "ordinary channel message",
    "ts": "1700000600.000001",
    "event_ts": "1700000600.000001"
  }
}
```

Assertions:

1. HTTP response status is `200`.
2. Body deep-equals:
   ```json
   {
     "total": 1,
     "succeeded": [],
     "failed": [],
     "skipped": [{ "id": "github-real", "reason": "predicate" }]
   }
   ```
3. `createGitHubLibrarianCalls` is empty (`toHaveLength(0)`).
4. `executeCalls` is empty (`toHaveLength(0)`).
5. No egress invocation was recorded.

## 6. Residual Risks (enumerated)

1. **Mock drift vs. real module shape.** The test mocks
   `@agent-assistant/specialists` to return a factory whose returned object
   exposes `{ handler: { execute } }`. If the real module's
   `createGitHubLibrarian` return shape diverges (e.g., renames `handler`),
   this test will still pass while production breaks. Mitigation: rely on the
   type re-export in `specialists/index.ts` + a type-level assertion in the
   test (`satisfies GitHubLibrarianSpecialist`) if desired — out of scope for
   this contract beyond noting the risk.
2. **Empty VFS is not real VFS.** `emptyVfs.list`/`search` always return `[]`.
   Real VFS-backed enumeration is never exercised by this test. Any regression
   in how the default factory wires VFS to the specialist is invisible here.
3. **Dynamic import cache.** `await import("@agent-assistant/specialists")` is
   module-cached. In the mocked test the cache hit is benign; in production a
   failed first import is sticky. Not covered.
4. **Predicate-only gating.** Test B proves predicate-based skip but does not
   prove authentication, signature verification, or any Slack ingress checks —
   those live upstream of the consumer and are out of scope here.
5. **Single-event assumption.** Tests assert `toHaveLength(1)` against
   in-process call arrays. If the runtime delivers duplicate events (retries,
   idempotency misses), the assertions would flag a regression but not explain
   it. De-duplication is a runtime concern, not this contract's.
6. **No systemPrompt / ExecutionRequest shape.** Unlike `byoh-relay`, the
   default-factory path does **not** construct an `ExecutionRequest` with
   `assistantId`/`turnId`/`instructions.systemPrompt`. The test must **not**
   assert on those; doing so would couple this contract to the BYOH adapter
   internals. Risk: reviewers copy-pasting BYOH assertions into this test
   suite. Mitigation: call this out explicitly in the test file comment.
7. **Egress wrapping.** The persona catalog wires `egress: ({ consumerId,
   event, response }) => logEgress(consumerId, event, response)`. The test
   must replace the egress with a spy (either by re-registering via
   `registerSlackSpecialistConsumer` directly or by substituting in the
   persona). Reusing the real `logEgress` would produce log noise but not
   assertable state — a risk of false-positive passes if a spy is omitted.

V1_GITHUB_REAL_PERSONA_CONTRACT_READY
