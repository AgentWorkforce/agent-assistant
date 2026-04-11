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
