Implemented the v1 foundation integration slice.

Artifacts produced:
- `packages/core/src/core-sessions.test.ts`
- `packages/core/src/core-sessions-surfaces.test.ts`
- Updated `packages/core/src/core.ts`
- Updated `packages/core/tsconfig.json`
- Updated `docs/architecture/v1-foundation-integration-plan.md`

What was added:
- WF-4 integration coverage for:
  - session subsystem registration
  - first-message session creation
  - existing-session resolution
  - targeted send via attached session surfaces
  - `fanout()` path usage when available
  - invalid emit handling
  - session touch / `lastActivityAt` behavior
  - attach/detach effects on fanout targets
- WF-6 integration coverage for:
  - using the surface registry as both inbound and outbound adapter
  - `receiveRaw -> normalize -> dispatch -> handler`
  - session fanout across multiple attached surfaces
  - attach/detach changes to fanout membership
  - inactive-surface skipping during fanout
  - clean start/stop lifecycle with stop waiting on in-flight work
  - raw inbound drop when normalization cannot produce `userId`

Minimal package changes made:
- Fixed a real concurrency bug in `packages/core/src/core.ts`:
  - `maxConcurrentHandlers` was not enforced correctly under bursty dispatch because queued jobs could start before `inFlightCount` was reserved.
  - `inFlightCount` is now reserved before dispatch execution begins, which also makes `stop()` drain behavior correct for active work.
- Excluded `src/**/*.test.ts` from `packages/core/tsconfig.json` so cross-package integration tests do not become build artifacts.
- Appended `FOUNDATION_INTEGRATION_IMPLEMENTED` to `docs/architecture/v1-foundation-integration-plan.md`.

Verification:
- Tests: `../surfaces/node_modules/.bin/vitest run src/core.test.ts src/core-sessions.test.ts src/core-sessions-surfaces.test.ts` in `packages/core` -> passed
- Build: `../surfaces/node_modules/.bin/tsc -p tsconfig.json` in `packages/core` -> passed

Summary:
- WF-4 integration test added
- WF-6 integration test added
- One minimal runtime fix applied in `core.ts` for correct concurrency/drain behavior
- Foundation plan doc updated with the required marker
