# Publish Infrastructure Implementation Plan — RelayAssistant

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

> Concrete, sequenced implementation plan for the RelayAssistant npm publish pipeline.
> Drives the next workflow directly — every task is actionable with no further design needed.
> Date: 2026-04-12

---

## Overview

This plan implements the publish infrastructure contract in four ordered phases. Phases 1 and 2 cover the v0.1.0 initial publish of the four ready packages (`traits`, `core`, `sessions`, `surfaces`). Phases 3 and 4 cover unblocking remaining packages and establishing Workforce profile direct consumption.

**Target outcome:** Four packages published to npm with OIDC provenance attestation, following the relayfile three-job publish pattern, gated by a CI workflow.

---

## Phase 1: Pre-Publish Preparation

All Phase 1 tasks MUST be complete before the first publish run. These are mechanical, low-risk changes.

### Task P1-1: Add `repository.url` to all publishable package.json files

**Priority:** CRITICAL
**Files to edit:** `packages/traits/package.json`, `packages/core/package.json`, `packages/sessions/package.json`, `packages/surfaces/package.json`
**Change:** Add the following block to each file (replace `<org>` with actual GitHub org):

```json
"repository": {
  "type": "git",
  "url": "https://github.com/<org>/relay-agent-assistant"
}
```

**Why required:** npm provenance attestation links the package to its source repository. If `repository.url` is absent or mismatched, provenance verification fails on npmjs.com.
**Verification:** `node -p "require('./package.json').repository.url"` in each package dir — must return the correct GitHub URL.

---

### Task P1-2: Add `publishConfig` to all publishable package.json files

**Priority:** CRITICAL
**Files to edit:** Same four files as P1-1
**Change:**

```json
"publishConfig": {
  "access": "public"
}
```

**Why required:** All `@relay-assistant/*` packages are scoped. npm defaults scoped packages to `restricted` access. Without `publishConfig.access: "public"`, the publish command will fail unless `--access public` is passed explicitly on every invocation. The workflow already passes `--access public`, but `publishConfig` is the canonical declaration.
**Verification:** `node -p "require('./package.json').publishConfig"` — must return `{ access: 'public' }`.

---

### Task P1-3: Verify or create root `package.json` with npm workspaces

**Priority:** CRITICAL
**Current state:** No root `package.json` exists (confirmed by inspection).
**Required action:** Create `package.json` at repo root:

```json
{
  "name": "relay-agent-assistant-monorepo",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/traits",
    "packages/core",
    "packages/sessions",
    "packages/surfaces",
    "packages/routing",
    "packages/connectivity",
    "packages/coordination",
    "packages/memory",
    "packages/proactive",
    "packages/policy",
    "packages/examples",
    "packages/integration"
  ]
}
```

**Why required:** `npm ci` at the repo root requires a root `package.json` with `workspaces` to install all workspace dependencies in a single pass. Without this, the build job cannot run `npm ci` and must manage each package independently.
**Verification:** `npm query .workspace` from repo root — must list all workspace packages.

---

### Task P1-4: Create `.github/workflows/publish.yml`

**Priority:** CRITICAL
**Path:** `.github/workflows/publish.yml`
**Pattern:** Follows relayfile three-job structure exactly, adapted for RelayAssistant monorepo.

The complete workflow file content:

