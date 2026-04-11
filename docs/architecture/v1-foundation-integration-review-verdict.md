# v1 Foundation Integration Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Reviewer:** Non-interactive review agent
**Scope:** WF-4 (core + sessions) and WF-6 (core + sessions + surfaces)
**Artifacts reviewed:**
- `docs/architecture/v1-foundation-integration-plan.md`
- `packages/core/src/core.ts`
- `packages/core/src/core-sessions.test.ts`
- `packages/core/src/core-sessions-surfaces.test.ts`
- `packages/sessions/src/sessions.ts`
- `packages/surfaces/src/surfaces.ts`
- `docs/architecture/v1-core-review-verdict.md`
- `docs/architecture/v1-sessions-review-verdict.md`
- `docs/architecture/v1-surfaces-review-verdict.md`

---

## 1. Do the Integration Tests Actually Prove WF-4 and WF-6 Behavior?

### WF-4 Coverage (`core-sessions.test.ts`)

The plan specified 9 tests. All 9 are present and correctly exercising the intended behaviors.

| Plan item | Test name | Result |
|---|---|---|
| 2.1 — Subsystem registration | "registers the session store as a runtime subsystem" | ✅ |
| 2.2 — Session resolution (new) + touch | "resolves a new session on first message, attaches the surface, and touches it active" | ✅ |
| 2.2 — Session resolution (existing) | "resolves the existing session for subsequent messages" | ✅ |
| 2.3 — Emit → session → per-surface send | "emits to every surface attached to the session when fanout is unavailable" | ✅ |
| 2.3 — Emit → session → fanout | "uses outbound fanout when the adapter exposes it" | ✅ |
| 2.5 — Nonexistent sessionId throws | "throws when emit references a nonexistent session" | ✅ |
| 2.5 — No routing target throws OutboundEventError | "throws OutboundEventError when emit lacks both surfaceId and sessionId" | ✅ |
| 2.4 — Touch updates lastActivityAt | "updates lastActivityAt when the session is touched during dispatch integration" | ✅ with gap (see §4) |
| WF-4 2.4 — Attach/detach affects fanout | "reflects surface attach and detach effects in runtime fanout targets" | ✅ |

**Finding:** All 9 behaviors are exercised. The WF-4 proof is substantially complete.

**One weak point — test 8 ("dispatch integration"):** The test title implies wiring through `runtime.dispatch()`, but the test calls `resolveSession()` directly with a mock resolver. `resolveSession` is shown to call `store.touch()`, which is correct. However, the path from `runtime.dispatch()` → capability handler → `resolveSession()` → `store.touch()` is NOT exercised end-to-end in this test. Plan spec item 2.4 states "every dispatch through the integration path calls `store.touch(sessionId)`" — but since session touching is a responsibility of capability handlers (not the runtime itself), the test validates the mechanism but not the wiring. This is a naming/scoping mismatch, not a correctness failure, but it's worth clarifying in follow-ups.

### WF-6 Coverage (`core-sessions-surfaces.test.ts`)

The plan specified 10 tests. The implementation consolidates some into 6 tests that collectively cover all 10 plan behaviors.

| Plan item | Covered by | Result |
|---|---|---|
| 3.1 — Registry as inbound+outbound adapter | Test 1 | ✅ |
| 3.2 — receiveRaw → normalize → dispatch → handler fires | Test 2 | ✅ |
| 3.3 — Handler emits → sessionId → fanout → all surfaces | Test 2 | ✅ |
| 3.4 — Attach expands fanout targets | Test 3 | ✅ |
| 3.4 — Detach shrinks fanout targets | Test 3 | ✅ |
| 3.6 — Inactive surface skipped (default policy) | Test 4 | ✅ |
| 3.5 — Full lifecycle start → receive → emit → stop | Test 2 (implicitly), Test 5 | ✅ |
| 3.5 — Stop drains in-flight handlers | Test 5 | ✅ |
| Normalization drop (missing userId) | Test 6 | ✅ |
| maxConcurrentHandlers enforced | Test 5 | ✅ |

**Finding:** All 10 WF-6 behaviors are exercised. The consolidation is pragmatic and the combined tests are readable. Test 5 correctly validates both drain-on-stop and concurrency limiting in one well-structured scenario.

