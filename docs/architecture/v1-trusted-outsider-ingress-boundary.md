# v1 Trusted Outsider Ingress Boundary

**Date:** 2026-04-16
**Status:** DIRECTIONAL

## 1. Purpose

Define the first bounded trusted outsider ingress boundary for Agent Assistant. This document identifies the reusable ingress contracts that can be extracted from Cloud's proven Nango webhook handling and landed in the SDK's existing `@agent-assistant/inbox` package.

This is an Inbox-adjacent concern. It extends the existing Inbox primitive with ingress-layer contracts — the front door through which trusted external payloads arrive, get verified, get resolved to a workspace/assistant scope, get routed, and produce an outcome. The existing Inbox package owns the normalized item shape and downstream projectors (memory, enrichment). This boundary adds the upstream contracts that feed into that shape.

## 2. Relationship to existing primitives

### Inbox (exists, `@agent-assistant/inbox`)

Already owns:
- `InboxItem` normalized shape
- `InboxSourceTrust` metadata
- `InboxStore` adapter-backed persistence
- `InboxToMemoryProjector` and `InboxToEnrichmentProjector`
- Relay-native exclusion rule (`InboxRelayNativeSourceError`)

Does not yet own:
- Ingress envelope normalization
- Signature/trust verification contract
- Workspace/scope resolution contract
- Ingress routing and handler dispatch
- Ingress outcome semantics

### Relay-native communication (separate, stays separate)

Agents already on the Relay communicate through Relay-native coordination and messaging primitives (`@agent-assistant/connectivity`, `@agent-assistant/coordination`). The ingress boundary is explicitly for **trusted outsiders not on the Relay**. This separation must hold.

### Cloud Nango webhook handling (proving ground, not target shape)

Cloud's `nango-webhook-router.ts` and `workspace-identity-resolver.ts` are the proving case. They demonstrate real ingress patterns at production scale: envelope parsing, HMAC verification, workspace resolution with retry, provider-scoped routing, relayfile write outcomes. The contracts extracted here are generalizations of those patterns, not copies of the Nango-specific implementation.

## 3. Ingress contracts

### 3.1 Normalized Ingress Envelope

A provider-agnostic normalized representation of an inbound external payload, before it becomes an `InboxItem`.

```typescript
export interface IngressEnvelope {
  /** Provider identifier (e.g. 'github', 'slack', 'notion', 'linear', 'custom'). */
  provider: string;

  /** Event classification within the provider namespace. */
  eventType: string;

  /** Connection or session identifier from the external system. */
  connectionId: string | null;

  /** Provider-scoped configuration key, if applicable. */
  providerConfigKey: string;

  /** The normalized payload body. */
  payload: unknown;

  /** Raw metadata preserved for audit (headers, delivery ids, etc.). */
  rawMeta?: Record<string, unknown>;

  /** ISO timestamp of when this envelope was received at the ingress boundary. */
  receivedAt: string;
}
```

Cloud parallel: `NangoWebhookEnvelope` in `nango-webhook-router.ts`. The SDK contract generalizes `from` to `provider`, adds `eventType` as a first-class field (Cloud infers this from `type`), and adds `receivedAt` for downstream freshness.

### 3.2 Ingress Verifier Contract

A pluggable verification interface. Products supply the verification implementation; the SDK defines the contract shape.

```typescript
export type IngressVerificationResult =
  | { verified: true; trustLevel: 'verified' | 'trusted' }
  | { verified: false; reason: string };

export interface IngressVerifier {
  /**
   * Verify that an inbound payload is authentic and trusted.
   * Implementation is product-owned (HMAC, OAuth token check, allowlist, etc.).
   */
  verify(input: {
    rawBody: string;
    headers: Record<string, string>;
    provider: string;
    providerConfigKey: string;
  }): Promise<IngressVerificationResult> | IngressVerificationResult;
}
```

Cloud parallel: `verifyNangoWebhookSignature()` — HMAC-SHA256 and legacy SHA256 verification. The SDK contract abstracts over the specific crypto scheme.

### 3.3 Ingress Resolver Contract

Resolves an ingress envelope to a workspace and assistant scope. This is the identity resolution step — "who does this payload belong to?"

```typescript
export type IngressResolutionResult =
  | {
      resolved: true;
      workspaceId: string;
      assistantId?: string;
      resolvedVia: string;
      metadata?: Record<string, unknown>;
    }
  | {
      resolved: false;
      reason: string;
    };

export interface IngressResolver {
  /**
   * Resolve an ingress envelope to a workspace/assistant scope.
   * Implementation is product-owned (DB lookup, cache, config-based mapping, etc.).
   */
  resolve(envelope: IngressEnvelope): Promise<IngressResolutionResult>;
}
```

