# v1 Coordination Package Hardening Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Input:** v1 Coordination Review Verdict (PASS_WITH_FOLLOWUPS)
**Package:** `@relay-assistant/coordination`
**Scope:** Narrow — address review follow-ups only; no new features or package design work

---

## 1. Priority Order

Items are ordered by integration-blocking risk. All items in Section 2 (Required) must be completed before memory, routing, or product packages take a runtime dependency on coordination. Items in Section 3 (Non-blocking) should be addressed before product adoption but do not block the next integration milestone.

---

## 2. Required Before Integration

### H-1: Wire `registerSelectedResolver` in the coordinator

**Review item:** Required #2
**Why now:** The coordinator never calls `config.connectivity.registerSelectedResolver(...)`. Any specialist that emits a signal with `audience: 'selected'` will resolve to an empty recipient list, causing silent signal loss. This is a correctness bug that will produce hard-to-diagnose failures when products use `selected`-audience routing between named specialists.

**Action:** In `createCoordinator()` (`packages/coordination/src/coordination.ts`), register a `SelectedAudienceResolver` on the connectivity layer at the start of `execute()`, before the signal subscription. The resolver should map specialist names from the current plan's steps to their registered names in the registry:

```ts
// Inside execute(), before config.connectivity.onSignal(callback):
config.connectivity.registerSelectedResolver((signal) => {
  // Route 'selected' signals to all specialists in the current plan
  // except the emitting source
  return normalizedPlan.steps
    .map((step) => step.specialistName)
    .filter((name) => name !== signal.source);
});
```

This keeps the resolver scoped to the current plan's participants and does not introduce routing ownership — the coordinator merely tells connectivity which names are valid targets for `selected` delivery within the turn.

