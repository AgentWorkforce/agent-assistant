# v1 Turn-Context Package Review Verdict

Date: 2026-04-13
Package: `@agent-assistant/turn-context`
Reviewer verdict: `PASS_WITH_FOLLOWUPS`

## Findings

### 1. Required `shaping` contract is not actually enforced

The implementation boundary and package plan both made `shaping` a required v1 input so products explicitly opt into turn-scoped shaping. The shipped package still makes it optional in the public type and does not validate it at runtime.

Evidence:
- `packages/turn-context/src/types.ts:31` defines `shaping?: TurnShapingInput`
- `packages/turn-context/src/validation.ts:13-43` validates `assistantId`, `turnId`, and `identity.baseInstructions`, but never `shaping`
- `packages/turn-context/src/assembler.test.ts:12-23` defines the “minimal valid” input with no `shaping`

Impact:
- This does not break the package mechanically, but it weakens the intended boundary between stable identity and turn-scoped product intent.
- A consumer can treat the package as “identity plus optional extras” instead of “identity plus explicit per-turn shaping”.

Recommended follow-up:
- Make `shaping` required in the exported input type and validator.
- Add the missing rejection test for absent `shaping`.

### 2. Exported customization story is ahead of the real implementation

The package exports seam interfaces for instruction/memory/enrichment customization, but the factory options are effectively empty and ignored.

Evidence:
- `packages/turn-context/src/types.ts:229-245` exports `TurnMemoryProjector`, `TurnEnrichmentProjector`, and `TurnInstructionComposer`
- `packages/turn-context/src/assembler.ts:260-268` defines an empty `CreateTurnContextAssemblerOptions` and ignores `_options`

Impact:
- This is not a boundary violation, but it creates a mild mismatch between the package shape and the plan/docs that describe narrow overridable hooks.
- Real product teams cannot yet replace the default projectors/composer without forking internals.

Recommended follow-up:
- Either implement the narrow hooks the docs planned, or trim the public seam language until those hooks exist.

## Assessment

### 1. Did the implementation stay bounded?

Yes, materially.

The package stays within the intended seam: pure turn assembly, deterministic candidate projection, lightweight provenance, and harness projection. It does not drift into retrieval, policy evaluation, specialist orchestration, or harness execution. The internal behavior in [`packages/turn-context/src/assembler.ts`](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/turn-context/src/assembler.ts:188), [`expression.ts`](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/turn-context/src/expression.ts:122), and [`projection.ts`](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/turn-context/src/projection.ts:37) is appropriately small and deterministic.

The only notable boundary miss is contractual, not architectural: `shaping` was supposed to be required and is not.

### 2. Is the API actually useful to a real product?

Yes.

The main API is the right size for adoption: one factory, one `assemble(input)` call, one output object that exposes both richer assembly data and direct harness-ready projection. The returned structure is product-usable because it preserves:
- identity summary
- structured expression
- instruction segmentation
- context blocks with provenance
- direct `harnessProjection`

This is enough for a real product to author prompt floors, attach memory/enrichment candidates, inspect what got used, and feed harness without another semantic assembly layer.

### 3. Does harness projection look clean and believable?

Yes.

`projectToHarness(...)` is straightforward and credible. It maps instruction segments into `HarnessInstructions` and maps prepared context blocks directly into `HarnessPreparedContext` with no lossy reshaping beyond dropping the internal `category`, which harness does not support. The local harness types confirm the projection is shape-correct.

The result looks believable for real use because:
- the identity floor survives in `systemPrompt`
- shaping and guardrails survive in `developerPrompt`
- `responseStyle` passes through
- memory/session/enrichment blocks carry into harness context cleanly

### 4. Are the tests meaningful enough for a first package pass?

Yes, with follow-ups.

The suite is strong for a first pass. It covers validation, identity projection, expression defaults/overrides, context projection, provenance, harness projection, and one realistic multi-source assembly path. That is enough to justify first-package usefulness.

The main gaps are:
- no test for missing `shaping`, despite that being a documented v1 requirement
- the “priority ordering” test checks presence more than actual order in the bundle
- the harness consumer-path proof is behavioral, not an explicit type-level assertion against `HarnessTurnInput`

None of those gaps invalidate the package, but they should be tightened before broader adoption.

## Overall Verdict

`PASS_WITH_FOLLOWUPS`

Reason:
- The package is bounded correctly.
- The API is useful to a real product now.
- The harness projection is clean and believable.
- The tests are meaningful for v0.1.0.

The follow-ups are concrete and limited:
1. enforce required `shaping` in type + runtime validation + tests
2. reconcile the customization-hook story with the actual factory surface
3. tighten a few proof tests around ordering and harness consumer typing

## Verification

Verified locally:
- `npm run build` succeeded
- `npm test` succeeded

Artifact produced:
- `docs/architecture/v1-turn-context-package-review-verdict.md`

V1_TURN_CONTEXT_PACKAGE_REVIEW_COMPLETE
