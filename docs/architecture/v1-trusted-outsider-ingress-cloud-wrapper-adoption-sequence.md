# v1 Trusted Outsider Ingress Cloud Wrapper Adoption Sequence

**Date:** 2026-04-16
**Status:** WORKFLOW-READY

## 1. Purpose

Define the thinnest possible Cloud adoption sequence for the locked ingress substrate. This sequence assumes the SDK surface in `@agent-assistant/inbox` is already present and that Cloud code edits will happen in a later workflow.

## 2. Thin-wrapper principle

Every adoption step must satisfy all of these constraints:

- Add new Cloud files before modifying existing Cloud files where possible.
- Delegate to existing Cloud functions; do not move logic out of `nango-webhook-router.ts`, `workspace-identity-resolver.ts`, or `route.ts`.
- Keep each wrapper under roughly 30 lines of non-comment logic.
- Convert shapes only; do not reinterpret business semantics.
- Stop immediately if preserving behavior requires new SDK exports or Cloud function signature changes.

## 3. Target wrapper set

| Wrapper | Owns | Delegates to | Must not absorb |
|---|---|---|---|
| `toIngressEnvelope()` | `NangoWebhookEnvelope` -> `IngressEnvelope` conversion | `parseNangoWebhookEnvelope()` remains upstream | parsing, provider normalization, payload normalization |
| `CloudNangoIngressVerifier` | `IngressVerifier` interface | `verifyNangoWebhookSignature()` | secret lookup, header sourcing, policy for missing secret |
| `CloudCanonicalIngressResolver` | `IngressResolver` interface | `resolveWorkspace()` | sync connection lookup, notion retry logic |
| `registerCloudNangoIngressHandlers(router)` | handler registration only | existing forward/auth/sync functions | provider-specific storage or metadata logic |
| `routeCloudNangoViaIngress()` | seam orchestration | wrappers above + `createIngressRouter()` | HTTP response handling |

## 4. Sequence

### Phase 0: Freeze the proving target

Do this before any Cloud edit:

1. Re-read the locked contract and this sequence.
2. Snapshot current behavior from `../cloud/tests/nango-sync-relayfile.test.ts`.
3. Add explicit implementation notes for any additional Cloud tests needed for `forward` and `auth`.

Exit criteria:
- no SDK changes are proposed,
- target functions to wrap are unchanged, and
- behavioral expectations are written down.

### Phase 1: Add pure shape adapters in new Cloud files

Create new Cloud-owned files only:

1. `toIngressEnvelope(envelope, rawMeta?)`
2. `fromResolveWorkspaceResult(result)`
3. `fromSyncCountersToHandlerResult(input)`
4. `fromNotionAuditToHandlerResult(input)`

Requirements:
- no imports from Cloud route transport code except types,
- no logger calls,
- no DB calls,
- no Nango API calls.

Exit criteria:
- every adapter is mechanical shape conversion only,
- every Cloud-only field dropped by the adapter is documented inline or in doc comments.

### Phase 2: Add verifier and resolver wrappers

Create two new wrappers:

1. `CloudNangoIngressVerifier.verify({ rawBody, headers, provider, providerConfigKey })`
2. `CloudCanonicalIngressResolver.resolve(envelope)`

Wrapper rules:
- verifier calls `verifyNangoWebhookSignature(rawBody, headers, secretKey)` and only converts boolean to SDK result.
- resolver converts `IngressEnvelope` into `ResolveWorkspaceInput` plus `{ provider }`, calls `resolveWorkspace()`, then converts the result shape.
- if the envelope does not carry enough information for canonical `resolveWorkspace()`, return `{ resolved: false, reason }`; do not smuggle sync/notion retry behavior into the wrapper.

Exit criteria:
- verifier semantics match current route behavior when the route chooses to invoke it,
- resolver wrapper remains canonical and narrow,
- sync/notion resolution is still owned by existing handler internals.

### Phase 3: Register existing Cloud handlers behind SDK interfaces

Create a registration module that binds the current Cloud behavior to SDK handlers.

Recommended registration shape:

| Handler registration | Delegates to |
|---|---|
| provider family `github`, event `sync` | `handleSyncEvent()` or a tiny GitHub sync-specific wrapper |
| provider family `linear`, event `sync` | `handleSyncEvent()` or a tiny Linear sync-specific wrapper |
| provider family `slack-*`, event `sync` | `handleSyncEvent()` or a tiny Slack sync-specific wrapper |
| provider family `notion`, event `sync` | `handleSyncEvent()` |
| provider family `*`, events `auth`, `connection.created` | `handleAuthEvent()` |
| provider family `*`, event `forward` | `routeForwardEvent()` |

