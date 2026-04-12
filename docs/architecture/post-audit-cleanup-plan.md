# Post-Audit Cleanup Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-11
Source: SDK Audit Review, Routing Review, Coordination Hardening Review verdicts

## Purpose

This plan lists the narrow documentation fixes identified by the three review verdicts. All items are doc-only corrections of stale status statements, test count drift, or README list gaps. No new package design, no new code, no spec changes.

---

## 1. Stale Workflow Status in `docs/index.md`

**File:** `docs/index.md`, line 46

**Current (stale):**
```
- [V1 workflow backlog](workflows/v1-workflow-backlog.md) — WF-1 through WF-5 COMPLETE; WF-6/WF-7 uncertain; routing DoD gap noted
```

**Corrected:**
```
- [V1 workflow backlog](workflows/v1-workflow-backlog.md) — WF-1 through WF-6 COMPLETE; WF-7 OPEN; routing DoD gap noted
```

**Why:** The workflow backlog and weekend delivery plan both confirm WF-6 is COMPLETE. The index page still says "WF-6/WF-7 uncertain," which misleads readers about rollout status. This was the sole reason the SDK Audit Review issued `PASS_WITH_FOLLOWUPS` instead of `PASS`.

---

## 2. Stale Test Counts Across Documentation

Test counts in documentation have drifted significantly from actual `it()` counts in the codebase. The following table shows the current actual counts vs. what docs claim.

| Package | Actual tests | Docs claim | Files |
|---|---|---|---|
| `core` | 44 (19 + 14 + 11) | 31 | `core.test.ts`, `core-sessions.test.ts`, `core-sessions-surfaces.test.ts` |
| `sessions` | 25 | 25 | correct — no change needed |
| `surfaces` | 28 | 28 | correct — no change needed |
| `routing` | 12 | 12 | correct — no change needed |
| `connectivity` | 87 | 30 | significantly grown since initial review |
| `coordination` | 45 | 39 | grew from 35 (hardening) + 4 (routing integration) + 6 (additional) |
| **Total** | **241** | **165** | |

### Files to update with corrected test counts

Each file below contains at least one stale test count that must be corrected:

| File | What to fix |
|---|---|
| `README.md` line 26 | core: 31 → 44 |
| `README.md` line 30 | connectivity: 30 → 87 |
| `README.md` line 31 | coordination: 39 → 45 |
| `README.md` line 38 | total: 165 → 241 |
| `docs/index.md` line 16 | total: 165 → 241 |
| `docs/architecture/package-boundary-map.md` line ~99 | core: 31 → 44 |
| `docs/architecture/package-boundary-map.md` line ~213 | connectivity: 30 → 87 |
| `docs/architecture/package-boundary-map.md` line ~285 | routing: stays 12 (correct) |
| `docs/architecture/sdk-audit-and-traits-alignment-plan.md` line ~17 | routing stays 12; coordination: 39 → 45; connectivity: likely stale |
| `docs/workflows/v1-workflow-backlog.md` | coordination: 39 → 45; connectivity: 30 → 87 |
| `docs/workflows/weekend-delivery-plan.md` line ~16 | core: 31 → 44 |
| `docs/research/internal-system-comparison.md` line ~18 | routing stays 12 (correct) |

### Rule for this sweep

Run `grep -c 'it(' packages/*/src/*.test.ts` at the start of the sweep. Use the actual counts. Do not hardcode — the numbers may shift again before the sweep runs.

---

## 3. `AssistantDefinition.traits` Consistency Check

**Current state:** `packages/core/src/types.ts` has no `traits` field on `AssistantDefinition`. This is correct per the architecture docs and the SDK Audit Review.

**Inconsistency:** Multiple documents reference adding `traits?: TraitsProvider` as a future field:
- `docs/architecture/traits-and-persona-layer.md` line ~134 — shows the planned interface with `traits?: TraitsProvider`
- `docs/architecture/package-boundary-map.md` line ~108 — says "When `@relay-assistant/traits` ships, a `traits?: TraitsProvider` optional field will be added. Do not add it prematurely"
- `README.md` line ~36 — `@relay-assistant/traits` listed as "planned — v1.2"

**Assessment:** The docs are internally consistent on the rule ("do not add until v1.2") and the code correctly has no such field. No fix needed — this is already resolved. The cleanup sweep should verify the field still does not exist in `types.ts` and move on.

