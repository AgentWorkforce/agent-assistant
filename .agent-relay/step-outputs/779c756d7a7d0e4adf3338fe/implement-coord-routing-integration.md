Implemented the bounded v1 coordination↔routing integration and wrote the changes to disk.

**What changed**
- Coordination now accepts an optional structural router interface, forwards a pre-step routing snapshot into `SpecialistContext`, records per-step routing decisions in the turn result, and accumulates finite positive step cost into the router for later decisions. See [packages/coordination/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/src/types.ts:25) and [packages/coordination/src/coordination.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/src/coordination.ts:92).
- Connectivity no longer owns duplicate `RequestedRoutingMode` or `RoutingEscalationHook` definitions. It now re-exports the canonical routing-owned types while keeping the runtime behavior unchanged. See [packages/connectivity/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/connectivity/src/types.ts:1).
- Added narrow integration coverage for useful v1 behavior: routing decision forwarding, per-turn routing decision capture, cost carry-forward between steps, ignoring invalid cost metadata, and unchanged behavior with no router. See [packages/coordination/src/coordination.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/src/coordination.test.ts:66) and [packages/coordination/src/coordination.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/src/coordination.test.ts:945).
- Updated package metadata to add the routing type dependency and build ordering where needed, and appended the required marker to the architecture plan. See [packages/connectivity/package.json](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/connectivity/package.json:1), [packages/coordination/package.json](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/package.json:1), and [docs/architecture/v1-coordination-routing-integration-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-coordination-routing-integration-plan.md:390).

**Artifacts produced**
- Updated source files:
  - `packages/connectivity/src/types.ts`
  - `packages/coordination/src/types.ts`
  - `packages/coordination/src/coordination.ts`
  - `packages/coordination/src/index.ts`
  - `packages/coordination/src/coordination.test.ts`
  - `docs/architecture/v1-coordination-routing-integration-plan.md`
- Updated package metadata/install artifacts:
  - `packages/connectivity/package.json`
  - `packages/connectivity/package-lock.json`
  - `packages/coordination/package.json`
  - `packages/coordination/package-lock.json`
- Refreshed build artifacts in package `dist/` directories via package builds.

**Verification**
- `packages/routing`: `npm test` passed.
- `packages/connectivity`: `npm run build` and `npm test` passed.
- `packages/coordination`: `npm run build` and `npm test` passed.

Summary: the v1-bounded coordination↔routing integration is implemented, `RequestedRoutingMode` drift is removed at the source by making routing canonical, useful integration tests were added, and `COORD_ROUTING_INTEGRATION_IMPLEMENTED` was appended to the plan doc.
