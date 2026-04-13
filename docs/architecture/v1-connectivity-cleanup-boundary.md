# v1 Connectivity Cleanup Boundary

**Date:** 2026-04-13
**Package:** `@agent-assistant/connectivity`
**Scope:** bounded cleanup slice for validation, dependency/export hygiene, and honest publish-readiness assessment

## Goal

Decide whether `@agent-assistant/connectivity` is actually ready to move forward for wave-2 consumption/publish sequencing, based on package-local validation rather than earlier optimistic assumptions.

## What must be verified now

This slice verifies only the connectivity package boundary and the minimum downstream confidence needed to call it wave-2 ready.

### 1. Package-local behavior must verify cleanly

The current implemented behavior must validate locally:

- signal validation and lifecycle
- suppression behavior
- audience handling
- routing escalation hook behavior
- step expiry behavior
- documented workflow coverage in the existing test suite

Required checks:

- `npm test`
- `npm run typecheck`
- `npm run build`

### 2. Publish/install shape must verify cleanly

The published package boundary must be self-consistent:

- `package.json` export entries resolve to built artifacts in `dist/`
- `npm pack` includes the expected runtime/type files
- an npm-only temp install can:
  - import the runtime entrypoint
  - typecheck package-exported public types without undeclared transitive packages

This is the key honesty gate for this cleanup slice.

### 3. Dependency and export boundaries must be clean

Connectivity must not require consumers to install unrelated packages just to use its declared API.

Specifically, the package must not:

- leak `@agent-assistant/routing` through public `.d.ts` files unless routing is a real runtime dependency
- require routing builds as a package-local pretest/prebuild step when connectivity is only using a hook contract
- export a public type surface whose installability contradicts its own manifest

### 4. Minimal downstream regression check

Because coordination depends on connectivity, run a downstream local regression check after cleanup:

- `packages/coordination`: `npm test`

This is a confidence check, not an invitation to widen scope into coordination cleanup.

## Validation/publishability gaps found at start of this slice

### Gap A — public type surface leaked `@agent-assistant/routing`

`packages/connectivity/src/types.ts` imported/re-exported `RequestedRoutingMode` and `RoutingEscalationHook` from `@agent-assistant/routing`, while `routing` existed only as a dev dependency.

Impact:

- published consumers could install `@agent-assistant/connectivity` successfully
- runtime import could work
- but TypeScript consumers using exported hook types failed because the package's emitted `.d.ts` referenced an undeclared package

This was a real publishability blocker.

### Gap B — package scripts implied unnecessary routing coupling

Connectivity's `prebuild` and `pretest` scripts built routing first, which hid the fact that the package-local contract should stand on its own.

Impact:

- validation looked greener inside the monorepo than it would in a true package-consumer scenario
- the package boundary was operationally awkward and slightly dishonest

### Gap C — repo status docs were stale about connectivity verification

Current status docs still described connectivity primarily as blocked by missing install state, not by the actual package-boundary issue that mattered for external consumers.

## Cleanup changes allowed in this slice

Allowed:

- fix public type ownership within connectivity
- remove unnecessary dependency/build coupling to routing
- add package-local validation script(s)
- update README and status/review docs to reflect the true boundary and verdict
- regenerate build artifacts as needed

Conditionally allowed:

- fix implementation defects only if exposed by validation while performing the above

Not allowed:

- redesign signal semantics
- expand signal vocabulary
- widen into coordination package cleanup beyond regression validation
- change product adoption guidance outside connectivity-specific truthfulness updates
- solve broader repo publish issues unrelated to connectivity

## Explicitly deferred

The following are out of scope for this cleanup slice and do not block the package-local verdict:

- coordination publishability cleanup (for example its `file:` runtime dependency shape)
- routing hardening beyond structural compatibility with connectivity's local hook contract
- memory package unblock work
- repo-wide npm republish remediation for already-published wave-1 packages
- multi-package release orchestration
- new workflow/test expansion beyond validating the existing connectivity package strongly

## Decision rule

`@agent-assistant/connectivity` can be marked `READY_FOR_WAVE_2` only if all of the following are true:

1. package-local tests, typecheck, and build pass
2. packed tarball contains correct `dist/` artifacts
3. npm-only temp install succeeds for both runtime import and TypeScript use of the exported hook/config types
4. no undeclared cross-package public type dependency remains
5. downstream coordination regression still passes

Otherwise the verdict is `STILL_HELD_BACK`.
