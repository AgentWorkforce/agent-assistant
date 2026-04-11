---AUDIT REVIEW---
# SDK Audit and Traits Alignment Review Verdict

Verdict: `PASS_WITH_FOLLOWUPS`

## Findings

### Moderate

1. `docs/index.md` still lags the updated workflow status language.
   Evidence:
   - [docs/index.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/index.md:46) says `WF-6/WF-7 uncertain`
   - [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:18) marks `WF-6` complete
   - [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:19) marks `WF-7` open
   - [docs/workflows/weekend-delivery-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/weekend-delivery-plan.md:20) and [docs/workflows/weekend-delivery-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/weekend-delivery-plan.md:22) say the same

This is not a substantive architecture problem, but it is still doc drift in the top-level index and should be corrected so future readers do not get conflicting rollout status.

## Assessment

1. Implemented vs specified packages:
   Yes. The distinction is now clear in the main entrypoints, especially [README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/README.md:18) and [docs/index.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/index.md:7). The README now explicitly separates `IMPLEMENTED`, `placeholder`, and `planned` packages and matches the repo layout: six package directories with code, four placeholder-only package READMEs, and no `traits` package yet.

2. Workforce persona vs assistant traits/persona:
   Yes. The distinction is explained clearly and repeatedly in a stable way across [docs/architecture/traits-and-persona-layer.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/traits-and-persona-layer.md:12), [docs/architecture/package-boundary-map.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/package-boundary-map.md:28), [README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/README.md:95), and [docs/research/internal-system-comparison.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/research/internal-system-comparison.md:37). The key boundary is crisp: personas are runtime execution profiles owned by Workforce; traits are identity/behavior data that products compose into those personas.

3. Plausible architectural home for the traits layer:
   Yes. The proposed `@relay-assistant/traits` package is a credible home. Its scope is constrained, its non-goals are explicit, and the dependency direction is sensible: a leaf data package consumed optionally by `core`, `surfaces`, `coordination`, and later `proactive` ([docs/architecture/traits-and-persona-layer.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/traits-and-persona-layer.md:117), [docs/architecture/package-boundary-map.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/package-boundary-map.md:150)). The proposed future `traits?: TraitsProvider` addition also matches the current code, which correctly does not yet include that field in [packages/core/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/core/src/types.ts:77).

4. Reuse-first guidance for future workflows:
   Yes. The guidance is clear enough to drive future package work. It appears in the high-level repo docs, the boundary map, and workspace guidance, and it gives a concrete memory example instead of only abstract policy ([README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/README.md:155), [docs/architecture/package-boundary-map.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/package-boundary-map.md:16), [/Users/khaliqgant/.openclaw/workspace/AGENTS.md](/Users/khaliqgant/.openclaw/workspace/AGENTS.md:201)).

5. Practicality and alignment with current codebase state:
   Mostly yes. The updates are grounded in the actual repo state rather than wishful structure:
   - no root workspace config exists, which the docs now call out accurately
   - `packages/examples/src/` does not exist, which the workflow docs correctly treat as the remaining WF-7 blocker
   - `AssistantDefinition` does not yet have a `traits` field, and the docs now correctly say that is intentional
   - the coordination/routing escalation handoff gap is documented and matches the current implementation, where `router.decide()` is called without `activeEscalations` in [packages/coordination/src/coordination.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/src/coordination.ts:328)

The only reason this is not a clean `PASS` is the remaining top-level index drift on workflow status.

## Follow-Ups

1. Update [docs/index.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/index.md:46) to say `WF-6 COMPLETE; WF-7 OPEN` instead of `WF-6/WF-7 uncertain`.
2. Keep the top-level status pages synchronized when workflow states change, since the current review shows the architecture docs are now largely aligned and the main remaining risk is status drift rather than conceptual confusion.

## Summary

The SDK audit/alignment updates are substantively successful. They now distinguish implemented vs specified packages clearly, explain workforce personas versus assistant traits cleanly, place the traits layer in a plausible package boundary, and give usable reuse-first guidance that matches the repo's current architecture and gaps. One index-level status inconsistency remains, so the appropriate verdict is `PASS_WITH_FOLLOWUPS`.

SDK_AUDIT_ALIGNMENT_REVIEW_COMPLETE

---ROUTING REVIEW---
# v1 Routing Package Review Verdict

**Date:** 2026-04-11
**Package:** `@relay-assistant/routing`
**Reviewer:** automated review agent
**Verdict:** PASS_WITH_FOLLOWUPS

---

## Files Reviewed

- `docs/specs/v1-routing-spec.md`
- `docs/architecture/v1-routing-implementation-plan.md`
- `packages/connectivity/src/types.ts`
- `packages/coordination/src/types.ts`
- `packages/routing/package.json`
- `packages/routing/tsconfig.json`
- `packages/routing/src/index.ts`
- `packages/routing/src/types.ts`
- `packages/routing/src/routing.ts`
- `packages/routing/src/routing.test.ts`
- `packages/routing/README.md`

---

## Assessment by Criterion

### 1. Is the routing package properly bounded for v1?

**PASS**

The package is correctly bounded:

- `package.json` has zero runtime dependencies. Only `typescript` and `vitest` appear as devDependencies.
- No import of `@relay-assistant/connectivity`, `@relay-assistant/coordination`, `@relay-assistant/sessions`, `@relay-assistant/surfaces`, or `@relay-assistant/memory`.
- The `RouterConfig.defaultModelSpecs` field is present in implementation `types.ts` (matching spec §6) even though the implementation plan §3.8 omitted it — this is the correct resolution, favoring the spec.
- `index.ts` exports exactly the factory, all types, constants, and error classes. Nothing internal leaks.
- README correctly lists non-goals: no provider SDK, no concrete model IDs, no transport, no cloud assumptions, no semantic inspection.

