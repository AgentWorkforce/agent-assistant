PASS_WITH_FOLLOWUPS

# Canonical Spec Review Verdict

Date: 2026-04-11
Inputs reviewed:
- `docs/architecture/canonical-spec-fix-plan.md`
- `docs/specs/v1-core-spec.md`
- `docs/specs/v1-surfaces-spec.md`
- `docs/specs/v1-sessions-spec.md`
- `docs/workflows/v1-workflow-backlog.md`
- `docs/architecture/spec-reconciliation-rules.md`

## Verdict

The canonical package specs are now materially reconciled with the reconciliation rules, and the core cross-package contracts are coherent enough to proceed. A full `PASS` is not justified because a small amount of documentation drift remains in the surfaces spec implementation slice and in the workflow backlog's reconciliation-status bookkeeping.

## Assessment

### 1. Do the canonical specs now reflect the reconciliation rules?

Mostly yes.

Confirmed:
- Core now explicitly states that it does not own inbound normalization and instead receives normalized `InboundMessage` objects from surfaces: `docs/specs/v1-core-spec.md:21`.
- Core `RelayInboundAdapter` now accepts `InboundMessage`, matching Rule 2 / Contradiction 1: `docs/specs/v1-core-spec.md:292-295`.
- Core `InboundMessage` now includes `userId` and `workspaceId?`, matching Rule 2 / Contradiction 2: `docs/specs/v1-core-spec.md:93-124`.
- Core `OutboundEvent.surfaceId` is now optional, and `OutboundEventError` is defined, matching Rule 2 / Contradiction 3: `docs/specs/v1-core-spec.md:231-246`, `docs/specs/v1-core-spec.md:261-272`.
- Core `runtime.emit()` now defines the targeted-send / session-fanout / invalid routing rule: `docs/specs/v1-core-spec.md:188-196`.
- Surfaces now explicitly says `SurfaceRegistry` implements core's relay adapter contracts and documents normalization ownership: `docs/specs/v1-surfaces-spec.md:15-18`, `docs/specs/v1-surfaces-spec.md:277-306`.
- Surfaces normalization now includes `userId` and `workspaceId` extraction rules: `docs/specs/v1-surfaces-spec.md:312-325`.
- Surfaces now includes the normative outbound routing rule reference consistent with core: `docs/specs/v1-surfaces-spec.md:420-428`.
- Sessions lifecycle/state vocabulary is aligned to `created | active | suspended | expired`: `docs/specs/v1-sessions-spec.md:42-58`, `docs/specs/v1-sessions-spec.md:99`.

Remaining drift:
- The surfaces spec first implementation slice still says `receiveRaw + setInboundHandler` instead of the reconciled `onMessage` / `offMessage` adapter shape: `docs/specs/v1-surfaces-spec.md:468-470`.
- The workflow backlog still marks reconciliation actions and spec statuses as "Pending" even though the canonical specs now include the reconciled contracts: `docs/workflows/v1-workflow-backlog.md:24-41`, `docs/workflows/v1-workflow-backlog.md:339-341`.

### 2. Is inbound normalization ownership now clear and consistent?

Yes, with one non-blocking leftover reference.

The canonical ownership model is now clear:
- Core says it does not normalize raw relay events and receives normalized `InboundMessage`: `docs/specs/v1-core-spec.md:21`.
- Core's inbound adapter now accepts normalized messages: `docs/specs/v1-core-spec.md:292-295`.
- Surfaces says it owns inbound normalization and that `SurfaceRegistry` bridges raw relay input to normalized messages: `docs/specs/v1-surfaces-spec.md:15-18`, `docs/specs/v1-surfaces-spec.md:290-299`.

The only inconsistency left is procedural, not architectural: the surfaces spec's implementation-slice Step 4 still mentions `setInboundHandler`, which reintroduces the superseded earlier-draft interface name: `docs/specs/v1-surfaces-spec.md:468-470`.

### 3. Are `InboundMessage` identity fields and outbound targeting/fanout rules now coherent?

Yes.

Identity fields:
- `InboundMessage.userId` is required and `workspaceId?` is optional in core: `docs/specs/v1-core-spec.md:103-107`.
- Surfaces normalization specifies how those fields are derived and what happens when `userId` is missing: `docs/specs/v1-surfaces-spec.md:317-325`.
- Sessions can now coherently rely on those fields for `resolveSession(...)`: `docs/specs/v1-sessions-spec.md:215-223`.

Outbound targeting/fanout:
- Core defines `surfaceId?` and `sessionId?` with the correct routing rule and invalid case: `docs/specs/v1-core-spec.md:188-196`, `docs/specs/v1-core-spec.md:231-246`, `docs/specs/v1-core-spec.md:261-272`.
- Surfaces mirrors that contract and correctly frames fanout as a surfaces-owned delivery concern: `docs/specs/v1-surfaces-spec.md:405-428`.
- The workflow backlog also uses the targeted-send vs session-fanout model consistently in WF-6 and WF-7: `docs/workflows/v1-workflow-backlog.md:253-261`, `docs/workflows/v1-workflow-backlog.md:283-312`.

### 4. Are stale session lifecycle terms cleaned up sufficiently?

Sufficiently for implementation guidance, but not perfectly.

Cleaned up:
- The state machine and state union now use only `created`, `active`, `suspended`, and `expired`: `docs/specs/v1-sessions-spec.md:42-58`, `docs/specs/v1-sessions-spec.md:99`.
- The backlog no longer uses "session resumed" in WF-7 and instead says "reactivated via touch": `docs/workflows/v1-workflow-backlog.md:292`.

Residual wording to consider tightening:
- Sessions responsibilities still use the narrative noun `resumption`: `docs/specs/v1-sessions-spec.md:17`.

That wording does not create an API contradiction, but if the goal is full cleanup of pre-reconciliation vocabulary, it should be normalized to `touch` / reactivation wording as well.

## Follow-Ups

1. Update `docs/specs/v1-surfaces-spec.md` implementation-slice Step 4 to replace `setInboundHandler` with the reconciled `onMessage` / `offMessage` contract.
2. Update `docs/workflows/v1-workflow-backlog.md` reconciliation tables and execution-order notes so they no longer claim the already-applied spec fixes are pending.
3. Optionally tighten `docs/specs/v1-sessions-spec.md:17` by replacing the narrative term `resumption` with wording aligned to `touch()` / transition back to `active`.

## Summary

What was accomplished:
- Reviewed the canonical fix plan, reconciliation rules, three package specs, and the workflow backlog.
- Verified that the major reconciliation items are now implemented in the canonical specs.
- Identified the remaining non-blocking follow-ups that prevent a clean full `PASS`.

Artifact produced:
- `docs/architecture/canonical-spec-review-verdict.md`

CANONICAL_SPEC_REVIEW_COMPLETE