---

## 4. Coordination README Test List (Stale)

**File:** `packages/coordination/README.md`, lines 151–157

**Current (stale, from initial implementation):**
```
The test suite covers the intended first workflows:

- registry and delegation plan validation
- sequential specialist handoff
- optional-step degradation
- blocker interruption
- conflict detection and resolution
```

**Corrected (reflects 45-test suite across four groups + routing integration):**
```
The test suite covers 45 tests across five groups:

- specialist registry (7 tests): duplicate rejection, defensive copy, empty/whitespace names, unregister/get edge cases
- delegation plan validation (7 tests): empty intent/steps/instruction/name, multi-error accumulation, maxSteps, copy isolation
- synthesis strategies (8 tests): concatenate, last-wins, custom — including degraded quality and failure exclusion
- coordinator lifecycle and signal handling (13 tests): sequential handoff, optional/required step failure, blocker halt, conflict tracking, turnId prefix, offSignal cleanup, advanceStep, selected-audience resolver
- routing integration (10 tests): mode selection per step, cost accumulation, ceiling enforcement, fallback without router
```

**Source:** Coordination Hardening Review (35 base tests) + routing integration tests (additional tests bringing total to 45).

---

## 5. Routing README — Review Verdict Test Count Note

**File:** `packages/routing/README.md`

**No change needed to the README itself.** The routing review identified 11 tests (its count at the time); the actual count is 12. The README and all other docs already say 12. The 11-vs-12 discrepancy was likely a count error in the review verdict (possibly excluding a test added late in the routing implementation). No doc fix required.

**What the sweep should NOT do:** The routing README's test list accurately describes the coverage categories. The DoD gap (12 vs. 40+) is correctly flagged everywhere. Do not change routing's test count claims — they are already correct at 12.

---

## 6. Weekend Delivery Plan — Status Line for WF-6

**File:** `docs/workflows/weekend-delivery-plan.md`, line ~20 area

**Current:**
```
**WF-6 is COMPLETE.** ...
**WF-7 is OPEN.** ...
```

**Assessment:** These lines are already correct. No change needed. The stale reference is only in `docs/index.md` (item 1 above).

---

## Scope Boundaries

This cleanup plan is limited to:

- Correcting stale status text (WF-6 status in index)
- Updating test counts to match actual `it()` counts
- Expanding the coordination README test list to reflect the current 45-test suite
- Verifying the `AssistantDefinition.traits` field does not exist (confirmation only, no code change)

This cleanup plan does NOT include:

- Writing new tests (routing F-1 is a separate work item)
- Fixing the routing `escalated` flag (F-2 — separate work item)
- Adding coordination-routing wiring to coordination types (F-5 — separate work item)
- Creating the `@relay-assistant/traits` package
- Creating the `packages/examples/src/` directory or WF-7 assembly test
- Adding monorepo workspace configuration
- Any spec changes

---

## Execution Checklist

1. [ ] Run `grep -c 'it(' packages/*/src/*.test.ts` to get current counts
2. [ ] Update `docs/index.md` line 46: change "WF-6/WF-7 uncertain" to "WF-6 COMPLETE; WF-7 OPEN"
3. [ ] Update `docs/index.md` line 16: total test count
4. [ ] Update `README.md` lines 26, 30, 31, 38: per-package and total test counts
5. [ ] Update `docs/architecture/package-boundary-map.md`: core, connectivity test counts
6. [ ] Update `docs/architecture/sdk-audit-and-traits-alignment-plan.md`: coordination, connectivity test counts
7. [ ] Update `docs/workflows/v1-workflow-backlog.md`: coordination, connectivity test counts
8. [ ] Update `docs/workflows/weekend-delivery-plan.md`: core test count
9. [ ] Update `packages/coordination/README.md` lines 151–157: expand test list to reflect 45-test suite
10. [ ] Verify `packages/core/src/types.ts` has no `traits` field on `AssistantDefinition` (confirmation only)
11. [ ] Grep for any remaining instances of "165 tests" or "30 pass" (connectivity) or "31 pass" (core) or "39 pass" (coordination) in docs and fix stragglers

---

POST_AUDIT_CLEANUP_PLAN_READY
POST_AUDIT_CLEANUP_APPLIED
