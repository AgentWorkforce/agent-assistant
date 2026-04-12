# v1 Sessions Spec — `@agent-assistant/sessions`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@agent-assistant/sessions`
**Version target:** v0.1.0 (pre-1.0, provisional)

---

## 1. Responsibilities

`@agent-assistant/sessions` manages the continuity unit that spans surfaces. A session is not a conversation turn; it is the persistent identity context within which turns happen.

**Owns:**
- `Session` entity — identity, metadata, lifecycle state, associated surfaces
- `SessionStore` — CRUD + query interface for sessions; storage backend is injected via adapter
- Session lifecycle — creation, activation, suspension, expiry, resumption
- Surface attachment — binding/unbinding surfaces to sessions; enforcing one-session-per-surface-slot rules
- Affinity — routing hint that prefers continuing an existing session over starting a new one when a returning user is detected
- Session scoping — sessions belong to a user, a workspace, or a combination; scope is recorded but not enforced by this package (enforcement is memory's concern)
- Stale-session detection — sessions that have not seen activity within a configurable TTL are marked `suspended`; explicit expiry marks them `expired`

**Does NOT own:**
- Memory content within a session (→ `@agent-assistant/memory`)
- Message routing decisions (→ `@agent-assistant/routing`)
- Surface protocol or formatting (→ `@agent-assistant/surfaces`)
- Multi-assistant coordination (→ `@agent-assistant/coordination`)
- Policy enforcement on session operations (→ `@agent-assistant/policy`)

---

## 2. Non-Goals

- Sessions does not persist to any specific storage backend. It defines the `SessionStoreAdapter` interface; the caller provides an implementation (in-memory, Redis, Postgres, etc.).
- Sessions does not manage HTTP cookies, JWT tokens, or authentication. It receives a `userId` string; it does not validate it.
- Sessions does not start or stop relay connections. Surface attachment records which relay surface IDs are bound; it does not open those surfaces.
- Sessions is not a presence system. It does not track whether a user is currently "online".
- Sessions does not fanout messages across attached surfaces. That is surfaces' concern.

---

## 3. Session Lifecycle

```
created ──► active ──► suspended ──► active   (touch)
                    └──► expired               (TTL exceeded while suspended, or explicit expiry)

active ──► expired                             (explicit expiry while active)
```

| State | Meaning |
|---|---|
| `created` | Initialized but no message processed yet. |
| `active` | At least one message processed; within activity TTL. |
| `suspended` | No activity within TTL; transitions back to `active` via `touch()`. Memory is preserved. |
| `expired` | Terminal state. Memory may be archived per policy. No further transitions. |

State transitions are recorded with a timestamp. Sessions does not automatically expire sessions on a timer; it marks sessions stale when queried or when the caller explicitly invokes `sessionStore.expire()`.

---

## 4. Interfaces and Contracts

### 4.1 `Session`

```typescript
export interface Session {
  /** Relay-assigned or caller-assigned unique ID. Immutable after creation. */
  id: string;

  /** The user this session belongs to. Opaque string; not validated here. */
  userId: string;

  /**
   * Optional workspace scope. When set, session is scoped to both user and
   * workspace. Memory retrieval uses this to narrow scope.
   */
  workspaceId?: string;

  /** Current lifecycle state. */
  state: SessionState;

  /** ISO-8601 timestamp of session creation. */
  createdAt: string;

  /** ISO-8601 timestamp of last inbound message. Updated by sessionStore.touch(). */
  lastActivityAt: string;

  /** ISO-8601 timestamp of state transition, if suspended or expired. */
  stateChangedAt?: string;

  /**
   * Surface IDs currently attached to this session.
   * A session may have multiple surfaces (e.g., web + Slack).
   */
  attachedSurfaces: string[];

  /**
   * Arbitrary key-value metadata. Products may store product-specific fields
   * here without modifying the Session schema.
   */
  metadata: Record<string, unknown>;
}

export type SessionState = 'created' | 'active' | 'suspended' | 'expired';
```

### 4.2 `SessionStore`

```typescript
export interface SessionStore {
  /**
   * Create a new session. Throws SessionConflictError if a session with this
   * id already exists.
   */
  create(input: CreateSessionInput): Promise<Session>;

  /**
   * Retrieve a session by ID. Returns null if not found.
   */
  get(sessionId: string): Promise<Session | null>;

  /**
   * Find sessions matching the given query. Returns empty array if none found.
   */
  find(query: SessionQuery): Promise<Session[]>;

  /**
   * Record inbound message activity; transitions state from 'created' or
   * 'suspended' to 'active' if necessary. Updates lastActivityAt.
   */
  touch(sessionId: string): Promise<Session>;

  /**
   * Attach a surface to a session. Idempotent if already attached.
   * Throws SessionNotFoundError if session does not exist.
   */
  attachSurface(sessionId: string, surfaceId: string): Promise<Session>;

  /**
   * Detach a surface from a session. Idempotent if not attached.
   */
  detachSurface(sessionId: string, surfaceId: string): Promise<Session>;

  /**
   * Mark a session as expired. Transitions from any state to 'expired'.
   * Idempotent if already expired.
   */
  expire(sessionId: string): Promise<Session>;

  /**
   * Check sessions against the TTL and mark stale ones as 'suspended'.
   * Callers should invoke this on a schedule (e.g., every 5 minutes).
   * Returns the sessions that were transitioned.
   */
  sweepStale(ttlMs: number): Promise<Session[]>;

  /**
   * Update arbitrary metadata fields. Merges (does not replace) the metadata
   * map. Throws SessionNotFoundError if session does not exist.
   */
  updateMetadata(
    sessionId: string,
    metadata: Record<string, unknown>,
  ): Promise<Session>;
}
```

### 4.3 `CreateSessionInput`

```typescript
export interface CreateSessionInput {
  /** Caller-provided ID. Must be globally unique. Use a UUID. */
  id: string;

  userId: string;
  workspaceId?: string;

  /** Initial surface to attach. Optional; surfaces may be attached later. */
  initialSurfaceId?: string;

  /** Seed metadata. Optional. */
  metadata?: Record<string, unknown>;
}
```

### 4.4 `SessionQuery`

```typescript
export interface SessionQuery {
  userId?: string;
  workspaceId?: string;
  state?: SessionState | SessionState[];
  surfaceId?: string;

  /** Return sessions with lastActivityAt after this ISO-8601 timestamp. */
  activeAfter?: string;

  /** Maximum results. Defaults to 50. */
  limit?: number;
}
```

### 4.5 `SessionStoreAdapter`

```typescript
/**
 * Storage backend interface. Implementations provide persistence.
 * Core package does not depend on this; it is injected by the caller.
 */
export interface SessionStoreAdapter {
  insert(session: Session): Promise<void>;
  fetchById(sessionId: string): Promise<Session | null>;
  fetchMany(query: SessionQuery): Promise<Session[]>;
  update(sessionId: string, patch: Partial<Session>): Promise<Session>;
  delete(sessionId: string): Promise<void>;
}
```

### 4.6 `AffinityResolver`

```typescript
/**
 * Optional hook for routing layer to prefer an existing session.
 * Implemented by the caller; sessions package provides the interface
 * and a default implementation.
 */
export interface AffinityResolver {
  /**
   * Given a userId and optional surfaceId, return the best session to
   * continue, or null to start a new one.
   */
  resolve(userId: string, surfaceId?: string): Promise<Session | null>;
}
```

Default implementation: find the most recently active `active` or `suspended` session for the user. Products may override to add workspace, surface-type, or time-window constraints.

### 4.7 Error types

```typescript
export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session not found: ${sessionId}`);
  }
}