Cloud parallel: `resolveWorkspace()` in `workspace-identity-resolver.ts` — UUID fast-path, Slack team-id lookup, GitHub installation-id lookup. The SDK contract does not prescribe lookup strategy.

### 3.4 Ingress Router/Handler Contract

Routes a verified, resolved envelope to the appropriate handler. Handlers are product-registered; the SDK provides the dispatch contract and handler interface.

```typescript
export interface IngressHandlerResult {
  /** Whether the handler processed the envelope successfully. */
  handled: boolean;

  /** Optional outcome classification. */
  outcome?: 'written' | 'skipped' | 'partial' | 'error';

  /** Human-readable reason for skips or failures when relevant. */
  reason?: string;

  /** Summary metrics for observability. */
  metrics?: {
    itemsWritten?: number;
    itemsSkipped?: number;
    errorCount?: number;
    durationMs?: number;
  };

  /** Optional resulting inbox item (if the handler wrote one). */
  inboxItemId?: string;
}

export interface IngressHandler {
  /** Provider this handler serves. */
  provider: string;

  /** Optional event type filter. When absent, handles all events for the provider. */
  eventTypes?: string[];

  /** Handle a verified, resolved ingress envelope. */
  handle(input: {
    envelope: IngressEnvelope;
    resolution: IngressResolutionResult & { resolved: true };
  }): Promise<IngressHandlerResult>;
}

export interface IngressRouter {
  /** Register a handler for a provider/event-type combination. */
  register(handler: IngressHandler): void;

  /** Route a verified, resolved envelope to the matching handler. Never throws for handler failures; converts them into an error result. */
  route(input: {
    envelope: IngressEnvelope;
    resolution: IngressResolutionResult & { resolved: true };
  }): Promise<IngressHandlerResult>;
}
```

Cloud parallel: `routeNangoWebhook()` dispatches to `routeForwardEvent()`, `handleAuthEvent()`, `handleSyncEvent()` which further dispatch to provider-specific handlers (`routeGitHubSync()`, `routeSlackSync()`, `routeNotionSync()`, etc.). The SDK contract generalizes this into a registry-based dispatch.

Router rule for v1: the router must catch thrown handler errors and convert them into a deterministic `IngressHandlerResult` with `handled: false`, `outcome: 'error'`, and a human-readable `reason`. This keeps pipeline behavior boring and testable.

### 3.5 Ingress Outcome Semantics

All ingress operations produce a discriminated outcome. This is the standard return shape for the full ingress pipeline.

```typescript
export type IngressOutcome =
  | { ok: true; result: IngressHandlerResult; resolution: IngressResolutionResult & { resolved: true } }
  | { ok: false; stage: 'verification' | 'resolution' | 'routing' | 'handler'; reason: string };
```

## 4. What remains Cloud-only

These concerns are **not SDK-worthy** and must stay in product/platform code:

| Concern | Why Cloud-only |
|---|---|
| HTTP route transport (`POST /api/v1/webhooks/nango`) | Framework-specific (Next.js, Express, Lambda, etc.) |
| Environment/secret lookup (`getNangoSecretKey()`, `process.env`) | Deployment-specific |
| DB-backed workspace integration persistence (`workspace_integrations` table, `upsertWorkspaceIntegration`) | Cloud's data model |
| Hosted forwarding (`forwardToSage()`) | Product topology decision |
| Provider rollout glue (`NANGO_PROVIDER_TO_WORKSPACE_PROVIDER` mapping) | Cloud's provider inventory |
| Nango proxy/records client wiring (`getNangoProxyUrl()`, `fetchNangoRecords()`) | Cloud's Nango integration details |
| Relayfile write implementation (`createGitHubRelayfileClient()`) | Cloud's storage backend |
| Deployment/runtime workarounds (OpenNext `after()` avoidance) | Infrastructure-specific |
| Provider-specific sync record transformation (GitHub path computation, Slack message/thread/reply classification, Linear object normalization) | Provider-specific domain logic |
| Retry/polling strategies for workspace resolution | Cloud's consistency model |
| Notion adapter creation and bulk ingest orchestration | Provider-specific orchestration |

## 5. What is SDK-worthy now