Minor deviation: `tsconfig.json` does not include `declarationMap: true` or `sourceMap: true` (both in the plan's §7.2 template), and does not exclude test files from compilation (the plan included `"exclude": ["src/**/*.test.ts"]`). Neither deviation breaks behavior given `skipLibCheck: true`, but they drift from the plan's specified config.

---

### 2. Does it model cheap/fast/deep and latency/depth/cost clearly enough?

**PASS**

The three-tier model is well-expressed:

- `RoutingMode = 'cheap' | 'fast' | 'deep'` is clean and expressive.
- `MODE_DEPTH` (`cheap: 0, fast: 1, deep: 2`) provides a stable ordinal for ceiling enforcement and escalation comparison.
- `DEFAULT_MODE_SPECS` matches the spec §6 table (not the plan §3.9 which shows zero values for `minContextTokens` and `maxLatencyMs` on `fast` and `deep`):
  - `cheap`: small / no tools / no streaming / 0 context / 0 latency
  - `fast`: medium / tools / streaming / 16 000 ctx / 5 000ms latency
  - `deep`: large / tools / streaming / 64 000 ctx / 0 (no limit)

  The implementation correctly follows the spec over the plan where they diverge. This is the right call.

- The latency constraint logic in `pickLatencyMode` is correct: it checks whether `deep` and then `fast` can meet `requestedMaxLatencyMs`, falling back to `cheap` only if neither can. `canMeetLatency` correctly treats `specLatency == 0` as "no declared limit" and skips the constraint, which is the intended semantics for `deep`.

- Cost is abstract (a number) per spec §11 OQ-3. The pending resolution of OQ-3 (abstract vs denominated) is correctly deferred to product integration.

---

### 3. Are workforce-aligned concepts reflected without overreaching package scope?

**PASS**

- The cheap/fast/deep naming directly maps to Workforce's low-cost, standard interactive, and high-quality routing tiers (per spec §9).
- The `hints` field on `ModelSpec` allows products to annotate decisions with workforce lane metadata (e.g., `workforceLane: 'cheap'`) without baking Workforce specifics into the OSS package.
- The `costEnvelopeLimit` pattern mirrors Workforce per-session budget tracking. The implementation correctly auto-downgrades to `cheap` when exceeded.
- Quality-preserving constraints (spec §9, deferred to v1.2) are correctly absent. The spec documents this as an explicit v1 gap.
- The package makes no product-specific routing decisions; all policy is configurable via `RoutingPolicy`. The implementation applies policy generically without encoding any product's routing rules.

No scope overreach was found.

---

### 4. Are connectivity/coordination boundaries still clean?

**MOSTLY CLEAN — with two boundary observations**

#### Connectivity boundary

The circular-dependency break is implemented correctly:

- Routing defines its own `ConnectivityEscalationSignal` (a minimal mirror of `ConnectivitySignal`).
- Routing defines its own `RoutingEscalationHook` interface.
- Routing has **no runtime import** of `@relay-assistant/connectivity`.

However, two type definitions are now duplicated across packages:

**Finding C-1: Dual `RoutingEscalationHook` definitions**

`connectivity/src/types.ts` (line 77–79):
```ts
export interface RoutingEscalationHook {
  onEscalation(signal: ConnectivitySignal): RequestedRoutingMode | void;
}
```

`routing/src/types.ts` (line 70–72):
```ts
export interface RoutingEscalationHook {
  onEscalation(signal: ConnectivityEscalationSignal): RequestedRoutingMode | void;
}
```

These are structurally compatible today because `ConnectivitySignal` has all fields of `ConnectivityEscalationSignal`. However, they are independently maintained. If `ConnectivityEscalationSignal` diverges from `ConnectivitySignal` (e.g., a new required field is added to the mirror), the interfaces silently diverge. This is a latent coupling risk that should be resolved before connectivity and routing are wired in product code.

**Finding C-2: Dual `RequestedRoutingMode` definitions**

`connectivity/src/types.ts` (line 26) and `routing/src/types.ts` (line 68) both define `RequestedRoutingMode = 'cheap' | 'fast' | 'deep'` independently. The spec (§8) says connectivity should import this type from routing, not redeclare it. Currently, both packages own a copy. This is a source of drift if the mode set ever changes.

#### Coordination boundary

`coordination/src/types.ts` imports only from `@relay-assistant/connectivity` (for `ConnectivityLayer` and `ConnectivitySignal`). No routing types appear in coordination's type surface yet. The spec (§7, §12 Step 6) envisions coordination calling `router.decide()` before delegating, but this wiring is absent from coordination's types. This is expected for the current implementation state (routing is new) but must be addressed before memory or product integration, since a coordinator that doesn't route before delegating provides no mode-selection value.

---

### 5. Decision algorithm correctness

**PASS**

`resolveDecisionCandidate` applies the priority chain correctly:

| Priority | Rule | Implementation |
|---|---|---|
| 1 | `requestedMode` (caller) | Lines 154–159 — checked first ✓ |
| 2 | `capabilityModes` override | Lines 161–165 ✓ |
| 3 | Cost envelope exceeded | Lines 166–172 ✓ |
| 4 | Escalation signals | Lines 173–182 (`pickEscalationMode`) ✓ |
| 5 | Latency constraint | Lines 183–192 (`pickLatencyMode`) ✓ |
| 6 | Policy default | Lines 193–198 ✓ |
| Post | `modeCeiling` cap | Lines 204–212 ✓ |

OQ-2 (does ceiling apply to caller-requested modes?): Yes, the post-cap applies to all selected candidates including caller-requested. This matches the spec's "current answer: yes, ceiling always applies."

OQ-5 (multiple escalation signals: highest-priority wins or deepest?): The implementation uses priority first, then mode depth as tiebreaker (`isHigherPriority || samePriorityButDeeper`). This deviates slightly from the spec §5 which says "highest-priority signal wins." The implementation's tiebreaker (prefer deeper mode within the same priority level) is more permissive and produces more predictable results for callers. This should be documented as an intentional deviation.

**Minor logic issue — `escalated` flag on hard-constrained non-escalated decisions:**

In `resolveDecisionCandidate` lines 205–211:
```ts
return {
  mode: policy.modeCeiling,
  reason: 'hard_constraint',
  escalated: candidate.escalated || MODE_DEPTH[candidate.mode] > MODE_DEPTH[policy.modeCeiling],
};
```

The second operand of `||` is always `true` inside this branch (that's the condition that triggered the branch). This means any hard-constraint cap sets `escalated: true`, even when the original candidate was a non-escalated caller request. A caller requesting `'deep'` on a `modeCeiling: 'fast'` router will receive `escalated: true` in addition to `overridden: true`. This is misleading: `escalated` should reflect whether a connectivity escalation signal was responsible, not whether a ceiling was applied. This is a correctness issue.

---

### 6. Test coverage

**FAIL — test count significantly below minimum**

The plan (§9) requires a **minimum of 40 tests** in 12 groups. The current test file has **11 tests** in 3 groups:

- `routing decisions`: 7 tests
- `cost tracking`: 1 test
- `connectivity boundary`: 3 tests

**Missing coverage (by plan group):**

| Group | Required | Found | Gap |
|---|---|---|---|
| Default behavior (4 tests) | 4 | 1 (combined) | 3 |
| Policy default mode (2) | 2 | 0 | 2 |
| Caller override (3) | 3 | 2 | 1 |
| Capability override (3) | 3 | 2 | 1 |
| Cost envelope (4) | 4 | 1 | 3 |
| Escalation signals (4) | 4 | 1 | 3 |
| Latency constraint (3) | 3 | 1 | 2 |
| Mode ceiling (3) | 3 | 1 | 2 |
| ModelSpec construction (4) | 4 | 1 | 3 |
| Cost tracking (4) | 4 | 1 | 3 |
| Escalation hook (4) | 4 | 3 | 1 |
| Priority chain (2) | 2 | 1 (combined) | 1 |

Notably absent:
- Cost envelope at exactly the limit (test 15: `cost === limit` does NOT trigger downgrade)
- Cost envelope with `limit: 0` means no limit (test 16)
- `getAccumulatedCost` returns 0 for unknown thread (test 31)
- Per-thread cost isolation (test 34)
- Latency constraint does not apply when no `requestedMaxLatencyMs` (test 23)
- `modeCeiling: 'deep'` does not cap anything (test 26)

The test file is well-written for the cases it covers (clear descriptions, good signal fixtures, priority chain test covers OQ-5 behavior). But the breadth is insufficient for the spec's "definition of done."

---

## Summary of Findings

| # | Finding | Severity | Blocking? |
|---|---|---|---|
| F-1 | Test count 11 vs 40+ required | High | Yes — DoD unmet |
| F-2 | `escalated: true` set on hard-constraint caps of non-escalated decisions | Medium | No — but misleads callers |
| F-3 | Dual `RoutingEscalationHook` definitions across packages | Medium | No — structurally compatible now, latent drift risk |
| F-4 | Dual `RequestedRoutingMode` definitions (both packages) | Low | No — identical today |
| F-5 | Coordination types have no routing integration yet | Medium | No — expected at this stage, required before product integration |
| F-6 | OQ-5 escalation tiebreaker deviates from spec (undocumented) | Low | No — implementation is defensible but should be recorded |
| F-7 | `tsconfig.json` deviates: no `declarationMap`, no `sourceMap`, test files not excluded | Low | No — build tooling only |

---

## Follow-Ups Required Before Memory or Product Integration

### Before any integration work begins

1. **Bring test count to 40+ (F-1 — blocking DoD).** Add the missing granular tests per plan §9. Specifically add boundary cases for cost envelope, per-thread isolation, latency-not-applied when unspecified, and mode ceiling passthrough.

2. **Fix `escalated` flag on hard-constraint caps (F-2).** `escalated` should be `candidate.escalated` only — not ORed with the ceiling comparison. The ceiling triggering should only set `overridden: true` (which it already does correctly). Update the test for "caps caller mode" to assert `escalated === false`.

### Before connectivity wiring

3. **Resolve dual `RequestedRoutingMode` (F-4).** Either connectivity imports from routing, or the types are aligned via a shared constant. The spec says connectivity should import from routing; the current independent declaration is a deviation worth correcting before the hook is wired in product code.

4. **Resolve dual `RoutingEscalationHook` (F-3).** Document which package owns the canonical definition. If routing owns it (per spec §7), connectivity should import it or at minimum have a structural compatibility test that catches divergence.

### Before coordination integration

5. **Add routing to coordination's type surface (F-5).** `CoordinatorConfig` should accept a `router: Router` (or optional routing hook). Until coordination accepts a router, coordinators cannot perform mode-selection before delegation, which is the primary v1 value proposition of this package.

### Documentation

6. **Document the OQ-5 tiebreaker decision (F-6).** Record in spec or plan that when multiple escalation signals share the same priority, the deepest mapped mode wins. This is a deliberate deviation from "highest-priority signal wins" that should be explicit.

---

## What Is Ready

The following v1 routing deliverables are complete and correct:

- All type definitions matching spec §4
- Seven-step decision algorithm in correct priority order
- `modeCeiling` post-filter applied correctly to all candidates including caller-requested
- `onEscalation()` applies ceiling, ignores non-escalation signal classes
- Per-thread cost accumulation, read, and reset
- `DEFAULT_MODE_SPECS` matching spec §6 table
- Zero runtime dependencies — connectivity boundary fully decoupled
- `RouterConfig.defaultModelSpecs` correctly included (closer to spec than plan)
- README accurately describes the package, non-goals, decision order, and connectivity boundary
- Package infrastructure (package.json, exports, module type) correctly configured

---

**VERDICT: PASS_WITH_FOLLOWUPS**

The routing package is architecturally sound and correctly bounded. The connectivity boundary is clean. The decision algorithm is correct. The primary blocking item before product integration is test coverage (F-1). The `escalated` flag issue (F-2) and coordination wiring gap (F-5) must be addressed before the router is consumed by coordination or product-layer capability handlers.

V1_ROUTING_REVIEW_COMPLETE

---COORD HARDENING REVIEW---
# v1 Coordination Hardening Review Verdict

**Date:** 2026-04-11
**Package:** `@relay-assistant/coordination`
**Input:** v1-coordination-hardening-plan.md (COORDINATION_HARDENING_IMPLEMENTED)
**Verdict:** PASS_WITH_FOLLOWUPS

---

## Summary

All three required hardening items (H-1, H-2, H-3) are fully addressed. The selected-audience resolver is now wired and tested, the 35-test minimum is met exactly, and the validating-factory semantics are documented in both source and README. The two non-blocking name decisions (H-4, H-5) are implemented consistently and verified by tests. One non-blocking item (H-6: tsconfig source maps) could not be confirmed from the reviewed files and is flagged as a minor follow-up. The package is ready for memory/routing/product integration.

---

## Assessment

### 1. Were the highest-value review follow-ups actually addressed?

**YES — all three required items are closed.**

| Item | Required? | Status | Evidence |
|---|---|---|---|
| H-1: Wire `registerSelectedResolver` | Required | **DONE** | `coordination.ts` lines 298–303, inside `execute()` before `onSignal` |
| H-2: 35-test minimum | Required | **DONE** | 35 tests counted in `coordination.test.ts` |
| H-3: Document `createDelegationPlan` semantics | Required | **DONE** | JSDoc at `coordination.ts` lines 202–209; README lines 65–68 |
| H-4: Keep `validateDelegationPlan` name | Non-blocking | **DONE** | `index.ts` line 6 exports `validateDelegationPlan` consistently; decision documented in hardening plan |
| H-5: Keep `coord_` prefix | Non-blocking | **DONE** | `coordination.ts` line 286; verified by test at line 849 |
| H-6: `declarationMap`/`sourceMap` in tsconfig | Non-blocking | **UNCONFIRMED** | Not mentioned in hardening plan implementation notes; unverified from reviewed files |

---

### 2. Is selected-audience resolution now properly wired?

**YES — correctly implemented and verified.**

`coordination.ts` lines 298–303 register the resolver inside `execute()`, after `normalizedPlan` is built and before `config.connectivity.onSignal(callback)`:

```ts
config.connectivity.registerSelectedResolver((signal) => {
  return normalizedPlan.steps
    .map((step) => step.specialistName)
    .filter((name) => name !== signal.source);
});
```

This satisfies the hardening plan's specification exactly: the resolver is scoped to the current plan's participants, excludes the emitting source, and does not take routing ownership.

Test #35 (`coordination.test.ts` line 866) directly verifies the behavior: it captures the resolver via a patched `registerSelectedResolver`, then asserts that calling the resolver on a `handoff.ready` signal from `researcher` returns `['writer', 'reviewer']` — the two other plan participants. This is a high-quality behavioral assertion, not just a call-count check.

**One minor observation on re-registration:** The resolver is re-registered on every `execute()` call. If the connectivity layer accumulates rather than replaces resolvers, concurrent coordinator instances sharing the same connectivity layer could interfere. For v1 sequential execution this is not a concern, but should be documented before parallel delegation is introduced.

---

### 3. Is test coverage meaningfully stronger where it matters?

**YES — 35 tests across all four logical groups, up from 5.**

**Test inventory (35 total):**

**Specialist registry (7 tests):**
1. Duplicate registration rejection + plan validation with unknown specialist
2. `list()` defensive copy — mutating returned array does not affect registry
3. `has()` returns `false` before and `true` after registration
4. `register()` throws `CoordinationError` for empty string name
5. `register()` throws `CoordinationError` for whitespace-only name
6. `unregister()` is a no-op for an unregistered name
7. `get()` returns `null` for an unregistered name

**Delegation plan validation (7 tests):**
8. Returns `valid: false` when `intent` is empty
9. Returns `valid: false` when `steps` is empty
10. Returns `valid: false` when a step `instruction` is empty
11. Returns `valid: false` when a step `specialistName` is empty
12. Accumulates multiple errors in a single pass (empty intent + unknown specialist + empty instruction)
13. Returns `valid: false` when `steps.length` exceeds `maxSteps`
14. `createDelegationPlan()` returns a copy — mutating the returned plan does not affect the original input

**Synthesis strategies (8 tests):**
15. `concatenate` joins two `complete` results with double newline, `quality: 'complete'`
16. `concatenate` excludes `failed` results from text and `contributingSpecialists`
17. `concatenate` returns `quality: 'degraded'` with empty text when all results failed
18. `concatenate` returns `quality: 'degraded'` when a result is `partial`
19. `last-wins` returns only the last non-failed result's output
20. `last-wins` returns `quality: 'degraded'` with empty text when all results failed
21. `custom` delegates to `customFn` and returns its output unchanged
22. `custom` throws `SynthesisError` when `customFn` is not provided

**Coordinator lifecycle and signal handling (13 tests):**
23. Sequential delegation with handoff signals — resolves handoffs post-synthesis
24. Optional step failure produces degraded output without aborting
25. `confidence.blocker` halts the turn with `CoordinationBlockedError`
26. Conflict tracking without routing or transport ownership
27. Throws `CoordinationError` when `maxSteps` is zero
28. Throws `CoordinationError` when `maxSteps` is negative
29. Throws `CoordinationError` when `maxSteps` is not an integer
30. `advanceStep()` called exactly once per successfully executed step
31. `offSignal()` called with the registered callback even when execution throws
32. Required step failure aborts — subsequent steps are not executed
33. Plan exceeding `maxSteps` throws `DelegationPlanError` during execution
34. `turnId` starts with the `coord_` prefix
35. `registerSelectedResolver` scoped to plan participants, source excluded

**Quality observation:** The lifecycle tests are particularly well-constructed. Test #31 patches both `onSignal` and `offSignal`, captures the registered callback, and asserts the same reference is passed to `offSignal` after a throw — this is a proper finally-block verification, not a stub call count. Test #30 patches `advanceStep` and verifies it receives the correct `threadId` twice, once per step. Test #35 directly invokes the captured resolver with a real signal and asserts the return value.

---

### 4. Are the key spec/API mismatches now resolved or intentionally documented?

**YES — all three are resolved.**

**`validateDelegationPlan` vs `validatePlan`:** The longer name is kept. `index.ts` exports `validateDelegationPlan` at line 6. No usage of `validatePlan` as a public export exists. Decision documented in the hardening plan as H-4 (non-blocking, no code change required).

**`coord_` prefix vs `turn_`:** The `coord_` prefix is kept. `coordination.ts` line 286 uses `coord_${nanoid()}`. Test #34 verifies the prefix. Decision documented in the hardening plan as H-5 (non-blocking, no code change required).

**`createDelegationPlan` validating-factory semantics:** The function validates on construction and throws `DelegationPlanError` on failure. JSDoc at `coordination.ts` lines 202–209 documents this explicitly and provides guidance for the pre-population use case (use the `DelegationPlan` interface directly). README lines 65–68 repeat this guidance. Test #14 verifies the factory returns a copy, not the original object.

---

### 5. What follow-ups remain?

**Non-blocking (minor):**

1. **H-6 unconfirmed — `declarationMap`/`sourceMap` in `tsconfig.json`:** The hardening plan implementation notes do not mention this item, and it was not confirmed from the reviewed files. It should be verified with `npm run build` before publishing. Low urgency.

2. **README test list is stale:** `README.md` lines 153–157 still enumerate only five test scenarios (the original integration test set). The suite now has 35 tests across four groups. The list should be expanded or replaced with a summary count before product adoption to avoid misleading downstream contributors.

3. **`registerSelectedResolver` re-registration pattern:** As noted above, the resolver is re-registered on every `execute()` call. For v1 sequential execution this is safe. Before parallel delegation is introduced, document whether the connectivity layer replaces or accumulates registered resolvers, and add a deregistration path if accumulation occurs.

4. **WF-C/WF-CS integration tests still deferred:** Per hardening plan Section 5, these are explicitly out of scope for this pass. They remain the next milestone before NightCTO or MSD adopt the package.

---

## File-Level Notes

| File | Verdict | Notes |
|---|---|---|
| `src/types.ts` | PASS | Unchanged from prior review; all error classes and types are clean |
| `src/coordination.ts` | PASS | `registerSelectedResolver` correctly wired before `onSignal`; JSDoc added to `createDelegationPlan`; all prior correct behaviors preserved |
| `src/index.ts` | PASS | All 35-test-verified exports present; `validateDelegationPlan` name consistent |
| `coordination.test.ts` | PASS | 35 tests, all four groups covered, lifecycle assertions are high-quality behavioral tests |
| `README.md` | PASS (minor) | Connectivity boundary section updated to mention selected-audience resolver; test list at bottom is stale (still enumerates 5 scenarios) |

---

## Verdict Rationale

The hardening pass closed both integration-blocking issues from the prior review:

- `registerSelectedResolver` is wired, scoped, and tested with a behavioral assertion that directly verifies resolver output.
- Test coverage reached the 35-test minimum with comprehensive unit tests for registry edge cases, synthesis strategy edge cases, and coordinator lifecycle — the exact gaps the prior review identified.

The validating-factory semantics for `createDelegationPlan` are now clearly documented as a deliberate decision, not an accidental divergence. The two spec name mismatches (`validateDelegationPlan`, `coord_` prefix) are implemented consistently and verified by tests.

The reasons for PASS_WITH_FOLLOWUPS rather than PASS are limited to minor items: H-6 tsconfig flags are unconfirmed (non-blocking, trivial to verify), the README test list is stale (cosmetic), and the resolver re-registration pattern is safe for v1 but should be documented before parallel delegation. None of these affect runtime correctness or integration readiness.

**The package is integration-ready for memory, routing, and product packages.**

---

V1_COORDINATION_HARDENING_REVIEW_COMPLETE

---README---
# Relay Agent Assistant

Shared open-source assistant SDK/runtime for AgentWorkforce products such as Sage, MSD, NightCTO, and future assistants.

## What This Repo Is

This repository defines the shared assistant layer that sits above Relay foundation infrastructure and below product-specific assistants.

It exists to centralize assistant concerns that should not be reimplemented in every product:

- assistant identity and runtime composition
- memory contracts and shared retrieval/persistence patterns
- session continuity across surfaces
- proactive behavior and scheduled follow-up engines
- multi-agent coordination behind one assistant identity
- policy, approvals, and audit hooks

## Current Status

**6 packages implemented and passing tests. 4 packages are placeholder/README-only. 1 package (traits) is planned for v1.2.**

Implementation vs specification status at a glance:

| Package | Implementation | Spec | Tests | Notes |
| --- | --- | --- | --- | --- |
| `@relay-assistant/core` | **IMPLEMENTED** | `SPEC_RECONCILED` | 31 pass | matches `v1-core-spec.md` |
| `@relay-assistant/sessions` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | 25 pass | matches `v1-sessions-spec.md` |
| `@relay-assistant/surfaces` | **IMPLEMENTED** | `SPEC_RECONCILED` | 28 pass | matches `v1-surfaces-spec.md` |
| `@relay-assistant/routing` | **IMPLEMENTED** (DoD gap) | `IMPLEMENTATION_READY` | 12 pass | test count below 40+ DoD target — **do not consume in products until resolved** |
| `@relay-assistant/connectivity` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | 30 pass | matches `v1-connectivity-spec.md` |
| `@relay-assistant/coordination` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | 39 pass | routing integration reviewed; escalation pipeline dormant (v1 known gap) |
| `@relay-assistant/memory` | **placeholder** | `IMPLEMENTATION_READY` | — | spec exists at `docs/specs/v1-memory-spec.md`; roadmap: v1.1 |
| `@relay-assistant/policy` | **placeholder** | none | — | no formal spec yet; roadmap: v2 |
| `@relay-assistant/proactive` | **placeholder** | none | — | no formal spec yet; roadmap: v1.2 |
| `@relay-assistant/examples` | **placeholder** | N/A | — | reference examples; not production code |
| `@relay-assistant/traits` | **planned — v1.2** | none | — | assistant identity traits, voice, style, behavioral defaults — see [traits and persona layer](docs/architecture/traits-and-persona-layer.md) |

**Total implemented: 165 tests, all passing.**

**Blocking DoD failure:** `@relay-assistant/routing` has 12 tests against a 40+ target. Do not wire routing into product integration until resolved.

---

## What Consumers Should Expect

Products import focused SDK packages from this repo. The v1 baseline (stable for product adapter work):

- `@relay-assistant/core`
- `@relay-assistant/sessions`
- `@relay-assistant/surfaces`

Beyond v1 (implemented, review before consuming):

- `@relay-assistant/coordination`
- `@relay-assistant/connectivity`
- `@relay-assistant/routing` (**gated** — routing tests below DoD; see above)

Planned for future milestones:

- `@relay-assistant/memory` — v1.1
- `@relay-assistant/traits` — v1.2
- `@relay-assistant/proactive` — v1.2
- `@relay-assistant/policy` — v2

Products such as Sage, MSD, and NightCTO should use this repo for reusable assistant runtime behavior while keeping their own domain logic, prompts, tools, UI, and product policy in their own repositories.

---

## Layer Model

### Relay foundation stays elsewhere

Keep these concerns in Relay family repos such as `relay`, `gateway`, `relaycron`, `relayauth`, and `relayfile`:

- transport adapters and webhook verification
- normalized inbound/outbound message primitives
- channel/session transport substrate
- auth and connection wiring
- low-level action dispatch
- scheduler and wake-up infrastructure
- relaycast and transport observability

### Assistant SDK lives here

This repo should own reusable assistant behavior built on top of Relay primitives:

- assistant construction and lifecycle
- memory scopes and adapters
- proactive engines and watch rules
- assistant session models
- assistant-facing surface contracts
- specialist coordination
- action policy and audit integration

### Product logic stays in product repos

Keep these concerns in Sage, MSD, NightCTO, and future product repositories:

- prompts, workforce persona definitions, and persona behavior beyond baseline identity
- product-specific workflows and tools
- domain-specific watchers and automations
- product UX and dashboards
- pricing, tiering, escalation, and customer policy

> **Workforce persona vs. assistant traits:** Workforce personas are runtime execution profiles (model, harness, system prompt, tier). Assistant traits are identity and behavioral characteristics (voice, style, vocabulary, proactivity). These are distinct. See [traits and persona layer](docs/architecture/traits-and-persona-layer.md) for the full boundary definition.

---

## Package Map

| Package | Purpose | Status |
| --- | --- | --- |
| `@relay-assistant/core` | Assistant definition, lifecycle, shared runtime composition | **IMPLEMENTED** |
| `@relay-assistant/sessions` | Cross-surface session identity, resume, attachment rules | **IMPLEMENTED** |
| `@relay-assistant/surfaces` | Assistant-facing surface abstractions above Relay transport | **IMPLEMENTED** |
| `@relay-assistant/routing` | Model-choice, latency/depth/cost routing, workload-router-aligned policy | **IMPLEMENTED** (DoD gap — see above) |
| `@relay-assistant/connectivity` | Efficient inter-agent signaling, convergence, escalation, and communication contracts | **IMPLEMENTED** |
| `@relay-assistant/coordination` | Coordinator/specialist orchestration and synthesis contracts | **IMPLEMENTED** |
| `@relay-assistant/traits` | Assistant identity traits: voice, style, vocabulary, behavioral defaults, surface formatting preferences | **planned — v1.2** |
| `@relay-assistant/memory` | Memory scopes, stores, retrieval, promotion, compaction hooks | placeholder — v1.1 |
| `@relay-assistant/proactive` | Follow-up engines, watch rules, scheduler bindings | placeholder — v1.2 |
| `@relay-assistant/policy` | Approvals, external-action safeguards, audit hooks | placeholder — v2 |
| `@relay-assistant/examples` | Reference adoption examples, not production product code | placeholder |

---

## Read This First

- [Docs index](docs/index.md)
- [Package boundary map](docs/architecture/package-boundary-map.md)
- [Traits and persona layer](docs/architecture/traits-and-persona-layer.md)
- [SDK audit and alignment plan](docs/architecture/sdk-audit-and-traits-alignment-plan.md)
-  onnectivity package spec](docs/architecture/connectivity-package-spec.md)
- [Extraction roadmap](docs/architecture/extraction-roadmap.md)
- [OSS vs cloud split](docs/architecture/oss-vs-cloud-split.md)
- [How to build an assistant](docs/consumer/how-to-build-an-assistant.md)
- [How products should adopt this SDK](docs/consumer/how-products-should-adopt-relay-agent-assistant.md)
-  onnectivity adoption guide](docs/consumer/connectivity-adoption-guide.md)
-  onnectivity patterns research](docs/research/connectivity-patterns.md)
- [Internal system comparison](docs/research/internal-system-comparison.md)
- [Glossary](docs/reference/glossary.md)

