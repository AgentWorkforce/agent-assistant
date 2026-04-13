# Public Launch Decision — Agent Assistant SDK

Date: 2026-04-13
Based on: [open-source-readiness-rubric.md](open-source-readiness-rubric.md), [open-source-readiness-report.md](open-source-readiness-report.md), [open-source-remediation-backlog.md](open-source-remediation-backlog.md)

---

## Launch Verdict

**READY_WITH_FIXES**

The repo **cannot be made public today** in its current state. It **can be made public after Tier 1 fixes** are applied (estimated 2–3 hours of work). Tier 2 fixes must be completed before any npm package is published.

---

## What blocks launch right now

Four issues prevent any external contributor from using this repo:

| # | Issue | Evidence | Fix |
|---|---|---|---|
| 1 | **No LICENSE file** | `ls LICENSE` → not found | Create `LICENSE` with MIT text |
| 2 | **`npm install` fails — private package** | `"@agentworkforce/workload-router": "^0.1.1"` in root `devDependencies` | Remove from `package.json` |
| 3 | **`npm install` fails — broken file path** | `packages/memory/package.json`: `"@agent-relay/memory": "file:../../../relay/packages/memory"` | Stub the dep or mark memory as private |
| 4 | **No CONTRIBUTING.md** | File does not exist | Create with PR process and test requirements |

Additionally, `docs/current-state.md` incorrectly lists two implemented packages (`proactive`, `policy`) as placeholders. Publishing with stale docs causes immediate credibility damage. This is also required before launch.

---

## What is in good shape

These do not block launch but are worth noting as strengths:

- All `package.json` files use `@agent-assistant/*` scope consistently. The rename from `@relay-assistant/*` is complete in code and manifests.
- Four packages are fully implemented with clean boundaries and passing tests: `core` (31+6), `sessions` (25), `surfaces` (28), `traits` (32).
- `proactive` (53 tests) and `policy` (64 tests) are implemented and passing despite the stale documentation.
- The README is well-structured with a clear purpose statement, quick-start code, and package map.
- The spec → implement → review development flow is documented and consistently followed.
- Architecture docs are thorough and historical docs carry the rename header note.
- Five progressive assembly examples exist in `packages/examples/`.

---

## Launch readiness by phase

### Phase 1: Repo goes public

**Required before flipping the repo from private to public:**

1. ✅ T1-1: `LICENSE` file at repo root
2. ✅ T1-2: Remove `@agentworkforce/workload-router` from root `devDependencies`
3. ✅ T1-3: Fix `@agent-relay/memory` `file:` reference (stub, gate, or mark private)
4. ✅ T1-4: Create `CONTRIBUTING.md`
5. ✅ T1-5: Update `docs/current-state.md` and README package map to reflect proactive/policy as implemented

**Estimated effort:** 2–3 hours.

After these five changes, the repo can be made public. External contributors can clone it, run `npm install`, run `npx vitest run`, and see passing tests for the implemented packages.

---

### Phase 2: First npm publish

**Required before publishing any package to npm:**

6. ✅ T2-1: Add `"license": "MIT"` to core, sessions, surfaces, connectivity, coordination, policy
7. ✅ T2-2: Add `"publishConfig": { "access": "public" }` to routing, connectivity, coordination, proactive, policy, memory
8. ✅ T2-3: Fix connectivity routing type re-export / devDep mismatch
9. ✅ T2-4: Change coordination's `file:` dep to `"@agent-assistant/connectivity": ">=0.1.0"`
10. ✅ T2-5: Run `npm install` to unblock connectivity/coordination test suites; verify counts
11. ✅ T2-7: Add `.github/workflows/ci.yml` for automated PR testing
12. ✅ T2-8: Normalize `repository` field in all publishable packages

**Publish order for v0.1.0 initial publish:**
1. `@agent-assistant/traits` (no SDK deps)
2. `@agent-assistant/core` (peerDep on traits)
3. `@agent-assistant/sessions` (independent)
4. `@agent-assistant/surfaces` (independent)

Defer publish of `routing`, `connectivity`, `coordination`, `proactive`, `policy`, `memory` until their specific blockers (DoD gap, test verification, or external dep resolution) are resolved.

**Estimated effort:** 3–5 hours.

---

### Phase 3: Stable public release

**Should be resolved before or shortly after first tagged release:**

13. T3-1: Add `CODE_OF_CONDUCT.md`
14. T3-2: Add root `npm run build:all` and `npm test` scripts
15. T3-3: Add newcomer navigation to `docs/index.md`
16. T3-4: Add smoke tests for examples (close WF-7)
17. T3-5: Add `CHANGELOG.md`
18. T3-6: Generalize Sage/MSD/NightCTO references to generic archetypes in public docs

**Estimated effort:** 4–8 hours.

---

## Decision rationale

**Why READY_WITH_FIXES and not NOT_READY:**

The blockers are well-defined and mechanical. None require design decisions or architectural changes. The underlying SDK code is high quality: 7 packages implemented, 240+ tests passing across the verified suites, clear spec-driven development, and a coherent architecture. The blockers are governance and dependency hygiene issues, not fundamental readiness gaps.

**Why not READY_NOW:**

A repo with no LICENSE file, a broken `npm install`, and stale docs claiming working packages are placeholders is not ready for public consumption. These are the minimum table-stakes for any open-source project.

---

## Recommended action

1. Execute T1-1 through T1-5 in a single focused pass.
2. Verify: `npm install` succeeds from a clean clone, `npx vitest run` shows passing suites, `docs/current-state.md` matches actual test output.
3. Flip the GitHub repo from private to public.
4. Execute T2-1 through T2-8 as a second pass.
5. Publish `traits`, `core`, `sessions`, `surfaces` to npm as v0.1.0.
6. File issues for T3 items as post-launch polish.

PUBLIC_LAUNCH_DECISION_READY
