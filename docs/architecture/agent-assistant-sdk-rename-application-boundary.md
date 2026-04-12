# Agent Assistant SDK — Rename Application Boundary

> Exact application plan for the rename pass. Derived from `docs/architecture/agent-assistant-sdk-rename-boundary.md`. This document defines which files change, how, and in what order.

Date: 2026-04-12

---

## 1. Pass Structure

The rename is applied in five ordered phases. Each phase can be executed independently, but the ordering prevents broken imports or inconsistent intermediate states.

| Phase | Scope | Estimated Files |
| --- | --- | --- |
| **P1: Package manifests** | All `package.json` files — `name`, `description`, `repository`, dependency references | ~14 files |
| **P2: Source code and tests** | All `import` / `import type` statements in `packages/*/src/` | ~15 files |
| **P3: Docs — consumer-facing** | README.md (root), per-package READMEs, `docs/index.md`, `docs/current-state.md`, `docs/specs/`, `docs/consumer/`, `docs/reference/`, `docs/workflows/` | ~30 files |
| **P4: CI and workflows** | `.github/workflows/publish.yml`, `workflows/*.ts` | ~25 files |
| **P5: Active architecture docs** | Architecture docs that are actively consumed (boundary map, traits layer, connectivity spec, extraction roadmap, etc.) | ~10 files |
| **P6: Historical docs — header note** | Plans, verdicts, proofs, research — add historical header note only | ~60 files |

---

## 2. Phase 1: Package Manifests

Every `package.json` in the monorepo is updated.

### 2.1 Root `package.json`

| Field | Old | New |
| --- | --- | --- |
| `name` | `relay-agent-assistant-monorepo` | `agent-assistant-sdk-monorepo` |

### 2.2 Per-package `package.json` (all 12 packages)

Files:
- `packages/core/package.json`
- `packages/sessions/package.json`
- `packages/surfaces/package.json`
- `packages/traits/package.json`
- `packages/routing/package.json`
- `packages/connectivity/package.json`
- `packages/coordination/package.json`
- `packages/memory/package.json`
- `packages/proactive/package.json`
- `packages/policy/package.json`
- `packages/examples/package.json`
- `packages/integration/package.json`

Per file:
| Field | Replacement |
| --- | --- |
| `name` | `@relay-assistant/<pkg>` → `@agent-assistant/<pkg>` |
| `description` | Remove "Relay" prefix where present |
| `repository.url` | `relay-agent-assistant` → `agent-assistant-sdk` |
| `dependencies` | `@relay-assistant/*` → `@agent-assistant/*` |
| `peerDependencies` | `@relay-assistant/*` → `@agent-assistant/*` |
| `devDependencies` (package names) | `@relay-assistant/*` → `@agent-assistant/*` |

Note: `file:../` path values in devDependencies stay as-is — only the key names change.

---

## 3. Phase 2: Source Code and Tests

All `import` and `import type` statements referencing `@relay-assistant/` are renamed to `@agent-assistant/`.

### 3.1 Source files (`packages/*/src/*.ts`)

| File | Import(s) to rename |
| --- | --- |
| `packages/core/src/types.ts` | `@relay-assistant/traits` → `@agent-assistant/traits` |
| `packages/connectivity/src/types.ts` | `@relay-assistant/routing` → `@agent-assistant/routing` (2 imports + 2 re-exports) |
| `packages/coordination/src/types.ts` | `@relay-assistant/connectivity` → `@agent-assistant/connectivity`, `@relay-assistant/routing` → `@agent-assistant/routing` |
| `packages/coordination/src/coordination.ts` | `@relay-assistant/connectivity` → `@agent-assistant/connectivity` |
| `packages/coordination/src/coordination.test.ts` | `@relay-assistant/connectivity` → `@agent-assistant/connectivity` |
| `packages/integration/src/integration.test.ts` | Any `@relay-assistant/*` references |
| `packages/examples/src/01-minimal-assistant.ts` | `@relay-assistant/core` → `@agent-assistant/core` |
| `packages/examples/src/02-traits-assistant.ts` | `@relay-assistant/core`, `@relay-assistant/traits` → `@agent-assistant/*` |
| `packages/examples/src/03-policy-gated-assistant.ts` | `@relay-assistant/core`, `@relay-assistant/policy` → `@agent-assistant/*` |
| `packages/examples/src/04-proactive-assistant.ts` | `@relay-assistant/core`, `@relay-assistant/proactive` → `@agent-assistant/*` |
| `packages/examples/src/05-full-assembly.ts` | `@relay-assistant/core`, `@relay-assistant/traits`, `@relay-assistant/policy`, `@relay-assistant/proactive` → `@agent-assistant/*` |

