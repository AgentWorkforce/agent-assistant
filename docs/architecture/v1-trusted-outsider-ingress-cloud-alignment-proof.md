# v1 Trusted Outsider Ingress Cloud Alignment Proof

**Date:** 2026-04-16
**Status:** WORKFLOW-READY
**Cloud proving source:** sibling repo `../cloud`

## 1. Purpose

Prove that Cloud's existing Nango webhook flow can adopt the v1 SDK ingress substrate from `@agent-assistant/inbox` without rewriting Cloud logic. This is a read-only proof: it maps the current Cloud route, envelope, verifier, resolver, router, handlers, and tests to the SDK contracts and explicitly identifies everything that must remain Cloud-owned.

## 2. Cloud evidence inspected

| Cloud file | Role in proof |
|---|---|
| `../cloud/packages/web/app/api/v1/webhooks/nango/route.ts` | HTTP transport, raw-body read, signature gate, parse, synchronous route execution |
| `../cloud/packages/web/lib/integrations/workspace-identity-resolver.ts` | Canonical workspace resolution contract and strategy |
| `../cloud/packages/web/lib/integrations/nango-webhook-router.ts` | Nango envelope parsing, verification, top-level dispatch, forward/auth/sync handlers |
| `../cloud/tests/nango-sync-relayfile.test.ts` | Behavioral proving cases for GitHub, Linear, Slack, Notion, unknown-provider sync handling |
| `packages/inbox/src/ingress-types.ts` | Locked SDK ingress type shapes |
| `packages/inbox/src/ingress-router.ts` | Locked SDK router behavior |
| `packages/inbox/src/ingress-projection.ts` | Optional projection helper available to Cloud |

## 3. Top-level responsibility mapping

| Cloud concept | Current Cloud owner | SDK counterpart | Adoption status |
|---|---|---|---|
| Webhook HTTP endpoint | `route.ts` | None | Cloud-only |
| Raw body and header access | `route.ts` | Input to `IngressVerifier.verify()` | Cloud-only transport feeds SDK contract |
| Signature verification | `verifyNangoWebhookSignature()` | `IngressVerifier` | Wrapper target |
| Nango envelope parsing | `parseNangoWebhookEnvelope()` | `IngressEnvelope` | Parsed shape maps; parser stays Cloud-only |
| Workspace resolution | `resolveWorkspace()` and sync/notion-specific lookup helpers | `IngressResolver` and `IngressResolutionResult` | Wrapper target for canonical resolver; sync/notion helpers stay Cloud-only |
| Event dispatch | `routeNangoWebhook()` | `IngressRouter.route()` | Wrapper target at seam |
| Provider/event handlers | `routeForwardEvent()`, `handleAuthEvent()`, `handleSyncEvent()`, provider-specific functions | `IngressHandler` | Wrapper targets; logic stays Cloud-only |
| Result semantics | logs, counters, notion audit entries | `IngressHandlerResult` and `IngressOutcome` | Mappable with Cloud adapters |
| Relayfile/integration persistence | relayfile clients, DB helpers, Nango client calls | None | Cloud-only |

## 4. Type mapping

### 4.1 `NangoWebhookEnvelope` -> `IngressEnvelope`

Cloud type:

```ts
type NangoWebhookEnvelope = {
  from: string;
  type: string;
  providerConfigKey: string;
  connectionId: string | null;
  payload: unknown;
}
```

SDK type:

```ts
interface IngressEnvelope {
  provider: string;
  eventType: string;
  connectionId: string | null;
  providerConfigKey: string;
  payload: unknown;
  rawMeta?: Record<string, unknown>;
  receivedAt: string;
}
```

| Cloud field/behavior | SDK field | Mapping | Cloud-only note |
|---|---|---|---|
| `from` | `provider` | direct string move after Cloud parsing/lowercasing | Cloud still owns `from` normalization and provider alias handling |
| `type` | `eventType` | direct string move | Cloud still owns Nango taxonomy validation via `NANGO_WEBHOOK_TYPES` |
| `connectionId` | `connectionId` | direct | Cloud still owns `connectionId` extraction from `connectionId` or `connection_id` |
| `providerConfigKey` | `providerConfigKey` | direct | Cloud still owns fallback to `getProviderConfigKey()` |
| `payload` | `payload` | direct | Cloud still owns forward-vs-top-level merge in `normalizePayload()` |
| not present | `rawMeta` | optional wrapper fill from request headers or delivery metadata | Cloud-only if omitted |
| not present | `receivedAt` | wrapper supplies `new Date().toISOString()` at seam | Cloud-owned timestamp production |

### 4.2 Verification mapping

| Cloud function/behavior | SDK counterpart | Mapping | Cloud-only note |
|---|---|---|---|
| `verifyNangoWebhookSignature(rawBody, headers, secretKey): boolean` | `IngressVerifier.verify()` | wrapper returns `{ verified: true, trustLevel: 'verified' }` on `true`, `{ verified: false, reason: 'Invalid signature' }` on `false` | HMAC header lookup, legacy SHA256 fallback, digest validation, and secret acquisition remain Cloud-only |
| `x-nango-hmac-sha256` precedence over `x-nango-signature` | `headers` input | wrapper passes raw header record unchanged | header naming remains Cloud-only |
| `route.ts` skips verification when no secret key exists | outside SDK verifier interface | keep in Cloud route above seam | secret lookup and optional-verification policy remain Cloud-only |

