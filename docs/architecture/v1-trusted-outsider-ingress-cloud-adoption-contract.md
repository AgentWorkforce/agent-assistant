# v1 Trusted Outsider Ingress Cloud Adoption Contract

**Date:** 2026-04-16
**Status:** LOCKED
**Proving case:** Cloud Nango webhook handling

## 1. Purpose

Lock the exact terms under which Cloud may adopt the v1 SDK ingress substrate from `@agent-assistant/inbox`, using the Nango webhook flow as the proving case. This contract defines what Cloud can touch, what Cloud must not touch, and the validation gates that govern any later workflow that edits Cloud code to wire in the SDK contracts.

This contract is a companion to the v1 Trusted Outsider Ingress Implementation Contract. That contract governs the SDK side. This contract governs the Cloud side.

## 2. Adoption posture

Cloud adoption is **additive and wrapper-based**. The rules:

1. **No rewrite.** Cloud's existing Nango webhook handling (`nango-webhook-router.ts`, `workspace-identity-resolver.ts`, `route.ts`) continues to function exactly as-is. Adoption means adding thin SDK-shaped adapters that delegate to existing Cloud logic, not replacing that logic.

2. **No migration.** The existing Cloud execution path is the production path. The SDK-adapted path is introduced alongside it, not instead of it. Cloud may switch over after the adapter path proves behaviorally equivalent, but that switchover is a separate decision outside this contract.

3. **Cloud can stop at any phase.** If adapter wiring exposes hidden product coupling — meaning a Cloud concern that the SDK contracts cannot describe without SDK surface expansion — Cloud pauses adoption and documents the mismatch. The SDK substrate remains independently useful regardless.

4. **Cloud is the proving case, not the source of truth.** The SDK contracts were generalized from Cloud patterns but are not shaped by Cloud's ongoing evolution. If Cloud's webhook handling diverges from the SDK contracts, Cloud adapts its wrappers — the SDK does not chase Cloud.

5. **This slice is read-proof plus adoption-plan oriented.** Unless a later workflow explicitly authorizes Cloud code edits, this contract permits only documentation work (type alignment proof, field mapping tables) and adapter design. No Cloud source files are modified under this contract alone.

## 3. SDK substrate available for adoption

The following artifacts exist in `@agent-assistant/inbox` and are available for Cloud to adopt:

### Types and interfaces (9)

| Artifact | Kind | Cloud parallel |
|---|---|---|
| `IngressEnvelope` | Interface | `NangoWebhookEnvelope` |
| `IngressVerificationResult` | Discriminated union | Return shape of `verifyNangoWebhookSignature()` |
| `IngressVerifier` | Interface | `verifyNangoWebhookSignature()` signature |
| `IngressResolutionResult` | Discriminated union | `ResolveWorkspaceResult` |
| `IngressResolver` | Interface | `resolveWorkspace()` signature |
| `IngressHandlerResult` | Interface | Sync handler metrics + `NotionIngestAuditEntry` |
| `IngressHandler` | Interface | Provider-specific sync/forward/auth handlers |
| `IngressRouter` | Interface | `routeNangoWebhook()` dispatch shape |
| `IngressOutcome` | Discriminated union | Pipeline-wide result (no direct Cloud parallel yet) |

### Runtime artifacts (2)

| Artifact | Kind | Purpose |
|---|---|---|
| `createIngressRouter()` | Factory function | Registry-based dispatch; replaces `switch`-on-type if adopted |
| `projectEnvelopeToInboxInput()` | Projection utility | Convenience bridge from ingress envelope to `InboxWriteInput` |

## 4. Cloud-only boundaries

These concerns are **permanently Cloud-owned** and must not move into the SDK during adoption or at any later point under this contract. Any workflow that proposes moving these into `@agent-assistant/inbox` or any other SDK package requires a new boundary document and review.

### 4.1 HTTP transport

| Concern | Cloud location | Why Cloud-only |
|---|---|---|
| Next.js App Router route handler | `route.ts` | Framework-specific; other products use Express, Lambda, etc. |
| `request.text()` / `request.headers` access | `route.ts` | Web API specifics |
| `NextResponse.json()` response construction | `route.ts` | Next.js specifics |
| `export const runtime = "nodejs"` | `route.ts` | Deployment configuration |

