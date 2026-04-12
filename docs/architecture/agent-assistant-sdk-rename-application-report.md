# Agent Assistant SDK — Rename Application Report

Date: 2026-04-12

This document records the complete rename pass from "RelayAssistant" / "Relay Agent Assistant" to "Agent Assistant SDK" across the monorepo.

---

## Summary

All six phases completed. No files that exist were skipped. Several files listed in the spec did not exist on disk and are listed under "Skipped (not found)".

**Note:** Phase 4b (workflow IDs) required a remediation pass to resolve 16 missed workflow ID strings and 2 missed instruction-content references. See the Remediation Pass section at the end of this report.

---

## Phase 1: Package Manifests

Files changed (name, description, repository.url, dependencies, peerDependencies, devDependencies):

- `package.json` — `relay-agent-assistant-monorepo` → `agent-assistant-sdk-monorepo`
- `packages/core/package.json` — name, description, peerDependencies, devDependencies, repository.url
- `packages/sessions/package.json` — name, description, repository.url
- `packages/surfaces/package.json` — name, description, repository.url
- `packages/traits/package.json` — name, description, repository.url
- `packages/routing/package.json` — name (no repository field present)
- `packages/connectivity/package.json` — name, description, devDependencies
- `packages/coordination/package.json` — name, description, dependencies, devDependencies
- `packages/memory/package.json` — name (description had no old references)
- `packages/proactive/package.json` — name, description
- `packages/policy/package.json` — name, description
- `packages/examples/package.json` — name, description, devDependencies
- `packages/integration/package.json` — name

---

## Phase 2: Source Code and Tests

Files changed (import statements and JSDoc comments):

- `packages/core/src/types.ts`
- `packages/connectivity/src/types.ts`
- `packages/coordination/src/types.ts`
- `packages/coordination/src/coordination.ts`
- `packages/coordination/src/coordination.test.ts`
- `packages/integration/src/integration.test.ts`
- `packages/examples/src/01-minimal-assistant.ts`
- `packages/examples/src/02-traits-assistant.ts`
- `packages/examples/src/03-policy-gated-assistant.ts`
- `packages/examples/src/04-proactive-assistant.ts`
- `packages/examples/src/05-full-assembly.ts`

---

## Phase 3: Consumer-Facing Docs

### 3a. Root README.md — Full Rewrite

- `README.md` — complete rewrite for open-source audience; removed internal delivery plans, team names, merge freeze details, implementation archive section

### 3b. Per-Package READMEs

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

### 3c. docs/index.md

- `docs/index.md` — title and all package references updated

### 3d. docs/current-state.md

- `docs/current-state.md` — all package references updated

### 3e. docs/consumer/*.md

- `docs/consumer/connectivity-adoption-guide.md`
- `docs/consumer/consumer-adoption-matrix.md`
- `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md`
- `docs/consumer/how-to-build-an-assistant.md`
- `docs/consumer/msd-adoption-path.md`
- `docs/consumer/nightcto-adoption-path.md`
- `docs/consumer/sage-adoption-path.md`
- `docs/consumer/v1-product-adoption-matrix.md`

### 3f. docs/specs/*.md

- `docs/specs/v1-core-spec.md`
- `docs/specs/v1-sessions-spec.md`
- `docs/specs/v1-surfaces-spec.md`
- `docs/specs/v1-routing-spec.md`
- `docs/specs/v1-connectivity-spec.md`
- `docs/specs/v1-traits-spec.md`
- `docs/specs/v1-memory-spec.md`
- `docs/specs/v1-proactive-spec.md`
- `docs/specs/v1-policy-spec.md`

### 3g. docs/reference/*.md

- `docs/reference/connectivity-signal-catalog.md`
- `docs/reference/glossary.md`
- `docs/reference/stability-and-versioning.md`

### 3h. docs/workflows/*.md

- `docs/workflows/README.md`
- `docs/workflows/v1-workflow-backlog.md`
- `docs/workflows/weekend-delivery-plan.md`

