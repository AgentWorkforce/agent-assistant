# v1 Continuation / Follow-Up Boundary

**Date:** 2026-04-13
**Proposed package:** `@agent-assistant/continuation`
**Purpose:** Define the missing runtime primitive that turns deferred assistant outcomes into explicit resumable state and real follow-up delivery, without collapsing that responsibility into harness, sessions, memory, or proactive.

---

## 1. Why this boundary exists

The current runtime map correctly narrowed `@agent-assistant/harness` to the bounded turn executor and `@agent-assistant/turn-context` to turn-scoped assembly.

That leaves one missing runtime seam:

> When a bounded turn cannot complete now but should continue later, what owns the resumable state, the trigger that wakes it back up, and the actual delivery of the follow-up?

Right now the harness can stop honestly with continuation-shaped outcomes, but that still leaves products to hand-roll the hard part:
- persisting resumable turn state
- correlating the next trigger back to the stopped turn
- deciding whether the continuation is still alive
- preventing zombie follow-ups after the user already moved on
- delivering the eventual follow-up back to the correct attached surface(s)

This is exactly the gap exposed by Sage-style behavior such as:
- “let me dig in”
- “I’ll check and follow up”
- “waiting on approval”
- “I need your answer before I continue”

Without a first-class primitive, those statements are often only wording. The runtime has no explicit object representing “there is an unfinished assistant outcome that may resume later.”

The missing capability is **not** general autonomy.
It is a narrower, product-useful runtime contract:

> A bounded continuation primitive that stores resumable turn state, accepts explicit resume triggers, and delivers follow-up output through normal assistant surfaces.

---

## 2. Primitive definition

## Recommended name

**Continuation**

“Follow-up” is the user-visible behavior.
“Continuation” is the runtime primitive.

Recommended package name:

**`@agent-assistant/continuation`**

This package should own the lifecycle of a stopped-but-resumable assistant turn.

It sits:
- **below** product UX and business rules
- **beside** sessions, surfaces, policy, memory, and proactive
- **downstream of** harness outcomes
- **upstream of** resumed harness invocations and delivered follow-up messages

---

## 3. What this primitive owns

`@agent-assistant/continuation` should own:

1. **Continuation record lifecycle**
   - create a continuation record from a resumable harness outcome
   - load/update/stop/expire that record
   - prevent duplicate or contradictory resumes

2. **Resumable state contract**
   - compact persisted state needed to resume later
   - correlation to assistant/session/thread/turn
   - resume preconditions and trigger type
   - TTL / expiry / stop metadata

3. **Resume trigger handling**
   - accept explicit resume events such as:
     - user clarification reply
     - approval decision
     - external completion callback
     - bounded scheduled wake-up created for this continuation
   - validate that the trigger matches what the continuation is waiting for

4. **Continuation-to-turn re-entry**
   - turn a live continuation record plus a resume trigger into a new bounded assistant turn input
   - pass the persisted continuation payload back into `@agent-assistant/harness`

5. **Follow-up delivery contract**
   - represent where a resumed outcome should be delivered
   - hand the final follow-up payload to product/runtime delivery seams using `@agent-assistant/surfaces`
   - mark delivery state so products can reason about sent / suppressed / expired / cancelled follow-ups

6. **Bounding and liveness rules**
   - TTL
   - max resume attempts
   - terminal stop reasons
   - stale-session / superseded continuation handling

## What it does not own

- model/tool execution loop (`@agent-assistant/harness`)
- turn-scoped identity/context assembly (`@agent-assistant/turn-context`)
- session identity/lifecycle (`@agent-assistant/sessions`)
- outbound transport formatting/delivery implementation (`@agent-assistant/surfaces`)
- action-governance decisions (`@agent-assistant/policy`)
- long-term memory storage/retrieval (`@agent-assistant/memory`)
- generic scheduled nudges/watchers with no originating stopped turn (`@agent-assistant/proactive`)
- product domain/business heuristics
- open-ended autonomous planning

---

## 4. Placement recommendation

## Recommendation

Create a **new package**:

**`@agent-assistant/continuation`**

