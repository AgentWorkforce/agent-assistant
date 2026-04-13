# Open-Source Readiness Rubric — Agent Assistant SDK

Date: 2026-04-13

Authoritative rubric for evaluating whether this repository is ready to be made public. Each dimension is scored **PASS**, **CONDITIONAL**, or **FAIL** with specific evidence and required fixes.

Source of truth hierarchy: source code > specs > READMEs > this rubric. This rubric evaluates the repo as-is; it does not override canonical contracts.

---

## 1. README and Public Landing Quality

**Score: CONDITIONAL**

### What works

- Root `README.md` has a clear purpose statement, quick-start code, package map table, architecture overview, and contributing section.
- The three-layer mental model (foundation / SDK / product) is explained concisely.
- Quick-start example is valid TypeScript that imports from published package names.
- Consumer docs are linked and reachable.

### What blocks public readiness

| Issue | Severity | Evidence |
|---|---|---|
| **No LICENSE file at repo root** | BLOCKER | `ls LICENSE` returns "No such file or directory". README says "MIT" but there is no license text. npm packages declare no license field (except `routing`, `proactive`, `traits`, `memory` which have `"license": "MIT"`). Without a root LICENSE file, the repo is not legally open-source. |
| **No CONTRIBUTING.md** | HIGH | README has a short contributing section but no standalone file. External contributors expect a `CONTRIBUTING.md` with DCO/CLA policy, code style, PR process, and issue triage guidance. |
| **No CODE_OF_CONDUCT.md** | MEDIUM | Standard for public repos under an org. Absence signals an internal project. |
| **No CHANGELOG.md** | LOW | Not blocking for v0.1.0 but expected before first tagged release. |
| **Package map accuracy** | HIGH | README lists `@agent-assistant/policy` as "placeholder — v2" and `@agent-assistant/proactive` as "placeholder — v1.2", but both are implemented with passing test suites (64 and 45 tests respectively). An outsider would skip two working packages. |
| **Test count discrepancy** | MEDIUM | README claims "128 tests verified passing" — actual total after policy (64) and proactive (45+) inclusion is higher. Connectivity claims 87 but actual is ~30. These numbers mislead contributors. |

### Required fixes

1. Add `LICENSE` file (MIT full text) at repo root.
2. Add `CONTRIBUTING.md` with PR expectations, test requirements, and contribution policy.
3. Add `CODE_OF_CONDUCT.md` (Contributor Covenant or equivalent).
4. Update README package map: mark `policy` and `proactive` as **IMPLEMENTED**, correct test counts, correct roadmap labels.

---

## 2. Naming Consistency and Public Clarity

**Score: CONDITIONAL**

### What works

- All `package.json` names use `@agent-assistant/*` scope consistently.
- All source `import` statements use `@agent-assistant/*`.
- Root package.json name is `agent-assistant-sdk-monorepo`.
- Consumer-facing docs (README, index, current-state, how-to-build, adoption guide) use the current name.

### What blocks public readiness

| Issue | Severity | Evidence |
|---|---|---|
| **Extensive `@relay-assistant/*` and `RelayAssistant` references in architecture docs** | MEDIUM | 200+ references across `docs/architecture/` files. While historical docs carry header notes, the sheer volume creates confusion for newcomers browsing the docs directory. |
| **`relay-agent-assistant` in repo directory name** | LOW | The local directory is `relay-agent-assistant`. This is the git remote name. If the GitHub repo URL still uses the old name, it contradicts the SDK branding. |
| **Root devDependency on `@agentworkforce/workload-router`** | HIGH | `package.json` declares `"@agentworkforce/workload-router": "^0.1.1"` — a private/internal package. An external contributor running `npm install` will fail if they don't have access to this package's registry. |
| **`packages/memory/package.json` escapes monorepo** | BLOCKER | `"@agent-relay/memory": "file:../../../relay/packages/memory"` — references a sibling repo that external contributors will not have. `npm install` in the memory workspace will fail. |
| **Workflow files reference internal ecosystem** | LOW | Workflow `.ts` files in `workflows/` reference internal tooling (`workflow()` function, channel names). These are not standard GitHub Actions and may confuse external contributors. |

### Required fixes

1. Remove or gate the `@agentworkforce/workload-router` devDependency so `npm install` succeeds for external contributors.
2. Replace `packages/memory/package.json` `file:` dependency with a placeholder or optional peer dependency until `@agent-relay/memory` is published.
3. Verify GitHub repo URL matches the `agent-assistant-sdk` branding.
4. Consider adding a top-level note in `docs/architecture/` explaining that historical docs use the old name.

---

## 3. Examples and Onboarding Usefulness

**Score: PASS (with caveats)**

### What works

- `packages/examples/` contains five progressively richer assembly examples (01 through 05).
- Each example has clear proof scenarios with verification steps.
- Product adoption mapping table shows which example each product (Sage, MSD, NightCTO) should start with.
- `packages/examples/README.md` is thorough: build order, proof scenarios, ownership boundary table, and consumer guidance.
- Examples use published package names, not source paths.
- `docs/consumer/how-to-build-an-assistant.md` provides a complete skeletal assembly walkthrough.

