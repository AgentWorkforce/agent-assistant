# v1 Trusted Outsider Ingress Implementation Sequence

**Date:** 2026-04-16
**Status:** WORKFLOW-READY

## 1. Purpose

Turn the directional ingress boundary, extraction map, and proof plan into a sequence that can be executed as immediate follow-up workflows without re-deciding scope.

This sequence keeps v1 bounded to reusable ingress substrate in `@agent-assistant/inbox`, then proves the design against Cloud's Nango webhook handling as a separate adoption phase.

## 2. Operating constraints

- v1 is limited to reusable ingress substrate only.
- Cloud remains the proving case, not the extraction target.
- No new package is created in v1.
- No Cloud transport, persistence, provider parsing, or relayfile logic moves into the SDK in v1.
- Every phase must pass explicit validation gates before the next phase begins.

## 3. Sequence overview

| Phase | Objective | Primary output |
|---|---|---|
| 0 | Lock specification and slice boundaries | Approved docs and explicit non-goals |
| 1 | Implement minimal SDK ingress substrate | New inbox ingress files and tests |
| 2 | Prove Cloud alignment and define adoption steps | Cloud adoption plan and type-alignment evidence |
| 3 | Review, remediate, and freeze v1 | Verified docs, passing tests, recorded follow-ups |

## 4. Phase 0: Docs-first specification

### Goal

Freeze the v1 contract before any code work.

### Required inputs

- `docs/architecture/v1-trusted-outsider-ingress-boundary.md`
- `docs/architecture/v1-trusted-outsider-ingress-extraction-map.md`
- `docs/architecture/v1-trusted-outsider-ingress-proof-plan.md`

### Tasks

1. Confirm the v1 ingress contract set is the complete approved SDK surface:
   - `IngressEnvelope`
   - `IngressVerifier`
   - `IngressResolver`
   - `IngressHandler` and `IngressHandlerResult`
   - `IngressRouter`
   - `IngressOutcome`
2. Confirm the only v1 implementation artifacts are:
   - `ingress-types.ts`
   - `ingress-router.ts`
   - `ingress-projection.ts`
   - export updates
   - router tests
   - projection tests
3. Confirm all Cloud-specific logic remains product-owned.
4. Record explicit v1 exclusions in a no-shortcuts checklist before implementation starts.

### Validation gates

- Boundary doc still recommends extending `@agent-assistant/inbox`, not creating a new package.
- Extraction map still classifies only the documented substrate as SDK-worthy now.
- Proof plan still limits implementation to types, router, projection, exports, and tests.
- There are no open scope questions about transport, provider adapters, retry wrappers, or telemetry contracts.

### Exit criteria

- Specification is stable enough that an implementation workflow can proceed without further architectural choices.

## 5. Phase 1: Minimal SDK primitive implementation

### Goal

Land the reusable ingress substrate in `@agent-assistant/inbox` and nothing more.

### Scope

Create:
- `packages/inbox/src/ingress-types.ts`
- `packages/inbox/src/ingress-router.ts`
- `packages/inbox/src/ingress-projection.ts`
- `packages/inbox/src/ingress-router.test.ts`
- `packages/inbox/src/ingress-projection.test.ts`

Modify:
- `packages/inbox/src/index.ts`

### Tasks

1. Add ingress type definitions exactly as described in the boundary doc.
2. Implement `createIngressRouter()` as a minimal registry dispatcher:
   - match by `provider`
   - optionally narrow by `eventType`
   - return `{ handled: false, outcome: 'skipped' }` when no handler matches
   - preserve deterministic first-registered match behavior
   - catch thrown handler errors and return a deterministic error result with `handled: false`, `outcome: 'error'`, and a reason recorded in metadata or equivalent documented field
3. Implement `projectEnvelopeToInboxInput()` as a convenience projection from verified/resolved ingress to `InboxWriteInput`.
4. Export all new contracts and utilities from `packages/inbox/src/index.ts`.
5. Add the full router and projection test matrix from the proof plan.

### Validation gates

- `packages/inbox` compiles without circular import changes to existing inbox types.
- No existing inbox files other than `index.ts` are modified.
- No new dependencies are added.
- Router tests cover:
  - no handlers
  - provider match
  - provider plus event-type match
  - event-type miss
  - deterministic first match
  - pass-through metrics
  - thrown handler behavior
  - `null` connection IDs
- Projection tests cover:
  - full-field projection
  - `assistantId` preference
  - `workspaceId` fallback
  - default `kind`
  - default `trustLevel`
  - ingress metadata preservation
  - payload serialization
  - scope mapping
- `npx vitest run packages/inbox/src/ingress-router.test.ts packages/inbox/src/ingress-projection.test.ts` passes.
- `npx vitest run packages/inbox/src` passes with existing tests plus the new ingress tests.