---

## Implementation Direction

This repository should become the OSS core.

A later cloud implementation should be built on top of the OSS SDK in a separate package or repo, similar in spirit to other AgentWorkforce properties that keep the reusable core open-source and place Cloudflare-backed adapters and hosted infrastructure in a distinct cloud layer.

That later cloud layer should depend on this SDK, not replace it.

---

## Initial Adoption Rule

If a capability is reusable across multiple assistants with only configuration or adapter changes, it belongs here.

If a capability depends on product-specific ontology, customer workflow, or product policy, it stays in the product repo.

**Reuse-first rule for new package work:** Before authoring a new package implementation, inspect `relay` and related AgentWorkforce repos for reusable packages, contracts, or runtime capabilities. For memory specifically, treat `@relay-assistant/memory` as an assistant-facing adapter/composition layer over `@agent-relay/memory`, not a greenfield memory engine.

SDK_AUDIT_STATUS_UPDATED

## Future advanced memory direction

A later-stage capability of the SDK should be **cross-agent memory consolidation** (a librarian / night-crawler style layer). This is not a v1 feature. Treat it as a **v5-v8 level** capability that depends on stable memory, coordination, and connectivity foundations.

The purpose of that future layer is to:
- deduplicate facts produced by multiple agents
- reconcile contradictions
- preserve provenance and confidence
- publish consolidated shared/team memory

This is one of the places where the assistant SDK intentionally differs from one-agent/one-memory frameworks.

