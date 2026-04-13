# Open-Source Readiness Report — Agent Assistant SDK

Date: 2026-04-13
Auditor: Automated audit pass (continuing from saved rubric)
Based on: [open-source-readiness-rubric.md](open-source-readiness-rubric.md)

---

## Executive Summary

The Agent Assistant SDK monorepo is **not ready to be made public today**. Four blocker-class issues prevent external contributors from installing the repository at all. A targeted remediation pass of 6–12 hours would resolve all blockers and most high-severity issues, bringing the repo to a **READY_WITH_FIXES** state.

See [public-launch-decision.md](public-launch-decision.md) for the explicit launch verdict and [open-source-remediation-backlog.md](open-source-remediation-backlog.md) for the ordered fix list.

---

## 1. Repository Governance Files

**Score: FAIL**

### Verified current state

| File | Expected | Actual |
|---|---|---|
| `LICENSE` | MIT full text | **MISSING** |
| `CONTRIBUTING.md` | Present | **MISSING** |
| `CODE_OF_CONDUCT.md` | Present | **MISSING** |
| `CHANGELOG.md` | Present | MISSING (acceptable for v0.1.0) |

### Impact

Without a `LICENSE` file the repository is legally "all rights reserved" regardless of what the README says. A GitHub repo without a license file signals to external contributors that the code cannot be used, modified, or distributed. This is a hard blocker for open-source publication.

Without `CONTRIBUTING.md`, external contributors have no authoritative guidance on PR expectations, test requirements, or contribution policy. The root README has a short contributing section, but a standalone file is the community standard.

### Required fixes