### 3.2 Comment references in source

Source file comments that reference `@relay-assistant/` package names (e.g., JSDoc, block comments in examples) are also renamed. These appear in:
- `packages/examples/src/05-full-assembly.ts` (header comment listing packages)
- `packages/examples/src/04-proactive-assistant.ts` (header comment)
- `packages/examples/src/03-policy-gated-assistant.ts` (header comment)
- `packages/examples/src/02-traits-assistant.ts` (header comment)
- `packages/integration/src/integration.test.ts` (describe block comments)

---

## 4. Phase 3: Consumer-Facing Docs

### 4.1 Root README.md — Full Rewrite

The root README.md receives a complete rewrite per the boundary document Section 4 requirements:
- Title: `# Agent Assistant SDK`
- All `@relay-assistant/*` → `@agent-assistant/*`
- All `RelayAssistant` → `Agent Assistant SDK` in prose
- All `Relay Agent Assistant` → `Agent Assistant SDK`
- All `relay-agent-assistant` → `agent-assistant-sdk` (repo references)
- Remove internal language (weekend plans, team names)
- Reframe for OSS audience without Relay ecosystem context
- Keep Relay foundation references (relay, relaycron, etc.) as-is but clarify they are separate infrastructure

### 4.2 Per-Package READMEs

Files (10 packages with READMEs):
- `packages/core/README.md`
- `packages/sessions/README.md`
- `packages/surfaces/README.md`
- `packages/traits/README.md`
- `packages/routing/README.md`
- `packages/connectivity/README.md`
- `packages/coordination/README.md`
- `packages/memory/README.md`
- `packages/proactive/README.md`
- `packages/policy/README.md`
- `packages/examples/README.md`

Replacements per file:
- `@relay-assistant/<pkg>` → `@agent-assistant/<pkg>` in all code examples, install commands, and prose
- `relay-assistant` → `agent-assistant` in package name prose
- `Relay Agent Assistant` → `Agent Assistant SDK` in descriptive text

### 4.3 docs/index.md

