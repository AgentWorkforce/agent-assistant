# v1 Trusted Outsider Ingress Cloud Rollback And Risk Checklist

**Date:** 2026-04-16
**Status:** WORKFLOW-READY

## 1. Purpose

Define the rollback criteria, hidden-coupling stop conditions, and merge checklist for any future Cloud workflow that wires the ingress substrate into the Nango webhook path.

## 2. Rollback posture

Cloud adoption is reversible only if the adapter path is additive. The rollback target is simple: remove the new wrapper/orchestrator call path and return to `route.ts -> routeNangoWebhook(envelope)` with no residual type, signature, or test-coupling changes.

## 3. Hard rollback criteria

Rollback immediately if any of the following becomes true:

1. Cloud route behavior changes for invalid signatures, parse failures, or accepted webhooks.
2. Any existing Cloud function signature is changed to match an SDK type.
3. Any existing Cloud handler is edited to return SDK-shaped results instead of its current Cloud-owned behavior.
4. A wrapper needs new SDK exports, new SDK fields, or changed SDK semantics.
5. Existing Cloud tests require broad rewrites rather than additive coverage.
6. Provider-specific storage behavior changes for GitHub, Linear, Slack, or Notion.
7. The pre-adoption execution path is deleted before equivalence is proven.

## 4. Hidden-coupling stop conditions

These are not “fix later” items. They are stop signals.

| Stop signal | Why adoption must pause |
|---|---|
| Cloud needs Nango event names or provider aliases embedded in SDK contracts | indicates substrate drift toward Nango-specific design |
| Cloud needs retry semantics on `IngressResolver` to preserve sync/notion behavior | retry policy belongs to Cloud consistency handling |
| Cloud needs deleted-file counts as a new SDK metric field | metric expansion would be adoption-driven SDK widening |
| Cloud cannot resolve auth events without exposing `WorkspaceIntegrationRecord` in SDK types | exposes Cloud data model into substrate |
| Cloud needs HTTP request/response abstractions in the SDK | violates transport boundary |
| Cloud handler wrappers begin owning logger, DB, or storage code | wrappers have stopped being wrappers |
| Cloud route wiring requires changing `parseNangoWebhookEnvelope()` or `verifyNangoWebhookSignature()` semantics | breaks additive adoption contract |

## 5. Risk inventory

### 5.1 High risk

| Risk | What to check |
|---|---|
| Provider precedence mismatch | verify wrapper registration preserves current `providerConfigKey`/`from` fallback ordering |
| Canonical resolver mismatch | verify `resolveWorkspace()` is used only where the envelope truly carries its expected identifiers |
| Sync resolution hidden in handlers | verify wrappers do not accidentally duplicate `resolveWorkspaceIdForSync()` |
| Notion special cases | verify `resolveNotionWorkspaceIdWithRetry()` and audit recording remain entirely inside notion handlers |

### 5.2 Medium risk

| Risk | What to check |
|---|---|
| Ambiguous `IngressHandlerResult.outcome` mapping | define one minimal convention and keep it stable |
| Header/raw metadata bloat | keep `rawMeta` optional and small; do not serialize arbitrary request state into the SDK envelope |
| Test false confidence | add auth and forward path coverage, not just sync coverage |

### 5.3 Low risk

| Risk | What to check |
|---|---|
| `receivedAt` timestamp differences | confirm no Cloud logic depends on a prior timestamp source |
| optional projection helper misuse | do not force `projectEnvelopeToInboxInput()` into handlers that do not need inbox writes |

## 6. Pre-implementation checklist

- `docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md` is unchanged and still accepted.
- `docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md` explicitly covers the target Cloud functions to wrap.
- sibling Cloud repo still contains the same route, resolver, router, and test entry points.
- no one is proposing SDK changes as part of the Cloud workflow.
- wrapper adoption work is scoped to `packages/web/` only.

## 7. During-implementation checklist

- every new wrapper file is thin delegation plus shape conversion only.
- every dropped Cloud-only field or behavior is documented.
- no existing Cloud function is renamed.
- no existing Cloud function signature is changed.
- no provider-specific logic is moved into shared SDK code.
- route wiring is introduced behind a reversible switch or side-by-side path.
- existing sync tests still pass before route wiring is enabled.

## 8. Verification checklist

### 8.1 Route equivalence

- invalid signature still returns `401`.
- invalid JSON or malformed envelope still returns `400`.
- accepted webhook still returns `200` with `accepted: true`.
- route still logs receipt and captures thrown errors.

### 8.2 Forward equivalence

- Slack forward still repairs integration metadata when possible.
- Slack forward still posts normalized payloads to Sage.
- GitHub forward still unwraps payload headers and delivery id, then writes through the relayfile client.
- Notion and Linear forward cases still log and no-op as before.

### 8.3 Auth equivalence

- failed auth operations still warn and stop.
- removal operations still delete existing integrations only.
- Slack auth metadata enrichment still happens in Cloud.
- Notion auth creation still runs bulk ingest plus integration upsert.

### 8.4 Sync equivalence

- failed syncs still short-circuit.
- GitHub sync still strips `_nango_metadata`, computes identical paths, and deletes on deleted records.
- Linear sync still preserves object-type normalization and fallback paths.
- Slack sync still distinguishes message, thread, thread reply, user, and channel shapes.
- Notion sync still uses its notion-specific adapter and audit behavior.

## 9. Rollback procedure for the future Cloud workflow

If adoption needs to be reverted:

1. switch the route back to `await routeNangoWebhook(envelope)`.
2. remove or disable the seam orchestrator call.
3. leave the existing Cloud route, parser, verifier, resolver, and handlers untouched.
4. keep any documentation and thin wrapper files for later review unless they interfere with tests.
5. rerun the pre-existing Cloud tests and the repo test suite.

A rollback is successful when no Cloud runtime behavior depends on the wrapper path anymore and the old route behavior is fully restored.

## 10. Merge gate verdict template

Use this exact decision logic in the future implementation workflow:

- `KEEP` when all equivalence checks pass and no hidden coupling appears.
- `PAUSE` when behavior is still equivalent but a blocked follow-up is needed before enabling the new path.
- `ROLLBACK` when any hard rollback criterion is triggered.

If the decision is `PAUSE` or `ROLLBACK`, the workflow must record:

- the exact coupling discovered,
- the specific file/function where it appeared,
- why the current SDK surface cannot absorb it safely, and
- whether the next action is Cloud-local redesign or a new boundary review.

V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_RISK_CHECKLIST_READY
