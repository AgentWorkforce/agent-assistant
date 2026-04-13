# v1 Routing Hardening Review Verdict

**Date:** 2026-04-13
**Package:** `@agent-assistant/routing`
**Reviewer:** routing hardening slice
**Input:**
- `docs/specs/v1-routing-spec.md`
- `docs/architecture/v1-routing-implementation-plan.md`
- `docs/architecture/v1-routing-review-verdict.md`
- `docs/architecture/v1-routing-hardening-boundary.md`
- `packages/routing/src/types.ts`
- `packages/routing/src/routing.ts`
- `packages/routing/src/routing.test.ts`
- `packages/routing/README.md`
- `docs/current-state.md`

---

## Verdict

**READY_FOR_WAVE_2**

The explicit routing hold-back condition was the DoD gap around test coverage and validation. This hardening slice closes that gap honestly:

- test count increased from **12 → 52**
- the new coverage now exercises the real bounded contract rather than just proving the implementation exists
- the known `hard_constraint` / `escalated` correctness bug was fixed
- strongest local bounded validation passed (`test`, `typecheck`, `build` in `packages/routing`)

Within the routing package’s own boundary, there is no longer a truthful reason to keep calling it “implemented but held back.”

---

## 1. What changed

### Tests
`packages/routing/src/routing.test.ts` was expanded from a thin 12-test suite into a broad 52-test suite covering:

- default behavior
- policy default variants
- caller override behavior
- capability override behavior
- cost envelope boundaries
- escalation mapping, priority ordering, and tiebreak behavior
- latency selection behavior
- mode ceiling behavior
- `ModelSpec` merge semantics
- cost bookkeeping helpers
- connectivity-facing escalation hook behavior
- end-to-end priority chain ordering

This now covers the specific package claims made in the README/spec/review instead of leaving key edge cases implicit.

### Implementation
One real implementation fix was required:

- In `packages/routing/src/routing.ts`, `hard_constraint` decisions now preserve `candidate.escalated` instead of forcing `escalated: true` for any ceiling-capped decision.

That change aligns behavior with the meaning of the field and the earlier review finding.

### Docs
This slice also adds two routing-specific artifacts:

- `docs/architecture/v1-routing-hardening-boundary.md`
- `docs/architecture/v1-routing-hardening-review-verdict.md`

And updates package/status docs to reflect the new state.

---

## 2. Validation results

### Package-local validation run
Executed in `packages/routing`:

- `npm test` ✅
- `npm run typecheck` ✅
- `npm run build` ✅

### Results
- **Tests:** 52 passing
- **Typecheck:** pass
- **Build:** pass

No additional routing-package failures surfaced during this hardening slice.

---

## 3. Former blockers and disposition

| Finding | Prior state | Current state |
|---|---|---|
| F-1: test count below 40+ | Open, blocking | **Closed** |
| F-2: `escalated` incorrect on hard caps | Open | **Closed** |
| Routing package validation gap | Open | **Closed** |

---

## 4. What remains deferred but does not block this verdict

These are real follow-ups, but they are outside the bounded routing-package hardening decision:

- coordination does not yet activate the escalation-routing path end-to-end via `activeEscalations`
- push-style `onEscalation()` does not persist escalation state for later `decide()` calls
- some cross-package publish/dependency concerns remain elsewhere in the repo
- routing `tsconfig` still does not fully match the earlier plan template

Those are not reasons to keep the routing package itself held back on the original test/validation basis.

---

## 5. Honest publish-readiness judgment

For the question this slice was asked to answer — **is `@agent-assistant/routing` still held back because its own contract is under-tested and insufficiently validated?** — the answer is now **no**.

The package is bounded, tested above threshold, locally validated, and the only confirmed implementation bug exposed by hardening was corrected.

**Final state: READY_FOR_WAVE_2**

V1_ROUTING_HARDENING_REVIEW_COMPLETE