### 4.3 Resolution mapping

There are two Cloud resolution layers and only one maps cleanly to the SDK contract:

| Cloud resolver | SDK counterpart | Mapping | Status |
|---|---|---|---|
| `resolveWorkspace(input, { provider })` in `workspace-identity-resolver.ts` | `IngressResolver.resolve()` | clean contract mapping after a small envelope-to-input adapter | Wrapper target |
| `resolveWorkspaceIdForSync(provider, connectionId)` | none | connection-to-workspace lookup for sync handlers | Cloud-only |
| `resolveNotionWorkspaceIdWithRetry(...)` | none | notion-specific polling/retry and auth payload fallback | Cloud-only |

Canonical result mapping:

| Cloud `ResolveWorkspaceResult` | SDK `IngressResolutionResult` | Mapping | Cloud-only note |
|---|---|---|---|
| `{ ok: true, workspaceId, resolvedVia, integration }` | `{ resolved: true, workspaceId, resolvedVia, metadata? }` | `workspaceId` and `resolvedVia` direct; `integration` may be copied into `metadata.integration` if needed | exact `WorkspaceIntegrationRecord` stays Cloud-only |
| `{ ok: false, reason, error }` | `{ resolved: false, reason }` | `reason` direct | `error` code enum is Cloud-only unless copied into metadata for local logging only |

Envelope-to-resolver responsibility mapping for the future wrapper:

| Envelope/provider case | Cloud resolver input shape | Cloud owner |
|---|---|---|
| direct workspace-bound auth/forward event carrying workspace id | `{ workspaceId }` | Cloud payload mining via `readWorkspaceIdFromAuthPayload()` |
| Slack webhook identity | `{ slackTeamId }` | Cloud-only metadata extraction and `looksLikeSlackTeamId()` validation |
| GitHub webhook identity | `{ githubInstallationId }` | Cloud-only extraction and GitHub installation lookup |

## 5. Router and handler mapping

### 5.1 Top-level dispatch

| Cloud dispatch layer | SDK counterpart | Mapping | Cloud-only note |
|---|---|---|---|
| `routeNangoWebhook(envelope)` | `IngressRouter.route({ envelope, resolution })` | wrapper can replace switch dispatch with registered handlers keyed by provider + eventType | unsupported Nango type logging remains Cloud-owned if Cloud preserves `routeNangoWebhook` above seam |
| switch on `forward`, `auth`, `connection.created`, `sync` | handler registration with `eventTypes` | register Cloud wrappers for exact event types | Nango event taxonomy remains Cloud-only |

### 5.2 Handler mapping

| Cloud handler/function | Suggested SDK handler registration | Result mapping | Cloud-only behaviors preserved |
|---|---|---|---|
| `routeForwardEvent()` | `provider: '*' wrapper pattern is not available`; instead register per-provider forward wrappers or keep top-level Cloud dispatch for `forward` | usually `{ handled: true, outcome: 'written' | 'skipped' }` depending on downstream branch | hosted forwarding to Sage, Slack metadata repair, GitHub forward relayfile ingest, unknown-provider logging |
| `handleAuthEvent()` | register auth handlers by provider with `eventTypes: ['auth', 'connection.created']` | `{ handled: true, outcome: 'written' | 'skipped' }` plus optional metrics | provider resolution heuristics, deletion semantics, metadata enrichment, Nango connection detail lookup, DB upsert/delete |
| `handleSyncEvent()` | register sync handlers by provider with `eventTypes: ['sync']` | `{ handled: true, outcome: 'written' | 'partial' | 'skipped', metrics }` | provider branching, retry behavior, Nango records streaming, relayfile writes/deletes |
| `routeGitHubSync()` | GitHub sync handler | `metrics.itemsWritten = written`, `metrics.itemsSkipped` can represent deletes or unsupported records only if Cloud chooses; `metrics.errorCount = errors` | record iteration, repo parsing, model normalization, relayfile path computation, delete/write semantics |
| `routeLinearSync()` | Linear sync handler | same mapping pattern as GitHub | object type normalization and fallback path generation |
| `routeSlackSync()` | Slack sync handler | same mapping pattern as GitHub | channel/thread/reply classification and Slack path mapping |
| `routeNotionSync()` | Notion sync handler | `outcome` from audit result: `partial` when `errorCount > 0`, otherwise `written` | Notion adapter creation, supported-model checks, retry resolution, audit recording |
| `routeNotionAuthCreation()` | Notion auth-creation handler | `metrics` from `HandleNotionBulkIngestResult` | notion-specific auth creation ingest and subsequent integration upsert |

## 6. Result and metric mapping

### 6.1 `IngressHandlerResult`

