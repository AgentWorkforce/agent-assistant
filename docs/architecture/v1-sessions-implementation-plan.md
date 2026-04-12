# v1 Sessions Implementation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/sessions`
**Spec:** `docs/specs/v1-sessions-spec.md`
**Workflow:** WF-3 (standalone), WF-4 (integration with core)

---

## 1. Files to Create

All files live under `packages/sessions/`.

```
packages/sessions/
  package.json
  tsconfig.json
  src/
    types.ts          — Session, SessionState, SessionStore, SessionStoreAdapter,
                        CreateSessionInput, SessionQuery, AffinityResolver,
                        SessionStoreConfig, error classes
    sessions.ts       — createSessionStore factory, InMemorySessionStoreAdapter,
                        resolveSession utility, defaultAffinityResolver
    index.ts          — public exports
    sessions.test.ts  — all WF-3 tests
```

**Four source files, one test file.** Mirrors the core package's consolidated approach (spec noted core combined errors + runtime + logger into one file; sessions does the same with store + adapter + utilities).

---

## 2. File Contents

### 2.1 `package.json`

```json
{
  "name": "@relay-assistant/sessions",
  "version": "0.1.0",
  "description": "Session lifecycle, storage, and affinity for Relay Agent Assistant SDK",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
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

Zero runtime dependencies. `@relay-assistant/core` is **not** a dependency — sessions imports nothing from core at runtime. The `InboundMessage` type is only used by the `resolveSession` utility; it is re-declared as a minimal structural type (duck-typed) to avoid the import. This keeps the dependency graph clean per spec §7.

### 2.2 `tsconfig.json`

Same structure as core's tsconfig: ES2022 target, NodeNext module, strict mode, declarations to `dist/`.

### 2.3 `types.ts`

Exports all spec §4 interfaces and error classes:

| Export | Kind | Spec section |
|---|---|---|
| `Session` | interface | §4.1 |
| `SessionState` | type alias | §4.1 |
| `SessionStore` | interface | §4.2 |
| `CreateSessionInput` | interface | §4.3 |
| `SessionQuery` | interface | §4.4 |
| `SessionStoreAdapter` | interface | §4.5 |
| `AffinityResolver` | interface | §4.6 |
| `SessionStoreConfig` | interface | §5 |
| `SessionNotFoundError` | class | §4.7 |
| `SessionConflictError` | class | §4.7 |
| `SessionStateError` | class | §4.7 |

Each field matches the spec exactly. No additions, no omissions.

### 2.4 `sessions.ts`

Three exports:

1. **`createSessionStore(config: SessionStoreConfig): SessionStore`** — factory that wraps a `SessionStoreAdapter` with lifecycle logic:
   - `create()` — sets `state: 'created'`, `createdAt` and `lastActivityAt` to `new Date().toISOString()`, empty `attachedSurfaces`, empty `metadata` (merged with input metadata if provided). Attaches `initialSurfaceId` if present. Calls `adapter.insert()`. Throws `SessionConflictError` if `adapter.fetchById` returns non-null before insert.
   - `get()` — delegates to `adapter.fetchById()`.
   - `find()` — delegates to `adapter.fetchMany()`. Default limit is 50.
   - `touch()` — fetches session; throws `SessionNotFoundError` if missing; throws `SessionStateError` if state is `expired`; transitions `created` or `suspended` to `active`; updates `lastActivityAt` and `stateChangedAt`; calls `adapter.update()`.
   - `attachSurface()` — fetches session; throws `SessionNotFoundError` if missing; idempotent if already attached; appends surfaceId to `attachedSurfaces`; calls `adapter.update()`.
   - `detachSurface()` — fetches session; throws `SessionNotFoundError` if missing; idempotent if not attached; removes surfaceId from `attachedSurfaces`; calls `adapter.update()`.
   - `expire()` — fetches session; throws `SessionNotFoundError` if missing; idempotent if already `expired`; transitions to `expired`; sets `stateChangedAt`; calls `adapter.update()`.
   - `sweepStale(ttlMs)` — calls `adapter.fetchMany({ state: 'active' })`; filters by `lastActivityAt` older than `Date.now() - ttlMs`; transitions each to `suspended`; returns transitioned sessions. Uses `config.defaultTtlMs` as fallback if `ttlMs` not provided.
   - `updateMetadata()` — fetches session; throws `SessionNotFoundError` if missing; merges (shallow `Object.assign`) new metadata into existing; calls `adapter.update()`.

2. **`InMemorySessionStoreAdapter`** — class implementing `SessionStoreAdapter`:
   - Backed by a `Map<string, Session>`.
   - `insert()` — throws if key exists; stores a deep clone.
   - `fetchById()` — returns deep clone or null.
   - `fetchMany(query)` — filters the map by all `SessionQuery` fields (userId, workspaceId, state, surfaceId, activeAfter); applies limit; returns clones.
   - `update(sessionId, patch)` — throws if missing; applies `Object.assign` on stored record; returns clone.
   - `delete(sessionId)` — removes from map (no-op if missing).
   - Deep clones prevent external mutation of stored sessions.

3. **`resolveSession(message, store, resolver): Promise<Session>`** — utility:
   - Calls `resolver.resolve(message.userId, message.surfaceId)`.
   - If resolver returns a session, calls `store.touch(session.id)` and returns.
   - Otherwise, calls `store.create({ id: crypto.randomUUID(), userId: message.userId, workspaceId: message.workspaceId, initialSurfaceId: message.surfaceId })` and returns.

4. **`defaultAffinityResolver(store: SessionStore): AffinityResolver`** — factory returning an `AffinityResolver` that:
   - Calls `store.find({ userId, state: ['active', 'suspended'], limit: 1 })` sorted by most recent `lastActivityAt`.
   - If `surfaceId` is provided, prefers sessions with that surface attached (falls back to any).
   - Returns the best match or null.

### 2.5 `index.ts`

```typescript
export {
  createSessionStore,
  InMemorySessionStoreAdapter,
  resolveSession,
  defaultAffinityResolver,
} from './sessions.js';

