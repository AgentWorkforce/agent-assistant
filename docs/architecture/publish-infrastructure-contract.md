# Publish Infrastructure Contract — RelayAssistant

> Canonical specification for the RelayAssistant npm publish pipeline.
> Derived from relayfile and relayauth publish workflow patterns, the current package state, and the Workforce npm-provenance-publisher profile.

---

## 1. Package Publish Readiness

### Publishable Now (v1 Baseline)

These packages have passing tests, reconciled specs, and no unresolved blockers:

| Package | npm Name | Path | Tests | Status |
|---------|----------|------|-------|--------|
| core | `@relay-assistant/core` | `packages/core` | 31 pass | PUBLISH_READY |
| sessions | `@relay-assistant/sessions` | `packages/sessions` | 25 pass | PUBLISH_READY |
| surfaces | `@relay-assistant/surfaces` | `packages/surfaces` | 28 pass | PUBLISH_READY |
| traits | `@relay-assistant/traits` | `packages/traits` | 32 pass | PUBLISH_READY |

### Not Publishable — Blocked

| Package | npm Name | Path | Blocker | Earliest Milestone |
|---------|----------|------|---------|--------------------|
| routing | `@relay-assistant/routing` | `packages/routing` | DoD gap: 12/40+ tests | v1 (after test gap closed) |
| connectivity | `@relay-assistant/connectivity` | `packages/connectivity` | `nanoid` missing; tests blocked | v1 (after dep fix) |
| coordination | `@relay-assistant/coordination` | `packages/coordination` | Blocked by connectivity | v1 (after connectivity unblocked) |
| memory | `@relay-assistant/memory` | `packages/memory` | `@agent-relay/memory` dep missing | v1.1 |
| policy | `@relay-assistant/policy` | `packages/policy` | Placeholder; no spec | v2 |
| proactive | `@relay-assistant/proactive` | `packages/proactive` | Placeholder; no spec | v1.2 |

### Never Published

| Package | Reason |
|---------|--------|
| `@relay-assistant/examples` | `private: true` — reference only |
| `@relay-assistant/integration-tests` | `private: true` — test harness only |

**Rule:** A package MUST NOT be published until all of the following are true:
1. All declared tests pass (`vitest run` exits 0 in that workspace)
2. Build succeeds (`tsc -p tsconfig.json` exits 0)
3. No unresolved dependency blockers (no `file:` references to missing packages)
4. Package is not marked `private: true`

---

## 2. Workflow Design — Mirroring Relay-Family Patterns

The RelayAssistant publish workflow SHALL follow the structural pattern established by the relayfile and relayauth publish workflows, adapted for the RelayAssistant monorepo.

### Shared Pattern Elements (from relayfile + relayauth)

| Element | Pattern | RelayAssistant Adoption |
|---------|---------|------------------------|
| Trigger | `workflow_dispatch` with package/version/tag/dry_run inputs | Same |
| Package selector | Choice input: `all` or individual package name | Same — options: `all`, `core`, `sessions`, `surfaces`, `traits` (expandable as packages become ready) |
| Version bump | `npm version` with `--no-git-tag-version`; custom version override | Same |
| Prerelease | `preid` input (`beta`, `alpha`, `rc`) | Same |
| Dist tags | `latest`, `next`, `beta`, `alpha` | Same |
| Concurrency | `group: publish-package`, `cancel-in-progress: false` | Same |
| Permissions | `contents: write`, `id-token: write` | Same — required for provenance |
| Build job | Checkout → setup-node@v4 (node 22) → `npm ci` → build → upload artifacts | Same |
| Version sync | Root version bumped, then synced across all `@relay-assistant/*` internal deps | Same pattern as relayfile inline script |
| Publish job | Download artifacts → `npm install -g npm@latest` → `npm publish --access public --provenance --tag <tag> --ignore-scripts` | Same |
| Dry run | `npm publish --dry-run --access public --tag <tag> --ignore-scripts` | Same |
| Release job | Commit version bump → create git tag → `softprops/action-gh-release@v2` | Same |
| Auth | `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` | Same (see provenance section for OIDC discussion) |

### Key Differences from Relayfile/Relayauth

1. **No turbo:** RelayAssistant uses plain `npm` workspaces with `tsc` builds, not turborepo. Build step runs `npm run build` per workspace in dependency order.
2. **Build order matters:** `core` depends on `traits` (peer dep). Connectivity depends on `routing`. Coordination depends on `connectivity` + `routing`. Build must respect this DAG.
3. **Matrix publish:** Follow relayfile pattern — parallel matrix publish when `package == 'all'`, single-package path otherwise.
4. **Package set is gated:** The `options` list in `workflow_dispatch` MUST only include packages that meet the publish-ready criteria above. Blocked packages are omitted until unblocked.

### Canonical Workflow File

Path: `.github/workflows/publish.yml`