| Cloud behavior/result source | SDK field | Mapping rule |
|---|---|---|
| handler completed normal path | `handled` | `true` |
| no matching provider branch / intentionally ignored event | `handled` + `outcome` | `false` + `'skipped'` or `true` + `'skipped'`; future Cloud workflow should choose one convention and keep it consistent |
| sync wrote files | `metrics.itemsWritten` | map from `written` counter |
| sync deleted files | no exact SDK field | remains Cloud-only unless counted in `itemsSkipped`; do not widen SDK surface |
| sync record failures | `metrics.errorCount` | map from `errors` counter |
| notion duration | `metrics.durationMs` | direct from notion audit result |
| notion partial success | `outcome` | `'partial'` when `errorCount > 0` |
| thrown handler exception | router-level error result | SDK router already converts throws to `{ handled: false, outcome: 'error', reason }` |

### 6.2 `IngressOutcome`

| Cloud stage | SDK outcome stage |
|---|---|
| signature failure in route | `verification` |
| resolver failure in wrapper path | `resolution` |
| missing handler / router mismatch | `routing` |
| handler exception or explicit error result | `handler` |

Cloud does not currently materialize a single pipeline-wide discriminated union. Adopting `IngressOutcome` would be additive wrapper behavior only.

## 7. Everything that remains Cloud-only

This section is exhaustive for the proving slice.

### 7.1 Fields and type details that remain Cloud-only

- `NangoWebhookEnvelope.from` as the raw Nango field name.
- `NangoWebhookEnvelope.type` as the raw Nango field name.
- `ResolveWorkspaceResult.error`.
- `ResolveWorkspaceSuccess.integration`.
- `WorkspaceIntegrationRecord` and all provider-specific metadata shapes.
- `NotionIngestAuditEntry` beyond the subset mapped into `IngressHandlerResult.metrics`.
- Slack/GitHub/Linear/Notion record shapes yielded by `fetchNangoRecords()`.
- GitHub forward payload header and delivery-id extraction details.

### 7.2 Behaviors that remain Cloud-only

- Next.js route transport, response bodies, and `runtime = "nodejs"`.
- Secret lookup via `getNangoSecretKey()` and `process.env.NANGO_SECRET_KEY`.
- Optional verification policy when no secret key is configured.
- `parseNangoWebhookEnvelope()` and all Nango payload normalization helpers.
- `NANGO_WEBHOOK_TYPES` and provider alias mapping through `NANGO_PROVIDER_TO_WORKSPACE_PROVIDER`.
- `verifyHexSignature()`, `verifyLegacyNangoSignature()`, and header precedence rules.
- `readWorkspaceIdFromAuthPayload()` heuristics.
- `resolveWorkspaceIdForSync()` retry loop.
- `resolveNotionWorkspaceIdWithRetry()` retry loop and auth-payload fallback.
- Slack identity repair and metadata enrichment.
- Nango connection-detail reads and provider config resolution.
- Relayfile path computation and write/delete implementation.
- Hosted forwarding to Sage.
- Logger calls and audit persistence.
- Test overrides such as `setNotionIngestTestOverrides()`.

## 8. Thin-wrapper feasibility proof

The minimum clean seam is:

1. Cloud route keeps `request.text()`, header access, secret lookup, parse, and verification policy.
2. Cloud converts `NangoWebhookEnvelope` into `IngressEnvelope`.
3. Cloud wrapper verifier delegates to `verifyNangoWebhookSignature()` only if Cloud wants the SDK pipeline to own that stage.
4. Cloud wrapper resolver delegates to `resolveWorkspace()` only for the identity cases it already supports cleanly.
5. Cloud registers existing provider/event handlers as `IngressHandler`s without moving their internal logic.
6. Cloud leaves sync-only connection resolution, notion retry logic, relayfile writes, forwarding, and DB persistence inside handler bodies.

This proves the SDK substrate is usable by Cloud as a seam contract, not as a replacement framework.

## 9. Concrete gaps and stop points

These are the exact places where a future Cloud workflow must stop rather than widening the SDK:

| Hidden coupling signal | Why it is a stop point |
|---|---|
| Cloud needs `deleted` as a first-class SDK metric field | the locked SDK result shape does not include it |
| Cloud needs Nango-specific event variants added to `IngressEnvelope` | that would Nango-shape the SDK |
| Cloud cannot express provider selection without `NANGO_PROVIDER_TO_WORKSPACE_PROVIDER` escaping into the SDK | provider aliasing is product inventory, not substrate |
| Cloud needs retry contracts in `IngressResolver` for sync/notion parity | retry policy is product-specific and currently outside the SDK boundary |
| Cloud needs HTTP request/response abstractions to preserve current route behavior | transport abstraction drift is prohibited |

## 10. Implementation readiness verdict

The alignment proof is sufficient for a later Cloud-only implementation workflow to author:

- one envelope conversion helper,
- one verifier adapter,
- one resolver adapter,
- a small handler registration module, and
- route wiring that preserves Cloud-owned behavior below and above the seam.

No SDK widening is required by the proof itself. The main implementation risk is not type mismatch; it is hidden coupling in sync/notion resolution and provider-specific routing precedence.

V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ALIGNMENT_READY