---PACKAGE BOUNDARY MAP---
# Package Boundary Map

Date: 2026-04-11
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — traits/persona layer added; implementation status reflected; reuse-first rule made explicit)

## Purpose

This document defines what belongs in:

- Relay foundation repos
- `relay-agent-assistant` OSS SDK packages
- product repositories such as Sage, MSD, and NightCTO

The goal is to prevent duplicate assistant-runtime work while avoiding leakage of transport infrastructure or product-specific behavior into the wrong layer.

## Boundary Rule

Use this rule first:

- if the capability is transport, auth, scheduling substrate, or low-level action dispatch, keep it in Relay foundation
- if the capability assumes an assistant identity, memory model, session continuity model, specialist orchestration model, or focused inter-agent connectivity model, move it here
- if the capability only makes sense for one product's domain, keep it in that product repo

**Reuse-first rule for new implementations:** Before authoring a new package implementation workflow, inspect `relay` and related AgentWorkforce repos for reusable packages, contracts, or runtime capabilities. Only build new assistant-side code where a clear gap exists that is not already satisfied by Relay packages.

---

## Workforce Persona vs. Assistant Traits

These are distinct concerns that solve different problems. Do not conflate them.

**Workforce personas** are runtime execution profiles owned by Workforce infrastructure. A persona defines:
- system prompt
- model
- harness (Claude, Codex, OpenCode)
- harness settings
- optional skills
- service tiers (`best`, `best-value`, `minimum`)

Personas answer: **"What runtime configuration should this agent use to execute a task?"**

**Assistant traits** are identity and behavioral characteristics owned by this SDK (future `@relay-assistant/traits` package). Traits define:
- voice and communication style
- domain vocabulary and framing
- behavioral defaults (proactivity level, formality, risk tolerance)
- formatting preferences per surface
- personality continuity across sessions

Traits answer: **"How should this assistant present itself and behave across interactions?"**

A workforce persona's `systemPrompt` may **embed** trait values (e.g., "You are Sage, a knowledge-focused assistant who speaks concisely"), but the prompt is a persona artifact. Traits are the **source data** that prompts, formatters, and behavioral policies read from. Products compose traits into personas, not the other way around.

See [traits-and-persona-layer.md](traits-and-persona-layer.md) for the full boundary definition, integration points, and the proposed `@relay-assistant/traits` package spec.

---

## Layer Ownership

### Relay foundation

Relay family repos should continue to own:

- inbound webhook verification and provider-specific parsing
- normalized message and outbound delivery primitives
- channel and transport session substrate
- auth and connection wiring
- low-level action dispatch
- scheduler and wake-up substrate
- relaycast or other communication infrastructure
- transport-level observability

Examples that stay out of this repo:

- Slack signature verification
- WhatsApp payload parsing
- generic cron registration
- raw `spawn_agent` or message-delivery plumbing

### Relay Agent Assistant SDK

This repo should own reusable assistant-runtime behavior:

- assistant definition and capability registration
- assistant identity traits (voice, style, behavioral defaults) — see `@relay-assistant/traits`
- memory scopes, retrieval, persistence contracts, promotion, compaction
- proactive engines, watch rules, reminders, scheduler bindings
- assistant session continuity across surfaces
- assistant-facing surface abstractions above normalized transport events
- coordinator and specialist orchestration
- focused inter-agent connectivity, signaling, and convergence contracts
- assistant-level routing, latency, depth, and budget-aware policy hooks
- policy, approvals, audit hooks, and action risk classification

Examples that should land here:

- a shared `AssistantSession` model
- a reusable `MemoryStore` contract
- a generic `ProactiveEngine`
- a coordinator that can delegate to specialists and synthesize one assistant response

### Product repositories

Product repos should continue to own:

- workforce persona definitions (model, harness, system prompt, tier)
- prompts and persona behavior beyond baseline assistant identity fields
- product-specific tools and workflows
- domain-specific watcher rules
- product UX and surface conventions
- business policy, escalation, and commercial rules
- product-specific specialist definitions

Examples:

- MSD review heuristics and PR-specific workflows
- Sage knowledge-capture behavior and workspace semantics
- NightCTO founder communication patterns and service-tier policy

---

## Package Responsibilities

### `@relay-assistant/core`

**Implementation status: IMPLEMENTED — 31 tests passing, `SPEC_RECONCILED`**

Owns:

- `createAssistant()` and assistant definition types
- runtime lifecycle and capability registration
- assistant identity fields: `id`, `name`, `description?`
- lightweight composition entrypoints and shared cross-package types

Identity scope note:
- `core` owns `id`, `name`, `description?` — the minimum identity fields needed to run an assistant
- Behavioral identity (voice, style, vocabulary, proactivity) will live in `@relay-assistant/traits` when extracted
- `AssistantDefinition` does **not** have a `traits` field yet. When `@relay-assistant/traits` ships, a `traits?: TraitsProvider` optional field will be added. Do not add it prematurely — the current types.ts has no such field and that is correct.

Composition note:
- `core` should not become a heavy package that hard-depends on every other package by default
- prefer interface-first composition and optional package wiring so consumers can adopt only the packages they need

Must not own:

- provider-specific transport code
- memory backend implementation details
- product workflows
- workforce persona definitions

### `@relay-assistant/traits` (planned — v1.2)

**Implementation status: NOT IMPLEMENTED — no spec, no types, no placeholder**

Owns:

- `AssistantTraits` type definition (voice, style, vocabulary, proactivity level, risk posture, formality, domain framing)
- `SurfaceFormattingTraits` type definition (per-surface-type formatting preferences that inform format hooks)
- `TraitsProvider` interface — a read-only accessor that packages can consume without hard-depending on traits
- `createTraitsProvider(traits: AssistantTraits)` factory
- Validation that trait values are within acceptable ranges/enums

Must not own:

- Persona definitions — those stay in workforce
- System prompts — those are persona artifacts, not traits
- Product-specific behavioral logic — stays in product repos
- Model selection or routing — stays in `routing`
- Memory or session state — stays in those packages

Dependency direction: traits has zero upstream dependencies on other SDK packages. It is a leaf data package.

See [traits-and-persona-layer.md](traits-and-persona-layer.md) for full spec.

### `@relay-assistant/memory`

**Implementation status: placeholder — spec exists (`v1-memory-spec.md`, `IMPLEMENTATION_READY`); roadmap: v1.1**

Implementation posture:

- first investigate and reuse the existing `@agent-relay/memory` package where possible
- prefer an assistant-facing adapter/composition layer over a greenfield memory engine
- only add new memory runtime logic here when assistant-specific requirements are not already satisfied by Relay memory capabilities

Owns:

- memory scopes such as user, session, workspace, org, and object
- retrieval, write, compaction, and promotion contracts
- memory adapter interfaces for future backends

Must not own:

- one product's tag taxonomy
- one surface's thread model as the only memory key shape

### `@relay-assistant/proactive`

**Implementation status: placeholder — no formal spec; roadmap: v1.2**

Owns:

- follow-up engines
- watcher definitions
- reminder policies
- scheduler bindings over Relay substrate
- evidence contracts for stale-session or follow-up decisions

Must not own:

- product-only trigger logic
- surface-specific evidence collection that cannot generalize

### `@relay-assistant/sessions`

**Implementation status: IMPLEMENTED — 25 tests passing, `IMPLEMENTATION_READY`**

Owns:

- assistant session identity
- attachment of multiple surfaces to one assistant session
- resume, reattach, and affinity rules
- scoping rules across user, workspace, org, and object contexts

Must not own:

- raw transport sessions
- provider webhook semantics

### `@relay-assistant/surfaces`

**Implementation status: IMPLEMENTED — 28 tests passing, `SPEC_RECONCILED`**

Owns:

- assistant-facing inbound and outbound abstractions
- assistant-layer fanout policy describing which connected surfaces should receive a given assistant response
- formatter and capability hooks above Relay normalization
- surface metadata such as threading or attachment support

Fanout boundary note:
- Relay foundation still owns actual transport delivery to each destination
- `surfaces` only decides assistant-level targeting and formatting across attached surfaces
- Example: deciding that one assistant summary should go to web plus Slack belongs here; the actual Slack API post and web transport delivery remain in Relay foundation

Must not own:

- webhook verification
- provider SDK clients as foundational transport code

### `@relay-assistant/coordination`

**Implementation status: IMPLEMENTED — 39 tests passing**

Owns:

- coordinator and specialist registry contracts
- delegation plan and synthesis contracts
- many-agents-one-assistant orchestration semantics

Known gap (v1): coordinator does not pass `activeEscalations` to `router.decide()`. Escalation-routing pipeline is dormant. Document as v1 known gap; wire in v1.1.

Must not own:

- a fixed specialist lineup for any one product
- product-specific dispatch heuristics that cannot generalize

### `@relay-assistant/connectivity`

**Implementation status: IMPLEMENTED — 30 tests passing, `IMPLEMENTATION_READY`**

Owns:

- focused inter-agent signaling contracts
- convergence and escalation semantics
- attention, salience, confidence, and handoff message classes
- communication efficiency rules for internal assistant coordination

Must not own:

- raw message transport or relaycast substrate
- product-specific specialist registries
- generic user-facing messaging APIs

### `@relay-assistant/routing`

**Implementation status: IMPLEMENTED — 12 tests passing**

**Blocking DoD failure:** routing has 12 tests against a required 40+ target. Do not consume in products until resolved. See `docs/architecture/v1-routing-review-verdict.md` for F-1 (test count) and F-2 (escalated flag) details.

Owns:

- assistant-facing routing contracts
- latency/depth/cost response modes (`cheap`/`fast`/`deep` — SDK vocabulary, distinct from workforce tier names `minimum`/`best-value`/`best`)
- model-choice policy above raw provider clients
- integration points for workforce workload-router style persona/tier resolution

Must not own:

- raw transport routing
- provider SDK implementation details
- product-specific commercial routing rules
- workforce persona names or tier mapping — products map between SDK modes and workforce tiers

### `@relay-assistant/policy`

**Implementation status: placeholder — no formal spec; roadmap: v2**

Owns:

- approval modes
- external-action safeguards
- action risk classification
- audit hooks

Must not own:

- one product's commercial rules or customer-tier behavior

### `@relay-assistant/examples`

**Implementation status: placeholder**

---TRAITS LAYER---
# Traits and Persona Layer

Date: 2026-04-11
Source: [sdk-audit-and-traits-alignment-plan.md](sdk-audit-and-traits-alignment-plan.md) §3–4

## Purpose

This document defines where assistant traits and identity live in the package architecture, how they differ from workforce personas, and what the planned `@relay-assistant/traits` package will own.

---

## Workforce Personas vs. Assistant Traits

These solve different problems. They must not be collapsed into one concept.

### Workforce personas

Workforce personas are **runtime execution profiles**. A persona defines:

- system prompt
- model
- harness (Claude, Codex, OpenCode)
- harness settings
- optional skills
- service tiers (`best`, `best-value`, `minimum`)

Personas answer: **"What runtime configuration should this agent use to execute a task?"**

A routing profile selects which persona tier to use per intent. The workload-router resolves `intent → persona + tier → concrete runtime config`. Personas are defined in and owned by Workforce infrastructure. They are not imported into this SDK.

### Assistant traits

Assistant traits are **identity and behavioral characteristics**. Traits define:

- voice and communication style
- domain vocabulary and framing
- behavioral defaults (proactivity level, formality, risk tolerance)
- formatting preferences per surface
- personality continuity across sessions

Traits answer: **"How should this assistant present itself and behave across interactions?"**

Traits are SDK-layer data, owned by `@relay-assistant/traits` (planned for v1.2). Until that package ships, products define traits as local data objects.

---

## Relationship Without Collapse

```
workforce persona (runtime config)     assistant traits (identity + behavior)
         │                                        │
         ▼                                        ▼
  ┌─────────────┐                        ┌──────────────┐
  │ model        │                        │ voice         │
  │ harness      │                        │ style         │
  │ system prompt│◄── prompt may embed ───│ vocabulary    │
  │ tier policy  │    trait values         │ proactivity   │
  │ skills       │                        │ risk posture  │
  └─────────────┘                        └──────────────┘
```

