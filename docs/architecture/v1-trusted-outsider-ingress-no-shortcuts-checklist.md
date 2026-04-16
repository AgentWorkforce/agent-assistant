# v1 Trusted Outsider Ingress No-Shortcuts Checklist

**Date:** 2026-04-16
**Status:** WORKFLOW-READY

Use this checklist before implementation, during review, and before declaring the v1 ingress slice complete.

## 1. Scope discipline

- [ ] v1 still extends `@agent-assistant/inbox` rather than creating a new package.
- [ ] v1 still contains only reusable ingress substrate.
- [ ] The implemented SDK surface is limited to ingress types, router, projection utility, exports, and tests.
- [ ] No speculative future abstractions were added for batch ingress, telemetry, retries, or provider adapters.

## 2. Docs-first discipline

- [ ] `v1-trusted-outsider-ingress-boundary.md`, extraction map, proof plan, implementation sequence, and Cloud adoption plan agree on the same scope.
- [ ] The SDK-worthy artifacts listed in the extraction map match the implementation exactly.
- [ ] The docs explicitly state what remains Cloud-only.
- [ ] The docs explicitly state what not to do in v1.

## 3. SDK implementation discipline

- [ ] `packages/inbox/src/ingress-types.ts` contains types only.
- [ ] `packages/inbox/src/ingress-router.ts` is a minimal registry dispatcher, not a transport or orchestration framework.
- [ ] `packages/inbox/src/ingress-projection.ts` is a convenience projection, not a mandatory ingestion path.
- [ ] `packages/inbox/src/index.ts` is the only existing inbox source file modified outside new ingress files.
- [ ] No new package dependencies were introduced.
- [ ] Existing inbox store and projector behavior were not changed.

## 4. Cloud boundary discipline

- [ ] No HTTP route code was moved into the SDK.
- [ ] No environment or secret lookup was moved into the SDK.
- [ ] No DB-backed workspace integration persistence was moved into the SDK.
- [ ] No provider-specific parsing or normalization was moved into the SDK.
- [ ] No relayfile write logic was moved into the SDK.
- [ ] No hosted forwarding logic was moved into the SDK.
- [ ] No retry-with-backoff behavior was promoted into the SDK.

## 5. Validation discipline

- [ ] Router tests cover the full proof-plan matrix.
- [ ] Projection tests cover the full proof-plan matrix.
- [ ] Inbox-targeted tests pass.
- [ ] Full repo tests pass if code changes were made in this workflow.
- [ ] Any uncovered gap is documented as a blocker or deferred item, not hand-waved away.

## 6. Cloud proving discipline

- [ ] Cloud proving is documented as type alignment first.
- [ ] Cloud adoption is framed as additive wrappers around existing logic.
- [ ] Cloud adoption is not treated as mandatory for v1 SDK success.
- [ ] Any Cloud mismatch is recorded as a blocker, deferral, or follow-up.

## 7. Review and remediation discipline

- [ ] Reviewers checked that no v1 shortcut turned the SDK into a disguised Nango extraction.
- [ ] Reviewers checked that the first slice remains reusable outside Cloud.
- [ ] Remediation items are captured as follow-ups rather than widening the current slice.
- [ ] Deferred topics remain deferred: retry wrapper, batch ingress, telemetry contract, provider adapters, auth lifecycle contract.

## 8. Stop conditions

Stop and remediate before proceeding if any statement becomes true:

- [ ] A proposed change requires adding Cloud transport semantics to the SDK.
- [ ] A proposed change requires moving provider-specific parsing into the SDK.
- [ ] A proposed change requires changing existing inbox store or projector behavior.
- [ ] A proposed change requires broadening the API to satisfy one Cloud edge case.
- [ ] A proposed change cannot be validated by the phase gates defined in the implementation sequence.

---

V1_TRUSTED_OUTSIDER_INGRESS_NO_SHORTCUTS_READY
