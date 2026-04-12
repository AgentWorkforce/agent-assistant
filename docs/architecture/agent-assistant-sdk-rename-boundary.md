# Agent Assistant SDK — Rename Boundary

> Authoritative boundary document for renaming RelayAssistant to Agent Assistant SDK. All rename work derives from this document.

Date: 2026-04-12

---

## 1. Public Product Name and Identity

| Attribute | Value |
| --- | --- |
| **Public product name** | Agent Assistant SDK |
| **Short name (prose)** | Agent Assistant SDK, or "the SDK" in context |
| **Monorepo root name** | `agent-assistant-sdk` |
| **Root `package.json` name** | `agent-assistant-sdk-monorepo` |
| **GitHub repo name** | `AgentWorkforce/agent-assistant-sdk` |
| **npm scope** | `@agent-assistant` |
| **Package pattern** | `@agent-assistant/<package>` (e.g., `@agent-assistant/core`) |
| **README title** | `# Agent Assistant SDK` |

The name "Relay Agent Assistant" / "RelayAssistant" is retired from all public-facing surfaces. The SDK is positioned as a standalone open-source project under the AgentWorkforce organization, usable without prior knowledge of the Relay ecosystem.

---

## 2. Package Scope: `@relay-assistant/*` to `@agent-assistant/*`

**Decision: Full scope change to `@agent-assistant/*`.**

This is the intended target. All published and publishable packages change scope:

| Old Name | New Name | Status |
| --- | --- | --- |
| `@relay-assistant/core` | `@agent-assistant/core` | Rename |
| `@relay-assistant/sessions` | `@agent-assistant/sessions` | Rename |
| `@relay-assistant/surfaces` | `@agent-assistant/surfaces` | Rename |
| `@relay-assistant/traits` | `@agent-assistant/traits` | Rename |
| `@relay-assistant/routing` | `@agent-assistant/routing` | Rename |
| `@relay-assistant/connectivity` | `@agent-assistant/connectivity` | Rename |
| `@relay-assistant/coordination` | `@agent-assistant/coordination` | Rename |
| `@relay-assistant/memory` | `@agent-assistant/memory` | Rename |
| `@relay-assistant/proactive` | `@agent-assistant/proactive` | Rename |
| `@relay-assistant/policy` | `@agent-assistant/policy` | Rename |
| `@relay-assistant/examples` | `@agent-assistant/examples` | Rename (private) |
| `@relay-assistant/integration-tests` | `@agent-assistant/integration-tests` | Rename (private) |

### Scope change checklist

For every package:
- [ ] `package.json` `name` field
- [ ] `package.json` `description` field (remove "Relay" prefix where present)
- [ ] `package.json` `repository.url` (update to new repo name)
- [ ] `package.json` dependency/peerDependency references to sibling packages
- [ ] `package.json` `devDependencies` `file:` references (these stay as `file:../` paths but the `name` field changes)
- [ ] All `import ... from '@relay-assistant/...'` statements in source code
- [ ] All `import type ... from '@relay-assistant/...'` statements in source code
- [ ] All `import ... from '@relay-assistant/...'` in test files
- [ ] README.md within each package

---

## 3. Reference Classification: Rename vs Intentionally Historical

### 3.1 MUST be renamed (public-facing, code-facing)

These references are actively consumed by developers and must use the new name:

| Category | Pattern | Action |
| --- | --- | --- |
| Package names in `package.json` | `@relay-assistant/*` | Rename to `@agent-assistant/*` |
| Import statements in `src/` | `from '@relay-assistant/...'` | Rename to `from '@agent-assistant/...'` |
| Import statements in tests | `from '@relay-assistant/...'` | Rename to `from '@agent-assistant/...'` |
| README.md (root) | All `relay-assistant`, `RelayAssistant`, `Relay Agent Assistant` | Rename to `agent-assistant`, `Agent Assistant SDK` |
| README.md (per-package) | Same patterns | Same action |
| `docs/index.md` | All references | Rename |
| `docs/current-state.md` | All package name references | Rename |
| `docs/consumer/*.md` | All package names and product references | Rename |
| `docs/specs/*.md` | All package names | Rename |
| `.github/workflows/publish.yml` | Package names, job descriptions | Rename |
| `docs/reference/glossary.md` | Product name references | Rename |
| Root `package.json` | `name` field | `agent-assistant-sdk-monorepo` |
| Workflow channel names | `wf-relay-assistant-*` | `wf-agent-assistant-*` |
| Workflow `.ts` files | String literals containing `relay-assistant` or `RelayAssistant` | Rename |

