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

---COORDINATION HARDENING REVIEW---
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

---ROUTING TYPES---
export type RoutingMode = 'cheap' | 'fast' | 'deep';

export type ModelTier = 'small' | 'medium' | 'large' | 'frontier' | string;

export interface ModelSpec {
  mode: RoutingMode;
  tier: ModelTier;
  requiresToolUse: boolean;
  requiresStreaming: boolean;
  minContextTokens: number;
  maxLatencyMs: number;
  hints: Record<string, unknown>;
}

export interface EscalationSummary {
  signalClass: string;
  priority: string;
  requestedMode?: string;
}

export interface RoutingContext {
  threadId: string;
  capability: string;
  accumulatedCost?: number;
  requestedMaxLatencyMs?: number;
  requiresToolUse?: boolean;
  requiresStreaming?: boolean;
  minContextTokens?: number;
  activeEscalations?: EscalationSummary[];
  requestedMode?: RoutingMode;
}

export type RoutingReason =
  | 'policy_default'
  | 'capability_override'
  | 'escalation_signal'
  | 'cost_envelope_exceeded'
  | 'latency_constraint'
  | 'caller_requested'
  | 'hard_constraint';

export interface RoutingDecision {
  mode: RoutingMode;
  modelSpec: ModelSpec;
  reason: RoutingReason;
  escalated: boolean;
  overridden: boolean;
}

export interface RoutingPolicy {
  defaultMode?: RoutingMode;
  capabilityModes?: Record<string, RoutingMode>;
  costEnvelopeLimit?: number;
  modeCeiling?: RoutingMode;
  escalationModeMap?: Partial<Record<string, RoutingMode>>;
  modeModelSpecs?: Partial<Record<RoutingMode, Partial<ModelSpec>>>;
}

export interface ConnectivityEscalationSignal {
  id: string;
  threadId: string;
  source: string;
  signalClass: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  summary: string;
}

export type RequestedRoutingMode = RoutingMode;

export interface RoutingEscalationHook {
  onEscalation(signal: ConnectivityEscalationSignal): RequestedRoutingMode | void;
}

export interface Router extends RoutingEscalationHook {
  decide(context: RoutingContext): RoutingDecision;
  recordCost(threadId: string, cost: number): void;
  getAccumulatedCost(threadId: string): number;
  resetCost(threadId: string): void;
}

export interface RouterConfig {
  policy?: RoutingPolicy;
  defaultModelSpecs?: Partial<Record<RoutingMode, Partial<ModelSpec>>>;
}

export const ROUTING_MODES = ['cheap', 'fast', 'deep'] as const;
export const MODEL_TIERS = ['small', 'medium', 'large', 'frontier'] as const;
export const ROUTING_REASONS = [
  'policy_default',
  'capability_override',
  'escalation_signal',
  'cost_envelope_exceeded',
  'latency_constraint',
  'caller_requested',
  'hard_constraint',
] as const;

export const MODE_DEPTH: Record<RoutingMode, number> = {
  cheap: 0,
  fast: 1,
  deep: 2,
};

export const DEFAULT_MODE_SPECS: Record<RoutingMode, ModelSpec> = {
  cheap: {
    mode: 'cheap',
    tier: 'small',
    requiresToolUse: false,
    requiresStreaming: false,
    minContextTokens: 0,
    maxLatencyMs: 0,
    hints: {},
  },
  fast: {
    mode: 'fast',
    tier: 'medium',
    requiresToolUse: true,
    requiresStreaming: true,
    minContextTokens: 16000,
    maxLatencyMs: 5000,
    hints: {},
  },
  deep: {
    mode: 'deep',
    tier: 'large',
    requiresToolUse: true,
    requiresStreaming: true,
    minContextTokens: 64000,
    maxLatencyMs: 0,
    hints: {},
  },
};

export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}

export class RoutingPolicyError extends RoutingError {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingPolicyError';
  }
}

---ROUTING IMPLEMENTATION---
import {
  DEFAULT_MODE_SPECS,
  MODE_DEPTH,
  RoutingPolicyError,
  type ConnectivityEscalationSignal,
  type EscalationSummary,
  type ModelSpec,
  type Router,
  type RouterConfig,
  type RoutingContext,
  type RoutingDecision,
  type RoutingMode,
  type RoutingPolicy,
  type RoutingReason,
} from './types.js';

