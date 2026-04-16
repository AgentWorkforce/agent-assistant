# v1 Trusted Outsider Ingress Proof Plan

**Date:** 2026-04-16
**Status:** DIRECTIONAL

## 1. Purpose

Define the implementation and proving plan for the trusted outsider ingress contracts in `@agent-assistant/inbox`. This plan covers what to build, how to test it, and how to prove it against Cloud's Nango webhook handling without moving Cloud code into the SDK.

## 2. Prerequisites

- `v1-trusted-outsider-ingress-boundary.md` accepted as directional
- `v1-trusted-outsider-ingress-extraction-map.md` reviewed — extraction scope agreed
- `@agent-assistant/inbox` package green (currently 39 tests passing across 3 test files)
- `@agent-assistant/turn-context` types stable (ingress does not modify them)

## 3. Implementation steps

### Step 1: Add ingress types

**File:** `packages/inbox/src/ingress-types.ts`

Add all type definitions from the boundary doc:
- `IngressEnvelope`
- `IngressVerificationResult`
- `IngressVerifier`
- `IngressResolutionResult`
- `IngressResolver`
- `IngressHandlerResult`
- `IngressHandler`
- `IngressRouter`
- `IngressOutcome`

No implementation logic. Types only. No dependencies beyond TypeScript.

**Acceptance:** Types compile. No circular imports with existing `types.ts`.

### Step 2: Add ingress router factory

**File:** `packages/inbox/src/ingress-router.ts`

Implement `createIngressRouter(): IngressRouter` with:
- `register(handler)`: stores handlers indexed by `provider` + optional `eventTypes`
- `route(input)`: matches envelope to handler by `provider` and `eventType`, calls `handler.handle()`, returns `IngressHandlerResult`
- When no handler matches: returns `{ handled: false, outcome: 'skipped' }`
- When multiple handlers match: first registered handler wins (deterministic)

This is a minimal registry dispatcher. It does not own verification or resolution — those are called by the product's ingress pipeline before reaching the router.

**Acceptance:** Factory creates a working router. Handlers register and dispatch correctly.

### Step 3: Add envelope-to-inbox projection

**File:** `packages/inbox/src/ingress-projection.ts`

Implement `projectEnvelopeToInboxInput(input): InboxWriteInput` with:

```typescript
export function projectEnvelopeToInboxInput(input: {
  envelope: IngressEnvelope;
  resolution: IngressResolutionResult & { resolved: true };
  kind?: InboxItemKind;
  trustLevel?: InboxSourceTrust['trustLevel'];
  title?: string;
  tags?: string[];
}): InboxWriteInput
```

Mapping rules:
- `assistantId`: from `resolution.assistantId` if present, else `resolution.workspaceId` (fallback; products should prefer assistantId)
- `kind`: from `input.kind` if provided, else `'other'`
- `source.sourceId`: from `envelope.provider`
- `source.trustLevel`: from `input.trustLevel` if provided, else `'trusted'` (default for resolved ingress)
- `source.producedAt`: from `envelope.receivedAt`
- `content`: `JSON.stringify(envelope.payload)` (products can override with richer content extraction)
- `scope.workspaceId`: from `resolution.workspaceId`
- `metadata`: includes `{ ingress: { provider, eventType, connectionId, resolvedVia } }`

This is a convenience utility. Products can bypass it and construct `InboxWriteInput` directly.

**Acceptance:** Projection produces valid `InboxWriteInput` from test envelopes.

### Step 4: Update package exports

**File:** `packages/inbox/src/index.ts`

Add re-exports for all new types, the router factory, and the projection utility.

**Acceptance:** All new exports are importable from `@agent-assistant/inbox`.

### Step 5: Tests

#### 5a: Ingress router tests

**File:** `packages/inbox/src/ingress-router.test.ts`

Test cases:
1. Router with no handlers returns `{ handled: false, outcome: 'skipped' }`
2. Router dispatches to matching handler by provider
3. Router dispatches to matching handler by provider + eventType
4. Router skips handler when eventType does not match
5. First registered handler wins when multiple match
6. Handler result metrics are passed through
7. Handler that throws produces error outcome
8. Router handles null connectionId in envelope

#### 5b: Ingress projection tests

**File:** `packages/inbox/src/ingress-projection.test.ts`

Test cases:
1. Projects envelope with all fields to valid `InboxWriteInput`
2. Uses resolution.assistantId when present
3. Falls back to resolution.workspaceId when assistantId absent
4. Defaults kind to `'other'` when not specified
5. Defaults trustLevel to `'trusted'` when not specified
6. Preserves ingress metadata in output metadata
7. Serializes payload as content string
8. Includes scope.workspaceId from resolution

