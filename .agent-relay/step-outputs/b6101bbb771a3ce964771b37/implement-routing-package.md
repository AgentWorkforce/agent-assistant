Implemented the v1 routing package under `packages/routing/` with the requested bounded scope.

Artifacts produced:
- `packages/routing/package.json`
- `packages/routing/tsconfig.json`
- `packages/routing/src/index.ts`
- `packages/routing/src/types.ts`
- `packages/routing/src/routing.ts`
- `packages/routing/src/routing.test.ts`
- `packages/routing/README.md`
- `packages/routing/package-lock.json` (from `npm install`)

What was implemented:
- TypeScript-first standalone package for assistant-level routing
- Minimal v1 runtime with `createRouter()`
- `cheap` / `fast` / `deep` routing modes
- Policy primitives for:
  - capability overrides
  - caller-requested modes
  - hard mode ceiling
  - cost envelope downgrade
  - latency-based downgrade
  - escalation-driven mode selection
- Abstract `ModelSpec` construction with context requirement merging
- In-memory per-thread cost tracking via `recordCost`, `getAccumulatedCost`, `resetCost`
- Clean connectivity boundary types and `RoutingEscalationHook` / `onEscalation()` without importing or owning connectivity runtime
- Workforce-aligned naming and semantics through mode tiers and routing hints, without provider/product logic
- Unit tests covering first routing workflows and boundary behavior
- Real package README replacing the placeholder, ending with `ROUTING_PACKAGE_IMPLEMENTED`

Validation completed:
- `cd packages/routing && npm run typecheck` ✅
- `cd packages/routing && npm run build` ✅
- `cd packages/routing && npm run test` ✅ (12 tests passed)

Implementation summary:
- The router is provider-agnostic and transport-free.
- It returns abstract routing decisions and model recommendations only.
- Connectivity interaction is limited to a narrow escalation hook.
- The package is runnable and testable in isolation.
