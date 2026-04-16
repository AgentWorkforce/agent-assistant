# v1 Trusted Outsider Ingress Extraction Map

**Date:** 2026-04-16
**Status:** DIRECTIONAL

## 1. Purpose

Map the Cloud Nango webhook handling code to the SDK ingress contracts defined in `v1-trusted-outsider-ingress-boundary.md`. For each Cloud function or pattern, classify it as: **SDK-worthy now**, **Cloud-only**, or **maybe-later**.

This document is the extraction reference. It tells an implementer exactly which Cloud patterns to generalize and which to leave alone.

## 2. Source files analyzed

| File | Role |
|---|---|
| `packages/web/app/api/v1/webhooks/nango/route.ts` | HTTP route handler (Next.js App Router) |
| `packages/web/lib/integrations/nango-webhook-router.ts` | Envelope parsing, signature verification, event routing, provider-specific handlers |
| `packages/web/lib/integrations/workspace-identity-resolver.ts` | Workspace identity resolution from external identifiers |
| `tests/nango-sync.test.ts` (referenced in context) | Sync handler test patterns |

## 3. Extraction map

### 3.1 Envelope parsing

| Cloud code | SDK contract | Classification |
|---|---|---|
| `parseNangoEnvelope()` / `parseNangoWebhookEnvelope()` | `IngressEnvelope` type | **SDK-worthy now** — the normalized envelope shape generalizes cleanly. The parsing logic itself stays Cloud-only (Nango payload structure is provider-specific). |
| `NangoWebhookEnvelope` type | `IngressEnvelope` type | **SDK-worthy now** — generalized as `IngressEnvelope` with `provider` replacing `from`, `eventType` added as first-class. |
| `NANGO_WEBHOOK_TYPES` constant | Not extracted | **Cloud-only** — Nango-specific event taxonomy. |
| `normalizeProvider()` | Not extracted | **Cloud-only** — maps Nango provider strings to `WorkspaceIntegrationProvider` enum. Provider inventory is product-owned. |
| `normalizeProviderConfigKey()`, `normalizeConnectionId()` | `IngressEnvelope.connectionId`, `IngressEnvelope.providerConfigKey` | **SDK-worthy now** — as fields on the envelope type, not as parsing functions. Parsing stays Cloud-owned. |
| `normalizePayload()` | `IngressEnvelope.payload` | **SDK-worthy now** — as a typed field. The normalization logic (forward vs. merged top-level) is Nango-specific and stays Cloud-owned. |
| `omitBaseNangoFields()` | Not extracted | **Cloud-only** — Nango payload structure detail. |

### 3.2 Signature verification

| Cloud code | SDK contract | Classification |
|---|---|---|
| `verifyNangoWebhookSignature()` | `IngressVerifier` interface | **SDK-worthy now** — the interface contract. The HMAC implementation stays Cloud-owned. |
| `verifyHexSignature()` | Not extracted | **Cloud-only** — crypto implementation detail. |
| `verifyLegacyNangoSignature()` | Not extracted | **Cloud-only** — Nango legacy compat. |
| `getHmacSignature()`, `getLegacySignature()` | Not extracted | **Cloud-only** — Nango header conventions. |
| `isHexDigest()` | Not extracted | **Cloud-only** — validation utility. |

### 3.3 Workspace identity resolution

| Cloud code | SDK contract | Classification |
|---|---|---|
| `resolveWorkspace()` (workspace-identity-resolver.ts) | `IngressResolver` interface | **SDK-worthy now** — the interface contract. The multi-strategy resolution logic stays Cloud-owned. |
| `ResolveWorkspaceInput` type | Consumed by product's `IngressResolver` implementation | **Cloud-only** — product-specific identifier fields. |
| `ResolveWorkspaceResult` type | `IngressResolutionResult` | **SDK-worthy now** — generalized discriminated union with `resolved: true/false`. |
| `ResolveWorkspaceSuccess.resolvedVia` | `IngressResolutionResult.resolvedVia` | **SDK-worthy now** — audit trail for how resolution happened. |
| UUID fast-path logic | Not extracted | **Cloud-only** — implementation strategy. |
| `findSlackIntegrationByTeamId()` | Not extracted | **Cloud-only** — provider-specific DB lookup. |
| `findWorkspaceIntegrationByInstallation()` | Not extracted | **Cloud-only** — provider-specific DB lookup. |
| `looksLikeSlackTeamId()`, `looksLikeUuid()` | Not extracted | **Cloud-only** — input validation. |
| Retry-with-backoff (`resolveNotionWorkspaceIdWithRetry`) | Not extracted | **Maybe-later** — retry strategy may generalize but needs more proving. |
| `readWorkspaceIdFromAuthPayload()` | Not extracted | **Cloud-only** — Nango payload structure mining. |

### 3.4 Event routing and dispatch

| Cloud code | SDK contract | Classification |
|---|---|---|
| `routeNangoWebhook()` | `IngressRouter.route()` | **SDK-worthy now** — the dispatch contract. The switch-on-type logic stays Cloud-owned. |
| `routeForwardEvent()` | `IngressHandler` implementation | **Cloud-only** — Nango forward event semantics. |
| `handleAuthEvent()` | `IngressHandler` implementation | **Cloud-only** — Nango auth lifecycle. |
| `handleSyncEvent()` | `IngressHandler` implementation | **Cloud-only** — Nango sync lifecycle. |
| Provider-specific sub-routing (`routeGitHubSync`, `routeSlackSync`, `routeLinearSync`, `routeNotionSync`) | `IngressHandler` implementations | **Cloud-only** — each is a product-registered handler. |
| `forwardToSage()` | Not extracted | **Cloud-only** — product topology. |
| `repairSlackIntegrationFromForwardEvent()` | Not extracted | **Cloud-only** — metadata repair is product-specific. |

