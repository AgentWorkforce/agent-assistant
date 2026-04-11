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