### 4.2 Environment and secrets

| Concern | Cloud location | Why Cloud-only |
|---|---|---|
| `getNangoSecretKey()` | `nango-service.ts` | Deployment-specific secret management |
| `process.env.NANGO_SECRET_KEY` | `route.ts` | Environment variable access |
| `optionalEnv()` | `env.ts` | Cloud's env helper |
| `getNangoHost()` | `nango-service.ts` | Cloud's Nango host configuration |

### 4.3 Signature verification implementation

| Concern | Cloud location | Why Cloud-only |
|---|---|---|
| `verifyNangoWebhookSignature()` | `nango-webhook-router.ts` | HMAC-SHA256 + legacy SHA256; crypto scheme is Nango-specific |
| `verifyHexSignature()` | `nango-webhook-router.ts` | Timing-safe comparison implementation |
| `verifyLegacyNangoSignature()` | `nango-webhook-router.ts` | Nango legacy compat |
| `getHmacSignature()` / `getLegacySignature()` | `nango-webhook-router.ts` | Nango header conventions |

### 4.4 Workspace identity resolution implementation

| Concern | Cloud location | Why Cloud-only |
|---|---|---|
| `resolveWorkspace()` full implementation | `workspace-identity-resolver.ts` | Multi-strategy resolution with UUID fast-path, Slack team-id, GitHub installation-id |
| `findSlackIntegrationByTeamId()` | `workspace-integrations.ts` | Provider-specific DB lookup |
| `findWorkspaceIntegrationByInstallation()` | `workspace-integrations.ts` | Provider-specific DB lookup |
| `findWorkspaceIntegrationByConnection()` | `workspace-integrations.ts` | Provider-scoped DB lookup |
| `resolveNotionWorkspaceIdWithRetry()` | `nango-webhook-router.ts` | Retry strategy with polling |
| `resolveWorkspaceIdForSync()` | `nango-webhook-router.ts` | Retry strategy with polling |
| `readWorkspaceIdFromAuthPayload()` | `nango-webhook-router.ts` | Nango payload structure mining |

### 4.5 Envelope parsing implementation

| Concern | Cloud location | Why Cloud-only |
|---|---|---|
| `parseNangoEnvelope()` / `parseNangoWebhookEnvelope()` | `nango-webhook-router.ts` | Nango payload structure is provider-specific |
| `normalizeProvider()` | `nango-webhook-router.ts` | Cloud's provider inventory |
| `normalizePayload()` | `nango-webhook-router.ts` | Nango forward vs. merged top-level logic |
| `omitBaseNangoFields()` | `nango-webhook-router.ts` | Nango payload structure detail |
| `NANGO_WEBHOOK_TYPES` constant | `nango-webhook-router.ts` | Nango-specific event taxonomy |
| `NANGO_PROVIDER_TO_WORKSPACE_PROVIDER` mapping | `nango-webhook-router.ts` | Cloud's provider mapping table |

### 4.6 Provider-specific handler implementations

| Concern | Cloud location | Why Cloud-only |
|---|---|---|
| `routeForwardEvent()` | `nango-webhook-router.ts` | Nango forward event semantics |
| `handleAuthEvent()` | `nango-webhook-router.ts` | Nango auth lifecycle |
| `handleSyncEvent()` | `nango-webhook-router.ts` | Nango sync lifecycle |
| `routeGitHubSync()` | `nango-webhook-router.ts` | GitHub-specific record transformation and relayfile write |
| `routeSlackSync()` | `nango-webhook-router.ts` | Slack message/thread/reply classification |
| `routeLinearSync()` | `nango-webhook-router.ts` | Linear object normalization |
| `routeNotionSync()` / `routeNotionAuthCreation()` | `nango-webhook-router.ts` | Notion adapter orchestration |
| `handleGitHubForward()` | `nango-webhook-router.ts` | GitHub forward webhook processing |
| `forwardToSage()` | `nango-webhook-router.ts` | Product topology decision |

