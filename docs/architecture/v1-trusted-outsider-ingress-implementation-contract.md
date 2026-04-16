# v1 Trusted Outsider Ingress Implementation Contract

**Date:** 2026-04-16
**Status:** LOCKED

## 1. Purpose

This document is the locked implementation contract for the first trusted outsider ingress substrate slice. It resolves all open review findings from the review verdict, restates the exact bounded scope, and defines the file-level permissions, validation commands, and success criteria that govern implementation.

No architectural choices remain open. An implementer follows this contract exactly.

## 2. Review follow-up resolutions

The review verdict (`PASS_WITH_FOLLOWUPS`) identified three items to resolve before implementation. All three are now locked.

### 2.1 Router thrown-handler-error semantics (resolved)

**Rule:** `IngressRouter.route()` MUST catch all errors thrown by handlers and convert them into a deterministic `IngressHandlerResult`:

```typescript
{
  handled: false,
  outcome: 'error',
  reason: error instanceof Error ? error.message : String(error),
}
```

`route()` never throws for handler failures. Only programming errors in the router's own dispatch logic (e.g., a corrupted handler registry) may propagate as exceptions. This keeps pipeline behavior boring and testable — the outer `IngressOutcome` layer is the only place where `stage: 'handler'` failures surface, and they always arrive via a deterministic result, not a caught exception.

### 2.2 V1 contract set wording (resolved)

The v1 SDK ingress surface consists of exactly **nine type-level artifacts** and **two runtime artifacts**:

**Types and interfaces (9):**

| # | Artifact | Kind |
|---|---|---|
| 1 | `IngressEnvelope` | Interface |
| 2 | `IngressVerificationResult` | Type (discriminated union) |
| 3 | `IngressVerifier` | Interface |
| 4 | `IngressResolutionResult` | Type (discriminated union) |
| 5 | `IngressResolver` | Interface |
| 6 | `IngressHandlerResult` | Interface |
| 7 | `IngressHandler` | Interface |
| 8 | `IngressRouter` | Interface |
| 9 | `IngressOutcome` | Type (discriminated union) |

**Runtime artifacts (2):**

| # | Artifact | Kind |
|---|---|---|
| 1 | `createIngressRouter()` | Factory function returning `IngressRouter` |
| 2 | `projectEnvelopeToInboxInput()` | Projection utility returning `InboxWriteInput` |

Total: 11 named exports. No more, no fewer.

### 2.3 Export scope distinction (resolved)

**In scope:** Adding ingress re-exports to `packages/inbox/src/index.ts`. This is the package-local public surface of `@agent-assistant/inbox`.

**Out of scope:** Any changes to a broader SDK facade (e.g., `@agent-assistant/sdk` or a top-level `packages/sdk/src/index.ts` barrel). Facade widening is deferred until the ingress surface reaches a stable baseline and a later slice explicitly authorizes it.

## 3. Exact bounded slice

### What is being built

Reusable, provider-agnostic ingress substrate inside `@agent-assistant/inbox`. This adds the upstream contracts that feed into the existing `InboxWriteInput` shape — the front door through which trusted external payloads arrive, get verified, get resolved to a workspace/assistant scope, get routed, and produce an outcome.

### What is not being built

- No HTTP transport abstractions
- No provider-specific parsers or adapters
- No retry or backoff wrappers
- No batch or streaming ingress
- No telemetry or audit contracts beyond `IngressHandlerResult.metrics`
- No auth event lifecycle contracts
- No Cloud code migration
- No new SDK package

## 4. File permissions

### Files to CREATE (5)

| File | Purpose |
|---|---|
| `packages/inbox/src/ingress-types.ts` | All 9 type/interface definitions. Types only — no runtime logic. |
| `packages/inbox/src/ingress-router.ts` | `createIngressRouter()` factory. Minimal registry dispatcher. |
| `packages/inbox/src/ingress-projection.ts` | `projectEnvelopeToInboxInput()` utility. Convenience projection. |
| `packages/inbox/src/ingress-router.test.ts` | Router dispatch test suite. |
| `packages/inbox/src/ingress-projection.test.ts` | Projection mapping test suite. |