type NormalizedRoutingPolicy = Required<
  Pick<
    RoutingPolicy,
    'defaultMode' | 'capabilityModes' | 'costEnvelopeLimit' | 'modeCeiling' | 'escalationModeMap'
  >
> & {
  modeModelSpecs: Partial<Record<RoutingMode, Partial<ModelSpec>>>;
};

type DecisionCandidate = {
  mode: RoutingMode;
  reason: RoutingReason;
  escalated: boolean;
};

export function createRouter(config: RouterConfig = {}): Router {
  const policy = normalizePolicy(config.policy);
  const defaultModelSpecs = normalizeDefaultModelSpecs(config.defaultModelSpecs);
  const costMap = new Map<string, number>();

  return {
    decide(context) {
      const decision = resolveDecisionCandidate(context, policy, defaultModelSpecs);
      const modelSpec = buildModelSpec(decision.mode, context, policy, defaultModelSpecs);

      return {
        mode: decision.mode,
        modelSpec,
        reason: decision.reason,
        escalated: decision.escalated,
        overridden: decision.reason === 'hard_constraint',
      };
    },

    recordCost(threadId, cost) {
      if (!threadId) {
        throw new RoutingPolicyError('threadId is required when recording cost');
      }

      if (!Number.isFinite(cost)) {
        throw new RoutingPolicyError('cost must be a finite number');
      }

      costMap.set(threadId, (costMap.get(threadId) ?? 0) + cost);
    },

    getAccumulatedCost(threadId) {
      return costMap.get(threadId) ?? 0;
    },

    resetCost(threadId) {
      costMap.delete(threadId);
    },

    onEscalation(signal) {
      if (!signal.signalClass.startsWith('escalation.')) {
        return undefined;
      }

      const mappedMode = policy.escalationModeMap[signal.signalClass];
      if (!mappedMode) {
        return undefined;
      }

      return clampMode(mappedMode, policy.modeCeiling);
    },
  };
}

function normalizePolicy(policy: RoutingPolicy = {}): NormalizedRoutingPolicy {
  const defaultMode = policy.defaultMode ?? 'fast';
  const modeCeiling = policy.modeCeiling ?? 'deep';

  validateMode(defaultMode, 'policy.defaultMode');
  validateMode(modeCeiling, 'policy.modeCeiling');

  for (const [capability, mode] of Object.entries(policy.capabilityModes ?? {})) {
    validateMode(mode, `policy.capabilityModes.${capability}`);
  }

  for (const [signalClass, mode] of Object.entries(policy.escalationModeMap ?? {})) {
    if (mode !== undefined) {
      validateMode(mode, `policy.escalationModeMap.${signalClass}`);
    }
  }

  for (const [mode, spec] of Object.entries(policy.modeModelSpecs ?? {})) {
    validateMode(mode, `policy.modeModelSpecs.${mode}`);
    validateModelSpecOverride(spec, `policy.modeModelSpecs.${mode}`);
  }

  if (
    policy.costEnvelopeLimit !== undefined &&
    (!Number.isFinite(policy.costEnvelopeLimit) || policy.costEnvelopeLimit < 0)
  ) {
    throw new RoutingPolicyError('policy.costEnvelopeLimit must be a finite number >= 0');
  }

  return {
    defaultMode,
    capabilityModes: { ...(policy.capabilityModes ?? {}) },
    costEnvelopeLimit: policy.costEnvelopeLimit ?? 0,
    modeCeiling,
    escalationModeMap: { ...(policy.escalationModeMap ?? {}) },
    modeModelSpecs: cloneModeModelSpecs(policy.modeModelSpecs),
  };
}

function normalizeDefaultModelSpecs(
  specs: RouterConfig['defaultModelSpecs'],
): Record<RoutingMode, ModelSpec> {
  const normalized = cloneDefaultSpecs(DEFAULT_MODE_SPECS);

  if (!specs) {
    return normalized;
  }

  for (const [mode, override] of Object.entries(specs)) {
    validateMode(mode, `defaultModelSpecs.${mode}`);
    validateModelSpecOverride(override, `defaultModelSpecs.${mode}`);
    normalized[mode] = mergeModelSpec(normalized[mode], override);
  }

  return normalized;
}