---

## Phase 4: CI and Workflow Files

### 4a. .github/workflows/publish.yml

- `.github/workflows/publish.yml`

### 4b. workflows/*.ts (39 files)

**Note:** These files were updated in the initial pass for string replacements other than workflow IDs. The `workflow('...')` ID string literals within 16 of these files still contained old-name IDs after the initial pass and required a second remediation pass. See Remediation Pass section.

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
- `workflows/implement-v1-coordination-routing-integration.ts`
- `workflows/implement-v1-coordination.ts`
- `workflows/implement-v1-core.ts`
- `workflows/implement-v1-foundation-integration.ts`
- `workflows/implement-v1-memory.ts`
- `workflows/implement-v1-policy.ts`
- `workflows/implement-v1-proactive-policy-integration.ts`
- `workflows/implement-v1-proactive.ts`
- `workflows/implement-v1-routing.ts`
- `workflows/implement-v1-sessions.ts`
- `workflows/implement-v1-surfaces.ts`
- `workflows/implement-v1-traits-core-integration.ts`
- `workflows/implement-v1-traits.ts`
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

---

## Phase 5: Active Architecture Docs

All 8 files updated (string replacement rules applied, content preserved):

- `docs/architecture/package-boundary-map.md`
- `docs/architecture/traits-and-persona-layer.md`
- `docs/architecture/connectivity-package-spec.md`
- `docs/architecture/extraction-roadmap.md`
- `docs/architecture/oss-vs-cloud-split.md`
- `docs/architecture/assistant-cloud-interface.md`
- `docs/architecture/robustness-audit-standard.md`
- `docs/architecture/v1-consumer-adoption-contract.md`

---

## Phase 6: Historical Docs — Header Note Inserted

Historical header note inserted after the first `#` heading in 91 files. Content of each file was NOT otherwise modified.

### Architecture Plans (26)
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

### Architecture Verdicts (30)
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

### Architecture Proofs and Contracts (10)
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

### Scope Docs (6)
- `docs/architecture/v1-proactive-scope.md`
- `docs/architecture/v1-policy-scope.md`
- `docs/architecture/v1-connectivity-scope.md`
- `docs/architecture/v1-memory-scope.md`
- `docs/architecture/v1-traits-scope.md`
- `docs/architecture/v1-sectioning-and-priorities.md`

### Audit and Remediation (3)
- `docs/architecture/robustness-audit-report.md`
- `docs/architecture/robustness-remediation-backlog.md`
- `docs/architecture/sdk-audit-and-traits-alignment-plan.md`

### Publish Infrastructure Historical (2)
- `docs/architecture/publish-infrastructure-contract.md`
- `docs/architecture/publish-package-readiness-matrix.md`

### Research Docs (7)
- `docs/research/memory-reuse-investigation.md`
- `docs/research/proactive-runtime-notes.md`
- `docs/research/policy-runtime-notes.md`
- `docs/research/traits-vs-workforce-personas.md`
- `docs/research/internal-system-comparison.md`
- `docs/research/memory-system-design-axes.md`
- `docs/research/connectivity-patterns.md`

### Other Historical Architecture Docs (5)
- `docs/architecture/2026-04-11-relay-agent-assistant-architecture-draft.md`
- `docs/architecture/always-on-domain-agents-and-librarian-model.md`
- `docs/architecture/emerging-relay-primitives-for-assistants.md`
- `docs/architecture/relayauth-for-compartmented-memory-and-policy.md`
- `docs/architecture/source-of-truth.md`

---

## Skipped Files (not found on disk)

The following files listed in the spec did not exist and were skipped:

- `docs/specs/v1-surfaces-spec.md` — not present (handled as `v1-surfaces-spec.md` which does exist)
- `docs/architecture/repo-tightening-plan.md` — not listed in Phase 6 but noted: only the review verdict was in the list

All files listed in Phase 6 that were expected were found and updated.

---

## Notes