Do **not** fold this into:
- `@agent-assistant/harness`
- `@agent-assistant/sessions`
- `@agent-assistant/proactive`
- `@agent-assistant/memory`

## Why not `harness`

Harness owns one bounded turn.
Continuation owns what happens **after that turn returns** when the outcome is resumable.

If continuation stays inside harness, harness becomes overloaded again with:
- persistence
- trigger correlation
- delayed re-entry
- follow-up delivery state

That is outside “one bounded turn.”

Harness should emit a resumable outcome and continuation payload.
Continuation should own the lifecycle that begins after that stop.

## Why not `sessions`

Sessions own conversation continuity at the assistant/session level.
A continuation is more specific:
- it is tied to one unfinished turn lineage
- it has a waiting condition
- it has expiry and delivery semantics
- many sessions will have zero live continuations

A session may reference active continuations, but it should not become the continuation engine.

## Why not `proactive`

Proactive originates new assistant actions from scheduled rules or watch conditions.
Continuation resumes a **previously started** bounded turn.

The distinction is critical:
- proactive: “assistant should initiate something now”
- continuation: “assistant has unfinished work from an earlier turn and may resume it now”

A continuation may use a scheduled wake-up as one trigger type, but that does not make it proactive.

## Why not `memory`

Memory stores facts and retrieval material.
Continuation stores resumable workflow state for one unfinished assistant outcome.
That state is operational, short-lived, and terminal.
It should not be treated as generic memory.

---

## 5. Relationship to adjacent runtime primitives

## Harness

Harness remains the source of resumable outcomes.
It owns:
- stop semantics
- continuation payload shape for one bounded turn
- truthful outcomes like `needs_clarification`, `awaiting_approval`, and `deferred`

Continuation owns:
- persisting that payload as live runtime state
- deciding whether it is still resumable
- re-entering harness with the right resume trigger
- delivery bookkeeping for the follow-up

Rule:

> Harness emits resumable outcomes. Continuation operationalizes them.

## Turn-context

Turn-context assembles the effective assistant identity/context for the resumed turn.
Continuation may pass along:
- original context references
- continuation metadata
- resume trigger details

But continuation does not decide the assistant’s effective voice or context for the resumed turn.
That remains turn-context + product shaping.

## Sessions

Sessions continue to own:
- session identity
- attachment to threads/surfaces
- assistant/user continuity metadata

Continuation records must reference session ids, but session state is not enough by itself to represent:
- what the runtime is waiting on
- when it expires
- whether it already resumed
- whether follow-up was delivered

## Surfaces

Surfaces remain the delivery abstraction.
Continuation should not implement transport adapters.
Instead it should carry a normalized delivery target / policy and use surfaces for actual emit/fanout.

Rule:

> Continuation decides that a follow-up should be delivered. Surfaces decide how delivery happens on attached channels.

## Policy

Policy decides whether an action requires approval and what the approval outcome means.
Continuation should only own:
- waiting for the approval result
- correlating the approval decision back to the pending turn
- resuming or stopping once the decision arrives

Continuation must not classify risk or decide approval rules.

## Memory

Memory may inform the resumed turn like any other turn.
Continuation is not a memory store.
It stores only short-lived operational state required to resume one unfinished turn lineage.

## Proactive

Proactive handles wake-ups that do not originate from a live unfinished turn.
Continuation handles wake-ups that belong to a specific pending continuation.

A useful rule is:

- if there is no originating stopped turn id, it is not continuation
- if the assistant is resuming a known unfinished turn lineage, it is continuation

---

## 6. v1 in-scope continuation cases

V1 should stay narrow and useful.

## In scope

### 1. Clarification continuation

Flow:
- harness stops with `needs_clarification`
- continuation record is created with wait condition `user_reply`
- next matching user reply resumes the turn with the prior continuation payload attached

### 2. Approval continuation

Flow:
- harness stops with `awaiting_approval`
- continuation record is created with wait condition `approval_resolution`
- product/policy later submits `approved` or `denied`
- continuation resumes or terminates accordingly

### 3. External async completion continuation

Flow:
- harness stops with `deferred` because a bounded external process is still pending
- continuation record is created with wait condition `external_result`
- integration callback / webhook / local completion event resumes the turn
- follow-up is delivered into the originating session/thread

