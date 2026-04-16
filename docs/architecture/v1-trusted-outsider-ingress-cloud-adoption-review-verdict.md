# v1 Trusted Outsider Ingress Cloud Adoption Review Verdict

**Date:** 2026-04-16
**Reviewer mode:** non-interactive
**Verdict:** PASS_WITH_FOLLOWUPS

## Findings

### 1. PASS: The plan preserves Cloud-only hosted glue boundaries.

The documents are explicit and consistent that hosted glue stays in Cloud:

- HTTP transport, raw body/header access, response construction, and runtime config remain Cloud-only in the contract and boundary docs ([v1-trusted-outsider-ingress-cloud-adoption-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md:52), [v1-trusted-outsider-ingress-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-boundary.md:192)).
- Env/secrets, DB-backed workspace integration lookups, Nango client wiring, hosted forwarding, relayfile writes, retry logic, and provider-specific transforms are all called out as permanently Cloud-owned or not SDK-worthy ([v1-trusted-outsider-ingress-cloud-adoption-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md:65), [v1-trusted-outsider-ingress-cloud-adoption-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md:120), [v1-trusted-outsider-ingress-cloud-adoption-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-plan.md:106)).
- The seam definition is narrow: conversion, wrappering, registration, and dispatch happen at the seam; business logic above and below remains Cloud-owned ([v1-trusted-outsider-ingress-cloud-adoption-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md:139)).

Assessment: this satisfies the Cloud-only hosted glue boundary requirement.

### 2. PASS: The adoption shape is additive and wrapper-based, not a rewrite.

The contract, plan, and sequence all reinforce the same implementation posture:

- "No rewrite" and "no migration" are explicit contract rules, with the pre-adoption path retained until equivalence is proven ([v1-trusted-outsider-ingress-cloud-adoption-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md:15)).
- The wrapper sequence requires new Cloud files first, thin wrappers under roughly 30 lines, and no logic movement out of existing Cloud modules ([v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md:10)).
- Route wiring is explicitly reversible and feature-flag or branch based, with the old route retained until equivalence evidence exists ([v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md:137)).

Assessment: the adoption shape is clearly additive, side-by-side, and wrapper-driven.

### 3. PASS: The plan avoids widening the SDK surface just to fit Cloud Nango.

This is one of the strongest parts of the slice:

- SDK surface widening is expressly forbidden, including Nango-shaped envelope fields, Cloud-specific result variants, retry/batching abstractions, auth lifecycle types, and telemetry expansion ([v1-trusted-outsider-ingress-cloud-adoption-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md:208)).
- Gate 4 requires the SDK inbox package exports, types, functions, and dependencies to remain unchanged during Cloud adoption ([v1-trusted-outsider-ingress-cloud-adoption-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md:266)).
- The proof doc treats coupling signals as stop points rather than invitations to stretch the SDK, especially around deleted-file metrics, Nango event variants, provider aliasing, retry contracts, and HTTP abstractions ([v1-trusted-outsider-ingress-cloud-alignment-proof.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md:204)).

Assessment: the slice does not widen the SDK to accommodate Cloud. It correctly forces Cloud to adapt locally or stop.

### 4. PASS_WITH_FOLLOWUPS: Rollback criteria are mostly honest and concrete, but a few review hooks should stay explicit.

The rollback/risk checklist is materially better than a generic "we can revert it" claim:

- It defines hard rollback triggers tied to observable behavior, signature drift, handler return-shape drift, SDK-surface expansion, test rewrite pressure, storage-behavior changes, and premature deletion of the old path ([v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md:14)).
- It gives a concrete rollback procedure centered on restoring `route.ts -> routeNangoWebhook(envelope)` and rerunning the existing tests ([v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md:115)).
- It also names the hidden-coupling stop conditions instead of burying them ([v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md:26)).

Follow-ups:

- The handler-registration story still has an acknowledged shape mismatch for wildcard-style forwarding/auth dispatch. The proof says `provider: '*'` wrappers are not available and suggests either per-provider wrappers or keeping some top-level Cloud dispatch for `forward` ([v1-trusted-outsider-ingress-cloud-alignment-proof.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md:121)). That is acceptable, but the eventual implementation review should require the exact registration pattern to be locked before route cutover.
- `IngressHandlerResult.outcome` mapping is intentionally left somewhat open (`handled: false` + `skipped` vs `handled: true` + `skipped`) ([v1-trusted-outsider-ingress-cloud-alignment-proof.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md:134)). That is fine for architecture planning, but the implementation workflow should force one convention and prove it does not distort existing Cloud observability.
- The evidence package correctly calls out that auth and forward coverage must be added, not inferred from sync tests alone ([v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md:186), [v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md:51)). That follow-up should remain a merge gate, not a soft recommendation.

Assessment: rollback planning is honest and concrete enough to pass, but only with these follow-ups kept as explicit implementation gates.

## Answers

1. Does the plan preserve Cloud-only hosted glue boundaries?
Yes.

2. Is the adoption shape additive and wrapper-based rather than a rewrite?
Yes.

3. Does it avoid widening the SDK surface just to fit Cloud Nango?
Yes.

4. Are rollback criteria honest and concrete?
Yes, with follow-ups around exact handler registration shape, fixed outcome-mapping convention, and mandatory forward/auth equivalence evidence.

5. Verdict
PASS_WITH_FOLLOWUPS

## Summary

The Cloud adoption slice is well-bounded. It keeps hosted glue in Cloud, uses SDK contracts only at a narrow seam, and repeatedly forbids rewrite, parser extraction, transport abstraction, data-model collapse, and SDK widening. The remaining work is not architectural rethinking; it is making sure the later implementation workflow locks down the wildcard-handler shape, chooses one minimal result convention, and proves forward/auth equivalence before enabling the new route path.

Artifact produced:
- [v1-trusted-outsider-ingress-cloud-adoption-review-verdict.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-review-verdict.md)

V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_REVIEW_COMPLETE