### 4.7 Data persistence and storage

| Concern | Cloud location | Why Cloud-only |
|---|---|---|
| `upsertWorkspaceIntegration()` | `workspace-integrations.ts` | Cloud's DB model |
| `deleteWorkspaceIntegration()` | `workspace-integrations.ts` | Cloud's DB model |
| `createGitHubRelayfileClient()` | `github-relayfile.ts` | Cloud's storage backend |
| `client.writeFile()` / `client.deleteFile()` | Relayfile client | Cloud's storage operations |
| `computeGitHubPath()`, `computeSlackPath()`, `computeLinearPath()` | `@relayfile/adapter-*` | Provider-specific path conventions |

### 4.8 Infrastructure and test concerns

| Concern | Cloud location | Why Cloud-only |
|---|---|---|
| `after()` avoidance (OpenNext/Lambda) | `route.ts` comment | Deployment-specific workaround |
| `setNotionIngestTestOverrides()` | `nango-webhook-router.ts` | Cloud's test infrastructure |
| `fetchNangoRecords()` async generator | `@relayfile/provider-nango` | Nango API integration |
| Slack identity resolution and metadata repair | `slack-identity.ts`, `nango-slack.ts` | Provider-specific identity enrichment |

## 5. Exact adoption seam

Cloud may adopt the SDK ingress substrate at the following seam — the boundary between Cloud's HTTP/parsing layer and Cloud's routing/handling layer:

```
Cloud HTTP route (route.ts)
  |
  v
Cloud envelope parsing (parseNangoWebhookEnvelope)
  |
  v
Cloud signature verification (verifyNangoWebhookSignature)
  |
  v
  ╔══════════════════════════════════════════════════════════════╗
  ║  ADOPTION SEAM — this is where SDK contracts may be wired  ║
  ╠══════════════════════════════════════════════════════════════╣
  ║                                                            ║
  ║  1. Convert NangoWebhookEnvelope → IngressEnvelope         ║
  ║  2. Wrap verifyNangoWebhookSignature in IngressVerifier    ║
  ║  3. Wrap resolveWorkspace in IngressResolver               ║
  ║  4. Register existing handlers as IngressHandler impls     ║
  ║  5. Dispatch through createIngressRouter()                 ║
  ║  6. Optionally use projectEnvelopeToInboxInput()           ║
  ║                                                            ║
  ╚══════════════════════════════════════════════════════════════╝
  |
  v
Cloud handler implementations (routeGitHubSync, routeSlackSync, etc.)
  |
  v
Cloud persistence (relayfile writes, workspace integration upserts)
```

### Seam rules

1. **Above the seam** (HTTP transport, raw body access, secret lookup, envelope parsing, signature bytes) stays Cloud-owned. The SDK does not abstract HTTP or crypto.

2. **At the seam** (envelope conversion, verifier/resolver wrapping, handler registration, router dispatch) is where Cloud introduces SDK-shaped adapters. Each adapter is a thin wrapper that delegates to the existing Cloud function.

3. **Below the seam** (provider-specific handler logic, DB lookups, relayfile writes, Nango API calls) stays Cloud-owned. The SDK's `IngressHandler.handle()` is the entry point; everything inside the handler is Cloud's business.

### Field mapping at the seam

| `NangoWebhookEnvelope` field | `IngressEnvelope` field | Conversion |
|---|---|---|
| `from` | `provider` | Direct (already lowercase-trimmed) |
| `type` | `eventType` | Direct |
| `connectionId` | `connectionId` | Direct (nullable) |
| `providerConfigKey` | `providerConfigKey` | Direct |
| `payload` | `payload` | Direct |
| *(not present)* | `rawMeta` | Cloud may populate from headers if desired |
| *(not present)* | `receivedAt` | Cloud supplies `new Date().toISOString()` at parse time |

| `ResolveWorkspaceResult` variant | `IngressResolutionResult` variant | Conversion |
|---|---|---|
| `ok: true` | `resolved: true` | `workspaceId` maps directly; `resolvedVia` maps directly; `integration` is Cloud-only metadata |
| `ok: false` | `resolved: false` | `reason` maps directly |

