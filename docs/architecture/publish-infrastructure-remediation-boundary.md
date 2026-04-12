# Publish Infrastructure Remediation Boundary — RelayAssistant

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

> Exact scope of remediation work required before the publish workflow is safe for first use.
> Resolves all four findings from the implementation review verdict.
> Date: 2026-04-12

---

## Finding 1: Single-Package Publish Produces False Repo-Wide Release State

### Problem

When `package` input is set to a single package (e.g., `core`), the build job still version-bumps all four publishable packages (`Version all packages`, lines 158-183), the publish matrix only publishes the selected package, but `create-release` commits all four bumped manifests and creates a single repo-wide git tag. This leaves three packages with bumped versions in git that were never published to npm.

### Remediation

**Remove the single-package publish path entirely for v0.1.0.**

Concrete changes to `.github/workflows/publish.yml`:

1. **Remove the `package` input.** Delete the `package` choice input (lines 14-25). v0.1.0 always publishes all four packages together. This is the only safe path when versions are lockstepped.

2. **Remove the `Determine packages to publish` step.** The matrix is always the fixed ordered list: `["traits","core","sessions","surfaces"]`. Hardcode it as a job-level output or inline constant.

3. **Simplify the `Version all packages` step.** Remove the conditional logic that reads `github.event.inputs.package`. All four packages are always versioned and published together.

4. **`create-release` is now always correct.** Since all four packages are always published, committing all four bumped manifests and tagging a single version is the correct behavior.

### What is NOT changed

- The `version`, `custom_version`, `preid`, `dry_run`, and `tag` inputs remain.
- The `max-parallel: 1` ordered sequential strategy remains.
- The DAG-ordered build remains.

### Deferred

Single-package publish may return in a future version with per-package versioning and per-package git tags. That is out of scope for v0.1.0.

---

## Finding 2: Incorrect Workforce Direct-Consumption Implementation

### Problem

The workflow header (lines 3-10) and inline comments (lines 71-77, 246-248) reference `BLOCKER-WF-001` as active and point to a future `@agentworkforce/personas` package. The implementation boundary explicitly retired `BLOCKER-WF-001` and required consumption via `@agentworkforce/workload-router` (already published as v0.1.1). The root `package.json` has no `devDependencies` section, so `@agentworkforce/workload-router` was never added.

### Remediation

Concrete changes:

1. **Add `@agentworkforce/workload-router` as a root devDependency.**

   In the root `package.json`, add:
   ```json
   "devDependencies": {
     "@agentworkforce/workload-router": "^0.1.1"
   }
   ```
   Then regenerate `package-lock.json` via `npm install`.

2. **Replace all `BLOCKER-WF-001` references in `publish.yml`.**

   The workflow header comment block (lines 3-10) must be replaced with:
   ```yaml
   # Workforce npm-provenance-publisher profile consumption:
   # Consumed via @agentworkforce/workload-router (resolvePersona('npm-provenance')).
   # The workflow orchestration layer uses the workload-router programmatically.
   # This YAML implements the persona's concrete technical requirements directly
   # (YAML cannot import npm packages) with source attribution to the persona.
   # See: @agentworkforce/workload-router — npm-provenance intent.
   ```

   The permissions comment block (lines 71-77) must be replaced with:
   ```yaml
   # Required for npm OIDC provenance attestation.
   # Source: @agentworkforce/workload-router — resolvePersona('npm-provenance')
   # TARGET STATE: Full OIDC with no NPM_TOKEN, pending trusted publisher registration
   # on npmjs.com for each package (manual step).
   # Until trusted publisher registration is complete, NODE_AUTH_TOKEN is used as bridge.
   ```

   The publish job npm-upgrade comment (lines 246-248) must be replaced with:
   ```yaml
   # Required by npm-provenance-publisher persona (via @agentworkforce/workload-router):
   # prevents stale-runner OIDC token failures on self-hosted or outdated runners.
   ```

3. **Remove the `docs/architecture/workforce-profile-consumption-plan.md` reference** from the workflow header. The workload-router is the consumption path; no separate plan document is needed.

### What is NOT changed

- The concrete YAML implementation of the persona's requirements (permissions, flags, npm upgrade) stays the same — only the attribution comments change.
- The `NODE_AUTH_TOKEN` bridge pattern remains until per-package trusted publisher registration is complete.

---

## Finding 3: Package Tarball / Test-Artifact Leakage

### Problem

`packages/surfaces/tsconfig.json` includes `src/**/*.ts` (line 15-17) but does not exclude test files. The other three publishable packages (`traits`, `core`, `sessions`) all have `"exclude": ["src/**/*.test.ts"]` in their tsconfig. Since `tsc` compiles everything in `include`, the surfaces build emits `dist/surfaces.test.js` and `dist/surfaces.test.d.ts`. The `"files": ["dist"]` field in surfaces' `package.json` means these compiled test artifacts end up in the published tarball.

### Remediation

