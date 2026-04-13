# Runtime Primitive Review Verdict

**Date:** 2026-04-13  
**Reviewer:** runtime decomposition pass  
**Inputs:**
- `docs/architecture/v1-harness-boundary.md`
- `docs/specs/v1-harness-spec.md`
- `docs/architecture/v1-harness-review-verdict.md`
- `docs/architecture/v1-harness-implementation-review-verdict.md`
- `docs/architecture/package-boundary-map.md`
- `docs/current-state.md`
- `packages/harness/src/types.ts`
- `packages/harness/src/harness.ts`
- `packages/harness/README.md`
- `docs/architecture/agent-assistant-runtime-primitive-map.md`
- `docs/architecture/runtime-primitives-vs-product-intelligence.md`

---

## Verdict

**PASS — REFRAME REQUIRED**

The repository now has enough real implementation to stop talking about “the harness” as the broad runtime concept.

The harness package itself is valid and useful. The problem is the **umbrella framing** around the word.

The correct conclusion is:

> `@agent-assistant/harness` should remain the bounded turn executor, but the broader Agent Assistant runtime should be described as an explicit stack of primitives rather than as “the harness.”

That is a conceptual correction, not a rejection of the package.

---

## What this review found

### 1. The turn-execution primitive is real now
This repo no longer has a purely speculative harness idea.

`@agent-assistant/harness` is implemented and already owns a coherent bounded-turn slice:
- iterative model/tool/model execution
- sequential tool calls
- truthful outcomes and stop reasons
- continuation payloads
- trace sink lifecycle
- runtime limits and invalid-output handling

So the package is real.

### 2. The overloaded framing is still a problem
Even though the package boundary is good, the surrounding discussion still risks using “harness” to mean all of this at once:
- execution loop
- identity and character
- runtime enrichment
- approvals/policy
- context shaping
- assistant individuality
- product behavior

That is too much for one package concept.

### 3. The actual runtime stack is broader than harness
The runtime already depends on distinct primitives with distinct ownership:
- `core`
- `sessions`
- `surfaces`
- `harness`
- `routing`
- `policy`
- `traits`
- `memory` (blocked but specified)
- `connectivity` / `coordination`
- product-owned assembly and intelligence

The repo should name that stack explicitly.

---

## Key decomposition judgment

## Keep
- the package name `@agent-assistant/harness`
- the current narrow harness scope
- the current truthful stop/continuation/trace model

## Change
- stop using “harness” as shorthand for the whole runtime architecture
- stop letting identity/enrichment/product-intelligence concerns accumulate under harness language
- introduce the primitive map as the primary architecture reference for runtime decomposition

---

## Primitive status summary

| Primitive | Status | Judgment |
| --- | --- | --- |
| Runtime shell (`core`) | Implemented | Solid foundation |
| Sessions | Implemented | Clear ownership |
| Surfaces | Implemented | Clear ownership |
| Harness / bounded turn executor | Implemented | Good package, should stay narrow |
| Routing | Implemented | Separate primitive; do not fold into harness |
| Policy | Implemented | Separate primitive; keep approval seam external |
| Traits | Implemented | Useful identity base, but not full character composition |
| Memory | Spec ready / blocked | Needed, but not harness |
| Connectivity / coordination | Implemented | Runtime enrichment sources, not harness core |
| Turn-context / enrichment assembly seam | Missing | Main missing explicit primitive |
| Product intelligence | Product-owned | Must remain outside SDK packages |

---

## Recommended build order

1. **Keep the current base stack as the foundation**
   - `core`
   - `sessions`
   - `surfaces`

2. **Treat harness as the bounded turn layer on top of that base**
   - not as the runtime umbrella

3. **Use policy, routing, and traits as adjacent seams**
   - policy for action governance
   - routing for execution envelope selection
   - traits for stable assistant identity defaults

4. **Prioritize the missing context/enrichment seam next**
   - not because the SDK should own product intelligence
   - but because the stack needs a clearer reusable contract between memory/coordination/traits and `runTurn()`

5. **Keep product logic product-owned**
   - prompts
   - domain heuristics
   - tool inventories
   - UX behavior
   - commercial rules

---

## Does this change how “harness” should be thought about?

**Yes.**

Before this pass, “harness” could be read as:
- the broad assistant runtime
- the main place where individuality and intelligence live
- the bucket for any runtime capability that felt more advanced than `core`

After this pass, it should be read as:

> the bounded turn executor primitive inside the Agent Assistant runtime stack

That is a narrower and healthier definition.

---

## Recommended doc changes

### 1. Keep `v1-harness-boundary.md`, but demote its umbrella role
That doc should stay the package-boundary document for `@agent-assistant/harness`.
It should not implicitly serve as the master runtime architecture doc.

### 2. Use the new primitive map as the architecture anchor
`docs/architecture/agent-assistant-runtime-primitive-map.md` should be the first doc linked when discussing runtime decomposition.

### 3. Tighten wording around character/enrichment in harness docs
Current harness docs are right to warn against a prompt-only future, but the wording should emphasize:
- the runtime stack must support individuality
- the harness must remain compatible with that
- the harness does not itself own the whole individuality system

---

## Final judgment

The repo is in a good place technically.
The main needed change is conceptual clarity.

- **Do not undo the harness package.**
- **Do stop treating harness as the all-purpose runtime abstraction.**
- **Do describe Agent Assistant as an explicit stack of runtime primitives with product intelligence above it.**

**Final state:** `PASS — REFRAME REQUIRED`

RUNTIME_PRIMITIVE_REVIEW_COMPLETE