Result rules:
- wrappers return `IngressHandlerResult` derived from existing counters/audit entries when available.
- if the delegated Cloud function only logs and returns `void`, the wrapper returns a minimal success result such as `{ handled: true, outcome: 'written' }` or `{ handled: true, outcome: 'skipped' }` based on the branch taken.
- do not add new business branching to produce prettier SDK results.

Exit criteria:
- handler registration order is explicit and deterministic,
- no provider-specific logic moved out of existing functions.

### Phase 4: Add a seam orchestrator without touching the route yet

Create one Cloud-only orchestrator function:

```ts
async function routeCloudNangoViaIngress(input: {
  rawBody: string
  headers: Record<string, string>
  parsedEnvelope: NangoWebhookEnvelope
  receivedAt: string
}): Promise<IngressOutcome>
```

Orchestrator responsibilities:

1. convert parsed envelope to `IngressEnvelope`
2. optionally call wrapper verifier if the route chooses to centralize verification there
3. call wrapper resolver only when the event path needs canonical workspace resolution
4. dispatch through `createIngressRouter()`
5. return `IngressOutcome`

Orchestrator must not:

- read `request` objects,
- read env vars,
- build HTTP responses,
- perform provider-specific writes directly.

Exit criteria:
- orchestrator is independently testable,
- existing route is still untouched.

### Phase 5: Route wiring behind a reversible branch

Only after Phases 1-4 pass review:

1. keep current `route.ts` raw-body read, secret lookup, and parse path.
2. replace `await routeNangoWebhook(envelope)` with a reversible conditional call to the seam orchestrator.
3. preserve current logging and `accepted: true` response semantics.
4. retain the pre-adoption call path until equivalence is proven.

Recommended temporary switch:
- local constant or feature flag in Cloud code,
- default to current route until equivalence evidence exists.

Exit criteria:
- reverting the route wiring restores pre-adoption behavior by deleting the new call site only,
- no existing Cloud function signature changed.

## 5. Exact field handoff in the future seam

| Source | Destination | Rule |
|---|---|---|
| `parsedEnvelope.from` | `IngressEnvelope.provider` | direct |
| `parsedEnvelope.type` | `IngressEnvelope.eventType` | direct |
| `parsedEnvelope.connectionId` | `IngressEnvelope.connectionId` | direct |
| `parsedEnvelope.providerConfigKey` | `IngressEnvelope.providerConfigKey` | direct |
| `parsedEnvelope.payload` | `IngressEnvelope.payload` | direct |
| normalized header record | `IngressEnvelope.rawMeta.headers` or omitted | optional; keep small |
| route timestamp | `IngressEnvelope.receivedAt` | direct |

## 6. Behaviors that must remain unchanged during adoption

- `route.ts` still returns `401` for invalid signatures and `400` for parse failures.
- `route.ts` still routes synchronously before returning `200`.
- unsupported Nango webhook types still warn and no-op.
- `handleSyncEvent()` still skips failed syncs on `success === false`.
- GitHub, Linear, Slack, and Notion sync branches still use existing record iteration and storage paths.
- auth removal still deletes the integration row only when a matching integration exists.
- Slack forward still repairs metadata then forwards to Sage.

## 7. Stop conditions inside the sequence

Pause the workflow immediately if any of these occur:

- a wrapper needs to know about `workspace_integrations` table details directly.
- a wrapper needs retry loops to mimic current sync/notion behavior.
- handler registration cannot preserve current provider precedence without encoding Nango taxonomy into the SDK.
- adapter code starts growing past thin delegation and shape conversion.
- a reviewer asks for new SDK exports to make Cloud fit.

## 8. Minimum evidence package before merge

- current Cloud sync tests still pass unchanged.
- new wrapper tests prove shape conversion only.
- route-level tests cover invalid signature, parse failure, and accepted webhook success.
- one trace each for `forward`, `auth`, and `sync` shows no observable behavior regression.
- rollback step is documented and tested on the route call site.

## 9. Non-goals

- no Cloud source migration into `@agent-assistant/inbox`
- no provider-parser extraction
- no transport abstraction
- no retry abstraction
- no audit-contract expansion
- no Cloud code edits in this documentation step

V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_WRAPPER_SEQUENCE_READY