**Add the missing `exclude` to `packages/surfaces/tsconfig.json`.**

Change from:
```json
{
  "include": [
    "src/**/*.ts"
  ]
}
```

To:
```json
{
  "include": [
    "src/**/*.ts"
  ],
  "exclude": [
    "src/**/*.test.ts"
  ]
}
```

This matches the pattern already used by the other three publishable packages. No other tsconfig files are modified.

### CI and publish verification gate

In addition to fixing the tsconfig, add an automated verification step to both `ci.yml` and `publish.yml` (after the build steps, before artifact upload) that fails the job if any test artifacts appear in dist:

```yaml
- name: Verify no test artifacts in dist
  run: |
    FAIL=0
    for pkg in traits core sessions surfaces; do
      if find "packages/$pkg/dist" -name '*.test.*' 2>/dev/null | grep -q .; then
        echo "ERROR: test artifacts found in packages/$pkg/dist/"
        find "packages/$pkg/dist" -name '*.test.*'
        FAIL=1
      fi
    done
    if [ "$FAIL" -eq 1 ]; then exit 1; fi
    echo "No test artifacts in dist — OK"
```

This is belt-and-suspenders: the tsconfig exclude prevents compilation, the CI step catches regressions. Both are required.

### Manual verification

After this change, `npm run build --workspace=packages/surfaces && npm pack --dry-run --workspace=packages/surfaces` must show zero `*.test.js` or `*.test.d.ts` files in the tarball listing.

---

## Finding 4: Artifact / Release Path Complexity

### Problem

The versioned-manifests artifact uploads four `package.json` files from different directories as a single artifact (lines 213-221). The `create-release` job downloads this artifact to `versioned-manifests/` (line 305) and copies files assuming the path structure `versioned-manifests/traits/package.json` etc. (lines 310-313). GitHub's `actions/upload-artifact@v4` uses the least common ancestor of the uploaded paths as the artifact root, so the actual download structure is `versioned-manifests/packages/traits/package.json` — one level deeper than assumed. The publish job has the same issue: it downloads the versioned-manifests artifact to `packages/${{ matrix.package }}` (line 264), which would place the files at `packages/core/packages/traits/package.json` — wrong.

Additionally, the `dist-*` artifacts are each uploaded and downloaded separately (which is correct), but the manifest artifact tries to serve two different jobs with two different expected layouts, adding fragility.

### Remediation

**Upload each package manifest as its own artifact. Remove the combined versioned-manifests artifact.**

Concrete changes to `.github/workflows/publish.yml`:

1. **Replace the single `Upload versioned package manifests` step** (lines 213-222) with four individual uploads:

   ```yaml
   - name: Upload versioned manifest — traits
     uses: actions/upload-artifact@v4
     with:
       name: manifest-traits
       path: packages/traits/package.json
       retention-days: 1

   - name: Upload versioned manifest — core
     uses: actions/upload-artifact@v4
     with:
       name: manifest-core
       path: packages/core/package.json
       retention-days: 1

   - name: Upload versioned manifest — sessions
     uses: actions/upload-artifact@v4
     with:
       name: manifest-sessions
       path: packages/sessions/package.json
       retention-days: 1

   - name: Upload versioned manifest — surfaces
     uses: actions/upload-artifact@v4
     with:
       name: manifest-surfaces
       path: packages/surfaces/package.json
       retention-days: 1
   ```

   Each artifact contains a single `package.json` at the artifact root. No path ambiguity.

2. **Update the publish job manifest download** (lines 260-264). Download only the manifest for the current matrix package:

   ```yaml
   - name: Download versioned manifest — ${{ matrix.package }}
     uses: actions/download-artifact@v4
     with:
       name: manifest-${{ matrix.package }}
       path: packages/${{ matrix.package }}
   ```

   This places `package.json` directly at `packages/<pkg>/package.json` — the correct location.

3. **Update the `create-release` job manifest downloads** (lines 301-305). Download each manifest individually to its correct destination:

   ```yaml
   - name: Download versioned manifest — traits
     uses: actions/download-artifact@v4
     with:
       name: manifest-traits
       path: packages/traits

   - name: Download versioned manifest — core
     uses: actions/download-artifact@v4
     with:
       name: manifest-core
       path: packages/core

   - name: Download versioned manifest — sessions
     uses: actions/download-artifact@v4
     with:
       name: manifest-sessions
       path: packages/sessions

   - name: Download versioned manifest — surfaces
     uses: actions/download-artifact@v4
     with:
       name: manifest-surfaces
       path: packages/surfaces
   ```

4. **Remove the `cp` commands from `Commit version bump`** (lines 309-313). The manifests are now downloaded directly to their correct paths. The step becomes:

   ```yaml
   - name: Commit version bump
     run: |
       NEW_VERSION="${{ needs.build.outputs.new_version }}"
       git add packages/traits/package.json packages/core/package.json packages/sessions/package.json packages/surfaces/package.json
       git commit -m "chore: bump version to v${NEW_VERSION}" || echo "No changes to commit"
       git push
   ```