### 4. Bounded scheduled resume tied to one continuation

Flow:
- harness stops with `deferred`
- continuation requests a one-off wake-up associated with that specific continuation
- wake-up re-enters only if the continuation is still live and not superseded

This is allowed because it is still about one unfinished turn lineage, not general proactive monitoring.

## Out of scope

- ongoing watch rules that repeatedly inspect the world with no originating stopped turn
- generic reminders unrelated to a pending assistant outcome
- recursive delegation chains
- multi-day autonomous task management
- multiple independent branches from one continuation in v1
- hidden retries that repeatedly act without user-visible state

---

## 7. State model

V1 needs one explicit persisted object.

## Recommended record shape

```ts
interface ContinuationRecord {
  id: string;
  assistantId: string;
  sessionId?: string;
  threadId?: string;
  userId?: string;

  origin: {
    turnId: string;
    outcome: 'needs_clarification' | 'awaiting_approval' | 'deferred';
    stopReason: string;
    createdAt: string;
  };

  status:
    | 'pending'
    | 'resuming'
    | 'completed'
    | 'cancelled'
    | 'expired'
    | 'superseded'
    | 'failed';

  waitFor:
    | { type: 'user_reply'; correlationKey?: string }
    | { type: 'approval_resolution'; approvalId: string }
    | { type: 'external_result'; operationId: string }
    | { type: 'scheduled_wake'; wakeUpId?: string };

  continuation: HarnessContinuation;

  delivery: {
    surfaceIds?: string[];
    fanoutMode?: 'originating_surface' | 'attached_surfaces' | 'product_defined';
    suppressIfSessionReengaged?: boolean;
    lastDeliveryAttemptAt?: string;
    deliveredAt?: string;
  };

  bounds: {
    expiresAt: string;
    maxResumeAttempts: number;
    resumeAttempts: number;
  };

  metadata?: Record<string, unknown>;
}
```

## State model rules

- exactly one live pending record per continuation id
- record must be inspectable and serializable
- record must stay compact; no giant transcript blobs as the main persistence strategy
- persisted continuation payload should be enough to resume truthfully, not enough to become a shadow memory system

---

## 8. Resumption model

Resumption must be explicit and bounded.

## Canonical v1 model

1. A resumable harness result is received.
2. Product/runtime asks `@agent-assistant/continuation` to create a record.
3. Later, an explicit resume trigger arrives.
4. Continuation loads the record and validates:
   - record still pending
   - not expired
   - trigger matches `waitFor`
   - not superseded by newer state
   - resume-attempt limit not exceeded
5. Continuation builds a resumed turn input.
6. Turn-context assembles the new turn-scoped input if needed.
7. Harness runs one new bounded turn with:
   - new turn id
   - original session/thread linkage
   - prior `HarnessContinuation`
   - resume-trigger payload projected as current turn input
8. Continuation updates status based on the resumed outcome.

## Resume trigger types in v1

```ts
type ContinuationResumeTrigger =
  | {
      type: 'user_reply';
      message: HarnessUserMessage;
      receivedAt: string;
    }
  | {
      type: 'approval_resolution';
      approvalId: string;
      decision: 'approved' | 'denied';
      resolvedAt: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'external_result';
      operationId: string;
      resolvedAt: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: 'scheduled_wake';
      wakeUpId?: string;
      firedAt: string;
    };
```

## Important rule

A resumed continuation always becomes a **new bounded turn**, not an in-place unbounded extension of the old turn.

That preserves the harness contract and keeps traceability honest.

---

## 9. Follow-up delivery model

The continuation primitive must make follow-up delivery explicit.

## What delivery means here

Delivery is the act of emitting the user-visible result of a resumed continuation back into the appropriate conversation context.

That includes:
- selecting the target session/thread/surface attachment
- applying suppression rules if the continuation should no longer speak
- recording whether the follow-up was sent, skipped, or blocked

## Recommended v1 delivery states

- `pending_delivery`
- `delivered`
- `suppressed_session_reengaged`
- `suppressed_superseded`
- `suppressed_expired`
- `delivery_failed`