### Files to MODIFY (1)

| File | Permitted change |
|---|---|
| `packages/inbox/src/index.ts` | Add re-exports for all 11 new ingress exports. No other changes. |

### Files that MUST NOT be modified

| File | Reason |
|---|---|
| `packages/inbox/src/types.ts` | Existing inbox types are frozen for this slice. |
| `packages/inbox/src/inbox.ts` | Store implementation is not affected by ingress. |
| `packages/inbox/src/memory-projector.ts` | Downstream projector, not affected. |
| `packages/inbox/src/enrichment-projector.ts` | Downstream projector, not affected. |
| `packages/inbox/src/inbox.test.ts` | Existing tests must pass without modification. |
| `packages/inbox/src/memory-projector.test.ts` | Existing tests must pass without modification. |
| `packages/inbox/src/enrichment-projector.test.ts` | Existing tests must pass without modification. |
| `packages/inbox/package.json` | No new dependencies permitted. |
| `packages/inbox/tsconfig.json` | No compiler config changes permitted. |
| Any file outside `packages/inbox/` | This slice is inbox-local. |

## 5. Type definitions contract

All types go in `packages/inbox/src/ingress-types.ts`. The exact shapes are defined in the boundary doc and restated here for implementer reference.

### IngressEnvelope

```typescript
export interface IngressEnvelope {
  provider: string;
  eventType: string;
  connectionId: string | null;
  providerConfigKey: string;
  payload: unknown;
  rawMeta?: Record<string, unknown>;
  receivedAt: string;
}
```

### IngressVerificationResult

```typescript
export type IngressVerificationResult =
  | { verified: true; trustLevel: 'verified' | 'trusted' }
  | { verified: false; reason: string };
```

### IngressVerifier

```typescript
export interface IngressVerifier {
  verify(input: {
    rawBody: string;
    headers: Record<string, string>;
    provider: string;
    providerConfigKey: string;
  }): Promise<IngressVerificationResult> | IngressVerificationResult;
}
```

### IngressResolutionResult

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
```

### IngressResolver

```typescript
export interface IngressResolver {
  resolve(envelope: IngressEnvelope): Promise<IngressResolutionResult>;
}
```

### IngressHandlerResult

```typescript
export interface IngressHandlerResult {
  handled: boolean;
  outcome?: 'written' | 'skipped' | 'partial' | 'error';
  reason?: string;
  metrics?: {
    itemsWritten?: number;
    itemsSkipped?: number;
    errorCount?: number;
    durationMs?: number;
  };
  inboxItemId?: string;
}
```

### IngressHandler

```typescript
export interface IngressHandler {
  provider: string;
  eventTypes?: string[];
  handle(input: {
    envelope: IngressEnvelope;
    resolution: IngressResolutionResult & { resolved: true };
  }): Promise<IngressHandlerResult>;
}
```

### IngressRouter

```typescript
export interface IngressRouter {
  register(handler: IngressHandler): void;
  route(input: {
    envelope: IngressEnvelope;
    resolution: IngressResolutionResult & { resolved: true };
  }): Promise<IngressHandlerResult>;
}
```

### IngressOutcome

```typescript
export type IngressOutcome =
  | { ok: true; result: IngressHandlerResult; resolution: IngressResolutionResult & { resolved: true } }
  | { ok: false; stage: 'verification' | 'resolution' | 'routing' | 'handler'; reason: string };
