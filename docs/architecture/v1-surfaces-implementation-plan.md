# v1 Surfaces Implementation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/surfaces`
**Spec:** `docs/specs/v1-surfaces-spec.md` (SPEC_RECONCILED)
**Workflows:** WF-5 (surfaces standalone + core wiring), WF-6 (multi-surface session fanout integration)

---

## 1. Files to Create

All files live under `packages/surfaces/`.

```
packages/surfaces/
  package.json
  tsconfig.json
  src/
    types.ts          — SurfaceConnection, SurfaceAdapter, SurfaceCapabilities,
                        SurfacePayload, SurfaceFormatHook, SurfaceRegistry,
                        FanoutPolicy, FanoutResult, FanoutOutcome,
                        SurfaceRegistryConfig, error classes
    surfaces.ts       — createSurfaceRegistry factory (implements SurfaceRegistry,
                        RelayInboundAdapter, RelayOutboundAdapter), normalization logic
    index.ts          — public exports
    surfaces.test.ts  — all WF-5 tests + WF-6 fanout tests
```

**Four source files, one test file.** Mirrors the consolidated approach used by core and sessions.

---

## 2. File Contents

### 2.1 `package.json`

```json
{
  "name": "@relay-assistant/surfaces",
  "version": "0.1.0",
  "description": "Surface connection registry, inbound normalization, and outbound dispatch for Relay Agent Assistant SDK",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

**Zero runtime dependencies.** Core and sessions types are NOT imported at runtime. The surfaces package re-declares minimal structural types where needed (same pattern sessions uses with `SessionResolvableMessage`). This keeps the dependency graph clean per spec §7.

### 2.2 `tsconfig.json`

Same structure as core and sessions: ES2022 target, NodeNext module, strict mode, declarations to `dist/`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts"]
}
```

### 2.3 `types.ts`

Exports all interfaces from the surfaces spec §4:

| Export | Kind | Spec section |
|---|---|---|
| `SurfaceConnection` | interface | §4.1 |
| `SurfaceType` | type alias | §4.1 |
| `SurfaceState` | type alias | §4.1 |
| `SurfaceCapabilities` | interface | §4.2 |
| `SurfaceAdapter` | interface | §4.3 |
| `SurfacePayload` | interface | §4.4 |
| `SurfaceFormatHook` | type alias | §4.5 |
| `SurfaceRegistry` | interface | §4.6 |
| `FanoutPolicy` | interface | §4.7 |
| `FanoutResult` | interface | §4.8 |
| `FanoutOutcome` | interface | §4.8 |
| `SurfaceRegistryConfig` | interface | §5 |
| `SurfaceNotFoundError` | class | §4.11 |
| `SurfaceConflictError` | class | §4.11 |
| `SurfaceDeliveryError` | class | §4.11 |

**Locally-defined structural types (not exported):**

Two structural type aliases are defined in `types.ts` to avoid importing from core at runtime:

```typescript
/**
 * Structural subset of core's InboundMessage.
 * Surfaces produces this shape; core consumes it.
 */
export interface NormalizedInboundMessage {
  id: string;
  surfaceId: string;
  sessionId?: string;
  userId: string;
  workspaceId?: string;
  text: string;
  raw: unknown;
  receivedAt: string;
  capability: string;
}

/**
 * Structural subset of core's OutboundEvent.
 * Core produces this shape; surfaces consumes it.
 */
export interface SurfaceOutboundEvent {
  surfaceId?: string;
  sessionId?: string;
  text: string;
  format?: unknown;
}
```

These are structural supertypes of core's `InboundMessage` and `OutboundEvent` — any `InboundMessage` is assignable to `NormalizedInboundMessage` and vice versa. The compile-time contract check (§3.2) ensures they remain compatible.

**Error classes:**

```typescript
export class SurfaceNotFoundError extends Error {
  constructor(public readonly surfaceId: string) {
    super(`Surface not found: ${surfaceId}`);
    this.name = 'SurfaceNotFoundError';
  }
}

export class SurfaceConflictError extends Error {
  constructor(public readonly surfaceId: string) {
    super(`Surface already registered: ${surfaceId}`);
    this.name = 'SurfaceConflictError';
  }
}

export class SurfaceDeliveryError extends Error {
  constructor(public readonly surfaceId: string, cause: Error) {
    super(`Delivery failed for surface ${surfaceId}: ${cause.message}`);
    this.name = 'SurfaceDeliveryError';
    this.cause = cause;
  }
}
```

