# Open-Source Remediation Boundary — Agent Assistant SDK

Date: 2026-04-13
Source: [open-source-readiness-report.md](open-source-readiness-report.md), [open-source-remediation-backlog.md](open-source-remediation-backlog.md), [public-launch-decision.md](public-launch-decision.md)

---

## Purpose

This document defines the exact scope of the open-source remediation pass. It draws a hard line between what will be fixed now (to unblock public visibility and first npm publish) and what is intentionally deferred. Every item is traceable to the audit report and backlog.

---

## 1. Audit Blockers Fixed Now

These are the Tier 1 blockers that prevent any external contributor from using the repo. All will be resolved in this remediation pass.

### 1.1 Create LICENSE file (T1-1)

**Action:** Create `/LICENSE` at repo root with standard MIT license text. Copyright holder: `AgentWorkforce`.

**Verified gap:** `ls LICENSE` returns "No such file." The README says "MIT" but there is no license file.

### 1.2 Remove `@agentworkforce/workload-router` from root devDependencies (T1-2)

**Action:** Delete the `@agentworkforce/workload-router` entry from `package.json` `devDependencies`. If the resulting `devDependencies` object is empty, remove the key entirely.

**Verified gap:** Root `package.json` line 20: `"@agentworkforce/workload-router": "^0.1.1"`. This is a private package. External `npm install` fails.

**Scope constraint:** Only the root `package.json` is modified. No workflow or internal tooling files are changed — if internal workflows depend on this package, they must document that dependency separately.

### 1.3 Fix `@agent-relay/memory` file reference (T1-3)

**Action:** Mark `packages/memory` as not-yet-installable by:
1. Adding `"private": true` to `packages/memory/package.json`.
2. Removing `packages/memory` from the root `workspaces` array.

**Rationale:** Option C from the backlog. The memory package has a `file:../../../relay/packages/memory` dependency pointing to a sibling monorepo that external contributors do not have. Stubbing the dependency (Option A) requires design decisions about the `@agent-relay/memory` interface that are out of scope for this pass. Publishing `@agent-relay/memory` (Option B) is not under our control. Marking the package private and excluding it from the workspace install graph is the safest bounded fix.

**Scope constraint:** The memory package source code is not modified. Only `packages/memory/package.json` (add `"private": true`) and root `package.json` (remove from `workspaces`). Documentation updates to reflect this are covered in Section 2.

### 1.4 Create CONTRIBUTING.md (T1-4)

**Action:** Create `/CONTRIBUTING.md` at repo root covering:
- Getting started: clone, `npm install`, `npx vitest run`
- PR process: spec-first for new packages, implement against spec, include tests
- Test requirements: all existing tests must pass; new behavior requires new tests
- Code style: TypeScript strict mode, ESM modules
- Contribution policy: DCO sign-off (lightweight, no CLA infrastructure needed)
- Issue reporting guidance

**Scope constraint:** This is a new file. No existing files are modified for this item. Content must be accurate against the current `npx vitest run` behavior.

### 1.5 Update `docs/current-state.md` — proactive and policy status (T1-5)

**Action:** Update `docs/current-state.md` to reflect actual implementation status:

| Field | Old value | New value |
|---|---|---|
| `@agent-assistant/proactive` status | placeholder | **IMPLEMENTED** |
| `@agent-assistant/proactive` spec | none | `IMPLEMENTATION_READY` (`docs/specs/v1-proactive-spec.md`) |
| `@agent-assistant/policy` status | placeholder | **IMPLEMENTED** |
| `@agent-assistant/policy` spec | none | `IMPLEMENTATION_READY` (`docs/specs/v1-policy-spec.md`) |
| Proactive test row | absent | `proactive.test.ts` / 53 / **PASS** |
| Policy test row | absent | `policy.test.ts` / 64 / **PASS** |
| Connectivity test count | 87 claimed | ~30 actual (blocked; unverified) |
| Coordination test count | 45 claimed | ~39 actual (blocked; unverified) |
| Total verified passing | 128 | recalculate: 128 + 53 + 64 = **245** |
| V1 Baseline | core, sessions, surfaces, traits | add `proactive`, `policy` |
| Memory status | placeholder | **placeholder (private — excluded from workspace install)** |

**Scope constraint:** Only `docs/current-state.md` is modified for this item. README updates are in Section 2.

---

