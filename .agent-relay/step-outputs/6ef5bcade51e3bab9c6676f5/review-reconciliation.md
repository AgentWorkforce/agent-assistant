# Spec Reconciliation Review Verdict

Date: 2026-04-11  
Reviewer: non-interactive reviewer agent

Scope reviewed:
- `docs/architecture/spec-reconciliation-rules.md`
- `docs/architecture/spec-program-plan.md`
- `docs/architecture/v1-sectioning-and-priorities.md`
- `docs/workflows/v1-workflow-backlog.md`
- `docs/workflows/weekend-delivery-plan.md`
- `docs/consumer/how-to-build-an-assistant.md`
- `docs/specs/v1-core-spec.md`
- `docs/specs/v1-sessions-spec.md`
- `docs/specs/v1-surfaces-spec.md`
- `docs/specs/v1-memory-spec.md`
- `docs/specs/v1-connectivity-spec.md`
- `docs/specs/v1-routing-spec.md`

## Verdict

FAIL

## Summary

The reconciliation is not complete. The planning and consumer docs were updated to the intended post-reconciliation contract, but the canonical v1 specs still retain the pre-reconciliation contract in several critical places. Because `docs/specs/` are explicitly the source of truth, the reviewed docs set is not yet trustworthy as a reconciled whole.

## Findings

### 1. Are stale API names gone?

Mostly yes at the identifier level, but not fully clean.

What is good:
- The obvious stale API names are largely gone from the planning/workflow/consumer docs.
- The replacement guidance is clear in:
  - `docs/architecture/spec-reconciliation-rules.md`
  - `docs/architecture/v1-sectioning-and-priorities.md`
  - `docs/consumer/how-to-build-an-assistant.md`

What remains:
- `docs/workflows/v1-workflow-backlog.md:292` still says `session resumed`.
- `docs/specs/v1-sessions-spec.md:55-56` still uses legacy narrative wording: “may be resumed” and “Permanently closed”.

Assessment: stale API names are mostly removed, but the docs are not fully scrubbed.

### 2. Do the planning docs now match the specs?

No.

The planning docs assume these reconciled contracts:
- surfaces own inbound normalization
- `InboundMessage` includes `userId` and `workspaceId?`
- `OutboundEvent.surfaceId` is optional
- `runtime.emit()` throws `OutboundEventError` if both `surfaceId` and `sessionId` are absent
- `SurfaceRegistry` is the inbound/outbound adapter pair for core

But the canonical specs still disagree:

In `docs/specs/v1-core-spec.md`:
- Core still claims ownership of inbound normalization: line 19
- `InboundMessage` still lacks `userId` and `workspaceId?`: lines 92-117
- `OutboundEvent.surfaceId` is still required: lines 220-235
- `RelayInboundAdapter` still accepts `raw: unknown`: lines 267-272
- The implementation slice still says core normalizes raw events: lines 348-351

In `docs/specs/v1-surfaces-spec.md`:
- Surfaces still defines a separate `RelayInboundSurfaceAdapter` / `setInboundHandler()` shape instead of clearly adopting the core adapter contract: lines 268-292
- The normalization table still omits `userId` and `workspaceId`: lines 299-306

Assessment: the planning docs are ahead of the specs rather than aligned with them. Since specs win, this is a hard mismatch.

### 3. Are Sage/MSD/NightCTO examples implementation-credible now?

Partially improved, but not implementation-credible against the current source of truth.

What improved:
- The examples now use the intended names and assembly shape:
  - `createAssistant`
  - `AssistantDefinition`
  - `createSessionStore`
  - `createSurfaceRegistry`
  - `runtime.register("sessions", ...)`

Why they still fail the credibility bar:
- They use `resolveSession(message, ...)` as if `message.userId` exists, but the core spec does not define it.
- They wire `surfaceRegistry` as core’s inbound/outbound adapter pair, but the core spec still models inbound as raw-event based.
- They rely on targeted-send/fanout semantics that the core spec has not canonically adopted yet.

Assessment: credible against the intended future contract, not against the actual canonical specs.

### 4. Is the weekend workflow backlog now trustworthy?

Not yet.

The backlog is improved and explicit, but it is still blocked on unresolved spec edits:
- `docs/workflows/v1-workflow-backlog.md:24-41` marks the contradiction-resolution actions as pending.
- WF-1, WF-2, WF-5, WF-6, and WF-7 all assume the post-reconciliation contracts.

Assessment: it is a reasonable target-state backlog, but not yet a trustworthy execution artifact for immediate implementation.

### 5. What follow-ups remain?

Required before this can pass:

1. Update `docs/specs/v1-core-spec.md`.
- Remove core ownership of inbound normalization.
- Add `userId: string` and `workspaceId?: string` to `InboundMessage`.
- Make `OutboundEvent.surfaceId` optional.
- Define `OutboundEventError`.
- Change `RelayInboundAdapter` to normalized `InboundMessage`.
- Remove implementation text that says core normalizes raw events.

2. Update `docs/specs/v1-surfaces-spec.md`.
- Explicitly state `SurfaceRegistry` implements core’s inbound/outbound adapter interfaces.
- Reconcile or remove the parallel `RelayInboundSurfaceAdapter` / `setInboundHandler()` contract.
- Add `userId` and `workspaceId` to the normalization table.
- State required behavior when `userId` is missing.
- State the same targeted-send vs session-fanout rule as core.

3. Run one more stale-term cleanup pass.
- Remove `session resumed` from `docs/workflows/v1-workflow-backlog.md:292`.
- Replace legacy narrative wording in `docs/specs/v1-sessions-spec.md:55-56`.

4. Re-review the examples and weekend plan after the spec edits land.

## Direct Answers

1. Are stale API names gone?  
Mostly, but not completely.

2. Do the planning docs now match the specs?  
No.

3. Are Sage/MSD/NightCTO examples implementation-credible now?  
Not against the current canonical specs.

4. Is the weekend workflow backlog now trustworthy?  
Not yet.

5. What follow-ups remain, if any?  
Core and surfaces spec reconciliation still needs to land, followed by a final stale-term cleanup and re-review.

Artifact produced:
- `docs/architecture/spec-reconciliation-review-verdict.md`

SPEC_RECONCILIATION_REVIEW_COMPLETE
