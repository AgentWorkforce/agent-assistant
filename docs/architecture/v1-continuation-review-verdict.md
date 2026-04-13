# v1 Continuation Review Verdict

**Date:** 2026-04-13
**Subject:** Missing continuation / follow-up primitive in the Agent Assistant runtime map
**Verdict:** `@agent-assistant/continuation` should be added as a new first-class runtime primitive. The boundary is coherent, distinct from harness/proactive/sessions, and implementation-ready for a bounded v1.

---

## 1. Review question

Does the current runtime decomposition still have a missing primitive after narrowing harness to one bounded turn and introducing turn-context as the turn assembly seam?

## Answer

Yes.

The missing primitive is the post-stop runtime lifecycle for resumable assistant outcomes.

Current packages leave a real gap between:
- harness honestly saying “this turn is not done yet but may continue later”, and
- the runtime actually preserving that unfinished state and delivering the later follow-up.

That gap is large enough to deserve its own primitive.

---

## 2. Why this is a real runtime primitive, not wording cleanup

The Sage failure mode is not only messaging polish.
It is a capability gap.

If an assistant says:
- “I’ll follow up”
- “let me dig in”
- “waiting on approval”

then the runtime needs a real object that answers:
- what exactly is pending?
- what event will resume it?
- how long is it valid?
- where will the follow-up go?
- what stops it from becoming stale or zombie state?

Neither better prompts nor stricter harness wording solves that.

---

## 3. Boundary verdict

## Recommended package

**`@agent-assistant/continuation`**

## Why this placement is correct

- **not harness:** continuation begins after the bounded turn returns
- **not sessions:** continuation is finer-grained than conversation continuity
- **not proactive:** continuation resumes an existing pending outcome rather than originating a fresh initiative
- **not memory:** continuation state is operational and short-lived, not durable knowledge

This is a clean missing primitive in the runtime stack.

---

## 4. Ownership verdict

## It should own

- continuation record lifecycle
- wait conditions and resume triggers
- TTL / resume-attempt bounds
- resumed-turn re-entry contract
- follow-up delivery state
- continuation-specific terminal reasons

## It should not own

- turn execution
- turn-context assembly
- approvals policy
- durable memory
- generic reminders/watch rules
- transport implementations
- long-running autonomy

This ownership line is crisp enough to build against.

---

## 5. Relationship verdicts

### Harness relationship

Healthy and necessary.

Harness emits resumable outcomes.
Continuation owns what happens next.
Resumes always come back as new bounded turns.

### Turn-context relationship

Healthy.

Continuation does not shape the assistant’s identity or prompt stack.
It simply carries resume metadata into the next turn assembly path.

### Sessions relationship

Healthy if sessions remain referential only.

Sessions can point to active continuations, but should not absorb continuation lifecycle logic.

### Surfaces relationship

Healthy if continuation owns delivery intent/status but not transport mechanics.

### Policy relationship

Healthy if policy owns approval meaning and continuation only waits for the approval result.

### Proactive relationship

This distinction is the most important and is now sufficiently clear:
- proactive = independent assistant-initiated wake-up
- continuation = resumption of a known unfinished turn lineage

That boundary prevents category collapse.

---

## 6. Scope verdict

The proposed v1 scope is appropriately bounded and useful.

## Good v1 inclusions

- clarification continuation
- approval continuation
- external async completion continuation
- one-off scheduled wake tied to one live continuation

## Correct v1 exclusions

- general reminders
- watch rules
- multi-branch workflow graphs
- indefinite autonomy
- hidden repeated retries

This is small enough to implement and meaningful enough to fix the real product gap.

---

## 7. Design risks and mitigations

### Risk 1 — accidentally rebuilding proactive inside continuation

**Mitigation:** require an originating stopped turn lineage for all live continuation records.

### Risk 2 — accidentally rebuilding memory inside continuation

**Mitigation:** keep record shape compact and operational; no transcript/blob-heavy persistence as the primary model.

### Risk 3 — accidentally rebuilding harness outside harness

**Mitigation:** resumes must always invoke a new bounded harness turn rather than extending execution invisibly.

### Risk 4 — stale or zombie follow-ups

**Mitigation:** TTL, supersession, user-reengagement suppression, and terminal delivery statuses are mandatory.

---

## 8. Implementation readiness verdict

**Verdict:** implementation-ready.

Why:
- package placement is clear
- ownership boundary is clear
- v1 state model is clear
- v1 trigger model is clear
- v1 delivery model is clear
- v1 non-goals are strong enough to prevent sprawl

The remaining work is implementation and one realistic consumer proof, not additional architecture discovery.

---

## 9. Recommendation to the runtime map

The runtime primitive map should be updated conceptually to include:

- runtime shell
- sessions
- surfaces
- harness
- routing
- policy
- memory
- traits
- turn-context
- **continuation**
- connectivity / coordination
- proactive
- product intelligence

That gives deferred outcomes an explicit home instead of leaving them half-owned by harness and half-owned by ad hoc product code.

---

## 10. Final verdict

The missing primitive is real.
It should be named explicitly.
It should be implemented as:

> **`@agent-assistant/continuation` — the bounded runtime primitive for resumable turn state and follow-up delivery.**

VERDICT: ADD_CONTINUATION_PRIMITIVE