```yaml
name: Publish Packages

on:
  workflow_dispatch:
    inputs:
      package:
        description: "Package to publish"
        required: true
        type: choice
        options:
          - all
          - traits
          - core
          - sessions
          - surfaces
        default: "all"
      version:
        description: "Version bump type"
        required: true
        type: choice
        options:
          - patch
          - minor
          - major
          - prepatch
          - preminor
          - premajor
          - prerelease
        default: "patch"
      custom_version:
        description: "Custom version (optional, overrides version type)"
        required: false
        type: string
      preid:
        description: "Prerelease identifier (used with pre* version types)"
        required: false
        type: choice
        options:
          - beta
          - alpha
          - rc
        default: "beta"
      dry_run:
        description: "Dry run (do not actually publish)"
        required: false
        type: boolean
        default: false
      tag:
        description: "NPM dist-tag"
        required: false
        type: choice
        options:
          - latest
          - next
          - beta
          - alpha
        default: "latest"

concurrency:
  group: publish-package
  cancel-in-progress: false

# Required for npm OIDC provenance attestation.
# Source: Workforce npm-provenance-publisher profile
# (workforce/personas/npm-provenance-publisher.json — consumed via filesystem
#  in workflow orchestration; direct package consumption blocked by BLOCKER-WF-001)
permissions:
  contents: write
  id-token: write

env:
  NPM_CONFIG_FUND: false

jobs:
  build:
    name: Build & Version
    runs-on: ubuntu-latest
    outputs:
      new_version: ${{ steps.bump.outputs.new_version }}
      is_prerelease: ${{ steps.bump.outputs.is_prerelease }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          registry-url: "https://registry.npmjs.org"

      - name: Install dependencies
        run: npm ci

      - name: Run tests — traits
        run: npm run test --workspace=packages/traits

      - name: Run tests — core
        run: npm run test --workspace=packages/core

      - name: Run tests — sessions
        run: npm run test --workspace=packages/sessions

      - name: Run tests — surfaces
        run: npm run test --workspace=packages/surfaces

      - name: Typecheck — all publishable packages
        run: |
          npm run build --workspace=packages/traits
          npm run build --workspace=packages/core
          npm run build --workspace=packages/sessions
          npm run build --workspace=packages/surfaces

      - name: Version all packages
        id: bump
        run: |
          CUSTOM_VERSION="${{ github.event.inputs.custom_version }}"
          VERSION_TYPE="${{ github.event.inputs.version }}"
          PREID="${{ github.event.inputs.preid }}"

          # Source of truth: packages/traits/package.json (no upstream internal deps)
          cd packages/traits
          if [ -n "$CUSTOM_VERSION" ]; then
            npm version "$CUSTOM_VERSION" --no-git-tag-version --allow-same-version
          else
            npm version "$VERSION_TYPE" --no-git-tag-version --preid="$PREID"
          fi
          NEW_VERSION=$(node -p "require('./package.json').version")
          cd ../..

          echo "new_version=$NEW_VERSION" >> "$GITHUB_OUTPUT"
          echo "New version: $NEW_VERSION"

          if [[ "$NEW_VERSION" == *"-"* ]]; then
            echo "is_prerelease=true" >> "$GITHUB_OUTPUT"
          else
            echo "is_prerelease=false" >> "$GITHUB_OUTPUT"
          fi

          # Sync version across all publishable packages and internal @relay-assistant/* deps
          node -e "
            const fs = require('fs');
            const version = '$NEW_VERSION';
            const pkgPaths = [
              'packages/traits/package.json',
              'packages/core/package.json',
              'packages/sessions/package.json',
              'packages/surfaces/package.json',
            ];
            for (const pkgPath of pkgPaths) {
              if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                pkg.version = version;
                for (const depType of ['dependencies', 'devDependencies', 'peerDependencies']) {
                  for (const dep of Object.keys(pkg[depType] || {})) {
                    if (dep.startsWith('@relay-assistant/')) {
                      // Only update if it is a version reference, not a file: path
                      if (!pkg[depType][dep].startsWith('file:')) {
                        pkg[depType][dep] = '>=' + version;
                      }
                    }
                  }
                }
                fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
                console.log(pkg.name + ' -> v' + version);
              }
            }
          "

      - name: Build packages (DAG order: traits → core → sessions + surfaces)
        run: |
          npm run build --workspace=packages/traits
          npm run build --workspace=packages/core
          npm run build --workspace=packages/sessions
          npm run build --workspace=packages/surfaces

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-output
          retention-days: 1
          path: |
            packages/traits/package.json
            packages/traits/dist/
            packages/core/package.json
            packages/core/dist/
            packages/sessions/package.json
            packages/sessions/dist/
            packages/surfaces/package.json
            packages/surfaces/dist/

  # Publish all four packages in parallel (respecting npm dep resolution order)
  publish-packages:
    name: Publish ${{ matrix.package }}
    needs: build
    runs-on: ubuntu-latest
    if: github.event.inputs.package == 'all'
    strategy:
      fail-fast: false
      max-parallel: 10
      matrix:
        include:
          - package: traits
            path: packages/traits
          - package: core
            path: packages/core
          - package: sessions
            path: packages/sessions
          - package: surfaces
            path: packages/surfaces

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-output
          path: .

      # Required for OIDC auth — stale npm runners fail provenance without this.
      # Requirement sourced from Workforce npm-provenance-publisher profile.
      - name: Update npm for OIDC support
        run: npm install -g npm@latest

      - name: Dry run publish
        if: github.event.inputs.dry_run == 'true'
        working-directory: ${{ matrix.path }}
        run: |
          PACKAGE_NAME=$(node -p "require('./package.json').name")
          echo "Dry run — would publish ${PACKAGE_NAME}@$(node -p \"require('./package.json').version\")"
          npm publish --dry-run --access public --tag ${{ github.event.inputs.tag }} --ignore-scripts

      - name: Publish to npm
        if: github.event.inputs.dry_run != 'true'
        working-directory: ${{ matrix.path }}
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npm publish --access public --provenance --tag ${{ github.event.inputs.tag }} --ignore-scripts

  # Single package publish path
  publish-single:
    name: Publish single — ${{ github.event.inputs.package }}
    needs: build
    runs-on: ubuntu-latest
    if: github.event.inputs.package != 'all'

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-output
          path: .

      - name: Update npm for OIDC support
        run: npm install -g npm@latest

      - name: Resolve package path
        id: resolve
        run: |
          case "${{ github.event.inputs.package }}" in
            traits)   echo "path=packages/traits"   >> "$GITHUB_OUTPUT" ;;
            core)     echo "path=packages/core"     >> "$GITHUB_OUTPUT" ;;
            sessions) echo "path=packages/sessions" >> "$GITHUB_OUTPUT" ;;
            surfaces) echo "path=packages/surfaces" >> "$GITHUB_OUTPUT" ;;
            *)
              echo "ERROR: Package '${{ github.event.inputs.package }}' is not in the publishable set." >&2
              echo "Valid options: traits, core, sessions, surfaces" >&2
              exit 1
              ;;
          esac

      - name: Dry run publish
        if: github.event.inputs.dry_run == 'true'
        working-directory: ${{ steps.resolve.outputs.path }}
        run: |
          PACKAGE_NAME=$(node -p "require('./package.json').name")
          echo "Dry run — would publish ${PACKAGE_NAME}@$(node -p \"require('./package.json').version\")"
          npm publish --dry-run --access public --tag ${{ github.event.inputs.tag }} --ignore-scripts

      - name: Publish to npm
        if: github.event.inputs.dry_run != 'true'
        working-directory: ${{ steps.resolve.outputs.path }}
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npm publish --access public --provenance --tag ${{ github.event.inputs.tag }} --ignore-scripts

  create-release:
    name: Create Release
    needs: [build, publish-packages, publish-single]
    runs-on: ubuntu-latest
    if: |
      always() &&
      github.event.inputs.dry_run != 'true' &&
      (needs.publish-packages.result == 'success' || needs.publish-single.result == 'success')

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          name: build-output
          path: .

      - name: Commit version bump and create tag
        env:
          NEW_VERSION: ${{ needs.build.outputs.new_version }}
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"

          git add \
            packages/traits/package.json \
            packages/core/package.json \
            packages/sessions/package.json \
            packages/surfaces/package.json

          if ! git diff --staged --quiet; then
            git commit -m "chore(release): v${NEW_VERSION}"
            git push
          fi

          git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
          git push origin "v${NEW_VERSION}"

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v${{ needs.build.outputs.new_version }}
          name: v${{ needs.build.outputs.new_version }}
          body: |
            ## RelayAssistant v${{ needs.build.outputs.new_version }}

            ### Published Packages
            - `@relay-assistant/traits@${{ needs.build.outputs.new_version }}`
            - `@relay-assistant/core@${{ needs.build.outputs.new_version }}`
            - `@relay-assistant/sessions@${{ needs.build.outputs.new_version }}`
            - `@relay-assistant/surfaces@${{ needs.build.outputs.new_version }}`

            ### Install
            ```bash
            npm install @relay-assistant/core@${{ needs.build.outputs.new_version }}
            ```

            ### Publish Details
            - Dist-tag: `${{ github.event.inputs.tag }}`
            - Provenance: enabled via `npm publish --provenance`
            - Registry: `https://registry.npmjs.org`

            ### Workforce Profile Reference
            Provenance requirements implemented per Workforce npm-provenance-publisher profile.
            Direct consumption blocked pending BLOCKER-WF-001 resolution.
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Verification:** Validate YAML syntax with `yamllint` or GitHub Actions linter before merging.

