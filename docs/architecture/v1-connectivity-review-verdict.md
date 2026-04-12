# v1 Connectivity Review Verdict

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Date:** 2026-04-11
**Verdict:** PASS_WITH_FOLLOWUPS
**Reviewed set:**
- `docs/architecture/v1-connectivity-scope.md`
- `docs/specs/v1-connectivity-spec.md`
- `docs/architecture/v1-connectivity-implementation-plan.md`
- `docs/reference/connectivity-signal-catalog.md`
- `packages/connectivity/README.md`
- `docs/specs/v1-routing-spec.md`

## Executive Verdict

The v1 connectivity specification set is materially improved and is now strong enough to drive the next implementation workflow, but not as a clean unconditional pass. The scope is properly bounded, the package boundaries are mostly crisp, and the routing interaction is clear and appropriately narrow. The remaining issues are not philosophical; they are two concrete contract gaps that should be corrected in the docs before implementation starts so the implementer does not have to invent behavior.

## Findings

### 1. `active` is specified as a real lifecycle state, but no implementation path ever transitions a signal into it

This is the most important gap because it affects state semantics, query defaults, convergence rules, and tests.

- The spec defines the lifecycle as `emitted -> active -> [superseded | expired | resolved]` and says `active` means at least one `onSignal` callback has fired for the signal: `docs/specs/v1-connectivity-spec.md:179-199`.
- The scope document also locks the five-state machine in place: `docs/architecture/v1-connectivity-scope.md:30-38`.
- But the implementation plan only stores signals with initial `state='emitted'`, fires callbacks, and never defines the transition from `emitted` to `active`: `docs/architecture/v1-connectivity-implementation-plan.md:122-130`, `268-281`, `347-360`.
- The catalog and spec both rely on `active` for convergence language such as open conflicts remaining in `active` state: `docs/reference/connectivity-signal-catalog.md:261-267`, `docs/specs/v1-connectivity-spec.md:511-518`.

Required follow-up:
- Either remove `active` from the lifecycle and treat `emitted` as the durable open state, or define the exact transition rule and update the implementation plan/tests to perform it.

### 2. Audience resolution for `all` depends on "registered components", but no registration contract exists

This is the second blocking ambiguity because it affects whether `audience='all'` can be implemented deterministically.

- The scope says `self`, `coordinator`, and `all` are resolved based on the thread's registered components: `docs/architecture/v1-connectivity-scope.md:68-73`.
- The public interface only exposes `registerSelectedResolver`; there is no participant registration API: `docs/specs/v1-connectivity-spec.md:332-344`, `403-412`.
- The implementation plan fills the gap ad hoc by defining `all` as all sources that have emitted signals on the thread plus `'coordinator'`: `docs/architecture/v1-connectivity-implementation-plan.md:296-303`.

That fallback is plausible, but it is not the same contract as "registered components", and it fails for participants that need to receive a broadcast before they have emitted anything.

Required follow-up:
- Make one contract canonical. Either add an explicit participant-registration API to the spec/scope/plan, or change the scope text to match the implementation plan's inferred-participant model and accept its limitations.

### 3. Suppression rules are almost locked, but one escalation exception is underspecified relative to the plan

This is not a release blocker, but it should be tightened now to avoid implementer interpretation.

- The spec adds a special case: high-priority escalation signals are not suppressed within the same step if the `summary` differs: `docs/specs/v1-connectivity-spec.md:286-291`.
- The implementation plan defines duplicate detection solely by `threadId + source + signalClass + audience` and does not include this exception in implementation notes or tests: `docs/architecture/v1-connectivity-implementation-plan.md:209-227`.
- The scope also lists broadcast suppression policy as still open before hardening: `docs/architecture/v1-connectivity-scope.md:132-134`, `299-303`.

Required follow-up:
- Add the escalation-summary exception explicitly to the implementation plan and tests, or delete it from the spec and keep suppression purely key-based for v1.

## Assessment Against Requested Questions

### 1. Is the v1 scope properly bounded?

Yes. The scope is tightly bounded around an in-process signal layer with clear exclusions for transport, persistence, routing ownership, coordination ownership, session/surface concerns, and custom vocabularies: `docs/architecture/v1-connectivity-scope.md:118-145`. This is a good v1 boundary.

### 2. Is the spec implementation-ready rather than philosophical?

Mostly yes. The spec provides concrete types, validation rules, interfaces, call sequencing, suppression behavior, and convergence expectations: `docs/specs/v1-connectivity-spec.md:34-175`, `295-481`. The implementation plan is also broken into executable slices with test coverage: `docs/architecture/v1-connectivity-implementation-plan.md:48-340`. The two contract gaps above keep this from being a full PASS.

### 3. Are connectivity vs coordination vs routing boundaries now clear?

Yes, substantially. The scope now states these boundaries directly and consistently:
- Connectivity vs coordination: `docs/architecture/v1-connectivity-scope.md:151-160`
- Connectivity vs routing: `docs/architecture/v1-connectivity-scope.md:162-171`
- Routing spec agrees that routing receives escalation input but does not own signals or orchestration: `docs/specs/v1-routing-spec.md:17-32`

This is much clearer than a philosophical layering document. It is operational.

### 4. Is the routing interaction clear but appropriately limited?

Yes. The interaction is narrow and appropriate:
- One hook
- Synchronous call during escalation emit
- Connectivity does not apply the returned mode
- Routing can honor or ignore the request by policy

That is stated consistently in the scope and connectivity spec: `docs/architecture/v1-connectivity-scope.md:248-289`, `docs/specs/v1-connectivity-spec.md:417-453`. The routing spec also preserves the limited boundary by keeping routing decisions inside routing: `docs/specs/v1-routing-spec.md:222-327`, `331-352`.

### 5. Is this strong enough to directly drive the next implementation workflow?

Yes, with follow-ups. An implementer can start immediately from these docs, but should not have to decide the lifecycle semantics of `active` or invent the participant model for `audience='all'`. Those should be resolved in the docs first. Once corrected, the set is strong enough to drive the package implementation directly.

## Recommended Disposition

Proceed to implementation after making these doc-only corrections:

1. Canonicalize the lifecycle model by either removing `active` or specifying exactly when `emitted` becomes `active`.
2. Canonicalize the participant model for `audience='all'`.
3. Align suppression exceptions between the spec and implementation plan.

## Summary

This review concludes that the v1 connectivity work is properly scoped, the adjacency boundaries are now mostly clear, and the routing interaction is appropriately constrained. I produced one review artifact:

- `docs/architecture/v1-connectivity-review-verdict.md`

V1_CONNECTIVITY_REVIEW_COMPLETE