### What weakens readiness

| Issue | Severity | Evidence |
|---|---|---|
| **Examples are typecheck-only, not runnable** | MEDIUM | No test script in `packages/examples/package.json`. WF-7 (end-to-end assembly) is OPEN. An outsider cannot `npm test` to verify examples work. |
| **Build order requires manual steps** | LOW | Examples require building four upstream packages in specific order before typechecking. No single command runs the full chain. |
| **Product-specific references** | LOW | Examples reference Sage, MSD, NightCTO — internal product names that mean nothing to external contributors. Acceptable for now but should be generalized for public consumption. |

### Recommended improvements

1. Add a root-level `npm run build:all` script or document the build order in the root README.
2. Add a smoke-test script for examples that exercises each example's exported function.
3. Consider replacing product names with generic archetypes ("knowledge assistant", "code review assistant", "executive assistant") in public-facing docs.

---

## 4. Documentation Completeness for an Outsider

**Score: CONDITIONAL**

### What works

- `docs/index.md` is a well-organized entry point with clear navigation.
- Source-of-truth hierarchy is explicitly documented (code > specs > READMEs > index > plans > verdicts).
- Spec-driven development flow is explained (spec > implement > review).
- Consumer docs explain both how to build an assistant and how products should adopt the SDK.
- Architecture docs cover package boundaries, traits vs. personas distinction, and OSS vs. cloud split.
- Glossary exists at `docs/reference/glossary.md`.

### What blocks public readiness

| Issue | Severity | Evidence |
|---|---|---|
| **`docs/current-state.md` is stale** | HIGH | Lists `policy` and `proactive` as "placeholder" with "none" for spec. Both are implemented. Connectivity claims 87 tests (actual ~30). Coordination claims 45 (actual ~39). The "V1 Baseline" section omits `policy`, `proactive`, and `traits` as safe-for-use. |
| **Consumer adoption doc has stale status table** | HIGH | `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md` v1 status table lists `proactive` as "implemented, 45 passing" and `policy` as "implemented, 64 passing" — but the main `current-state.md` contradicts this by calling them placeholders. |
| **Docs volume is overwhelming for newcomers** | MEDIUM | `docs/architecture/` contains 60+ files. Many are historical implementation plans, review verdicts, and reconciliation records. No clear separation between "read this first" and "historical archive". |
| **Internal jargon without explanation** | MEDIUM | Terms like "DoD gap", "SPEC_RECONCILED", "IMPLEMENTATION_READY", "workforce persona" appear throughout without always being defined in context. The glossary helps but may not be found by casual readers. |
| **Broken cross-references possible** | LOW | With 60+ architecture docs, some internal links may point to moved or renamed files. Not verified exhaustively. |

### Required fixes

1. Update `docs/current-state.md` to reflect actual implementation status of all packages, with correct test counts.
2. Reconcile `current-state.md` with the adoption doc's status table — one must be authoritative.
3. Add a "For newcomers, start here" section at the top of `docs/index.md` that points to README, how-to-build, and examples — skip the architecture archive.
4. Consider moving historical plans/verdicts into a `docs/architecture/archive/` subdirectory to reduce noise.

---

## 5. Package Publishability and Boundary Clarity

**Score: CONDITIONAL**

### What works

- Four packages are publish-ready with clean boundaries: `core`, `sessions`, `surfaces`, `traits`.
- Package boundaries are well-defined in `docs/architecture/package-boundary-map.md`.
- Each package has `"type": "module"`, proper `exports` field, `files` array targeting `dist/`.
- `publishConfig.access: "public"` is set on `core`, `sessions`, `surfaces`, `traits`.
- Dependency graph is intentionally shallow — most packages have zero runtime `@agent-assistant/*` dependencies.
- `core` correctly uses `peerDependencies` for `traits`.

### What blocks public readiness

| Issue | Severity | Evidence |
|---|---|---|
| **Six packages missing `publishConfig.access`** | MEDIUM | `routing`, `connectivity`, `coordination`, `memory`, `proactive`, `policy` lack `publishConfig.access: "public"`. Scoped packages default to restricted on npm. |
| **`connectivity` re-exports from `routing` (devDep only)** | HIGH | `packages/connectivity/src/types.ts` re-exports `RequestedRoutingMode` and `RoutingEscalationHook` from `@agent-assistant/routing`, but routing is only a `devDependency`. Published consumers would get unresolvable types. |
| **`coordination` has `file:` runtime dependency** | HIGH | `"@agent-assistant/connectivity": "file:../connectivity"` is in `dependencies` (not devDeps). This must be a version range before publish. |
| **`memory` depends on external monorepo** | BLOCKER | `"@agent-relay/memory": "file:../../../relay/packages/memory"` — breaks for any external consumer. |
| **Missing `license` field in several package.json** | MEDIUM | `core`, `sessions`, `surfaces`, `connectivity`, `coordination`, `examples`, `integration` lack `"license": "MIT"` field. |
| **`nanoid` not installed in connectivity workspace** | HIGH | `packages/connectivity/package.json` declares `nanoid` as dependency but `node_modules/` was never populated. Tests are blocked. |
| **Routing DoD gap** | MEDIUM | 12 tests vs 40+ target. Package works but is explicitly marked "do not consume in products". Publishing it sends a mixed signal. |