---

### Task P1-5: Create `.github/workflows/ci.yml`

**Priority:** HIGH
**Path:** `.github/workflows/ci.yml`
**Purpose:** Ensure tests run on every PR/push before the publish workflow is ever used.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: Test & Build
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: [traits, core, sessions, surfaces]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - run: npm ci

      - name: Build ${{ matrix.package }}
        run: npm run build --workspace=packages/${{ matrix.package }}

      - name: Test ${{ matrix.package }}
        run: npm run test --workspace=packages/${{ matrix.package }}
```

---

### Task P1-6: Register npm trusted publishers (manual — npmjs.com)

**Priority:** CRITICAL
**This task cannot be automated — must be done manually on npmjs.com before any publish.**

For each of the four packages, a human with npm organization admin rights must:

1. Log into npmjs.com
2. Navigate to the package page (packages will need to be created first via initial publish, or pre-registered via npm org)
3. Go to **Settings → Trusted Publishers**
4. Add GitHub Actions OIDC trusted publisher with:
   - **GitHub owner:** `<org>`
   - **GitHub repository:** `relay-agent-assistant`
   - **Workflow filename:** `publish.yml`
   - **Environment:** (leave blank unless using GitHub environments)

Packages requiring registration:
- `@relay-assistant/traits`
- `@relay-assistant/core`
- `@relay-assistant/sessions`
- `@relay-assistant/surfaces`

**Note:** On first publish of a new package, the package must be created. Use `npm publish --access public` with an NPM_TOKEN for the very first publish only, then switch to OIDC trusted publishing for all subsequent publishes. Document this exception in a comment in `publish.yml`.

---

## Phase 2: First Publish (v0.1.0)

### Task P2-1: Dry-run publish — all packages

**Command:** Trigger `.github/workflows/publish.yml` via `workflow_dispatch` with:
- `package: all`
- `version: patch`
- `dry_run: true`
- `tag: latest`

**Expected output:**
- Build job succeeds (all tests pass, all builds succeed)
- Version sync runs correctly (all four package.json files bumped to same version)
- Dry-run publish output shows correct package names and versions
- No errors in artifact upload/download

**Pass criteria:** All jobs green, dry-run output shows 4 packages with correct npm names.

---

### Task P2-2: Actual publish — v0.1.0

**Command:** Trigger `.github/workflows/publish.yml` with:
- `package: all`
- `version: patch` (or `custom_version: 0.1.0`)
- `dry_run: false`
- `tag: latest`

**Publish order enforcement:** The workflow matrix publishes in parallel, but npm dependency resolution handles ordering — `traits` must be available on the registry before `core` consumers can install it. The matrix strategy with `fail-fast: false` is correct: if `traits` publish fails, `core` publish will fail at install time in any downstream consumer, not in the workflow itself. The `max-parallel: 10` setting allows parallel publish; this is fine because the packages are independent at publish time (they reference each other via peer/dev deps, not hard runtime deps at publish).

**Verification after publish:**
- `npm info @relay-assistant/traits` returns version 0.1.0
- `npm info @relay-assistant/core` returns version 0.1.0
- Repeat for sessions and surfaces

---

### Task P2-3: Verify provenance attestation

For each published package:
1. Visit `https://www.npmjs.com/package/@relay-assistant/<name>`
2. Check for the provenance badge (shield icon showing "GitHub Actions" source)
3. Click the badge to verify the OIDC attestation links to the correct GitHub repo and workflow run