function resolveDecisionCandidate(
  context: RoutingContext,
  policy: NormalizedRoutingPolicy,
  defaultModelSpecs: Record<RoutingMode, ModelSpec>,
): DecisionCandidate {
  if (context.requestedMode) {
    validateMode(context.requestedMode, 'context.requestedMode');
  }

  let candidate: DecisionCandidate;

  if (context.requestedMode) {
    candidate = {
      mode: context.requestedMode,
      reason: 'caller_requested',
      escalated: false,
    };
  } else {
    const capabilityMode = policy.capabilityModes[context.capability];
    if (capabilityMode) {
      candidate = {
        mode: capabilityMode,
        reason: 'capability_override',
        escalated: false,
      };
    } else if (
      policy.costEnvelopeLimit > 0 &&
      (context.accumulatedCost ?? 0) > policy.costEnvelopeLimit
    ) {
      candidate = {
        mode: 'cheap',
        reason: 'cost_envelope_exceeded',
        escalated: false,
      };
    } else {
      const escalationMode = pickEscalationMode(context.activeEscalations, policy);
      if (escalationMode) {
        candidate = {
          mode: escalationMode,
          reason: 'escalation_signal',
          escalated: true,
        };
      } else {
        const latencyMode = pickLatencyMode(context, policy, defaultModelSpecs);
        if (latencyMode) {
          candidate = {
            mode: latencyMode,
            reason: 'latency_constraint',
            escalated: false,
          };
        } else {
          candidate = {
            mode: policy.defaultMode,
            reason: 'policy_default',
            escalated: false,
          };
        }
      }
    }
  }

  if (MODE_DEPTH[candidate.mode] > MODE_DEPTH[policy.modeCeiling]) {
    return {
      mode: policy.modeCeiling,
      reason: 'hard_constraint',
      escalated: candidate.escalated || MODE_DEPTH[candidate.mode] > MODE_DEPTH[policy.modeCeiling],
    };
  }

  return candidate;
}

function pickEscalationMode(
  escalations: RoutingContext['activeEscalations'],
  policy: NormalizedRoutingPolicy,
): RoutingMode | null {
  if (!escalations?.length) {
    return null;
  }

  let selected: { mode: RoutingMode; priority: number } | null = null;

  for (const escalation of escalations) {
    const mappedMode = policy.escalationModeMap[escalation.signalClass];
    if (!mappedMode) {
      continue;
    }

    const priority = getPriorityDepth(escalation.priority);
    if (!selected) {
      selected = { mode: mappedMode, priority };
      continue;
    }

    const isHigherPriority = priority > selected.priority;
    const samePriorityButDeeper = priority === selected.priority && MODE_DEPTH[mappedMode] > MODE_DEPTH[selected.mode];

    if (isHigherPriority || samePriorityButDeeper) {
      selected = { mode: mappedMode, priority };
    }
  }

  return selected?.mode ?? null;
}

function pickLatencyMode(
  context: RoutingContext,
  policy: NormalizedRoutingPolicy,
  defaultModelSpecs: Record<RoutingMode, ModelSpec>,
): RoutingMode | null {
  const requestedMaxLatencyMs = context.requestedMaxLatencyMs ?? 0;
  if (requestedMaxLatencyMs <= 0) {
    return null;
  }

  const deepSpec = getBaseModelSpec('deep', policy, defaultModelSpecs);
  if (canMeetLatency(deepSpec.maxLatencyMs, requestedMaxLatencyMs)) {
    return null;
  }

  const fastSpec = getBaseModelSpec('fast', policy, defaultModelSpecs);
  if (canMeetLatency(fastSpec.maxLatencyMs, requestedMaxLatencyMs)) {
    return 'fast';
  }

  return 'cheap';
}

function buildModelSpec(
  mode: RoutingMode,
  context: RoutingContext,
  policy: NormalizedRoutingPolicy,
  defaultModelSpecs: Record<RoutingMode, ModelSpec>,
): ModelSpec {
  let spec = getBaseModelSpec(mode, policy, defaultModelSpecs);

  if (context.requiresToolUse) {
    spec.requiresToolUse = true;
  }

  if (context.requiresStreaming) {
    spec.requiresStreaming = true;
  }

  if (context.minContextTokens !== undefined) {
    spec.minContextTokens = Math.max(spec.minContextTokens, context.minContextTokens);
  }

  if (context.requestedMaxLatencyMs !== undefined) {
    spec.maxLatencyMs = context.requestedMaxLatencyMs;
  }

  return spec;
}

