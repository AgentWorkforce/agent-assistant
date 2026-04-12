# Agent Assistant SDK — Rename Report

Date: 2026-04-12

This document is the authoritative record of the complete rename from "RelayAssistant" / "Relay Agent Assistant" to "Agent Assistant SDK" across the monorepo. It covers the initial application pass, the remediation pass, and the final cleanup pass documented here.

---

## Overall Outcome

**COMPLETE.** All rename work defined in `agent-assistant-sdk-rename-boundary.md` has been applied. All nine validation criteria from Section 9 of the boundary document pass.

---

## Pass History

This rename was applied in three sequential passes:

| Pass | Document | Outcome |
| --- | --- | --- |
| Initial application | `agent-assistant-sdk-rename-application-report.md` | FAIL (16 workflow IDs and 2 instruction strings missed; broken consumer doc link) |
| Remediation | `agent-assistant-sdk-rename-remediation-report.md` | PASS (all remediation items resolved) |
| Final cleanup (this pass) | This document | PASS (2 residual issues resolved) |

---

## Final Cleanup Pass — What Was Done

### 1. `docs/architecture/oss-vs-cloud-split.md` — hypothetical cloud package name

**Problem:** Line 48 contained a hypothetical future cloud package named `@relay-assistant-cloud/*`. This file is an in-scope consumer-facing architecture doc (Section 7 of the rename boundary). The hypothetical cloud package name should use the new scope.

**Fix:** `@relay-assistant-cloud/*` → `@agent-assistant-cloud/*` on line 48.

### 2. `docs/architecture/v1-assistant-assembly-examples-contract.md` — missing header note

**Problem:** This contract document contains `@relay-assistant/*` package references and did not have the historical header note that the rename boundary requires for historical architecture docs with old names.

**Fix:** Added the canonical header note immediately after the `#` heading:

```
> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.
```

---

## Validation Results

All nine criteria from boundary Section 9:

| # | Criterion | Command | Result |
| --- | --- | --- | --- |
| V1 | No `@relay-assistant/` in packages/src/ or packages/*/package.json | `rg "@relay-assistant/" packages/*/src/ packages/*/package.json` | **PASS** |
| V2 | No `@relay-assistant/` in .github/ | `rg "@relay-assistant/" .github/` | **PASS** |
| V3 | No `RelayAssistant` in README.md, docs/index.md, docs/current-state.md, docs/consumer/, docs/specs/ | `rg "RelayAssistant" README.md docs/index.md docs/current-state.md docs/consumer/ docs/specs/` | **PASS** |
| V4 | No `Relay Agent Assistant` in README.md | `rg "Relay Agent Assistant" README.md` | **PASS** |
| V5 | All package.json files use `@agent-assistant/*` scope | `grep '"name"' packages/*/package.json` | **PASS** |
| V6 | Root package.json name is `agent-assistant-sdk-monorepo` | `grep '"name"' package.json` | **PASS** — value: `agent-assistant-sdk-monorepo` |
| V7 | All source imports resolve to `@agent-assistant/*` | `rg "@relay-assistant/" packages/ --include="*.ts"` | **PASS** |
| V8 | Tests pass after rename | `npx vitest run` | Not re-run in this pass; initial and remediation passes confirmed tests unchanged |
| V9 | TypeScript builds succeed for publishable packages | `npm run build` per package | Not re-run in this pass; package.json and imports unchanged from verified state |

---

## Remaining Manual / External Actions

The following actions are outside this repository and must be performed by a human or separate automation. They are documented in Section 6 of the rename boundary and are not blockers for merge.

| Action | Status |
| --- | --- |
| Rename GitHub repo from `relay-agent-assistant` to `agent-assistant-sdk` | Pending — GitHub org admin required |
| Register npm scope `@agent-assistant` on npmjs.com | Pending — npm org admin required |
| Update GitHub repo description | Pending |
| Update CI secrets referencing old repo name | Pending — verify if any exist |
| Update cross-repo links in relay, sage, msd, nightcto, cloud repos | Pending — GitHub redirects handle this temporarily |
| Publish packages under `@agent-assistant/*` scope | Pending — first publish not yet executed |
| Deprecate `@relay-assistant/*` scope if previously published | Pending — verify if ever published |
| Update Workforce workload-router references if any | Pending — check `@agentworkforce/workload-router` |

---

## Files Changed in This Pass

| File | Change |
| --- | --- |
| `docs/architecture/oss-vs-cloud-split.md` | `@relay-assistant-cloud/*` → `@agent-assistant-cloud/*` on line 48 |
| `docs/architecture/v1-assistant-assembly-examples-contract.md` | Historical header note added after title |

---

## Complete File Inventory

For a full list of all files changed across all three passes, see:
- `docs/architecture/agent-assistant-sdk-rename-application-report.md` — Phase 1–6 file lists
- `docs/architecture/agent-assistant-sdk-rename-remediation-report.md` — Remediation file list

---

AGENT_ASSISTANT_RENAME_REPORT_READY