**Target:** ~16 new tests across 2 test files.

### Step 6: No-regression verification

Run full repo test suite (`npx vitest run`) and confirm:
- All existing inbox tests still pass (39 tests)
- All new ingress tests pass (~16 tests)
- No other package tests regress
- Total repo test count increases by ~16

## 4. Cloud proving approach

The SDK contracts are proven by demonstrating that Cloud's existing Nango webhook handling can be expressed as implementations of the SDK interfaces, without changing Cloud's behavior.

### 4.1 Type alignment proof (read-only analysis, no code changes)

Show that:
- `NangoWebhookEnvelope` fields map to `IngressEnvelope` fields
- `verifyNangoWebhookSignature` satisfies the `IngressVerifier` interface
- `resolveWorkspace` satisfies the `IngressResolver` interface
- Each sync/forward/auth handler satisfies the `IngressHandler` interface
- Sync handler metrics (`written`, `deleted`, `errors`) map to `IngressHandlerResult.metrics`
- `NotionIngestAuditEntry` maps to `IngressHandlerResult`
- `ResolveWorkspaceResult` maps to `IngressResolutionResult`

This is a documentation exercise, not a code change. Record the mapping in a table.

### 4.2 Adapter proof (optional future step)

If Cloud wants to adopt the SDK ingress contracts, it would:
1. Create a `NangoIngressVerifier` implementing `IngressVerifier` that wraps `verifyNangoWebhookSignature`
2. Create a `CloudIngressResolver` implementing `IngressResolver` that wraps `resolveWorkspace`
3. Register existing handlers as `IngressHandler` implementations
4. Wire the `IngressRouter` into the webhook route

This is **not required** for the SDK proof. It is a future adoption step that Cloud can take when ready. The SDK contracts are proven by type alignment, not by migrating Cloud code.

## 5. Files created or modified

| File | Action | Purpose |
|---|---|---|
| `packages/inbox/src/ingress-types.ts` | CREATE | Ingress type definitions |
| `packages/inbox/src/ingress-router.ts` | CREATE | `createIngressRouter()` factory |
| `packages/inbox/src/ingress-projection.ts` | CREATE | `projectEnvelopeToInboxInput()` utility |
| `packages/inbox/src/ingress-router.test.ts` | CREATE | Router dispatch tests |
| `packages/inbox/src/ingress-projection.test.ts` | CREATE | Projection mapping tests |
| `packages/inbox/src/index.ts` | MODIFY | Add ingress re-exports |

### Files not modified

| File | Why unchanged |
|---|---|
| `packages/inbox/src/types.ts` | Existing inbox types are not modified |
| `packages/inbox/src/inbox.ts` | Store implementation is not modified |
| `packages/inbox/src/memory-projector.ts` | Downstream projector, not affected |
| `packages/inbox/src/enrichment-projector.ts` | Downstream projector, not affected |
| Any Cloud code | Extraction is read-only; Cloud adopts the contracts separately if/when it chooses |
| Any other SDK package | No cross-package changes |

## 6. Slice boundaries

### This slice includes
- Ingress types in `@agent-assistant/inbox`
- Ingress router factory (registry-based dispatch)
- Envelope-to-inbox projection utility
- Tests for router and projection
- Type alignment proof against Cloud Nango handling (documentation)

### This slice does not include
- Moving any Cloud code
- Provider-specific adapters or parsers
- Batch/streaming ingress
- Retry wrappers
- Audit/telemetry contracts
- Changes to the existing inbox store, projectors, or types
- Changes to the SDK facade re-exports (deferred until ingress reaches stable baseline)
- Any new package

## 7. Success criteria

1. All new types compile without errors
2. `createIngressRouter()` dispatches correctly in all test cases
3. `projectEnvelopeToInboxInput()` produces valid `InboxWriteInput` in all test cases
4. All existing inbox tests pass without modification
5. Full repo test suite passes (`npx vitest run`)
6. Type alignment table shows clean mapping from Cloud Nango patterns to SDK contracts
7. No new dependencies added to `@agent-assistant/inbox`

## 8. Risk assessment

| Risk | Mitigation |
|---|---|
| Ingress types are too Nango-shaped | Review against at least one non-Nango ingress scenario (e.g., direct API ingestion, CLI import) before finalizing |
| Router is too simple for real dispatch needs | Start simple. Products can wrap or extend. Complexity earned later |
| Projection is lossy for structured payloads | Projection is a convenience, not a requirement. Products can construct `InboxWriteInput` directly |
| Cloud never adopts the SDK contracts | SDK contracts are independently useful. Cloud adoption is optional validation, not a gate |

---

V1_TRUSTED_OUTSIDER_INGRESS_PROOF_PLAN_READY