- A workforce persona's `systemPrompt` may **embed** trait values (e.g., "You are Sage, a knowledge-focused assistant who speaks concisely"), but the prompt itself is a persona artifact — the execution-time artifact.
- Traits are the **source data** that multiple prompts, formatters, and behavioral policies read from.
- A single assistant identity (e.g., "Sage") may be served by multiple workforce personas at different tiers. The traits remain constant across all tiers.
- Products compose traits into personas, not the other way around.

### Routing mode naming is distinct from persona naming

SDK routing modes (`cheap`/`fast`/`deep`) are SDK vocabulary for latency/depth/cost decisions. Workforce uses `minimum`/`best-value`/`best` for tier names. The mapping is intentional and explicit — products map between them. Neither package should adopt the other's naming.

---

## Integration Points

| Concern | Owner | Consumes traits? |
| --- | --- | --- |
| Persona resolution (`resolvePersona`) | Workforce workload-router | No — personas are self-contained runtime configs. Products may inject trait values into prompt templates before passing to the persona. |
| Routing mode selection (`router.decide()`) | `@relay-assistant/routing` | No — routing is about depth/latency/cost, not identity. |
| Surface formatting (`formatHook`) | `@relay-assistant/surfaces` | Yes — a format hook may read traits to adjust voice, block style, or formality per surface. |
| Session continuity | `@relay-assistant/sessions` | No — sessions track state, not identity. |
| Coordination synthesis | `@relay-assistant/coordination` | Yes — a synthesizer may read traits to maintain consistent voice when merging specialist outputs. |
| Proactive behavior (future) | `@relay-assistant/proactive` | Yes — traits like proactivity level and risk posture inform watch rules and follow-up thresholds. |

---

## Current State (v1)

**No traits package exists.** `@relay-assistant/traits` is planned for v1.2.

In v1:
- Products define traits as local data objects (not imported from this SDK).
- Trait values are injected manually into persona prompts, format hooks, and synthesizer configs by the product.
- The SDK does not enforce trait consistency. That is the product's responsibility until a traits package exists.

Interim pattern for products that want to pass trait context through the runtime:

```typescript
// Product-owned local traits object — not from SDK
const sageTraits = {
  voice: 'concise',
  formality: 'professional',
  proactivity: 'medium',
  domain: 'knowledge-and-workspace',
};

// Injected into format hook at surface connection definition time
const slackConnection: SurfaceConnection = {
  id: 'sage-slack',
  type: 'slack',
  // ...
  formatHook: (event, caps) => formatWithTraits(event, caps, sageTraits),
};
```

---

## Planned Package: `@relay-assistant/traits` (v1.2)

### Position in package map

| Package | Purpose |
| --- | --- |
| `@relay-assistant/core` | Assistant definition, lifecycle, runtime composition |
| **`@relay-assistant/traits`** | **Assistant identity traits: voice, style, vocabulary, behavioral defaults, surface formatting preferences** |
| `@relay-assistant/memory` | Memory scopes, stores, retrieval, promotion |
| `@relay-assistant/sessions` | Session identity, lifecycle, surface attachment |
| `@relay-assistant/surfaces` | Surface abstractions, normalization, fanout |
| `@relay-assistant/coordination` | Specialist orchestration, synthesis |
| `@relay-assistant/connectivity` | Inter-agent signaling, convergence |
| `@relay-assistant/routing` | Depth/latency/cost mode selection |
| `@relay-assistant/proactive` | Follow-ups, watchers, schedulers |
| `@relay-assistant/policy` | Approvals, safeguards, audit |

### What `@relay-assistant/traits` owns

- `AssistantTraits` type definition (voice, style, vocabulary, proactivity level, risk posture, formality, domain framing)
- `SurfaceFormattingTraits` type definition (per-surface-type formatting preferences that inform format hooks)
- `TraitsProvider` interface — a read-only accessor that packages can consume without hard-depending on traits
- `createTraitsProvider(traits: AssistantTraits)` factory
- Validation that trait values are within acceptable ranges/enums

### What `@relay-assistant/traits` must not own

- Persona definitions — those stay in workforce
- System prompts — those are persona artifacts, not traits
- Product-specific behavioral logic — stays in product repos
- Model selection or routing — stays in `routing`
- Memory or session state — stays in those packages

### Dependency direction

```
traits ← core (optional: AssistantDefinition may reference a TraitsProvider)
traits ← surfaces (optional: format hooks may consume traits)
traits ← coordination (optional: synthesizer may consume traits)
traits ← proactive (optional: watch rules may consume traits)
```

Traits has **zero upstream dependencies** on other SDK packages. It is a leaf data package.

### Integration with `AssistantDefinition`

The current `AssistantDefinition` has `id`, `name`, `description?`. When traits ships:

```typescript
export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;  // NEW — optional, from @relay-assistant/traits
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
```

The `traits?` field is optional so existing consumers are unaffected. Products that want trait-driven formatting, synthesis, or proactive behavior wire a `TraitsProvider` at definition time. Packages that consume traits access it via `runtime.definition.traits`.

---

## Extraction Timeline

- **v1 (current):** No traits package. Products define traits as local data objects. Acceptable for the current adoption phase.
- **v1.1 (with memory):** Consider traits spec alongside memory. Memory and traits often interact (e.g., "remember that this user prefers informal voice" is a memory-stored trait override).
- **v1.2 (with proactive + coordination maturity):** Implement `@relay-assistant/traits` package. By this point, multiple products will have local trait patterns worth extracting.

### Extraction signal

The same rule that governs all SDK extraction applies: if a capability is reusable across multiple assistants with only configuration changes, it belongs here. When Sage, MSD, and NightCTO all have local trait objects with overlapping field shapes, the extraction is justified.

---

## Rules for Future Workflows

1. **Never import workforce personas into the assistant SDK.** Personas are runtime configs owned by workforce. The SDK provides traits (identity data) and routing (mode selection). Products compose these at the integration boundary.

2. **Routing mode names (`cheap`/`fast`/`deep`) are SDK vocabulary, not workforce vocabulary.** Do not adopt workforce tier naming in SDK packages.

3. **Traits are not prompts.** A trait like `voice: "concise"` is a data value. The prompt that says "Respond concisely" is a persona artifact. Products turn traits into prompt fragments; the SDK does not.

4. **The `AssistantDefinition.traits?` field does not exist yet** and must not be added until `@relay-assistant/traits` ships. The current `packages/core/src/types.ts` has no `traits` field on `AssistantDefinition` — that is correct. When the traits package ships, the field will be added as `traits?: TraitsProvider` (optional, non-breaking).

5. **Future workflows touching identity, formatting, or behavioral consistency** should check whether the traits package exists before implementing product-local workarounds.

---

TRAITS_PERSONA_LAYER_READY

---WORKFLOW BACKLOG---
# V1 Workflow Backlog

Date: 2026-04-11
Revised: 2026-04-11 (post spec-program-review-verdict and spec-reconciliation-rules — aligned to canonical spec vocabulary; fanout/targeting rules and cross-package ownership clarified)
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — implementation status updated; WF-1 through WF-5 marked COMPLETE; routing DoD gap noted; traits context added)

> **Canonical source of truth:** Package specs in `docs/specs/` override this document when there is drift. This backlog was updated to align with `docs/specs/v1-core-spec.md`, `docs/specs/v1-sessions-spec.md`, and `docs/specs/v1-surfaces-spec.md` after the spec program review and reconciliation rules pass on 2026-04-11.

## Implementation Status Summary

| Workflow | Package(s) | Status | Tests |
| --- | --- | --- | --- |
| WF-1: Define assistant and start runtime | core | **COMPLETE** | 31 pass |
| WF-2: Handle inbound message via dispatch | core | **COMPLETE** | (included in core 31) |
| WF-3: Create and manage sessions | sessions | **COMPLETE** | 25 pass |
| WF-4: Wire session store into runtime | core + sessions | **COMPLETE** | (included in above) |
| WF-5: Register surface registry and route messages | core + surfaces | **COMPLETE** | 28 pass (surfaces) |
| WF-6: Multi-surface session fanout | core + sessions + surfaces | **COMPLETE** — `packages/core/src/core-sessions-surfaces.test.ts` (WF-6 label, line 99) covers multi-surface session attachment, fanout, targeted send, and detach behavior |
| WF-7: End-to-end assembly | core + sessions + surfaces | **OPEN** — no assembly test in `packages/examples/src/` (directory not yet created); core/sessions/surfaces READMEs are substantive (not placeholders) |

**Blocking DoD failure (not cleared):** `@relay-assistant/routing` has 12 tests against a required 40+ target. Routing is implemented but is gated from product consumption until this is resolved. See `docs/architecture/v1-routing-review-verdict.md` for F-1 (test count) and F-2 (escalated flag) details.

**Additional implemented packages (beyond WF-1 through WF-5 scope):**
- `@relay-assistant/connectivity` — 30 tests passing
- `@relay-assistant/coordination` — 39 tests passing; routing integration reviewed; escalation-routing pipeline dormant (v1 known gap)

---

## Purpose

This document is the canonical ordered backlog of implementation workflows for v1. Each workflow is a narrow, PR-sized vertical slice through one or more packages. Workflows produce working, testable code and are the unit of implementation work.

Implement in order. Each workflow gates the next unless explicitly noted as parallelizable.

---

## Pre-Workflow: Reconciliation Phase (Complete — WF-1 implementation may begin)

### Spec Phase

Three spec documents are finalized and marked `IMPLEMENTATION_READY`. They are the authoritative implementation reference for all workflow code.

| Spec | Path | Status |
| --- | --- | --- |
| core v1 | `docs/specs/v1-core-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |
| sessions v1 | `docs/specs/v1-sessions-spec.md` | IMPLEMENTATION_READY |
| surfaces v1 | `docs/specs/v1-surfaces-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |

### Contradiction Resolutions (Gate cleared — all actions complete)

Three cross-package contradictions identified in `docs/architecture/spec-reconciliation-rules.md` have been resolved in the specs. Both `docs/specs/v1-core-spec.md` and `docs/specs/v1-surfaces-spec.md` carry `SPEC_RECONCILED` status. All eight checklist actions in the reconciliation rules document are complete.

| Action | Target | Contradiction | Status |
| --- | --- | --- | --- |
| 1 | `docs/specs/v1-core-spec.md`: remove "owns inbound normalization" from §1; update `RelayInboundAdapter` to accept `InboundMessage` (not `raw: unknown`) | 1 — inbound normalization ownership | **Resolved** — `SPEC_RECONCILED` |
| 2 | `docs/specs/v1-core-spec.md §3.3`: add `userId: string` (required) and `workspaceId?: string` (optional) to `InboundMessage` | 2 — missing identity fields | **Resolved** — `SPEC_RECONCILED` |
| 3 | `docs/specs/v1-core-spec.md §3.8`: make `OutboundEvent.surfaceId` optional (`surfaceId?`); add `OutboundEventError` | 3 — required surfaceId vs. fanout | **Resolved** — `SPEC_RECONCILED` |
| 4 | `docs/specs/v1-core-spec.md`: add normative outbound routing rule to `runtime.emit()` contract | 3 | **Resolved** — `SPEC_RECONCILED` |
| 5 | `docs/specs/v1-surfaces-spec.md`: confirm `SurfaceRegistry` implements `RelayInboundAdapter`; add `userId`/`workspaceId` to normalization table §4.10 | 1, 2 | **Resolved** — `SPEC_RECONCILED` |
| 6 | `docs/specs/v1-surfaces-spec.md`: add normative outbound routing rule reference | 3 | **Resolved** — `SPEC_RECONCILED` |
| 7 | Update adoption examples in `docs/workflows/weekend-delivery-plan.md` to match resolved contracts | all | **Resolved** |
| 8 | Search all docs for stale terms (Rule 1 table); replace with current terms | all | **Resolved** |