### 3.2 Intentionally historical — DO NOT rename

These are historical records. They document decisions made when the project was named RelayAssistant. Renaming them would falsify the historical record.

| Category | Example | Reason |
| --- | --- | --- |
| Git commit messages | `"chore: bump version..."` | Immutable history |
| Architecture verdict filenames | `v1-*-review-verdict.md` | These are historical artifacts; their content may reference old names but they are not consumer-facing |
| Architecture plan filenames | `v1-*-implementation-plan.md` | Same — historical records |
| Architecture plan/verdict **content** | References to `@relay-assistant/*` inside plan/verdict docs | These describe decisions made under the old name; add a one-line header note rather than rewriting history |

**Header note for historical docs:** Add the following to the top of each architecture plan/verdict/proof document that contains old names:

```markdown
> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.
```

### 3.3 Relay foundation references — keep but clarify

The SDK builds on top of Relay foundation infrastructure (relay, gateway, relaycron, relayauth, relayfile). These are separate projects and their names do not change. References to Relay foundation in the layer model and architecture docs are correct and should remain, but must be clearly distinguished from the SDK's own name.

| Reference | Action |
| --- | --- |
| `relay` (the foundation project) | Keep — this is a different project |
| `@agent-relay/*` packages | Keep — these are upstream dependencies, not this SDK |
| `Relay foundation` / `Relay transport` | Keep — describes the infrastructure layer |
| `relayauth`, `relaycron`, `relayfile`, `relaycast` | Keep — sibling projects |
| `AgentWorkforce/cloud` | Keep — separate repo |

---

## 4. README / Public Landing Page Requirements

The README must be rewritten for an open-source audience with no Relay ecosystem context. Requirements:

### 4.1 Structure

1. **Title:** `# Agent Assistant SDK`
2. **One-line description:** What the SDK is and who it's for, without mentioning Relay
3. **What This SDK Does:** Bullet list of capabilities (identity, memory, sessions, proactive behavior, multi-agent coordination, policy)
4. **Quick Start:** Minimal code example showing `npm install` and `createAssistant()`
5. **Package Map:** Table of packages with purpose and status
6. **Current Status:** Test results, stable baseline, known blockers
7. **Architecture:** Layer model (foundation stays elsewhere, SDK lives here, product logic stays in product repos) — reframed without assuming Relay knowledge
8. **Consumer Docs:** Links to how-to-build, adoption guides
9. **Contributing / License:** Standard OSS sections

### 4.2 Tone and framing

- Lead with what the SDK enables, not what it replaces
- Do not mention "Relay" in the title, tagline, or first two sections
- The layer model section may reference Relay foundation as the infrastructure substrate, but explain it as "the underlying messaging and runtime infrastructure" rather than assuming the reader knows what Relay is
- Remove internal-facing language ("this weekend", "Sunday night", merge freezes, specific team names like "Sage team")
- Package status table should be clear about what's stable vs in-progress

### 4.3 Removed from public README

- Weekend delivery plan references
- Internal team coordination details
- Detailed architecture verdict links (move to a "For Contributors" section or keep in docs/)
- Implementation archive section (stays in docs/index.md, not in README)

---

## 5. Publish Infrastructure Updates

| File | Change |
| --- | --- |
| `.github/workflows/publish.yml` | Update all `@relay-assistant/` references to `@agent-assistant/` |
| `docs/architecture/publish-infrastructure-contract.md` | Update package names |
| `docs/architecture/publish-infrastructure-implementation-plan.md` | Update package names |
| `docs/architecture/publish-infrastructure-implementation-boundary.md` | Update package names, repo URL |
| `docs/architecture/publish-package-readiness-matrix.md` | Update package names |

The `publishConfig.access: "public"` and `repository.url` fields must be updated in all publishable package manifests to reference the new repo name.

Repository URL pattern:
```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/AgentWorkforce/agent-assistant-sdk"
  }
}
```

---

## 6. Manual / External Follow-Up (Cannot Be Done in This Repo)

