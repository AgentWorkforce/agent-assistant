---SESSIONS SPEC---
# v1 Sessions Spec — `@relay-assistant/sessions`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/sessions`
**Version target:** v0.1.0 (pre-1.0, provisional)

---

## 1. Responsibilities

`@relay-assistant/sessions` manages the continuity unit that spans surfaces. A session is not a conversation turn; it is the persistent identity context within which turns happen.

**Owns:**
- `Session` entity — identity, metadata, lifecycle state, associated surfaces
- `SessionStore` — CRUD + query interface for sessions; storage backend is injected via adapter
- Session lifecycle — creation, activation, suspension, expiry, resumption
- Surface attachment — binding/unbinding surfaces to sessions; enforcing one-session-per-surface-slot rules
- Affinity — routing hint that prefers continuing an existing session over starting a new one when a returning user is detected
- Session scoping — sessions belong to a user, a workspace, or a combination; scope is recorded but not enforced by this package (enforcement is memory's concern)
- Stale-session detection — sessions that have not seen activity within a configurable TTL are marked `suspended`; explicit expiry marks them `expired`

**Does NOT own:**
- Memory content within a session (→ `@relay-assistant/memory`)
- Message routing decisions (→ `@relay-assistant/routing`)
- Surface protocol or formatting (→ `@relay-assistant/surfaces`)
- Multi-assistant coordination (→ `@relay-assistant/coordination`)
- Policy enforcement on session operations (→ `@relay-assistant/policy`)

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
- `@relay-assistant/core` — imports `InboundMessage` type to extract `sessionId` in middleware helper (optional utility; not a hard runtime dependency).

### Depended on by
- `@relay-assistant/surfaces` — reads attached surfaces from session to fanout messages.
- `@relay-assistant/memory` — reads `userId`, `workspaceId`, `id` from session to scope memory queries.
- `@relay-assistant/routing` — reads session metadata for affinity routing.
- `@relay-assistant/coordination` — reads session context when delegating work to specialists.

### Relay foundation boundary
- Sessions has no direct dependency on the relay foundation. `surfaceId` strings are opaque identifiers passed from the relay layer through core; sessions stores them but does not call relay APIs.

### Storage boundary
- All persistence goes through `SessionStoreAdapter`. The adapter is provided by the caller or by a platform package (e.g., `@relay-assistant/platform-redis`). Sessions never imports a specific storage driver.

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


---WORKFLOW BACKLOG---
# V1 Workflow Backlog

Date: 2026-04-11
Revised: 2026-04-11 (post spec-program-review-verdict and spec-reconciliation-rules — aligned to canonical spec vocabulary; fanout/targeting rules and cross-package ownership clarified)

> **Canonical source of truth:** Package specs in `docs/specs/` override this document when there is drift. This backlog was updated to align with `docs/specs/v1-core-spec.md`, `docs/specs/v1-sessions-spec.md`, and `docs/specs/v1-surfaces-spec.md` after the spec program review and reconciliation rules pass on 2026-04-11.

## Purpose

This document is the canonical ordered backlog of implementation workflows for v1. Each workflow is a narrow, PR-sized vertical slice through one or more packages. Workflows produce working, testable code and are the unit of implementation work.

Implement in order. Each workflow gates the next unless explicitly noted as parallelizable.

---

## Pre-Workflow: Reconciliation Phase (Complete — WF-1 implementation may begin)

### Spec Phase

Three spec documents are finalized and marked `IMPLEMENTATION_READY`. They are the authoritative implementation reference for all workflow code.

| Spec | Path | Status |
| --- | --- | --- |
| core v1 | `docs/specs/v1-core-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |
| sessions v1 | `docs/specs/v1-sessions-spec.md` | IMPLEMENTATION_READY |
| surfaces v1 | `docs/specs/v1-surfaces-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |

### Contradiction Resolutions (Gate cleared — all actions complete)

Three cross-package contradictions identified in `docs/architecture/spec-reconciliation-rules.md` have been resolved in the specs. Both `docs/specs/v1-core-spec.md` and `docs/specs/v1-surfaces-spec.md` carry `SPEC_RECONCILED` status. All eight checklist actions in the reconciliation rules document are complete.

| Action | Target | Contradiction | Status |
| --- | --- | --- | --- |
| 1 | `docs/specs/v1-core-spec.md`: remove "owns inbound normalization" from §1; update `RelayInboundAdapter` to accept `InboundMessage` (not `raw: unknown`) | 1 — inbound normalization ownership | **Resolved** — `SPEC_RECONCILED` |
| 2 | `docs/specs/v1-core-spec.md §3.3`: add `userId: string` (required) and `workspaceId?: string` (optional) to `InboundMessage` | 2 — missing identity fields | **Resolved** — `SPEC_RECONCILED` |
| 3 | `docs/specs/v1-core-spec.md §3.8`: make `OutboundEvent.surfaceId` optional (`surfaceId?`); add `OutboundEventError` | 3 — required surfaceId vs. fanout | **Resolved** — `SPEC_RECONCILED` |
| 4 | `docs/specs/v1-core-spec.md`: add normative outbound routing rule to `runtime.emit()` contract | 3 | **Resolved** — `SPEC_RECONCILED` |
| 5 | `docs/specs/v1-surfaces-spec.md`: confirm `SurfaceRegistry` implements `RelayInboundAdapter`; add `userId`/`workspaceId` to normalization table §4.10 | 1, 2 | **Resolved** — `SPEC_RECONCILED` |
| 6 | `docs/specs/v1-surfaces-spec.md`: add normative outbound routing rule reference | 3 | **Resolved** — `SPEC_RECONCILED` |
| 7 | Update adoption examples in `docs/workflows/weekend-delivery-plan.md` to match resolved contracts | all | **Resolved** |
| 8 | Search all docs for stale terms (Rule 1 table); replace with current terms | all | **Resolved** |

### Key canonical terms (do not use old planning vocabulary)

- `AssistantDefinition` (not `AssistantConfig`)
- `AssistantRuntime` (not `Assistant`)
- `runtime.dispatch()` (not `handleMessage`)
- `InboundMessage` / `OutboundEvent` (not `AssistantMessage`)
- `createSurfaceRegistry()` + `SurfaceConnection` (not `createSurfaceConnection()`)
- `sessionStore.touch()` / `sessionStore.expire()` (not `resume` / `close`)
- Session states: `created → active → suspended → expired` (not `resumed` or `closed`)
- `surfaceRegistry` wired as both `inbound` and `outbound` relay adapter (not `assistant.attachSurface()`)

---

## WF-1: Define assistant and start runtime

**Package:** `core`
**Depends on:** `docs/specs/v1-core-spec.md` (`SPEC_RECONCILED` — Contradiction 1–3 resolutions applied)
**Produces:** `AssistantDefinition`, `AssistantRuntime`, `createAssistant`, lifecycle state machine, `runtime.status()`
**PR scope:** `packages/core/src/types.ts`, `packages/core/src/core.ts`, `packages/core/src/core.test.ts`

### Steps

1. Define an `AssistantDefinition` with `id`, `name`, and a `capabilities` map (`Record<string, CapabilityHandler>`)
2. Call `createAssistant(definition, { inbound: stubAdapter, outbound: stubAdapter })` — returns `AssistantRuntime`
3. Call `runtime.start()` — verify `runtime.status().ready === true`
4. Call `runtime.stop()` — verify runtime is no longer accepting dispatches
5. Verify double-start is idempotent or throws expected error
6. Verify double-stop is idempotent or throws expected error

### Acceptance criteria

- `AssistantDefinition` interface is defined and exported from `packages/core/src/index.ts`
- `AssistantRuntime` interface is defined and exported
- `createAssistant` factory is exported; it validates `definition` and throws `AssistantDefinitionError` on invalid input
- `runtime.status()` returns `RuntimeStatus` reflecting `ready`, `startedAt`, `registeredCapabilities`, `registeredSubsystems`, `inFlightHandlers`
- At least one test exercises the full start/stop cycle with a stub relay adapter
- No network calls, no side effects outside in-memory state
- `RelayInboundAdapter` and `RelayOutboundAdapter` interfaces are exported (with `RelayInboundAdapter.onMessage` accepting `InboundMessage` per Contradiction 1 resolution)

### Open questions to resolve before coding

- OQ-2: String keys vs typed tokens for `register()` / `get()` — default to string keys for v1
- OQ-4: `handlerTimeoutMs` applies per-invocation for v1

---

## WF-2: Handle inbound message via capability dispatch

**Package:** `core`
**Depends on:** WF-1
**Produces:** capability dispatch table, `runtime.dispatch()`, `AssistantHooks.onMessage` pre-filter, `runtime.emit()`, `InboundMessage` / `OutboundEvent` types
**PR scope:** additions to `packages/core/src/types.ts`, additions to `packages/core/src/core.ts`, new test cases in `packages/core/src/core.test.ts`

### Steps

1. Create and start a runtime with a capability named `"chat"` mapped to a handler function
2. Call `runtime.dispatch(inboundMessage)` where `inboundMessage.capability === "chat"`
3. Verify the `"chat"` handler is called with the correct `InboundMessage` and `CapabilityContext`
4. Handler calls `context.runtime.emit(outboundEvent)` — verify stub outbound adapter receives the event
5. Register an `onMessage` hook that returns `false` — verify dispatch is dropped before handler is called
6. Dispatch a message with an unregistered capability — verify expected error or no-op behavior
7. Verify `runtime.status().inFlightHandlers` tracks concurrent handler invocations

### Acceptance criteria

- `InboundMessage` type is defined and exported with all fields:
  `id`, `surfaceId`, `sessionId?`, `userId` (required — per Contradiction 2 resolution), `workspaceId?` (optional — per Contradiction 2 resolution), `text`, `raw`, `receivedAt`, `capability`
- `OutboundEvent` type is defined and exported:
  `surfaceId?` (optional — per Contradiction 3 resolution), `sessionId?`, `text`, `format?`
- `OutboundEventError` is defined and exported; `runtime.emit()` throws it when both `surfaceId` and `sessionId` are absent
- `CapabilityHandler` type signature matches spec: `(message: InboundMessage, context: CapabilityContext) => Promise<void> | void`
- `CapabilityContext` includes `runtime` and `log`
- `AssistantHooks.onMessage` returning `false` drops the message; `true` or `undefined` proceeds
- `runtime.emit()` calls `RelayOutboundAdapter.send()` with the `OutboundEvent`
- At least two tests: one happy path with handler invoked and emit called, one with `onMessage` returning false

### Open questions to resolve before coding

- OQ-1: `runtime.emit()` returns `Promise<void>`; no ack semantics in v1 — fire and forward

---

## WF-3: Create and manage sessions

**Package:** `sessions`
**Depends on:** `docs/specs/v1-sessions-spec.md` (independent of WF-1/WF-2 — parallelizable)
**Produces:** `SessionStore`, `Session`, lifecycle transitions, in-memory `SessionStoreAdapter`, error types
**PR scope:** `packages/sessions/src/types.ts`, `packages/sessions/src/sessions.ts`, `packages/sessions/src/sessions.test.ts`

### Steps

1. Create a session store: `createSessionStore({ adapter: new InMemorySessionStoreAdapter() })`
2. Call `store.create({ id: uuid(), userId, workspaceId })` — returns `Session` with `state: 'created'`, timestamps
3. Call `store.get(sessionId)` — returns the same session
4. Call `store.touch(sessionId)` — state transitions to `'active'`, `lastActivityAt` updates
5. Call `store.attachSurface(sessionId, surfaceId)` — `session.attachedSurfaces` includes the surface id
6. Call `store.detachSurface(sessionId, surfaceId)` — `session.attachedSurfaces` no longer includes it (idempotent)
7. Call `store.expire(sessionId)` — state transitions to `'expired'`
8. Verify `store.get(unknownId)` returns `null`
9. Verify `store.sweepStale(ttlMs)` transitions active sessions with stale `lastActivityAt` to `'suspended'`
10. Verify illegal transitions throw `SessionStateError` (e.g., `expire` on already-expired session is idempotent per spec; `touch` after `expired` should throw)

### Acceptance criteria

- `Session` interface matches spec: `id`, `userId`, `workspaceId?`, `state`, `createdAt`, `lastActivityAt`, `stateChangedAt?`, `attachedSurfaces`, `metadata`
- `SessionState` union type: `'created' | 'active' | 'suspended' | 'expired'`
- `SessionStore` interface fully implemented with `create`, `get`, `find`, `touch`, `attachSurface`, `detachSurface`, `expire`, `sweepStale`, `updateMetadata`
- `createSessionStore` factory exported from `packages/sessions/src/index.ts`
- `InMemorySessionStoreAdapter` exported (or exported as `createInMemorySessionStoreAdapter()`)
- `SessionNotFoundError`, `SessionConflictError`, `SessionStateError` exported
- All lifecycle transitions are tested including stale sweep
- `AffinityResolver` interface exported; default implementation finds most recently active session for a userId

### Open questions to resolve before coding

- OQ-1: `sweepStale()` is caller-driven in v1 (no internal timer)
- OQ-4: `AffinityResolver` is passed at call-site to `resolveSession()` utility, not at store level

---

## WF-4: Wire session store into runtime

**Package:** `core` + `sessions`
**Depends on:** WF-2, WF-3
**Produces:** `runtime.register('sessions', store)`, session resolution in capability handler context, `resolveSession()` utility integration
**PR scope:** additions to `packages/core/src/core.ts` (register/get validation), new integration test `packages/core/src/core-sessions.test.ts`

> **Cross-package note:** Sessions does not inject session middleware into core's dispatch pipeline. Products wire session lookups into capability handlers themselves using `context.runtime.get<SessionStore>('sessions')` and the `resolveSession()` utility exported by `@relay-assistant/sessions`. Core remains unaware of session semantics.

### Steps

1. Create an `AssistantRuntime` and a `SessionStore`
2. Call `runtime.register('sessions', store)` — verify `runtime.status().registeredSubsystems` includes `'sessions'`
3. In the capability handler, call `context.runtime.get<SessionStore>('sessions')` — verify it returns the store
4. Use `resolveSession(message, store, defaultAffinityResolver)` inside the handler — verify it creates a new session for a new userId (reads `message.userId`)
5. Dispatch a second message with the same userId — verify `resolveSession` returns the existing session
6. Touch the session inside the handler — verify `session.state === 'active'`
7. Verify `runtime.get('nonexistent')` throws with a clear error

### Acceptance criteria

- `runtime.register(name, subsystem)` returns `AssistantRuntime` for chaining
- `runtime.get<T>(name)` is generic; throws if name is not registered
- `resolveSession()` utility is exported from `packages/sessions/src/index.ts`
- `resolveSession` reads `message.userId` (required field per Contradiction 2 resolution) for session lookup — no manual userId extraction from `message.raw`
- Integration test does not import any surfaces package
- Session auto-create and session reuse are both tested

---

## WF-5: Register surface registry and route messages

**Package:** `core` + `surfaces`
**Depends on:** `docs/specs/v1-surfaces-spec.md` (`SPEC_RECONCILED` — Contradiction 1 resolution applied; `setInboundHandler` retired in favor of `RelayInboundAdapter.onMessage`/`offMessage` contract), WF-2 (for `InboundMessage` / `OutboundEvent` type shapes)
**Produces:** `SurfaceRegistry`, `SurfaceConnection`, `SurfaceAdapter`, `SurfaceCapabilities`, inbound normalization, outbound targeted send, connection state management
**PR scope:** `packages/surfaces/src/types.ts`, `packages/surfaces/src/surfaces.ts`, `packages/surfaces/src/surfaces.test.ts`, additions to `packages/core/src/core.ts` for adapter wiring

> **Cross-package ownership note (Contradiction 1 resolution):** Surfaces owns inbound normalization. The flow is:
> `relay foundation → surfaceRegistry.receiveRaw(surfaceId, raw) → normalization → InboundMessage → core.dispatch()`
>
> `SurfaceRegistry` implements core's `RelayInboundAdapter` interface. Normalization happens inside `SurfaceRegistry`; by the time `core.dispatch()` is called, the message is already a well-formed `InboundMessage`. Core does not normalize raw events; it receives only `InboundMessage`.
>
> Normalization must extract `userId` from the raw payload (per Contradiction 2 resolution). If the raw event does not contain a user identifier, normalization must reject the message or assign a system-generated anonymous ID.

### Steps

1. Create a surface registry: `createSurfaceRegistry()`
2. Define a `SurfaceConnection` for type `"slack"` with a mock `SurfaceAdapter` and `SurfaceCapabilities`
3. Define a `SurfaceConnection` for type `"web"` with different `SurfaceCapabilities` (e.g., markdown=true)
4. Call `surfaceRegistry.register(slackConnection)` and `surfaceRegistry.register(webConnection)`
5. Wire registry as the core relay adapter pair: `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })`
6. Simulate an inbound raw event from the slack surface via `surfaceRegistry.receiveRaw('slack-1', rawPayload)`
7. Verify normalization produces a well-formed `InboundMessage` (id, surfaceId='slack-1', userId extracted from raw, text, receivedAt, raw preserved)
8. Runtime dispatches to the capability handler; handler calls `context.runtime.emit({ surfaceId: 'slack-1', text: 'response' })`
9. Verify `surfaceRegistry.send()` is called; slack adapter receives a `SurfacePayload` with correct `formatted` content
10. Attach a `formatHook` to the slack connection — verify hook output is used instead of raw text

### Acceptance criteria

- `SurfaceRegistry` interface fully implemented with `register`, `unregister`, `get`, `list`, `send`, `fanout`
- `SurfaceConnection` type exported with `id`, `type`, `state`, `capabilities`, `adapter`, `formatHook?`
- `SurfaceAdapter` interface exported with `send`, `onConnect`, `onDisconnect`
- `SurfaceCapabilities` type exported: `markdown`, `richBlocks`, `attachments`, `streaming`, `maxResponseLength`
- `SurfacePayload` type exported: `event`, `formatted`, `surfaceCapabilities`
- `createSurfaceRegistry` factory exported from `packages/surfaces/src/index.ts`
- Inbound normalization extracts `userId` from raw payload (required per Contradiction 2 resolution); rejects or assigns anonymous ID if missing
- Inbound normalization handles missing optional fields with fallbacks for other fields (no throw)
- Outbound targeted `send()` uses format hook when present
- Connection state transitions (`registered → active → inactive`) via adapter callbacks are tested
- `SurfaceNotFoundError`, `SurfaceConflictError`, `SurfaceDeliveryError` exported

### Open questions to resolve before coding

- OQ-1: Fanout is concurrent (Promise.all-equivalent) for v1
- OQ-3: Normalization is permissive (warn + fallback) for optional fields; `userId` absence is an error (not optional per Contradiction 2 resolution)

---

## WF-6: Multi-surface session fanout

**Package:** `core` + `sessions` + `surfaces`
**Depends on:** WF-4, WF-5
**Produces:** cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout outbound rule validated in integration
**PR scope:** new integration test `packages/core/src/core-sessions-surfaces.test.ts`

> **Fanout ownership note:** The surfaces package owns fanout delivery. When `runtime.emit()` is called with a `sessionId` but without a `surfaceId`, core resolves the session's `attachedSurfaces` and calls `surfaceRegistry.fanout(event, attachedSurfaceIds, policy?)`. **Mechanism:** core uses `runtime.get('sessions')` internally to retrieve the registered `SessionStore`, then reads `session.attachedSurfaces` from the looked-up session. The `sessions` subsystem must be registered via `runtime.register('sessions', store)` before any fanout emit occurs; a missing registration will throw at emit time. Sessions owns the `attachedSurfaces` list; surfaces owns concurrent delivery and `FanoutResult` collection. Core owns the routing decision (targeted vs. fanout vs. error).

### Steps

1. Create a runtime with sessions and a surface registry (slack + web connections)
2. User sends a message via slack surface — `resolveSession()` creates a new session; `store.attachSurface(sessionId, 'slack-1')` is called
3. Same userId sends a message via web surface — `resolveSession()` returns existing session; `store.attachSurface(sessionId, 'web-1')` is called
4. Verify `session.attachedSurfaces` contains both `'slack-1'` and `'web-1'`
5. Handler emits `OutboundEvent` with `surfaceId` set to originating surface — verify only that surface's adapter receives the event (targeted send via `surfaceRegistry.send()`)
6. Handler emits `OutboundEvent` with `sessionId` but no `surfaceId` — verify `surfaceRegistry.fanout()` is called and both adapters receive the event (session fanout)
7. Handler emits `OutboundEvent` with neither `surfaceId` nor `sessionId` — verify `runtime.emit()` throws `OutboundEventError`
8. Call `store.detachSurface(sessionId, 'slack-1')` — verify fanout no longer includes slack
9. Verify `FanoutResult` reports correct `total`, `delivered`, `outcomes` fields

### Acceptance criteria

- Session correctly accumulates surface references across multiple surface interactions from the same userId
- Targeted send (`surfaceId` present) routes only to the specified adapter via `surfaceRegistry.send()`
- Fanout (`sessionId` present, no `surfaceId`) routes to all `session.attachedSurfaces` via `surfaceRegistry.fanout()`
- Invalid emit (neither `surfaceId` nor `sessionId`) throws `OutboundEventError` (per Contradiction 3 resolution)
- Detach behavior removes surface from fanout targets
- No session duplication for same userId across surfaces
- `FanoutResult` structure is correct per spec

---

## WF-7: End-to-end assembly

**Package:** `core` + `sessions` + `surfaces`
**Depends on:** WF-6
**Produces:** integration test, validated assembly pattern, updated package READMEs, v1 release tag prepared
**PR scope:** new file `packages/examples/src/v1-assembly.ts`, new test `packages/examples/src/v1-assembly.test.ts`, updated READMEs for core, sessions, surfaces


---CORE REVIEW VERDICT---
# v1 Core Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Reviewer:** Non-interactive review agent
**Artifacts reviewed:**
- `docs/specs/v1-core-spec.md`
- `docs/architecture/v1-core-implementation-plan.md`
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/index.ts`
- `packages/core/src/types.ts`
- `packages/core/src/core.ts`
- `packages/core/src/core.test.ts`
- `packages/core/README.md`

---

## 1. Spec Conformance

**Result: PASS**

### Types (`types.ts`)

All twelve interfaces and type aliases from spec §3 are present and field-accurate:

| Spec type | Present | Fields match |
|---|---|---|
| `AssistantDefinition` | ✓ | ✓ |
| `AssistantRuntime` | ✓ | ✓ |
| `CapabilityHandler` | ✓ | ✓ |
| `InboundMessage` | ✓ | ✓ (userId required, workspaceId optional per Contradiction 2) |
| `OutboundEvent` | ✓ | ✓ (surfaceId optional per Contradiction 3) |
| `CapabilityContext` | ✓ | ✓ |
| `AssistantHooks` | ✓ | ✓ |
| `RuntimeConstraints` | ✓ | ✓ |
| `RuntimeStatus` | ✓ | ✓ |
| `RelayInboundAdapter` | ✓ | ✓ |
| `RelayOutboundAdapter` | ✓ | ✓ (fanout optional) |
| `ContextLogger` | ✓ | ✓ |

### Runtime behavior (`core.ts`)

| Spec requirement | Status | Notes |
|---|---|---|
| `createAssistant` validates definition; throws `AssistantDefinitionError` | ✓ | Validates id, name, non-empty capabilities, function-typed handlers |
| Definition frozen after creation | ✓ | `freezeDefinition` does shallow freeze on definition + nested objects |
| Lifecycle state machine `created → started → stopped` | ✓ | Correctly enforced; restart after stop throws |
| `start()` idempotent | ✓ | No-op if already started |
| `stop()` idempotent | ✓ | No-op if already stopped |
| `stop()` drains in-flight handlers before `onStop` | ✓ | `waitForDrain()` with 30s timeout then `onStop` |
| `dispatch()` throws if not started | ✓ | |
| `dispatch()` calls `onMessage` hook; `false` drops message | ✓ | |
| `dispatch()` routes by `message.capability` | ✓ | |
| Missing capability calls `onError`, no throw | ✓ | |
| Handler errors call `onError` | ✓ | |
| Handler timeout calls `onError` after `handlerTimeoutMs` | ✓ | Per-invocation (OQ-4 resolved) |
| Concurrency gating with FIFO queue | ✓ | `pendingDispatches` array with `runNext()` drain loop |
| `emit()` targeted send via `surfaceId` | ✓ | |
| `emit()` session fanout via `sessionId` | ✓ | Delegates to `sessions` subsystem; supports both `get`/`getSession` shapes |
| `emit()` throws `OutboundEventError` when neither field set | ✓ | |
| `register()`/`get()` with string keys; `get` throws if missing | ✓ | OQ-2 resolved |
| `status()` returns all five required fields | ✓ | |
| `start()` calls `onStart`; `stop()` calls `onStop` | ✓ | |
| Inbound adapter wired on `start()`, unwired on `stop()` | ✓ | |

### Open question resolutions implemented

| OQ | Resolution | Implemented |
|---|---|---|
| OQ-1 | `emit()` returns `Promise<void>`, no ack | ✓ |
| OQ-2 | String keys for `register()`/`get()` | ✓ |
| OQ-3 | `onMessage` hook as pre-dispatch filter | ✓ |
| OQ-4 | `handlerTimeoutMs` per-invocation | ✓ |

### Minor structural deviation

The implementation plan specified seven source files (`types.ts`, `errors.ts`, `runtime.ts`, `logger.ts`, `index.ts`, and two test files in `__tests__/`). The implementation uses four files: `types.ts`, `core.ts` (combines errors + runtime + logger), `index.ts`, and `core.test.ts` (combines WF-1 + WF-2 tests). This is a cosmetic divergence. The combined file approach is acceptable for v1 and does not affect external contracts.

---

## 2. Package Boundaries

**Result: PASS**

- `package.json` has **zero runtime dependencies**. Only `typescript` and `vitest` as dev dependencies. ✓
- `core.ts` imports only from `./types.js` (internal). No imports from other `@relay-assistant/*` packages. ✓
- `tsconfig.json` has no path aliases or project references that would create hidden coupling. ✓
- The `SessionSubsystem` internal type in `core.ts` (lines 26–37) is a duck-typed shape that anticipates the sessions package's interface. It is **not exported**, so no external contract is formed. This is acceptable for v1. However, it represents an implicit forward-dependency on sessions conventions that should be acknowledged (see Follow-ups §5).

---

## 3. Test Coverage

**Result: PASS**

The single test file covers all 25 plan test cases from the implementation plan (§5.1 and §5.2), some combined into broader integration tests:

### WF-1 lifecycle (plan §5.1, 12 tests)

| Plan test | Covered | Test name |
|---|---|---|
| 1 — valid definition returns runtime | ✓ | `returns a runtime for a valid definition` |
| 2 — missing `id` throws | ✓ | `throws for a missing id` |
| 3 — empty capabilities throws | ✓ | `throws for empty capabilities` |
| 4 — non-function capability throws | ✓ | `throws for non-function capability values` |
| 5 — start sets `ready` and `startedAt` | ✓ | `supports start, stop, register, get, and status` |
| 6 — stop sets `ready = false` | ✓ | same |
| 7 — double start idempotent | ✓ | same |
| 8 — double stop idempotent | ✓ | same |
| 9 — register returns runtime; chaining works | ✓ | same |
| 10 — get returns registered subsystem | ✓ | same |
| 11 — get missing throws | ✓ | same |
| 12 — status includes registered capabilities | ✓ | same |

### WF-2 dispatch (plan §5.2, 13 tests)

| Plan test | Covered | Test name |
|---|---|---|
| 1 — dispatch calls correct handler | ✓ | `dispatches to the matching capability with the live runtime context` |
| 2 — handler receives live `context.runtime` | ✓ | same |
| 3 — emit → outbound adapter `send` | ✓ | same |
| 4 — emit with no routing target throws | ✓ | `throws when emit has no routing target` |
| 5 — onMessage false drops message | ✓ | `drops a message when onMessage returns false` |
| 6 — onMessage true allows message | ✓ | `allows a message when onMessage returns true` |
| 7 — unregistered capability calls onError | ✓ | `reports missing capabilities through onError without throwing` |
| 8 — handler throw calls onError | ✓ | `reports handler errors through onError` |
| 9 — dispatch on stopped runtime throws | ✓ | `throws when dispatch is called after stop` |
| 10 — inFlightHandlers increments during handler | ✓ | `tracks in-flight handlers during execution` |
| 11 — handler timeout triggers onError | ✓ | `times out handlers and reports the timeout through onError` |
| 12 — onStart hook called during start | ✓ | `supports start, stop, register, get, and status` |
| 13 — onStop hook called during stop | ✓ | same |

Two additional tests beyond the plan are present and valuable:
- `emits fanout events through the session subsystem` — validates the session fanout path
- `wires inbound adapter messages into dispatch on start` — validates the inbound adapter integration path

### Single gap

No explicit test for missing `name` (plan test 2 covers `id`; the same validation block handles `name` but it's not independently tested). Not blocking, but it's a plan item.

---

## 4. Follow-ups Before Coding Moves to Sessions

These are ordered by priority. Items 1–3 should be resolved before the sessions package begins implementation. Items 4–5 are advisory.

### 4.1 — Add test for missing `name` validation [SHOULD]

Plan §5.1 test 2 lists both `id` and `name` as required cases. Only `id` is tested. Add:

```typescript
it('throws for a missing name', () => {
  expect(() =>
    createAssistant({ id: 'assistant-1', name: '', capabilities: { reply: () => undefined } }, adapters)
  ).toThrowError(AssistantDefinitionError);
});
```

### 4.2 — Document and export the sessions subsystem contract [SHOULD]

`core.ts` contains an internal `SessionSubsystem` type (lines 26–37) that the sessions package must satisfy when registered under the `'sessions'` key. This type is not exported, leaving the sessions package author to infer the expected shape from README prose or the fanout test.

Options:
- Export `SessionSubsystem` from `types.ts` and `index.ts` as a named interface (preferred — gives the sessions package a compile-time target)
- Or document it formally in `docs/architecture/sessions-contract.md` before the sessions package is started

This prevents a coordination gap where sessions implements a different interface shape than core expects.

### 4.3 — Clarify stop-drain timeout behavior for sessions [SHOULD]

`STOP_DRAIN_TIMEOUT_MS` is hardcoded to 30 seconds in `core.ts` and is not configurable via `RuntimeConstraints`. If sessions package registers cleanup work in `onStop`, and in-flight handlers hold session locks, a 30-second drain timeout could cause `stop()` to reject — which the caller has no way to configure around. Consider:

- Exposing `stopDrainTimeoutMs` in `RuntimeConstraints`, or
- Documenting that `stop()` may reject in slow-drain scenarios so sessions package can handle it

### 4.4 — Verify `stop()` from `created` state behavior [ADVISORY]

Calling `stop()` before `start()` transitions to `stopped` without invoking `onStop` (because `wasStarted === false`). This is correct behavior but is not tested. The plan does not require this test, but it would prevent a subtle regression when sessions adds `onStop` cleanup.

### 4.5 — File structure vs. plan alignment [ADVISORY]

The implementation plan described separate `errors.ts`, `runtime.ts`, `logger.ts` files. The implementation consolidates all three into `core.ts`. If any tooling (CI steps, documentation generators, code owners) references the plan's file paths, update the plan or the tooling to reflect the actual structure. Otherwise, this has no functional impact.

---

## Summary

The v1 core implementation is **functionally complete and correct** against the spec. All required types are exported, the runtime implements the full lifecycle and dispatch pipeline, package boundaries are clean with zero runtime dependencies, and the test suite covers all 25 planned test cases plus two additional integration paths.

The follow-ups are minor and do not block tagging the package as v1-ready. Items 4.1–4.3 should be resolved before the sessions package begins implementation to avoid ambiguity in the sessions contract and runtime cleanup behavior.

**VERDICT: PASS_WITH_FOLLOWUPS**

V1_CORE_REVIEW_COMPLETE

---CORE TYPES---
export interface InboundMessage {
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

export interface OutboundEvent {
  surfaceId?: string;
  sessionId?: string;
  text: string;
  format?: unknown;
}

export interface RuntimeStatus {
  ready: boolean;
  startedAt: string | null;
  registeredSubsystems: string[];
  registeredCapabilities: string[];
  inFlightHandlers: number;
}

export interface RuntimeConstraints {
  handlerTimeoutMs?: number;
  maxConcurrentHandlers?: number;
}

export interface RelayInboundAdapter {
  onMessage(handler: (message: InboundMessage) => void): void;
  offMessage(handler: (message: InboundMessage) => void): void;
}

export interface RelayOutboundAdapter {
  send(event: OutboundEvent): Promise<void>;
  fanout?(event: OutboundEvent, attachedSurfaceIds: string[]): Promise<void>;
}

export interface ContextLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface AssistantRuntime {
  readonly definition: Readonly<AssistantDefinition>;
  emit(event: OutboundEvent): Promise<void>;
  dispatch(message: InboundMessage): Promise<void>;
  register<T>(name: string, subsystem: T): AssistantRuntime;
  get<T>(name: string): T;
  status(): RuntimeStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CapabilityContext {
  runtime: AssistantRuntime;
  log: ContextLogger;
}

export type CapabilityHandler = (
  message: InboundMessage,
  context: CapabilityContext,
) => Promise<void> | void;

export interface AssistantHooks {
  onStart?: (runtime: AssistantRuntime) => Promise<void> | void;
  onStop?: (runtime: AssistantRuntime) => Promise<void> | void;
  onMessage?: (message: InboundMessage) => boolean | Promise<boolean>;
  onError?: (error: Error, message: InboundMessage) => void;
}

export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}

---CORE RUNTIME---
import type {
  AssistantDefinition,
  AssistantRuntime,
  CapabilityContext,
  CapabilityHandler,
  ContextLogger,
  InboundMessage,
  OutboundEvent,
  RelayInboundAdapter,
  RelayOutboundAdapter,
} from './types.js';

const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT_HANDLERS = 10;
const STOP_DRAIN_TIMEOUT_MS = 30_000;

type RuntimeLifecycleState = 'created' | 'started' | 'stopped';

type QueuedDispatch = {
  message: InboundMessage;
  resolve: () => void;
  reject: (error: Error) => void;
};

type SessionRecord = {
  attachedSurfaces?: string[];
};

type SessionSubsystem =
  | {
      get(sessionId: string): SessionRecord | null | undefined | Promise<SessionRecord | null | undefined>;
    }
  | {
      getSession(
        sessionId: string,
      ): SessionRecord | null | undefined | Promise<SessionRecord | null | undefined>;
    };

export class AssistantDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantDefinitionError';
  }
}

export class OutboundEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundEventError';
  }
}

function freezeDefinition(definition: AssistantDefinition): Readonly<AssistantDefinition> {
  const frozenCapabilities = Object.freeze({ ...definition.capabilities });
  const frozenHooks = definition.hooks ? Object.freeze({ ...definition.hooks }) : undefined;
  const frozenConstraints = definition.constraints
    ? Object.freeze({ ...definition.constraints })
    : undefined;

  return Object.freeze({
    ...definition,
    capabilities: frozenCapabilities,
    hooks: frozenHooks,
    constraints: frozenConstraints,
  });
}

function createContextLogger(context: {
  messageId: string;
  capability: string;
  surfaceId: string;
}): ContextLogger {
  const baseFields = {
    messageId: context.messageId,
    capability: context.capability,
    surfaceId: context.surfaceId,
  };

  return {
    info(message, fields = {}) {
      console.info(message, { ...baseFields, ...fields });
    },
    warn(message, fields = {}) {
      console.warn(message, { ...baseFields, ...fields });
    },
    error(message, fields = {}) {
      console.error(message, { ...baseFields, ...fields });
    },
  };
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function createTimeoutError(message: InboundMessage, timeoutMs: number): Error {
  return new Error(
    `Capability '${message.capability}' timed out after ${timeoutMs}ms for message '${message.id}'`,
  );
}

function validateDefinition(definition: AssistantDefinition): void {
  if (typeof definition.id !== 'string' || definition.id.trim().length === 0) {
    throw new AssistantDefinitionError("Assistant definition requires a non-empty 'id'");
  }

  if (typeof definition.name !== 'string' || definition.name.trim().length === 0) {
    throw new AssistantDefinitionError("Assistant definition requires a non-empty 'name'");
  }

  if (
    definition.capabilities === null ||
    typeof definition.capabilities !== 'object' ||
    Array.isArray(definition.capabilities)
  ) {
    throw new AssistantDefinitionError("Assistant definition requires a capabilities object");
  }

  const entries = Object.entries(definition.capabilities);
  if (entries.length === 0) {
    throw new AssistantDefinitionError('Assistant definition requires at least one capability');
  }

  for (const [capability, handler] of entries) {
    if (typeof handler !== 'function') {
      throw new AssistantDefinitionError(
        `Capability '${capability}' must be a function handler`,
      );
    }
  }
}

async function withTimeout(
  handler: CapabilityHandler,
  message: InboundMessage,
  context: CapabilityContext,
  timeoutMs: number,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      Promise.resolve(handler(message, context)),
      new Promise<void>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createTimeoutError(message, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function resolveAttachedSurfaces(
  sessionSubsystem: SessionSubsystem,
  sessionId: string,
): Promise<string[]> {
  const session =
    'getSession' in sessionSubsystem
      ? await sessionSubsystem.getSession(sessionId)
      : await sessionSubsystem.get(sessionId);

  if (!session) {
    throw new Error(`Session '${sessionId}' could not be resolved for fanout`);
  }

  return Array.isArray(session.attachedSurfaces) ? [...session.attachedSurfaces] : [];
}

export function createAssistant(
  definition: AssistantDefinition,
  adapters: {
    inbound: RelayInboundAdapter;
    outbound: RelayOutboundAdapter;
  },
): AssistantRuntime {
  validateDefinition(definition);

  const frozenDefinition = freezeDefinition(definition);
  const capabilityMap = new Map<string, CapabilityHandler>(
    Object.entries(frozenDefinition.capabilities),
  );
  const subsystems = new Map<string, unknown>();
  const pendingDispatches: QueuedDispatch[] = [];

  let lifecycleState: RuntimeLifecycleState = 'created';
  let inFlightCount = 0;
  let startedAt: string | null = null;
  let drainWaiter: ReturnType<typeof createDeferred> | null = null;

  const constraints = {
    handlerTimeoutMs:
      frozenDefinition.constraints?.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
    maxConcurrentHandlers:
      frozenDefinition.constraints?.maxConcurrentHandlers ?? DEFAULT_MAX_CONCURRENT_HANDLERS,
  };

  const runtime: AssistantRuntime = {
    definition: frozenDefinition,

    async emit(event) {
      if (!event.surfaceId && !event.sessionId) {
        throw new OutboundEventError(
          "Outbound event requires either 'surfaceId' or 'sessionId'",
        );
      }

      if (event.surfaceId) {
        await adapters.outbound.send(event);
        return;
      }

      const sessionSubsystem = runtime.get<SessionSubsystem>('sessions');
      const surfaceIds = await resolveAttachedSurfaces(sessionSubsystem, event.sessionId as string);

      if (adapters.outbound.fanout) {
        await adapters.outbound.fanout(event, surfaceIds);
        return;
      }

      for (const surfaceId of surfaceIds) {
        await adapters.outbound.send({ ...event, surfaceId });
      }
    },

    async dispatch(message) {
      if (lifecycleState !== 'started') {
        throw new Error('Assistant runtime must be started before dispatching messages');
      }

      return new Promise<void>((resolve, reject) => {
        pendingDispatches.push({ message, resolve, reject });
        runNext();
      });
    },

    register(name, subsystem) {
      subsystems.set(name, subsystem);
      return runtime;
    },

    get(name) {
      if (!subsystems.has(name)) {
        throw new Error(`Subsystem '${name}' is not registered`);
      }

      return subsystems.get(name) as never;
    },

    status() {
      return {
        ready: lifecycleState === 'started',
        startedAt,
        registeredSubsystems: [...subsystems.keys()],
        registeredCapabilities: [...capabilityMap.keys()],
        inFlightHandlers: inFlightCount,
      };
    },

    async start() {
      if (lifecycleState === 'started') {
        return;
      }

      if (lifecycleState === 'stopped') {
        throw new Error('Assistant runtime cannot be restarted after stop()');
      }

      lifecycleState = 'started';
      startedAt = new Date().toISOString();
      adapters.inbound.onMessage(inboundHandler);
      await frozenDefinition.hooks?.onStart?.(runtime);
    },

    async stop() {
      if (lifecycleState === 'stopped') {
        return;
      }

      const wasStarted = lifecycleState === 'started';
      lifecycleState = 'stopped';

      if (wasStarted) {
        adapters.inbound.offMessage(inboundHandler);
        await waitForDrain();
        await frozenDefinition.hooks?.onStop?.(runtime);
      }
    },
  };

  const inboundHandler = (message: InboundMessage): void => {
    void runtime.dispatch(message);
  };

  function maybeResolveDrainWaiter(): void {
    if (inFlightCount === 0 && drainWaiter) {
      drainWaiter.resolve();
      drainWaiter = null;
    }
  }

  async function waitForDrain(): Promise<void> {
    if (inFlightCount === 0) {
      return;
    }

    drainWaiter ??= createDeferred();

    await Promise.race([

---EXISTING SESSIONS README---
# `@relay-assistant/sessions`

Status: placeholder package README, no implementation yet.

## Purpose

This package is intended to define assistant session continuity across surfaces and time.

Consumers should expect this package to own:

- assistant session identity
- surface attachment and reattachment rules
- affinity and resume semantics
- scoping rules across user, workspace, and object contexts

## Expected Consumer Role

A product should import this package when it needs one assistant experience across threads, devices, or channels.

Illustrative usage target:

```ts
import { createSessionStore } from "@relay-assistant/sessions";
```

## What Stays Outside

- raw transport session primitives
- webhook-specific identifiers as the only continuity model
- product-only routing rules