## 6. Prohibited actions

The following actions are explicitly forbidden under this contract and any workflow that references it:

### 6.1 Wholesale router migration

**Forbidden:** Moving `routeNangoWebhook()`, `handleSyncEvent()`, `handleAuthEvent()`, `routeForwardEvent()`, or any provider-specific routing function from `nango-webhook-router.ts` into `@agent-assistant/inbox` or any SDK package.

**Why:** These functions contain product-specific dispatch logic (provider enum matching, Nango event taxonomy, hosted forwarding decisions) that is not generalizable. The SDK provides `IngressRouter` as a registry-based dispatcher; Cloud's switch-on-type logic is an implementation detail behind `IngressHandler.handle()`.

### 6.2 SDK surface widening

**Forbidden:** Adding new types, interfaces, factory functions, or exports to `@agent-assistant/inbox` to accommodate Cloud adoption friction. This includes but is not limited to:
- Adding Nango-specific fields to `IngressEnvelope`
- Adding Cloud-specific result variants to `IngressOutcome`
- Adding provider-specific handler subtypes to `IngressHandler`
- Adding retry, batching, or streaming abstractions
- Adding auth event lifecycle types
- Adding telemetry or audit contracts beyond `IngressHandlerResult.metrics`

**Why:** The v1 SDK surface is locked at 9 types + 2 runtime artifacts. If Cloud adoption reveals a genuine gap, it must be documented as a follow-up and go through a separate boundary review. Emergency widening during adoption defeats the purpose of bounded extraction.

### 6.3 Transport abstraction drift

**Forbidden:** Introducing HTTP request/response abstractions, middleware contracts, or framework adapter interfaces into the SDK ingress layer.

**Why:** The SDK ingress contracts operate on already-parsed data (`IngressEnvelope`, raw body strings, header records). How the raw body and headers arrive — Next.js, Express, Lambda, CLI import — is the product's concern. The SDK must not grow a transport layer.

### 6.4 Provider-parser extraction

**Forbidden:** Moving `parseNangoEnvelope()`, `normalizeProvider()`, `normalizePayload()`, `omitBaseNangoFields()`, or any Nango-specific parsing logic into the SDK.

**Why:** Envelope parsing is tightly coupled to the external system's payload shape. Nango's envelope structure (top-level `from`, `type`, nested vs. merged payload) is not generalizable. Other external systems (direct GitHub webhooks, Slack Events API, Linear webhooks) have entirely different envelope shapes. Provider-specific parsers belong in provider adapter packages or product code, not in `@agent-assistant/inbox`.

### 6.5 Cloud data-model collapse

**Forbidden:** Replacing Cloud's `workspace_integrations` DB lookups, `findWorkspaceIntegrationByConnection()`, `findSlackIntegrationByTeamId()`, or any database-backed resolution logic with generic SDK resolution utilities.

**Why:** The SDK's `IngressResolver` is an interface — a contract shape. The resolution strategy (UUID fast-path, provider-scoped metadata search, retry with backoff) is a product decision driven by Cloud's data model and consistency requirements. Collapsing this into the SDK would couple the SDK to Cloud's database schema.

## 7. Validation gates for later adoption work

Any workflow that proposes actual Cloud code edits to wire in SDK ingress contracts must pass all of the following gates before merging:

### Gate 1: Behavioral equivalence

The SDK-adapted code path must produce identical observable behavior to the pre-adoption code path for all Nango webhook event types:

- **Forward events:** Same forwarding decisions (Slack to sage, GitHub to relayfile, Notion/Linear logged and skipped).
- **Auth events:** Same workspace integration upsert/delete behavior, same provider resolution order, same failure modes.
- **Sync events:** Same record iteration, same relayfile write paths, same deletion handling, same metrics logging.

Evidence required: Side-by-side trace comparison for at least one representative event per type (forward, auth creation, auth deletion, sync success, sync failure).

### Gate 2: No new dependencies