export {
  SessionNotFoundError,
  SessionConflictError,
  SessionStateError,
} from './types.js';

export type {
  Session,
  SessionState,
  SessionStore,
  CreateSessionInput,
  SessionQuery,
  SessionStoreAdapter,
  AffinityResolver,
  SessionStoreConfig,
} from './types.js';
```

---

## 3. Contract with Core Runtime

### 3.1 The `SessionSubsystem` shape

When sessions is registered into core via `runtime.register('sessions', store)`, core's `emit()` fanout path expects the registered object to satisfy this duck-typed shape (defined internally in `packages/core/src/core.ts` lines 26–37):

```typescript
type SessionSubsystem =
  | { get(sessionId: string): SessionRecord | null | undefined | Promise<SessionRecord | null | undefined>; }
  | { getSession(sessionId: string): SessionRecord | null | undefined | Promise<SessionRecord | null | undefined>; };

type SessionRecord = {
  attachedSurfaces?: string[];
};
```

**Sessions satisfies this via `SessionStore.get(sessionId): Promise<Session | null>`.**

The `Session` interface includes `attachedSurfaces: string[]`, which is a superset of `SessionRecord`. The `SessionStore.get` method signature matches the first variant of `SessionSubsystem`. No adapter, wrapper, or type assertion is needed — structural typing handles it.

### 3.2 Verification

The WF-4 integration test (out of scope for this package, lives in `packages/core/`) will verify this contract. However, `sessions.test.ts` must include a **compile-time assignability check** to catch drift:

```typescript
import type { SessionStore } from './types.js';