The workflow MUST be implemented as a single file following the relayfile three-job structure:
1. **build** — checkout, setup node, install, version bump + sync, build all, upload artifacts
2. **publish-packages** (matrix, parallel) — download artifacts, `npm publish --provenance`
3. **publish-single** — same as above, single package path
4. **create-release** — commit version bump, tag, GitHub release

---

## 3. Workforce npm-provenance-publisher Profile — Canonical Consumption Path

### Profile Location

The Workforce npm-provenance-publisher profile lives at:
```
workforce/personas/npm-provenance-publisher.json
```

### Required Consumption: Direct, Not Copied

The contract REQUIRES that the RelayAssistant publish infrastructure consumes the Workforce npm-provenance-publisher profile directly from the Workforce repository — not via a local copy-paste of persona data into this repo.

### Current Consumption Capability: BLOCKED

**The Workforce `personas/` directory is not exported as an npm package or any other consumable artifact.**

The Workforce repo currently exports:
- `@agentworkforce/workload-router` (published npm package) — contains routing profiles, NOT personas

The `personas/` directory is a flat collection of JSON files at the repository root level with no:
- Package wrapper (`package.json` exporting personas)
- npm publication
- API or registry endpoint
- CLI tool for fetching profiles
- `prpm` index entry for personas (despite `prpm.lock` existing in the repo)

### Blocker: Missing Workforce Export Surface

**BLOCKER-WF-001:** The Workforce npm-provenance-publisher profile (`workforce/personas/npm-provenance-publisher.json`) has no consumable export surface. There is no npm package, no API, and no `prpm` registry entry that allows downstream repos to programmatically consume this profile.

**Required resolution (one of):**
1. **Package export (preferred):** Publish a `@agentworkforce/personas` package (or add personas to `@agentworkforce/workload-router`) that exports persona JSON, allowing `import { npmProvenancePublisher } from '@agentworkforce/personas'`
2. **prpm registry:** Register personas in the prpm registry so they can be fetched via `prpm install @workforce/npm-provenance-publisher`
3. **HTTP endpoint:** Expose personas via a stable URL that CI can fetch at workflow time

**Until BLOCKER-WF-001 is resolved:**
- The publish workflow MUST NOT copy-paste the persona's system prompts or tier configuration locally
- The workflow definition file (`specify-publish-infrastructure.ts`) currently reads the profile via filesystem path (`../workforce/personas/npm-provenance-publisher.json`) — this is acceptable for workflow orchestration but NOT for the publish workflow itself
- The publish workflow SHALL be implemented following the provenance requirements extracted from the profile (documented below) but SHALL include a comment referencing the Workforce profile as the authoritative source

### Extracted Provenance Requirements (from npm-provenance-publisher profile)

These requirements are derived from the Workforce profile and MUST be enforced regardless of consumption mechanism:

1. **Permissions:** `id-token: write` and `contents: write` on the workflow
2. **Repository URL:** Every publishable `package.json` MUST declare `repository.url` matching the GitHub repo
3. **npm upgrade:** `npm install -g npm@latest` MUST run before `npm publish --provenance` to avoid stale-runner OIDC auth failures
4. **Provenance flag:** All non-dry-run publishes MUST use `--provenance`
5. **Trusted publisher:** Each package MUST be registered as a trusted publisher on npmjs.com for the GitHub Actions OIDC flow
6. **Monorepo iteration:** Each package published with correct `working-directory` (`cwd`)
7. **No leaked tokens:** `NPM_TOKEN` used only in `NODE_AUTH_TOKEN` env var, never echoed or logged
8. **prpm skill:** The `prpm/npm-trusted-publishing` skill referenced in the profile SHOULD be applied when available via prpm

---

## 4. Versioning, Tagging, and Provenance

### Version Strategy

- **Single version:** All `@relay-assistant/*` packages share a single version number (same as relayfile pattern)
- **Source of truth:** Root `package.json` version (once created) or `packages/core/package.json` version
- **Sync mechanism:** After bumping the source-of-truth version, an inline script updates all publishable `package.json` files and any `@relay-assistant/*` internal dependency references
- **Bump types:** `patch`, `minor`, `major`, `prepatch`, `preminor`, `premajor`, `prerelease`
- **Custom version:** Optional override input, takes precedence over bump type
- **Prerelease identifiers:** `beta` (default), `alpha`, `rc`

### Tagging

- **Git tags:** `v<version>` format (e.g., `v0.1.0`, `v0.2.0-beta.0`)
- **npm dist-tags:** `latest` (default), `next`, `beta`, `alpha`
- **Prerelease detection:** If version contains `-`, it is a prerelease; dist-tag SHOULD match the preid
- **Tag creation:** After successful publish, not before

### Provenance

