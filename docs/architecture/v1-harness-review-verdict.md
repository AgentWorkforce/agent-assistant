# v1 Harness Review Verdict

**Date:** 2026-04-13
**Reviewer:** harness boundary/spec pass
**Inputs:**
- `docs/current-state.md`
- `docs/architecture/2026-04-11-relay-agent-assistant-architecture-draft.md`
- `docs/architecture/package-boundary-map.md`
- `docs/specs/v1-core-spec.md`
- `docs/specs/v1-sessions-spec.md`
- `docs/specs/v1-routing-spec.md`
- `docs/consumer/how-to-build-an-assistant.md`
- `docs/consumer/sage-adoption-path.md`
- `packages/core/README.md`
- `packages/sessions/README.md`
- `packages/coordination/README.md`
- `docs/architecture/v1-harness-boundary.md`
- `docs/specs/v1-harness-spec.md`

---

## Verdict

**BOUNDARY_APPROVED — IMPLEMENTATION_READY**

The proposed harness boundary is strong enough to drive implementation next.

Not because it solves "agents" in the abstract, but because it defines a narrow, commercially meaningful missing primitive:

> a bounded assistant-turn runtime with iterative tool use, clarification, continuation, telemetry, and truthful stop semantics.

That is a real product gap for assistants like Sage. The proposed package placement and scope control keep it from collapsing into either:
- a tiny toy single-shot helper, or
- an unbounded autonomous agent manifesto.

---

## 1. Why this boundary is strong

### A. The package placement is correct

Recommending **`@agent-assistant/harness` as a new package** is the right call.

If this work were pushed into `@agent-assistant/core`, core would stop being the thin composition root and would become the opinionated orchestration layer for the whole SDK. That would be a structural regression.

The current proposal keeps:
- `core` = assistant construction, lifecycle, dispatch, registry
- `harness` = bounded iterative turn execution

That separation is clean and durable.

### B. The scope is commercially meaningful without being sprawling

This is not a toy single-turn wrapper. It allows:
- multiple model/tool/model iterations inside one turn
- clarification instead of fake completion
- approval-blocked outcomes
- explicit deferred outcomes when limits are hit
- structured continuation payloads
- traceability

That is enough to be materially useful in a paid product.

At the same time, it deliberately excludes:
- background autonomy
- swarm orchestration
- memory-engine ownership
- long-horizon recursive planning
- product workflow engines

That honesty is the biggest strength of the proposal.

### C. The stop semantics are truthful

The outcome model is one of the strongest parts of the spec.

Separating:
- `completed`
- `needs_clarification`
- `awaiting_approval`
- `deferred`
- `failed`

prevents products from lying to themselves about what happened.

The explicit stop reasons are also specific enough to drive UX, telemetry, and debugging without becoming absurdly granular.

### D. The product seam is concrete, especially for Sage

The proposal does not wave vaguely at product integration. It defines a clean swap:

- current brittle one-shot planner/executor/synthesizer path
- replaced by `harness.runTurn(...)`
- product maps `HarnessResult` to user-visible behavior

That is concrete enough for implementation planning and consumer proof.

---

## 2. What keeps it bounded

The proposal draws the right hard lines.

### Explicitly bounded areas
- one bounded turn, not always-on autonomy
- product-managed continuation persistence, not a second memory system
- adapter-owned tools/approvals/trace sinks, not hard-coded backends
- optional composition with sessions/policy/routing, not mandatory deep coupling
- no direct takeover of coordination, memory, surfaces, or Workforce persona ownership

These lines matter. Without them, the harness would almost certainly metastasize into a general agent runtime layer.

---

## 3. Remaining caution areas

The boundary is strong, but implementation discipline will matter in three places.

### Caution 1: sequential vs. parallel tool execution

The spec currently leaves this as an open question. That is acceptable for now, but implementation should default to **sequential only** unless there is a compelling reason to widen scope. Parallel tool execution can quickly drag in additional complexity around ordering, budgets, and trace semantics.

### Caution 2: continuation payload size creep

The continuation rules are directionally correct, but this is the area most likely to sprawl. The implementation should keep continuation payloads small and inspectable. If the package starts serializing large hidden scratchpads or long raw transcript state, it will silently become a memory/runtime hybrid.

### Caution 3: policy integration pressure

`awaiting_approval` is correct for v1, but the harness must continue to treat approvals as an adapter seam. It should not absorb `@agent-assistant/policy` logic directly just because products will want an end-to-end path quickly.

None of these are blockers. They are implementation watchpoints.

---

## 4. Decision on implementation readiness

**Yes — implementation should proceed next.**

Why:
- the missing primitive is real
- the package placement is coherent
- the scope/non-goals are explicit
- the outcome model is product-credible
- the loop behavior is bounded
- the Sage integration seam is concrete
- the Definition of Done is specific enough to hold implementation accountable

What would make it no longer implementation-ready:
- adding multi-agent delegation into the initial slice
- making continuation a hidden persistence/memory system
- pushing this into `core`
- treating bounded deferrals as success

As currently written, the boundary avoids those traps.

---

## 5. Final judgment

The proposed harness boundary is **good enough to implement now**.

It fills an actual product/runtime gap, stays honest about non-goals, and preserves the repo's package architecture instead of flattening everything into `core` or exploding into a vague autonomy platform.

**Final state:** `BOUNDARY_APPROVED`

V1_HARNESS_REVIEW_COMPLETE
