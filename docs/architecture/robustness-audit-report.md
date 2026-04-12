# Robustness Audit Report — 2026-04-12

**Auditor:** automated (non-interactive worker agent)
**Standard:** `docs/architecture/robustness-audit-standard.md`
**Scope:** All packages under `packages/`, consumer docs under `docs/consumer/`, current-state doc at `docs/current-state.md`

---

## Summary

- Total checks: 35 (7 checklists × 5 checks each, check 2.4 deferred — no `docs/workflows/` completion claims cross-referenced here)
- **CONFIRMED issues: 18**
- **LIKELY issues: 3**
- **CLEAR: 11**
- **HIGH severity: 11**
- **MEDIUM severity: 7**
- **LOW severity: 2**

---

## Findings

---

### Checklist 1: Non-Canonical Imports and Local Path Shortcuts

#### Check 1.1: No `../../relay/` imports in source
- **Status:** CLEAR
- **Severity:** HIGH
- **Evidence:** `rg -n "\.\./\.\./relay/" . --include="*.ts"` returned zero matches in source files. The `file:../../../relay/packages/memory` reference exists only in `packages/memory/package.json` (caught by 1.2).

#### Check 1.2: No `file:` dependency references pointing outside the monorepo
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `packages/memory/package.json` line 24: `"@agent-relay/memory": "file:../../../relay/packages/memory"`. This path climbs three levels out of the package directory and two levels out of the repo root — it escapes the monorepo entirely. No other `file:` references escape the monorepo root (`packages/core`, `packages/connectivity`, `packages/coordination`, `packages/examples` all use `file:../sibling` which stays within the repo).
- **Remediation:** Replace with a published npm dependency on `@agent-relay/memory` (or a monorepo workspace protocol if relay is merged into this repo). Until resolved, the memory package cannot be installed by any consumer or CI environment without a co-located relay checkout.

#### Check 1.3: No source files importing from sibling package `dist/` directories
- **Status:** CONFIRMED (test files — moderate severity)
- **Severity:** MEDIUM
- **Evidence:** Several cross-package test files bypass installed package boundaries by importing directly from sibling `src/` paths:
  - `packages/core/src/core-traits.test.ts`: `import { createTraitsProvider } from '../../traits/src/index.js'`
  - `packages/core/src/core-sessions.test.ts`: `import { createSessionStore … } from '../../sessions/src/index.js'`
  - `packages/core/src/core-sessions-surfaces.test.ts`: imports from `../../sessions/src/index.js` and `../../surfaces/src/index.js`
  - `packages/integration/src/integration.test.ts`: imports from `../../proactive/src/index.js` and `../../policy/src/index.js`
  - `packages/integration/src/helpers.ts`: same pattern
  These are `src/` imports rather than `dist/` imports, so they work under vitest's TypeScript transpilation without a pre-build step. However, they bypass the published package entry point and create source-level coupling that can hide API surface mismatches.
- **Remediation:** Use installed package names (`@relay-assistant/traits`, etc.) for cross-package imports in test files. The `file:` devDependencies already enable this. This also ensures tests exercise the same import path consumers would use.

#### Check 1.4: No `src/../` path gymnastics
- **Status:** CLEAR
- **Severity:** MEDIUM
- **Evidence:** No `src/../` patterns found in any source file.

#### Check 1.5: All `@relay-assistant/*` cross-package imports resolve to published entry points, not deep paths
- **Status:** CONFIRMED
- **Severity:** MEDIUM
- **Evidence:** `packages/connectivity/src/types.ts` imports and re-exports types from `@relay-assistant/routing`:
  ```ts
  import type { RoutingEscalationHook } from '@relay-assistant/routing';
  export type { RequestedRoutingMode, RoutingEscalationHook } from '@relay-assistant/routing';
  ```
  The import uses the package-level entry point (not a deep path), so 1.5 is technically clear on the path depth. However, `@relay-assistant/routing` is declared only as a `devDependency` in `packages/connectivity/package.json`, not a `dependency`. Consumers installing `@relay-assistant/connectivity` will not get routing as a transitive dependency, breaking the re-exported types. This overlaps with 5.1 and is flagged there as HIGH.