**Pass criteria:** All four packages show verified provenance attestation linking to `relay-agent-assistant` repo, `publish.yml` workflow.

---

### Task P2-4: Consumer smoke test

From a clean directory (not the monorepo):

```bash
mkdir /tmp/relay-test && cd /tmp/relay-test
npm init -y
npm install @relay-assistant/core@0.1.0
node -e "const c = require('@relay-assistant/core'); console.log('OK', typeof c)"
```

**Pass criteria:** Package installs without errors; basic import works.

---

## Phase 3: Unblock Remaining Packages

These tasks are sequenced — later tasks depend on earlier ones.

### Task P3-1: Unblock `connectivity` — install nanoid

```bash
cd packages/connectivity
npm install nanoid@^5.1.6
```

Verify: `npm run test --workspace=packages/connectivity` passes.

---

### Task P3-2: Unblock `routing` — close DoD test gap

Current state: ~12 tests, minimum 40+.

Acceptance criteria:
- `npm run test --workspace=packages/routing` shows 40+ passing tests
- `npm run build --workspace=packages/routing` exits 0

Once unblocked, add `routing` to the publish workflow `options` list in `publish.yml`.

---

### Task P3-3: Unblock `coordination` after connectivity

Once connectivity is unblocked:
1. Change `packages/coordination/package.json` dependencies:
   ```json
   "@relay-assistant/connectivity": ">=0.1.0"
   ```
   (Remove `file:../connectivity`)
