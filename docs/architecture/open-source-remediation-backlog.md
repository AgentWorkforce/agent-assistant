# Open-Source Remediation Backlog — Agent Assistant SDK

Date: 2026-04-13
Source: [open-source-readiness-rubric.md](open-source-readiness-rubric.md), [open-source-readiness-report.md](open-source-readiness-report.md)

Items are ordered by blocking severity. Tier 1 must be completed before the repo can be made public. Tier 2 must be resolved before any package is published to npm. Tier 3 should be resolved before or shortly after the first tagged release.

---

## Tier 1 — Must fix before going public (BLOCKERS)

These prevent basic use by any external contributor.

---

### T1-1: Add LICENSE file

**Severity:** BLOCKER
**Owner:** repo maintainer
**Effort:** 5 minutes

**Problem:** No `LICENSE` file exists at the repo root. The README says "MIT" but without a license file the code is legally "all rights reserved." GitHub will display "No license" on the repository page.

**Fix:**
Create `/LICENSE` with the standard MIT license text:

```
MIT License

Copyright (c) 2026 AgentWorkforce

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Verification:** `ls LICENSE` returns the file. GitHub repo page shows "MIT license".

---

### T1-2: Remove `@agentworkforce/workload-router` from root devDependencies

**Severity:** BLOCKER
**Owner:** repo maintainer
**Effort:** 10 minutes

**Problem:** `package.json` declares `"@agentworkforce/workload-router": "^0.1.1"` as a devDependency. This is a private/internal package not available on the public npm registry. `npm install` at the repo root fails for any external contributor.

**Fix:**
In `package.json`, remove the entry:
```json
"devDependencies": {
  "@agentworkforce/workload-router": "^0.1.1"   // ← remove this line
}
```

If this dependency is required for internal workflow tooling, document it in `workflows/README.md` as an internal-only prerequisite and exclude it from the public install path.

**Verification:** `npm install` from a clean clone succeeds without needing registry access to `@agentworkforce/*`.

---

### T1-3: Fix `@agent-relay/memory` file reference

**Severity:** BLOCKER
**Owner:** repo maintainer
**Effort:** 30–60 minutes

**Problem:** `packages/memory/package.json` declares:
```json
"dependencies": {
  "@agent-relay/memory": "file:../../../relay/packages/memory"
}
```
This `file:` path points to a sibling monorepo (`relay/`) that external contributors do not have. `npm install` in the memory workspace fails. This also blocks the root-level `npm install` for contributors using npm workspaces.

**Options (choose one):**

**Option A (recommended — stub the dependency):**
Replace the `file:` reference with a peer dependency or remove it entirely. Define the `@agent-relay/memory` interface inline in the memory package (the interface is small — `MemoryAdapter`, `MemoryStore`). Document that a relay foundation backend must be provided by the consumer. This unblocks install without requiring the private package.

**Option B (version reference — requires @agent-relay/memory to be public):**
Replace with `"@agent-relay/memory": ">=0.1.0"`. Only valid once `@agent-relay/memory` is published to the public npm registry.

**Option C (mark memory as not-yet-installable):**
Add `"private": true` to `packages/memory/package.json` and exclude it from the root workspaces array. Document in the README that the memory package requires internal infrastructure not yet publicly available.

**Verification:** `npm install` from repo root completes without errors. `npm install` in `packages/memory/` completes or the workspace is excluded from the install graph.

---

### T1-4: Add CONTRIBUTING.md

**Severity:** BLOCKER
**Owner:** repo maintainer
**Effort:** 30–60 minutes

**Problem:** No `CONTRIBUTING.md` exists. External contributors have no authoritative guidance on how to contribute. This is the minimum governance signal required for an open-source repo accepting PRs.

**Fix:**
Create `CONTRIBUTING.md` at the repo root with at minimum:
- **Getting started:** clone, `npm install`, `npx vitest run` to verify tests pass
- **PR process:** spec first for new packages, implement against spec, include tests
- **Test requirements:** all existing tests must pass; new behavior requires new tests
- **Code style:** TypeScript strict mode, ESM modules, no circular dependencies
- **Contribution policy:** DCO sign-off or CLA — pick one and state it explicitly
- **Issue reporting:** where and how to file bugs

**Verification:** `CONTRIBUTING.md` exists at repo root. Content is accurate against current `npx vitest run` behavior.

---

### T1-5: Update `docs/current-state.md` to reflect actual implementation status

**Severity:** BLOCKER (credibility)
**Owner:** repo maintainer
**Effort:** 30 minutes

**Problem:** `docs/current-state.md` lists `@agent-assistant/proactive` and `@agent-assistant/policy` as "placeholder" packages with "none" for spec. Both are fully implemented with passing test suites and formal specs. An external contributor reading current-state.md skips two working packages.

**Fix — update the following fields:**

Package implementation status table:
- `@agent-assistant/proactive`: status → **IMPLEMENTED**, spec → `IMPLEMENTATION_READY`
- `@agent-assistant/policy`: status → **IMPLEMENTED**, spec → `IMPLEMENTATION_READY`

Test results table — add rows:
- `@agent-assistant/proactive` | `proactive.test.ts` | 53 | **PASS**
- `@agent-assistant/policy` | `policy.test.ts` | 64 | **PASS**

Update known test counts:
- `@agent-assistant/connectivity`: "87 tests claimed" → "~30 actual (blocked by missing node_modules)"
- `@agent-assistant/coordination`: "45 tests claimed" → "~39 actual (blocked by connectivity)"

Update "Total verified passing": recalculate after adding proactive and policy to the passing column.

Update V1 Baseline section: add `@agent-assistant/proactive` and `@agent-assistant/policy` as safe-for-product-use.

**Verification:** `docs/current-state.md` accurately reflects the state returned by `npx vitest run`.

---

## Tier 2 — Must fix before publishing packages to npm

These do not block making the repo public but block any npm publish.

---

### T2-1: Add `"license": "MIT"` to all package.json files

**Severity:** HIGH
**Effort:** 15 minutes

**Problem:** `@agent-assistant/core`, `sessions`, `surfaces`, `connectivity`, `coordination`, `policy` are missing the `"license"` field. npm.com will display "Unlicensed" for these packages.

**Fix:** Add `"license": "MIT"` to each affected `package.json`.

**Packages to update:** core, sessions, surfaces, connectivity, coordination, policy

---

### T2-2: Add `publishConfig.access: "public"` to all publishable packages

**Severity:** HIGH
**Effort:** 15 minutes

**Problem:** `@agent-assistant/routing`, `connectivity`, `coordination`, `proactive`, `policy`, `memory` are missing `"publishConfig": { "access": "public" }`. Scoped packages default to `restricted` on npm — a publish without this flag creates a private package that consumers cannot install.

**Fix:** Add to each affected `package.json`:
```json
"publishConfig": {
  "access": "public"
}
```

**Packages to update:** routing, connectivity, coordination, proactive, policy, memory

---

### T2-3: Fix connectivity routing type re-export / devDep mismatch

**Severity:** HIGH
**Effort:** 30 minutes

**Problem:** `packages/connectivity/src/types.ts` re-exports:
```typescript
export type { RequestedRoutingMode, RoutingEscalationHook } from '@agent-assistant/routing';
```
But `@agent-assistant/routing` is only a `devDependency` in connectivity's `package.json`. Consumers installing `@agent-assistant/connectivity` from npm will not receive routing as a transitive dependency, making these re-exported types unresolvable at build time.

**Fix (preferred — Option A):**
Remove the re-export lines from `packages/connectivity/src/types.ts`. Consumers who need `RequestedRoutingMode` or `RoutingEscalationHook` should install `@agent-assistant/routing` directly.

**Fix (Option B):**
Promote `@agent-assistant/routing` from `devDependencies` to `dependencies` in `packages/connectivity/package.json`. This makes routing a mandatory transitive install for all connectivity consumers.

Option A is preferred because it avoids mandatory coupling.

**Verification:** `packages/connectivity/src/types.ts` exports no types sourced from `@agent-assistant/routing`. OR `packages/connectivity/package.json` lists routing in `dependencies`.

---

### T2-4: Change coordination's `file:` dependency to version range

**Severity:** HIGH
**Effort:** 5 minutes

**Problem:** `packages/coordination/package.json` `dependencies`:
```json
"@agent-assistant/connectivity": "file:../connectivity"
```
`file:` references in `dependencies` (not `devDependencies`) are embedded in the published artifact. A consumer installing `@agent-assistant/coordination` from npm receives a `file:` path that resolves to nothing on their machine.

**Fix:**
```json
"@agent-assistant/connectivity": ">=0.1.0"
```

This change should happen before coordination is published, after connectivity is published to npm.

---

### T2-5: Install connectivity workspace to unblock tests

**Severity:** HIGH
**Effort:** 5 minutes

**Problem:** `packages/connectivity/node_modules/` does not exist. The workspace was never installed. `nanoid` (declared as a runtime dependency) is not available. Connectivity and coordination test suites cannot run.

**Fix:**
```bash
npm install  # from repo root — installs all workspaces
```

Then verify:
```bash
cd packages/connectivity && npx vitest run
cd packages/coordination && npx vitest run
```

**Note:** The declared test counts (87 for connectivity, 45 for coordination) in `current-state.md` were made before install failure — actual counts may differ. Update `current-state.md` after verifying.

---

### T2-6: Update README package map to reflect actual implementation status

**Severity:** HIGH
**Effort:** 15 minutes

**Problem:** The README package map lists:
- `@agent-assistant/proactive` — "placeholder — v1.2"
- `@agent-assistant/policy` — "placeholder — v2"

Both are implemented. An outsider reading the README would skip two functional packages.

**Fix:** Update the README package map table:
- `@agent-assistant/proactive` → **IMPLEMENTED** (follow-up engines, watch rules, scheduler bindings)
- `@agent-assistant/policy` → **IMPLEMENTED** (action classification, gating, approvals, audit hooks)

Update the "Current Status" summary line with correct total test count after T1-5 is done.

---

### T2-7: Add CI GitHub Actions workflow

**Severity:** HIGH
**Effort:** 1–2 hours

**Problem:** No `.github/workflows/` directory exists. External contributors opening PRs receive no automated test feedback. This is expected infrastructure for any open-source project.

**Fix:**
Create `.github/workflows/ci.yml` that:
1. Runs on `push` to `main` and `pull_request`
2. Uses Node.js 20
3. Runs `npm install`
4. Runs `npx vitest run` from repo root
5. Fails the workflow if tests fail

Example minimal workflow:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npx vitest run
```

---

### T2-8: Normalize `repository` field across publishable packages

**Severity:** MEDIUM
**Effort:** 15 minutes

**Problem:** Some packages have no `repository` field in `package.json`. npm.com shows no source link for these packages. The correct GitHub URL should be present in all publishable packages.

**Fix:** Add to each publishable `package.json`:
```json
"repository": {
  "type": "git",
  "url": "https://github.com/AgentWorkforce/agent-assistant-sdk"
}
```

Verify the actual GitHub repo URL matches before adding.

---

## Tier 3 — Improve before or shortly after first tagged release

These improve the experience but do not block adoption.

---

### T3-1: Add CODE_OF_CONDUCT.md

**Severity:** MEDIUM
**Effort:** 10 minutes

Standard for public repos under an org. Create `CODE_OF_CONDUCT.md` using Contributor Covenant 2.1.

---

### T3-2: Add root `npm run build:all` and `npm test` scripts

**Severity:** MEDIUM
**Effort:** 30–60 minutes

**Problem:** Building examples requires manually building four upstream packages in the correct order. External contributors cannot run a single command to verify everything builds.

**Fix:** Add to root `package.json`:
```json
"scripts": {
  "build:all": "npm run build -w packages/traits -w packages/core -w packages/sessions -w packages/surfaces -w packages/routing -w packages/connectivity -w packages/coordination -w packages/proactive -w packages/policy",
  "test": "npx vitest run"
}
```

---

### T3-3: Add newcomer navigation to `docs/index.md`

**Severity:** MEDIUM
**Effort:** 15 minutes

Add a "Start here" section at the top of `docs/index.md` that directs new contributors to: README → `how-to-build-an-assistant.md` → `packages/examples/src/` — skipping the architecture archive entirely.

---

### T3-4: Add smoke tests for examples

**Severity:** MEDIUM
**Effort:** 2–4 hours

**Problem:** `packages/examples/` has no `test` script. WF-7 (end-to-end assembly) is OPEN. Examples are typecheck-only.

**Fix:** Add a `test` script to `packages/examples/package.json` that imports each example, calls its exported function, and verifies basic behavioral assertions (e.g., outbound events were emitted).

---

### T3-5: Add CHANGELOG.md

**Severity:** LOW
**Effort:** 15 minutes

Create `CHANGELOG.md` at repo root with a `## v0.1.0` section summarizing the initial package set and what is implemented vs. deferred.

---

### T3-6: Generalize product-specific references in public-facing docs

**Severity:** LOW
**Effort:** 1–2 hours

**Problem:** Examples and consumer docs reference internal product names (Sage, MSD, NightCTO). External contributors have no context for these names.

**Fix:** Replace with generic archetypes in examples and `how-to-build-an-assistant.md`:
- Sage → "knowledge assistant"
- MSD → "code review assistant"
- NightCTO → "executive assistant"

Leave product names in historical architecture docs (they are intentional historical references).

---

## Remediation Summary

| Item | Tier | Effort | Blocks |
|---|---|---|---|
| T1-1: Add LICENSE | 1 | 5 min | Public launch |
| T1-2: Remove `@agentworkforce/workload-router` | 1 | 10 min | `npm install` |
| T1-3: Fix `@agent-relay/memory` file ref | 1 | 30–60 min | `npm install` |
| T1-4: Add CONTRIBUTING.md | 1 | 30–60 min | Contributor governance |
| T1-5: Update current-state.md | 1 | 30 min | Credibility |
| T2-1: Add `"license": "MIT"` everywhere | 2 | 15 min | npm publish |
| T2-2: Add `publishConfig.access` everywhere | 2 | 15 min | npm publish |
| T2-3: Fix connectivity routing re-export | 2 | 30 min | npm publish correctness |
| T2-4: Fix coordination `file:` dep | 2 | 5 min | npm publish correctness |
| T2-5: Install connectivity workspace | 2 | 5 min | Test verification |
| T2-6: Update README package map | 2 | 15 min | Contributor first impression |
| T2-7: Add CI workflow | 2 | 1–2 hr | PR automation |
| T2-8: Normalize repository field | 2 | 15 min | npm package page |
| T3-1: Add CODE_OF_CONDUCT.md | 3 | 10 min | Community hygiene |
| T3-2: Add build:all / test scripts | 3 | 30–60 min | DX |
| T3-3: Add newcomer nav to docs/index.md | 3 | 15 min | DX |
| T3-4: Add smoke tests for examples | 3 | 2–4 hr | WF-7 closure |
| T3-5: Add CHANGELOG.md | 3 | 15 min | Release hygiene |
| T3-6: Generalize product references | 3 | 1–2 hr | External clarity |

**Tier 1 total:** ~2–3 hours
**Tier 2 total:** ~3–5 hours
**Tier 3 total:** ~4–8 hours

OPEN_SOURCE_REMEDIATION_BACKLOG_READY