5. **Add a manifest validation step** in `create-release`, after all manifest downloads and before the commit step. This catches any artifact path errors before they corrupt the git history:

   ```yaml
   - name: Validate downloaded manifests
     run: |
       EXPECTED="${{ needs.build.outputs.new_version }}"
       for pkg in traits core sessions surfaces; do
         if [ ! -f "packages/$pkg/package.json" ]; then
           echo "ERROR: packages/$pkg/package.json not found after artifact download"
           exit 1
         fi
         VERSION=$(node -p "require('./packages/$pkg/package.json').version")
         if [ "$VERSION" != "$EXPECTED" ]; then
           echo "ERROR: packages/$pkg/package.json version $VERSION != expected $EXPECTED"
           exit 1
         fi
       done
       echo "All manifests validated at v${EXPECTED} — OK"
   ```

   This step is required, not optional. It is the primary defense against artifact path bugs reaching the git tag.

### What is NOT changed

- The `dist-*` artifact upload/download pattern is already correct (one artifact per package, downloaded to the right path). No changes needed.
- The git tag and GitHub release creation steps are unchanged.

---

## Complete File Change Manifest

### Modified files

| File | Remediation | Finding |
|------|-------------|---------|
| `.github/workflows/publish.yml` | Remove single-package input; hardcode all-packages matrix; replace BLOCKER-WF-001 comments with workload-router attribution; split versioned-manifests into per-package artifacts; simplify create-release manifest handling; add dist verification step; add manifest validation step | #1, #2, #3, #4 |
| `package.json` (root) | Add `devDependencies` with `@agentworkforce/workload-router: "^0.1.1"` | #2 |
| `package-lock.json` (root) | Regenerated after adding devDependency | #2 |
| `packages/surfaces/tsconfig.json` | Add `"exclude": ["src/**/*.test.ts"]` | #3 |
| `.github/workflows/ci.yml` | Add dist verification step (no test artifacts in dist) | #3 |

### No new files

No new files are created by this remediation. This document is the only new artifact.

### No other files modified

- The four publishable `package.json` files (`traits`, `core`, `sessions`, `surfaces`) are not changed (they already have `repository`, `publishConfig`, and `files` fields).
- No docs are created or modified beyond this boundary document.

---

## Verification Checklist (Post-Remediation)

All checks must pass before the workflow is considered ready for manual publish testing.

1. **No single-package option exists.** `publish.yml` has no `package` input. `workflow_dispatch` only offers `version`, `custom_version`, `preid`, `dry_run`, and `tag`.

2. **No BLOCKER-WF-001 references.** `grep -r "BLOCKER-WF-001" .github/` returns zero matches. All Workforce attribution comments reference `@agentworkforce/workload-router`.

3. **`@agentworkforce/workload-router` is a root devDependency.** `node -e "require('@agentworkforce/workload-router')"` succeeds after `npm ci`.

4. **No test artifacts in surfaces tarball.** `npm run build --workspace=packages/surfaces && npm pack --dry-run --workspace=packages/surfaces | grep -c test` returns `0`.

5. **No combined versioned-manifests artifact.** `publish.yml` contains no artifact named `versioned-manifests`. Each manifest is uploaded/downloaded as `manifest-<pkg>`.

6. **Artifact download paths are direct.** The `create-release` job has no `cp` commands for manifest files. Manifests are downloaded directly to `packages/<pkg>/`.

7. **Dist verification step exists in both workflows.** Both `publish.yml` (build job) and `ci.yml` contain a "Verify no test artifacts in dist" step that fails on any `*.test.*` files in any publishable package's `dist/` directory.

8. **Manifest validation step exists in create-release.** The `create-release` job contains a "Validate downloaded manifests" step that checks all four `package.json` files exist at expected paths with the expected version before committing.

9. **Local validation still passes.** `npm ci && npm test --workspace=packages/traits --workspace=packages/core --workspace=packages/sessions --workspace=packages/surfaces` succeeds. `npm run build` for all four packages succeeds. `npm pack --dry-run` for all four packages shows clean tarballs.

---

## Intentionally NOT in Remediation Scope

| Item | Reason |
|------|--------|
| Single-package publish path | Removed, not fixed — lockstepped versioning makes per-package publish unsafe; may return with per-package versioning in a future version |
| `docs/architecture/workforce-profile-consumption-plan.md` | Not deleted — it may have value as historical context; simply no longer referenced from the workflow |
| Per-package trusted publisher OIDC registration | External manual step on npmjs.com — unchanged from implementation boundary |
| Test count enforcement in CI | Deferred per implementation boundary — not a remediation finding |
| Turborepo or build caching | Deferred per implementation boundary — not a remediation finding |
| Changelog generation | Deferred per implementation boundary — not a remediation finding |

---

PUBLISH_INFRA_REMEDIATION_BOUNDARY_READY
