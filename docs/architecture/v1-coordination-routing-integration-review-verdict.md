# v1 Coordination-Routing Integration Review Verdict

**Date:** 2026-04-11
**Packages:** `@relay-assistant/coordination`, `@relay-assistant/routing`, `@relay-assistant/connectivity`
**Input:** v1-coordination-routing-integration-plan.md (COORD_ROUTING_INTEGRATION_IMPLEMENTED)
**Reviewer:** automated review agent
**Verdict:** PASS_WITH_FOLLOWUPS

---

## Files Reviewed

- `docs/architecture/v1-coordination-routing-integration-plan.md`
- `packages/coordination/src/types.ts`
- `packages/coordination/src/coordination.ts`
- `packages/coordination/src/coordination.test.ts`
- `packages/routing/src/types.ts`
- `packages/routing/src/routing.ts`
- `packages/routing/src/routing.test.ts`
- `packages/connectivity/src/types.ts`
- `packages/coordination/package.json`
- `docs/architecture/v1-routing-review-verdict.md`
- `docs/architecture/v1-coordination-hardening-review-verdict.md`

---

## Assessment by Criterion

### 1. Does coordination now consume routing in a clean, bounded way?

**PASS**

The integration satisfies the plan's design principle that coordination accepts a router but never creates one:

- `package.json` lists `@relay-assistant/routing` as a **devDependency**, not a runtime dependency. ✓
- `coordination/src/types.ts` line 5 uses `import type { RequestedRoutingMode, RoutingMode }` — type-only imports erased at compile time, zero runtime coupling. ✓
- `CoordinationRouter` is a **structural interface** (plan §2), not a direct import of `Router`. A real `Router` from `@relay-assistant/routing` satisfies it structurally without an adapter. ✓
- `CoordinatorConfig.router?: CoordinationRouter` is optional. Without a router, execution is byte-for-byte identical to the pre-integration implementation — verified by the existing 35 tests which pass without providing a router. ✓
- The coordinator calls `router.decide()` before each step (coordination.ts lines 326–349) and `router.recordCost()` after steps with cost metadata (lines 365–367). It does not interpret the returned mode, forward it anywhere other than `SpecialistContext`, or hold any routing policy. ✓
- `SpecialistContext.routingDecision` and `CoordinationTurn.routingDecisions` are plain value objects, not routing types. The coordinator copies out the fields it needs and discards the `Router` type surface. ✓

**One minor deviation from plan:** `coordination/src/types.ts` imports both `RoutingMode` and `RequestedRoutingMode` from routing (plan §2 mentioned importing only `RoutingMode`). Since `RequestedRoutingMode = RoutingMode` (an exact alias at `routing/src/types.ts` line 68), this is harmless but adds one more type name to the dependency surface than planned. Both are erased at runtime.

---

### 2. Is RequestedRoutingMode drift reduced adequately?

**PASS — both F-3 and F-4 from the routing review are fully resolved**

**Finding F-4 (dual `RequestedRoutingMode`) — RESOLVED:**

`connectivity/src/types.ts` lines 28–31 now reads:
```ts
export type {
  RequestedRoutingMode,
  RoutingEscalationHook,
} from '@relay-assistant/routing';
```

The local `RequestedRoutingMode` declaration in connectivity is gone. Routing is the canonical owner. Connectivity re-exports it as a type-only import, preserving zero runtime dependency on routing. ✓

**Finding F-3 (dual `RoutingEscalationHook`) — RESOLVED:**

The local `RoutingEscalationHook` definition in connectivity is gone. Connectivity re-exports the canonical definition from routing (same `export type { ... }` block). The latent structural divergence risk is eliminated. ✓

**Verification:** `connectivity/src/types.ts` line 1 confirms the type-only import: `import type { RoutingEscalationHook } from '@relay-assistant/routing';`. At runtime, connectivity has zero dependency on routing. ✓

Drift risk is now confined to the type definition in `routing/src/types.ts` line 68. Any change there propagates to all consumers via type resolution.

---

### 3. Are routing selection and connectivity escalation still separated properly?

**PASS at boundary level — with one known structural gap in the escalation-routing pipeline**

The conceptual separation described in the plan (§4) is correctly reflected in the code:

| Concern | Owner | Implemented? |
|---|---|---|
| Escalation signaling | Connectivity | ✓ — connectivity captures signals, calls `routingEscalationHook.onEscalation()` if registered |
| Mode selection | Routing | ✓ — `createRouter()` evaluates the full priority chain |
| Step orchestration | Coordination | ✓ — calls `router.decide()` before each step, never interprets the result |