**Verify:** Add a test (see H-2, test #17) that confirms `selected`-audience signals resolve to the correct specialist set.

---

### H-2: Expand test coverage to meet the 35-test minimum

**Review item:** Required #1
**Why now:** The current suite has 5 integration tests. The implementation plan specified a 35-test minimum. The existing tests cover high-value end-to-end workflows but miss edge cases in the registry, delegation plan validation, synthesis strategies, and coordinator signal lifecycle. These gaps reduce confidence in behaviors that downstream packages will depend on.

All new tests go in `packages/coordination/src/coordination.test.ts` (the existing consolidated test file). No new test files are required — the single-file approach is an accepted structural divergence from the plan.

#### Tests to add (30 scenarios):

**Registry edge cases (6 tests):**

1. `list()` returns a defensive copy — mutating the returned array does not affect the registry.
2. `has()` returns `false` for an unregistered name and `true` after registration.
3. `register()` throws `CoordinationError` when `name` is an empty string.
4. `register()` throws `CoordinationError` when `name` is whitespace-only.
5. `unregister()` is a no-op for a name that was never registered (does not throw).
6. `get()` returns `null` for an unregistered name.

**Delegation plan validation (7 tests):**

7. `validateDelegationPlan()` returns `valid: false` with error when `intent` is empty.
8. `validateDelegationPlan()` returns `valid: false` with error when `steps` is empty.
9. `validateDelegationPlan()` returns `valid: false` with error when a step has an empty `instruction`.
10. `validateDelegationPlan()` returns `valid: false` with error when a step has an empty `specialistName`.
11. `validateDelegationPlan()` accumulates multiple errors (e.g., empty intent + unknown specialist + empty instruction) in a single validation pass.
12. `validateDelegationPlan()` returns `valid: false` when `steps.length` exceeds `maxSteps`.
13. `createDelegationPlan()` returns a copy — mutating the returned plan does not affect subsequent calls.

**Synthesis strategy edge cases (8 tests):**

14. `concatenate` strategy joins two `complete` results with double newline separator and sets `quality: 'complete'`.
15. `concatenate` strategy excludes `failed` results from the output text and `contributingSpecialists`.
16. `concatenate` strategy returns `quality: 'degraded'` with empty text when all results are `failed`.
17. `concatenate` strategy returns `quality: 'degraded'` when at least one result is `partial`.
18. `last-wins` strategy returns only the last non-failed result's output.
19. `last-wins` strategy returns `quality: 'degraded'` with empty text when all results are `failed`.
20. `custom` strategy delegates to `customFn` and returns its output unchanged.
21. `custom` strategy throws `SynthesisError` when `customFn` is not provided.

**Coordinator lifecycle and signal handling (9 tests):**

22. `createCoordinator()` throws `CoordinationError` when `maxSteps` is zero.
23. `createCoordinator()` throws `CoordinationError` when `maxSteps` is negative.
24. `createCoordinator()` throws `CoordinationError` when `maxSteps` is not an integer.
25. Coordinator calls `advanceStep()` once per successfully executed step.
26. Coordinator unsubscribes from signals (`offSignal`) even when execution throws (verify via the `finally` block).
27. Coordinator aborts on a required step failure and throws `CoordinationError` — does not execute subsequent steps.
28. Coordinator rejects a plan where `steps.length` exceeds `maxSteps` with `DelegationPlanError`.
29. `turnId` starts with the `coord_` prefix.
30. `selected`-audience signals resolve to the correct specialist set after `registerSelectedResolver` is wired (depends on H-1).

**Total after hardening:** 5 existing + 30 new = 35 tests.

**Verify:** `npm test` in `packages/coordination/` passes with all 35 tests green.

---

### H-3: Document `createDelegationPlan` as a validating factory

**Review item:** Required #3
**Why now:** The plan specified `createDelegationPlan()` as a pure factory that does NOT validate against the registry. The implementation validates eagerly and throws on failure. This is a reasonable simplification — it prevents invalid plans from being constructed — but it means products cannot create a plan before the registry is populated.

**Decision: Keep current behavior.** The validating factory is safer and matches how the coordinator already uses the function. Products that need to construct plans before registry population can use the raw object literal form (`{ intent, steps }`) and validate later with `validateDelegationPlan()`. The types allow this since `DelegationPlan` is a plain interface.

**Action:** Add a JSDoc comment to `createDelegationPlan()` in `coordination.ts` documenting the validation behavior:

```ts
/**
 * Creates a validated delegation plan. Throws DelegationPlanError if any step
 * references an unknown specialist or if the plan structure is invalid.
 *
 * To construct a plan without validation (e.g., before registry population),
 * use the DelegationPlan interface directly and validate later with
 * validateDelegationPlan().
 */
```

**Verify:** The JSDoc renders correctly in IDE hover and `npm run build` succeeds.

---

## 3. Non-blocking — Address Before Product Adoption

### H-4: Resolve API name divergence — keep `validateDelegationPlan`

**Review item:** Non-blocking #4
**Why now:** The plan's Section 6 specifies `validatePlan` as the public export. The implementation exports `validateDelegationPlan`. The longer name is more descriptive and avoids ambiguity in product code that may validate other plan types in the future.

**Decision: Keep `validateDelegationPlan`.** Update the implementation plan's Section 6 export table to reflect the actual name. No code change required.

**Action:** Add a note to the top of `v1-coordination-implementation-plan.md`:

```
> **Post-review update (2026-04-11):** The public export is `validateDelegationPlan`, not `validatePlan`.
> This was decided during hardening review — the longer name is more descriptive and avoids
> ambiguity with future plan types. See v1-coordination-hardening-plan.md H-4.
```

**Verify:** Grep for `validatePlan` in coordination source — only `validateDelegationPlan` should appear as an export or public function name.

---

### H-5: Resolve `turnId` prefix — keep `coord_`

**Review item:** Non-blocking #5
**Why now:** The plan specifies `turn_<nanoid>`. The implementation uses `coord_<nanoid>`. The `coord_` prefix is more descriptive — it immediately identifies the ID as belonging to the coordination package rather than a generic "turn" concept that could collide with session turns or conversation turns in other packages.

**Decision: Keep `coord_` prefix.** Update the implementation plan's Section 4.4 to reflect the actual prefix. No code change required.

**Action:** Add a note to the implementation plan alongside the H-4 note:

```
> **Post-review update (2026-04-11):** The turnId prefix is `coord_`, not `turn_`.
> This avoids collision with session/conversation turn IDs. See v1-coordination-hardening-plan.md H-5.
```

**Verify:** Grep for `turn_` in coordination source — should only appear in variable names like `turnId`, not as a string prefix.

---

### H-6: Add `declarationMap` and `sourceMap` to `tsconfig.json`

**Review item:** Non-blocking #6
**Why now:** These flags improve developer experience for downstream consumers debugging into the coordination package. Low urgency but trivial to add.

**Action:** Add to `packages/coordination/tsconfig.json` `compilerOptions`:

```json
"declarationMap": true,
"sourceMap": true
```

**Verify:** `npm run build` produces `.d.ts.map` and `.js.map` files in `dist/`.

---

## 4. Execution Order

The hardening items have the following dependency graph:

1. **H-1** (wire `registerSelectedResolver`) — no dependencies, do first since H-2 test #30 depends on it.
2. **H-2** (expand tests) — depends on H-1 for test #30. Can start tests 1-29 in parallel with H-1.
3. **H-3** (document factory semantics) — independent, can be done in parallel with H-1/H-2.
4. **H-4, H-5** (spec annotations) — independent, can be done in parallel.
5. **H-6** (tsconfig flags) — independent, do last.

**Estimated scope:** H-1 is ~10 lines of code. H-2 is the bulk of the work (~300 lines of test code). H-3 is a JSDoc addition. H-4/H-5 are spec annotations. H-6 is two lines of config.

---

## 5. Out of Scope

The following are explicitly excluded from this hardening pass:

- **WF-C / WF-CS integration tests** (review item Non-blocking #7) — these are a separate milestone that requires coordination + connectivity to both be hardened first.
- **Splitting `coordination.ts` into separate files** — the consolidated structure is an accepted divergence.
- **Adding new synthesis strategies** — v1 scope is `concatenate`, `last-wins`, `custom` only.
- **Parallel delegation** — post-v1.
- **Memory or routing integration** — post-v1.

---

## 6. Implementation Notes

Hardening was implemented in the coordination package with the following narrow changes:

- `createCoordinator()` now registers a selected-audience resolver with connectivity for the current plan participants before signal subscription.
- `createDelegationPlan()` remains the public validating factory and is documented as such in the package source and README.
- The package keeps `validateDelegationPlan` as the public validation API name.
- The package keeps the `coord_` turn ID prefix.
- The implementation plan was updated to match the shipped API names and coordinator semantics.
- High-value lifecycle, validation, synthesis, and selected-audience tests were added in the existing consolidated test file.

V1_COORDINATION_HARDENING_PLAN_READY
COORDINATION_HARDENING_IMPLEMENTED