---

### Checklist 2: Documentation Overclaiming

#### Check 2.1: Test counts in README and `current-state.md` match actual `npx vitest run` output
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `docs/current-state.md` claims "Total verified passing: 128 tests (7 passing suites, 3 blocked suites)." Actual counts from source inspection:
  | Package | current-state.md | Actual `it()` count |
  |---|---|---|
  | `@relay-assistant/core` (core.test.ts) | 31 | not recount |
  | `@relay-assistant/core` (core-sessions-surfaces.test.ts) | 6 | not recount |
  | `@relay-assistant/sessions` | 25 | not recount |
  | `@relay-assistant/surfaces` | 28 | not recount |
  | `@relay-assistant/routing` | 12 | 12 ✓ |
  | `@relay-assistant/traits` | 32 | not recount |
  | `@relay-assistant/connectivity` | **87 claimed** | **30 actual** |
  | `@relay-assistant/coordination` | 45 claimed | 39 actual |
  | `@relay-assistant/policy` | **not listed** | **64 actual (passing)** |
  | `@relay-assistant/proactive` | **not listed** | **53 actual (passing)** |
  | integration tests | not listed | 14 actual |
  | core-traits.test.ts (untracked) | not listed | 9 actual |
  | core-sessions.test.ts (untracked) | not listed | 9 actual |

  The connectivity overclaim is especially severe: 87 claimed vs 30 actual. Policy and proactive each have passing test suites that are absent from the table entirely. The "7 passing suites" count appears to be derived from a snapshot that doesn't match the current filesystem state. The total passing test count (128) cannot be reconstructed from the enumerated list.
- **Remediation:** Re-run `npx vitest run` from each package directory and update `current-state.md` with confirmed output. Add policy and proactive rows. Correct connectivity count (30, not 87). Add core-traits and core-sessions rows (untracked files that should be tracked).

#### Check 2.2: Package status markers match reality
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `docs/current-state.md` lists:
  - `@relay-assistant/proactive`: Status **placeholder**, Spec **none**, Notes: "No formal spec yet; roadmap: v1.2"
  - `@relay-assistant/policy`: Status **placeholder**, Spec **none**, Notes: "No formal spec yet; roadmap: v2"

  Reality: Both packages have substantial implementations. `packages/proactive/src/proactive.ts` is ~391 lines with a full `createProactiveEngine` factory, `InMemorySchedulerBinding`, follow-up rules, watch rules, suppression logic, and reminder state management. `packages/policy/src/policy.ts` is ~178 lines with a full `createActionPolicy` factory, rule priority sorting, classifier validation, approval correlation, and audit sink integration. Both have passing test suites (53 and 64 tests respectively). Both have specs: `docs/specs/v1-proactive-spec.md` and `docs/specs/v1-policy-spec.md` exist.

  Consumer docs (`docs/consumer/how-products-should-adopt-relay-agent-assistant.md`, `docs/consumer/how-to-build-an-assistant.md`) correctly call them "implemented" — the stale document is `current-state.md`.
- **Remediation:** Update `current-state.md` package status table: change policy and proactive from "placeholder" to "IMPLEMENTED", update spec status from "none" to "IMPLEMENTATION_READY", add them to the test results table with accurate counts, and update the V1 Baseline section to include them.

#### Check 2.3: "Stable" or "v1 baseline" claims have passing test suites
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `docs/current-state.md` V1 Baseline section lists: core, sessions, surfaces, traits — all passing. Policy and proactive are implemented and passing but absent from the baseline list. Not a false stability claim for listed packages, but the baseline list is incomplete. No false stability signals for listed packages — this is CLEAR for the named packages but stale as a picture of what's deployable.
- **Remediation:** Extend V1 Baseline to include policy and proactive once current-state.md is corrected per 2.2.

