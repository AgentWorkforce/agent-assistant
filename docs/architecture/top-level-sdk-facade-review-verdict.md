# Top-Level SDK Facade Review Verdict

Date: 2026-04-13
Reviewer stance: APPROVE WITH REQUIRED REVISIONS

## Executive Verdict

The facade proposal is directionally correct and worth implementing. It materially improves public adoption ergonomics, keeps the modular package architecture intact, and creates a credible top-level shape for future Python parity.

It is not yet strong enough to drive implementation exactly as written. The core design is ready, but a small set of specification and implementation-plan corrections should be made first so the team does not harden avoidable mistakes into the first public entry point.

## Direct Answers

### 1. Does this improve public adoption ergonomics materially?

Yes.

The one-install, one-import path is a real improvement for external adopters evaluating the SDK. Reducing package-selection and import-surface decisions in the first 30 minutes is the right move, especially for open-source adoption where early drop-off is driven by setup friction more than runtime complexity.

That said, the docs overstate the baseline pain in one place. The current repo already has a true minimal `core`-only path in [packages/examples/src/01-minimal-assistant.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/src/01-minimal-assistant.ts:1). So the right claim is not "the simplest assistant currently requires three or more imports"; it is "the common product-ready assembly currently spans multiple packages." That distinction matters because reviewers and future maintainers will notice the mismatch immediately.

### 2. Does it preserve modular architecture cleanly?

Mostly yes.

The proposal is disciplined where it needs to be:

- The facade is explicitly re-export only.
- Package ownership remains with constituent packages.
- Advanced or unstable packages stay direct-import only.
- The inclusion bar is explicit rather than ad hoc.

This is the right architectural shape. It simplifies consumption without collapsing boundaries.

The main weakness is in the adoption examples, not the boundary itself. The starter examples still depend on product-owned transport/adapters, but the docs do not consistently make that explicit. In the implementation plan, the proposed `00-hello-world` example even uses `adapter: surfaceRegistry as any`, which weakens the architectural story by smuggling a fake adapter into the example. If the facade is supposed to be a clean re-export surface, the docs should not rely on `as any` to make the onboarding story work.

### 3. Does it create a strong foundation for future Python parity?

Yes, with one caveat.

The high-level parity model is strong:

- top-level package mirrors facade intent
- submodules mirror constituent packages
- advanced capabilities stay out of the top-level import
- naming discipline is treated as a portability constraint

That is the correct foundation.

The caveat is that the current text ties Python too tightly to the exact TypeScript facade export list. That is useful as a directional guardrail, but too rigid as a literal contract. Python will not have a one-to-one equivalent for all TypeScript type-only exports, and forcing exact symbol parity could create awkward Python API choices later. The parity section should say "same public shape and inclusion rules" rather than "the TypeScript boundary doc governs both languages" at symbol granularity.

### 4. Is this strong enough to drive implementation next?

Not yet, but very close.

The boundary and spec are good enough to proceed after a short revision pass. The current implementation plan still contains a few assumptions that should be corrected before work starts.

## Required Revisions Before Implementation

### 1. Correct the ergonomics claim to match the repo reality

The boundary doc says the simplest assistant currently requires three or more imports, but the repo already shows a `core`-only minimal path in [packages/examples/src/01-minimal-assistant.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/src/01-minimal-assistant.ts:1). Reframe the argument around the common multi-package assembly, not the absolute minimum.

### 2. Fix the version-range strategy for a `0.x` public facade

The boundary/spec/adoption guide all standardize on constituent dependencies like `>=0.1.0`. That is too loose for a facade whose value depends on a known-compatible re-export surface, especially during `0.x` where breaking changes are more likely. A broad lower-bound range lets npm resolve constituent package versions the facade was never validated against.

This should be tightened before implementation. Exact aligned versions or a controlled compatible range would be safer than raw `>=`.

### 3. Remove or replace the `as any` starter example

The implementation plan’s proposed hello-world example uses `adapter: surfaceRegistry as any`, which undercuts both ergonomics and architecture. A public starter should either:

- use the existing in-memory inbound/outbound adapter pattern from the current examples, or
- explicitly state that transport adapters are product-owned and stub them cleanly without type escapes.

### 4. Make the implementation plan match the actual root workspace state

The plan says to "add `build:sdk`" and "update the top-level `build` script (if present)." The current root [package.json](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/package.json:1) has no `scripts` section at all. The plan should specify the full intended root-script state rather than assume one exists.

### 5. Add one explicit verification step against real package exports

The docs are precise at symbol level, which is good, but the plan should require verification that the canonical facade list matches actual package exports in `packages/*/src/index.ts` before implementation closes. The spot checks I reviewed suggest the chosen symbols are mostly aligned, but the plan should make this a mandatory acceptance criterion rather than an implicit assumption.

## Strengths Worth Preserving

- The boundary/spec/plan/adoption-guide stack is coherent and intentionally layered.
- Excluding `routing`, `coordination`, `connectivity`, and blocked `memory` is the right call.
- Treating symbol-count growth as a governance smell is strong API discipline.
- The facade-as-entry-point while preserving direct imports for advanced users is the correct public model.

## Final Assessment

This proposal should move forward after a short documentation revision pass. The architecture is sound, the adoption benefit is real, and the Python parity direction is credible. The remaining issues are not reasons to abandon the facade; they are reasons to tighten the first public contract before implementation begins.

Recommended decision: revise the four documents, then implement immediately.

Artifact produced: [docs/architecture/top-level-sdk-facade-review-verdict.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/top-level-sdk-facade-review-verdict.md:1)

TOP_LEVEL_SDK_FACADE_REVIEW_COMPLETE
