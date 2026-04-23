# v1 — `github-real` Persona E2E Evidence

Evidence that the `github-real` persona exercises the default dynamic-import
specialist factory path end-to-end through the webhook runtime. Companion to
`docs/architecture/v1-github-real-persona-e2e-contract.md` — the contract
specified the acceptance criteria; this document records the proof that those
criteria are satisfied by
`packages/webhook-runtime/src/github-real-persona-e2e.test.ts`.

## 1. Proof summary

The `github-real` persona is distinguished from `byoh-relay` by passing **no
`specialistFactory` override** to `registerSlackSpecialistConsumer`. That means
the consumer resolves `opts.specialistFactory ?? defaultSpecialistFactory` to
`defaultSpecialistFactory`, which:

- Dynamically imports `@agent-assistant/specialists`.
- Invokes `createGitHubLibrarian({ vfs: emptyVfs })`.
- Calls `handler.execute(instruction, context)` on the returned specialist.
- Forwards the response through `opts.egress`.

The new test `github-real-persona-e2e.test.ts` boots the real HTTP runtime on
an ephemeral port, posts a Slack `app_mention` webhook at it, and — with
`@agent-assistant/specialists` mocked — asserts that every step of the
dynamic-import default-factory path is reached, that the empty VFS is the
exact object wired to the specialist, that the instruction + context shape
match the contract, and that the egress sink receives the specialist's
response. A second test proves the predicate gate: a non-`app_mention` Slack
event is skipped and never reaches the factory or egress.

Both tests pass. The full webhook-runtime suite (7 files, 26 tests including
the real-broker proof and the existing BYOH/mocked tests) passes green
alongside them, confirming no regressions. Before this change the `github-real`
persona had no automated coverage of its default-factory path; after, the
factory path, the VFS wiring, the instruction routing, the context shape, the
egress response plumbing, and the predicate skip are all asserted.

## 2. What was asserted

All assertions below are transcribed verbatim from
`packages/webhook-runtime/src/github-real-persona-e2e.test.ts`.

### Test A — `routes Slack app_mention events to the default GitHub specialist factory`

HTTP contract:

- `expect(response.status).toBe(200);`
- `expect(body.succeeded).toContain("github-real");`
- `expect(body.failed).toEqual([]);`

Default factory invocation and empty-VFS shape:

- `expect(capturedVfs).toHaveLength(1);`
- `expect(typeof vfs.list).toBe("function");`
- `expect(typeof vfs.search).toBe("function");`
- `await expect(vfs.list("/")).resolves.toEqual([]);`
- `await expect(vfs.search("x")).resolves.toEqual([]);`

Specialist `handler.execute` call:

- `expect(executeCalls).toHaveLength(1);`
- `expect(executeCall.instruction).toBe(instruction);`
  — where `instruction` is `"<@U_BOT> find open PRs in repo acme/widgets"`,
  i.e. the event's `text` field as produced by `instructionForEvent`.
- `expect(executeCall.context).toMatchObject({ source: "webhook-runtime", consumerId: "github-real", specialistKind: "github" });`
- `expect(context.webhookEvent?.eventType).toBe("app_mention");`
- `expect(context.webhookEvent).toMatchObject({ eventType: "app_mention" });`

Egress plumbing:

- `expect(egressCalls).toHaveLength(1);`
- `expect(egressCall.consumerId).toBe("github-real");`
- `expect(egressCall.specialistKind).toBe("github");`
- `expect(egressCall.response).toBe("mocked github-real response");`
- `expect(egressCall.event).toEqual(context.webhookEvent);`

### Test B — `skips github-real for Slack events that are not app_mention events`

- `expect(response.status).toBe(200);`
- `await expect(response.json()).resolves.toEqual({ total: 1, succeeded: [], failed: [], skipped: [{ id: "github-real", reason: "predicate" }] });`
- `expect(capturedVfs).toHaveLength(0);`
- `expect(executeCalls).toHaveLength(0);`
- `expect(egressCalls).toHaveLength(0);`

These assertions together demonstrate (a) the real HTTP runtime returns the
documented fanout envelope, (b) the predicate skip is reported with the
documented `{ id, reason }` shape, and (c) no code downstream of the predicate
(dynamic import, factory, execute, egress) is reached for non-`app_mention`
events.