function getBaseModelSpec(
  mode: RoutingMode,
  policy: NormalizedRoutingPolicy,
  defaultModelSpecs: Record<RoutingMode, ModelSpec>,
): ModelSpec {
  return mergeModelSpec(defaultModelSpecs[mode], policy.modeModelSpecs[mode]);
}

function mergeModelSpec(base: ModelSpec, override: Partial<ModelSpec> | undefined): ModelSpec {
  if (!override) {
    return {
      ...base,
      hints: { ...base.hints },
    };
  }

  return {
    ...base,
    ...override,
    mode: base.mode,
    hints: {
      ...base.hints,
      ...(override.hints ?? {}),
    },
  };
}

function cloneDefaultSpecs(source: Record<RoutingMode, ModelSpec>): Record<RoutingMode, ModelSpec> {
  return {
    cheap: mergeModelSpec(source.cheap, undefined),
    fast: mergeModelSpec(source.fast, undefined),
    deep: mergeModelSpec(source.deep, undefined),
  };
}

function cloneModeModelSpecs(
  specs: RoutingPolicy['modeModelSpecs'],
): Partial<Record<RoutingMode, Partial<ModelSpec>>> {
  if (!specs) {
    return {};
  }

  const clone: Partial<Record<RoutingMode, Partial<ModelSpec>>> = {};
  for (const [mode, spec] of Object.entries(specs)) {
    validateMode(mode, `policy.modeModelSpecs.${mode}`);
    if (!spec) {
      clone[mode] = spec;
      continue;
    }

    clone[mode] = spec.hints
      ? { ...spec, hints: { ...spec.hints } }
      : { ...spec };
  }

  return clone;
}

function clampMode(mode: RoutingMode, ceiling: RoutingMode): RoutingMode {
  return MODE_DEPTH[mode] > MODE_DEPTH[ceiling] ? ceiling : mode;
}

function canMeetLatency(specLatency: number, requestedLatency: number): boolean {

---COORDINATION TYPES---
import type {
  ConnectivityLayer,
  ConnectivitySignal,
} from '@relay-assistant/connectivity';

export type SpecialistExecutionStatus = 'complete' | 'partial' | 'failed';
export type SynthesisStrategy = 'concatenate' | 'last-wins' | 'custom';
export type SynthesisQuality = 'complete' | 'degraded';

export interface SpecialistDefinition {
  name: string;
  description: string;
  capabilities: string[];
}

export interface SpecialistResult {
  specialistName: string;
  output: string;
  confidence?: number;
  status: SpecialistExecutionStatus;
  metadata?: Record<string, unknown>;
}

export interface SpecialistContext {
  turnId: string;
  threadId: string;
  stepIndex: number;
  plan: DelegationPlan;
  priorResults: SpecialistResult[];
  connectivity: ConnectivityLayer;
}

export interface SpecialistHandler {
  execute(instruction: string, context: SpecialistContext): Promise<SpecialistResult>;
}

export interface Specialist extends SpecialistDefinition {
  handler: SpecialistHandler;
}

export interface SpecialistRegistry {
  register(specialist: Specialist): void;
  unregister(name: string): void;
  get(name: string): Specialist | null;
  list(): Specialist[];
  has(name: string): boolean;
}

export interface DelegationStep {
  specialistName: string;
  instruction: string;
  optional?: boolean;
}

export interface DelegationPlan {
  intent: string;
  steps: DelegationStep[];
}

export interface DelegationPlanValidation {
  valid: boolean;
  errors: string[];
}

export interface SynthesisOutput {
  text: string;
  contributingSpecialists: string[];
  quality: SynthesisQuality;
}

export interface SynthesisConfig {
  strategy: SynthesisStrategy;
  customFn?: (results: SpecialistResult[], plan: DelegationPlan) => SynthesisOutput;
}

export interface Synthesizer {
  synthesize(results: SpecialistResult[], plan: DelegationPlan): SynthesisOutput;
}

export interface CoordinationSignals {
  observed: ConnectivitySignal[];
  handoffs: ConnectivitySignal[];
  escalations: ConnectivitySignal[];
  unresolvedConflicts: ConnectivitySignal[];
}

export interface CoordinationTurn {
  turnId: string;
  threadId: string;
  plan: DelegationPlan;
  results: SpecialistResult[];
  output: SynthesisOutput;
  skippedSteps: DelegationStep[];
  signals: CoordinationSignals;
}

export interface CoordinatorConfig {
  registry: SpecialistRegistry;
  connectivity: ConnectivityLayer;
  synthesis: SynthesisConfig;
  maxSteps?: number;
}

export interface Coordinator {
  execute(plan: DelegationPlan): Promise<CoordinationTurn>;
}

export class CoordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinationError';
  }
}