```

## 6. Router factory contract

`packages/inbox/src/ingress-router.ts` exports `createIngressRouter(): IngressRouter`.

### Behavior rules

1. **Register:** Stores handlers indexed by `provider`. Optional `eventTypes` array narrows match scope.
2. **Match by provider:** Envelope `provider` must equal handler `provider` (exact string match).
3. **Match by eventType:** If handler declares `eventTypes`, envelope `eventType` must be included. If handler omits `eventTypes`, it matches all events for that provider.
4. **No match:** Returns `{ handled: false, outcome: 'skipped' }`.
5. **Multiple matches:** First registered handler wins. Match order is deterministic (registration order).
6. **Handler throws:** Router catches the error and returns `{ handled: false, outcome: 'error', reason: <error message> }`. Router itself does not throw for handler failures.
7. **Pass-through:** Handler result metrics, `inboxItemId`, and other fields are returned as-is.

### Import constraint

`ingress-router.ts` imports only from `./ingress-types.js`. It does not import from `./types.js`, `./inbox.js`, or any external package.

## 7. Projection utility contract

`packages/inbox/src/ingress-projection.ts` exports `projectEnvelopeToInboxInput()`.

### Signature

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

### Mapping rules

| Output field | Source |
|---|---|
| `assistantId` | `resolution.assistantId` if present, else `resolution.workspaceId` |
| `kind` | `input.kind` if provided, else `'other'` |
| `source.sourceId` | `envelope.provider` |
| `source.trustLevel` | `input.trustLevel` if provided, else `'trusted'` |
| `source.producedAt` | `envelope.receivedAt` |
| `content` | `JSON.stringify(envelope.payload)` |
| `title` | `input.title` if provided |
| `tags` | `input.tags` if provided |
| `scope.workspaceId` | `resolution.workspaceId` |
| `metadata` | `{ ingress: { provider, eventType, connectionId, resolvedVia } }` |

### Import constraint

`ingress-projection.ts` imports from `./ingress-types.js` and `./types.js` (for `InboxWriteInput`, `InboxItemKind`, `InboxSourceTrust`). It does not import from `./inbox.js` or any external package.

## 8. Export wiring contract

`packages/inbox/src/index.ts` adds the following re-exports. Existing exports are not changed.

### Runtime re-exports

```typescript
export { createIngressRouter } from './ingress-router.js';
export { projectEnvelopeToInboxInput } from './ingress-projection.js';
```

### Type re-exports

```typescript
export type {
  IngressEnvelope,
  IngressVerificationResult,
  IngressVerifier,
  IngressResolutionResult,
  IngressResolver,
  IngressHandlerResult,
  IngressHandler,
  IngressRouter,
  IngressOutcome,
} from './ingress-types.js';
```

## 9. Test matrix

### 9a. Router tests (`packages/inbox/src/ingress-router.test.ts`)

| # | Test case | Expected behavior |
|---|---|---|
| 1 | Router with no handlers | Returns `{ handled: false, outcome: 'skipped' }` |
| 2 | Dispatches to matching handler by provider | Handler receives envelope and resolution, result returned |
| 3 | Dispatches to matching handler by provider + eventType | Handler with matching eventType is called |
| 4 | Skips handler when eventType does not match | Returns `{ handled: false, outcome: 'skipped' }` |
| 5 | First registered handler wins on multiple match | Only the first registered handler is called |
| 6 | Handler result metrics are passed through | Metrics object returned as-is |
| 7 | Handler that throws produces error outcome | Returns `{ handled: false, outcome: 'error', reason: <message> }` |
| 8 | Handles null connectionId in envelope | No error; dispatch proceeds normally |

### 9b. Projection tests (`packages/inbox/src/ingress-projection.test.ts`)

| # | Test case | Expected behavior |
|---|---|---|
| 1 | Projects envelope with all fields | Produces valid `InboxWriteInput` with all fields mapped |
| 2 | Uses `resolution.assistantId` when present | `assistantId` equals `resolution.assistantId` |
| 3 | Falls back to `resolution.workspaceId` when `assistantId` absent | `assistantId` equals `resolution.workspaceId` |
| 4 | Defaults kind to `'other'` when not specified | `kind` is `'other'` |
| 5 | Defaults trustLevel to `'trusted'` when not specified | `source.trustLevel` is `'trusted'` |
| 6 | Preserves ingress metadata in output | `metadata.ingress` contains provider, eventType, connectionId, resolvedVia |
| 7 | Serializes payload as content string | `content` equals `JSON.stringify(envelope.payload)` |
| 8 | Includes `scope.workspaceId` from resolution | `scope.workspaceId` equals `resolution.workspaceId` |

**Target: 16 new tests across 2 test files.**

## 10. Validation commands and success criteria

### Step-by-step validation

```bash
# 1. Type-check the inbox package (no compilation errors, no circular imports)
npx tsc --noEmit -p packages/inbox/tsconfig.json