### 2.4 `surfaces.ts`

Single export: **`createSurfaceRegistry(config?: SurfaceRegistryConfig): SurfaceRegistry & RelayInboundAdapter & RelayOutboundAdapter`**

The returned object implements three interfaces simultaneously:

1. **`SurfaceRegistry`** — surface management (register, unregister, get, list, send, fanout)
2. **`RelayInboundAdapter`** — `onMessage(handler)` / `offMessage(handler)` (core wires this as `inbound`)
3. **`RelayOutboundAdapter`** — `send(event)` / `fanout(event, surfaceIds)` (core wires this as `outbound`)

This is the central design decision: `SurfaceRegistry` is wired as **both** the inbound and outbound adapter for core, per the canonical assembly pattern:

```typescript
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,   // RelayInboundAdapter
  outbound: surfaceRegistry,  // RelayOutboundAdapter
});
```

#### Internal state

```typescript
const connections = new Map<string, SurfaceConnection>();
const messageHandlers: Array<(message: NormalizedInboundMessage) => void> = [];
const defaultPolicy: FanoutPolicy = {
  onError: config?.defaultFanoutPolicy?.onError ?? 'continue',
  skipInactive: config?.defaultFanoutPolicy?.skipInactive ?? true,
};
const normalizationHook = config?.normalizationHook ?? null;
```

#### `register(connection)`

1. If `connections.has(connection.id)`, throw `SurfaceConflictError`
2. Store connection in map
3. Wire adapter callbacks:
   - `connection.adapter.onConnect(() => { connection.state = 'active'; })`
   - `connection.adapter.onDisconnect(() => { connection.state = 'inactive'; })`

#### `unregister(surfaceId)`

1. Remove from map. Idempotent — no throw if missing.

#### `get(surfaceId)`

1. Return `connections.get(surfaceId) ?? null`

#### `list(filter?)`

1. Return all connections, optionally filtered by `state` and/or `type`

#### `send(event)` — targeted outbound delivery

1. Extract `surfaceId` from `event.surfaceId`. If not present, throw `SurfaceNotFoundError` (with empty string — caller should use `fanout` for session-wide delivery)
2. Look up connection. If not found, throw `SurfaceNotFoundError`
3. Build `SurfacePayload`:
   - If `connection.formatHook` exists, call `formatted = await connection.formatHook(event, connection.capabilities)`
   - Otherwise, `formatted = event.text`
4. Call `connection.adapter.send({ event, formatted, surfaceCapabilities: connection.capabilities })`
5. Wrap adapter errors in `SurfaceDeliveryError`

This method also serves as the `RelayOutboundAdapter.send()` implementation.

#### `fanout(event, attachedSurfaceIds, policy?)` — multi-surface delivery

1. Merge `policy` with `defaultPolicy`
2. For each `surfaceId` in `attachedSurfaceIds`:
   a. Look up connection. If not found, add `{ surfaceId, status: 'skipped' }` outcome
   b. If connection state is `inactive` and `skipInactive` is true, add `{ surfaceId, status: 'skipped' }` outcome
   c. Otherwise, attempt `send()` to this surface
   d. On success: `{ surfaceId, status: 'delivered' }`
   e. On failure: if `onError === 'abort'`, throw immediately. If `onError === 'continue'`, add `{ surfaceId, status: 'failed', error }` outcome
3. Sends are concurrent (`Promise.all` with error collection when `onError === 'continue'`)
4. Return `FanoutResult { total, delivered, outcomes }`

This method also serves as the `RelayOutboundAdapter.fanout()` implementation.

#### `receiveRaw(surfaceId, raw)` — inbound normalization entry point

1. If `normalizationHook` is provided, call `normalizationHook(surfaceId, raw)` to produce `NormalizedInboundMessage`
2. Otherwise, apply default normalization (spec §4.10):