### Exit criteria

- The inbox package contains a reusable ingress substrate that is product-agnostic and locally verified.

## 6. Phase 2: Cloud proving-case adoption

### Goal

Prove that Cloud's Nango webhook handling can adopt the SDK contracts without changing Cloud behavior, then define a safe adoption path.

### Scope

This phase is documentation-first and adapter-oriented.

### Tasks

1. Produce a type-alignment table showing how Cloud maps to the SDK substrate:
   - `NangoWebhookEnvelope` -> `IngressEnvelope`
   - `verifyNangoWebhookSignature()` -> `IngressVerifier`
   - `resolveWorkspace()` -> `IngressResolver`
   - existing auth/forward/sync handlers -> `IngressHandler`
   - sync metrics and `NotionIngestAuditEntry` -> `IngressHandlerResult`
   - `ResolveWorkspaceResult` -> `IngressResolutionResult`
2. Define the minimal Cloud adoption steps:
   - wrap signature verification
   - wrap workspace resolution
   - register existing handlers
   - route through the SDK router
3. Explicitly state that Cloud adoption does not begin by deleting or moving the current Nango router.
4. Define rollback criteria so Cloud can stop after type-alignment proof if the adapter path exposes hidden coupling.

### Validation gates

- Every Cloud-to-SDK mapping is documented with no unresolved field mismatch.
- Any mismatch is captured as a blocker or deferral, not hidden in prose.
- No Cloud code migration is required to declare v1 SDK success.
- Adoption steps are additive wrappers around existing Cloud logic, not rewrites.
- The adoption plan names each Cloud-only concern that must remain out of the SDK.

### Exit criteria

- Cloud has a concrete, low-risk adoption path and the SDK slice is proven useful even if Cloud adoption happens later.

## 7. Phase 3: Review and remediation

### Goal

Close gaps, prevent scope creep, and leave the work ready for execution or merge.

### Tasks

1. Review all new docs and code against the no-shortcuts checklist.
2. Run the full validation set:
   - inbox-targeted tests
   - repo-wide tests if phase 1 code landed
   - doc cross-check for consistency between boundary, extraction, proof, implementation sequence, and adoption plan
3. Record any remediation items as explicit follow-ups rather than broadening v1.
4. Mark deferred topics for later phases:
   - retry wrapper
   - batch or streaming ingress
   - telemetry contract
   - provider adapter packages
   - auth lifecycle contract

### Validation gates

- `npx vitest run` passes if code changes were made in this workflow.
- All three source docs and all three follow-up docs agree on package target, boundaries, and exclusions.
- The v1 slice still excludes Cloud transport, provider parsing, DB persistence, forwarding, and relayfile writes.
- Review findings are either fixed or captured as explicit deferred follow-up work.

### Exit criteria

- The work is ready to hand off to immediate implementation and Cloud-adoption workflows without reopening architecture.

## 8. Immediate follow-up workflows

### Workflow A: `implement-v1-ingress-substrate`

Owner outcome:
- Create the inbox ingress files
- Add tests
- Run inbox and repo validation

Must not do:
- edit Cloud router logic
- add provider adapters
- widen the API beyond the approved surface

Completion gate:
- All phase 1 validation gates pass

### Workflow B: `prove-cloud-ingress-alignment`

Owner outcome:
- Write the Cloud mapping table
- Produce additive adoption steps
- Call out all Cloud-only concerns and blockers

Must not do:
- migrate production Cloud code into the SDK
- re-architect Nango parsing
- introduce runtime behavior changes

Completion gate:
- All phase 2 validation gates pass

### Workflow C: `review-v1-ingress-boundary`

Owner outcome:
- Check code and docs against the no-shortcuts checklist
- Verify deferred items remain deferred
- Capture remediation items cleanly

Must not do:
- expand scope to solve speculative future cases

Completion gate:
- All phase 3 validation gates pass

## 9. What not to do in v1

- Do not create a new ingress package.
- Do not move Cloud Nango code into the SDK.
- Do not introduce HTTP transport abstractions.
- Do not add provider-specific parsers, record normalizers, or storage writers.
- Do not add retry wrappers, batch ingress, or telemetry contracts.
- Do not modify existing inbox store or projector behavior.
- Do not treat Cloud adoption as a prerequisite for SDK success.

## 10. Decision rule

If a proposed task cannot be justified as one of:
- ingress contract definition
- minimal router dispatch
- envelope-to-inbox projection
- export wiring
- tests
- Cloud type-alignment proof
- additive adoption wrapper planning

then it is out of scope for v1 and must be deferred.

---

V1_TRUSTED_OUTSIDER_INGRESS_IMPLEMENTATION_SEQUENCE_READY
