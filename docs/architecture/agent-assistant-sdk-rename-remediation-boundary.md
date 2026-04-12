# Agent Assistant SDK — Rename Remediation Boundary

> Authoritative boundary for the remediation pass that resolves findings from the rename application review verdict. All remediation work derives from this document.

Date: 2026-04-12

---

## 1. Context

The initial rename application (documented in `agent-assistant-sdk-rename-application-report.md`) was reviewed and received a **FAIL** verdict. The review identified three categories of remaining issues:

1. Active workflow IDs still use the retired `relay-assistant` name
2. Public README and docs link to a consumer doc path that does not exist on disk
3. The application report overclaims completion

This remediation boundary scopes the exact fixes required. No naming decisions are reopened. No package manifests, source imports, or historical docs are touched — those were correctly handled in the initial pass.

---

## 2. Remediation Scope

### 2.1 Workflow IDs: rename `relay-assistant-*` to `agent-assistant-*`

**Problem:** 16 workflow `.ts` files still pass old-name workflow IDs to `workflow()`. These are active operational identifiers, not historical content.

**Action:** Replace the workflow ID string literal on line 5 of each file. The replacement rule is:

| Old Pattern | New Pattern |
| --- | --- |
| `workflow('relay-assistant-<suffix>')` | `workflow('agent-assistant-<suffix>')` |
| `workflow('rename-relay-assistant-to-agent-assistant-sdk')` | `workflow('rename-to-agent-assistant-sdk')` |

**Files (16):**

| File | Old ID | New ID |
| --- | --- | --- |
| `workflows/audit-repo-for-robustness.ts` | `relay-assistant-audit-repo-for-robustness` | `agent-assistant-audit-repo-for-robustness` |
| `workflows/implement-publish-infrastructure.ts` | `relay-assistant-implement-publish-infrastructure` | `agent-assistant-implement-publish-infrastructure` |
| `workflows/implement-v1-assistant-assembly-examples.ts` | `relay-assistant-implement-v1-assistant-assembly-examples` | `agent-assistant-implement-v1-assistant-assembly-examples` |
| `workflows/implement-v1-policy.ts` | `relay-assistant-implement-v1-policy` | `agent-assistant-implement-v1-policy` |
| `workflows/implement-v1-proactive.ts` | `relay-assistant-implement-v1-proactive` | `agent-assistant-implement-v1-proactive` |
| `workflows/implement-v1-proactive-policy-integration.ts` | `relay-assistant-implement-v1-proactive-policy-integration` | `agent-assistant-implement-v1-proactive-policy-integration` |
| `workflows/implement-v1-traits.ts` | `relay-assistant-implement-v1-traits` | `agent-assistant-implement-v1-traits` |
| `workflows/implement-v1-traits-core-integration.ts` | `relay-assistant-implement-v1-traits-core-integration` | `agent-assistant-implement-v1-traits-core-integration` |
| `workflows/remediate-publish-infrastructure.ts` | `relay-assistant-remediate-publish-infrastructure` | `agent-assistant-remediate-publish-infrastructure` |
| `workflows/rename-to-agent-assistant-sdk.ts` | `rename-relay-assistant-to-agent-assistant-sdk` | `rename-to-agent-assistant-sdk` |
| `workflows/specify-publish-infrastructure.ts` | `relay-assistant-specify-publish-infrastructure` | `agent-assistant-specify-publish-infrastructure` |
| `workflows/specify-v1-consumer-adoption-paths.ts` | `relay-assistant-specify-v1-consumer-adoption-paths` | `agent-assistant-specify-v1-consumer-adoption-paths` |
| `workflows/specify-v1-policy.ts` | `relay-assistant-specify-v1-policy` | `agent-assistant-specify-v1-policy` |
| `workflows/specify-v1-proactive.ts` | `relay-assistant-specify-v1-proactive` | `agent-assistant-specify-v1-proactive` |
| `workflows/specify-v1-traits.ts` | `relay-assistant-specify-v1-traits` | `agent-assistant-specify-v1-traits` |
| `workflows/tighten-repo-organization.ts` | `relay-assistant-tighten-repo-organization` | `agent-assistant-tighten-repo-organization` |

**Scope constraint:** Only the `workflow('...')` string literal is changed. Workflow instruction content (the multi-line template strings) is NOT modified in this pass unless it contains stale `@relay-assistant/` package references — those were already handled in the initial rename. The two residual old-scope strings in instruction content (`implement-v1-policy.ts:97` and `implement-v1-proactive.ts:99`) are addressed in 2.2.

### 2.2 Residual old-scope strings in workflow instructions

**Problem:** Two workflow files contain `@relay-assistant` package references in their instruction template strings that were missed in the initial pass.

**Action:** Replace the old-scope references in the instruction content.

| File | Line | Old | New |
| --- | --- | --- | --- |
| `workflows/implement-v1-policy.ts` | ~97 | `@relay-assistant` | `@agent-assistant` |
| `workflows/implement-v1-proactive.ts` | ~99 | `@relay-assistant` | `@agent-assistant` |

**Scope constraint:** Only the specific `@relay-assistant` substring within these lines is replaced. No other content in these files is modified beyond what 2.1 already covers.

### 2.3 Broken consumer-doc links: file rename

**Problem:** The initial rename pass updated link text and link targets in README.md, docs/index.md, and docs/consumer/v1-product-adoption-matrix.md to point at `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md`. But the actual file on disk is still named `docs/consumer/how-products-should-adopt-relay-agent-assistant.md`. The application boundary noted that "the filename would stay unchanged for now," but the links were updated anyway, creating broken navigation.

