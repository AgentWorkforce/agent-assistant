Implemented the v1 connectivity hardening patch in `packages/connectivity` and updated the hardening plan marker.

What changed:
- Added `"exactOptionalPropertyTypes": true` to [packages/connectivity/tsconfig.json](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/connectivity/tsconfig.json).
- Tightened supersession semantics in [packages/connectivity/src/connectivity.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/connectivity/src/connectivity.ts) so replacing any terminal signal, including `resolved`, now throws `ConnectivityError`.
- Added the active-promotion edge-case comment in [packages/connectivity/src/connectivity.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/connectivity/src/connectivity.ts).
- Expanded [packages/connectivity/src/connectivity.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/connectivity/src/connectivity.test.ts) with the missing high-value coverage from the review verdict:
  - `handoff.partial -> handoff.ready` supersession
  - superseding terminal signals throws
  - `self`, `all`, `selected-without-resolver`, and resolver replacement audience cases
  - suppression bypass on different `audience`
  - suppressed emits do not fire callbacks
  - non-expiring and boundary expiry step cases
  - resolving both active conflicts clears default query results
  - callback-driven `resolve()` preserves `resolved` instead of promoting to `active`
- Documented intentional constant exports and exact-optional-property guidance in [packages/connectivity/README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/connectivity/README.md).
- Appended `CONNECTIVITY_HARDENING_IMPLEMENTED` to [docs/architecture/v1-connectivity-hardening-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-connectivity-hardening-plan.md).

Verification:
- `npx tsc --noEmit` in `packages/connectivity`: passed
- `npm test -- --run` in `packages/connectivity`: passed (`30/30` tests)

Artifacts produced:
- Updated package files listed above
- Package-local install artifacts from `npm install` in `packages/connectivity` so the package is runnable/testable in isolation
- Hardening-plan completion marker appended as requested