These contracts are provider-agnostic, tested in Cloud production patterns, and composable with existing Inbox types:

| Contract | Rationale |
|---|---|
| `IngressEnvelope` type | Generalization of `NangoWebhookEnvelope`; every trusted outsider ingress needs a normalized envelope |
| `IngressVerifier` interface | Every ingress boundary needs pluggable verification; contract shape is stable |
| `IngressResolver` interface | Every ingress boundary needs scope resolution; result shape is stable |
| `IngressHandler` and `IngressHandlerResult` | Handler interface and outcome metrics are provider-agnostic |
| `IngressRouter` | Registry-based dispatch is a proven pattern in the Nango router |
| `IngressOutcome` | Pipeline-wide outcome semantics for observability and error attribution |
| `createIngressRouter()` factory | Minimal implementation: match by provider + eventType, dispatch, return outcome |
| `IngressEnvelope` -> `InboxWriteInput` projection utility | Bridges the ingress layer to the existing inbox store |

## 6. What is maybe-later

These are plausible SDK additions but lack sufficient proving or have open design questions:

| Candidate | Open question |
|---|---|
| Retry-with-backoff wrapper for resolution | Is the retry strategy generic enough, or always deployment-specific? |
| Batch/streaming ingress (sync record iteration) | Nango's `fetchNangoRecords` async generator is provider-specific; generic batch semantics need more proving |
| Ingress audit/observability contract | Shape is unclear — Cloud uses structured logging, other products may use different telemetry |
| Provider-specific envelope parsers (GitHub, Slack, etc.) | These are tightly coupled to provider payload shapes and belong in provider adapter packages, not the SDK |
| Auth event lifecycle (creation, revocation, credential rotation) | Cloud's auth event handling is deeply product-specific |

## 7. Package landing recommendation

**Extend `@agent-assistant/inbox`.** Do not create a new package.

Rationale:
- Ingress is the front door to the inbox. The ingress envelope is what arrives; the inbox item is what gets stored.
- The existing Inbox package already owns `InboxSourceTrust`, which the verifier contract feeds into.
- The existing Inbox package already owns `InboxWriteInput`, which the ingress-to-inbox projection targets.
- Exporting ingress contracts from `packages/inbox/src/index.ts` is part of the package-local surface only. Broader `@agent-assistant/sdk` facade re-exports are explicitly out of scope for v1 unless a later slice chooses to widen the public facade.
- The dependency graph stays clean: `inbox` depends on `turn-context` (existing), gains no new package dependencies.
- A separate `@agent-assistant/ingress` package would create a mandatory two-package import for every consumer, with no compensating benefit.

File organization within the package:

```
packages/inbox/src/
  types.ts            (existing — InboxItem, InboxStore, etc.)
  ingress-types.ts    (new — IngressEnvelope, IngressVerifier, IngressResolver, etc.)
  ingress-router.ts   (new — createIngressRouter() factory)
  ingress-projection.ts (new — envelope-to-InboxWriteInput projection)
  inbox.ts            (existing — createInboxStore)
  memory-projector.ts (existing)
  enrichment-projector.ts (existing)
  index.ts            (updated — add ingress re-exports)
```

## 8. Boundary rules

1. **Ingress is for trusted outsiders not on the Relay.** Same rule as Inbox.
2. **Verification is product-supplied.** The SDK defines the contract; products supply the HMAC/OAuth/allowlist implementation.
3. **Resolution is product-supplied.** The SDK defines the contract; products supply the DB/cache/config lookup.
4. **Handlers are product-registered.** The SDK provides dispatch; products register handlers per provider.
5. **The SDK does not hard-depend on any provider SDK.** No Nango, Slack, GitHub, or Notion imports in the inbox package.
6. **The whole Nango router does not move into the SDK.** Only the generalized contracts land here. Cloud keeps its provider-specific routing, sync handlers, and integration management.

## 9. Slice scope

This boundary authorizes:
- Adding ingress types to `@agent-assistant/inbox`
- Adding a minimal `createIngressRouter()` factory
- Adding an envelope-to-inbox projection utility
- Adding tests for the router and projection
- Updating `index.ts` re-exports

This boundary does not authorize:
- Moving any Cloud code into the SDK
- Adding provider-specific logic to the inbox package
- Creating a new SDK package
- Modifying any existing inbox types or behavior
- Adding dependencies beyond what `@agent-assistant/inbox` already has

---

V1_TRUSTED_OUTSIDER_INGRESS_BOUNDARY_READY
