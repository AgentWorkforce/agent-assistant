# v1 Coordination Review Verdict

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Date:** 2026-04-11
**Package:** `@relay-assistant/coordination`
**Verdict:** PASS_WITH_FOLLOWUPS

---

## Summary

The v1 coordination package implements the core contracts correctly and is properly bounded. The connectivity dependency is clean and injected through configuration. No forbidden packages are imported. The existing tests cover the most important end-to-end coordination behaviors.

Several follow-ups are required before memory/routing/product integration: test coverage falls well short of the 35-test minimum in the implementation plan, `registerSelectedResolver` is not called by the coordinator, one API name was changed from the spec, and the `turnId` prefix differs.

---

## Assessment

### 1. Is the coordination package properly bounded for v1?

**PASS with minor observations.**

The implemented scope matches the plan:

- Specialist registry with uniqueness enforcement and lookup ✓
- Delegation plan factory and validator ✓
- Sequential coordinator lifecycle (validate → delegate → observe signals → synthesize) ✓
- Three synthesis strategies (`concatenate`, `last-wins`, `custom`) ✓
- In-memory turn only; no persistence backend ✓

Non-ownership is correctly upheld. The package contains no imports from `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces`, `@relay-assistant/memory`, `@relay-assistant/routing`, or `@relay-assistant/policy`.

Minor structural divergence from the plan: the plan described six source files (`registry.ts`, `delegation.ts`, `synthesis.ts`, `coordinator.ts`, `types.ts`, `index.ts`). The implementation consolidates all factory functions into a single `coordination.ts` alongside `types.ts` and `index.ts`. This is a valid authoring choice that does not affect the public API surface or scope boundary.

One behavioral divergence: the plan specified that `createDelegationPlan()` should NOT validate against the registry (validation being the job of the separate `validatePlan()` function). The implementation's `createDelegationPlan()` calls `validateDelegationPlan()` internally and throws on failure. This is a reasonable simplification, but it means the function is not a pure factory — products cannot create a plan before the registry is populated. This should be documented as a deliberate choice or reverted to match the spec.

### 2. Does it depend on connectivity in a clean way?

**PASS.**

The package imports exactly three types from `@relay-assistant/connectivity`:

```ts
import type { ConnectivityLayer, ConnectivitySignal, SignalCallback }
  from '@relay-assistant/connectivity';
```

The `ConnectivityLayer` is injected into the coordinator via `CoordinatorConfig`, not constructed internally. Specialists receive the same instance through `SpecialistContext`. The coordinator uses the connectivity API only through the public interface (`onSignal`, `offSignal`, `query`, `resolve`, `advanceStep`). No connectivity internals are accessed.

The routing escalation hook is correctly left for the consumer to wire on the shared connectivity layer instance; the coordinator never calls routing.

**One gap:** The plan (§4.4) states the coordinator must call `registerSelectedResolver` so that `audience: 'selected'` signals can be routed to named specialists. The implementation does not call `registerSelectedResolver` at any point. As a result, `audience: 'selected'` signals emitted by specialists will resolve to an empty recipient list. This should be addressed before products emit `selected`-audience signals.

### 3. Does it avoid taking ownership of routing, memory, surfaces, and transport?

**PASS — clean boundary.**

- No routing imports; routing escalation is delegated to `RoutingEscalationHook` wired by the consumer on the connectivity layer.
- No memory imports; specialists may use memory inside their handlers, but coordination contracts are memory-agnostic.
- No surface imports; `SynthesisOutput.text` is plain text. Surface delivery is the consumer's responsibility.
- No transport imports; connectivity signals are in-memory within the layer.
- The `CoordinationTurn` correctly exposes `signals` as observable data for product-level resolution without the coordinator taking policy action.

The conflict handling is particularly well-bounded: the coordinator tracks `unresolvedConflicts` in the turn and degrades synthesis quality when conflicts remain, but never calls routing or takes policy decisions.

### 4. Do the tests cover the intended first coordination behaviors?

**PARTIAL PASS — coverage gap.**

The plan required a minimum of 35 tests across four test files. The implementation contains one consolidated test file (`coordination.test.ts`) with 5 tests. The tests that exist are high-value integration-style scenarios:

| Test | Coverage | Status |
|---|---|---|
| Registry duplicate rejection + plan validation | Registry uniqueness, plan validation with unknown specialist | ✓ |
| Sequential delegation with handoff signals | Two-specialist handoff, prior results threading, signal cleanup | ✓ |
| Optional step failure / degraded output | Optional-step skip, `skippedSteps`, degraded quality | ✓ |
| Blocker signal halts coordination | `confidence.blocker` → `CoordinationBlockedError` | ✓ |
| Conflict tracking without routing ownership | `conflict.active` / `conflict.resolved` signal lifecycle | ✓ |

