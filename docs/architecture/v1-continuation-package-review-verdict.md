# v1 Continuation Package Review Verdict

**Date:** 2026-04-13
**Package reviewed:** `@agent-assistant/continuation`
**Artifacts reviewed:**
- `docs/architecture/v1-continuation-boundary.md`
- `docs/specs/v1-continuation-spec.md`
- `docs/architecture/v1-continuation-implementation-plan.md`
- `packages/continuation/**`
- validation output for `build`, `test`, and packaged tarball

## Verdict

**PASS_WITH_FOLLOWUPS**

The package is directionally correct and should be considered a successful first extraction of the continuation primitive. It stays mostly inside the intended boundary, exposes a usable runtime contract, and has a solid first-pass test matrix for create/resume/stop/liveness behavior.

I am not calling this a clean `PASS` because two v1 gaps are material:
- scheduled wakes are not fully correlated or time-expressive enough for product use
- delivery semantics are narrower than the spec, so the runtime cannot truthfully persist suppression outcomes coming back from delivery

Neither issue means the package is mis-scoped or unusable. Both do mean the contract is not yet as product-hardened as the design docs claim.

## Findings

### 1. Scheduled wake correlation is incomplete

`ContinuationWaitCondition` and `ContinuationResumeTrigger` both carry an optional `wakeUpId`, which implies scheduled wakes can be correlated to a specific issued wake token ([packages/continuation/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/types.ts:39), [packages/continuation/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/types.ts:67)). The runtime persists a scheduler-returned `wakeUpId` onto the record ([packages/continuation/src/continuation.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/continuation.ts:286)), but `validateTrigger()` never checks it ([packages/continuation/src/continuation.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/continuation.ts:335)). Any `scheduled_wake` trigger can therefore resume any scheduled continuation, even if it came from the wrong wake source.

This is a real correctness gap for the one trigger type that depends on scheduler correlation. It also is not covered by tests; the suite exercises scheduled wake success, wrong trigger type, and expiry, but not mismatched wake ids ([packages/continuation/src/continuation.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/continuation.test.ts:676)).

### 2. Scheduled wake timing is under-specified in the implementation

The implementation only supports `metadata.scheduledWake: true` as a boolean selector ([packages/continuation/src/continuation.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/continuation.ts:139)), then schedules the wake at `bounds.expiresAt` ([packages/continuation/src/continuation.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/continuation.ts:289)). That conflates "when to wake" with "when to expire".

For a real product, those are different controls. A continuation commonly needs "wake me in 10 minutes, expire in 24 hours". The current API cannot express that. This does not break the boundedness of the package, but it does limit the practical usefulness of the `scheduled_wake` branch relative to the spec’s stated intent.

### 3. Delivery contract is weaker than the design contract

The spec defines delivery as a statusful contract that can return `delivered`, `suppressed_session_reengaged`, `suppressed_superseded`, `suppressed_expired`, or `delivery_failed`. The package types reduce that to `{ delivered: boolean; failureReason?: string }` ([packages/continuation/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/types.ts:155)). The runtime correspondingly maps all non-success delivery outcomes to `delivery_failed` during resume ([packages/continuation/src/continuation.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/continuation.ts:631)).

That means the package cannot truthfully record delivery suppression discovered by the delivery layer itself, even though the package advertises suppression-aware delivery state. Suppression can still be expressed through explicit `stop()` calls, so the package is not boundary-broken, but the runtime contract is less expressive than the docs say.

## Assessment

### 1. Did the implementation stay bounded?

**Yes, mostly.**

The implementation stays inside the continuation seam:
- lifecycle and persistence of a continuation record
- wait-condition and trigger validation
- liveness bounds and expiry handling
- re-entry into harness through an adapter
- delivery bookkeeping without taking over surfaces

It does not absorb session management, memory retrieval, policy decisions, proactive orchestration, or turn-context assembly. The adapter boundaries are clear in the source API ([packages/continuation/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/continuation/src/types.ts:136)).

### 2. Is the continuation model useful to a real product?

**Yes, with follow-ups.**

The model is already useful for the three concrete product cases the docs target:
- waiting for a user clarification reply
- waiting for an approval resolution
- waiting for an external completion signal

Those cases are enough to justify the package. The runtime record shape, resume trigger typing, TTLs, max-attempt controls, and delivery state are product-shaped rather than academic.

The limitation is that scheduled wake support is only partially product-ready because wake timing and wake correlation are not fully modeled in the live contract.

### 3. Does it clearly separate from harness / turn-context / proactive / memory?

**Yes.**

The code cleanly keeps:
- harness as the bounded turn executor via `ContinuationHarnessAdapter`
- turn-context outside the package entirely
- proactive out of scope except for the narrow scheduled-wake adapter seam
- memory out of scope

That separation is visible both in the docs and in the package surface. I do not see evidence that continuation is leaking into general workflow, reminder, or memory territory.

### 4. Are the tests and validation strong enough for a first package pass?

**Yes, for a first package pass, but not exhaustive.**

What is strong:
- 49 passing tests across create/resume/stop/delivery/liveness/store behavior
- coverage of the three resumable harness outcomes plus scheduled wake
- expiry, max-attempt, denied approval, harness throw, re-pend, and concurrent resume scenarios
- build and package validation passed

What is still missing:
- no test for mismatched `scheduled_wake.wakeUpId`
- no test proving delivery adapter suppression statuses can be represented, because the current API cannot represent them
- no test around scheduler timing semantics beyond "scheduler was called"

That is enough for `v0.1.0`, but not enough to declare the contract fully settled.

## Recommendation

Ship this package as **`PASS_WITH_FOLLOWUPS`** and keep the package boundary.

Recommended follow-ups before broader adoption:
1. Correlate `scheduled_wake` resumes by `wakeUpId` when present, and add negative tests.
2. Split scheduled wake time from TTL/expiry so products can specify "wake at" independently.
3. Align `ContinuationDeliveryResult` with the spec so delivery can return truthful suppression statuses, not just success/failure.
4. Add one contract-level test that persists and validates trace event fields after record load; current `continuation_resume_requested` is emitted before record hydration and therefore lacks record identity details.

## Summary

The package succeeds as a bounded first-class continuation primitive and should remain a separate package. It is already useful for real products, especially for clarification, approval, and external-result resumptions. The correct release posture is `PASS_WITH_FOLLOWUPS`, driven by scheduled-wake and delivery-contract refinements rather than boundary failure.

V1_CONTINUATION_PACKAGE_REVIEW_COMPLETE