### 3.5 Handler outcomes and metrics

| Cloud code | SDK contract | Classification |
|---|---|---|
| Sync handler logging (`written`, `deleted`, `errors` counters) | `IngressHandlerResult.metrics` | **SDK-worthy now** — the metrics shape generalizes across all sync-like handlers. |
| `NotionIngestAuditEntry` (outcome, filesWritten, errorCount, durationMs) | `IngressHandlerResult.metrics` and `.outcome` | **SDK-worthy now** — the audit shape maps directly to `IngressHandlerResult`. |
| Logger calls (`logger.info`, `logger.warn`) | Not extracted | **Cloud-only** — observability wiring is product-owned. |
| Test overrides (`setNotionIngestTestOverrides`) | Not extracted | **Cloud-only** — test infrastructure. |

### 3.6 Relayfile write operations

| Cloud code | SDK contract | Classification |
|---|---|---|
| `createGitHubRelayfileClient()` | Not extracted | **Cloud-only** — storage backend. |
| `client.writeFile()`, `client.deleteFile()` | Not extracted | **Cloud-only** — storage operations. Handlers are free to write to any backend. |
| `computePath()`, `computeGitHubPath()`, `computeSlackPath()`, `computeLinearPath()` | Not extracted | **Cloud-only** — provider-specific path conventions from `@relayfile/adapter-*`. |
| `normalizeWebhook()` | Not extracted | **Cloud-only** — GitHub payload normalization. |
| `stripNangoMetadata()`, `isDeletedNangoRecord()` | Not extracted | **Cloud-only** — Nango record cleanup. |

### 3.7 Integration management

| Cloud code | SDK contract | Classification |
|---|---|---|
| `upsertWorkspaceIntegration()` | Not extracted | **Cloud-only** — DB persistence. |
| `deleteWorkspaceIntegration()` | Not extracted | **Cloud-only** — DB persistence. |
| `findWorkspaceIntegrationByConnection()` | Not extracted | **Cloud-only** — DB lookup. |
| `findSlackIntegrationByConnectionId()` | Not extracted | **Cloud-only** — DB lookup. |
| `getNangoConnectionDetails()` | Not extracted | **Cloud-only** — Nango API call. |
| Slack identity resolution (`resolveSlackConnectionMetadata`, `mergeSlackConnectionIdentity*`) | Not extracted | **Cloud-only** — provider-specific identity enrichment. |

### 3.8 HTTP transport

| Cloud code | SDK contract | Classification |
|---|---|---|
| `POST /api/v1/webhooks/nango` route handler | Not extracted | **Cloud-only** — framework-specific. |
| `request.text()` / `request.headers` access | Not extracted | **Cloud-only** — Web API / framework specifics. |
| `NextResponse.json()` response construction | Not extracted | **Cloud-only** — Next.js specifics. |
| `export const runtime = "nodejs"` | Not extracted | **Cloud-only** — deployment configuration. |

## 4. Extraction summary

### SDK-worthy now (land in `@agent-assistant/inbox`)

| Artifact | Type | Source pattern |
|---|---|---|
| `IngressEnvelope` | Type | Generalized `NangoWebhookEnvelope` |
| `IngressVerifier` | Interface | Generalized `verifyNangoWebhookSignature` contract |
| `IngressVerificationResult` | Type | Discriminated union for verification outcome |
| `IngressResolver` | Interface | Generalized `resolveWorkspace` contract |
| `IngressResolutionResult` | Type | Generalized `ResolveWorkspaceResult` |
| `IngressHandler` | Interface | Generalized sync/forward/auth handler contract |
| `IngressHandlerResult` | Type | Generalized from sync metrics + Notion audit entries |
| `IngressRouter` | Interface + factory | Generalized `routeNangoWebhook` dispatch |
| `IngressOutcome` | Type | Pipeline-wide result |
| `projectEnvelopeToInboxInput()` | Utility function | Bridges `IngressEnvelope` + `IngressResolutionResult` to `InboxWriteInput` |

**Total new SDK surface: ~10 types/interfaces, 1 factory function, 1 projection utility.**

### Cloud-only (stays in product code)

- All HTTP route transport
- All env/secret lookup
- All DB-backed workspace integration persistence
- All hosted forwarding
- All provider-specific sync record transformation
- All Nango envelope parsing implementation
- All HMAC/signature verification implementation
- All workspace resolution implementation
- All provider-specific handler implementations
- All relayfile write operations
- All integration management (upsert, delete, find)
- All deployment/runtime workarounds
- All test override infrastructure

### Maybe-later

| Candidate | Blocking question |
|---|---|
| Retry wrapper for resolution | Need more than one product proving the same retry pattern |
| Batch/streaming ingress contract | Nango's async generator is tightly coupled; need a second batch source to generalize |
| Ingress audit/telemetry contract | No consensus on telemetry shape across products |
| Provider-specific envelope parsers | Belong in provider adapter packages, not SDK |
| Auth event lifecycle contract | Nango auth events are deeply product-specific |

## 5. Dependency impact

Adding ingress types and the router factory to `@agent-assistant/inbox` requires:
- **No new package dependencies.** All ingress types are self-contained or reference existing inbox types.
- **No changes to existing inbox types.** `InboxWriteInput`, `InboxSourceTrust`, etc. remain unchanged.
- **No changes to existing projectors.** Memory and enrichment projectors operate on `InboxItem`, which is downstream of ingress.

The projection utility (`projectEnvelopeToInboxInput`) depends on `IngressEnvelope`, `IngressResolutionResult`, and `InboxWriteInput` — all within the same package.

---

V1_TRUSTED_OUTSIDER_INGRESS_EXTRACTION_MAP_READY