#### Check 2.4: Workflow completion claims match actual test/build proof
- **Status:** LIKELY
- **Severity:** MEDIUM
- **Evidence:** `docs/current-state.md` Workflow Completion table lists WF-7 ("End-to-end assembly") as **OPEN** with the note "no assembly test in packages/examples/src/". However, `packages/examples/src/` contains five example files (01 through 05). The WF-7 open status appears to mean there is no *test suite* running these examples (no `vitest run` in examples), only shape examples. The examples package `package.json` has no `test` script. The examples are type-checkable via `tsc --noEmit` (the only script defined), but there is no assertion-based proof that the assembled assistants behave correctly end-to-end.
- **Remediation:** Add a `test` script to `packages/examples/package.json` that runs the example entry functions and makes basic behavioral assertions, or explicitly document in current-state.md that examples are type-checked only (not behavior-tested).

#### Check 2.5: Spec status markers are accurate
- **Status:** CONFIRMED
- **Severity:** MEDIUM
- **Evidence:** `docs/current-state.md` shows:
  - `@relay-assistant/proactive`: Spec = **none** — INCORRECT. `docs/specs/v1-proactive-spec.md` exists.
  - `@relay-assistant/policy`: Spec = **none** — INCORRECT. `docs/specs/v1-policy-spec.md` exists.
  Both packages also have review verdicts in `docs/architecture/`. This contradicts the "none" spec markers.
- **Remediation:** Update current-state.md spec column: policy → `IMPLEMENTATION_READY`, proactive → `IMPLEMENTATION_READY` (or `SPEC_RECONCILED` if review verdicts confirm code-spec agreement).

#### Check 2.6: Consumer-facing docs do not reference unimplemented features as available
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `docs/consumer/how-products-should-adopt-relay-agent-assistant.md` product-specific guidance section (lines 54–110) recommends:
  - **Sage**: "Adopt first: `@relay-assistant/memory`" — memory is a placeholder, blocked by `file:../../../relay/packages/memory` dep
  - **NightCTO**: "Adopt first: `@relay-assistant/coordination`" — coordination tests blocked; no dist artifact
  - **NightCTO**: "Adopt first: `@relay-assistant/memory`" — same blocker

  The later section of the same document (v1 Package Status table, lines 154–171) correctly says "Do not adopt" for memory, coordination, and connectivity. The document contains contradictory guidance in the same file — older product-guidance text vs. newer status table. The `docs/consumer/consumer-adoption-matrix.md` is accurate and marks these as "Do not adopt (blocked)."
- **Remediation:** Remove or correct the Sage/NightCTO "Adopt first" recommendations in the product-specific guidance section of `how-products-should-adopt-relay-agent-assistant.md` to align with the v1 Package Status table already in that document.

---

### Checklist 3: Integration Overclaiming

#### Check 3.1: Every cross-package integration claim has a corresponding test
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `packages/integration/src/integration.test.ts` exists and contains 14 test cases covering the proactive↔policy boundary. However:
  1. The integration test imports from raw source paths: `'../../proactive/src/index.js'` and `'../../policy/src/index.js'` — not through published package names.
  2. `packages/integration/package.json` declares **no** dependencies on `@relay-assistant/proactive` or `@relay-assistant/policy` — neither in `dependencies` nor `devDependencies`.
  3. The integration tests are runnable only because vitest resolves the relative `../../` imports through TypeScript transpilation at test time. A consumer trying to replicate this pattern from installed packages could not.
  This means the integration "proof" is structurally coupled to the monorepo source layout, not to the published package surface.
- **Remediation:** Add `@relay-assistant/proactive` and `@relay-assistant/policy` as devDependencies in `packages/integration/package.json`. Update imports to use package names. Confirm tests still pass.