## 3. Mock scope

A single module is mocked, with two exports:

```ts
vi.mock("@agent-assistant/specialists", () => ({
  createGitHubLibrarian: vi.fn(({ vfs }) => {
    capturedVfs.push(vfs);
    return {
      handler: {
        execute: vi.fn(async (instruction, context) => {
          executeCalls.push({ instruction, context });
          return "mocked github-real response";
        }),
      },
    };
  }),
  createLinearLibrarian: vi.fn(),
}));
```

Mock scope is intentionally minimal:

- Only `@agent-assistant/specialists` is mocked. The webhook runtime, registry,
  HTTP layer, persona catalog, specialist bridge, and `defaultSpecialistFactory`
  are all the real production code.
- `createGitHubLibrarian` is replaced with a spy that captures the `vfs` it was
  given and returns a stub specialist whose `handler.execute` records its
  arguments and returns a sentinel string.
- `createLinearLibrarian` is stubbed as `vi.fn()` only because the real module
  re-exports it; it is never called in either test.
- `vi.hoisted` is used so the capture arrays (`capturedVfs`, `executeCalls`,
  `egressCalls`) are initialised before the mock factory runs, matching the
  contract's recommended mocking shape (§4 of the contract).
- The egress spy is installed by calling `registerSlackSpecialistConsumer`
  directly with a custom `egress` that pushes into `egressCalls` — the persona
  catalog's default `logEgress` wrapper is intentionally bypassed so egress
  outcomes are assertable rather than merely logged (per residual risk #7 in
  the contract).

Any invocation of the mocked `createGitHubLibrarian` is itself proof that the
`await import("@agent-assistant/specialists")` inside `defaultSpecialistFactory`
resolved successfully — the dynamic import path is exercised implicitly by the
mock being hit.

## 4. Full suite output (tail)

Full webhook-runtime suite (`npm --workspace @agent-assistant/webhook-runtime test`):

```
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

 ✓ src/byoh-webhook-e2e.test.ts (2 tests) 61ms
stdout | src/github-real-persona-e2e.test.ts > github-real persona webhook e2e > skips github-real for Slack events that are not app_mention events
Webhook fanout completed {
  area: 'webhook-fanout',
  provider: 'slack',
  eventType: 'message',
  total: 1,
  succeeded: 0,
  failed: 0,
  skipped: 1
}

 ✓ src/http-runtime.test.ts (5 tests) 75ms
 ✓ src/github-real-persona-e2e.test.ts (2 tests) 50ms
 ✓ src/byoh-webhook-real-broker-e2e.test.ts (2 tests) 16926ms
   ✓ byoh real-broker E2E > round-trips an ExecutionRequest through the real agent-relay broker and returns a typed ExecutionResult  7168ms
   ✓ byoh real-broker E2E > times out with a retryable error when no worker responds  9757ms

 Test Files  7 passed (7)
      Tests  26 passed (26)
   Start at  13:12:06
   Duration  17.59s (transform 277ms, setup 0ms, collect 914ms, tests 17.14s, environment 1ms, prepare 720ms)
```

Focused `github-real` run (`npm --workspace @agent-assistant/webhook-runtime test -- github-real-persona-e2e`):

```
> @agent-assistant/webhook-runtime@0.1.1 test
> vitest run github-real-persona-e2e

 RUN  v3.2.4 /Users/khaliqgant/Projects/AgentWorkforce/agent-assistant/packages/webhook-runtime

stdout | src/github-real-persona-e2e.test.ts > github-real persona webhook e2e > routes Slack app_mention events to the default GitHub specialist factory
Webhook fanout completed {
  area: 'webhook-fanout',
  provider: 'slack',
  eventType: 'app_mention',
  total: 1,
  succeeded: 1,
  failed: 0,
  skipped: 0
}

stdout | src/github-real-persona-e2e.test.ts > github-real persona webhook e2e > skips github-real for Slack events that are not app_mention events
Webhook fanout completed {
  area: 'webhook-fanout',
  provider: 'slack',
  eventType: 'message',
  total: 1,
  succeeded: 0,
  failed: 0,
  skipped: 1
}

 ✓ src/github-real-persona-e2e.test.ts (2 tests) 24ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  13:11:04
   Duration  274ms (transform 52ms, setup 0ms, collect 71ms, tests 24ms, environment 0ms, prepare 38ms)
```