1. Create `LICENSE` (MIT, standard SPDX full text) at repo root.
2. Create `CONTRIBUTING.md` with: PR process, test requirements (`npx vitest run` must pass), spec-first development flow, and DCO/CLA policy.
3. Create `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 is the default choice for OSS under an org).

---

## 2. Install-Blocking Dependencies

**Score: FAIL**

### Verified current state

**Root `package.json` devDependency:**
```json
"@agentworkforce/workload-router": "^0.1.1"
```
This is a private/internal package. External contributors running `npm install` at the repo root will receive a registry 404 or private-registry auth failure. There is no public npm package under this name.

**`packages/memory/package.json` runtime dependency:**
```json
"@agent-relay/memory": "file:../../../relay/packages/memory"
```
This is a `file:` path pointing to a sibling monorepo (`relay/`) that external contributors will not have on their filesystem. Running `npm install` in the `packages/memory/` workspace will fail immediately. This is a hard blocker even for contributors who only want to explore the memory package.

### Impact

Both issues break `npm install` for any external contributor attempting to clone and build the repo. This is the most concrete barrier to open-source adoption — a contributor cannot even get the repo to a runnable state.

### Required fixes

1. Remove `@agentworkforce/workload-router` from root `devDependencies`. If it is needed for internal workflow tooling only, document that these workflows require internal access and remove the dependency from the public-facing install surface.
2. In `packages/memory/package.json`: replace `"@agent-relay/memory": "file:../../../relay/packages/memory"` with either:
   - A published npm version reference (once `@agent-relay/memory` is released publicly), or
   - A stub/interface-only approach that removes the runtime dependency entirely, with a comment explaining that memory implementation requires a relay foundation backend.
   - At minimum: add a root-level `npmrc` or workspace ignore rule so this package's broken dep does not block the monorepo install.

---

## 3. Package License and Publish Configuration

**Score: CONDITIONAL**

### Verified current state

| Package | `"license"` field | `publishConfig.access` |
|---|---|---|
| `@agent-assistant/core` | **MISSING** | `"public"` ✓ |
| `@agent-assistant/sessions` | **MISSING** | `"public"` ✓ |
| `@agent-assistant/surfaces` | **MISSING** | `"public"` ✓ |
| `@agent-assistant/traits` | `"MIT"` ✓ | `"public"` ✓ |
| `@agent-assistant/routing` | `"MIT"` ✓ | **MISSING** |
| `@agent-assistant/connectivity` | **MISSING** | **MISSING** |
| `@agent-assistant/coordination` | **MISSING** | **MISSING** |
| `@agent-assistant/proactive` | `"MIT"` ✓ | **MISSING** |
| `@agent-assistant/policy` | **MISSING** | **MISSING** |
| `@agent-assistant/memory` | `"MIT"` ✓ | **MISSING** |

**Summary:** 6 packages are missing `"license": "MIT"`. 7 packages are missing `publishConfig.access: "public"`. Scoped npm packages default to `restricted` — without `publishConfig`, a publish will silently create a private package that consumers cannot install.

### Package dependency issues

**`packages/coordination/package.json` runtime dependency:**
```json
"dependencies": {
  "@agent-assistant/connectivity": "file:../connectivity"
}
```
`file:` references in `dependencies` (not `devDependencies`) are published as-is. A consumer installing `@agent-assistant/coordination` from npm will receive a `file:` path that resolves to nothing on their machine. This must be changed to a version range (`">=0.1.0"`) before any publish.

**`packages/connectivity/src/types.ts` re-exports from routing:**
Connectivity re-exports `RequestedRoutingMode` and `RoutingEscalationHook` from `@agent-assistant/routing`, but `routing` is declared only as a `devDependency` in `packages/connectivity/package.json`. External consumers who install `@agent-assistant/connectivity` will not receive `routing` as a transitive dependency, making the re-exported types unresolvable.

### Required fixes

1. Add `"license": "MIT"` to `core`, `sessions`, `surfaces`, `connectivity`, `coordination`, `policy` package.json files.
2. Add `"publishConfig": { "access": "public" }` to `routing`, `connectivity`, `coordination`, `proactive`, `policy`, `memory`.
3. Change `packages/coordination/package.json` `file:` dep to `"@agent-assistant/connectivity": ">=0.1.0"` before any publish.
4. In `packages/connectivity/src/types.ts`: remove the `export type { RequestedRoutingMode, RoutingEscalationHook }` re-export from routing, or promote routing to a runtime `dependency`. Removing the re-export is preferred to avoid mandatory coupling.

---

## 4. Connectivity Package Test Blocker

**Score: FAIL (blocked)**

### Verified current state

`packages/connectivity/package.json` declares:
```json
"dependencies": {
  "nanoid": "^5.1.6"
}
```

`packages/connectivity/node_modules/` does not exist — the workspace was never installed. As a result:
- `@agent-assistant/connectivity` tests cannot run
- `@agent-assistant/coordination` tests cannot run (it depends on connectivity)

The declared test counts in `docs/current-state.md` for these packages (87 and 45) are unverified.

### Required fix

Run `npm install` from the repo root (which installs all workspaces) or specifically from `packages/connectivity/`. Verify connectivity and coordination test suites run after install.

---

## 5. Documentation Accuracy

**Score: CONDITIONAL**

### README package map — stale

The README package map currently shows:

| Package | README status |
|---|---|
| `@agent-assistant/proactive` | "placeholder — v1.2" |
| `@agent-assistant/policy` | "placeholder — v2" |

Both packages are fully implemented with passing test suites (53 and 64 tests respectively per the robustness audit report). The README actively misleads external contributors into skipping two working packages.

### `docs/current-state.md` — stale

- Lists `proactive` and `policy` as "placeholder" with "none" for spec — both are implemented with formal specs (`docs/specs/v1-proactive-spec.md`, `docs/specs/v1-policy-spec.md`).
- Claims connectivity has "87 tests" — actual is ~30 (blocked suite; 87 was the pre-block claimed count that was never verified).
- Claims coordination has "45 tests" — actual is ~39.
- "Total verified passing: 128 tests" is understated; with proactive (53) and policy (64) included, the total is higher.
- V1 Baseline section omits `proactive` and `policy` as safe-to-use.

A public contributor reading `current-state.md` gets a materially false picture of the SDK's capabilities. This is a credibility risk on day one of open-source publication.

### Consumer adoption doc — contradicts current-state

`docs/consumer/how-products-should-adopt-agent-assistant-sdk.md` correctly lists proactive and policy as implemented with test counts, but `docs/current-state.md` calls them placeholders. These two documents disagree. `current-state.md` must be updated to be authoritative.

### Required fixes

1. Update README package map: mark `@agent-assistant/proactive` and `@agent-assistant/policy` as **IMPLEMENTED**, update their test counts.
2. Update `docs/current-state.md`:
   - Change proactive and policy from "placeholder" → "IMPLEMENTED"
   - Set their spec column to "IMPLEMENTATION_READY"
   - Add verified test counts to the test results table
   - Add proactive and policy to the V1 Baseline section
   - Correct connectivity and coordination test counts
   - Recalculate "Total verified passing"
3. Reconcile consumer adoption doc status table with updated `current-state.md`.

---

## 6. Naming Consistency and Internal References

**Score: CONDITIONAL**

### Verified current state

**Package scope:** All `package.json` files use `@agent-assistant/*`. All source `import` statements use `@agent-assistant/*`. The rename from `@relay-assistant/*` is complete in code and package manifests. ✓

**Architecture docs:** 200+ references to `@relay-assistant/*` and `RelayAssistant` exist in `docs/architecture/` files. All historical docs carry a header note explaining the rename. This is the correct handling — rewriting history falsifies the record. The volume is high but it is intentionally historical. A newcomer note in `docs/index.md` would help.

**No `.github/workflows/` directory exists.** There is a `workflows/` directory containing internal TypeScript workflow automation (non-GitHub Actions). External contributors will not understand what these files do. This should be documented.

### Required fixes

1. Add a "For newcomers, start here" section at the top of `docs/index.md` pointing to README, the how-to-build guide, and examples. Skip the architecture archive for first-time readers.
2. Add a top-level note in `docs/architecture/` or `docs/index.md` explaining that architecture docs with `@relay-assistant/*` references are historical records from before the rename.
3. Consider adding a brief note in `workflows/README.md` (if present) explaining these are internal workflow automation files, not GitHub Actions, and require internal tooling access to run.

---

## 7. Examples and Onboarding

**Score: PASS (with caveats)**

### What works

- `packages/examples/src/` has five progressive assembly examples (01–05).
- Examples use published package names (`@agent-assistant/*`), not source paths.
- `packages/examples/README.md` is thorough with build order and proof scenarios.
- `docs/consumer/how-to-build-an-assistant.md` provides a complete skeletal assembly walkthrough.

### Remaining gaps

- Examples are typecheck-only — no `test` script in `packages/examples/package.json`. WF-7 (end-to-end assembly) is OPEN.
- Examples reference internal product names (Sage, MSD, NightCTO) — these mean nothing to external contributors but are acceptable for now.
- Build order requires multiple manual upstream builds before typechecking examples. No single root-level `npm run build:all` exists.

These gaps are not blockers for open-source publication but should be addressed before or shortly after launch.

---

## 8. CI/CD and GitHub Infrastructure

**Score: NOT EVALUATED (infrastructure absent)**

There is no `.github/workflows/` directory. No GitHub Actions CI pipeline exists. External contributors opening PRs will have no automated test feedback.

Before open-source publication, at minimum a CI workflow should run `npx vitest run` on PRs. This is a Tier 2 fix — it does not block going public but is expected by the open-source community.

---

## Summary Scorecard

| Dimension | Score | Primary blocker |
|---|---|---|
| Repository governance files | **FAIL** | No LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md |
| Install-blocking dependencies | **FAIL** | `@agentworkforce/workload-router`, `@agent-relay/memory` file path |
| Package license and publish config | **CONDITIONAL** | Missing `license` and `publishConfig` in 6+ packages |
| Connectivity test blocker | **FAIL** | `node_modules` not installed in connectivity workspace |
| Documentation accuracy | **CONDITIONAL** | README and current-state.md show stale placeholder status for proactive/policy |
| Naming consistency | **CONDITIONAL** | Historical docs acceptable; newcomer nav needs improvement |
| Examples and onboarding | **PASS** | No runnable test; acceptable for launch |
| CI/CD | **NOT EVALUATED** | No GitHub Actions pipeline exists |

---

OPEN_SOURCE_READINESS_REPORT_READY