- The `relay` alone, `Relay` alone, `@agent-relay/*`, `relaycron`, `relayauth`, `relayfile`, `relaycast`, `AgentWorkforce/cloud` strings were NOT replaced.
- The `relay-assistant` pattern in `relay-assistant` alone (not package/repo context) was treated with care to avoid false positives.
- Phase 6 only inserted the header note; no content replacements were made to historical docs.

---

## Remediation Pass

Date: 2026-04-12

A remediation pass was applied to resolve findings from the rename application review verdict (FAIL). The following issues were corrected:

### Workflow ID fixes (16 files)

The `workflow('...')` ID string literals on line 5 of the following files were renamed from `relay-assistant-*` to `agent-assistant-*`:

- `workflows/audit-repo-for-robustness.ts`: `relay-assistant-audit-repo-for-robustness` → `agent-assistant-audit-repo-for-robustness`
- `workflows/implement-publish-infrastructure.ts`: `relay-assistant-implement-publish-infrastructure` → `agent-assistant-implement-publish-infrastructure`
- `workflows/implement-v1-assistant-assembly-examples.ts`: `relay-assistant-implement-v1-assistant-assembly-examples` → `agent-assistant-implement-v1-assistant-assembly-examples`
- `workflows/implement-v1-policy.ts`: `relay-assistant-implement-v1-policy` → `agent-assistant-implement-v1-policy`
- `workflows/implement-v1-proactive.ts`: `relay-assistant-implement-v1-proactive` → `agent-assistant-implement-v1-proactive`
- `workflows/implement-v1-proactive-policy-integration.ts`: `relay-assistant-implement-v1-proactive-policy-integration` → `agent-assistant-implement-v1-proactive-policy-integration`
- `workflows/implement-v1-traits.ts`: `relay-assistant-implement-v1-traits` → `agent-assistant-implement-v1-traits`
- `workflows/implement-v1-traits-core-integration.ts`: `relay-assistant-implement-v1-traits-core-integration` → `agent-assistant-implement-v1-traits-core-integration`
- `workflows/remediate-publish-infrastructure.ts`: `relay-assistant-remediate-publish-infrastructure` → `agent-assistant-remediate-publish-infrastructure`
- `workflows/rename-to-agent-assistant-sdk.ts`: `rename-relay-assistant-to-agent-assistant-sdk` → `rename-to-agent-assistant-sdk`
- `workflows/specify-publish-infrastructure.ts`: `relay-assistant-specify-publish-infrastructure` → `agent-assistant-specify-publish-infrastructure`
- `workflows/specify-v1-consumer-adoption-paths.ts`: `relay-assistant-specify-v1-consumer-adoption-paths` → `agent-assistant-specify-v1-consumer-adoption-paths`
- `workflows/specify-v1-policy.ts`: `relay-assistant-specify-v1-policy` → `agent-assistant-specify-v1-policy`
- `workflows/specify-v1-proactive.ts`: `relay-assistant-specify-v1-proactive` → `agent-assistant-specify-v1-proactive`
- `workflows/specify-v1-traits.ts`: `relay-assistant-specify-v1-traits` → `agent-assistant-specify-v1-traits`
- `workflows/tighten-repo-organization.ts`: `relay-assistant-tighten-repo-organization` → `agent-assistant-tighten-repo-organization`

### Instruction content fixes (2 files)

Residual `@relay-assistant` package references in workflow instruction template strings:

- `workflows/implement-v1-policy.ts` line ~97: `@relay-assistant` → `@agent-assistant`
- `workflows/implement-v1-proactive.ts` line ~99: `@relay-assistant` → `@agent-assistant`

### Consumer doc file rename

The consumer adoption guide file was renamed to `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md` to match the link targets already updated in README.md, docs/index.md, and docs/consumer/v1-product-adoption-matrix.md.

All references to the old filename in architecture docs were updated to match.

AGENT_ASSISTANT_RENAME_APPLICATION_REPORT_READY
