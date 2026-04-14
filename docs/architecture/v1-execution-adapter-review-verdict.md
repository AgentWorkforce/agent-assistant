# v1 Execution Adapter Review Verdict

**Subject:** Is the BYOH / execution-harness adapter boundary now concrete enough to guide implementation without blurring product, Relay, and execution concerns?  
**Date:** 2026-04-14  
**Verdict:** **PASS_WITH_BOUNDARY_CAUTION**

---

## 1. What was reviewed

Reviewed artifacts:
- `docs/architecture/agent-assistant-runtime-primitive-map.md`
- `docs/architecture/package-boundary-map.md`
- `docs/architecture/v1-turn-context-implementation-boundary.md`
- `docs/specs/v1-harness-spec.md`
- `docs/specs/v1-continuation-spec.md`
- `docs/architecture/v1-execution-adapter-boundary.md`
- `docs/specs/v1-execution-adapter-spec.md`

---

## 2. Verdict summary

The missing BYOH seam is now explicit enough to be useful.

The new boundary correctly defines the execution adapter as:
- a **translation and normalization seam**
- below product/runtime intent
- above concrete execution backends
- outside policy, continuation, sessions, and Relay coordination ownership

That is the right shape.

The strongest decision is also the most important one:

> **Do not publish a standalone execution-adapter package yet.**

That keeps the contract implementable without prematurely freezing a public API before the first-party harness path and at least one real external-harness path have both been proven.

---

## 3. What the boundary gets right

### 3.1 Product identity stays canonical

The docs are clear that the adapter receives a post-assembly request.
It does not own:
- identity composition
- tone
- product heuristics
- guardrail authoring

That prevents the common BYOH failure mode where a provider runtime becomes the real assistant.

### 3.2 Relay stays central

The boundary treats external harnesses as execution planes inside a larger Relay-native runtime, not as replacements for:
- coordination
- shared context exchange
- file flows
- auth boundaries
- scheduling and wake-ups

That preserves the product differentiator instead of flattening it.

### 3.3 Policy / continuation / sessions ownership is clean

The contract is especially clear that:
- policy remains a separate governance layer
- continuation remains the resumable lifecycle owner
- sessions remain the cross-surface continuity owner

This is the correct split.

### 3.4 Capability negotiation is treated as first-class

This is necessary for real BYOH support.
The spec does not assume that every backend can do:
- iterative tools
- structured continuation
- approval interrupts
- deep traces

Instead it makes support, degradation, and blocking explicit.
That is implementation-friendly and honest.

---

## 4. Boundary caution

The main caution is naming and scope pressure.

Once implemented, there will be temptation to let the adapter absorb more and more runtime behavior, especially:
- tool execution policy
- approval orchestration
- continuation persistence shortcuts
- product-specific request shaping
- backend-specific “smart” retries or rerouting

That would be a mistake.

The adapter layer remains healthy only if it stays inside this sentence:

> **The execution adapter translates a canonical bounded request into one backend, reports capabilities honestly, and normalizes the result back into Agent Assistant runtime semantics.**

If it starts deciding:
- what policy means
- how the assistant should sound
- how resumability is persisted
- how sessions evolve
- how Relay collaboration is orchestrated

then the boundary has already failed.

---

## 5. Package recommendation

### Recommendation

**No public package yet.**

### Why this is the correct call

Because the design is implementation-ready as a contract, but not yet maturity-ready as a public package surface.

A public package should wait for:
1. first-party harness adapter proof
2. at least one external harness adapter proof
3. confirmed negotiation/degradation semantics from real usage
4. evidence that the contract belongs in a reusable package rather than assembly-local runtime glue

Until then, the docs should be treated as the source of truth.

---

## 6. Implementation readiness judgment

### Judgment: **Yes, implementation-ready as an internal/runtime contract**

This is now concrete enough to guide implementation because it defines:
- the purpose of the layer
- canonical ownership boundaries
- request / capability / negotiation / result shapes
- adjacent-package responsibilities
- explicit non-goals
- a bounded v1 DoD

### Not yet ready for

- public npm publication
- widespread downstream adoption as a frozen stable package API
- ambitious adapter-managed orchestration patterns

That is an acceptable and healthy outcome for v1.

---

## 7. Follow-ups recommended before or during implementation

1. **Prove the first-party harness path through the adapter contract**
   - this is the fastest way to test whether the contract is truly neutral

2. **Implement one intentionally limited external adapter**
   - preferably one that lacks at least one major semantic, so degradation paths are exercised

3. **Add one product-assembly proof**
   - demonstrate that product code can choose a backend, inspect negotiation, and branch without provider-specific sprawl

4. **Resist package extraction until the above is done**
   - otherwise the repo will freeze abstractions too early

---

## 8. Final verdict

The BYOH gap identified by the runtime primitive map is now closed at the documentation level.

The new execution adapter boundary is:
- concrete
- bounded
- aligned with the runtime primitive map
- respectful of Relay-native coordination
- protective of product identity
- explicit about degradation

That is enough to begin implementation carefully.

**Final verdict:**
- **Boundary quality:** PASS
- **Ownership clarity:** PASS
- **Relay-centrality preservation:** PASS
- **Package extraction now:** NO
- **Implementation-ready:** YES, as an internal/runtime contract