Summary line cross-check (from the driver output):

```
total: 1,
succeeded: 1,
failed: 0,
skipped: 0
```

## 5. Before / after

**Before.** The `github-real` persona was wired in `examples/personas.ts` and
documented in the v1 contract as the "default dynamic-import factory" path,
but no automated test booted the HTTP runtime against it. The only persona
covered end-to-end through the real HTTP runtime was `byoh-relay`
(`byoh-webhook-e2e.test.ts` for the mocked variant and
`byoh-webhook-real-broker-e2e.test.ts` for the real broker). The
`defaultSpecialistFactory` dynamic-import branch of `specialist-bridge.ts`,
the `emptyVfs` wiring, the `instructionForEvent` routing for `app_mention`,
and the egress plumbing for the default path were all exercised only by type
checking and hand inspection.

**After.** `packages/webhook-runtime/src/github-real-persona-e2e.test.ts`
boots the real HTTP runtime, registers the `github-real` consumer through
the real persona catalog (sans the default `logEgress` so egress is
assertable), fires a real HTTP POST to `/webhooks/slack`, and asserts — with
only `@agent-assistant/specialists` mocked — the full happy-path chain and
the predicate-skip chain. Coverage now includes:

- The dynamic `import("@agent-assistant/specialists")` resolves (proved by the
  mock being hit).
- `createGitHubLibrarian` receives the `emptyVfs` whose `list`/`search`
  return `[]`.
- `handler.execute` receives the correct instruction and the documented
  `{ source, consumerId, specialistKind, webhookEvent }` context.
- The egress sink receives `consumerId`, `specialistKind`, the same
  normalized event, and the specialist's response verbatim.
- Non-`app_mention` events are skipped with the documented `{ id, reason }`
  envelope and never reach the factory or egress.

The full webhook-runtime suite continues to pass (7 files, 26 tests,
including the existing mocked BYOH test and the real-broker proof), so the
new coverage is additive rather than displacing prior proofs.

## 6. Residual risks

Carried from the contract (§3 Scope — OUT and §6 Residual Risks). This
evidence does **not** prove:

1. **Real `createGitHubLibrarian` behavior.** The entire
   `@agent-assistant/specialists` module is mocked, so the librarian engine,
   filter inference, adapter selection, evidence shaping, and API fallback
   are not exercised. Those belong to specialists-package tests.
2. **Real GitHub authentication or network calls.** No live GitHub traffic is
   issued; the specialist is a spy.
3. **Real VFS semantics.** `emptyVfs.list`/`search` always return `[]`. Any
   regression in how a non-empty VFS would be wired is invisible here.
4. **Linear specialist variant.** `createLinearLibrarian` is stubbed but
   never invoked; the Linear path is out of scope.
5. **Dynamic-import failure modes.** A production install where
   `@agent-assistant/specialists` is missing or fails to resolve is not
   covered — the mock guarantees resolution in the test.
6. **Egress transport correctness.** The test uses a spy egress; it does not
   prove Slack posting, retry, or any network-side behavior.
7. **Turn/assistant identifiers (`assistantId`, `turnId`, `systemPrompt`)**
   are explicitly **not** asserted — those belong to the BYOH adapter path.
   Reviewers should not port BYOH `ExecutionRequest` assertions into this
   suite.
8. **Mock drift vs. real module shape.** If the real
   `createGitHubLibrarian` renames `handler` or changes its return shape,
   this test can remain green while production breaks. A type-level
   `satisfies` guard is noted in the contract as optional future
   hardening.
9. **Single-event assumption.** Assertions are `toHaveLength(1)`; duplicate
   delivery (retries, idempotency misses) would flag a regression but not
   explain it. De-duplication is a runtime concern.
10. **Predicate-only gating.** Test B proves predicate skip but not Slack
    signature verification or ingress auth — those live upstream of the
    consumer.

## 7. How to run

Focused run (the two `github-real` persona tests only):

```
npm --workspace @agent-assistant/webhook-runtime test -- github-real-persona-e2e
```

Full webhook-runtime suite (for regression confirmation):

```
npm --workspace @agent-assistant/webhook-runtime test
```

V1_GITHUB_REAL_PERSONA_PROVEN
