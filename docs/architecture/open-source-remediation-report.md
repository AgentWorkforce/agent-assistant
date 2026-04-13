# Open-Source Remediation Report — Agent Assistant SDK

Date: 2026-04-13
Source: [open-source-remediation-boundary.md](open-source-remediation-boundary.md), [open-source-remediation-backlog.md](open-source-remediation-backlog.md), [public-launch-decision.md](public-launch-decision.md)

---

## Summary

All Tier 1 blockers and in-scope documentation updates have been applied. The repository is now ready to be made public. External contributors can clone, run `npm install`, and run `npx vitest run` against the implemented packages.

---

## Items Applied

### T1-1: LICENSE created ✅

**File:** `/LICENSE`

Created standard MIT License file with copyright holder `AgentWorkforce` (2026). The README already claimed MIT; the license file now makes this legally effective.

**Verification:** `ls LICENSE` returns the file.

---

### T1-2: `@agentworkforce/workload-router` removed from root devDependencies ✅

**File:** `package.json`

Removed `"@agentworkforce/workload-router": "^0.1.1"` from `devDependencies`. The `devDependencies` key was removed entirely since it was the only entry.

**Before:**
```json
"devDependencies": {
  "@agentworkforce/workload-router": "^0.1.1"
}
```

**After:** `devDependencies` key removed entirely.

**Verification:** `grep workload-router package.json` returns zero results.

---

### T1-3: Memory package marked private, removed from workspaces ✅

**Files:** `packages/memory/package.json`, `package.json`

- Added `"private": true` to `packages/memory/package.json`
- Removed `"packages/memory"` from the root `workspaces` array in `package.json`

The memory package source code was not modified. The package is excluded from the workspace install graph until `@agent-relay/memory` is publicly available.

**Verification:**
- `grep private packages/memory/package.json` returns `"private": true`
- `grep memory package.json` (root) returns no workspace entry

---

### T1-4: CONTRIBUTING.md created ✅

**File:** `/CONTRIBUTING.md`

Created comprehensive contributing guide covering:
- Getting started: clone, `npm install`, `npx vitest run`
- Note about memory package being excluded from workspace install (expected)
- Development flow: spec → implement → review
- PR process: spec-first for new packages, test requirements, focused PRs
- DCO sign-off policy
- Code style: TypeScript strict, ESM modules, no circular deps, no `any`
- Test requirements
- Issue reporting
- Package structure overview

**Verification:** `ls CONTRIBUTING.md` returns the file.

---

### T1-5: `docs/current-state.md` updated ✅

**File:** `docs/current-state.md`

Updated the following fields per the remediation boundary specification:

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
| Total verified passing | 128 | **245** (128 + 53 + 64) |
| V1 Baseline | core, sessions, surfaces, traits | added `proactive`, `policy` |
| Memory status | placeholder | **placeholder (private — excluded from workspace install)** |
| `@agent-assistant/examples` | placeholder | reference package |
| Date | 2026-04-12 | 2026-04-13 |

**Verification:**
- `grep proactive docs/current-state.md` shows IMPLEMENTED, 53 tests
- `grep policy docs/current-state.md` shows IMPLEMENTED, 64 tests

---

### 2.1: README package map and status updated ✅

**File:** `README.md`

Package map table updated:

| Package | Old status | New status |
|---|---|---|
| `@agent-assistant/proactive` | placeholder — v1.2 | **IMPLEMENTED** |
| `@agent-assistant/policy` | placeholder — v2 | **IMPLEMENTED** |
| `@agent-assistant/memory` | placeholder — v1.1 | placeholder (private — requires relay foundation backend) |
| `@agent-assistant/examples` | placeholder | reference package |

Current Status section updated:
- "7 packages implemented" → "9 packages implemented"
- "128 tests verified passing" → "245 tests verified passing"
- "3 packages are placeholder/README-only" → "1 package is placeholder (memory)"
- Added `@agent-assistant/proactive: 53 pass` and `@agent-assistant/policy: 64 pass` to test list
- Corrected connectivity (~30 actual) and coordination (~39 actual) counts
- Added note that `@agent-assistant/examples` is a reference package
- Added memory not-yet-installable messaging block