| Target field | Source | Fallback |
|---|---|---|
| `id` | `raw.messageId` or `raw.id` | `crypto.randomUUID()` |
| `surfaceId` | First argument to `receiveRaw` | Error if missing |
| `sessionId` | `raw.sessionId` or `raw.session?.id` | `undefined` |
| `userId` | `raw.userId` or `raw.user?.id` or `raw.user` (if string) | **Reject message, log error** |
| `workspaceId` | `raw.workspaceId` or `raw.workspace?.id` | `undefined` |
| `text` | `raw.text` or `raw.content` or `raw.body` | Empty string, log warning |
| `receivedAt` | `raw.timestamp` or `raw.receivedAt` | `new Date().toISOString()` |
| `capability` | `raw.capability` or `raw.type` | `'chat'` (default capability) |
| `raw` | Verbatim second argument | Required |

3. If `userId` cannot be extracted, log error and return (do not emit message)
4. Call all registered message handlers: `messageHandlers.forEach(h => h(message))`

#### `onMessage(handler)` — RelayInboundAdapter implementation

1. Push handler into `messageHandlers` array

#### `offMessage(handler)` — RelayInboundAdapter implementation

1. Remove handler from `messageHandlers` array (by reference)

### 2.5 `index.ts`

```typescript
export { createSurfaceRegistry } from './surfaces.js';

export {
  SurfaceNotFoundError,
  SurfaceConflictError,
  SurfaceDeliveryError,
} from './types.js';

export type {
  SurfaceConnection,
  SurfaceType,
  SurfaceState,
  SurfaceCapabilities,
  SurfaceAdapter,
  SurfacePayload,
  SurfaceFormatHook,
  SurfaceRegistry,
  FanoutPolicy,
  FanoutResult,
  FanoutOutcome,
  SurfaceRegistryConfig,
  NormalizedInboundMessage,
  SurfaceOutboundEvent,
} from './types.js';
```

---

## 3. Adapter Contracts with Core

### 3.1 How surfaces satisfies core's adapter interfaces

Core expects two adapters at `createAssistant()` call time:

```typescript
// From core types.ts
interface RelayInboundAdapter {
  onMessage(handler: (message: InboundMessage) => void): void;
  offMessage(handler: (message: InboundMessage) => void): void;
}

interface RelayOutboundAdapter {
  send(event: OutboundEvent): Promise<void>;
  fanout?(event: OutboundEvent, attachedSurfaceIds: string[]): Promise<void>;
}
```

`createSurfaceRegistry()` returns an object that implements both:

| Core interface | Surfaces method | How it works |
|---|---|---|
| `RelayInboundAdapter.onMessage` | `registry.onMessage(handler)` | Stores handler. When `receiveRaw()` normalizes a raw event, all stored handlers are called with the resulting `NormalizedInboundMessage`. |
| `RelayInboundAdapter.offMessage` | `registry.offMessage(handler)` | Removes handler by reference. |
| `RelayOutboundAdapter.send` | `registry.send(event)` | Looks up connection by `event.surfaceId`, applies format hook, calls adapter. |
| `RelayOutboundAdapter.fanout` | `registry.fanout(event, surfaceIds)` | Concurrent delivery to all specified surfaces with policy-based error handling. |

**Inbound flow:**
```
relay foundation → surfaceRegistry.receiveRaw(surfaceId, raw)
    → normalization → NormalizedInboundMessage
    → stored handlers (wired by core via onMessage)
    → core.dispatch(message)
```

**Outbound targeted flow:**
```
handler calls context.runtime.emit({ surfaceId: 'slack-1', text })
    → core calls outboundAdapter.send(event)
    → surfaceRegistry.send(event)
    → formatHook (if present) → adapter.send(payload)
```

**Outbound fanout flow:**
```
handler calls context.runtime.emit({ sessionId: 'sess-1', text })
    → core resolves session.attachedSurfaces via runtime.get('sessions')
    → core calls outboundAdapter.fanout(event, surfaceIds)
    → surfaceRegistry.fanout(event, surfaceIds, policy)
    → concurrent send to each active surface
```

### 3.2 Compile-time contract verification

The test file includes structural assignability checks to ensure surfaces' types remain compatible with core's adapter interfaces, without importing core at runtime:

```typescript
// Compile-time contract check: SurfaceRegistry must satisfy core's adapter interfaces
type InboundAdapter = {
  onMessage(handler: (message: {
    id: string; surfaceId: string; sessionId?: string;
    userId: string; workspaceId?: string;
    text: string; raw: unknown; receivedAt: string; capability: string;
  }) => void): void;
  offMessage(handler: (message: {
    id: string; surfaceId: string; sessionId?: string;
    userId: string; workspaceId?: string;
    text: string; raw: unknown; receivedAt: string; capability: string;
  }) => void): void;
};

type OutboundAdapter = {
  send(event: {
    surfaceId?: string; sessionId?: string; text: string; format?: unknown;
  }): Promise<void>;
  fanout?(event: {
    surfaceId?: string; sessionId?: string; text: string; format?: unknown;
  }, attachedSurfaceIds: string[]): Promise<void>;
};

// These lines must compile. If they don't, the contract has drifted.
const _registry = {} as ReturnType<typeof createSurfaceRegistry>;
const _inboundCheck: InboundAdapter = _registry;
const _outboundCheck: OutboundAdapter = _registry;
```

### 3.3 Interaction with sessions for fanout

Surfaces does **not** import or interact with the sessions package directly. The fanout chain is:

1. Core's `runtime.emit({ sessionId })` internally calls `runtime.get<SessionStore>('sessions')` to look up `session.attachedSurfaces`
2. Core then calls `outboundAdapter.fanout(event, attachedSurfaceIds)`
3. Surfaces receives the already-resolved `attachedSurfaceIds: string[]` and delivers to each

This means surfaces never needs to know about `Session`, `SessionStore`, or any sessions type. The session-to-surface resolution is core's responsibility. Surfaces only needs to know surface IDs.

**Dependency direction:** `core → sessions` (for fanout resolution) and `core → surfaces` (for delivery). Surfaces → sessions is **forbidden** per spec §7.

---

## 4. Implementation Slices

### Slice 1: WF-5 — Surfaces standalone + core adapter wiring (this PR)

Everything in §2 above. Produces:

- All types from spec §4
- `createSurfaceRegistry` factory (spec §5)
- Inbound normalization with `receiveRaw()`
- Outbound targeted `send()` and `fanout()`
- Connection state management via adapter callbacks
- Format hook integration
- `RelayInboundAdapter` + `RelayOutboundAdapter` implementation
- Full test suite covering WF-5 acceptance criteria

### Slice 2: WF-6 — Multi-surface session fanout integration (next PR)

Lives in `packages/core/` as `core-sessions-surfaces.test.ts`. Validates:

- Session accumulates surface references across multiple surface interactions
- Targeted send routes only to specified adapter
- Fanout routes to all `session.attachedSurfaces`
- Invalid emit (neither surfaceId nor sessionId) throws `OutboundEventError`
- Detach removes surface from fanout targets
- `FanoutResult` structure is correct

Surfaces package ships no code changes in WF-6. The integration test imports from both `@relay-assistant/sessions` and `@relay-assistant/surfaces`.

---

## 5. Normalization Implementation Detail

The default normalization function is a private function inside `surfaces.ts`:

```typescript
function normalizeRawEvent(surfaceId: string, raw: unknown): NormalizedInboundMessage | null
```

**Behavior:**

1. Cast `raw` to `Record<string, unknown>` for field access. If `raw` is not an object, log error and return `null`.
2. Extract fields per the table in §2.4.
3. **`userId` is required.** If none of the extraction paths yield a value, log an error and return `null`. The message is dropped silently from the handler chain.
4. **`text` warning.** If none of `raw.text`, `raw.content`, `raw.body` yield a string, set `text = ''` and log a warning (surface ID + message ID in log).
5. **`capability` fallback.** If `raw.capability` and `raw.type` are both absent, default to `'chat'`. This default is intentional — most surfaces send chat messages.
6. Return the fully-formed `NormalizedInboundMessage`.

**Custom normalization:** When `config.normalizationHook` is provided, it completely replaces the default. The hook receives `(surfaceId, raw)` and must return a valid `NormalizedInboundMessage`. No fallback logic is applied.

---

## 6. Package Boundary Constraints