- Title: `Relay Agent Assistant Docs Index` → `Agent Assistant SDK Docs Index`
- All `@relay-assistant/*` → `@agent-assistant/*`
- `relay-agent-assistant` → `agent-assistant-sdk` in link text and descriptions
- Reference to `how-products-should-adopt-agent-assistant-sdk.md` — rename link text only (filename stays if it's the same file; see 4.5)

### 4.4 docs/current-state.md

- All `@relay-assistant/*` → `@agent-assistant/*` (package names in tables, blockers, baseline list)
- Update `@relay-assistant/coordination` dependency reference to `@agent-assistant/connectivity`

### 4.5 docs/consumer/*.md (6 files)

Files:
- `docs/consumer/how-to-build-an-assistant.md`
- `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md`
- `docs/consumer/sage-adoption-path.md`
- `docs/consumer/msd-adoption-path.md`
- `docs/consumer/nightcto-adoption-path.md`
- `docs/consumer/consumer-adoption-matrix.md`
- `docs/consumer/v1-product-adoption-matrix.md`
- `docs/consumer/connectivity-adoption-guide.md`

Replacements:
- All `@relay-assistant/*` → `@agent-assistant/*`
- All `relay-assistant` → `agent-assistant` in kebab-case identifiers
- All `RelayAssistant` → `Agent Assistant SDK` where it refers to the SDK product name

Note: The file `how-products-should-adopt-agent-assistant-sdk.md` keeps its filename for now (renaming files is a separate concern from renaming content). All internal references to this filename stay consistent.

### 4.6 docs/specs/*.md (7 spec files)

Files:
- `docs/specs/v1-core-spec.md`
- `docs/specs/v1-sessions-spec.md`
- `docs/specs/v1-surfaces-spec.md`
- `docs/specs/v1-routing-spec.md`
- `docs/specs/v1-connectivity-spec.md`
- `docs/specs/v1-traits-spec.md`
- `docs/specs/v1-memory-spec.md`
- `docs/specs/v1-proactive-spec.md`
- `docs/specs/v1-policy-spec.md`

Replacements:
- All `@relay-assistant/*` → `@agent-assistant/*` in package names, code examples, import statements, dependency tables
- Header package reference: `@relay-assistant/<pkg>` → `@agent-assistant/<pkg>`

### 4.7 docs/reference/*.md

Files:
- `docs/reference/glossary.md`
- `docs/reference/stability-and-versioning.md`
- `docs/reference/connectivity-signal-catalog.md`

Replacements:
- `@relay-assistant/*` → `@agent-assistant/*`
- `RelayAssistant` → `Agent Assistant SDK` where applicable

### 4.8 docs/workflows/*.md

Files:
- `docs/workflows/weekend-delivery-plan.md`
- `docs/workflows/v1-workflow-backlog.md`
- `docs/workflows/README.md`

Replacements:
- All `@relay-assistant/*` → `@agent-assistant/*`
- `relay-assistant` → `agent-assistant` in kebab-case identifiers

---

## 5. Phase 4: CI and Workflow Files

### 5.1 `.github/workflows/publish.yml`

Replacements:
- `@relay-assistant/` → `@agent-assistant/` in job names, step descriptions, npm publish commands
- `relay-agent-assistant` → `agent-assistant-sdk` in repository references
- `relay-assistant` → `agent-assistant` in inline scripts that reference package scope

### 5.2 `workflows/*.ts` (all workflow definition files)

Files (21 workflow files):
- `workflows/apply-agent-assistant-sdk-rename.ts`
- `workflows/audit-repo-for-robustness.ts`
- `workflows/audit-sdk-and-traits-alignment.ts`
- `workflows/cleanup-post-audit-and-package-followups.ts`
- `workflows/connectivity-package-spike.ts`
- `workflows/docs-first-sdk-scaffold.ts`
- `workflows/harden-v1-connectivity.ts`
- `workflows/harden-v1-coordination.ts`
- `workflows/implement-publish-infrastructure.ts`
- `workflows/implement-v1-assistant-assembly-examples.ts`
- `workflows/implement-v1-connectivity.ts`
- `workflows/implement-v1-coordination.ts`
- `workflows/implement-v1-coordination-routing-integration.ts`
- `workflows/implement-v1-core.ts`
- `workflows/implement-v1-foundation-integration.ts`
- `workflows/implement-v1-memory.ts`
- `workflows/implement-v1-policy.ts`
- `workflows/implement-v1-proactive.ts`
- `workflows/implement-v1-proactive-policy-integration.ts`
- `workflows/implement-v1-routing.ts`
- `workflows/implement-v1-sessions.ts`
- `workflows/implement-v1-surfaces.ts`
- `workflows/implement-v1-traits.ts`
- `workflows/implement-v1-traits-core-integration.ts`
- `workflows/investigate-and-specify-v1-memory.ts`
- `workflows/reconcile-canonical-specs.ts`
- `workflows/reconcile-plan-docs-to-specs.ts`
- `workflows/reconcile-v1-memory-spec-to-relay-memory.ts`
- `workflows/remediate-publish-infrastructure.ts`
- `workflows/rename-to-agent-assistant-sdk.ts`
- `workflows/specify-publish-infrastructure.ts`
- `workflows/specify-v1-connectivity.ts`
- `workflows/specify-v1-consumer-adoption-paths.ts`
- `workflows/specify-v1-policy.ts`
- `workflows/specify-v1-proactive.ts`
- `workflows/specify-v1-traits.ts`
- `workflows/specs-and-v1-program.ts`
- `workflows/tighten-repo-organization.ts`

Replacements per file:
- `wf-relay-assistant-` → `wf-agent-assistant-` in channel names
- `relay-agent-assistant` → `agent-assistant-sdk` in workflow names
- `relay-assistant` → `agent-assistant` in workflow descriptions and string literals
- `RelayAssistant` → `Agent Assistant SDK` in prose strings
- `@relay-assistant/` → `@agent-assistant/` in any package references within string literals

---

## 6. Phase 5: Active Architecture Docs

These architecture docs are actively referenced by consumers or linked from the docs index. They receive full rename treatment (not just header notes).

Files:
- `docs/architecture/package-boundary-map.md`
- `docs/architecture/traits-and-persona-layer.md`
- `docs/architecture/connectivity-package-spec.md`
- `docs/architecture/extraction-roadmap.md`
- `docs/architecture/oss-vs-cloud-split.md`
- `docs/architecture/assistant-cloud-interface.md`
- `docs/architecture/agent-assistant-sdk-rename-boundary.md` (already uses new names — no changes needed)
- `docs/architecture/robustness-audit-standard.md`
- `docs/architecture/v1-consumer-adoption-contract.md`

Replacements:
- All `@relay-assistant/*` → `@agent-assistant/*`
- `RelayAssistant` → `Agent Assistant SDK` in prose
- `relay-agent-assistant` → `agent-assistant-sdk` in repo references
- `relay-assistant` → `agent-assistant` in kebab-case identifiers

**Important:** Relay foundation references (`relay`, `relaycron`, `relayauth`, `relayfile`, `relaycast`, `@agent-relay/*`, `Relay foundation`, `Relay transport`) are NOT renamed.

---

## 7. Phase 6: Historical Docs — Header Note Only

These documents are historical records. They do NOT receive content rewrites. Instead, each gets the following header note inserted after the title line:

```markdown
> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.
```

### 7.1 Architecture plans

- `docs/architecture/v1-core-implementation-plan.md`
- `docs/architecture/v1-sessions-implementation-plan.md`
- `docs/architecture/v1-surfaces-implementation-plan.md`
- `docs/architecture/v1-routing-implementation-plan.md`
- `docs/architecture/v1-connectivity-implementation-plan.md`
- `docs/architecture/v1-connectivity-package-implementation-plan.md`
- `docs/architecture/v1-coordination-implementation-plan.md`
- `docs/architecture/v1-coordination-routing-integration-plan.md`
- `docs/architecture/v1-memory-implementation-plan.md`
- `docs/architecture/v1-memory-package-implementation-plan.md`
- `docs/architecture/v1-traits-implementation-plan.md`
- `docs/architecture/v1-traits-package-implementation-plan.md`
- `docs/architecture/v1-traits-core-integration-plan.md`
- `docs/architecture/v1-proactive-implementation-plan.md`
- `docs/architecture/v1-policy-implementation-plan.md`
- `docs/architecture/v1-proactive-policy-integration-plan.md`
- `docs/architecture/v1-foundation-integration-plan.md`
- `docs/architecture/v1-connectivity-hardening-plan.md`
- `docs/architecture/v1-coordination-hardening-plan.md`
- `docs/architecture/v1-assistant-assembly-examples-plan.md`
- `docs/architecture/post-audit-cleanup-plan.md`
- `docs/architecture/canonical-spec-fix-plan.md`
- `docs/architecture/publish-infrastructure-implementation-plan.md`
- `docs/architecture/publish-infrastructure-implementation-boundary.md`
- `docs/architecture/publish-infrastructure-remediation-boundary.md`
- `docs/architecture/workforce-profile-consumption-plan.md`

### 7.2 Architecture verdicts

- `docs/architecture/v1-core-review-verdict.md`
- `docs/architecture/v1-sessions-review-verdict.md`
- `docs/architecture/v1-surfaces-review-verdict.md`
- `docs/architecture/v1-routing-review-verdict.md`
- `docs/architecture/v1-connectivity-review-verdict.md`
- `docs/architecture/v1-connectivity-package-review-verdict.md`
- `docs/architecture/v1-connectivity-hardening-review-verdict.md`
- `docs/architecture/v1-coordination-review-verdict.md`
- `docs/architecture/v1-coordination-hardening-review-verdict.md`
- `docs/architecture/v1-coordination-routing-integration-review-verdict.md`
- `docs/architecture/v1-memory-review-verdict.md`
- `docs/architecture/v1-memory-package-review-verdict.md`
- `docs/architecture/v1-traits-review-verdict.md`
- `docs/architecture/v1-traits-package-review-verdict.md`
- `docs/architecture/v1-traits-core-integration-review-verdict.md`
- `docs/architecture/v1-proactive-package-review-verdict.md`
- `docs/architecture/v1-policy-package-review-verdict.md`
- `docs/architecture/v1-proactive-policy-integration-review-verdict.md`
- `docs/architecture/v1-assistant-assembly-examples-review-verdict.md`
- `docs/architecture/v1-consumer-adoption-review-verdict.md`
- `docs/architecture/review-verdict.md`
- `docs/architecture/spec-reconciliation-review-verdict.md`
- `docs/architecture/sdk-audit-and-traits-alignment-review-verdict.md`
- `docs/architecture/post-audit-cleanup-review-verdict.md`
- `docs/architecture/robustness-audit-review-verdict.md`
- `docs/architecture/publish-infrastructure-review-verdict.md`
- `docs/architecture/publish-infrastructure-implementation-review-verdict.md`
- `docs/architecture/publish-infrastructure-remediation-review-verdict.md`
- `docs/architecture/connectivity-review-verdict.md`
- `docs/architecture/repo-tightening-review-verdict.md`

### 7.3 Architecture proofs and contracts (historical)

- `docs/architecture/v1-traits-core-integration-proof.md`
- `docs/architecture/v1-traits-core-integration-contract.md`
- `docs/architecture/v1-proactive-policy-integration-proof.md`
- `docs/architecture/v1-proactive-policy-integration-contract.md`
- `docs/architecture/v1-proactive-contract-reconciliation.md`
- `docs/architecture/v1-memory-reconciliation-plan.md`
- `docs/architecture/v1-memory-reconciliation-review-verdict.md`
- `docs/architecture/spec-reconciliation-rules.md`
- `docs/architecture/spec-program-plan.md`
- `docs/architecture/spec-program-review-verdict.md`

### 7.4 Scope documents (historical)

- `docs/architecture/v1-proactive-scope.md`
- `docs/architecture/v1-policy-scope.md`
- `docs/architecture/v1-connectivity-scope.md`
- `docs/architecture/v1-memory-scope.md`
- `docs/architecture/v1-traits-scope.md`
- `docs/architecture/v1-sectioning-and-priorities.md`

### 7.5 Audit and remediation (historical)

- `docs/architecture/robustness-audit-report.md`
- `docs/architecture/robustness-remediation-backlog.md`
- `docs/architecture/sdk-audit-and-traits-alignment-plan.md`

### 7.6 Publish infrastructure (historical)

- `docs/architecture/publish-infrastructure-contract.md`
- `docs/architecture/publish-package-readiness-matrix.md`

### 7.7 Research documents

- `docs/research/memory-reuse-investigation.md`
- `docs/research/proactive-runtime-notes.md`
- `docs/research/policy-runtime-notes.md`
- `docs/research/traits-vs-workforce-personas.md`
- `docs/research/internal-system-comparison.md`
- `docs/research/memory-system-design-axes.md`
- `docs/research/connectivity-patterns.md`

### 7.8 Other historical architecture docs

- `docs/architecture/2026-04-11-relay-agent-assistant-architecture-draft.md`
- `docs/architecture/always-on-domain-agents-and-librarian-model.md`
- `docs/architecture/emerging-relay-primitives-for-assistants.md`
- `docs/architecture/relayauth-for-compartmented-memory-and-policy.md`
- `docs/architecture/source-of-truth.md`

---

## 8. String Replacement Reference

These are the canonical replacements, applied in order (longest match first to avoid partial replacements):

| Priority | Old Pattern | New Pattern | Context |
| --- | --- | --- | --- |
| 1 | `@relay-assistant/` | `@agent-assistant/` | Package scope in code, configs, docs |
| 2 | `relay-agent-assistant-monorepo` | `agent-assistant-sdk-monorepo` | Root package name |
| 3 | `relay-agent-assistant` | `agent-assistant-sdk` | Repository name references |
| 4 | `Relay Agent Assistant` | `Agent Assistant SDK` | Full product name in prose |
| 5 | `RelayAssistant` | `Agent Assistant SDK` | PascalCase product references in prose |
| 6 | `relay-assistant` (in package/repo context) | `agent-assistant` | Kebab-case identifiers |
| 7 | `wf-relay-assistant-` | `wf-agent-assistant-` | Workflow channel names |

**DO NOT replace:**
- `relay` alone — refers to the Relay foundation project
- `Relay` alone — often refers to Relay foundation or transport
- `Relay foundation` / `Relay transport` — separate infrastructure
- `@agent-relay/*` — upstream dependency packages
- `relaycron` / `relayauth` / `relayfile` / `relaycast` — sibling projects
- `AgentWorkforce/cloud` — separate repo

---

## 9. What Is NOT Changed in This Pass

| Category | Reason |
| --- | --- |
| Git commit messages | Immutable history |
| Architecture plan/verdict/proof **content** | Historical records — header note added instead |
| Research document **content** | Historical records — header note added instead |
| Relay foundation references | Separate project; names are correct |
| `@agent-relay/*` package references | Upstream dependencies; not this SDK |
| Filenames of historical docs | Filenames are historical identifiers |
| `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md` filename | Filename change is a separate concern; internal links stay consistent |

---

## 10. Manual / External Follow-Up (After This Pass)

These actions cannot be completed in this rename pass and require external system access:

| Action | Owner | When |
| --- | --- | --- |
| Rename GitHub repo `AgentWorkforce/relay-agent-assistant` → `AgentWorkforce/agent-assistant-sdk` | GitHub org admin | Before first publish under new name |
| Register npm scope `@agent-assistant` on npmjs.com | npm org admin | Before first publish |
| Update GitHub repo description | GitHub org admin | After repo rename |
| Update CI secrets referencing old repo name | DevOps | After repo rename |
| Update external links in relay, sage, msd, nightcto, cloud repos | Each repo owner | After repo rename (GitHub redirects cover interim) |
| First publish of `@agent-assistant/*` packages | Release engineer | After npm scope registration |
| Deprecate `@relay-assistant/*` on npm (if ever published) | Release engineer | After new scope publish confirmed |
| Update Workforce workload-router references (if any) | Workforce repo | Check for hardcoded `@relay-assistant/*` references |
| Rename file `how-products-should-adopt-agent-assistant-sdk.md` | This repo | Separate cleanup PR |

---

## 11. Validation Criteria

The rename pass is complete when all of the following are true:

1. `rg "@relay-assistant/" packages/*/src/ packages/*/package.json` returns **zero results**
2. `rg "@relay-assistant/" .github/` returns **zero results**
3. `rg "RelayAssistant" README.md docs/index.md docs/current-state.md docs/consumer/ docs/specs/` returns **zero results**
4. `rg "Relay Agent Assistant" README.md docs/index.md docs/current-state.md docs/consumer/ docs/specs/` returns **zero results**
5. All `package.json` files use `@agent-assistant/*` scope
6. Root `package.json` name is `agent-assistant-sdk-monorepo`
7. All source imports resolve to `@agent-assistant/*`
8. All per-package READMEs reference `@agent-assistant/*`
9. All spec docs reference `@agent-assistant/*`
10. Historical architecture docs have the standard header note
11. `.github/workflows/publish.yml` references `@agent-assistant/*`
12. All `workflows/*.ts` files use `wf-agent-assistant-*` channel names
13. Tests pass after rename (`npx vitest run` in packages with passing tests)
14. TypeScript builds succeed for publishable packages (`npm run build` in core, sessions, surfaces, traits)

---

## 12. Execution Estimate

| Phase | File Count | Complexity |
| --- | --- | --- |
| P1: Package manifests | 13 | Low — mechanical field replacement |
| P2: Source code and tests | 15 | Low — import path replacement |
| P3: Consumer docs | 30 | Medium — prose + code examples + tables |
| P4: CI and workflows | 25 | Low — string literal replacement |
| P5: Active architecture docs | 9 | Medium — prose + code examples |
| P6: Historical header notes | 60+ | Low — insert one line per file |
| **Total** | **~150 files** | |

The rename is predominantly mechanical replacement with two exceptions:
1. Root README.md requires a structural rewrite (not just find-replace)
2. Active architecture docs require careful Relay foundation vs SDK name discrimination

---

AGENT_ASSISTANT_RENAME_APPLICATION_BOUNDARY_READY