Missing from the plan's test matrix:

- Registry: `list()` defensive copy, `has()` boolean correctness, empty-name validation, `unregister` no-op
- Delegation plan: `createDelegationPlan()` returns copy (not frozen in implementation), empty steps/intent/instruction validation, multiple-error accumulation
- Synthesis: unit tests for all three strategies, degraded-all-failed behavior, `SynthesisError` for missing `customFn`, partial results degrading quality
- Coordinator: `advanceStep` called per step, `onSignal`/`offSignal` lifecycle, max steps enforcement via `maxSteps`, `turnId` format, `registerSelectedResolver` call

These missing tests reduce confidence in edge cases that the integration tests do not exercise (e.g., synthesis strategy edge cases, empty registry, oversized plans, signal lifecycle correctness).

### 5. What follow-ups remain before memory/routing/product integration?

**Required (blocking):**

1. **Test coverage** — Expand `coordination.test.ts` (or add the four separate test files from the plan) to reach the 35-test minimum. At minimum, add unit coverage for registry edge cases, delegation plan validation accumulation, synthesis strategy edge cases, and coordinator signal lifecycle assertions. This is the most important gap.

2. **`registerSelectedResolver` not wired** — The coordinator must call `config.connectivity.registerSelectedResolver(...)` during initialization so that `audience: 'selected'` signals resolve correctly. Without this, products that emit `selected`-audience signals during delegation will find no recipients.

3. **`createDelegationPlan` factory semantics** — Decide and document whether `createDelegationPlan` is a validating factory (current behavior) or a pure constructor (plan behavior). If products need to construct plans before filling the registry, the current behavior is a regression.

**Non-blocking (address before product adoption):**

4. **API name divergence** — The plan's §6 specifies `validatePlan` as the public export name. The implementation exports `validateDelegationPlan`. This is internally consistent but diverges from the specification. Update the spec or keep the implementation name and mark the discrepancy resolved.

5. **`turnId` prefix** — The plan specifies `turn_<nanoid>`. The implementation uses `coord_<nanoid>`. Align with the spec or update the spec.

6. **`declarationMap` and `sourceMap`** — The plan's tsconfig includes `"declarationMap": true` and `"sourceMap": true`. The actual `tsconfig.json` omits these. These improve developer experience for downstream consumers debugging into the package. Low urgency, but worth adding before publishing.

7. **Integration test phase (§11)** — WF-C (core + coordination) and WF-CS (coordination + connectivity) integration tests are explicitly deferred but should be planned as the next milestone before NightCTO or MSD adopt the package.

---

## File-Level Notes

| File | Verdict | Notes |
|---|---|---|
| `package.json` | PASS | Single `@relay-assistant/*` dep; `prebuild`/`pretest` scripts ensure connectivity is built first; `file:../connectivity` is correct for local monorepo |
| `tsconfig.json` | PASS (minor) | Missing `declarationMap`/`sourceMap` vs. plan; `forceConsistentCasingInFileNames` added beyond plan spec (good) |
| `src/types.ts` | PASS | Clean types-only file; only imports from connectivity are type imports; `CoordinationBlockedError` and `SpecialistConflictError` are useful additions beyond the plan |
| `src/coordination.ts` | PASS with gaps | Correct orchestration logic; signal cleanup in `finally` is solid; `registerSelectedResolver` omitted; `createDelegationPlan` validates eagerly |
| `src/index.ts` | PASS (minor) | Exports `validateDelegationPlan` (not `validatePlan`); all other exports match §6 of the plan; `CoordinationSignals` type correctly exported |
| `coordination.test.ts` | PARTIAL | 5 integration tests cover the key workflows but miss 30 of the 35 specified unit tests |
| `README.md` | PASS | Accurately describes scope, non-scope, connectivity boundary, and failure model; examples are correct |

---

## Verdict Rationale

The core implementation is correct and the scope is properly bounded. The connectivity integration is the cleanest aspect of the implementation — the boundary is well-drawn and the signal lifecycle (subscribe before loop, unsubscribe in `finally`, resolve consumable signals post-synthesis, degrade quality on unresolved conflicts) is implemented correctly.

The reasons for PASS_WITH_FOLLOWUPS rather than PASS:

1. Test coverage (5/35) is too low to rely on for memory/routing/product integration. The plan's 35-test minimum was not met.
2. The missing `registerSelectedResolver` call means `audience: 'selected'` signals are silently dropped, which will cause hard-to-diagnose failures when product specialists use that audience mode.

Neither issue is an architectural problem — both are implementation gaps that can be closed with targeted additions to the existing files.

---

V1_COORDINATION_REVIEW_COMPLETE