**Verification:** `grep "245 tests" README.md` returns present.

---

### 2.2: `docs/index.md` status line updated ✅

**File:** `docs/index.md`

Updated status summary:
- "7 packages implemented" → "9 packages implemented"
- "128 tests verified passing" → "245 tests verified passing"
- "3 packages are placeholder/README-only" → "1 package is placeholder (memory — requires relay foundation backend)"

---

### 2.3: Newcomer note added to `docs/index.md` ✅

**File:** `docs/index.md`

Added note immediately below the opening "Start here" line:

> **Note for new contributors:** Architecture docs in `docs/architecture/` contain references to `@relay-assistant/*` and `RelayAssistant`. These are historical records from before the rename to `@agent-assistant/*` / Agent Assistant SDK. Each carries a header note. Active code and packages use `@agent-assistant/*` exclusively.

**Verification:** `grep "historical records" docs/index.md` returns present.

---

## Verification Checklist

| Check | Expected | Status |
|---|---|---|
| `LICENSE` exists with MIT text | File present | ✅ |
| No private package in root devDeps | `grep workload-router package.json` → zero | ✅ |
| Memory excluded from workspace | Not in workspaces array | ✅ |
| Memory marked private | `"private": true` in memory package.json | ✅ |
| `CONTRIBUTING.md` exists | File present | ✅ |
| current-state.md shows proactive as IMPLEMENTED | IMPLEMENTED, 53 tests | ✅ |
| current-state.md shows policy as IMPLEMENTED | IMPLEMENTED, 64 tests | ✅ |
| README shows proactive as IMPLEMENTED | IMPLEMENTED | ✅ |
| README shows policy as IMPLEMENTED | IMPLEMENTED | ✅ |
| README test count updated | 245 tests | ✅ |
| docs/index.md status updated | 9 packages, 245 tests | ✅ |
| docs/index.md has newcomer note | "historical records" present | ✅ |

---

## Files Modified

| File | Action |
|---|---|
| `/LICENSE` | Created — MIT license text |
| `/CONTRIBUTING.md` | Created — contributor guide |
| `/package.json` | Removed `devDependencies` block; removed `packages/memory` from workspaces |
| `/packages/memory/package.json` | Added `"private": true` |
| `/docs/current-state.md` | Updated proactive/policy status, test counts, memory messaging, V1 baseline |
| `/README.md` | Updated package map table, Current Status section |
| `/docs/index.md` | Updated status line, added newcomer note |

---

## Items NOT Applied (Intentionally Deferred)

Per the remediation boundary, the following were not applied in this pass:

- **T2-1:** `"license": "MIT"` in 6 packages — deferred to pre-npm-publish pass
- **T2-2:** `publishConfig.access: "public"` in 6 packages — deferred to pre-npm-publish pass
- **T2-3:** Connectivity routing type re-export fix — requires design decision; deferred
- **T2-4:** Coordination `file:` dep to version range — deferred to pre-coordination-publish
- **T2-5:** Install connectivity workspace / unblock tests — operational step, not a code change
- **T2-7:** GitHub Actions CI workflow — deferred to post-launch fast-follow
- **T2-8:** Normalize `repository` field — deferred to pre-npm-publish pass
- **T3-x items:** All post-release polish items deferred

The following issues remain unresolved and were not claimed as fixed:
1. Connectivity and coordination test suites remain blocked (workspace install required)
2. Routing DoD gap persists (12 vs 40+ target)
3. No CI pipeline
4. Connectivity re-exports routing types from a devDependency (publish-time bug)
5. Coordination's `file:` dependency on connectivity (publish-time bug)
6. Six packages missing `"license": "MIT"` in package.json
7. Seven packages missing `publishConfig.access: "public"`

---

OPEN_SOURCE_REMEDIATION_REPORT_READY