**One compositional note — Test 2:** This test is complex and multi-purpose (inbound normalization + session resolution + emit + fanout in one test). If it fails, the failure site is harder to identify. The plan intended these as separate tests. This is acceptable for v1 but slightly reduces diagnostic clarity.

---

## 2. Are the Package Interactions Clean and Spec-Aligned?

### Core ↔ Sessions

**Duck-type contract (clean):** `core.ts` defines an internal `SessionSubsystem` type that accepts either `{ get(id) }` or `{ getSession(id) }`. `SessionStore.get(sessionId)` satisfies the `get` branch. `Session` is a structural superset of `SessionRecord`. No adapter or wrapper is needed. This was pre-verified with a compile-time contract check in the sessions test file.

**Registration pattern (clean):** `runtime.register('sessions', store)` / `runtime.get<SessionStore>('sessions')` is direct and type-safe via the generic.

**Emit path (correct):** `core.ts:resolveAttachedSurfaces()` (lines 165–179) correctly calls either `getSession` or `get` depending on what the registered subsystem exposes, then copies `attachedSurfaces` defensively.

### Core ↔ Surfaces

**Adapter contract (clean):** `surfaces.ts` defines local `CoreInboundAdapterShape` and `CoreOutboundAdapterShape` types that mirror core's `RelayInboundAdapter` and `RelayOutboundAdapter` without importing from core. `createSurfaceRegistry()` returns the intersection type. The surfaces test file has compile-time contract checks (`const _inboundContractCheck: CoreInboundAdapter = createSurfaceRegistry()`).

**Fanout return-type asymmetry (acceptable):** `surfaces.ts:fanout()` returns `Promise<FanoutResult>`, but `CoreOutboundAdapterShape.fanout?` specifies `Promise<void>`. This is reconciled via a `as` type assertion on line 196. This works correctly because `core.ts` ignores the fanout return value (just `await`s it). However, `Promise<FanoutResult>` is assignable to `Promise<void>` in TypeScript's structural system, so the `as` cast is defensively correct but introduces an implicit contract that should be confirmed at compile time rather than only at runtime. See follow-up item I-1.

**Fanout third parameter (acceptable):** `surfaces.ts:fanout()` accepts an optional third `policy?` parameter not present in `CoreOutboundAdapterShape`. TypeScript allows extra optional parameters in function types, so the structural assignment is valid. This is a non-issue.

### Sessions ↔ Surfaces

**Correct absence of coupling:** Surfaces does not import sessions. The fanout receives `string[]` of surfaceIds, with session-to-surfaceId resolution performed in `core.ts:resolveAttachedSurfaces()`. The dependency direction is correct: `core → sessions` (session resolution), `core → surfaces` (delivery). `surfaces → sessions` coupling is absent.

---

## 3. Were Changes Kept Narrow and Integration-Focused?

**Yes.** The plan explicitly stated "None expected" for changes to `core.ts`, `sessions.ts`, and `surfaces.ts`. The implementation delivered this constraint exactly:

- Two new test files were created: `core-sessions.test.ts` and `core-sessions-surfaces.test.ts`.
- No modifications to the three package implementation files were required to make the integration tests pass.
- The tests import from package source files directly without introducing new exports, types, or adapters.
- Tests use `InMemorySessionStoreAdapter` with no external dependencies.
- Surface adapters in WF-6 tests are simple mock objects tracking sent payloads.
- No new packages, no cloud assumptions, no product-specific logic were introduced.

This confirms the plan's key architectural claim: the three packages were designed with these integration contracts already in mind and required no retroactive changes to satisfy cross-package use.

---

## 4. Follow-ups Before Moving to the Next Package Layers

The following items are ordered by priority. Items marked **MUST** block progression to the next phase. Items marked **SHOULD** are recommended before the next phase. Advisory items can be deferred.

### I-1 — Clarify the `fanout()` return-type mismatch at compile time [SHOULD]

**Current state:** `surfaces.ts` returns `registry as SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape` using a type assertion. `fanout()` returns `Promise<FanoutResult>` while `CoreOutboundAdapterShape.fanout` declares `Promise<void>`.

**Risk:** The `as` cast suppresses compile-time enforcement of the return type. If `core.ts` is ever updated to read the fanout result, the mismatch would silently produce `undefined` instead of a `FanoutResult`.

