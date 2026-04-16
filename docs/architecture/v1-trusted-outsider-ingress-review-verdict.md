# v1 Trusted Outsider Ingress Review Verdict

**Date:** 2026-04-16
**Reviewer verdict:** `PASS_WITH_FOLLOWUPS`

## Findings

### 1. Router error semantics are not fully locked across the workflow-ready set

The boundary doc defines `IngressRouter.route()` as returning `IngressHandlerResult` and defines pipeline failure at the separate `IngressOutcome` layer, but it does not say whether router implementations must catch thrown handler errors or let them propagate ([v1-trusted-outsider-ingress-boundary.md](./v1-trusted-outsider-ingress-boundary.md#L163), [v1-trusted-outsider-ingress-boundary.md](./v1-trusted-outsider-ingress-boundary.md#L181)). The proof plan then requires a test where a thrown handler "produces error outcome" ([v1-trusted-outsider-ingress-proof-plan.md](./v1-trusted-outsider-ingress-proof-plan.md#L97)), and the implementation sequence says phase 1 should "convert thrown handler errors into an error outcome or equivalent documented result" ([v1-trusted-outsider-ingress-implementation-sequence.md](./v1-trusted-outsider-ingress-implementation-sequence.md#L92)).

This is not a structural flaw, but it is still a specification gap. The docs should explicitly choose one rule before implementation:
- `route()` catches and returns `IngressHandlerResult { handled: false, outcome: 'error', ... }`, or
- `route()` may throw and only the outer pipeline produces `IngressOutcome`.

### 2. The implementation-sequence contract count is internally inconsistent

Phase 0 says "Confirm the five ingress contracts are the complete v1 SDK surface," then lists six bullets if `IngressHandler`/`IngressHandlerResult` are counted together and `IngressOutcome` is counted separately ([v1-trusted-outsider-ingress-implementation-sequence.md](./v1-trusted-outsider-ingress-implementation-sequence.md#L43)). This is minor, but the document is supposed to be workflow-ready and unambiguous. The count should be corrected or the wording changed to avoid confusion in downstream execution.

### 3. Export-scope wording should be aligned before implementation starts

The proof plan explicitly includes updating `packages/inbox/src/index.ts` to export the ingress surface ([v1-trusted-outsider-ingress-proof-plan.md](./v1-trusted-outsider-ingress-proof-plan.md#L83)), but the same doc later says the slice does not include "Changes to the SDK facade re-exports" ([v1-trusted-outsider-ingress-proof-plan.md](./v1-trusted-outsider-ingress-proof-plan.md#L189)). This is probably distinguishing package-local exports from a higher-level SDK facade, but that distinction is not stated clearly in the document set. It should be made explicit.

## Assessment

### 1. Reusable substrate vs. Cloud-only hosted glue

Yes. The separation is clear and repeated consistently.

The strongest evidence is the extraction map, which classifies only the substrate as SDK-worthy now and leaves transport, env/secret lookup, DB-backed integration persistence, hosted forwarding, provider-specific transformation, relayfile writes, and runtime workarounds in Cloud ([v1-trusted-outsider-ingress-extraction-map.md](./v1-trusted-outsider-ingress-extraction-map.md#L113), [v1-trusted-outsider-ingress-extraction-map.md](./v1-trusted-outsider-ingress-extraction-map.md#L130)). The boundary doc says the same thing in its Cloud-only table ([v1-trusted-outsider-ingress-boundary.md](./v1-trusted-outsider-ingress-boundary.md#L187)), and the Cloud adoption plan reinforces that adoption must stay additive and wrapper-based with exact Cloud-only boundaries preserved ([v1-trusted-outsider-ingress-cloud-adoption-plan.md](./v1-trusted-outsider-ingress-cloud-adoption-plan.md#L106)).

This is a real substrate boundary, not a disguised extraction of Cloud code.

### 2. Inbox-adjacent placement

Yes. The justification is credible.

The boundary doc ties ingress directly to the front door of Inbox, points to existing `InboxSourceTrust` and `InboxWriteInput` ownership, and explains why a separate `@agent-assistant/ingress` package would add import churn without architectural benefit ([v1-trusted-outsider-ingress-boundary.md](./v1-trusted-outsider-ingress-boundary.md#L232)). That rationale is coherent with the planned projection utility and with the explicit decision not to modify the existing store or projectors ([v1-trusted-outsider-ingress-proof-plan.md](./v1-trusted-outsider-ingress-proof-plan.md#L158)).

### 3. First slice tight enough to implement without architectural sprawl

Mostly yes.

The slice is bounded to:
- ingress types
- a minimal registry router
- an envelope-to-inbox projection utility
- exports
- tests
- Cloud type-alignment proof and wrapper planning

That boundary is repeated in the proof plan and implementation sequence, with explicit "must not do" rules and phase gates ([v1-trusted-outsider-ingress-proof-plan.md](./v1-trusted-outsider-ingress-proof-plan.md#L180), [v1-trusted-outsider-ingress-implementation-sequence.md](./v1-trusted-outsider-ingress-implementation-sequence.md#L248), [v1-trusted-outsider-ingress-no-shortcuts-checklist.md](./v1-trusted-outsider-ingress-no-shortcuts-checklist.md#L8)).

The reason this is not a full `PASS` is that the router thrown-error contract and the export wording should be cleaned up first. Those are manageable documentation follow-ups, not evidence of architectural sprawl.

### 4. Avoidance of expedient shortcuts

Yes. The plan is strong on this point.

The docs repeatedly prohibit moving provider parsing, env/secret lookup, DB glue, forwarding, relayfile writes, retry logic, or transport semantics into the SDK ([v1-trusted-outsider-ingress-boundary.md](./v1-trusted-outsider-ingress-boundary.md#L187), [v1-trusted-outsider-ingress-implementation-sequence.md](./v1-trusted-outsider-ingress-implementation-sequence.md#L248), [v1-trusted-outsider-ingress-no-shortcuts-checklist.md](./v1-trusted-outsider-ingress-no-shortcuts-checklist.md#L31)). The Cloud adoption plan also explicitly blocks widening the SDK surface just to make the first Cloud adoption pass easier ([v1-trusted-outsider-ingress-cloud-adoption-plan.md](./v1-trusted-outsider-ingress-cloud-adoption-plan.md#L121)).

That is the right anti-shortcut posture.

## Final Verdict

`PASS_WITH_FOLLOWUPS`

The architecture is directionally sound. The reusable substrate is clearly separated from Cloud-only glue, Inbox-adjacent placement is justified, and the first slice is narrow enough to execute without reopening the boundary. Before implementation starts, the docs should align on:

1. exact router behavior for thrown handler errors
2. the contract-count wording in the implementation sequence
3. the distinction between package-local `packages/inbox/src/index.ts` exports and any broader SDK facade re-exports

Once those are tightened, the plan is ready for execution.

Artifact produced:
- `docs/architecture/v1-trusted-outsider-ingress-review-verdict.md`

V1_TRUSTED_OUTSIDER_INGRESS_REVIEW_COMPLETE