### Key canonical terms (do not use old planning vocabulary)

- `AssistantDefinition` (not `AssistantConfig`)
- `AssistantRuntime` (not `Assistant`)
- `runtime.dispatch()` (not `handleMessage`)
- `InboundMessage` / `OutboundEvent` (not `AssistantMessage`)
- `createSurfaceRegistry()` + `SurfaceConnection` (not `createSurfaceConnection()`)
- `sessionStore.touch()` / `sessionStore.expire()` (not `resume` / `close`)
- Session states: `created → active → suspended → expired` (not `resumed` or `closed`)
- `surfaceRegistry` wired as both `inbound` and `outbound` relay adapter (not `assistant.attachSurface()`)

---

## WF-1: Define assistant and start runtime — **COMPLETE**

**Package:** `core`
**Status:** COMPLETE — 31 tests passing, `SPEC_RECONCILED`
**Depends on:** `docs/specs/v1-core-spec.md` (`SPEC_RECONCILED` — Contradiction 1–3 resolutions applied)
**Produces:** `AssistantDefinition`, `AssistantRuntime`, `createAssistant`, lifecycle state machine, `runtime.status()`
**PR scope:** `packages/core/src/types.ts`, `packages/core/src/core.ts`, `packages/core/src/core.test.ts`

### Steps

1. Define an `AssistantDefinition` with `id`, `name`, and a `capabilities` map (`Record<string, CapabilityHandler>`)
2. Call `createAssistant(definition, { inbound: stubAdapter, outbound: stubAdapter })` — returns `AssistantRuntime`
3. Call `runtime.start()` — verify `runtime.status().ready === true`
4. Call `runtime.stop()` — verify runtime is no longer accepting dispatches
5. Verify double-start is idempotent or throws expected error
6. Verify double-stop is idempotent or throws expected error

### Acceptance criteria

- `AssistantDefinition` interface is defined and exported from `packages/core/src/index.ts`
- `AssistantRuntime` interface is defined and exported
- `createAssistant` factory is exported; it validates `definition` and throws `AssistantDefinitionError` on invalid input
- `runtime.status()` returns `RuntimeStatus` reflecting `ready`, `startedAt`, `registeredCapabilities`, `registeredSubsystems`, `inFlightHandlers`
- At least one test exercises the full start/stop cycle with a stub relay adapter
- No network calls, no side effects outside in-memory state
- `RelayInboundAdapter` and `RelayOutboundAdapter` interfaces are exported (with `RelayInboundAdapter.onMessage` accepting `InboundMessage` per Contradiction 1 resolution)

---

## WF-2: Handle inbound message via capability dispatch — **COMPLETE**

**Package:** `core`
**Status:** COMPLETE — included in core 31 tests
**Depends on:** WF-1
**Produces:** capability dispatch table, `runtime.dispatch()`, `AssistantHooks.onMessage` pre-filter, `runtime.emit()`, `InboundMessage` / `OutboundEvent` types
**PR scope:** additions to `packages/core/src/types.ts`, additions to `packages/core/src/core.ts`, new test cases in `packages/core/src/core.test.ts`

### Steps

1. Create and start a runtime with a capability named `"chat"` mapped to a handler function
2. Call `runtime.dispatch(inboundMessage)` where `inboundMessage.capability === "chat"`
3. Verify the `"chat"` handler is called with the correct `InboundMessage` and `CapabilityContext`
4. Handler calls `context.runtime.emit(outboundEvent)` — verify stub outbound adapter receives the event
5. Register an `onMessage` hook that returns `false` — verify dispatch is dropped before handler is called
6. Dispatch a message with an unregistered capability — verify expected error or no-op behavior
7. Verify `runtime.status().inFlightHandlers` tracks concurrent handler invocations

### Acceptance criteria

- `InboundMessage` type is defined and exported with all fields:
  `id`, `surfaceId`, `sessionId?`, `userId` (required — per Contradiction 2 resolution), `workspaceId?` (optional — per Contradiction 2 resolution), `text`, `raw`, `receivedAt`, `capability`
- `OutboundEvent` type is defined and exported:
  `surfaceId?` (optional — per Contradiction 3 resolution), `sessionId?`, `text`, `format?`
- `OutboundEventError` is defined and exported; `runtime.emit()` throws it when both `surfaceId` and `sessionId` are absent
- `CapabilityHandler` type signature matches spec: `(message: InboundMessage, context: CapabilityContext) => Promise<void> | void`
- `CapabilityContext` includes `runtime` and `log`
- `AssistantHooks.onMessage` returning `false` drops the message; `true` or `undefined` proceeds
- `runtime.emit()` calls `RelayOutboundAdapter.send()` with the `OutboundEvent`

---

## WF-3: Create and manage sessions — **COMPLETE**

**Package:** `sessions`
**Status:** COMPLETE — 25 tests passing, `IMPLEMENTATION_READY`
**Depends on:** `docs/specs/v1-sessions-spec.md` (independent of WF-1/WF-2 — parallelizable)
**Produces:** `SessionStore`, `Session`, lifecycle transitions, in-memory `SessionStoreAdapter`, error types
**PR scope:** `packages/sessions/src/types.ts`, `packages/sessions/src/sessions.ts`, `packages/sessions/src/sessions.test.ts`

### Acceptance criteria

- `Session` interface matches spec: `id`, `userId`, `workspaceId?`, `state`, `createdAt`, `lastActivityAt`, `stateChangedAt?`, `attachedSurfaces`, `metadata`
- `SessionState` union type: `'created' | 'active' | 'suspended' | 'expired'`
- `SessionStore` interface fully implemented with `create`, `get`, `find`, `touch`, `attachSurface`, `detachSurface`, `expire`, `sweepStale`, `updateMetadata`
- `createSessionStore` factory exported from `packages/sessions/src/index.ts`
- `InMemorySessionStoreAdapter` exported
- `SessionNotFoundError`, `SessionConflictError`, `SessionStateError` exported
- `AffinityResolver` interface exported; default implementation finds most recently active session for a userId

---

## WF-4: Wire session store into runtime — **COMPLETE**

**Package:** `core` + `sessions`
**Status:** COMPLETE — included in core and sessions test counts
**Depends on:** WF-2, WF-3
**Produces:** `runtime.register('sessions', store)`, session resolution in capability handler context, `resolveSession()` utility integration

> **Cross-package note:** Sessions does not inject session middleware into core's dispatch pipeline. Products wire session lookups into capability handlers themselves using `context.runtime.get<SessionStore>('sessions')` and the `resolveSession()` utility exported by `@relay-assistant/sessions`. Core remains unaware of session semantics.

---

## WF-5: Register surface registry and route messages — **COMPLETE**

**Package:** `core` + `surfaces`
**Status:** COMPLETE — 28 tests passing (surfaces), `SPEC_RECONCILED`
**Depends on:** `docs/specs/v1-surfaces-spec.md`, WF-2
**Produces:** `SurfaceRegistry`, `SurfaceConnection`, `SurfaceAdapter`, `SurfaceCapabilities`, inbound normalization, outbound targeted send, connection state management

> **Cross-package ownership note (Contradiction 1 resolution):** Surfaces owns inbound normalization. Core does not normalize raw events; it receives only `InboundMessage`.

---

## WF-6: Multi-surface session fanout — **COMPLETE**

**Package:** `core` + `sessions` + `surfaces`
**Status:** COMPLETE — `packages/core/src/core-sessions-surfaces.test.ts` (WF-6 describe block, line 99) covers multi-surface session attachment, fanout, targeted send, and detach behavior with full assertions.
**Depends on:** WF-4, WF-5
**Produces:** cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout outbound rule validated in integration

> **Fanout ownership note:** The surfaces package owns fanout delivery. When `runtime.emit()` is called with a `sessionId` but without a `surfaceId`, core resolves the session's `attachedSurfaces` and calls `surfaceRegistry.fanout(event, attachedSurfaceIds, policy?)`.

### Steps

1. Create a runtime with sessions and a surface registry (slack + web connections)
2. User sends a message via slack surface — `resolveSession()` creates a new session; `store.attachSurface(sessionId, 'slack-1')` is called
3. Same userId sends a message via web surface — `resolveSession()` returns existing session; `store.attachSurface(sessionId, 'web-1')` is called
4. Verify `session.attachedSurfaces` contains both `'slack-1'` and `'web-1'`
5. Handler emits `OutboundEvent` with `surfaceId` set to originating surface — verify only that surface's adapter receives the event (targeted send via `surfaceRegistry.send()`)
6. Handler emits `OutboundEvent` with `sessionId` but no `surfaceId` — verify `surfaceRegistry.fanout()` is called and both adapters receive the event (session fanout)
7. Handler emits `OutboundEvent` with neither `surfaceId` nor `sessionId` — verify `runtime.emit()` throws `OutboundEventError`
8. Call `store.detachSurface(sessionId, 'slack-1')` — verify fanout no longer includes slack
9. Verify `FanoutResult` reports correct `total`, `delivered`, `outcomes` fields

### Acceptance criteria

- Session correctly accumulates surface references across multiple surface interactions from the same userId
- Targeted send (`surfaceId` present) routes only to the specified adapter via `surfaceRegistry.send()`
- Fanout (`sessionId` present, no `surfaceId`) routes to all `session.attachedSurfaces` via `surfaceRegistry.fanout()`
- Invalid emit (neither `surfaceId` nor `sessionId`) throws `OutboundEventError` (per Contradiction 3 resolution)
- Detach behavior removes surface from fanout targets
- No session duplication for same userId across surfaces
- `FanoutResult` structure is correct per spec

---

## WF-7: End-to-end assembly

**Package:** `core` + `sessions` + `surfaces`
**Status:** OPEN — package READMEs for core (152 lines), sessions (118 lines), and surfaces (175 lines) are substantive API docs (not placeholders). However, the end-to-end assembly test in `packages/examples/src/` does not yet exist — `packages/examples/src/` directory has not been created. This is the remaining blocker for WF-7 and the v1 release tag.
**Depends on:** WF-6
**Produces:** integration test, validated assembly pattern, updated package READMEs, v1 release tag prepared
**PR scope:** new file `packages/examples/src/v1-assembly.ts`, new test `packages/examples/src/v1-assembly.test.ts`, updated READMEs for core, sessions, surfaces

### Steps

1. Import only `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces` — no other packages
2. Define `AssistantDefinition` with `id`, `name`, `capabilities: { chat: chatHandler }`
3. Create `InMemorySessionStoreAdapter` and `createSessionStore({ adapter })`
4. Create `createSurfaceRegistry()` with slack and web connections (stub adapters)
5. Wire: `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })`
6. `runtime.register('sessions', sessionStore)`
7. In `chatHandler`: resolve session via `resolveSession(message, store, resolver)` (reads `message.userId`), touch it, emit a response
8. Call `runtime.start()`
9. Simulate inbound message from slack → session created → handler called → response emitted → slack adapter receives `SurfacePayload`
10. Simulate second message from web surface → session reactivated via touch → fanout to both surfaces
11. Call `runtime.stop()` — runtime drains in-flight handlers cleanly
12. Verify `runtime.status()` after stop reflects correct state

### Acceptance criteria

- Full end-to-end cycle passes in a single test with no external dependencies
- Assembly uses only `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces`
- Assembly pattern matches the canonical pattern from `docs/architecture/spec-reconciliation-rules.md §3b`
- The test passes without any cloud, network, or external dependency
- Package READMEs for core, sessions, and surfaces are updated with real API docs replacing placeholder text
- v1 release tag is prepared

---

## Open Routing Issues (gates product consumption of `@relay-assistant/routing`)

These must be resolved before routing is consumed by any product:

| Issue | File | Status |
| --- | --- | --- |
| F-1: routing test count is 12, DoD requires 40+ | `packages/routing/src/routing.test.ts` | **OPEN — blocking** |
| F-2: `escalated` flag incorrect on hard-constraint caps | `packages/routing/src/routing.ts` | **OPEN — blocking** |
| OQ-5: escalation tiebreaker (deepest mode wins) undocumented | `docs/specs/v1-routing-spec.md` | OPEN — moderate |

