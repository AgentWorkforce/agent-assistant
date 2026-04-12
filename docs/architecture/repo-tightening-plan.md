# Repo-Tightening Plan

Repeatable, lightweight cleanup pass for repo organization, navigation, naming consistency, and source-of-truth clarity. Target: under 30 minutes per pass.

---

## 1. Source-of-Truth Hierarchy

When documents conflict: **source code > specs > READMEs > index/status docs > plans > verdicts.**

- Specs in `docs/specs/` are canonical contracts. Plans and verdicts in `docs/architecture/` are historical records.
- Status in `README.md` and `docs/index.md` must be **derived** from code/tests, never authoritative.
- Specs marked `SPEC_RECONCILED` mean code and spec agree. `IMPLEMENTATION_READY` means spec is ready but reconciliation not yet confirmed.
- This hierarchy is stated in `docs/index.md` under "Source of truth." Verify it exists each pass.

## 2. Navigation Docs That Must Exist

| Document | Purpose |
|---|---|
| `README.md` | External-facing overview, package status table, layer model |
| `docs/index.md` | Internal docs hub — links to all active + archived architecture docs |
| `docs/specs/` | One canonical spec per package (`v1-{package}-spec.md`) |
| Implementation Archive in `docs/index.md` | Links to all completed plan/verdict pairs, grouped by package |

**Rule:** Every file in `docs/architecture/` must be reachable from `docs/index.md` — either in the active Architecture section or the Implementation Archive section.

## 3. Repeatable Checklist

```
REPO TIGHTENING CHECKLIST
==========================

[ ] 1. Run all package tests (`npx vitest run`), record per-package pass counts
      - Note any packages blocked by missing dependencies

[ ] 2. Verify README.md status table matches test output
      - Test counts match actual runs?
      - Implementation status correct? (IMPLEMENTED / placeholder / planned)
      - Spec status markers match spec file headers?
      - Blocking notes current?

[ ] 3. Verify docs/index.md status paragraph matches README.md
      - Package count, test total, blocking issues

[ ] 4. Check for orphaned architecture docs
      - Every file in docs/architecture/ reachable from docs/index.md?
      - New plan/verdict files added to Implementation Archive?

[ ] 5. Check docs/index.md links are not broken
      - Every link target file exists
      - Link annotations match linked document content

[ ] 6. Verify spec status markers
      - Grep for SPEC_RECONCILED, IMPLEMENTATION_READY across docs/specs/
      - Each marker matches actual code-vs-spec alignment

[ ] 7. Spot-check package READMEs
      - Implemented packages: have API summary, test command
      - Placeholder packages: state roadmap milestone

[ ] 8. Verify source-of-truth note exists in docs/index.md

[ ] 9. Record pass date: "Last tightened: YYYY-MM-DD" at bottom of docs/index.md
```

## 4. Naming Consistency Rules

- **Architecture doc naming:** Use `v1-{package}-implementation-plan.md` for new plans (not `-package-implementation-plan.md`). Leave existing historical names as-is.
- **Duplicate connectivity spec:** `docs/architecture/connectivity-package-spec.md` should carry a note pointing to the canonical spec at `docs/specs/v1-connectivity-spec.md`.
- **Stale vocabulary in older docs:** Do not bulk-rename. The crosswalk in `v1-sectioning-and-priorities.md` serves as translation reference. Only fix vocabulary in active docs (README, index, specs, package READMEs).

## 5. Scope Boundaries

This plan does NOT cover:
- New package implementation or spec writing
- Code changes, refactoring, or dependency fixes
- Routing DoD gap resolution (that is implementation work)
- Workflow file cleanup (TypeScript automation, not docs)
- `.trajectories/` or `.overnight/` cleanup (gitignored runtime state)

---

REPO_TIGHTENING_PLAN_READY
