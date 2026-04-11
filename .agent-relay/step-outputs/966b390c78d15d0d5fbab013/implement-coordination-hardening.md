Implemented the v1 coordination hardening patch in the existing coordination package.

Updated:
- `packages/coordination/src/coordination.ts`
  - wired `config.connectivity.registerSelectedResolver(...)` inside `execute()` using the current validated plan participants, excluding the emitting source
  - added the validating-factory JSDoc for `createDelegationPlan()`
- `packages/coordination/src/coordination.test.ts`
  - expanded the suite to 35 tests total
  - added the missing high-value coverage for registry edge cases, plan validation, synthesis strategies, coordinator lifecycle, maxSteps enforcement, `coord_` turn IDs, and selected-audience resolver registration
- `packages/coordination/README.md`
  - clarified that `createDelegationPlan()` is a validating factory
  - documented that coordination registers a per-turn selected-audience resolver with connectivity
- `docs/architecture/v1-coordination-hardening-plan.md`
  - added implementation notes
  - appended `COORDINATION_HARDENING_IMPLEMENTED`

Verification:
- `packages/coordination`: `npm run build` ✅
- `packages/coordination`: `npm test` ✅
- test result: `35 passed (35)`

Artifacts produced during verification:
- `packages/coordination/package-lock.json`
- `packages/coordination/node_modules/`

Summary:
- selected-audience coordination is now wired correctly
- the chosen API/spec decisions remain `validateDelegationPlan` and `coord_`
- the coordination package builds and passes the 35-test hardening target