Cloud adoption code must not add any new npm dependencies to the Cloud package (`packages/web`). The SDK inbox package is already a workspace dependency. No additional packages may be introduced to support the adapter layer.

### Gate 3: Cloud-only boundaries intact

Every item in Section 4 of this contract must still be implemented in Cloud-owned code after adoption. A reviewer must verify:

- No Cloud function was moved into `@agent-assistant/inbox`.
- No Cloud type was merged into SDK types.
- No Cloud secret/env lookup was abstracted into a shared utility.
- No provider-specific path computation was generalized.

### Gate 4: SDK surface unchanged

The SDK inbox package must have exactly the same exports before and after Cloud adoption. Specifically:
- `packages/inbox/src/index.ts` must not gain new exports.
- `packages/inbox/src/ingress-types.ts` must not gain new types.
- `packages/inbox/src/ingress-router.ts` must not gain new functions.
- `packages/inbox/src/ingress-projection.ts` must not gain new functions.
- `packages/inbox/package.json` must not gain new dependencies.

### Gate 5: Adapter thinness

Each Cloud adapter (verifier, resolver, handler) must be a thin delegation wrapper — meaning:

- The wrapper function body calls the existing Cloud function and converts the result shape.
- The wrapper does not contain business logic beyond shape conversion.
- The wrapper does not catch-and-reinterpret errors from the underlying Cloud function (error semantics pass through).
- Lines of adapter code per wrapper should be under ~30 lines. If a wrapper exceeds this, it likely contains business logic that should stay in the Cloud function it wraps.

### Gate 6: Rollback safety

The adoption must be structured so that reverting the adapter wiring (removing the SDK-shaped wrappers) restores Cloud to its pre-adoption behavior with no residual effects. This means:

- No Cloud function signatures were changed to match SDK contracts.
- No Cloud types were renamed or restructured to align with SDK types.
- No Cloud test mocks were changed to use SDK types.
- The pre-adoption code path was not deleted.

### Gate 7: Test pass

- All existing Cloud Nango webhook tests pass without modification.
- All SDK inbox package tests pass without modification.
- Full repo test suite passes (`npx vitest run`).

## 8. Adoption phases restated with gate assignments

| Phase | Scope | Gates required | Cloud code edits? |
|---|---|---|---|
| **A: Read-only alignment proof** | Field mapping documentation | None (documentation only) | No |
| **B: Wrapper adapters** | Verifier, resolver, handler adapters | 2, 3, 4, 5 | Yes — new Cloud files only |
| **C: Route wiring** | Wire adapters into webhook route | 1, 2, 3, 4, 5, 6, 7 | Yes — modify Cloud route |
| **D: Review and rollback decision** | Adoption health check | All gates re-verified | Possibly (rollback or keep) |

Phase A requires no authorization beyond this contract. Phases B through D require a separate workflow that references this contract and passes the applicable gates.

## 9. What this contract does not authorize

- Modifying any file in `packages/inbox/`.
- Modifying any file outside `packages/web/` (Cloud's package).
- Adding new SDK packages.
- Changing the SDK facade exports.
- Changing existing Cloud function signatures to match SDK types.
- Removing existing Cloud code paths before the adapter path proves equivalent.
- Any action listed in Section 6 (Prohibited actions).

## 10. Success definition

Cloud adoption under this contract is successful if:

1. The type alignment proof (Phase A) shows clean, explicit field mappings from every Cloud ingress concept to its SDK counterpart, with all unmapped fields documented as Cloud-only.

2. Wrapper adapters (Phase B) can be written as thin delegations that satisfy the SDK interfaces without altering Cloud's internal logic.

3. Route wiring (Phase C) produces behaviorally equivalent webhook handling through the SDK dispatcher.

4. All validation gates pass for the applicable phase.

5. The SDK remains a clean, reusable, provider-agnostic substrate — not a disguised Nango extraction.

Cloud adoption is **not required** for the v1 SDK slice to be considered successful. The SDK ingress contracts are independently useful. Cloud adoption is a proving exercise and a readiness signal for future broader ingress work across products.

---

V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_CONTRACT_READY
