# Robustness Audit Standard

A repeatable audit checklist for the RelayAssistant SDK. Run this audit before any milestone gate, after significant implementation work, or when onboarding a new package to the v1 baseline.

**Goal:** Catch quality shortcuts before they harden into architecture.

**Source of truth:** Code and specs take precedence over docs. See `docs/architecture/source-of-truth.md` for the full hierarchy.

---

## How to Run This Audit

1. Start from a clean working tree (`git stash` or clean checkout).
2. Walk each checklist section below. Record findings as **CONFIRMED** (evidence found), **LIKELY** (strong suspicion, needs investigation), or **CLEAR** (no issue found).
3. Write results to `docs/architecture/robustness-audit-report.md`.
4. Write remediation items to `docs/architecture/robustness-remediation-backlog.md`.
5. A reviewer assesses the outputs and writes `docs/architecture/robustness-audit-review-verdict.md`.

**Automated pre-scan commands** (run before the manual checklist):

```bash
# 1. Non-canonical import scan
rg -n "\.\./\.\./relay/|packages/.*/dist/|src/\.\.\/" . || true

# 2. Test suite run
npx vitest run 2>&1

# 3. Package dependency check — local file: references
rg '"file:' packages/*/package.json || true

# 4. Build artifact imports from src
rg "from ['\"]\..*dist/" packages/*/src/ || true

# 5. Circular or upward package references
rg "from ['\"]@relay-assistant/" packages/*/src/ || true
```

Capture this output as audit context before proceeding.

---

## Checklist 1: Non-Canonical Imports and Local Path Shortcuts

**What to catch:** Dependencies that reach outside the package boundary via relative paths, reference sibling `dist/` directories, or use `file:` links to repos outside this monorepo.

| # | Check | How to verify | Severity |
|---|-------|---------------|----------|
| 1.1 | No `../../relay/` or `../../../relay/` imports in source or config | `rg -n "\.\./\.\./relay/" .` | **HIGH** — couples SDK to local filesystem layout |
| 1.2 | No `file:` dependency references pointing outside the monorepo | `rg '"file:' packages/*/package.json` — flag any path containing `../` that escapes the repo root | **HIGH** — breaks CI and external consumers |
| 1.3 | No source files importing from sibling package `dist/` directories | `rg "from ['\"]\..*dist/" packages/*/src/` | **MEDIUM** — fragile build-order coupling |
| 1.4 | No `src/../` path gymnastics in source files | `rg "src/\.\.\/" packages/*/src/` | **MEDIUM** — indicates broken module boundaries |
| 1.5 | All `@relay-assistant/*` cross-package imports resolve to published entry points, not deep paths | `rg "from ['\"]@relay-assistant/[^'\"]+/" packages/*/src/` — flag any that go deeper than the package name | **MEDIUM** — violates encapsulation |

---

## Checklist 2: Documentation Overclaiming

**What to catch:** Docs that state capabilities, test counts, or stability claims that exceed what code and tests actually prove.

| # | Check | How to verify | Severity |
|---|-------|---------------|----------|
| 2.1 | Test counts in README and `current-state.md` match actual `npx vitest run` output | Run tests, compare numbers. Tolerate ±2 for in-flight work; flag discrepancies > 2 | **HIGH** — misleads consumers |
| 2.2 | Package status markers (`IMPLEMENTED`, `SPEC_RECONCILED`, etc.) match reality | For each package marked IMPLEMENTED: confirm source files exist beyond `index.ts` re-exports, and tests exist and pass | **HIGH** — masks placeholder packages |
| 2.3 | "Stable" or "v1 baseline" claims have passing test suites | Every package listed as v1 baseline must have tests that run and pass without manual intervention | **HIGH** — false stability signal |
| 2.4 | Workflow completion claims match actual test/build proof | For each workflow marked COMPLETE in `docs/workflows/`: verify the claimed tests or integration points exist | **MEDIUM** — inflated progress |
| 2.5 | Spec status markers (`SPEC_RECONCILED` vs `IMPLEMENTATION_READY`) are accurate | For `SPEC_RECONCILED`: verify a review verdict exists confirming code-spec agreement. For `IMPLEMENTATION_READY`: verify the spec exists in `docs/specs/` | **MEDIUM** — false confidence in code-spec alignment |
| 2.6 | Consumer-facing docs do not reference unimplemented features as available | Scan `docs/consumer/` for package names that are still placeholder status | **HIGH** — causes adoption failures |