// Compile-time contract check: SessionStore.get must satisfy core's SessionSubsystem shape
type SessionSubsystemGet = {
  get(sessionId: string): { attachedSurfaces?: string[] } | null | undefined | Promise<{ attachedSurfaces?: string[] } | null | undefined>;
};
const _contractCheck: SessionSubsystemGet = {} as SessionStore; // must compile
```

This ensures that if `SessionStore.get` changes signature, the sessions package itself fails to compile before the integration test is even reached.

### 3.3 `resolveSession` message type

The `resolveSession` utility needs `userId`, `workspaceId?`, and `surfaceId` from the inbound message. Rather than importing `InboundMessage` from core (which would create a runtime dependency), define a minimal structural input type:

```typescript
export interface SessionResolvableMessage {
  userId: string;
  workspaceId?: string;
  surfaceId: string;
}
```

Core's `InboundMessage` is a structural superset of this, so callers can pass an `InboundMessage` directly.

---

## 4. Implementation Slice Mapping

### Slice 1: WF-3 — Sessions standalone (this PR)

Everything in §2 above. Fully self-contained. No dependency on core being built. Produces:

- All types from spec §4
- `createSessionStore` factory (spec §5)
- `InMemorySessionStoreAdapter`
- `resolveSession` + `defaultAffinityResolver`
- Full test suite

### Slice 2: WF-4 — Wire into core (next PR, separate plan)

Lives in `packages/core/`. Adds:
- Integration test `packages/core/src/core-sessions.test.ts`
- Validates `runtime.register('sessions', store)` + `runtime.get<SessionStore>('sessions')`
- Validates `resolveSession` end-to-end through dispatch

Sessions package ships no code changes in WF-4. The integration test imports from `@relay-assistant/sessions`.

---

## 5. State Transition Rules

Encoded in `createSessionStore` logic. These are the authoritative transitions:

| From | To | Trigger | Side effects |
|---|---|---|---|
| `created` | `active` | `touch()` | `lastActivityAt` updated, `stateChangedAt` set |
| `active` | `active` | `touch()` | `lastActivityAt` updated (no state change) |
| `active` | `suspended` | `sweepStale()` | `stateChangedAt` set |
| `active` | `expired` | `expire()` | `stateChangedAt` set |
| `suspended` | `active` | `touch()` | `lastActivityAt` updated, `stateChangedAt` set |
| `suspended` | `expired` | `expire()` | `stateChangedAt` set |
| `expired` | `expired` | `expire()` | Idempotent, no-op |
| `expired` | _(any)_ | `touch()` | Throws `SessionStateError` |
| `created` | `expired` | `expire()` | `stateChangedAt` set |

---

## 6. Minimum Tests

All tests in `packages/sessions/src/sessions.test.ts` using vitest.

### 6.1 Session creation (4 tests)

| # | Test | Validates |
|---|---|---|
| 1 | Create session with required fields returns session with `state: 'created'` | `create()`, default field values |
| 2 | Create session with `initialSurfaceId` attaches surface | `create()` + surface attachment |
| 3 | Create session with metadata populates `metadata` field | `create()` + metadata merge |
| 4 | Create session with duplicate ID throws `SessionConflictError` | Conflict detection |

### 6.2 Session retrieval (3 tests)

| # | Test | Validates |
|---|---|---|
| 5 | `get()` returns session by ID | Basic retrieval |
| 6 | `get()` returns `null` for unknown ID | Null semantics |
| 7 | `find()` filters by userId, state, and limit | Query filtering |

### 6.3 Lifecycle transitions (6 tests)

| # | Test | Validates |
|---|---|---|
| 8 | `touch()` transitions `created` to `active`, updates timestamps | created → active |
| 9 | `touch()` on `active` session updates `lastActivityAt` only | active → active |
| 10 | `touch()` on `suspended` session transitions to `active` | suspended → active |
| 11 | `touch()` on `expired` session throws `SessionStateError` | expired guard |
| 12 | `expire()` transitions `active` to `expired` | active → expired |
| 13 | `expire()` on already-expired session is idempotent | Idempotency |

### 6.4 Surface attachment (3 tests)

| # | Test | Validates |
|---|---|---|
| 14 | `attachSurface()` adds surface to `attachedSurfaces` | Attach |
| 15 | `attachSurface()` is idempotent for already-attached surface | Idempotency |
| 16 | `detachSurface()` removes surface; idempotent if not present | Detach + idempotency |

### 6.5 Sweep and metadata (3 tests)

| # | Test | Validates |
|---|---|---|
| 17 | `sweepStale()` transitions stale active sessions to `suspended` | TTL-based sweep |
| 18 | `sweepStale()` does not affect sessions within TTL | Non-stale sessions preserved |
| 19 | `updateMetadata()` merges new keys without replacing existing | Metadata merge semantics |

### 6.6 Error cases (3 tests)

| # | Test | Validates |
|---|---|---|
| 20 | `touch()` on unknown session throws `SessionNotFoundError` | Not-found guard |
| 21 | `attachSurface()` on unknown session throws `SessionNotFoundError` | Not-found guard |
| 22 | `updateMetadata()` on unknown session throws `SessionNotFoundError` | Not-found guard |

### 6.7 Affinity and session resolution (3 tests)

| # | Test | Validates |
|---|---|---|
| 23 | `defaultAffinityResolver` returns most recent active session for userId | Default affinity |
| 24 | `resolveSession()` creates new session when no existing session found | Auto-create path |
| 25 | `resolveSession()` returns existing session when affinity resolves | Reuse path |

### 6.8 Contract check (1 test)

| # | Test | Validates |
|---|---|---|
| 26 | Compile-time assignability: `SessionStore` satisfies core's `SessionSubsystem` shape | Cross-package contract |

**Total: 26 tests.**

---

## 7. Package Boundary Constraints

These rules are enforced by code review and the zero-dependency `package.json`:

| Rule | Enforcement |
|---|---|
| No import from `@relay-assistant/surfaces` | Zero runtime deps in package.json |
| No import from `@relay-assistant/core` | Zero runtime deps; `SessionResolvableMessage` defined locally |
| No storage driver dependency | `SessionStoreAdapter` is injected; only `InMemorySessionStoreAdapter` ships |
| No network calls | All I/O is through the adapter interface |
| No timer/scheduler for sweep | `sweepStale()` is caller-driven (spec §3, OQ-1) |
| No authentication logic | `userId` is an opaque string; not validated |
| No product-specific logic | No workspace enforcement, no policy, no routing decisions |
| No cloud assumptions | In-memory adapter is the only shipped implementation |

---

## 8. Open Questions Resolved

| OQ | Resolution | Impact on implementation |
|---|---|---|
| OQ-1 (sweep is caller-driven) | No internal timer in `createSessionStore` | `sweepStale()` is a plain method; no `setInterval` |
| OQ-4 (AffinityResolver at call-site) | `resolveSession()` accepts resolver as argument | `defaultAffinityResolver` is a factory, not wired into store |

---

V1_SESSIONS_IMPLEMENTATION_PLAN_READY