export class SessionConflictError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session already exists: ${sessionId}`);
  }
}

export class SessionStateError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly currentState: SessionState,
    public readonly attemptedTransition: string,
  ) {
    super(
      `Invalid transition '${attemptedTransition}' from state '${currentState}' for session ${sessionId}`,
    );
  }
}
```

---

## 5. `createSessionStore` Factory

```typescript
export function createSessionStore(config: SessionStoreConfig): SessionStore;

export interface SessionStoreConfig {
  adapter: SessionStoreAdapter;

  /**
   * Default TTL in milliseconds. Sessions with no activity for this period
   * are marked 'suspended' by sweepStale(). Defaults to 3600000 (1 hour).
   */
  defaultTtlMs?: number;
}
```

---

## 6. Package Boundaries

### Depends on
- `@agent-assistant/core` — imports `InboundMessage` type to extract `sessionId` in middleware helper (optional utility; not a hard runtime dependency).

### Depended on by
- `@agent-assistant/surfaces` — reads attached surfaces from session to fanout messages.
- `@agent-assistant/memory` — reads `userId`, `workspaceId`, `id` from session to scope memory queries.
- `@agent-assistant/routing` — reads session metadata for affinity routing.
- `@agent-assistant/coordination` — reads session context when delegating work to specialists.