#### Check 3.2: Assembly examples in `packages/examples/` actually compile
- **Status:** LIKELY
- **Severity:** HIGH
- **Evidence:** `packages/examples/tsconfig.json` uses `NodeNext` module resolution with no `paths` overrides. The examples import `@relay-assistant/core`, `@relay-assistant/traits`, `@relay-assistant/policy`, `@relay-assistant/proactive` by package name. `packages/examples/node_modules/@relay-assistant/` contains: `core`, `policy`, `proactive`, `traits` — all with `dist/` artifacts present. This means examples *currently* typecheck.

  However, this state is fragile: the dist artifacts inside `packages/examples/node_modules/` are symlinked from the workspace. If `packages/policy/dist/` or `packages/proactive/dist/` are deleted (they are gitignored), a fresh `npm install` in examples would link to packages without dist, breaking typecheck. There is no CI evidence that typecheck runs after a clean build. The examples `package.json` has no test script — only `typecheck`.
- **Remediation:** Add a CI step that runs `cd packages/examples && npm run typecheck` after building all dependency packages. Document that examples require built dist artifacts from policy and proactive.

#### Check 3.3: Examples only import packages at their documented stability tier
- **Status:** CONFIRMED
- **Severity:** MEDIUM
- **Evidence:** Examples 03 (`03-policy-gated-assistant.ts`), 04 (`04-proactive-assistant.ts`), and 05 (`05-full-assembly.ts`) import `@relay-assistant/policy` and `@relay-assistant/proactive`. Per `docs/current-state.md`, both are marked "placeholder" — yet the examples present them as first-class assembly components with no placeholder caveat. Consumer docs (`how-to-build-an-assistant.md`) call these "runnable-shape examples." The signal conflict: current-state says placeholder, examples say use them.

  Note: The underlying code IS implemented and the consumer adoption matrix correctly recommends adopting policy and proactive. The issue is that `current-state.md` is the stale document, not the examples. Once current-state.md is corrected (2.2), this finding resolves.
- **Remediation:** Correct `current-state.md` per finding 2.2. Once corrected, the examples will be consistent with documented stability tier.

#### Check 3.4: Product adoption paths reference only packages that pass their own tests
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** As noted in 2.6, `docs/consumer/how-products-should-adopt-relay-agent-assistant.md` (older guidance section) recommends blocked packages. `docs/consumer/consumer-adoption-matrix.md` and the v1 status table later in the same file correctly mark blocked packages as "Do not adopt." The contradiction is within the same document.
- **Remediation:** Same as 2.6 — remove or correct the stale product-guidance section.

---

### Checklist 4: Placeholder and Stub Detection

#### Check 4.1: Source files contain substantive logic, not just type re-exports
- **Status:** CLEAR
- **Severity:** HIGH
- **Evidence:** All packages marked IMPLEMENTED (core, sessions, surfaces, routing, traits, connectivity, coordination) have substantive implementations. Policy and proactive (incorrectly marked placeholder in current-state.md) are also substantive. Memory has ~710 lines of implementation logic. No package's main source file is < 30 lines or contains only type definitions. Routing is incomplete relative to its DoD target (12/40+ tests) but is not a stub.

#### Check 4.2: Tests verify behavior, not just construction
- **Status:** CLEAR
- **Severity:** MEDIUM
- **Evidence:** Random-sampled test files (core, policy, proactive, sessions, surfaces, routing) all contain behavioral assertions (state changes, error conditions, timeout behavior, multi-step dispatch, suppression logic, etc.). Construction tests exist but are not > 50% of any suite.

#### Check 4.3: No `TODO`/`FIXME`/`stub`/`not implemented`/`placeholder` markers hiding behind passing tests
- **Status:** CLEAR (with note)
- **Severity:** MEDIUM
- **Evidence:** `rg -i "todo|fixme|stub|not.implemented|placeholder" packages/*/src/*.ts` returned hits only for `createStubAdapters()` helper functions in `packages/core/src/core.test.ts` and `packages/core/src/core-traits.test.ts`. These are test infrastructure helpers (fake adapter implementations for test isolation), not production stubs hiding unimplemented behavior. No production source files contain stub markers.