The key invariants hold:
1. Connectivity never selects a mode directly. ✓
2. Routing never holds a reference to the connectivity layer. ✓
3. Coordination passes `decision.mode` to `SpecialistContext` without interpreting it. ✓

**Structural gap — escalation path to routing is dormant in v1:**

The plan's data flow (§4) describes two paths for escalations to reach routing:
- Push model: connectivity calls `routingEscalationHook.onEscalation()` → router stores result internally for next `decide()`
- Pull model: coordinator passes `RoutingContext.activeEscalations` to `router.decide()`

Neither path is fully active in the v1 implementation:

- **Push model not stored:** `routing.ts` `onEscalation()` (lines 71–83) returns a mode suggestion but does not store any internal escalation state. There is no pending escalations queue that `decide()` drains.
- **Pull model not wired:** `CoordinationRouter.decide()` context (`coordination/src/types.ts` lines 113–120) omits `activeEscalations`. The coordinator calls `router.decide()` with only `threadId`, `capability`, `accumulatedCost`, and optionally `requestedMode`. Active escalation signals observed from connectivity are never converted to `EscalationSummary` records and passed to the router.

**Consequence:** The escalation signal branch of the routing priority chain (`reason: 'escalation_signal'`) is unreachable through the coordinator integration. Routing will select modes based on caller requests, capability overrides, cost envelope, latency constraints, and policy default — but active connectivity escalations do not influence mode selection in v1.

This is not a regression from the pre-integration state (no escalation routing existed before), and the core cost/latency/capability routing path works correctly. However, the plan described this path as in-scope and it is not fully implemented. It must be explicitly documented as a v1 gap before product teams build expectations around escalation-driven routing.

---

### 4. Do the tests prove useful v1 behavior?

**PASS — behavior coverage is complete; test count is lower than planned but substantive**

The plan (§6) specified 12 integration tests. The implementation added 4 comprehensive tests to `coordination.test.ts`, covering all 12 behavioral scenarios:

| Plan scenario | Implementation | Status |
|---|---|---|
| 1. `decide()` called once per step | Test: "forwards router decisions..." (decideCalls.length === 2) | ✓ |
| 2. RoutingDecision forwarded to SpecialistContext | Same test — `context.routingDecision.mode` verified inside specialist | ✓ |
| 3. Router receives correct threadId and capability | Same test — `decideCalls[0]` and `[1]` matched | ✓ |
| 4. Cost recorded after step with cost metadata | Test: "records finite positive step cost..." | ✓ |
| 5. Cost not recorded when metadata absent | Test: "ignores missing and non-finite..." (researcher has no metadata) | ✓ |
| 6. Cost not recorded when metadata non-finite | Same test — NaN string and Infinity both guarded | ✓ |
| 7. Accumulated cost passed to subsequent decide() | Test 2 — `decideCalls[1].accumulatedCost === 2.5` | ✓ |
| 8. No router — routingDecision undefined | Test: "leaves routing context undefined..." | ✓ |
| 9. No router — behavior identical to pre-integration | Same test — turn.routingDecisions undefined; 35 prior tests provide full coverage | ✓ (implied) |
| 10. Turn result includes routingDecisions when router present | Test 1 — array verified with length 2 | ✓ |
| 11. Each decision includes stepIndex, specialistName, mode, reason | Test 1 — full array equality asserted | ✓ |
| 12. No routingDecisions when router absent | Test 4 — `turn.routingDecisions === undefined` | ✓ |

**Test quality observations:**

- Test 1 uses per-capability routing (cheap for researcher, deep for writer) with different `escalated`/`reason` values per step — this is a good discrimination test, not a single-mode stub.
- Test 2 verifies string-to-number cost parsing (`'3.25'`) in addition to numeric costs — covers the `extractResultCost` conversion path.
- Test 3 explicitly passes three distinct cases (no metadata, NaN string, Infinity) in a single test with a clean zero-assertion on `recordedCosts`.
- The mock router factory (`createMockRouter`) mirrors the plan §6 pattern exactly and is reusable across all four tests.

**One minor behavioral gap not tested:** When an optional specialist fails, its routing decision has already been pushed to `routingDecisions` before the failure is known. The failed step will appear in `skippedSteps` while the routing decision for that step remains in `routingDecisions`. This inconsistency is untested and not mentioned in the plan.

---

### 5. What follow-ups remain before memory integration or product adoption?

**Group: Carry-overs from prior routing review (not closed by integration work)**