**Decision: Rename the file to match the links.**

Renaming the file is simpler and more correct than reverting multiple links. The file content was already updated in the initial pass to use the new product name. Keeping the old filename creates ongoing confusion.

**Action:**

1. `git mv docs/consumer/how-products-should-adopt-relay-agent-assistant.md docs/consumer/how-products-should-adopt-agent-assistant-sdk.md`

2. Update any remaining references to the old filename:

| File | Old Reference | New Reference |
| --- | --- | --- |
| `docs/architecture/v1-assistant-assembly-examples-plan.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |
| `docs/architecture/v1-assistant-assembly-examples-review-verdict.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |
| `docs/architecture/v1-assistant-assembly-examples-contract.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |
| `docs/architecture/robustness-audit-report.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |
| `docs/architecture/robustness-audit-review-verdict.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |
| `docs/architecture/review-verdict.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |
| `docs/architecture/robustness-remediation-backlog.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |
| `docs/architecture/agent-assistant-sdk-rename-application-boundary.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |
| `docs/architecture/agent-assistant-sdk-rename-application-report.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |
| `docs/architecture/agent-assistant-sdk-rename-application-review-verdict.md` | `how-products-should-adopt-relay-agent-assistant.md` | `how-products-should-adopt-agent-assistant-sdk.md` |

**Scope constraint:** These architecture docs are historical, but the filename references in them are navigation-functional (readers may click them). Updating filenames in links is not rewriting history — it is maintaining navigability. The header note already clarifies the historical context.

**Note on workflow files referencing the old filename:** The following workflow `.ts` files also reference the old filename in their instruction strings and should be updated in the same pass:

| File | Context |
| --- | --- |
| `workflows/implement-v1-assistant-assembly-examples.ts` | sed command and file list referencing old name |
| `workflows/specify-v1-consumer-adoption-paths.ts` | sed command and file list referencing old name |
| `workflows/docs-first-sdk-scaffold.ts` | file list and existence check referencing old name |

### 2.4 Application report correction

**Problem:** The application report (`docs/architecture/agent-assistant-sdk-rename-application-report.md`) claims "All six phases completed successfully" and lists `workflows/*.ts` as fully updated across 39 files. This is inaccurate — 16 workflow IDs and 2 instruction-content references were missed.

**Action:** After the remediation pass is applied, update the application report:

1. Change "All six phases completed successfully" to "All six phases completed. Phase 4b (workflow IDs) required a remediation pass to resolve 16 missed workflow ID strings and 2 missed instruction-content references."

2. Add a "Remediation Pass" section at the end of the report documenting what was fixed and when.

3. The Phase 4b file list remains accurate (those files were touched in the initial pass for other string replacements) — add a note that workflow IDs within those files required a second pass.

**Scope constraint:** Only the accuracy claims are corrected. The rest of the report is not modified.

---

## 3. Explicitly Out of Scope

The following are NOT part of this remediation:

| Item | Reason |
| --- | --- |
| Package manifest changes | Already correct from initial pass |
| Source code import changes | Already correct from initial pass |
| Historical architecture doc content | Correctly handled via header notes |
| Root README content or structure | Already rewritten; only the link target was broken |
| npm scope or GitHub repo rename | External actions; unchanged |
| `docs/architecture/agent-assistant-sdk-rename-boundary.md` | Original boundary doc; historical record |
| Workflow files not listed in 2.1 | Already have correct IDs (e.g., files that were created after the rename or had different naming patterns) |
| Research docs (`docs/research/*.md`) | Historical; header notes already applied |

---

## 4. Execution Order

The remediation is a single atomic pass with this execution order:

1. **File rename** (2.3 step 1): `git mv` the consumer doc file
2. **Workflow ID fixes** (2.1): Update all 16 workflow ID strings
3. **Instruction content fixes** (2.2): Fix the 2 residual `@relay-assistant` references in workflow instructions
4. **Filename reference fixes** (2.3 step 2): Update old filename references in architecture docs and workflow instruction strings
5. **Report correction** (2.4): Update the application report to reflect actual completion state

Steps 2, 3, and 4 can be parallelized. Step 5 runs after all other fixes land so the report accurately describes the final state.

---

## 5. Validation Criteria

The remediation is complete when:

1. `rg "workflow\('relay-assistant-" workflows/` returns **zero results**
2. `rg "workflow\('rename-relay-" workflows/` returns **zero results**
3. `rg "@relay-assistant" workflows/` returns **zero results** (confirming 2.2)
4. `test -f docs/consumer/how-products-should-adopt-agent-assistant-sdk.md` succeeds
5. `test -f docs/consumer/how-products-should-adopt-relay-agent-assistant.md` fails (old file removed)
6. `rg "how-products-should-adopt-relay-agent-assistant" README.md docs/ workflows/` returns **zero results**
7. The application report no longer claims unqualified complete success for Phase 4b
8. All validation criteria from the original rename boundary (section 9) still pass

---

## 6. Risk Assessment

**Risk: Workflow channel name collisions.** Changing workflow IDs means that if any workflow execution state is stored keyed by the old ID, it will become orphaned. This is acceptable — workflows are re-runnable and no production state depends on workflow ID continuity.

**Risk: File rename breaks git history.** `git mv` preserves history tracking. The file content is unchanged. This is a safe operation.

**Risk: Scope creep.** This boundary is deliberately narrow. The three categories of fixes directly address the review verdict findings and nothing else.

---

AGENT_ASSISTANT_RENAME_REMEDIATION_BOUNDARY_READY
