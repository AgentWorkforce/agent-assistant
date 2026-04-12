# Publish Infrastructure Implementation Review Verdict — RelayAssistant

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Verdict: FAIL

## Findings

1. **Single-package publish produces a false repo-wide release state.**
   In `.github/workflows/publish.yml`, the package selector can choose a single package (`package` input, lines 15-25), but the build job always bumps all four publishable package versions (`Version all packages`, lines 158-183). The publish matrix then publishes only the selected package (`Determine packages to publish`, lines 147-156; publish job matrix, lines 231-234), while `create-release` still commits all four bumped manifests and creates a repo tag/release (`Commit version bump`, lines 307-316; `Create version tag`, lines 318-322). That means a manual run for `core` can leave Git tagged at `vX.Y.Z` with `traits`, `sessions`, and `surfaces` manifests also bumped in git even though those packages were not published. This is not safe and does not reliably avoid publishing or versioning unready packages.

2. **The implementation still follows the obsolete Workforce-profile story instead of the required `@agentworkforce/workload-router` direction.**
   The implementation boundary explicitly corrected this: `BLOCKER-WF-001` is retired and the direct path is via `@agentworkforce/workload-router`, which should be added as a root devDependency ([docs/architecture/publish-infrastructure-implementation-boundary.md](./publish-infrastructure-implementation-boundary.md), lines 140-183, especially 144-164). The actual workflow header still says `BLOCKER-WF-001` is active and points to a future `@agentworkforce/personas` package (`.github/workflows/publish.yml`, lines 3-10, 71-77, 246-248). The new root `package.json` also has no `devDependencies` at all, so `@agentworkforce/workload-router` was not added (`package.json`, lines 1-19). This is a direct miss against requirement 3.

3. **At least one publishable package is still packaging test artifacts into the release tarball.**
   `packages/surfaces/tsconfig.json` includes every `src/**/*.ts` file (lines 15-17), and the package keeps `src/surfaces.test.ts` in that tree. A local `npm pack --dry-run --workspace=packages/surfaces` shows `dist/surfaces.test.js` and `dist/surfaces.test.d.ts` in the tarball. Publishing test code is not catastrophic, but it is evidence that the package contents have not yet been tightened for release and manual publish testing should not be the next step until the package surface is intentional.

4. **The release-artifact handoff is underspecified and likely wrong for the downloaded paths.**
   The workflow uploads multiple manifest files as one artifact (`.github/workflows/publish.yml`, lines 213-221) and later assumes they will download as `versioned-manifests/traits/package.json` etc. in `create-release` (lines 307-313). GitHub’s artifact action preserves uploaded directory structure and uses the least common ancestor as the artifact root when multiple paths are uploaded, so this path handling needs explicit validation before relying on it. The same risk exists for downloading `dist-*` artifacts into `packages/<pkg>/dist` (lines 254-264). This is a robustness issue in the core publish path, not a follow-up polish item. Source: GitHub `actions/upload-artifact` README notes the least common ancestor rule, and `actions/download-artifact` restores artifact contents under the requested destination path.

## Assessment

1. **Is the workflow robust and safe?**
   No. The gate structure is better than the earlier plan, and local validation is promising (`npm ci`, tests, builds, and `npm pack --dry-run` all work locally for the four target packages), but the workflow can still create an incorrect tagged release on single-package runs and its artifact handoff is not yet trustworthy enough for first publish use.

2. **Does it avoid publishing unready packages?**
   Partially. The dispatch options correctly exclude the known blocked packages, and the four included packages currently pass local `npm ci`, tests, and builds. But the single-package path still version-bumps and releases all four manifests, so it does not cleanly avoid advancing packages that were not actually published.

3. **Does it use the Workforce profile/package direction correctly rather than copying it locally?**
   No. It avoids copying the persona JSON into this repo, which is good, but it does not implement the corrected direct-consumption direction. The implementation still documents the obsolete `BLOCKER-WF-001` / `@agentworkforce/personas` path and never adds `@agentworkforce/workload-router` at the root.

4. **Is this ready for manual publish testing next?**
   No. The next step should be one more implementation pass, not manual publish testing. At minimum:
   - make single-package publishes either publish-and-release only that package cleanly or remove the single-package path for v0.1.0;
   - align the Workforce references and root dependency with `@agentworkforce/workload-router`;
   - fix package contents so test artifacts are not emitted into published tarballs;
   - validate and simplify artifact download paths before trusting the publish/release jobs.

## What Was Verified

- Reviewed `docs/architecture/publish-infrastructure-implementation-boundary.md`.
- Reviewed `.github/workflows/publish.yml`.
- Reviewed changed `package.json` files for `traits`, `core`, `sessions`, and `surfaces`, plus the new root `package.json`.
- Reviewed new release-related docs under `docs/architecture/`.
- Ran local validation:
  - `npm ci` at repo root: passed
  - `npm test` for `traits`, `core`, `sessions`, `surfaces`: passed
  - `npm run build` for `traits`, `core`, `sessions`, `surfaces`: passed
  - `npm pack --dry-run` for `traits`, `core`, `sessions`, `surfaces`: passed, with `surfaces` showing test artifacts in the tarball

Artifact produced: `docs/architecture/publish-infrastructure-implementation-review-verdict.md`

PUBLISH_INFRASTRUCTURE_IMPLEMENTATION_REVIEW_COMPLETE
