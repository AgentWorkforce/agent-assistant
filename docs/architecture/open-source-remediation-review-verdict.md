# Open-Source Remediation Review Verdict — Agent Assistant SDK

Date: 2026-04-13
Reviewer: non-interactive reviewer agent
Inputs reviewed:
- `docs/architecture/open-source-remediation-boundary.md`
- `docs/architecture/open-source-remediation-report.md`
- `README.md`
- changed docs/package metadata in the working tree

## Verdict

**PASS_WITH_FOLLOWUPS**

The remediation meaningfully reduced the major public-readiness blockers. In particular, the repository now has a real license, the root install blocker from `@agentworkforce/workload-router` is removed, the non-public memory workspace is excluded from the install graph, and the public-facing docs are materially clearer for an outside reader.

The remaining issue is not that the repo is still unusable from a clean clone. A clean-clone `npm install` now succeeds. The problem is that the remediation report and contributing guidance overstate how complete the remediation is, and a few blocker descriptions are now stale or inaccurate relative to actual behavior.

## Findings

### 1. Ready/public claims are stronger than the verified state

`docs/architecture/open-source-remediation-report.md:10` says the repository is "ready to be made public" and that external contributors can run `npx vitest run` against the implemented packages. `CONTRIBUTING.md:24-29`, `CONTRIBUTING.md:49-54`, and `CONTRIBUTING.md:84-89` also instruct contributors to run root `npx vitest run` and state that all existing tests must pass.

That is not currently true as written. In a clean temporary copy, `npm install` succeeded, but root `npx vitest run` exited non-zero:
- `packages/connectivity` passed
- `packages/coordination` failed to resolve `@agent-assistant/connectivity`
- `packages/memory` failed to resolve `@agent-relay/memory`

This means the major install blocker was reduced, but the repo is not yet in the state implied by the report/contributor guidance.

### 2. Connectivity is no longer blocked for the reason the docs claim

`docs/current-state.md:22`, `docs/current-state.md:38`, `docs/current-state.md:50-53`, `README.md:78`, and `docs/architecture/open-source-remediation-report.md:93-94,197,203` describe connectivity as blocked by missing `node_modules` / workspace install.

That description is stale. After a clean `npm install`, `packages/connectivity/src/connectivity.test.ts` passes. The remaining active failure is coordination’s import/entry resolution against connectivity, not connectivity’s own installability. The docs should distinguish:
- connectivity: installable and testable after `npm install`
- coordination: still blocked
- memory: still blocked and intentionally private

### 3. `package-lock.json` was left inconsistent with the claimed manifest cleanup

`package-lock.json:10-26` still lists `packages/memory` in root workspaces and still records `@agentworkforce/workload-router` under root `devDependencies`. `package-lock.json:60-96` also still contains linked entries for `@agent-assistant/memory`, `@agent-relay/memory`, and `@agentworkforce/workload-router`.

This did not block a clean `npm install` in my verification run, so it is not a release-blocking defect by itself. But it weakens the credibility of the remediation report’s "items applied" section and should be reconciled so the lockfile matches the boundary decisions.

## Assessment Against Requested Questions

### 1. Were the major public-readiness blockers meaningfully reduced?

Yes.

The highest-value blockers were reduced:
- missing `LICENSE` fixed
- root private-package install blocker removed
- memory no longer blocks workspace installation
- newcomer-facing docs now explain package status and historical naming much better

Most importantly, a clean-clone `npm install` now succeeds, which is a substantial improvement over the pre-remediation state described in the boundary.

### 2. Is the repo more understandable to an outsider now?

Yes.

`README.md`, `docs/index.md`, and `docs/current-state.md` are materially better than before:
- proactive and policy are no longer mislabeled as placeholders
- memory is described more honestly as non-installable/private
- the historical rename note reduces confusion around old architecture docs
- the package map is easier for a newcomer to interpret

The only caveat is that some blocker text is now outdated, especially around connectivity.

### 3. Are the remaining unresolved items represented honestly?

Mostly, but not fully.

The remediation documents are reasonably honest about deferred publish-time issues, CI absence, routing DoD gaps, and memory remaining unavailable. The main gap is that they overstate test readiness and understate the fact that root `npx vitest run` still fails after a clean install. They also continue to describe connectivity as blocked when the cleaner statement is that coordination and memory remain blocked.

## Follow-Ups Required

1. Correct the readiness language in `docs/architecture/open-source-remediation-report.md` and `CONTRIBUTING.md` so it matches actual verified behavior.
2. Update `README.md` and `docs/current-state.md` to reflect that connectivity passes after `npm install`, while coordination still fails.
3. Refresh `package-lock.json` so it no longer advertises the removed root devDependency or the removed memory workspace.
4. Decide whether root `npx vitest run` should be expected to pass for public contributors; if yes, exclude/fix the memory and coordination failures, and if no, document the exact supported test commands.

## Review Summary

This remediation pass made the repo substantially more public-ready and more comprehensible to outsiders, and it appears sufficient for public visibility with follow-up cleanup. It does not justify an unqualified PASS because the current docs over-claim readiness and the root test command still fails after a clean install.

Artifact produced:
- `docs/architecture/open-source-remediation-review-verdict.md`

OPEN_SOURCE_REMEDIATION_REVIEW_COMPLETE