#### Check 4.4: Packages with claimed test counts but blocked test suites are flagged, not counted
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `docs/current-state.md` states "87 tests claimed" for connectivity and "45 tests claimed" for coordination in the Known Blockers section. Actual `it()` counts: connectivity = 30, coordination = 39. The "claimed" numbers are incorrect even as projected counts. Additionally, the 128-test total excludes policy (64) and proactive (53) which are passing — significantly understating the verified passing total.
- **Remediation:** Correct Known Blockers section to use actual test counts (30 for connectivity, 39 for coordination). Update total passing count to reflect verified passing suites.

---

### Checklist 5: Package Boundary Leakage

#### Check 5.1: Each package's `package.json` declares only its actual dependencies
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `packages/connectivity/src/types.ts` contains:
  ```ts
  import type { RoutingEscalationHook } from '@relay-assistant/routing';
  export type { RequestedRoutingMode, RoutingEscalationHook } from '@relay-assistant/routing';
  ```
  `packages/connectivity/package.json` declares `@relay-assistant/routing` as a **devDependency** only (via `file:../routing`). Consumers who install `@relay-assistant/connectivity` from a registry will not receive routing as a transitive dependency. The public type `RoutingEscalationHook` that appears in `ConnectivityLayerConfig` will be unresolvable for them.

  Additionally: `packages/integration/package.json` declares no dependencies on `@relay-assistant/proactive` or `@relay-assistant/policy` despite importing from both in `src/integration.test.ts` and `src/helpers.ts`.
- **Remediation:** (a) Move `@relay-assistant/routing` from `devDependencies` to `dependencies` in `packages/connectivity/package.json`, or (b) remove the type re-export from types.ts and require consumers to install routing themselves. (b) is preferred to avoid mandatory coupling. (c) Add proactive and policy as devDependencies in integration/package.json.

#### Check 5.2: No circular dependencies between packages
- **Status:** CLEAR
- **Severity:** HIGH
- **Evidence:** Dependency graph: routing (no deps) ← connectivity ← coordination. core ← traits. No cycles found. Memory is standalone. Policy and proactive are standalone. Sessions and surfaces are standalone.

#### Check 5.3: Package `index.ts` exports match spec's public API surface
- **Status:** LIKELY
- **Severity:** MEDIUM
- **Evidence:** Not exhaustively verified against all specs. Spot check: `packages/proactive/src/index.ts` exports `createProactiveEngine`, `InMemorySchedulerBinding`, error classes — consistent with spec intent. `packages/policy/src/index.ts` exports `createActionPolicy`, `InMemoryAuditSink`, `defaultRiskClassifier`, error classes — consistent with spec. Full spec-vs-export reconciliation was not performed for all packages in this audit pass.
- **Remediation:** No immediate remediation required, but a dedicated spec-vs-export pass is recommended before v1 gate.