**Action:** Either (a) update `CoreOutboundAdapterShape.fanout` to return `Promise<void | FanoutResult>`, or (b) add a compile-time narrowing check in the surfaces test alongside the existing contract checks, verifying the fanout return type is at minimum compatible with `Promise<void>`.

---

### I-2 — Rename or clarify test 8 in `core-sessions.test.ts` [SHOULD]

**Current state:** The test is named "updates lastActivityAt when the session is touched during dispatch integration" but does not call `runtime.dispatch()`. It tests `resolveSession()` directly.

**Risk:** Future contributors may expect a full dispatch loop in this test and be misled by the title.

**Action:** Either (a) rename the test to "resolveSession touches the session and updates lastActivityAt" to match what it actually does, or (b) extend it to push a message through `runtime.dispatch()` with a capability handler that calls `resolveSession`, then assert the updated timestamp. Option (b) would close the proof gap for spec item 2.4 more completely.

---

### I-3 — Add a dedicated end-to-end lifecycle test in `core-sessions-surfaces.test.ts` [SHOULD]

**Current state:** The full lifecycle path (start → receive → dispatch → emit → fanout → stop) is covered by test 2 implicitly and test 5 partially, but there is no single test that exercises all steps together while asserting clean shutdown.

**Action:** Add a focused test matching plan item 3.5 ("Full runtime lifecycle") with explicit assertions on `runtime.status().ready` before and after stop, and that no in-flight handlers remain. This improves diagnostic clarity without duplicating existing coverage.

---

### Carried-over items (not yet resolved)

The following follow-ups from prior package reviews remain open and are unaffected by the integration work:

| Item | Source | Priority | Description |
|---|---|---|---|
| C-4.1 | Core review | SHOULD | Add test for missing `name` validation |
| C-4.2 | Core review | SHOULD | Export `SessionSubsystem` from core types |
| C-4.3 | Core review | ADVISORY | Document stop-drain timeout behavior |
| S-F-2 | Sessions review | SHOULD | Add expire() from created/suspended state tests |
| S-F-3 | Sessions review | SHOULD | Expand find() query filter tests |
| S-F-4 | Sessions review | MINOR | Remove dead `?? defaultTtlMs` in sweepStale |
| S-F-5 | Sessions review | MINOR | Document MAX_SAFE_INTEGER bypass in sweepStale |
| S-F-6 | Sessions review | OPEN | Resolve OQ-2 (max surfaces) and OQ-3 (delete vs. retain) |
| Su-F-1 | Surfaces review | SHOULD | Resolve OQ-2: send() behavior for inactive surfaces |
| Su-F-2 | Surfaces review | SHOULD | Add concurrency test for fanout |
| Su-F-6 | Surfaces review | NICE | Document normalizationHook null/undefined drop behavior |

Items S-F-6 (OQ-2, OQ-3) and Su-F-1 (inactive surface in send()) are the most load-bearing of the carried items. OQ-2 in particular needs an owner and resolution before WF-7 assembly, since it affects session attachment limits which are exercised in the integration tests.

---

## Summary

| Dimension | Result |
|---|---|
| WF-4 behaviors proved (9/9 plan items) | ✅ All covered; one naming/scoping note on test 8 |
| WF-6 behaviors proved (10/10 plan items) | ✅ All covered; some tests are composite |
| Package interaction cleanliness | ✅ Clean; one return-type asymmetry worth confirming at compile time |
| Spec alignment of package contracts | ✅ Correct; duck-typing verified structurally |
| Scope discipline (no spurious package changes) | ✅ Strictly integration-test-only additions |
| Prior required follow-ups fulfilled | ✅ Sessions F-1 and Surfaces F-3/F-4 (WF-4, WF-6 integration tests) complete |
| New follow-ups introduced | 3 items (I-1 through I-3), all SHOULD or lower |

The v1 foundation integration is functionally complete and correct. The three packages wire together as the spec intended, with no glue code, no retroactive modifications, and no cross-package runtime imports. The integration tests cover all planned behaviors across both WF-4 and WF-6.

**VERDICT: PASS_WITH_FOLLOWUPS**

The foundation is ready for the next package layers (connectivity, memory, policy). The three new follow-up items (I-1 through I-3) should be resolved during that phase or as a targeted patch before WF-7 assembly begins.

---

V1_FOUNDATION_INTEGRATION_REVIEW_COMPLETE