---

## Dependency Graph

```
[v1-core-spec]    ──→ WF-1 ──→ WF-2 ──┐
                                        ├──→ WF-4 ──┐
[v1-sessions-spec] → WF-3 ─────────────┘            ├──→ WF-6 ──→ WF-7
                                                     │
[v1-surfaces-spec] ──────────────────── WF-5 ────────┘
                                        ↑
                                      (WF-2 for types)
```

---

## Execution Order

| Step | Task | Depends on | Status |
| --- | --- | --- | --- |
| 0 | Apply Contradiction 1–3 resolutions to specs | — | **COMPLETE** |
| 1 | `docs/specs/v1-core-spec.md` | — | **DONE (`SPEC_RECONCILED`)** |
| 2 | `docs/specs/v1-sessions-spec.md` | — | **DONE** |
| 3 | `docs/specs/v1-surfaces-spec.md` | — | **DONE (`SPEC_RECONCILED`)** |
| 4 | Implement WF-1 | core spec | **COMPLETE** |
| 5 | Implement WF-3 | sessions spec | **COMPLETE** |
| 6 | Implement WF-2 | WF-1 | **COMPLETE** |
| 7 | Implement WF-4 | WF-2, WF-3 | **COMPLETE** |
| 8 | Implement WF-5 | surfaces spec, WF-2 (types) | **COMPLETE** |
| 9 | Implement WF-6 | WF-4, WF-5 | **COMPLETE** (`core-sessions-surfaces.test.ts`) |
| 10 | Implement WF-7 | WF-6 | **OPEN** — examples/src not yet created |
| 11 | Update package READMEs | WF-7 | **DONE** — core/sessions/surfaces READMEs are substantive |
| 12 | Tag v1 release | all above | **OPEN** |

---

## Package Structure Per Workflow

Each v1 package ships with this structure. Workflows write into it:

```
packages/<name>/
  package.json
  tsconfig.json
  src/
    index.ts        # public exports only
    types.ts        # all exported types and interfaces
    <name>.ts       # factory function and implementation
    <name>.test.ts  # unit tests per workflow
  README.md         # updated from placeholder in WF-7
```

Integration tests that span packages live in `packages/core/src/` or `packages/examples/src/` as the workflow scopes dictate.

---

## Reuse-First Rule

Before authoring a new package implementation workflow, agents should inspect `relay` and related AgentWorkforce repos for reusable packages, contracts, or runtime capabilities.

Specific instruction for memory:
- use the existing `@agent-relay/memory` package as the starting point
- treat `@relay-assistant/memory` as an assistant-facing integration/adaptation layer unless a clear gap requires new implementation work

This applies equally to proactive, policy, and any future packages. Investigation is not optional — it is the first step.

---

V1_WORKFLOW_BACKLOG_UPDATED


## Future Capability Note — Librarian / Cross-Agent Consolidation

A future **v5-v8 level** capability should add a librarian/night-crawler style system that consolidates memory across multiple agents. This is explicitly out of scope for the current v1 workflows, but current memory-related work should preserve provenance, confidence, and timestamp metadata so later consolidation remains possible.

---WEEKEND DELIVERY---
# Weekend Delivery Plan

Date: 2026-04-11
Revised: 2026-04-11 (spec-reconciliation pass — all examples updated to match canonical specs; workspace install note added)
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — implementation status reflected; workspace:* gap documented; traits/persona context added)
Target: 2026-04-13 (Sunday night)

> **Canonical source of truth:** Package specs in `docs/specs/` override any example code in this document. All assembly examples below have been updated to match the reviewed specs and `docs/architecture/spec-reconciliation-rules.md`. If a code example conflicts with a spec, **trust the spec, not this document**.

## Implementation Status as of 2026-04-11

**WF-1 through WF-5 are COMPLETE.** The core, sessions, and surfaces packages are implemented and passing tests. The weekend delivery goal was to produce stable v1 type contracts for Sage, MSD, and NightCTO to write product adapter code against. That goal is met.

| Package | Tests | Status |
| --- | --- | --- |
| `@relay-assistant/core` | 31 pass | COMPLETE |
| `@relay-assistant/sessions` | 25 pass | COMPLETE |
| `@relay-assistant/surfaces` | 28 pass | COMPLETE |

**WF-6 is COMPLETE.** `packages/core/src/core-sessions-surfaces.test.ts` (describe block labeled WF-6) covers multi-surface session attachment, fanout, targeted send, and detach behavior.

**WF-7 is OPEN.** The end-to-end assembly test in `packages/examples/src/` does not yet exist. Package READMEs for core (152 lines), sessions (118 lines), and surfaces (175 lines) are substantive — not placeholders. The v1 release tag is gated on the assembly test being written.

**Remaining open items:**
- `@relay-assistant/routing` has a blocking DoD failure (12 tests, 40+ required). Do not wire routing into product code until this is resolved.
- No root `package.json` or monorepo workspace config exists. The `workspace:*` protocol referenced below is the target pattern, not current reality. Use `npm pack` tarballs or path-based installs until a root workspace is configured.

---

## Goal

Sage, MSD, and NightCTO teams can `npm install @relay-assistant/core @relay-assistant/sessions @relay-assistant/surfaces` by Sunday night, with type contracts stable enough to write product adapter code against.

> **npm install note:** For v1, "npm install" means **local monorepo consumption** via workspace references (`"@relay-assistant/core": "workspace:*"`) or `npm pack` tarballs — not the public npm registry. Public publishing is a post-v1 task tracked separately.
>
> **Workspace config gap:** No root `package.json` with workspace configuration currently exists. Each package is independently installable. Until a workspace root is configured, consume packages via `npm pack` tarballs or local path references. This is tracked in the audit plan as D-5.

The v1 type contracts that are now stable:

- `AssistantDefinition` (core)
- `AssistantRuntime` (core)
- `InboundMessage` / `OutboundEvent` (core)
- `CapabilityHandler` / `CapabilityContext` (core)
- `Session` / `SessionStore` (sessions)
- `AffinityResolver` / `resolveSession` (sessions)
- `SurfaceRegistry` / `SurfaceConnection` / `SurfaceAdapter` (surfaces)
- `SurfaceCapabilities` / `SurfaceFormatHook` / `FanoutResult` (surfaces)

---

## Traits and Persona Context

Products using this SDK should understand the distinction between workforce personas and assistant traits before writing product adapter code.

**Workforce personas** are runtime execution profiles (model, harness, system prompt, service tier). These are defined and owned in Workforce infrastructure. They are not imported from this SDK.

**Assistant traits** are identity and behavioral characteristics (voice, style, vocabulary, proactivity level). The `@relay-assistant/traits` package is planned for v1.2. In v1, products define traits as local data objects and inject them manually into persona prompts and format hooks.

See [traits-and-persona-layer.md](../architecture/traits-and-persona-layer.md) for the full boundary definition.

---

## Timeline

### Saturday Morning (2026-04-12, first half)

**Status: COMPLETE (implementation already done)**

All three specs are already `IMPLEMENTATION_READY`. WF-1, WF-2, WF-3 implementations are done and passing.

| Task | Deliverable | Status |
| --- | --- | --- |
| Read and confirm core spec | Mental model of `AssistantDefinition`, `AssistantRuntime`, adapters | DONE |
| Read and confirm sessions spec | Mental model of `Session`, `SessionStore`, `InMemorySessionStoreAdapter` | DONE |
| Read and confirm surfaces spec | Mental model of `SurfaceRegistry`, `SurfaceConnection`, fanout vs targeted send | DONE |
| Scaffold `packages/core` | `package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts` | DONE |
| Scaffold `packages/sessions` | same | DONE |
| Scaffold `packages/surfaces` | same | DONE |

---

### Saturday Afternoon (2026-04-12, second half)

**Status: COMPLETE**

| Workflow | Package | Key output | Status |
| --- | --- | --- | --- |
| WF-1: Define assistant and start runtime | core | `createAssistant`, `AssistantDefinition` validation, `AssistantRuntime`, `runtime.start()` / `runtime.stop()`, `runtime.status()` | COMPLETE — 31 tests |
| WF-2: Handle inbound message via dispatch | core | Capability dispatch table, `runtime.dispatch()`, `AssistantHooks.onMessage` pre-filter, `runtime.emit()` | COMPLETE |
| WF-3: Create and manage sessions | sessions | `createSessionStore`, `InMemorySessionStoreAdapter`, full lifecycle (`touch`, `expire`, `sweepStale`), `attachSurface`, `detachSurface`, `resolveSession` | COMPLETE — 25 tests |

---

### Saturday Evening / Sunday Morning (2026-04-12 evening – 2026-04-13 morning)

**Status: COMPLETE**

| Workflow | Packages | Key output | Status |
| --- | --- | --- | --- |
| WF-4: Wire session store into runtime | core + sessions | `runtime.register('sessions', store)`, `runtime.get<SessionStore>('sessions')`, `resolveSession` in handler | COMPLETE |
| WF-5: Register surface registry and route messages | core + surfaces | `createSurfaceRegistry`, `SurfaceConnection`, adapter wiring as core relay adapters, inbound normalization, outbound targeted send, `formatHook` | COMPLETE — 28 tests |

---

### Sunday Afternoon (2026-04-13 afternoon)

**Status: UNCERTAIN — verify before marking complete**

| Workflow | Packages | Key output | Status |
| --- | --- | --- | --- |
| WF-6: Multi-surface session fanout | core + sessions + surfaces | Cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout rule validated | **COMPLETE** — `packages/core/src/core-sessions-surfaces.test.ts` |
| WF-7: End-to-end assembly | core + sessions + surfaces | Full inbound→session→handler→emit→format→adapter cycle, validated assembly, examples package | **OPEN** — `packages/examples/src/` not yet created |

---

### Sunday Night (2026-04-13)

**Status: OPEN — consumer readiness verification needed**

Each product team runs the consumer readiness checklist against the released packages:

- [ ] `npm install @relay-assistant/core @relay-assistant/sessions @relay-assistant/surfaces` (resolves via workspace protocol or local tarballs — not the public npm registry for v1)
- [ ] Define an assistant with `createAssistant(definition, adapters)` where `definition.capabilities` is `Record<string, CapabilityHandler>`
- [ ] Wire a `SessionStore` via `runtime.register('sessions', createSessionStore({ adapter }))`
- [ ] Register surfaces via `createSurfaceRegistry()` and wire it as the core relay adapter pair
- [ ] Handle `InboundMessage` through capability dispatch and emit `OutboundEvent` via `context.runtime.emit()`
- [ ] Return formatted responses to the originating surface via targeted send or fanout
- [ ] Write product adapter code against stable v1 types
- [ ] Run the SDK's own tests to verify correct integration

Tag v1 release once all checks pass.

---

## Product-Specific Adoption Paths

### Sage Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. Draft a memory adapter interface stub so v1.1 memory integration can start Monday.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define the Sage assistant identity using `createAssistant()`. Wire `createSessionStore({ adapter: new InMemorySessionStoreAdapter() })`. Register a Slack `SurfaceConnection` in a `SurfaceRegistry`. |
| Immediate after v1 | Begin adapter stub for `@relay-assistant/memory` (v1.1). Sage's existing memory patterns are the primary signal for the memory spec. |
| v1.1 gates | Full memory persistence across Sage sessions. Proactive follow-up engine. |
| v1.2 gates | `@relay-assistant/traits` — Sage is a primary extraction signal. Define local `sageTraits` object now so the v1.2 extraction has a concrete pattern to generalize from. |

**What stays in Sage for now:**
- Knowledge and workspace-specific prompt behavior
- Workforce persona definitions (model, harness, system prompt, tier) — these are workforce-owned, not SDK concerns
- Product-specific follow-up heuristics
- Slack-specific UI conventions and block kit templates
- Trait values (voice, style, vocabulary) — define as a local data object; `@relay-assistant/traits` ships at v1.2
- Memory retrieval logic (until v1.1 `@relay-assistant/memory` ships)