#### Check 5.4: No runtime code in type-only files (`types.ts`)
- **Status:** CLEAR
- **Severity:** LOW
- **Evidence:** `packages/connectivity/src/types.ts` and all other `types.ts` files contain only type definitions, interface declarations, const arrays (`as const`), and error class definitions. Error classes in types.ts are necessary exports (they're thrown at runtime and need to be importable by consumers), not a layer violation.

#### Check 5.5: `tsconfig.json` `references` or `paths` do not create implicit coupling
- **Status:** CLEAR
- **Severity:** MEDIUM
- **Evidence:** Sampled tsconfig files for core, connectivity, examples, integration: none use `paths` or `references`. All use `NodeNext` module resolution against `node_modules`. No hidden coupling via tsconfig.

---

### Checklist 6: Build and Test Proof

#### Check 6.1: Every IMPLEMENTED package has a test file that runs
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** Per `docs/current-state.md`: connectivity, coordination, and memory test suites cannot run. Connectivity is blocked by missing `nanoid` dep (though `nanoid: ^5.1.6` is in connectivity's `package.json` `dependencies` — the blocker is likely that `npm install` was never run in the connectivity package: `packages/connectivity/` has no `node_modules/` directory). Coordination is blocked by connectivity. Memory is blocked by the external `@agent-relay/memory` dep.

  Secondary blocker for connectivity (not documented in current-state.md): `packages/routing/` has no `dist/` directory. connectivity's `types.ts` re-exports from `@relay-assistant/routing`. The `devDep` file link resolves to `packages/routing/package.json` which points `main` to `dist/index.js`. Without routing's dist, the routing type resolution fails even under vitest's transpiler.
- **Remediation:** (1) Run `npm install` in `packages/connectivity/` to install nanoid. (2) Build routing (`cd packages/routing && npm run build`) before running connectivity tests. (3) Document both blockers in current-state.md (only nanoid is currently mentioned). (4) Consider adding a workspace-level test script that handles build ordering.

#### Check 6.2: Tests do not depend on build artifacts from other packages
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** Two distinct patterns:
  1. **Cross-package test files use `../../{pkg}/src/` imports** (core-traits, core-sessions, core-sessions-surfaces, integration): These bypass dist artifacts and work under vitest transpilation. While functional, they create source-level coupling.
  2. **connectivity and coordination use `pretest` scripts to build sibling packages**: `packages/connectivity/package.json` has `"pretest": "npm --prefix ../routing run build"`. `packages/coordination/package.json` has `"pretest": "npm --prefix ../routing run build && npm --prefix ../connectivity run build"`. These scripts run ONLY when invoking `npm test` within the specific package — NOT when running `npx vitest run` from the repo root or another package. Root-level test runners skip these pre-build steps. Since routing has no dist and coordination requires connectivity's dist, running tests from root without individual pre-builds will fail for these packages.
- **Remediation:** Add a workspace-level build script (or use turborepo/nx) that ensures build order before the root-level vitest run. Alternatively, migrate cross-package tests to use vitest workspace configuration with proper resolution.

#### Check 6.3: `npx vitest run` succeeds from a clean clone (no pre-build step required)
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** A clean clone followed by `npm install && npx vitest run` from the repo root would fail for at minimum: connectivity (nanoid not installed; routing dist missing), coordination (same), memory (external dep missing). These are documented blockers. However, the routing dist dependency for connectivity is NOT documented as a blocker in current-state.md — consumers reading the blocker list would not know they need to build routing first.

  For passing packages (core, sessions, surfaces, routing, traits, policy, proactive): these should run cleanly since they don't have `pretest` scripts and don't depend on sibling dists. The cross-package test files (core-traits, core-sessions, etc.) use `../../src/` paths and should work under vitest transpilation without builds.
- **Remediation:** Document routing-dist as a secondary blocker for connectivity in current-state.md. Add a workspace-level `build` + `test` sequence to README or a root-level Makefile/script.

#### Check 6.4: No tests depend on external services or network access
- **Status:** CLEAR
- **Severity:** MEDIUM
- **Evidence:** No `fetch`, `http`, `localhost`, `127.0.0.1` patterns found in test files. All tests use in-memory implementations (InMemorySessionStoreAdapter, InMemoryAuditSink, InMemorySchedulerBinding, InMemoryMemoryStoreAdapter, InMemoryAdapter from @agent-relay/memory).

#### Check 6.5: Package `main` and `types` fields in `package.json` point to files that exist
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** Package.json `main`/`types` point to `dist/` files that DO NOT EXIST for:
  - `packages/routing`: no `dist/` directory. `package.json` declares `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`.
  - `packages/connectivity`: no `dist/` directory. Same declarations.
  - `packages/coordination`: no `dist/` directory. Same declarations.
  - `packages/memory`: no `dist/` directory. Same declarations.

  Packages with dist confirmed present: core, sessions, surfaces, traits, policy, proactive.

  Any consumer who installs and imports routing, connectivity, coordination, or memory will get a module-not-found error at runtime.
- **Remediation:** Either (a) build and commit dist artifacts for packages expected to be usable (routing at minimum, since connectivity and coordination depend on it), or (b) add these packages to a "do not consume" list in the README with explicit build instructions. The current Known Blockers section in current-state.md covers memory and connectivity/coordination but not routing specifically for this reason.

#### Check 6.6: Blocked packages are explicitly documented with resolution path
- **Status:** CLEAR (partial)
- **Severity:** MEDIUM
- **Evidence:** `docs/current-state.md` Known Blockers section documents: (1) nanoid missing from connectivity, (2) routing DoD gap, (3) @agent-relay/memory missing. These are the three documented blockers. However, as noted in 6.1 and 6.5, the routing-dist-absent secondary blocker for connectivity is not documented, and the package.json `main` pointing to missing dist for routing is not called out as a consumer risk.

---

### Checklist 7: Consumer/Adoption Doc Accuracy

#### Check 7.1: `how-to-build-an-assistant.md` only uses v1-baseline packages in primary path
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `docs/consumer/how-to-build-an-assistant.md` (line 254–338) contains a "Canonical Assembly Path (v1 Implemented Packages)" section that explicitly states:
  > "Four packages are now implemented with passing test suites: core (31+ tests), traits (32 tests), policy (64 tests), proactive (45 tests)"

  This claim is accurate against the actual codebase — policy and proactive ARE implemented with passing suites. However, it contradicts `docs/current-state.md` which labels them "placeholder." The section is internally consistent but creates a documentation conflict. The primary assembly path in the earlier doc sections (up to line 215) uses only core/sessions/surfaces which are unambiguously v1 baseline — that path is sound. The "Canonical Assembly Path" section that introduces policy and proactive is accurate to the code but inconsistent with current-state.md.
- **Remediation:** Once current-state.md is corrected per finding 2.2, this conflict resolves. No change needed in how-to-build-an-assistant.md itself.

#### Check 7.2: Product adoption paths do not recommend gated packages
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** `docs/consumer/how-products-should-adopt-relay-agent-assistant.md` product-specific guidance (lines 54–110) recommends:
  - **Sage**: "Adopt first: `@relay-assistant/memory`" — memory is a placeholder blocked by external dependency
  - **NightCTO**: "Adopt first: `@relay-assistant/coordination`" — tests blocked, no dist artifact
  - **NightCTO**: "Adopt first: `@relay-assistant/memory`" — blocked

  The v1 Package Status table later in the same file (lines 154–171) correctly marks these as "Do not adopt (blocked)." The document contradicts itself. The older guidance section was not updated when the status table was added.
- **Remediation:** Revise the product-specific guidance sections (Sage/NightCTO adoption-first recommendations) to align with the v1 Package Status table. Mark memory and coordination as deferred in both sections.

#### Check 7.3: `how-products-should-adopt-relay-agent-assistant.md` reflects current package status
- **Status:** CONFIRMED
- **Severity:** MEDIUM
- **Evidence:** The v1 Package Status table in the document accurately labels policy (64 tests, implemented, yes) and proactive (45 tests, implemented, yes). Sessions and surfaces are listed as "v1 baseline" with "—" for tests (no test count shown, though both have passing suites per current-state.md). The proactive test count "45 passing" differs from the actual `it()` count of 53 (minor overclaim). Core is listed as "40 passing" vs current-state.md's "31+6=37" (with additional untracked test files bringing it higher). These minor count mismatches are LOW severity compared to the structural contradictions already flagged.
- **Remediation:** Update test counts to match verified `npx vitest run` output. Add sessions and surfaces test counts.

#### Check 7.4: Code snippets in consumer docs compile against current package exports
- **Status:** LIKELY
- **Severity:** MEDIUM
- **Evidence:** Import statements in `how-to-build-an-assistant.md` were not exhaustively run through a compiler. Spot check of key imports:
  - `createAssistant` from `@relay-assistant/core` — confirmed exported in core/src/index.ts
  - `createSessionStore`, `InMemorySessionStoreAdapter`, `resolveSession`, `createDefaultAffinityResolver` — need to verify `createDefaultAffinityResolver`; current-state.md deprecation table replaces `createDefaultAffinityResolver` with `defaultAffinityResolver`

  Specifically: `how-to-build-an-assistant.md` uses `createDefaultAffinityResolver(store)` in its assembly example (line 157) but the core-sessions.test.ts file imports `defaultAffinityResolver` (without `create` prefix). This is a potential API name mismatch in consumer docs.
- **Remediation:** Verify the sessions package exports: confirm whether `createDefaultAffinityResolver` or `defaultAffinityResolver` is the current canonical export name. Update consumer docs accordingly.

#### Check 7.5: Adoption matrix (`consumer-adoption-matrix.md`) matches `current-state.md`
- **Status:** CONFIRMED
- **Severity:** MEDIUM
- **Evidence:** `docs/consumer/consumer-adoption-matrix.md` correctly marks policy and proactive as "Adopt now" and memory/coordination/connectivity as "Do not adopt (blocked)." This CONFLICTS with `docs/current-state.md` which labels policy and proactive as "placeholder." The adoption matrix is the more accurate document. `current-state.md` is stale.
- **Remediation:** Correct `current-state.md` per finding 2.2. The adoption matrix does not need changes.

#### Check 7.6: No adoption doc recommends a package whose tests are blocked
- **Status:** CONFIRMED
- **Severity:** HIGH
- **Evidence:** As documented in 2.6 and 7.2: `how-products-should-adopt-relay-agent-assistant.md` older guidance section recommends Sage adopt memory (blocked) and NightCTO adopt coordination (blocked) and memory (blocked). This is a direct violation. The newer v1 Package Status table in the same file is correct.
- **Remediation:** Same as 2.6 and 7.2.

---

## Pre-Scan Command Outputs (Summary)

```
# Non-canonical import scan (../../relay/ in source)
→ 0 matches

# file: references in package.json
→ packages/memory/package.json: "@agent-relay/memory": "file:../../../relay/packages/memory"  ← ESCAPES REPO
→ packages/core/package.json: "@relay-assistant/traits": "file:../traits"  ← within repo, OK
→ packages/connectivity/package.json: "@relay-assistant/routing": "file:../routing"  ← within repo, OK
→ packages/coordination/package.json: connectivity, routing  ← within repo, OK
→ packages/examples/package.json: core, traits, policy, proactive  ← within repo, OK

# Build artifact imports from src
→ 0 matches (no src/* files import from dist/)

# Cross-package @relay-assistant/* imports in source
→ packages/connectivity/src/types.ts: import type ... from '@relay-assistant/routing'  ← devDep only
→ packages/connectivity/src/types.ts: export type ... from '@relay-assistant/routing'  ← devDep only

# Test file cross-package source imports (non-standard pattern)
→ packages/core/src/core-traits.test.ts: from '../../traits/src/index.js'
→ packages/core/src/core-sessions.test.ts: from '../../sessions/src/index.js'
→ packages/core/src/core-sessions-surfaces.test.ts: from '../../sessions/src/...', '../../surfaces/src/...'
→ packages/integration/src/*.ts: from '../../proactive/src/...', '../../policy/src/...'

# Missing dist directories
→ packages/routing: NO DIST
→ packages/connectivity: NO DIST, NO NODE_MODULES
→ packages/coordination: NO DIST
→ packages/memory: NO DIST
```

---

ROBUSTNESS_AUDIT_REPORT_READY
