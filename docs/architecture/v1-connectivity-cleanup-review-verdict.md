# v1 Connectivity Cleanup Review Verdict

**Date:** 2026-04-13
**Package:** `@agent-assistant/connectivity`
**Verdict:** READY_FOR_WAVE_2

## Executive summary

This cleanup slice found and fixed the real package-local publishability blocker: connectivity's public type surface leaked `@agent-assistant/routing` even though routing was only a dev dependency. That meant the package could appear healthy inside the repo while failing for external TypeScript consumers in an npm-only install.

After cleanup, connectivity now validates cleanly as a self-contained package:

- tests pass
- typecheck passes
- build passes
- `npm pack` contains the correct `dist/` artifacts
- npm-only runtime import works
- npm-only TypeScript use of exported hook/config types works without installing routing
- downstream coordination tests still pass

Within the bounded connectivity package boundary, there is no longer an honest reason to hold this package back.

## What changed

### Code/package changes

1. **Removed the public type leak to routing**
   - `packages/connectivity/src/types.ts` now defines `RequestedRoutingMode` and `RoutingEscalationHook` locally instead of importing/re-exporting them from `@agent-assistant/routing`
   - emitted `.d.ts` files no longer reference routing

2. **Removed unnecessary routing coupling from scripts**
   - deleted connectivity `prebuild` and `pretest` steps that built routing first
   - connectivity now validates as its own package boundary

3. **Removed unnecessary routing devDependency**
   - `@agent-assistant/routing` was removed from `packages/connectivity/package.json` devDependencies

4. **Added explicit package-local typecheck command**
   - added `npm run typecheck`

5. **Updated package docs**
   - `packages/connectivity/README.md` now states explicitly that the routing hook contract is locally owned so consumers do not need routing installed just to typecheck connectivity

### Documentation changes

1. Added `docs/architecture/v1-connectivity-cleanup-boundary.md`
2. Added this verdict document
3. Updated `docs/current-state.md` so connectivity is no longer described with the stale “workspace not installed” blocker framing

## Blockers before / after

### Before

**B1. Public `.d.ts` install failure for TypeScript consumers**
- Reproduced by packing connectivity, installing it into a temp npm project, and compiling a file that imports `RoutingEscalationHook`, `RequestedRoutingMode`, and `ConnectivityLayerConfig`
- Failure: `TS2307 Cannot find module '@agent-assistant/routing'`
- Severity: package-local publishability blocker

**B2. Validation hid boundary coupling**
- `prebuild` / `pretest` built routing first
- Severity: medium; made package-local validation less honest

**B3. Status docs were stale**
- Connectivity was still framed mainly as blocked by missing install state rather than its real external package-boundary problem
- Severity: documentation truthfulness issue

### After

**Resolved:** B1, B2, B3

**Remaining connectivity-local blockers:** none found

**Still outside this slice:** broader repo/package publish sequencing issues not owned by connectivity

## Validation run

### Connectivity package

From `packages/connectivity`:

- `npm test` ✅ — 30 tests passed
- `npm run typecheck` ✅
- `npm run build` ✅
- `npm pack --json` ✅ — tarball contains README, package.json, and all expected `dist/*` files

### npm-only external smoke

Temp project using only the packed connectivity tarball:

- runtime ESM import of `createConnectivityLayer` ✅
- TypeScript compile using exported `RoutingEscalationHook`, `RequestedRoutingMode`, and `ConnectivityLayerConfig` ✅

This is the strongest evidence that the prior publishability issue is actually fixed.

### Downstream regression

From `packages/coordination`:

- `npm test` ✅ — 39 tests passed

## Boundary assessment

Connectivity now meets the intended package boundary more honestly:

- no runtime dependency on routing
- no public type dependency on routing
- routing can still implement the same structural hook contract
- coordination integration remains intact

This is a better outcome than promoting routing to a mandatory dependency just to support two public types.

## Honest verdict

**READY_FOR_WAVE_2**

Reason:

The package-local validation and publishability blockers for `@agent-assistant/connectivity` are resolved. The package is now fit to move forward in wave-2 sequencing, subject to the repo's broader release work that remains outside this cleanup slice.