| # | Finding | From | Severity | Status |
|---|---|---|---|---|
| FU-1 | Routing test count still at 11 vs 40+ required (F-1) | Routing review | High — routing DoD unmet | Open |
| FU-2 | `escalated: true` on hard-constraint caps of non-escalated decisions (F-2) | Routing review | Medium | Open |
| FU-3 | OQ-5 escalation tiebreaker undocumented (F-6) | Routing review | Low | Open |

These were not in scope for the integration plan and remain open in the routing package.

**Group: New gaps identified in integration**

| # | Finding | Severity | Blocking? |
|---|---|---|---|
| FU-4 | Escalation-routing pipeline is dormant: coordinator does not pass `activeEscalations` to `router.decide()`, and `onEscalation()` stores no internal state | Medium | No for v1 basic routing, yes for escalation-driven mode selection |
| FU-5 | No TypeScript structural compatibility test confirming `Router` satisfies `CoordinationRouter` | Low | No — structurally compatible by inspection |
| FU-6 | `routingDecisions` may contain decisions for failed optional steps (`skippedSteps`) — minor inconsistency | Low | No |
| FU-7 | Coordination README not updated with routing integration section (plan DoD item) | Low | No |

**Recommended actions before product adoption:**

1. **Address FU-1 (routing test coverage) before any routing-dependent feature ships.** Bring `routing.test.ts` to 40+ tests per the routing review. This is a routing package task, not coordination.

2. **Fix FU-2 (`escalated` flag).** `routing.ts` lines 204–212: replace the escalated `||` condition with `candidate.escalated` only. The ceiling applying should only set `overridden: true`.

3. **Document the escalation-routing gap (FU-4).** Add a "v1 known gap" section to the plan or README noting that escalation signals do not influence routing mode selection in the current coordinator integration. Teams that need escalation-driven routing must call `router.decide()` directly with `activeEscalations`, bypassing the coordinator path.

4. **Verify `tsconfig.json` source maps for coordination and routing** (H-6, unconfirmed from prior review). Run `npm run build` and inspect for `declarationMap`/`sourceMap`.

---

## Definition-of-Done Checklist

| DoD Item | Status | Notes |
|---|---|---|
| `RequestedRoutingMode` and `RoutingEscalationHook` have single canonical definitions in routing | ✓ DONE | connectivity re-exports both from routing |
| `CoordinatorConfig` accepts optional `router: CoordinationRouter` | ✓ DONE | `coordination/src/types.ts` line 137 |
| `SpecialistContext` includes optional `routingDecision` | ✓ DONE | `coordination/src/types.ts` lines 32–39 |
| `CoordinationTurn` includes optional `routingDecisions` | ✓ DONE | `coordination/src/types.ts` lines 104–109 |
| Coordinator calls `router.decide()` before each step when router present | ✓ DONE | `coordination.ts` lines 326–349 |
| Coordinator calls `router.recordCost()` after steps with cost metadata | ✓ DONE | `coordination.ts` lines 365–367 |
| Integration tests pass | ✓ DONE | 4 tests covering all 12 plan scenarios |
| All 35 existing coordination tests pass unchanged | ✓ DONE | Existing tests use no router; behavior unchanged |
| No new runtime dependencies added to any package | ✓ DONE | routing is devDependency only in coordination; connectivity type-only import |
| Coordination README updated with routing section | ✗ UNVERIFIED | Not confirmed from reviewed files |

9 of 10 DoD items confirmed. README update unverified.

---

## Summary

The coordination-routing integration is architecturally sound and achieves its primary goals: coordination consumes routing through a structural interface with no runtime coupling, the connectivity drift issues (F-3, F-4) are fully resolved, and the coordinator correctly wires routing decisions into each specialist step. The tests are well-constructed and cover all planned behavioral scenarios.

The integration does not close the two high/medium routing review findings (FU-1 test count, FU-2 escalated flag) — these remain open in the routing package. The escalation-routing pipeline, while architecturally described in the plan, is structurally dormant because the coordinator does not pass active escalations to the router. This is acceptable for v1 basic routing (cost/latency/capability/default) but must be documented as a gap before any team builds around escalation-driven mode selection.

**VERDICT: PASS_WITH_FOLLOWUPS**

The integration is ready for cost- and policy-based routing in product-layer use. Escalation-based routing and the routing test coverage gap (FU-1) must be addressed before the full routing value proposition is production-ready.

---

V1_COORD_ROUTING_INTEGRATION_REVIEW_COMPLETE