These actions require access to external systems and must be performed by a human or separate automation after the in-repo rename is complete:

| Action | Owner | Blocker |
| --- | --- | --- |
| **Rename GitHub repo** from `AgentWorkforce/relay-agent-assistant` to `AgentWorkforce/agent-assistant-sdk` | GitHub org admin | Must be done before first publish under new name |
| **Register npm scope** `@agent-assistant` on npmjs.com | npm org admin | Must be done before first publish |
| **Update GitHub repo description** | GitHub org admin | Cosmetic but important for discoverability |
| **Update any CI secrets** that reference the old repo name | DevOps | If secrets are repo-scoped |
| **Update external links** in other AgentWorkforce repos (relay, sage, msd, nightcto, cloud) that point to `relay-agent-assistant` | Each repo owner | GitHub redirects handle this temporarily, but explicit updates are cleaner |
| **Publish packages under new scope** | Release engineer | First publish of `@agent-assistant/*` packages |
| **Deprecate old scope** if `@relay-assistant/*` was ever published | Release engineer | Prevent confusion |
| **Update Workforce workload-router** references if any point to old package names | Workforce repo | Check `@agentworkforce/workload-router` for hardcoded references |

---

## 7. Rename Scope Summary

### In scope (this rename pass)

- All `package.json` `name`, `description`, `repository`, dependency fields
- All source code imports (`src/`, test files)
- All package READMEs
- Root README.md (full rewrite for OSS)
- `docs/index.md`, `docs/current-state.md`
- All `docs/consumer/*.md` files
- All `docs/specs/*.md` files
- All `docs/reference/*.md` files
- `.github/workflows/publish.yml`
- `docs/architecture/` files that are actively referenced by consumers (package-boundary-map, traits-and-persona-layer, connectivity-package-spec, extraction-roadmap, oss-vs-cloud-split, assistant-cloud-interface)
- `workflows/*.ts` string literals
- `docs/workflows/*.md` consumer-facing content

### Out of scope (historical, handled via header note)

- Architecture plans (`v1-*-implementation-plan.md`)
- Architecture verdicts (`v1-*-review-verdict.md`)
- Architecture proofs (`v1-*-proof.md`)
- Robustness audit reports and remediation backlogs
- Research documents (`docs/research/*.md`) — add header note, do not rewrite

### Out of scope (external)

- GitHub repo rename
- npm scope registration
- Cross-repo link updates
- CI/CD secret updates

---

## 8. String Replacement Reference

For automated rename passes, these are the canonical replacements:

| Old Pattern | New Pattern | Context |
| --- | --- | --- |
| `@relay-assistant/` | `@agent-assistant/` | Package names in code, configs, docs |
| `relay-assistant` (in package/repo names) | `agent-assistant` | Kebab-case identifiers |
| `RelayAssistant` (PascalCase) | `Agent Assistant SDK` | Prose references |
| `Relay Agent Assistant` | `Agent Assistant SDK` | Full product name in prose |
| `relay-agent-assistant` (repo name) | `agent-assistant-sdk` | Repository references |
| `relay-agent-assistant-monorepo` | `agent-assistant-sdk-monorepo` | Root package name |
| `wf-relay-assistant-` | `wf-agent-assistant-` | Workflow channel names |

**Do not blindly replace `relay` or `Relay` — these often refer to the Relay foundation infrastructure, which is a separate project.**

---

## 9. Validation Criteria

The rename is complete when:

1. `rg "@relay-assistant/" packages/*/src/ packages/*/package.json` returns zero results
2. `rg "@relay-assistant/" .github/` returns zero results
3. `rg "RelayAssistant" README.md docs/index.md docs/current-state.md docs/consumer/ docs/specs/` returns zero results (excluding intentionally historical docs)
4. `rg "Relay Agent Assistant" README.md` returns zero results
5. All `package.json` files use `@agent-assistant/*` scope
6. Root `package.json` name is `agent-assistant-sdk-monorepo`
7. All source imports resolve to `@agent-assistant/*`
8. Tests pass after rename (`npx vitest run` in packages with passing tests)
9. TypeScript builds succeed for publishable packages
10. Historical architecture docs have the header note added

---

AGENT_ASSISTANT_RENAME_BOUNDARY_READY