# 2. Run only the new ingress tests
npx vitest run packages/inbox/src/ingress-router.test.ts packages/inbox/src/ingress-projection.test.ts

# 3. Run all inbox tests (existing + new must pass together)
npx vitest run packages/inbox/src/

# 4. Run full repo test suite (no regressions)
npx vitest run
```

### Success criteria

1. All type definitions compile without errors.
2. No circular imports between `ingress-types.ts` and existing `types.ts`.
3. `createIngressRouter()` passes all 8 router test cases.
4. `projectEnvelopeToInboxInput()` passes all 8 projection test cases.
5. All existing inbox tests (39 tests across 3 files) pass without modification.
6. Full repo test suite passes with no regressions.
7. No new dependencies added to `packages/inbox/package.json`.
8. No files outside the permitted set were created or modified.

## 11. Explicit prohibitions

The following actions are forbidden under this contract:

| Prohibition | Rationale |
|---|---|
| Editing any Cloud code | Cloud adopts SDK contracts separately; this slice is SDK-only |
| Adding dependencies to `packages/inbox/package.json` | Ingress types are self-contained |
| Adding provider-specific adapters or parsers | Provider logic is Cloud-owned or belongs in future adapter packages |
| Adding retry or backoff wrappers | Retry strategy generalization is unproven; deferred to maybe-later |
| Adding HTTP transport abstractions | Transport is framework-specific and Cloud-only |
| Adding telemetry or audit contracts beyond `IngressHandlerResult.metrics` | Telemetry shape has no cross-product consensus |
| Adding auth event lifecycle contracts | Auth events are deeply product-specific |
| Widening the SDK facade re-exports | Package-local `index.ts` only; broader facade deferred |
| Modifying existing inbox types, store, or projectors | Downstream primitives are frozen for this slice |
| Creating a new SDK package | v1 extends `@agent-assistant/inbox`, does not create `@agent-assistant/ingress` |
| Adding batch or streaming ingress contracts | Needs a second batch source to generalize; deferred |
| Modifying files outside `packages/inbox/src/` | This slice is inbox-local |

## 12. Deferred topics

These topics are explicitly out of scope for v1 and must not be addressed during implementation:

| Topic | Status | Blocking question |
|---|---|---|
| Retry wrapper for resolution | Maybe-later | Need more than one product proving the same retry pattern |
| Batch/streaming ingress | Maybe-later | Nango's async generator is tightly coupled; need a second batch source |
| Ingress audit/telemetry contract | Maybe-later | No consensus on telemetry shape across products |
| Provider-specific envelope parsers | Maybe-later | Belong in provider adapter packages, not the SDK |
| Auth event lifecycle contract | Maybe-later | Nango auth events are deeply product-specific |
| SDK facade re-exports | Deferred | Until ingress reaches stable baseline |
| Cloud adoption implementation | Phase 2 | Separate workflow; type-alignment proof first |

## 13. Decision rule

If a proposed change during implementation cannot be justified as one of:

- Ingress type definition (from the 9 listed in section 5)
- `createIngressRouter()` factory (per section 6 rules)
- `projectEnvelopeToInboxInput()` utility (per section 7 rules)
- Export wiring in `index.ts` (per section 8)
- Test case from the defined matrix (per section 9)

then it is **out of scope** and must be deferred. No exceptions.

---

V1_TRUSTED_OUTSIDER_INGRESS_IMPLEMENTATION_CONTRACT_READY