- **Required:** All production publishes MUST include `--provenance`
- **OIDC:** GitHub Actions OIDC token used for npm provenance attestation
- **Verification:** After first publish, verify provenance badge appears on npmjs.com package page
- **Dry runs:** Do NOT include `--provenance` (use `--dry-run` only)

---

## 5. Minimum CI/Build/Test Gates

### Pre-Publish Gates (MUST pass before any publish)

| Gate | Command | Scope | Required |
|------|---------|-------|----------|
| Install | `npm ci` | Root | YES |
| Build | `npm run build` per workspace in DAG order | All publishable packages | YES |
| Test | `vitest run` per workspace | All publishable packages | YES |
| Typecheck | `tsc --noEmit` per workspace | All publishable packages | YES |
| Version sync | Verify all `@relay-assistant/*` deps reference same version | All publishable packages | YES |

### Gate Enforcement

- Gates run in the **build** job, before any publish job starts
- If ANY gate fails, the entire workflow fails — no partial publishes
- Dry-run mode runs all gates but skips the actual `npm publish`

### Per-Package Test Minimums

| Package | Minimum Passing Tests | Current |
|---------|-----------------------|---------|
| core | 30 | 31 |
| sessions | 20 | 25 |
| surfaces | 25 | 28 |
| traits | 30 | 32 |

If a package's test count drops below its minimum, the gate fails.

---

## 6. Required Implementation Work

### Phase 1: Pre-Publish Preparation (before first publish)

| Task | Priority | Description |
|------|----------|-------------|
| **P1-1** | CRITICAL | Add `repository.url` field to all publishable package.json files: `"repository": { "type": "git", "url": "https://github.com/<org>/relay-agent-assistant" }` |
| **P1-2** | CRITICAL | Create root `package.json` with `workspaces` field listing all packages, or verify npm workspace config exists |
| **P1-3** | CRITICAL | Create `.github/workflows/publish.yml` following the contract in Section 2 |
| **P1-4** | CRITICAL | Register each publishable package as a trusted publisher on npmjs.com for GitHub Actions OIDC |
| **P1-5** | HIGH | Replace `file:` dependency references in publishable packages with version ranges (e.g., `"@relay-assistant/traits": ">=0.1.0"`) — `file:` refs are dev-only |
| **P1-6** | HIGH | Add `publishConfig: { "access": "public" }` to each publishable package.json |
| **P1-7** | MEDIUM | Create a CI test workflow (`.github/workflows/ci.yml`) that runs build + test on PR/push — publish should not be the first time tests run in CI |

### Phase 2: First Publish (v0.1.0 initial release)

| Task | Priority | Description |
|------|----------|-------------|
| **P2-1** | CRITICAL | Dry-run publish of all 4 ready packages — verify artifact contents, version sync, provenance flag |
| **P2-2** | CRITICAL | Publish `@relay-assistant/traits` → `core` → `sessions` → `surfaces` (respecting dep order) |
| **P2-3** | HIGH | Verify provenance attestation appears on npmjs.com for each published package |
| **P2-4** | HIGH | Verify `npm install @relay-assistant/core` works from a clean project |

### Phase 3: Unblock Remaining Packages

| Task | Priority | Description |
|------|----------|-------------|
| **P3-1** | HIGH | Install `nanoid` in connectivity workspace; verify all 87 tests pass |
| **P3-2** | HIGH | Verify coordination tests pass once connectivity is unblocked |
| **P3-3** | HIGH | Close routing DoD gap (12 → 40+ tests) |
| **P3-4** | MEDIUM | Add routing, connectivity, coordination to publish workflow `options` once unblocked |

### Phase 4: Workforce Profile Direct Consumption (BLOCKER-WF-001)

| Task | Priority | Description |
|------|----------|-------------|
| **P4-1** | HIGH | Resolve BLOCKER-WF-001: create a consumable export surface for Workforce personas (package, prpm, or API) |
| **P4-2** | MEDIUM | Once export surface exists, update publish workflow to consume npm-provenance-publisher profile directly |
| **P4-3** | MEDIUM | Remove any hardcoded provenance requirements from publish workflow in favor of dynamic profile consumption |

---

## Summary

The RelayAssistant publish infrastructure follows the established relayfile/relayauth three-job workflow pattern with npm provenance attestations. Four packages (`core`, `sessions`, `surfaces`, `traits`) are ready for initial v0.1.0 publish. Six packages are blocked by test failures, missing dependencies, or placeholder status — they MUST NOT be published until their specific blockers are resolved.

Direct consumption of the Workforce npm-provenance-publisher profile is REQUIRED but currently BLOCKED (BLOCKER-WF-001: no export surface exists for `workforce/personas/`). The publish workflow will be implemented following the profile's extracted provenance requirements, with the Workforce profile referenced as authoritative source, pending resolution of the export surface blocker.

---

PUBLISH_INFRASTRUCTURE_CONTRACT_READY