export class SpecialistConflictError extends CoordinationError {
  constructor(name: string) {
    super(`Specialist already registered: ${name}`);
    this.name = 'SpecialistConflictError';
  }
}

export class SpecialistNotFoundError extends CoordinationError {
  constructor(name: string) {
    super(`Specialist not found: ${name}`);
    this.name = 'SpecialistNotFoundError';
  }
}

export class DelegationPlanError extends CoordinationError {
  constructor(message: string) {
    super(message);
    this.name = 'DelegationPlanError';
  }
}

export class SynthesisError extends CoordinationError {
  constructor(message: string) {
    super(message);
    this.name = 'SynthesisError';
  }
}

export class CoordinationBlockedError extends CoordinationError {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinationBlockedError';
  }
}

---COORDINATION IMPLEMENTATION---
import { nanoid } from 'nanoid';

import type { ConnectivitySignal, SignalCallback } from '@relay-assistant/connectivity';

import {
  CoordinationBlockedError,
  CoordinationError,
  DelegationPlanError,
  SpecialistConflictError,
  SpecialistNotFoundError,
  SynthesisError,
} from './types.js';
import type {
  CoordinationSignals,
  CoordinationTurn,
  Coordinator,
  CoordinatorConfig,
  DelegationPlan,
  DelegationPlanValidation,
  Specialist,
  SpecialistRegistry,
  SpecialistResult,
  Synthesizer,
  SynthesisConfig,
  SynthesisOutput,
} from './types.js';

const DEFAULT_MAX_STEPS = 10;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return error.message;
  }

  return 'Unknown specialist execution failure';
}

function clonePlan(plan: DelegationPlan): DelegationPlan {
  return {
    intent: plan.intent,
    steps: plan.steps.map((step) => ({ ...step })),
  };
}

function cloneResult(result: SpecialistResult): SpecialistResult {
  return {
    specialistName: result.specialistName,
    output: result.output,
    status: result.status,
    ...(result.confidence === undefined ? {} : { confidence: result.confidence }),
    ...(result.metadata === undefined ? {} : { metadata: { ...result.metadata } }),
  };
}

function ensureConfidence(confidence: number | undefined): number | undefined {
  if (confidence === undefined) {
    return undefined;
  }

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new CoordinationError('Specialist result confidence must be between 0.0 and 1.0');
  }

  return confidence;
}