**Sage v1 minimum viable assembly:**

```ts
import { createAssistant } from "@relay-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@relay-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@relay-assistant/sessions";
import type { SessionStore } from "@relay-assistant/sessions";
import { createSurfaceRegistry } from "@relay-assistant/surfaces";
import type { SurfaceConnection, SurfaceCapabilities } from "@relay-assistant/surfaces";

// 1. Define the Sage assistant
const definition: AssistantDefinition = {
  id: "sage",
  name: "Sage",
  capabilities: {
    chat: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);

      // Sage domain handler — product-owned logic
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "...", // Sage-specific response
      });
    },
  },
};

// 2. Wire sessions
const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

// 3. Wire surfaces
const slackCapabilities: SurfaceCapabilities = {
  markdown: false,
  richBlocks: true,
  attachments: true,
  streaming: false,
  maxResponseLength: 3000,
};

const slackConnection: SurfaceConnection = {
  id: "sage-slack",
  type: "slack",
  state: "registered",
  capabilities: slackCapabilities,
  adapter: stubSlackAdapter, // provided by relay foundation or product code
  formatHook: (event, caps) => ({ blocks: [{ type: "section", text: event.text }] }),
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);

// 4. Create runtime and register subsystems
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});
runtime.register("sessions", sessionStore);

await runtime.start();
```

---

### MSD Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. MSD's cross-surface session design maps directly onto the v1 session model. Focus on the Slack + web multi-surface path.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define the MSD assistant identity. Wire session store. Register Slack and web surface connections in the surface registry. |
| After v1 | Stub `@relay-assistant/policy` interface for approval-mode scaffolding (policy ships in v2 but MSD can define the interface contract early as a passthrough). |
| v1.2 gates | Coordination for review orchestration. Policy for external action governance. |

**What stays in MSD for now:**
- Code review operations and PR workflows
- Review-specific orchestration logic
- PR-specific tools and heuristics
- Workforce persona definitions — owned by Workforce, not imported from SDK
- Coordinator delegation (until v1.2 `@relay-assistant/coordination` ships for product use)

**MSD v1 minimum viable assembly:**

```ts
import { createAssistant } from "@relay-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@relay-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@relay-assistant/sessions";
import type { SessionStore } from "@relay-assistant/sessions";
import { createSurfaceRegistry } from "@relay-assistant/surfaces";
import type { SurfaceConnection } from "@relay-assistant/surfaces";

const definition: AssistantDefinition = {
  id: "msd-review-assistant",
  name: "MSD",
  capabilities: {
    review: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);
      await store.attachSurface(session.id, message.surfaceId);

      // MSD review handler — product-owned logic

      // Targeted send: reply to originating surface
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "...", // MSD-specific response
      });

      // Session fanout: notify ALL attached surfaces (surfaceId absent, sessionId present)
      // await context.runtime.emit({
      //   sessionId: session.id,
      //   text: "PR review complete — notifying all attached surfaces",
      // });
    },
  },
};

const sessionStore = createSessionStore({ adapter: new InMemorySessionStoreAdapter() });

const slackConnection: SurfaceConnection = {
  id: "msd-slack",
  type: "slack",
  state: "registered",
  capabilities: { markdown: false, richBlocks: true, attachments: true, streaming: false, maxResponseLength: 3000 },
  adapter: stubSlackAdapter,
};

const webConnection: SurfaceConnection = {
  id: "msd-web",
  type: "web",
  state: "registered",
  capabilities: { markdown: true, richBlocks: false, attachments: false, streaming: true, maxResponseLength: 0 },
  adapter: stubWebAdapter,
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);
surfaceRegistry.register(webConnection);

const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});
runtime.register("sessions", sessionStore);

await runtime.start();
```

---

### NightCTO Adoption Path

---ROUTING README---
# @relay-assistant/routing

`@relay-assistant/routing` is the assistant-level routing package for model-selection policy. It implements the bounded v1 routing surface described in `docs/specs/v1-routing-spec.md`: cheap/fast/deep mode selection, abstract `ModelSpec` recommendations, per-thread cost tracking, latency-aware mode selection, and a narrow escalation hook for connectivity integration.

The package is TypeScript-first, provider-agnostic, and runnable in isolation. It does not call model providers, own transport, inspect user content, or import connectivity runtime code.

## Responsibilities

- Define the three Workforce-aligned routing modes: `cheap`, `fast`, `deep`
- Convert structured routing context into a `RoutingDecision`
- Track accumulated per-thread cost in memory
- Apply policy primitives for depth, latency, and cost envelopes
- Expose a clean `onEscalation()` hook that connectivity can call without handing routing ownership of signals or transports

## Non-Goals

- No provider SDK ownership
- No concrete model IDs
- No cloud assumptions
- No transport implementation
- No product-specific business logic
- No semantic message inspection

## Installation

```bash
cd packages/routing
npm install
```

## API

```ts
import { createRouter } from '@relay-assistant/routing';
```

### Core Types

- `RoutingMode`: `cheap | fast | deep`
- `RoutingPolicy`: assistant or capability-level routing policy
- `RoutingContext`: structured decision input for one invocation
- `RoutingDecision`: recommended mode plus the merged `ModelSpec`
- `RoutingEscalationHook`: connectivity-facing hook contract

### Default Mode Semantics

- `cheap`: minimize cost, typically small-tier and constrained features
- `fast`: default interactive mode, optimized for responsiveness
- `deep`: maximize depth/quality when latency and cost are secondary

## Usage

```ts
import { createRouter } from '@relay-assistant/routing';

const router = createRouter({
  policy: {
    defaultMode: 'fast',
    costEnvelopeLimit: 25,
    capabilityModes: {
      summarize: 'cheap',
      codegen: 'deep',
    },
    escalationModeMap: {
      'escalation.interrupt': 'deep',
      'escalation.review': 'fast',
    },
    modeModelSpecs: {
      cheap: {
        tier: 'small',
        hints: { workforceLane: 'cheap' },
      },
      fast: {
        tier: 'medium',
        hints: { workforceLane: 'fast' },
      },
      deep: {
        tier: 'large',
        hints: { workforceLane: 'deep' },
      },
    },
  },
});

const decision = router.decide({
  threadId: 'thread-123',
  capability: 'codegen',
  requestedMaxLatencyMs: 4000,
  requiresToolUse: true,
  minContextTokens: 24000,
});
```

## Decision Order

`router.decide()` applies routing rules in bounded priority order:

1. Caller-requested mode
2. Capability override
3. Cost envelope downgrade
4. Active escalation mapping
5. Latency constraint downgrade
6. Policy default
7. Hard ceiling cap over the selected candidate

If a selected mode exceeds `policy.modeCeiling`, the final decision is capped and marked with reason `hard_constraint`.

## Connectivity Boundary

Connectivity can integrate with routing by passing escalation signals into `router.onEscalation(signal)`. The routing package mirrors the minimal signal shape it needs:

- `signalClass`
- `priority`
- thread metadata fields for correlation

This keeps the integration explicit and narrow:

- connectivity owns signal lifecycle
- routing owns mapping signal classes to requested routing modes
- product code wires the two together

Example:

```ts
const requestedMode = router.onEscalation({
  id: 'sig-1',
  threadId: 'thread-123',
  source: 'connectivity',
  signalClass: 'escalation.interrupt',
  priority: 'critical',
  summary: 'Supervisor requested escalation',
});
```

## Cost Tracking

The router exposes in-memory helpers:

- `recordCost(threadId, cost)`
- `getAccumulatedCost(threadId)`
- `resetCost(threadId)`

`decide()` remains input-driven. Callers can pass `accumulatedCost` directly, or use the router’s bookkeeping methods and feed the current value back into the next decision.

## Testing

The package includes unit coverage for:

- default routing
- caller and capability overrides
- hard ceiling enforcement
- cost envelope downgrade
- escalation-driven routing
- latency constraint selection
- model-spec merging
- cost tracking
- connectivity hook behavior

Run:

```bash
cd packages/routing
npm test
```

ROUTING_PACKAGE_IMPLEMENTED

---COORDINATION README---
# `@relay-assistant/coordination`

`@relay-assistant/coordination` implements the bounded v1 many-agents-one-assistant runtime for Relay Agent Assistant. It provides a specialist registry, delegation plan validation, sequential coordinator execution, synthesis helpers, and clean integration with `@relay-assistant/connectivity` for handoffs, conflicts, and escalations.

## Scope

This package owns:

- specialist registration and lookup
- delegation plan validation and bounded execution
- coordinator lifecycle for one in-memory coordination turn
- synthesis of multiple specialist outputs into one assistant-facing result
- consumption of connectivity signals during delegation without taking over connectivity itself

This package does not own:

- routing policy or model selection
- memory retrieval or persistence
- surface formatting or delivery
- transport, relaycast, queues, or cross-process orchestration
- product-specific specialist lineups or dispatch heuristics

## Install Shape

The package is TypeScript-first and builds to `dist/`.

```ts
import {
  createCoordinator,
  createDelegationPlan,
  createSpecialistRegistry,
  createSynthesizer,
  validateDelegationPlan,
} from '@relay-assistant/coordination';
```

## Core Concepts

### Specialist registry

Products register their own specialists. The package only enforces uniqueness and lookup.

```ts
const registry = createSpecialistRegistry();

registry.register({
  name: 'researcher',
  description: 'Collects relevant evidence',
  capabilities: ['research'],
  handler: {
    async execute(instruction, context) {
      return {
        specialistName: 'researcher',
        output: `Evidence for: ${instruction}`,
        status: 'complete',
      };
    },
  },
});
```

### Delegation plan

Plans are ordered and sequential in v1.

`createDelegationPlan()` is a validating factory: it throws if the structure is invalid
or if any step references an unknown registered specialist. If a product needs to
construct a plan before registry population, it can build a raw `DelegationPlan`
object and call `validateDelegationPlan()` later.

```ts
const plan = createDelegationPlan(
  {
    intent: 'produce one coherent answer',
    steps: [
      { specialistName: 'researcher', instruction: 'gather evidence' },
      { specialistName: 'writer', instruction: 'write final answer' },
    ],
  },
  registry,
);
```

### Coordinator

The coordinator validates the plan, executes each step in order, observes connectivity signals on the turn thread, and synthesizes a final output.

```ts
import { createConnectivityLayer } from '@relay-assistant/connectivity';

const connectivity = createConnectivityLayer();

const coordinator = createCoordinator({
  registry,
  connectivity,
  synthesis: { strategy: 'last-wins' },
});

const turn = await coordinator.execute(plan);
console.log(turn.output.text);
```

## Connectivity Boundary

Coordination depends on `@relay-assistant/connectivity` as a signaling substrate only.

What coordination does with connectivity:

- passes the connectivity layer into each specialist context
- registers a per-turn selected-audience resolver scoped to the plan participants
- observes per-turn signals such as `handoff.ready`, `confidence.blocker`, `conflict.active`, and `escalation.interrupt`
- resolves consumable signals after synthesis or coordinator action
- exposes the observed signal set on the returned coordination turn

What coordination does not do:

- choose routing modes
- import or call the routing package
- own transport delivery for signals
- persist signal history outside the in-memory layer supplied by the consumer

## Synthesis

v1 includes three synthesis modes:

- `concatenate`
- `last-wins`
- `custom`

`custom` requires a function and keeps product-specific output shaping outside the package core.

## Failure Model

v1 execution is intentionally simple:

- steps run sequentially
- optional step failures are skipped and degrade output quality instead of aborting the whole turn
- `confidence.blocker` and `escalation.interrupt` halt the turn
- unresolved conflicts degrade synthesis quality but do not introduce routing or policy ownership

## Development

Run inside `packages/coordination`:

```sh
npm install
npm test
npm run build
```

The test suite covers the intended first workflows:

- registry and delegation plan validation
- sequential specialist handoff
- optional-step degradation
- blocker interruption
- conflict detection and resolution

COORDINATION_PACKAGE_IMPLEMENTED