## 2. Documentation and Public Surface Updates

These updates ensure that public-facing docs match actual state after the blockers are fixed.

### 2.1 Update README package map (T2-6, partial)

**Action:** Update the README.md package map table:

| Package | Old status | New status |
|---|---|---|
| `@agent-assistant/proactive` | placeholder — v1.2 | **IMPLEMENTED** |
| `@agent-assistant/policy` | placeholder — v2 | **IMPLEMENTED** |
| `@agent-assistant/memory` | placeholder — v1.1 | **placeholder (private — requires relay foundation backend)** |

Update the "Current Status" summary section:
- Change "7 packages implemented" to "9 packages implemented"
- Change "128 tests verified passing" to "245 tests verified passing"
- Change "3 packages are placeholder/README-only" to "1 package is placeholder (memory)"
- Add `@agent-assistant/proactive: 53 pass` and `@agent-assistant/policy: 64 pass` to the test list
- Add note that `@agent-assistant/examples` is a reference package, not a placeholder

### 2.2 Update `docs/index.md` status line

**Action:** Update the status summary in `docs/index.md` to match the corrected `current-state.md` counts (9 implemented, 245 passing).

### 2.3 Add newcomer note about historical architecture docs

**Action:** Add a short note at the top of `docs/index.md` (below the existing "Start here" line):

> Architecture docs in `docs/architecture/` contain references to `@relay-assistant/*` and `RelayAssistant`. These are historical records from before the rename to `@agent-assistant/*` / Agent Assistant SDK. Each carries a header note. Active code and packages use `@agent-assistant/*` exclusively.

**Scope constraint:** One paragraph added to `docs/index.md`. No architecture docs are modified.

---

## 3. Naming and Link Issues In Scope

### 3.1 No active naming issues to fix

The audit confirmed:
- All `package.json` files use `@agent-assistant/*`. The rename from `@relay-assistant/*` is complete in code and manifests.
- All source `import` statements use `@agent-assistant/*`.
- Architecture docs with old names carry the historical header note.

**Decision:** No naming changes are in scope for this remediation. The `@relay-assistant/*` references in `docs/architecture/` are intentionally historical. The newcomer note (2.3) addresses potential confusion.

---

## 4. Package and Public-Surface Messaging Clarified Now

### 4.1 Memory package messaging

The memory package will be marked private and excluded from the workspace. All public surfaces (README, current-state.md) must reflect that memory requires a relay foundation backend not yet publicly available. The messaging is:

> `@agent-assistant/memory` is not yet installable. It depends on `@agent-relay/memory` (relay foundation infrastructure) which is not publicly available. The memory package is excluded from the workspace install graph. When the relay memory package is published, memory will be re-enabled.

### 4.2 Connectivity and coordination messaging

These packages are implemented but their test suites are blocked by missing `node_modules`. The README and current-state.md already note this. This remediation does **not** unblock them (that is T2-5, deferred to Section 5). The current messaging is accurate and sufficient.

### 4.3 Proactive and policy messaging

Both packages will be promoted from "placeholder" to "IMPLEMENTED" across all public surfaces. The README, current-state.md, and docs/index.md must all agree.

---

## 5. Intentionally Deferred

The following items from the audit and backlog are **not in scope** for this remediation pass. Each is acknowledged with a reason.

### Deferred Tier 2 items (required before npm publish, not before going public)

| Item | Backlog ID | Reason for deferral |
|---|---|---|
| Add `"license": "MIT"` to 6 packages | T2-1 | Required for npm publish, not for repo visibility. No package is being published in this pass. |
| Add `publishConfig.access: "public"` to 6 packages | T2-2 | Same — publish-time concern only. |
| Fix connectivity routing type re-export / devDep mismatch | T2-3 | Requires a design decision (remove re-export vs. promote dep). Does not affect repo cloneability. |
| Change coordination `file:` dep to version range | T2-4 | Required before coordination npm publish, not before going public. The `file:` ref works within the monorepo. |
| Install connectivity workspace / unblock tests | T2-5 | Operational step that any contributor can do with `npm install` after T1-2 and T1-3 are resolved. Not a code change. |
| Add CI GitHub Actions workflow | T2-7 | Valuable but not a blocker for repo visibility. Can be added as a fast-follow. |
| Normalize `repository` field in packages | T2-8 | Publish-time concern only. |

