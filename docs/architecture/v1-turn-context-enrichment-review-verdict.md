# v1 Turn-Context / Enrichment Review Verdict

**Date:** 2026-04-13
**Subject:** Is the missing turn-context / enrichment primitive now defined well enough to guide implementation later?

## Verdict

**Yes — implementation-ready at the architecture/spec level.**

The missing primitive is now defined clearly enough to guide a future package implementation without collapsing back into harness or drifting into vague product-language.

## What is now clear

### 1. The primitive has a concrete home

The recommended package is:

- **`@agent-assistant/turn-context`**

That resolves the prior ambiguity where the need was recognized but had no package boundary.

### 2. The primitive has a concrete job

It owns:
- turn-scoped assembly of effective assistant character + context
- composition of stable identity, product shaping, and runtime enrichment
- provenance-carrying prepared context for the visible assistant
- projection into harness-ready inputs

It does **not** own:
- harness execution
- memory retrieval/storage
- policy decisions
- coordination/orchestration
- product business logic

That ownership split is clean.

### 3. The relationship to adjacent packages is explicit

The definition now states plainly that:
- `traits` = stable identity defaults
- `turn-context` = turn-scoped composition layer
- `harness` = bounded turn executor

That is the key decomposition Khaliq was aiming for.

### 4. The identity vs enrichment rule is strong enough

The spec makes the critical rule explicit:

> runtime enrichment informs turn expression; it does not replace assistant identity

That rule is important enough to preserve assistant uniqueness across Sage, MSD, NightCTO, and future products.

### 5. The output is implementation-driving rather than poetic

The spec defines:
- typed inputs
- typed outputs
- harness projection
- provenance
- optional adapter seams
- implementation definition of done

That is enough to start a real package later.

## Remaining future decisions

These are still open, but they do **not** block implementation planning:

1. **Factory surface details**
   - whether the first implementation exposes only one `createTurnContextAssembler(...)` factory or also projector/composer helpers

2. **Dependency direction details**
   - whether the package imports harness types directly for projection or mirrors minimal projection types to avoid a hard runtime dependency

3. **How much generic logic ships in v1**
   - whether the package provides only the contract + a thin default assembler, or also includes reusable projectors for memory/enrichment inputs

4. **Prompt-segment rendering strategy**
   - whether `TurnInstructionBundle` remains segmented all the way to the model adapter or is rendered to strings during harness projection

These are implementation-shape questions, not architecture-boundary questions.

## Recommendation

Treat this primitive as the **next missing runtime seam** in the Agent Assistant stack.

Do not put this work back into:
- harness docs
- ad hoc product glue
- traits expansion

The current docs are sufficient to justify a future package plan and implementation workflow.

## Final judgment

**Approved as implementation-ready documentation.**

The primitive is now bounded, named, scoped, and connected to the rest of the runtime stack clearly enough to guide follow-on implementation work.
