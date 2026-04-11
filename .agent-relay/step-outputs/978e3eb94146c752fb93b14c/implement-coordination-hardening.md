Implemented the v1 coordination hardening patch in the existing coordination package, with narrow scope preserved.

What changed:
- Updated [packages/coordination/tsconfig.json](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/tsconfig.json) to add `declarationMap` and `sourceMap`.
- Updated [docs/architecture/v1-coordination-implementation-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-coordination-implementation-plan.md) to align the spec with the shipped API:
  - `validateDelegationPlan` is the public validation export
  - `turnId` prefix is `coord_`
  - `createDelegationPlan()` is documented as a validating factory
  - selected-audience routing text now matches the coordinator behavior
- Updated [packages/coordination/README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/README.md) to surface `validateDelegationPlan` in the public API example.
- Updated [docs/architecture/v1-coordination-hardening-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-coordination-hardening-plan.md) with a final implementation note and preserved the required `COORDINATION_HARDENING_IMPLEMENTED` marker at the end.

Runtime/test status:
- The selected-audience resolver wiring in [packages/coordination/src/coordination.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/src/coordination.ts) was already correctly present before subscription.
- The high-value review-followup coverage in [packages/coordination/src/coordination.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/coordination/src/coordination.test.ts) was already present and meets the planned minimum: `35` tests total.

Verification:
- `npm test` in `packages/coordination`: passed, `35/35` tests green
- `npm run build` in `packages/coordination`: passed
- Build artifacts now include source/declaration maps in `packages/coordination/dist/`:
  - `.js.map`
  - `.d.ts.map`

Artifacts produced:
- Updated package/docs files listed above
- Generated mapped build output in `packages/coordination/dist/`

Summary:
- Coordination hardening is implemented without redesign.
- Selected-audience resolution is wired.
- Required review-value tests are present and passing.
- Spec/API mismatches chosen in the plan are resolved by documentation alignment.
- `COORDINATION_HARDENING_IMPLEMENTED` is present in the hardening plan.