| Rule | Enforcement |
|---|---|
| No import from `@relay-assistant/core` | Zero runtime deps in package.json; structural types defined locally |
| No import from `@relay-assistant/sessions` | Zero runtime deps; fanout receives `string[]` not `Session` |
| No import from `@relay-assistant/memory` | Forbidden per spec §7 |
| No transport implementation | `SurfaceAdapter` is injected; surfaces never opens sockets or calls APIs |
| No product logic | No Slack block kit, no Teams cards, no UI conventions |
| No cloud assumptions | All I/O is through the adapter interface |
| No authentication | Surface identity is an opaque string |
| No message buffering | If adapter.send fails, error propagates; no retry or queue |
| No conversation history | Surfaces handles one outbound event at a time |

---

## 7. Minimum Tests

All tests in `packages/surfaces/src/surfaces.test.ts` using vitest.

### 7.1 Surface registration (5 tests)

| # | Test | Validates |
|---|---|---|
| 1 | `register()` adds a surface connection; `get()` returns it | Basic registration |
| 2 | `register()` with duplicate ID throws `SurfaceConflictError` | Conflict detection |
| 3 | `unregister()` removes connection; `get()` returns null | Removal |
| 4 | `unregister()` on unknown ID is idempotent | No-throw on missing |
| 5 | `list()` returns all connections; filters by state and type work | Listing and filtering |

### 7.2 Connection state management (3 tests)

| # | Test | Validates |
|---|---|---|
| 6 | Initial state is `'registered'`; adapter `onConnect` callback transitions to `'active'` | registered → active |
| 7 | Adapter `onDisconnect` callback transitions to `'inactive'` | active → inactive |
| 8 | Reconnect: `onConnect` after `onDisconnect` transitions back to `'active'` | inactive → active |

### 7.3 Inbound normalization (6 tests)

| # | Test | Validates |
|---|---|---|
| 9 | `receiveRaw()` with complete raw payload produces well-formed `NormalizedInboundMessage` | All field extraction paths |
| 10 | `receiveRaw()` with missing `userId` drops message and does not call handlers | userId required |
| 11 | `receiveRaw()` with missing `text` produces message with empty string and logs warning | text fallback |
| 12 | `receiveRaw()` with missing optional fields uses fallbacks (generated UUID, current timestamp) | Optional field fallbacks |
| 13 | `receiveRaw()` with custom `normalizationHook` uses hook output instead of defaults | Hook override |
| 14 | `receiveRaw()` calls all handlers registered via `onMessage()` | Handler dispatch |

### 7.4 Outbound targeted send (4 tests)

| # | Test | Validates |
|---|---|---|
| 15 | `send()` delivers event to correct surface adapter | Targeted delivery |
| 16 | `send()` applies format hook when present; adapter receives formatted payload | Format hook integration |
| 17 | `send()` without format hook passes `event.text` as `formatted` | Default formatting |
| 18 | `send()` to unknown surface throws `SurfaceNotFoundError` | Not-found guard |

### 7.5 Outbound delivery errors (2 tests)

| # | Test | Validates |
|---|---|---|
| 19 | `send()` wraps adapter errors in `SurfaceDeliveryError` | Error wrapping |
| 20 | `SurfaceDeliveryError` preserves original error as `cause` | Cause chain |

### 7.6 Fanout (7 tests)

| # | Test | Validates |
|---|---|---|
| 21 | `fanout()` delivers to all active surfaces; returns correct `FanoutResult` | Basic fanout |
| 22 | `fanout()` skips inactive surfaces when `skipInactive=true` (default) | Skip policy |
| 23 | `fanout()` with `skipInactive=false` includes inactive surfaces with `status='skipped'` | Explicit skip policy |
| 24 | `fanout()` with `onError='continue'` collects errors and delivers to remaining surfaces | Continue-on-error |
| 25 | `fanout()` with `onError='abort'` throws on first failure | Abort policy |
| 26 | `fanout()` with unknown surface ID in list produces `'skipped'` outcome | Unknown surface handling |
| 27 | `fanout()` sends are concurrent (adapter calls overlap in time) | Concurrency |

### 7.7 RelayInboundAdapter contract (3 tests)