function normalizeSpecialistResult(
  specialistName: string,
  result: SpecialistResult,
): SpecialistResult {
  if (!isNonEmptyString(result.output) && result.status !== 'failed') {
    throw new CoordinationError(
      `Specialist ${specialistName} returned an empty output for a non-failed result`,
    );
  }

  const confidence = ensureConfidence(result.confidence);

  return {
    specialistName,
    output: result.output,
    status: result.status,
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function collectSignals(
  observedSignals: ConnectivitySignal[],
  threadId: string,
): CoordinationSignals {
  const relevant = observedSignals.filter((signal) => signal.threadId === threadId);
  const handoffs = relevant.filter((signal) => signal.messageClass === 'handoff');
  const escalations = relevant.filter((signal) => signal.messageClass === 'escalation');
  const unresolvedConflicts = relevant.filter(
    (signal) => signal.signalClass === 'conflict.active' && signal.state !== 'superseded',
  );

  return {
    observed: relevant,
    handoffs,
    escalations,
    unresolvedConflicts,
  };
}

function resolveSignals(
  coordinatorConfig: CoordinatorConfig,
  signals: ConnectivitySignal[],
): void {
  for (const signal of signals) {
    if (signal.state === 'resolved' || signal.state === 'superseded' || signal.state === 'expired') {
      continue;
    }

    if (signal.signalClass === 'conflict.active') {
      continue;
    }

    coordinatorConfig.connectivity.resolve(signal.id);
  }
}

export function createSpecialistRegistry(): SpecialistRegistry {
  const specialists = new Map<string, Specialist>();

  return {
    register(specialist) {
      if (!isNonEmptyString(specialist.name)) {
        throw new CoordinationError('Specialist name must be a non-empty string');
      }

      if (specialists.has(specialist.name)) {
        throw new SpecialistConflictError(specialist.name);
      }

      specialists.set(specialist.name, specialist);
    },

    unregister(name) {
      specialists.delete(name);
    },

    get(name) {
      return specialists.get(name) ?? null;
    },

    list() {
      return [...specialists.values()];
    },

    has(name) {
      return specialists.has(name);
    },
  };
}

export function validateDelegationPlan(
  plan: DelegationPlan,
  registry: SpecialistRegistry,
  maxSteps = DEFAULT_MAX_STEPS,
): DelegationPlanValidation {
  const errors: string[] = [];

  if (!isNonEmptyString(plan.intent)) {
    errors.push('plan.intent must be a non-empty string');
  }

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('plan.steps must contain at least one step');
  }

  if (plan.steps.length > maxSteps) {
    errors.push(`plan.steps exceeds maxSteps (${maxSteps})`);
  }

  for (const [index, step] of plan.steps.entries()) {
    if (!isNonEmptyString(step.specialistName)) {
      errors.push(`plan.steps[${index}].specialistName must be a non-empty string`);
      continue;
    }

    if (!registry.has(step.specialistName)) {
      errors.push(`plan.steps[${index}] references unknown specialist ${step.specialistName}`);
    }

    if (!isNonEmptyString(step.instruction)) {
      errors.push(`plan.steps[${index}].instruction must be a non-empty string`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates a validated delegation plan. Throws DelegationPlanError if any step
 * references an unknown specialist or if the plan structure is invalid.
 *
 * To construct a plan without validation (for example, before registry
 * population), use the DelegationPlan interface directly and validate later
 * with validateDelegationPlan().
 */
export function createDelegationPlan(
  plan: DelegationPlan,
  registry: SpecialistRegistry,
  maxSteps = DEFAULT_MAX_STEPS,
): DelegationPlan {
  const validation = validateDelegationPlan(plan, registry, maxSteps);

  if (!validation.valid) {
    throw new DelegationPlanError(validation.errors.join('; '));
  }

  return clonePlan(plan);
}

export function createSynthesizer(config: SynthesisConfig): Synthesizer {
  return {
    synthesize(results, plan) {
      const usableResults = results.filter((result) => result.status !== 'failed');

      if (config.strategy === 'custom') {
        if (!config.customFn) {
          throw new SynthesisError('customFn is required when strategy is custom');
        }

        return config.customFn(usableResults.map(cloneResult), clonePlan(plan));
      }

      if (usableResults.length === 0) {
        return {
          text: '',
          contributingSpecialists: [],
          quality: 'degraded',
        };
      }

      const contributingSpecialists = usableResults.map((result) => result.specialistName);
      const quality =
        usableResults.length === plan.steps.length &&
        usableResults.every((result) => result.status === 'complete')
          ? 'complete'
          : 'degraded';

      if (config.strategy === 'last-wins') {
        const lastResult = usableResults[usableResults.length - 1];
        if (!lastResult) {
          throw new SynthesisError('last-wins synthesis requires at least one result');
        }

        return {
          text: lastResult.output,
          contributingSpecialists,
          quality,
        };
      }

      return {
        text: usableResults.map((result) => result.output).join('\n\n'),
        contributingSpecialists,
        quality,
      };
    },
  };
}

export function createCoordinator(config: CoordinatorConfig): Coordinator {
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;

  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new CoordinationError('maxSteps must be a positive integer');
  }

  const synthesizer = createSynthesizer(config.synthesis);

  return {
    async execute(plan): Promise<CoordinationTurn> {
      const normalizedPlan = createDelegationPlan(plan, config.registry, maxSteps);
      const turnId = `coord_${nanoid()}`;
      const threadId = turnId;
      const results: SpecialistResult[] = [];
      const skippedSteps: DelegationPlan['steps'] = [];
      const observedSignals: ConnectivitySignal[] = [];

      const callback: SignalCallback = (signal) => {
        if (signal.threadId === threadId) {
          observedSignals.push(signal);
        }
      };

      config.connectivity.registerSelectedResolver((signal) => {
        return normalizedPlan.steps
          .map((step) => step.specialistName)
          .filter((name) => name !== signal.source);
      });

      config.connectivity.onSignal(callback);

      try {
        for (const [stepIndex, step] of normalizedPlan.steps.entries()) {
          const specialist = config.registry.get(step.specialistName);
          if (!specialist) {
            throw new SpecialistNotFoundError(step.specialistName);
          }

          try {
            const rawResult = await specialist.handler.execute(step.instruction, {
              turnId,
              threadId,
              stepIndex,
              plan: normalizedPlan,
              priorResults: results.map(cloneResult),
              connectivity: config.connectivity,
            });
            const result = normalizeSpecialistResult(specialist.name, rawResult);
            results.push(result);
          } catch (error) {
            const failure: SpecialistResult = {
              specialistName: specialist.name,
              output: normalizeErrorMessage(error),
              status: 'failed',
            };
            results.push(failure);

            if (step.optional) {
              skippedSteps.push({ ...step });
            } else {
              throw new CoordinationError(
                `Specialist ${specialist.name} failed: ${failure.output}`,
              );
            }
          }

          const activeSignals = config.connectivity.query({
            threadId,
            source: specialist.name,
            state: ['emitted', 'active'],
          });

          const blocker = activeSignals.find((signal) => signal.signalClass === 'confidence.blocker');
          if (blocker) {
            resolveSignals(config, [blocker]);
            if (step.optional) {
              skippedSteps.push({ ...step });
              config.connectivity.advanceStep(threadId);
              continue;
            }

            throw new CoordinationBlockedError(
              `Specialist ${specialist.name} reported a blocker: ${blocker.summary}`,
            );
          }

          const interrupt = activeSignals.find(
            (signal) => signal.signalClass === 'escalation.interrupt',
          );
          if (interrupt) {
            resolveSignals(config, [interrupt]);
            throw new CoordinationBlockedError(
              `Coordination interrupted by ${specialist.name}: ${interrupt.summary}`,
            );
          }

          config.connectivity.advanceStep(threadId);
        }

        const output = synthesizer.synthesize(results, normalizedPlan);
        const allSignals = config.connectivity.query({
          threadId,
          state: ['emitted', 'active', 'resolved', 'superseded'],
          order: 'oldest',
          limit: 500,
        });

        resolveSignals(config, allSignals);

        const signals = collectSignals(
          config.connectivity.query({
            threadId,
            state: ['emitted', 'active', 'resolved', 'superseded', 'expired'],
            order: 'oldest',
            limit: 500,
          }),
          threadId,
        );

        const effectiveOutput: SynthesisOutput =
          signals.unresolvedConflicts.length > 0 && output.quality === 'complete'
            ? { ...output, quality: 'degraded' }
            : output;

        return {
          turnId,
          threadId,
          plan: normalizedPlan,
          results,
          output: effectiveOutput,
          skippedSteps,
          signals,
        };
      } finally {
        config.connectivity.offSignal(callback);
      }
    },
  };
}

---CONNECTIVITY TYPES---
export type SignalAudience = 'self' | 'coordinator' | 'selected' | 'all';

export type MessageClass =
  | 'attention'
  | 'confidence'
  | 'conflict'
  | 'handoff'
  | 'escalation';

export type SignalClass =
  | 'attention.raise'
  | 'confidence.high'
  | 'confidence.medium'
  | 'confidence.low'
  | 'confidence.blocker'
  | 'conflict.active'
  | 'conflict.resolved'
  | 'handoff.ready'
  | 'handoff.partial'
  | 'escalation.interrupt'
  | 'escalation.uncertainty';

export type SignalPriority = 'low' | 'normal' | 'high' | 'critical';
export type SignalState = 'emitted' | 'active' | 'superseded' | 'expired' | 'resolved';
export type SignalEvent = 'emitted' | 'superseded' | 'resolved' | 'expired';
export type RequestedRoutingMode = 'cheap' | 'fast' | 'deep';

export interface ConnectivitySignal {
  id: string;
  threadId: string;
  source: string;
  audience: SignalAudience;
  messageClass: MessageClass;
  signalClass: SignalClass;
  priority: SignalPriority;
  confidence?: number;
  summary: string;
  details?: string;
  replaces?: string;
  expiresAtStep?: number;
  emittedAt: string;
  state: SignalState;
}

export interface EmitSignalInput {
  threadId: string;
  source: string;
  audience: SignalAudience;
  messageClass: MessageClass;
  signalClass: SignalClass;
  priority: SignalPriority;
  summary: string;
  confidence?: number;
  details?: string;
  replaces?: string;
  expiresAtStep?: number;
}

export interface SignalQuery {
  threadId: string;
  source?: string;
  messageClass?: MessageClass | MessageClass[];
  signalClass?: SignalClass | SignalClass[];
  state?: SignalState | SignalState[];
  priority?: SignalPriority | SignalPriority[];
  since?: string;
  before?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
}

export interface SuppressionConfig {
  basis: 'step' | 'time';
  windowMs?: number;
}

export interface RoutingEscalationHook {
  onEscalation(signal: ConnectivitySignal): RequestedRoutingMode | void;
}

export type SelectedAudienceResolver = (signal: ConnectivitySignal) => string[];
export type SignalCallback = (signal: ConnectivitySignal, event: SignalEvent) => void;

export interface ConnectivityLayerConfig {
  suppressionConfig?: SuppressionConfig;
  routingEscalationHook?: RoutingEscalationHook;
}

export interface ConnectivityLayer {
  emit(input: EmitSignalInput): ConnectivitySignal;
  resolve(signalId: string): ConnectivitySignal;
  get(signalId: string): ConnectivitySignal | null;
  query(query: SignalQuery): ConnectivitySignal[];
  advanceStep(threadId: string): void;
  registerSelectedResolver(resolver: SelectedAudienceResolver): void;
  onSignal(callback: SignalCallback): void;
  offSignal(callback: SignalCallback): void;
}

export const SIGNAL_AUDIENCES = [
  'self',
  'coordinator',
  'selected',
  'all',
] as const satisfies readonly SignalAudience[];

export const MESSAGE_CLASSES = [
  'attention',
  'confidence',
  'conflict',
  'handoff',
  'escalation',
] as const satisfies readonly MessageClass[];

export const SIGNAL_CLASSES = [
  'attention.raise',
  'confidence.high',
  'confidence.medium',
  'confidence.low',
  'confidence.blocker',
  'conflict.active',
  'conflict.resolved',
  'handoff.ready',
  'handoff.partial',
  'escalation.interrupt',
  'escalation.uncertainty',
] as const satisfies readonly SignalClass[];

export const SIGNAL_PRIORITIES = [
  'low',
  'normal',
  'high',
  'critical',
] as const satisfies readonly SignalPriority[];

export const SIGNAL_STATES = [
  'emitted',
  'active',
  'superseded',
  'expired',
  'resolved',
] as const satisfies readonly SignalState[];

export const SIGNAL_EVENTS = [
  'emitted',
  'superseded',
  'resolved',
  'expired',
] as const satisfies readonly SignalEvent[];

export const MESSAGE_CLASS_TO_SIGNAL_PREFIX: Record<MessageClass, string> = {
  attention: 'attention.',
  confidence: 'confidence.',
  conflict: 'conflict.',
  handoff: 'handoff.',
  escalation: 'escalation.',
};

export const TERMINAL_STATES = [
  'superseded',
  'expired',
  'resolved',
] as const satisfies readonly SignalState[];

export class ConnectivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectivityError';
  }
}

export class SignalValidationError extends ConnectivityError {
  constructor(message: string) {
    super(message);
    this.name = 'SignalValidationError';
  }
}

export class SignalNotFoundError extends ConnectivityError {
  constructor(signalId: string) {
    super(`Signal not found: ${signalId}`);
    this.name = 'SignalNotFoundError';
  }
}
