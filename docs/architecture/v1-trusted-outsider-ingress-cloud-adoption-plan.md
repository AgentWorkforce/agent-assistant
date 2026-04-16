# v1 Trusted Outsider Ingress Cloud Adoption Plan

**Date:** 2026-04-16
**Status:** WORKFLOW-READY

## 1. Purpose

Define how Cloud can adopt the v1 ingress substrate after the SDK contracts exist, using Nango webhook handling as the proving case without rewriting or relocating Cloud code.

## 2. Adoption posture

- Cloud is the proving case, not the source of truth for SDK design.
- Adoption is additive and wrapper-based.
- Existing Cloud behavior must remain stable during the first adoption pass.
- Cloud can stop after type-alignment proof if adapter wiring exposes hidden product coupling.

## 3. Preconditions

- The v1 SDK ingress substrate exists in `@agent-assistant/inbox`.
- Router and projection tests pass in the inbox package.
- The boundary, extraction map, proof plan, and implementation sequence docs agree on scope.

## 4. Cloud adoption sequence

### Phase A: Read-only alignment proof

Goal:
- Prove Cloud's Nango ingress can be expressed through the SDK contracts.

Tasks:
1. Map `NangoWebhookEnvelope` to `IngressEnvelope`.
2. Map `verifyNangoWebhookSignature()` to `IngressVerifier`.
3. Map `resolveWorkspace()` to `IngressResolver`.
4. Map existing forward, auth, and sync handlers to `IngressHandler`.
5. Map handler metrics and audit entries to `IngressHandlerResult`.
6. Map `ResolveWorkspaceResult` to `IngressResolutionResult`.

Validation gates:
- Every field mapping is explicit.
- Every unmapped field is called out as Cloud-only or a blocker.
- No code changes are required to complete this phase.

Exit criteria:
- Cloud alignment is documented well enough that adapter work can begin without guessing.

### Phase B: Add wrapper adapters around existing Cloud logic

Goal:
- Introduce SDK-shaped wrappers while preserving current Cloud execution paths.

Tasks:
1. Implement a Cloud-owned verifier adapter that satisfies `IngressVerifier` by delegating to `verifyNangoWebhookSignature()`.
2. Implement a Cloud-owned resolver adapter that satisfies `IngressResolver` by delegating to `resolveWorkspace()`.
3. Wrap existing provider/event handlers behind `IngressHandler` registrations.
4. Use the SDK router as a dispatcher over existing handler logic rather than rewriting that logic.

Validation gates:
- Wrapper code does not alter signature verification semantics.
- Wrapper code does not alter workspace-resolution strategy or fallback order.
- Existing provider-specific handlers stay in Cloud-owned modules.
- Router registration preserves current routing precedence where relevant.

Exit criteria:
- Cloud has SDK-compatible adapters with behavior equivalent to the pre-adoption flow.

### Phase C: Wire the route through the adapter stack

Goal:
- Introduce the new ingress substrate into the Cloud webhook path in a controlled way.

Tasks:
1. Keep current request parsing in the existing HTTP route or Nango router layer.
2. Convert the parsed Cloud envelope into `IngressEnvelope`.
3. Call the Cloud-owned verifier and resolver adapters.
4. Dispatch through the SDK router.
5. Keep existing product-specific persistence, forwarding, and relayfile writes behind the handlers.

Validation gates:
- HTTP route shape and deployment configuration remain unchanged.
- Environment and secret lookup remain Cloud-owned.
- Provider-specific data access, transformation, and storage logic remain Cloud-owned.
- End-to-end results for representative Nango webhook cases remain unchanged.

Exit criteria:
- Cloud is using the SDK contracts at the seam without an architecture rewrite.

### Phase D: Review and rollback decision

Goal:
- Decide whether the adapter path is clean enough to keep or whether adoption should pause at documentation proof.

Tasks:
1. Review coupling exposed by the adapters.
2. Check whether any supposedly reusable contract turned out to be Nango-shaped.
3. Capture required SDK refinements as explicit follow-up work.
4. If necessary, stop and keep the SDK substrate independent while Cloud remains on the old route.

Validation gates:
- Any contract mismatch is documented as a follow-up or blocker.
- No emergency widening of the SDK surface is allowed to save the first Cloud adoption pass.
- The SDK substrate remains independently useful even if this phase ends with adoption paused.

Exit criteria:
- Cloud either has a safe additive adoption or a cleanly documented decision to defer further integration.

## 5. Exact Cloud-only boundaries

These remain out of the SDK during Cloud adoption:

- HTTP route transport and framework response handling
- environment and secret lookup
- `workspace_integrations` persistence and lookup strategy
- Nango API calls and proxy wiring
- hosted forwarding behavior
- provider-specific sync record transformation
- relayfile write and delete operations
- deployment/runtime workarounds
- retry-with-backoff behavior
- test-only overrides and fixture plumbing

## 6. What not to do during Cloud adoption

- Do not replace the current Nango route with a fresh ingress framework.
- Do not move `nango-webhook-router.ts` wholesale into `@agent-assistant/inbox`.
- Do not generalize provider-specific parsing into the SDK.
- Do not collapse Cloud data-model lookups into generic SDK resolution logic.
- Do not add a batch-ingress or telemetry abstraction as part of initial adoption.
- Do not use Cloud adoption pressure to widen the v1 SDK surface beyond the approved substrate.

## 7. Review checklist for adoption owners

- Is each adapter a thin wrapper over existing Cloud logic rather than a rewrite?
- Is every provider-specific branch still implemented in Cloud-owned code?
- Does the route still behave the same for auth, forward, and sync events?
- Are all Cloud-only concerns still outside the SDK?
- If a mismatch exists, is it documented instead of hidden behind ad hoc API expansion?

## 8. Success definition

Cloud adoption is successful if:

- the SDK ingress contracts can describe the existing Cloud flow,
- wrappers can be added without behavior regressions,
- Cloud-only concerns stay Cloud-only, and
- the SDK remains a clean reusable substrate rather than a disguised Nango extraction.

Cloud adoption is not required to declare the v1 SDK slice successful. It is a proving step and a readiness signal for future broader ingress work.

---

V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_READY