### Required fixes

1. Add `"license": "MIT"` to all package.json files.
2. Add `publishConfig.access: "public"` to all publishable packages.
3. Fix connectivity's routing type re-export (either remove re-export or promote routing to `dependencies`).
4. Change coordination's `file:` dep to version range before publish.
5. Run `npm install` in `packages/connectivity/` to unblock tests.
6. Gate or stub the memory package's external dependency.

---

## 6. Unresolved Internal References or Ecosystem Assumptions

**Score: FAIL**

### Critical internal assumptions exposed to outsiders

| Issue | Severity | Evidence |
|---|---|---|
| **`@agentworkforce/workload-router` in root** | HIGH | Private package in root devDependencies. External `npm install` will fail. |
| **`@agent-relay/memory` file reference** | BLOCKER | Memory package depends on a sibling monorepo via relative path. |
| **Relay foundation assumption** | MEDIUM | Architecture docs repeatedly reference "Relay foundation repos" for transport, auth, scheduler substrate. No public links or documentation for these. An outsider cannot build a working assistant without understanding what the foundation layer provides. |
| **Workforce personas referenced** | LOW | Multiple docs reference Workforce persona profiles, `@agentworkforce/workload-router`, and specific products (Sage, MSD, NightCTO). These are meaningless to external contributors. |
| **`workflows/` directory contains non-standard automation** | LOW | TypeScript workflow files use a `workflow()` function and Relay channel system that external contributors cannot run. Consider `.gitignore`-ing or documenting these as internal-only. |
| **Historical docs reference absolute local paths** | LOW | Several review verdicts contain paths like `/Users/khaliqgant/Projects/AgentWorkforce/...`. These should be repo-relative. |
| **GitHub repo URL inconsistency** | MEDIUM | Some packages point to `https://github.com/AgentWorkforce/agent-assistant-sdk`, others have no repository field. The actual repo may still be at a different URL. |

### Required fixes

1. Remove or make optional the `@agentworkforce/workload-router` root dependency.
2. Stub the memory package's relay dependency with an interface-only approach or mark the package as not-yet-installable.
3. Add a "Foundation Layer" section to README or a standalone doc that explains what external adapters a consumer must provide (transport, auth, scheduler) — even if the foundation repos aren't public yet.
4. Normalize `repository.url` across all publishable packages.
5. Remove absolute local paths from docs (or accept they exist only in historical records).

---

## 7. Overall Readiness Verdict

### Can the repo be made public now?

**No. The repo is NOT ready to be made public today.**

### Can it be made public after specific fixes?

**Yes. A focused remediation pass would bring it to publishable state.**

### Remediation tiers

#### Tier 1 — Must fix before going public (BLOCKERS)

These prevent basic functionality for external contributors:

1. **Add LICENSE file** — no license text means the code is legally "all rights reserved"
2. **Remove/gate `@agentworkforce/workload-router`** — `npm install` fails for outsiders
3. **Fix `@agent-relay/memory` file reference** — breaks npm install in memory workspace
4. **Add CONTRIBUTING.md** — minimum governance for accepting external contributions
5. **Update `docs/current-state.md`** — stale status creates immediate credibility loss

#### Tier 2 — Should fix before going public (HIGH)

These create significant friction or confusion:

1. Fix connectivity's routing type re-export / devDep mismatch
2. Add `"license": "MIT"` and `publishConfig.access` to all packages
3. Run `npm install` in connectivity to unblock its tests
4. Change coordination's `file:` dep to version range
5. Reconcile README package map with actual implementation status
6. Add foundation-layer documentation for outsiders
7. Normalize repository URLs across packages

#### Tier 3 — Improve before or shortly after going public (MEDIUM)

These improve the experience but don't block adoption:

1. Add CODE_OF_CONDUCT.md
2. Add root `npm run build:all` and `npm test` scripts
3. Add newcomer-oriented navigation to docs/index.md
4. Generalize product-specific references (Sage/MSD/NightCTO) to archetypes
5. Move historical architecture docs to an archive subdirectory
6. Add smoke tests for examples
7. Add a CHANGELOG.md

### Estimated effort

- **Tier 1:** 2-4 hours (mostly file creation and dependency fixes)
- **Tier 2:** 4-8 hours (cross-package fixes, doc updates, test unblocking)
- **Tier 3:** 4-8 hours (docs reorganization, tooling, polish)

### Summary scorecard

| Dimension | Score |
|---|---|
| 1. README/public landing quality | CONDITIONAL |
| 2. Naming consistency and public clarity | CONDITIONAL |
| 3. Examples and onboarding usefulness | PASS |
| 4. Documentation completeness for an outsider | CONDITIONAL |
| 5. Package publishability and boundary clarity | CONDITIONAL |
| 6. Unresolved internal references | FAIL |
| 7. Overall readiness | **NOT YET — after Tier 1+2 fixes, YES** |

---

OPEN_SOURCE_READINESS_RUBRIC_READY