---

## Checklist 3: Integration Overclaiming

**What to catch:** Integration claims (cross-package wiring, assembly examples, product adoption paths) that exceed what tests and builds actually verify.

| # | Check | How to verify | Severity |
|---|-------|---------------|----------|
| 3.1 | Every cross-package integration claim has a corresponding test | Check `packages/integration/` and any `*-integration.test.ts` files. Flag integration claims in docs that lack test coverage | **HIGH** — unverified wiring |
| 3.2 | Assembly examples in `packages/examples/` actually compile | `cd packages/examples && npx tsc --noEmit` | **HIGH** — broken examples destroy trust |
| 3.3 | Examples only import packages at their documented stability tier | Flag examples that import packages marked as blocked or below DoD | **MEDIUM** — examples should model correct adoption |
| 3.4 | Product adoption paths reference only packages that pass their own tests | Cross-reference `docs/consumer/*-adoption-path.md` against `docs/current-state.md` test results | **HIGH** — recommending broken packages |

---

## Checklist 4: Placeholder and Stub Detection

**What to catch:** Packages or features that appear implemented (have source files, pass in CI) but contain only stubs, no-ops, or trivial pass-through logic.

| # | Check | How to verify | Severity |
|---|-------|---------------|----------|
| 4.1 | Source files contain substantive logic, not just type re-exports | For each package marked IMPLEMENTED: open the main source file (e.g., `packages/{name}/src/{name}.ts`). Flag if the file is < 30 lines or contains only type definitions and re-exports | **HIGH** — hollow implementation |
| 4.2 | Tests verify behavior, not just construction | Scan test files for the ratio of "creates X" / "constructs X" tests vs. behavioral assertions. Flag suites where > 50% of tests are construction-only | **MEDIUM** — tests that prove nothing |
| 4.3 | No `TODO`/`FIXME`/`stub` markers hiding behind passing tests | `rg -i "todo\|fixme\|stub\|not.implemented\|placeholder" packages/*/src/` | **MEDIUM** — acknowledged gaps |
| 4.4 | Packages with claimed test counts but blocked test suites are flagged, not counted | Verify that `current-state.md` does not include blocked test counts in totals | **HIGH** — inflated metrics |

---

## Checklist 5: Package Boundary Leakage

**What to catch:** Runtime or type-level coupling that violates the intended package dependency graph.

| # | Check | How to verify | Severity |
|---|-------|---------------|----------|
| 5.1 | Each package's `package.json` declares only its actual dependencies | For each package: compare `dependencies` and `devDependencies` against actual `import` statements in `src/`. Flag undeclared imports and unused declared deps | **HIGH** — broken installs for consumers |
| 5.2 | No circular dependencies between packages | Trace `@relay-assistant/*` imports across all packages. Flag any cycle | **HIGH** — breaks tree-shaking and reasoning |
| 5.3 | Package `index.ts` exports match the spec's public API surface | For each package with a spec: compare `export` statements in `index.ts` against the spec's "Exports" or "Public API" section | **MEDIUM** — spec/code drift |
| 5.4 | No runtime code in type-only files (`types.ts`) | `rg "^(export )?(function\|class\|const .* = )" packages/*/src/types.ts` — flag non-type exports | **LOW** — layer confusion |
| 5.5 | `tsconfig.json` `references` or `paths` do not create implicit coupling | Review each package's `tsconfig.json` for `paths` or `references` that bypass `package.json` dependency declarations | **MEDIUM** — hidden coupling |

---

## Checklist 6: Build and Test Proof

**What to catch:** Missing or fragile build/test infrastructure that masks failures or creates order-dependent builds.