## Delivery policy rules for v1

### Rule 1 — follow-up belongs to the originating conversation

By default, a continuation follow-up should return to the same session/thread lineage that created it.

### Rule 2 — user re-engagement may suppress stale follow-ups

For some continuation types, if the user already continued the conversation in a way that makes the pending follow-up stale, delivery should be suppressible.

Examples:
- a clarification continuation is naturally consumed by the user reply that resumes it
- an external async result may be suppressed if the user explicitly cancelled the request or the session moved on

### Rule 3 — follow-up delivery should use normal surfaces

Continuation should not invent a side-channel.
It should emit via existing assistant delivery paths so products keep one transport story.

### Rule 4 — delivery is terminally recorded

Whether delivered or suppressed, the continuation record should reflect what happened so products can debug missing follow-ups truthfully.

---

## 10. Bounding rules, TTL, and stop reasons

This primitive must stay bounded.

## Required v1 bounds

### TTL
Every continuation record must have `expiresAt`.
No immortal continuation records.

Suggested defaults by type:
- clarification: short TTL
- approval: medium TTL
- external async completion: explicit product-supplied TTL
- scheduled wake: short TTL tied to that wake-up purpose

The package should expose TTL configuration, but products must choose consciously.

### Max resume attempts
Each continuation record must cap how many resume attempts are allowed.
This prevents infinite churn on broken callbacks or invalid resumes.

### One-live-lineage rule
If a newer product decision or resumed outcome makes an older continuation obsolete, the older one must move to `superseded`.

### No silent forever-pending state
The runtime must be able to stop a continuation with a terminal reason.

## Required terminal stop reasons

At minimum, continuation should distinguish:
- `completed`
- `cancelled_by_user`
- `cancelled_by_product`
- `expired_ttl`
- `superseded_by_newer_turn`
- `approval_denied`
- `invalid_resume_trigger`
- `max_resume_attempts_reached`
- `resume_runtime_error`
- `delivery_failed`
- `session_no_longer_deliverable`

These are continuation stop reasons, distinct from harness stop reasons.

---

## 11. Explicit non-goals

This package is **not**:

- a long-running autonomous task system
- a background worker fleet
- a durable memory layer
- a replacement for proactive reminders/watchers
- a policy engine
- a scheduler abstraction for all assistant jobs
- a workflow engine for arbitrary business processes
- a hidden retry engine that keeps talking without user awareness
- a generic event bus

It also should not promise:
- arbitrary continuation graphs in v1
- resume-from-anything semantics
- cross-product orchestration
- indefinite self-revival

---

## 12. Definition of done for a useful v1

A useful v1 is done when the repo has:

1. **A dedicated boundary and spec**
   - `@agent-assistant/continuation` clearly defined

2. **A typed continuation record model**
   - origin linkage
   - wait condition
   - continuation payload
   - delivery target/state
   - bounds and terminal status

3. **A typed create/resume/stop contract**
   - create from harness result
   - resume from explicit trigger
   - stop/expire/supersede truthfully

4. **A clean harness relationship**
   - harness emits resumable outcomes
   - continuation owns post-stop lifecycle
   - resumed work always re-enters as a new bounded turn

5. **A clean proactive relationship**
   - scheduled resume for one continuation is allowed
   - generic watches/reminders remain proactive-owned

6. **A follow-up delivery contract**
   - normal surface delivery
   - inspectable sent/suppressed/failed state

7. **Strong non-goals**
   - no drift into autonomy or workflow-platform sprawl

8. **Implementation-ready semantics**
   - enough clarity that a package can be built without reopening ownership questions

---

## 13. Final recommendation

The missing primitive should now be treated explicitly as:

> **`@agent-assistant/continuation` — the bounded runtime primitive that turns resumable harness outcomes into explicit state, validated resume triggers, and real follow-up delivery.**

That keeps the runtime stack clean:
- harness executes one turn
- turn-context assembles one turn
- continuation owns unfinished-turn lifecycle
- proactive owns independent assistant-initiated wake-ups
- memory owns durable facts
- policy owns governance
- surfaces own transport delivery

V1_CONTINUATION_BOUNDARY_READY
