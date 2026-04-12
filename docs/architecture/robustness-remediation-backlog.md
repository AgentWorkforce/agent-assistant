# Robustness Remediation Backlog — 2026-04-12

**Source:** `docs/architecture/robustness-audit-report.md` (2026-04-12)
**Priority rule:** HIGH = must fix before any v1 milestone gate. MEDIUM = fix within current milestone. LOW = track, fix opportunistically.

---

## HIGH — Must Fix Before Gate

| # | Finding | Package(s) | Remediation | Owner |
|---|---------|------------|-------------|-------|
| H1 | **current-state.md labels policy and proactive as "placeholder" — code is implemented** (checks 2.2, 2.3, 2.5) | `@relay-assistant/policy`, `@relay-assistant/proactive` | Update `docs/current-state.md`: change status from "placeholder" → "IMPLEMENTED", spec column from "none" → "IMPLEMENTATION_READY", add both to the test results table with verified counts (policy: 64, proactive: 53), add both to the V1 Baseline section, update "Total verified passing" count. | — |
| H2 | **current-state.md connectivity test count is 87 (claimed) vs 30 (actual)** (check 2.1, 4.4) | `@relay-assistant/connectivity` | Correct Known Blockers section: "87 tests claimed" → "30 tests". Also correct coordination count: "45 tests claimed" → "39 tests". Re-derive the total passing test count after H1 and H2 corrections. | — |
| H3 | **current-state.md test table excludes policy (64 tests), proactive (53 tests), integration (14 tests), and new core test files (core-traits: 9, core-sessions: 9) — all passing** (check 2.1) | docs | Add missing rows to the test results table. Run `npx vitest run` from each package and record verified output. The integration tests belong in a separate row. The untracked core test files should be tracked in git before being added to the table. | — |
| H4 | **`packages/memory/package.json` dependency escapes monorepo root** (check 1.2) | `@relay-assistant/memory` | `"@agent-relay/memory": "file:../../../relay/packages/memory"` must be replaced with either a published npm package reference (once `@agent-relay/memory` is released) or a workspace protocol if the relay repo is merged. Until resolved, remove the dist-dependent install path from CI; keep memory in "placeholder/blocked" status. | — |
| H5 | **`packages/connectivity/src/types.ts` re-exports from `@relay-assistant/routing` — routing is only a devDependency** (check 5.1) | `@relay-assistant/connectivity` | Option A (preferred): Remove the `export type { RequestedRoutingMode, RoutingEscalationHook }` re-export from connectivity/src/types.ts. Consumers who need these types should import directly from `@relay-assistant/routing`. Option B: Promote routing from `devDependencies` to `dependencies` in connectivity/package.json. Option A avoids mandatory coupling. | — |
| H6 | **`packages/routing`, `packages/connectivity`, `packages/coordination`, `packages/memory` have no `dist/` directory — package.json `main`/`types` fields are broken** (check 6.5) | routing, connectivity, coordination, memory | Build routing first (`cd packages/routing && npm run build`) and commit or gitignore-exempt the dist. Add `packages/routing/dist/` to `.gitignore` exclusion list with a build instruction. Document the required build order in `README.md`. For connectivity and coordination: once nanoid is resolved and routing is built, run their builds too. Memory: cannot build until H4 is resolved. | — |
| H7 | **`packages/connectivity` has no `node_modules/` — package was never installed** (check 6.1) | `@relay-assistant/connectivity` | Run `npm install` in `packages/connectivity/`. This unblocks nanoid availability (which is declared as a dependency). Also required before any connectivity build or test. Add connectivity to workspace install step in CI/root scripts. | — |
| H8 | **connectivity/coordination `pretest` scripts build sibling packages — not triggered by root-level `npx vitest run`** (checks 6.2, 6.3) | connectivity, coordination | Add a workspace-level build+test sequence. Options: (a) Add a root-level `package.json` with workspace scripts that build packages in dependency order before running vitest, (b) Use a `Makefile` or `scripts/` shell script, (c) Adopt turborepo or nx for build ordering. Document the required build order in `README.md` for contributors. | — |
| H9 | **routing secondary blocker for connectivity not documented in current-state.md** (check 6.1) | docs | Add to current-state.md Known Blockers: connectivity requires routing's `dist/` to exist (for type resolution at package install time). Add resolution step: "build routing before installing/testing connectivity." | — |
| H10 | **Integration tests (`packages/integration`) import from raw source paths and declare no deps on proactive/policy** (checks 3.1, 5.1) | `@relay-assistant/integration-tests` | (a) Add `@relay-assistant/proactive` and `@relay-assistant/policy` as devDependencies in `packages/integration/package.json`. (b) Update imports in `integration.test.ts` and `helpers.ts` from `'../../proactive/src/index.js'` to `'@relay-assistant/proactive'` (and same for policy). Confirm tests pass after the change. | — |
| H11 | **`how-products-should-adopt.md` product-guidance section recommends blocked/placeholder packages (memory for Sage, coordination+memory for NightCTO)** (checks 2.6, 3.4, 7.2, 7.6) | docs | Revise the "Sage", "MSD", "NightCTO" product-specific guidance subsections (lines 54–110 of the file): replace memory and coordination in the "Adopt first" lists with packages that are actually ready. Cross-reference the v1 Package Status table already in the same document (which correctly says "Do not adopt" for blocked packages). The consumer-adoption-matrix.md is accurate and can serve as the canonical reference. | — |