| # | Check | How to verify | Severity |
|---|-------|---------------|----------|
| 6.1 | Every IMPLEMENTED package has a test file that runs | `npx vitest run` — every package marked IMPLEMENTED must appear in output with a PASS or explicit FAIL (not silently skipped) | **HIGH** — silent skip = false green |
| 6.2 | Tests do not depend on build artifacts from other packages | Check if any test imports resolve through `dist/` of a sibling package. If so, tests break when `dist/` is stale | **HIGH** — fragile CI |
| 6.3 | `npx vitest run` succeeds from a clean clone (no pre-build step required) | Clone the repo fresh, run `npm install && npx vitest run`. Flag if a manual build step is needed first | **HIGH** — broken onboarding |
| 6.4 | No tests depend on external services or network access | `rg "fetch\|http\|localhost\|127\.0\.0\.1" packages/*/src/*.test.ts` — flag any that aren't clearly mocked | **MEDIUM** — flaky in CI |
| 6.5 | Package `main` and `types` fields in `package.json` point to files that exist | For each package: verify the paths in `main`, `types`, and `exports` actually resolve | **HIGH** — broken package for consumers |
| 6.6 | Blocked packages are explicitly documented with resolution path | Every test suite that cannot run must have an entry in `current-state.md` "Known Blockers" with impact, resolution, and risk | **MEDIUM** — hidden debt |

---

## Checklist 7: Consumer/Adoption Doc Accuracy

**What to catch:** Adoption guides, product integration paths, and "how to" docs that recommend packages or patterns not yet proven safe.

| # | Check | How to verify | Severity |
|---|-------|---------------|----------|
| 7.1 | `how-to-build-an-assistant.md` only uses v1-baseline packages in its primary path | Read the doc. Flag any code example that imports a non-baseline package without an explicit "beyond v1" caveat | **HIGH** — leads consumers into broken paths |
| 7.2 | Product adoption paths (`sage-adoption-path.md`, etc.) do not recommend gated packages | Cross-reference each adoption path against the gating notes in `current-state.md` | **HIGH** — products adopt broken code |
| 7.3 | `how-products-should-adopt-relay-agent-assistant.md` reflects current package status | Verify every package mentioned has its current status accurately represented | **MEDIUM** — stale guidance |
| 7.4 | Code snippets in consumer docs compile against current package exports | Extract import statements from consumer docs and verify they resolve | **MEDIUM** — broken copy-paste examples |
| 7.5 | Adoption matrix (`consumer-adoption-matrix.md`) matches `current-state.md` | Compare stability tiers, readiness markers, and blocker notes between the two | **MEDIUM** — conflicting signals |
| 7.6 | No adoption doc recommends a package whose tests are blocked | Cross-reference all `docs/consumer/` files against blocked packages in `current-state.md` | **HIGH** — recommending unverified code |

---

## Severity Guide

| Level | Meaning | Action |
|-------|---------|--------|
| **HIGH** | Directly misleads consumers or masks broken state | Must remediate before next milestone gate |
| **MEDIUM** | Creates confusion or technical debt but does not block adoption | Should remediate within current milestone |
| **LOW** | Cosmetic or minor structural issue | Track, fix opportunistically |

---

## Audit Report Format

The audit report (`docs/architecture/robustness-audit-report.md`) must use this structure:

```markdown
# Robustness Audit Report — [DATE]

## Summary
- Total checks: [N]
- CONFIRMED issues: [N]
- LIKELY issues: [N]
- CLEAR: [N]
- HIGH severity: [N]
- MEDIUM severity: [N]

## Findings

### [Checklist Section Name]

#### Check [N.N]: [Check title]
- **Status:** CONFIRMED | LIKELY | CLEAR
- **Severity:** HIGH | MEDIUM | LOW
- **Evidence:** [specific file, line, command output]
- **Remediation:** [concrete action item]
```

---

## Remediation Backlog Format

The remediation backlog (`docs/architecture/robustness-remediation-backlog.md`) must prioritize by severity, then by consumer impact:

```markdown
# Robustness Remediation Backlog — [DATE]

## HIGH — Must Fix Before Gate

| # | Finding | Package(s) | Remediation | Owner |
|---|---------|------------|-------------|-------|

## MEDIUM — Fix Within Milestone

| # | Finding | Package(s) | Remediation | Owner |
|---|---------|------------|-------------|-------|

## LOW — Track

| # | Finding | Package(s) | Remediation | Owner |
|---|---------|------------|-------------|-------|
```

---

## When to Re-Run

- Before any milestone gate (v1.1, v1.2, v2)
- After promoting a package from placeholder to IMPLEMENTED
- After unblocking a previously blocked test suite
- After any change to `docs/consumer/` adoption guides
- After adding a new package to the monorepo

---

ROBUSTNESS_AUDIT_STANDARD_READY
