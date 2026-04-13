# v1 Turn-Context — Implementation Review Verdict

Date: 2026-04-13
Subject: Is the v1 turn-context implementation boundary strong enough to implement next?
Reviewed artifact: `docs/architecture/v1-turn-context-implementation-boundary.md`
Supporting references:
- `docs/architecture/v1-turn-context-enrichment-boundary.md`
- `docs/specs/v1-turn-context-enrichment-spec.md`
- `docs/architecture/agent-assistant-runtime-primitive-map.md`
- `docs/specs/v1-harness-spec.md`

---

## Verdict

**PASS — ready to implement next.**

The implementation boundary is now tight enough to drive the first package pass without collapsing into harness, traits, memory, or product glue.

This boundary is materially stronger than the earlier architecture/spec docs because it does not stop at naming the primitive. It now fixes the first real milestone to:
- one primary assembler factory
- required identity + shaping inputs
- specific required outputs
- bounded resolution logic
- an explicit out-of-scope list
- a concrete later proof path through harness
- an expected first package/file layout

That is enough to start implementation work without forcing the coding pass to re-litigate scope.

---

## What is strong enough now

### 1. The minimum useful product slice is clear

The strongest choice in the boundary is that v1 is defined as:

> deterministic turn assembly that can feed harness directly

That keeps the milestone useful to a real product while preventing it from becoming a giant “assistant intelligence” subsystem.

### 2. Required vs optional inputs are finally concrete

The boundary correctly tightens the earlier broad spec by making these required in v1:
- `assistantId`
- `turnId`
- `identity`
- `shaping`
- `identity.baseInstructions` with at least one prompt field present

That is the right minimum. Without required base instructions and explicit shaping, the implementation would drift back toward a loose bag of optional fields with no clear assembly contract.

### 3. The output contract is implementation-driving

The required outputs are the right set:
- effective identity
- effective behavior / expression
- prepared context
- harness projection
- lightweight provenance

This is exactly the bundle needed to prove that turn-context is a real primitive above harness rather than just a prompt helper.

### 4. The included priority logic is bounded

The resolution rules are strong enough because they include only what v1 genuinely needs:
- layer order
- identity floor preservation
- deterministic instruction ordering
- shallow expression override behavior
- simple candidate projection rules

That is enough for coherent behavior and tests. It avoids overcommitting to a heavy conflict-resolution engine too early.

### 5. The deferrals are disciplined

The out-of-scope list is especially important here. It clearly defers:
- product intelligence
- memory retrieval/ranking engines
- specialist orchestration
- policy decisions
- advanced prompt rendering systems
- broad public sub-surfaces

That is the difference between a buildable v1 and another architecture-shaped hole.

### 6. The later proving path is the right one

The boundary does not pretend unit tests are sufficient proof.
It correctly says the real validation path is:
- assemble once
- pass `assembly.harnessProjection` directly into harness
- prove the visible assistant turn still preserves identity while consuming shaping/enrichment

That is the exact downstream contract this package exists to enable.

---

## Remaining cautions for the implementation pass

These are not blockers, but they should be watched carefully during coding.

### Caution 1 — keep required-input validation simple

The boundary is right to require `identity.baseInstructions`, but the implementation should avoid inventing a large validation framework unless the package actually needs it. A small local validation helper is enough for v1.

### Caution 2 — do not over-extract internal helpers on day one

The boundary allows optional projector/composer hooks. That is fine, but implementation should not feel obligated to build a public micro-framework immediately. The default assembler matters more than elegant internal decomposition in the first pass.

### Caution 3 — avoid deep natural-language guardrail logic

The expression downgrade examples are good, but the coding pass should keep them narrow and deterministic. Once the package starts parsing rich rule text into a generalized constraint engine, it is already leaving the boundary.

### Caution 4 — keep provenance lightweight

The current provenance shape is intentionally small. Do not let the implementation grow a trace subsystem or explain-every-decision audit layer. Harness already owns turn execution trace; turn-context only needs inspectable assembly provenance.

---

## Final judgment

The implementation boundary is strong enough to proceed.

It gives the next implementation workflow clear answers to the important questions:
- what v1 must accept
- what v1 must return
- what composition logic is in scope
- what stays out
- what package/files to create
- how the result must later be proven in a real harness-backed consumer path

Recommendation: implement `@agent-assistant/turn-context` next using this boundary as the controlling scope document.

V1_TURN_CONTEXT_IMPLEMENTATION_REVIEW_COMPLETE