---

## MEDIUM — Fix Within Milestone

| # | Finding | Package(s) | Remediation | Owner |
|---|---------|------------|-------------|-------|
| M1 | **Cross-package test files import from sibling `src/` paths instead of package names** (check 1.3, 6.2) | core (core-traits, core-sessions, core-sessions-surfaces tests), integration | Change cross-package imports from `'../../traits/src/index.js'` → `'@relay-assistant/traits'`, etc. The `file:` devDependencies are already declared, so package-name imports will resolve through node_modules. Confirm tests pass after change. This enforces that tests exercise the same import path consumers use. | — |
| M2 | **`current-state.md` Spec column for policy and proactive shows "none" — specs exist** (check 2.5) | docs | Update spec column: policy → `IMPLEMENTATION_READY`, proactive → `IMPLEMENTATION_READY`. Verify whether review verdicts confirm code-spec agreement (which would warrant `SPEC_RECONCILED`). | — |
| M3 | **Examples (03, 04, 05) import policy/proactive which current-state.md labels placeholder — mixed stability signal** (check 3.3) | docs, examples | Resolves automatically once H1 corrects current-state.md. No code change required in examples. | — |
| M4 | **`packages/examples/` has no test script — WF-7 "End-to-end assembly" remains OPEN** (check 2.4) | `@relay-assistant/examples` | Add a `test` script to `packages/examples/package.json` that invokes each example's exported function and makes basic behavioral assertions (e.g., that `outbound.sent.length > 0`, that `runtime.status().ready === false` after stop). Alternatively, document explicitly that examples are type-checked only and update WF-7 accordingly in current-state.md. | — |
| M5 | **Consumer adoption matrix vs current-state.md conflict on policy/proactive status** (check 7.5) | docs | Resolves once H1 corrects current-state.md. No change needed in consumer-adoption-matrix.md. | — |
| M6 | **`how-to-build-an-assistant.md` uses `createDefaultAffinityResolver` — sessions package may export `defaultAffinityResolver` (without `create` prefix)** (check 7.4) | docs, sessions | Verify the sessions package's current exported name for the affinity resolver (`core-sessions.test.ts` imports `defaultAffinityResolver`). Update consumer doc assembly example to use the correct export name. | — |
| M7 | **`packages/examples/` typecheck depends on built dist artifacts in node_modules — fragile after clean install** (check 3.2) | examples | Add CI step: build policy and proactive dist before running `npm run typecheck` in examples. Document this dependency. Consider adding examples typecheck to the root-level test/build pipeline. | — |

---

## LOW — Track

| # | Finding | Package(s) | Remediation | Owner |
|---|---------|------------|-------------|-------|
| L1 | **proactive `it()` count is 53 but consumer docs claim 45 passing** | docs | Update `how-products-should-adopt-relay-agent-assistant.md` proactive test count from 45 → 53 (or verify against actual `npx vitest run` output and use that number). Minor accuracy issue. | — |
| L2 | **policy and integration packages use older vitest (^1.6.0) and TypeScript (^5.4.0) versions vs other packages (vitest ^3.2.4, TS ^5.9.3)** | policy, integration | Align devDependency versions: update policy and integration package.json to use vitest ^3.2.4 and typescript ^5.9.3. Test to confirm no breaking API changes. Keeps tooling consistent across the monorepo. | — |

---

## Remediation Priority Order

The following order minimizes downstream blockers:

1. **H1, H2, H3** — Correct current-state.md first. This resolves M2, M3, M5 and gives accurate baseline for all subsequent work.
2. **H7** — Install connectivity node_modules (quick, unblocks H6 for connectivity).
3. **H6** — Build routing dist (quick, unblocks connectivity/coordination).
4. **H8** — Add workspace build+test sequencing (medium effort, ensures CI robustness).
5. **H5** — Fix connectivity routing devDep/re-export (quick code change).
6. **H10** — Fix integration test imports (quick).
7. **H11** — Fix consumer adoption doc product-guidance sections (quick doc edit).
8. **H9** — Add routing-dist blocker to current-state.md (quick doc edit).
9. **H4** — Memory external dep (blocked on relay ecosystem; no quick fix).
10. **M1, M6, M7, M4** — Test import cleanup, doc accuracy, CI hardening.
11. **L1, L2** — Test count accuracy, tooling version alignment.

---

ROBUSTNESS_REMEDIATION_BACKLOG_READY