### Relay foundation boundary
- Sessions has no direct dependency on the relay foundation. `surfaceId` strings are opaque identifiers passed from the relay layer through core; sessions stores them but does not call relay APIs.

### Storage boundary
- All persistence goes through `SessionStoreAdapter`. The adapter is provided by the caller or by a platform package (e.g., `@agent-assistant/platform-redis`). Sessions never imports a specific storage driver.

---

## 7. Dependency Rules

| Direction | Rule |
|---|---|
| Sessions → core | Allowed. Import types only (InboundMessage for session middleware utility). |
| Sessions → surfaces | Forbidden. |
| Sessions → memory | Forbidden. |
| Sessions → routing | Forbidden. |
| Sessions → relay foundation | Forbidden. |
| Other packages → sessions | Allowed. Import `Session`, `SessionStore`, `AffinityResolver` types. |

---

## 8. Integration with Core Runtime

Sessions registers itself on the `AssistantRuntime` via:

```typescript
runtime.register('sessions', sessionStore);
```

Capability handlers retrieve the store via:

```typescript
const sessions = context.runtime.get<SessionStore>('sessions');
```

There is no automatic session middleware injected by this package into core's dispatch pipeline. Products wire session lookups into capability handlers themselves, or use a helper utility exported by this package:

```typescript
/**
 * Convenience: given an InboundMessage, look up or create a session.
 * Does not modify core dispatch behavior.
 */
export async function resolveSession(
  message: InboundMessage,
  store: SessionStore,
  resolver: AffinityResolver,
): Promise<Session>;
```

---

## 9. OSS vs Cloud Boundary

All types, factory functions, and the in-memory adapter are OSS.

The `SessionStoreAdapter` interface is OSS; Redis/Postgres/DynamoDB implementations may be cloud-specific packages that are not part of this monorepo.

No session behavior depends on a hosted service. A self-hosted consumer can provide an in-memory or SQLite-backed adapter.

---

## 10. Open Questions

| # | Question | Owner | Resolution target |
|---|---|---|---|
| OQ-1 | Should `sweepStale()` be initiated by the sessions package on a timer, or remain caller-driven? Caller-driven is simpler but requires products to remember to call it. | Sessions | First implementation slice |
| OQ-2 | Should surface attachment enforce a maximum number of surfaces per session? If so, what is the default? | Sessions + Surfaces | Before WF-4 workflow |
| OQ-3 | When a session is `expired`, should the store delete the record or retain it with state=expired for audit? Current spec retains; need explicit call to delete. | Sessions | Before persistent adapter implementations |
| OQ-4 | Should `AffinityResolver` be injectable at the store level or at the call-site level? Current spec puts it at call-site (passed to `resolveSession`). | Sessions + Routing | Before WF-3 workflow |
| OQ-5 | How should session metadata versioning work if a product adds a field that is later removed? | Sessions | v1.1 (not blocking) |

---

## 11. First Implementation Slice

**Step 1 — Type exports only**
- Export all interfaces, types, and error classes.
- Tests: TypeScript accepts conforming objects.

**Step 2 — In-memory `SessionStoreAdapter`**
- Implement `InMemorySessionStoreAdapter` backed by a `Map`.
- Tests: insert, fetchById, fetchMany with filters, update patch merges correctly.

**Step 3 — `createSessionStore` with lifecycle**
- Implement `create`, `get`, `find`, `touch`, `expire`.
- Validate state transitions; throw `SessionStateError` on invalid ones.
- Tests: full lifecycle from created → active → suspended → expired.

**Step 4 — Surface attachment**
- Implement `attachSurface` and `detachSurface`.
- Tests: idempotency; error on unknown session.

**Step 5 — `sweepStale`**
- Implement TTL check; transition `active` sessions with old `lastActivityAt` to `suspended`.
- Tests: sessions at various ages; only stale ones transition.

**Step 6 — `resolveSession` utility**
- Implement default `AffinityResolver` and `resolveSession` helper.
- Tests: returns existing active session; falls back to suspended; creates new when none.

**Step 7 — `runtime.register` integration test**
- Wire session store onto a mock `AssistantRuntime`; capability handler retrieves it and calls `touch()`.
- Tests: integration test that exercises full path from dispatch to session update.

**Definition of done:** WF-3 (Create and manage sessions) workflow can run against this package using the in-memory adapter.

SPEC_READY