### Deferred Tier 3 items (pre/post first tagged release)

| Item | Reason for deferral |
|---|---|
| `CODE_OF_CONDUCT.md` | Standard governance file. Important but not a blocker — most OSS repos add this after initial publication. |
| Root `npm run build:all` and `npm test` scripts | Convenience scripts. Contributors can run `npx vitest run` directly. |
| Smoke tests for examples (WF-7) | Examples are typecheck-only. Acceptable for initial publication. |
| `CHANGELOG.md` | Acceptable to omit for v0.1.0 pre-release. |
| Generalize Sage/MSD/NightCTO references | Internal product names in examples. Acceptable — they serve as concrete illustrations. |

### Explicitly not claimed as resolved

The following issues exist and are **not resolved** by this remediation. They must not be claimed as fixed in any post-remediation status update:

1. **Connectivity and coordination test suites remain blocked.** The workspace install may succeed after T1-2 and T1-3 fixes, but test verification is not part of this pass. The claimed test counts (~30 connectivity, ~39 coordination) remain unverified.

2. **Routing DoD gap persists.** 12 tests vs. 40+ target. No routing work is in scope.

3. **No CI pipeline exists.** External PRs receive no automated test feedback.

4. **Connectivity re-exports routing types from a devDependency.** This is a publish-time bug, not a clone-time bug. Deferred to T2-3.

5. **Coordination's `file:` dependency on connectivity.** Works within the monorepo workspace. Breaks if published to npm. Deferred to T2-4.

6. **Six packages missing `"license": "MIT"` in package.json.** Does not affect repo visibility. Deferred to T2-1.

7. **Seven packages missing `publishConfig.access: "public"`.** Does not affect repo visibility. Deferred to T2-2.

---

## 6. Remediation Execution Order

Items must be applied in this order to avoid intermediate breakage:

1. **T1-1:** Create `LICENSE`
2. **T1-2:** Remove `@agentworkforce/workload-router` from root `devDependencies`
3. **T1-3:** Mark memory private, remove from workspaces
4. **T1-4:** Create `CONTRIBUTING.md`
5. **T1-5:** Update `docs/current-state.md`
6. **2.1:** Update README package map and status
7. **2.2:** Update `docs/index.md` status line
8. **2.3:** Add newcomer note to `docs/index.md`

Steps 1-4 are independent and can be parallelized. Steps 5-8 are documentation updates that depend on the decisions in 1-4 being finalized.

---

## 7. Verification Criteria

After this remediation pass, the following must be true:

| Check | Command / Method | Expected |
|---|---|---|
| LICENSE exists | `ls LICENSE` | File present with MIT text |
| `npm install` succeeds from clean clone | `rm -rf node_modules && npm install` | Exit 0, no 404 or auth errors |
| No private package in root devDeps | `grep workload-router package.json` | Zero results |
| Memory excluded from workspace | `grep memory package.json` (root) | Not in workspaces array |
| Memory marked private | `grep private packages/memory/package.json` | `"private": true` |
| CONTRIBUTING.md exists | `ls CONTRIBUTING.md` | File present |
| current-state.md shows proactive as IMPLEMENTED | `grep proactive docs/current-state.md` | Shows IMPLEMENTED, 53 tests |
| current-state.md shows policy as IMPLEMENTED | `grep policy docs/current-state.md` | Shows IMPLEMENTED, 64 tests |
| README shows proactive as IMPLEMENTED | `grep proactive README.md` | Shows IMPLEMENTED |
| README shows policy as IMPLEMENTED | `grep policy README.md` | Shows IMPLEMENTED |
| README test count updated | `grep "245 tests" README.md` | Present |
| docs/index.md has newcomer note | `grep "historical records" docs/index.md` | Present |

---

## 8. What This Boundary Does NOT Cover

To be explicit about what is out of scope:

- **No npm publishing.** No package is published to the registry in this pass.
- **No new code.** No TypeScript source files are created or modified.
- **No test execution or verification.** Test counts for connectivity/coordination remain unverified.
- **No CI/CD setup.** No GitHub Actions workflows are created.
- **No architecture doc rewrites.** Historical `@relay-assistant/*` references remain as-is with header notes.
- **No dependency upgrades or additions.** No packages are installed, upgraded, or added.

---

OPEN_SOURCE_REMEDIATION_BOUNDARY_READY