| # | Test | Validates |
|---|---|---|
| 28 | `onMessage()` registers handler; `receiveRaw()` invokes it | Inbound wiring |
| 29 | `offMessage()` removes handler; subsequent `receiveRaw()` does not invoke it | Handler removal |
| 30 | Multiple handlers registered; all called on `receiveRaw()` | Multi-handler support |

### 7.8 RelayOutboundAdapter contract (2 tests)

| # | Test | Validates |
|---|---|---|
| 31 | Registry used as `RelayOutboundAdapter.send()` delivers to correct surface | Outbound adapter contract |
| 32 | Registry used as `RelayOutboundAdapter.fanout()` delivers to all specified surfaces | Fanout adapter contract |

### 7.9 Compile-time contract checks (1 test)

| # | Test | Validates |
|---|---|---|
| 33 | Structural assignability: registry satisfies `RelayInboundAdapter` and `RelayOutboundAdapter` shapes | Cross-package contract |

**Total: 33 tests.**

### Test Infrastructure

- **Test runner:** Vitest (same as core and sessions)
- **Mock adapters:** Inline stub `SurfaceAdapter` implementations using `vi.fn()`:

```typescript
function createMockAdapter(initiallyActive = true): SurfaceAdapter & {
  sentPayloads: SurfacePayload[];
  connectCallback: (() => void) | null;
  disconnectCallback: (() => void) | null;
} {
  const adapter = {
    sentPayloads: [] as SurfacePayload[],
    connectCallback: null as (() => void) | null,
    disconnectCallback: null as (() => void) | null,
    send: vi.fn(async (payload: SurfacePayload) => {
      adapter.sentPayloads.push(payload);
    }),
    onConnect(callback: () => void) {
      adapter.connectCallback = callback;
      if (initiallyActive) callback();
    },
    onDisconnect(callback: () => void) {
      adapter.disconnectCallback = callback;
    },
  };
  return adapter;
}

function createTestConnection(
  id: string,
  type: SurfaceType = 'web',
  overrides?: Partial<SurfaceConnection>,
): SurfaceConnection {
  return {
    id,
    type,
    state: 'registered',
    capabilities: {
      markdown: true,
      richBlocks: false,
      attachments: false,
      streaming: false,
      maxResponseLength: 0,
    },
    adapter: createMockAdapter(),
    ...overrides,
  };
}
```

---

## 8. Implementation Order

```
Step 1 ─ types.ts            (all interfaces, type aliases, error classes,
                              structural types for core contract)
Step 2 ─ surfaces.ts         (createSurfaceRegistry: registration, state,
                              normalization, send, fanout, adapter contracts)
Step 3 ─ index.ts            (barrel exports)
Step 4 ─ surfaces.test.ts    (all 33 tests)
Step 5 ─ package.json +
         tsconfig.json       (build verification)
```

Steps 1–5 are a single PR covering WF-5. The WF-6 integration test is a separate PR in `packages/core/`.

---

## 9. Open Question Resolutions for v1

| OQ | Resolution | Rationale |
|---|---|---|
| OQ-1 (fanout concurrency) | `Promise.all`-equivalent concurrent delivery | Spec §8 mandates no ordering guarantee. Simplest correct approach. |
| OQ-3 (normalization strictness) | Permissive for optional fields (warn + fallback); `userId` absence is an error (message rejected) | Per Contradiction 2 resolution. Required field must not be silently defaulted. |

---

## 10. Pre-Existing Follow-ups from Core and Sessions Reviews

The following items from prior review verdicts should be addressed before or during the surfaces implementation:

### From core review (F-2): Export `SessionSubsystem` type

Core's internal `SessionSubsystem` duck type should be exported so surfaces' compile-time contract check can reference it. If not exported before surfaces coding begins, surfaces will define its own structural check (as described in §3.2). Either approach is acceptable for v1.

### From sessions review (F-1): WF-4 integration test

`packages/core/src/core-sessions.test.ts` must be written to validate `runtime.register('sessions', store)` → `emit({ sessionId })` → fanout. This test should be completed before or in parallel with surfaces WF-5 implementation, as it validates the fanout path that surfaces depends on.

---

V1_SURFACES_IMPLEMENTATION_PLAN_READY