2. Run `npm run test --workspace=packages/coordination`
3. Verify all tests pass

Once unblocked, add `connectivity` and `coordination` to the publish workflow.

---

### Task P3-4: Extend `publish.yml` options as packages unblock

When each package is unblocked, add it to the `options:` list in the `workflow_dispatch.inputs.package` section and add a corresponding entry to the publish matrix.

---

## Phase 4: Workforce Profile Direct Consumption

### Current state: BLOCKED (BLOCKER-WF-001)

The Workforce `npm-provenance-publisher` profile has no consumable export surface. See `workforce-profile-consumption-plan.md` for the full blocker specification and resolution path.

### Task P4-1: Track BLOCKER-WF-001 to resolution

Once the Workforce team resolves BLOCKER-WF-001 by publishing a personas package or prpm entry:

1. Update `publish.yml` to fetch the profile at workflow start
2. Validate required fields against the published profile schema
3. Remove hardcoded provenance requirements in favor of profile-driven configuration
4. Add a comment in `publish.yml` citing the profile import source

---

## Implementation Checklist (ordered)

```
Phase 1 — Pre-publish preparation
[ ] P1-1: Add repository.url to traits, core, sessions, surfaces package.json
[ ] P1-2: Add publishConfig.access: public to same four packages
[ ] P1-3: Create root package.json with npm workspaces
[ ] P1-4: Create .github/workflows/publish.yml
[ ] P1-5: Create .github/workflows/ci.yml
[ ] P1-6: Register npm trusted publishers on npmjs.com (manual)

Phase 2 — First publish
[ ] P2-1: Dry-run publish (workflow_dispatch: dry_run=true)
[ ] P2-2: Actual publish v0.1.0 (workflow_dispatch: dry_run=false)
[ ] P2-3: Verify provenance attestation on npmjs.com for all 4 packages
[ ] P2-4: Consumer smoke test from clean directory

Phase 3 — Unblock remaining packages
[ ] P3-1: Install nanoid in connectivity workspace; verify tests pass
[ ] P3-2: Close routing DoD gap (12 → 40+ tests)
[ ] P3-3: Fix coordination file: dep; verify tests pass once connectivity unblocked
[ ] P3-4: Extend publish.yml options as packages unblock

Phase 4 — Workforce profile direct consumption
[ ] P4-1: Await BLOCKER-WF-001 resolution; then update publish.yml
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| No turbo | RelayAssistant uses plain npm workspaces + tsc. Build order is enforced explicitly in workflow steps. |
| traits as version source-of-truth | traits has no internal deps; it is the most stable base. All other packages are versioned from traits. |
| matrix publish with fail-fast: false | Parallel publish is safe; packages are independent on the registry. fail-fast:false allows partial publish diagnosis without aborting. |
| Tests run in build job, not publish job | Gates all publishes on test pass. A single failing test fails the entire workflow before any publish occurs. |
| NPM_TOKEN retained | OIDC trusted publishing is the goal, but first publish of new packages requires NPM_TOKEN. TOKEN is scoped only to NODE_AUTH_TOKEN env var. |
| Provenance on all non-dry-run publishes | --provenance is mandatory per Workforce profile requirements. Dry runs never use --provenance. |

---

PUBLISH_INFRA_IMPLEMENTATION_PLAN_READY
