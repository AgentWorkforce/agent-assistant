---SPEC PLAN---
# Spec Program Plan

Date: 2026-04-11

## Goal

Move relay-agent-assistant from docs-first scaffold to consumable SDK by end of weekend (2026-04-13).

Sage, MSD, and NightCTO should be able to `npm install` at least `@relay-assistant/core`, `@relay-assistant/sessions`, and `@relay-assistant/surfaces` by Sunday night, with type contracts stable enough to write product adapter code against.

## How Docs Become Code

The repo follows a four-stage pipeline. Every package passes through each stage in order.

### Stage 1: Doc

A README and boundary description exist. The package's purpose, ownership, and non-ownership are written down. No code.

This stage is complete for all ten packages.

### Stage 2: Spec

A canonical spec document defines the package's public API surface: exported types, factory functions, expected behavior contracts, error semantics, and integration points with adjacent packages. The spec is detailed enough that an engineer can implement against it without design questions.

A spec is not a design doc. It is an implementation reference. It answers "what does the code look like" not "why does this package exist."

### Stage 3: Workflow

A workflow document defines one narrow end-to-end slice through the package. It names the exact types, functions, and call sequences involved. Workflows are the unit of implementation work — each one produces a shippable increment.

### Stage 4: Code

TypeScript implementation, tests, and package.json. Code is written to satisfy a specific workflow, not to fill out an entire spec at once.

## Program Model

Work is organized into versions. Each version defines a cohort of packages and specs that ship together.

### v1 — Foundation (this weekend)

Packages:

| Package | Stage entering v1 | Exit criteria |
| --- | --- | --- |
| `@relay-assistant/core` | doc | spec + workflows + code |
| `@relay-assistant/sessions` | doc | spec + workflows + code |
| `@relay-assistant/surfaces` | doc | spec + workflows + code |

v1 success means: a product can define an assistant, create a session, attach surfaces, and handle inbound/outbound messages through typed contracts. No memory, no proactive, no coordination yet — just the skeleton that everything else plugs into.

### v1.1 — Memory and Connectivity (next week)

Packages:

| Package | Stage entering v1.1 | Exit criteria |
| --- | --- | --- |
| `@relay-assistant/memory` | doc | spec + workflows + code |
| `@relay-assistant/connectivity` | doc + reviewed spike | spec + workflows + code |

v1.1 success means: assistants can persist and retrieve memory across sessions, and multi-component assistants can exchange focused coordination signals.

### v1.2 — Proactive, Coordination, and Routing (follows v1.1)

Packages:

| Package | Stage entering v1.2 | Exit criteria |
| --- | --- | --- |
| `@relay-assistant/proactive` | doc | spec + workflows + code |
| `@relay-assistant/coordination` | doc | spec + workflows + code |
| `@relay-assistant/routing` | doc | spec + workflows + code |

Routing is included here rather than deferred to v2 because workforce workload-router alignment is already a design constraint for connectivity and coordination. Routing contracts must exist before those packages can make real latency/depth/cost decisions. Deferring routing to v2 would force connectivity and coordination to invent ad hoc routing assumptions that would need to be ripped out later.

v1.2 success means: assistants can act without user prompting, orchestrate multiple specialists behind one identity, and make explicit model-choice and operating-envelope decisions through typed routing contracts.

### v2 — Policy and Examples

Packages:

| Package | Stage entering v2 | Exit criteria |
| --- | --- | --- |
| `@relay-assistant/policy` | doc | spec + workflows + code |
| `@relay-assistant/examples` | doc | reference implementations |

v2 success means: the full package map is implemented and production-grade.

## v1 Spec Documents — This Weekend

The following three specs must be written and finalized before any v1 code is committed. Each spec becomes the canonical implementation reference for its package.

### Spec 1: `docs/specs/core-v1.md`

Must define:

- `createAssistant(config)` factory signature and return type
- `AssistantConfig` type: id, name, capabilities, metadata
- `Assistant` interface: lifecycle methods (start, stop, handleMessage), plugin registration (useSessions, useMemory, useProactive, useCoordinator, useConnectivity, usePolicy, attachSurface)
- `AssistantMessage` inbound/outbound envelope types
- `AssistantCapability` type and registration contract
- Runtime composition model: how packages register themselves with core
- Error types and failure modes
- What core does NOT own (memory backends, transport, domain logic)

### Spec 2: `docs/specs/sessions-v1.md`

Must define:

- `createSessionStore(config)` factory signature and return type
- `SessionStore` interface: create, get, resume, attach, detach
- `AssistantSession` type: id, assistantId, userId, workspaceId, surfaces, state, metadata, createdAt, lastActiveAt
- Session lifecycle: created → active → suspended → resumed → closed
- Surface attachment model: how multiple surfaces bind to one session
- Session scoping: user, workspace, org, object contexts
- Resume and affinity rules
- Integration contract with `@relay-assistant/core` (how sessions registers itself)

### Spec 3: `docs/specs/surfaces-v1.md`

Must define:

- `createSurfaceConnection(config)` factory signature and return type
- `SurfaceConnection` interface: send, receive, capabilities, metadata
- `SurfaceConfig` type: type (slack, web, email, etc.), capabilities, formatter
- `SurfaceCapabilities` type: threading, attachments, reactions, rich text, etc.
- Inbound normalization contract: how surface-specific events become `AssistantMessage`
- Outbound formatting contract: how assistant responses adapt to surface capabilities
- Fanout model: how the assistant decides which attached surfaces receive a response
- Integration contract with `@relay-assistant/core` and `@relay-assistant/sessions`

## v1 Workflow Backlog

Each workflow is a narrow vertical slice that produces working, testable code. Implement in order.

### WF-1: Define assistant and start runtime

Slice: `core`

Steps:
1. Call `createAssistant({ id, name, capabilities })`
2. Call `assistant.start()`
3. Verify assistant is in running state
4. Call `assistant.stop()`

Produces: `AssistantConfig`, `Assistant`, `createAssistant`, lifecycle state machine.

### WF-2: Handle inbound message

Slice: `core`

Steps:
1. Create and start assistant
2. Call `assistant.handleMessage(inboundMessage)`
3. Assistant invokes registered message handler
4. Handler returns outbound response
5. Verify response envelope is well-formed

Produces: `AssistantMessage` types, message handler registration, inbound/outbound flow.

### WF-3: Create and manage sessions

Slice: `sessions`

Steps:
1. Create session store
2. Call `sessions.create({ userId, workspaceId })`
3. Verify session has id, state=active, timestamps
4. Call `sessions.get(sessionId)` — returns session
5. Call `sessions.suspend(sessionId)` — state changes
6. Call `sessions.resume(sessionId)` — state changes

Produces: `SessionStore`, `AssistantSession`, lifecycle transitions.

### WF-4: Wire sessions into assistant

Slice: `core` + `sessions`

Steps:
1. Create assistant and session store
2. Call `assistant.useSessions(sessions)`
3. Send inbound message with userId and surfaceId
4. Assistant auto-creates or resumes session
5. Session is accessible in message handler context

Produces: core-sessions integration, session-aware message handling.

### WF-5: Attach surface and route messages

Slice: `surfaces`

Steps:
1. Create surface connection for type "slack"
2. Create surface connection for type "web"
3. Attach both to assistant
4. Receive inbound message from slack surface
5. Assistant processes and returns response
6. Response is formatted per surface capabilities
7. Response is delivered to originating surface

Produces: `SurfaceConnection`, `SurfaceConfig`, `SurfaceCapabilities`, inbound normalization, outbound formatting.

### WF-6: Multi-surface session

Slice: `core` + `sessions` + `surfaces`

Steps:
1. Create assistant with sessions and two surfaces
2. User sends message via slack surface — session created
3. Same user sends message via web surface — same session resumed
4. Verify both surface interactions share session state
5. Assistant response targets correct surface

Produces: cross-surface session attachment, surface-to-session binding.

### WF-7: End-to-end assembly

Slice: `core` + `sessions` + `surfaces`

Steps:
1. Full assembly matching the skeletal example from how-to-build-an-assistant.md
2. Define assistant with id, name, capabilities
3. Wire sessions, attach surfaces
4. Process a full inbound → session → handler → response → surface cycle
5. Verify the complete flow works with only v1 packages

Produces: integration test, validated assembly pattern, consumer-ready v1.

## Implementation Constraints

### Weekend budget

Three specs, seven workflows. The specs must be written first (Saturday morning). Workflows WF-1 through WF-5 are the minimum shippable v1. WF-6 and WF-7 are stretch goals that validate integration.

### Package structure

Each v1 package ships as:

```
packages/<name>/
  package.json
  tsconfig.json
  src/
    index.ts        # public exports
    types.ts        # all exported types
    <name>.ts       # factory and implementation
    <name>.test.ts  # tests per workflow
  README.md         # updated from placeholder
```

### TypeScript-first

All contracts are TypeScript interfaces and types. No runtime framework dependencies in v1. Pure types and in-memory implementations.

### Test-per-workflow

Each workflow produces at least one test file. Tests are the proof that the workflow is complete.

### No cloud assumptions

v1 packages must work without any hosted service. In-memory stores, local state, no network calls.


---CORE SPEC---
# v1 Core Spec — `@relay-assistant/core`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/core`
**Version target:** v0.1.0 (pre-1.0, provisional)

---

## 1. Responsibilities

`@relay-assistant/core` is the root composition layer. Every other package in this SDK depends on contracts exported from core; core depends on nothing else in this monorepo.

**Owns:**
- `AssistantDefinition` — the declarative config struct describing an assistant's identity, capabilities, and runtime constraints
- `AssistantRuntime` — the live object returned by `createAssistant()`; holds registered subsystems and drives the main event loop
- Capability registration — typed registry mapping capability names to handler functions
- Lifecycle hooks — `onStart`, `onStop`, `onMessage`, `onError` (synchronous signatures; async adapters are the caller's responsibility)
- Inbound message normalization — converts raw relay-layer events into the canonical `InboundMessage` type before routing to handlers
- Health/readiness probe — `runtime.status()` returns a structured object suitable for a health endpoint

**Does NOT own:**
- Session state (→ `@relay-assistant/sessions`)
- Surface I/O (→ `@relay-assistant/surfaces`)
- Memory retrieval or storage (→ `@relay-assistant/memory`)
- Model selection or routing (→ `@relay-assistant/routing`)
- Multi-agent coordination (→ `@relay-assistant/coordination`)
- Any transport protocol, HTTP server, or relay socket management (→ relay foundation layer)

---

## 2. Non-Goals

- Core does not start a web server, open sockets, or manage relay connections. Those belong to the relay foundation beneath this SDK.
- Core does not implement retry logic, queue management, or delivery guarantees. Those are relay-layer concerns.
- Core is not an orchestrator. It registers capabilities and dispatches events; it does not sequence multi-step workflows.
- Core does not enforce action policy (→ `@relay-assistant/policy`).
- Core does not know about cloud infrastructure. All interfaces must be implementable by a self-hosted consumer without any private service.

---

## 3. Interfaces and Contracts

### 3.1 `AssistantDefinition`

```typescript
export interface AssistantDefinition {
  /** Unique identifier for this assistant. Stable across restarts. */
  id: string;

  /** Human-readable display name. Used in surface headers and logs. */
  name: string;

  /**
   * Optional description. Surfaced in admin UIs and capability registries.
   * Not used at runtime.
   */
  description?: string;

  /**
   * Named capability handlers. Keys are capability names; values are handler
   * functions. Core dispatches inbound messages to handlers by capability name.
   */
  capabilities: Record<string, CapabilityHandler>;

  /**
   * Lifecycle hooks. All optional. Called synchronously (handlers may return
   * promises, but core does not await them unless noted).
   */
  hooks?: AssistantHooks;

  /**
   * Runtime constraints. Used by routing and scheduling layers; core
   * validates structure but does not enforce values.
   */
  constraints?: RuntimeConstraints;
}
```

### 3.2 `CapabilityHandler`

```typescript
export type CapabilityHandler = (
  message: InboundMessage,
  context: CapabilityContext,
) => Promise<void> | void;
```

### 3.3 `InboundMessage`

```typescript
export interface InboundMessage {
  /** Relay-assigned message ID. Globally unique. */
  id: string;

  /** Surface this message arrived on. Opaque string; not parsed by core. */
  surfaceId: string;

  /** Session this message belongs to. May be undefined for sessionless surfaces. */
  sessionId?: string;

  /** Normalized text body. Core does not parse further. */
  text: string;

  /**
   * Original relay payload. Core preserves this verbatim so capability
   * handlers can access surface-specific fields without core needing to
   * understand them.
   */
  raw: unknown;

  /** ISO-8601 timestamp of message receipt at the relay layer. */
  receivedAt: string;

  /** Name of the capability this message was dispatched to. Set by core. */
  capability: string;
}
```

### 3.4 `CapabilityContext`

```typescript
export interface CapabilityContext {
  /** The live AssistantRuntime. Handlers may call runtime.emit() to send responses. */
  runtime: AssistantRuntime;

  /**
   * Logger bound to this invocation. Structured; always includes messageId,
   * capability, and surfaceId.
   */
  log: ContextLogger;
}
```

### 3.5 `AssistantHooks`

```typescript
export interface AssistantHooks {
  /** Called once after createAssistant() completes subsystem registration. */
  onStart?: (runtime: AssistantRuntime) => Promise<void> | void;

  /** Called once when runtime.stop() is invoked. */
  onStop?: (runtime: AssistantRuntime) => Promise<void> | void;

  /**
   * Called before dispatching any inbound message to a capability handler.
   * Return false to drop the message without processing.
   */
  onMessage?: (message: InboundMessage) => boolean | Promise<boolean>;

  /** Called when a capability handler throws. */
  onError?: (error: Error, message: InboundMessage) => void;
}
```

### 3.6 `RuntimeConstraints`

```typescript
export interface RuntimeConstraints {
  /**
   * Maximum time (ms) core will wait for a capability handler to resolve.
   * Defaults to 30000. Core emits a timeout error and calls onError if exceeded.
   */
  handlerTimeoutMs?: number;

  /**
   * Maximum concurrent capability invocations. Defaults to 10.
   * Core queues messages beyond this limit; does not drop them.
   */
  maxConcurrentHandlers?: number;
}
```

### 3.7 `AssistantRuntime`

```typescript
export interface AssistantRuntime {
  /** The definition this runtime was created from. Frozen after creation. */
  readonly definition: Readonly<AssistantDefinition>;

  /**
   * Emit an outbound event. Core passes this to registered surface adapters;
   * the relay layer handles actual delivery.
   */
  emit(event: OutboundEvent): Promise<void>;

  /**
   * Dispatch a message directly (bypasses relay; useful for testing).
   * Runs the full dispatch pipeline including hooks.
   */
  dispatch(message: InboundMessage): Promise<void>;

  /**
   * Register a subsystem at runtime. Called by other packages during their
   * initialization. Returns the runtime for chaining.
   */
  register<T>(name: string, subsystem: T): AssistantRuntime;

  /**
   * Retrieve a registered subsystem. Throws if not found.
   */
  get<T>(name: string): T;

  /**
   * Structured health/readiness object. Suitable for a GET /health endpoint.
   */
  status(): RuntimeStatus;

  /** Begin processing. Resolves after onStart hooks complete. */
  start(): Promise<void>;

  /** Drain in-flight handlers then call onStop hooks. */
  stop(): Promise<void>;
}
```

### 3.8 `OutboundEvent`

```typescript
export interface OutboundEvent {
  /** Surface to deliver to. Must match a registered surface adapter. */
  surfaceId: string;

  /** Session context. Optional; surfaces may not require sessions. */
  sessionId?: string;

  /** Normalized text response. */
  text: string;

  /**
   * Surface-specific formatting hints. Core passes verbatim to the surface
   * adapter; does not interpret.
   */
  format?: unknown;
}
```

### 3.9 `RuntimeStatus`

```typescript
export interface RuntimeStatus {
  ready: boolean;
  startedAt: string | null;
  registeredSubsystems: string[];
  registeredCapabilities: string[];
  inFlightHandlers: number;
}
```

---

## 4. Package Boundaries

### Depends on (external)
- Standard TypeScript runtime; no framework dependencies.
- Node.js `EventEmitter` (or equivalent) for internal event bus. No external event library.

### Depends on (internal)
- Nothing from this monorepo. Core is the dependency root.

### Depended on by (internal)
- All other `@relay-assistant/*` packages import types from core.

### Relay foundation boundary
- Core calls into the relay foundation through **adapters**, not directly. Two adapter interfaces are defined in core:

```typescript
/** Injected by the relay foundation to push inbound events into core. */
export interface RelayInboundAdapter {
  onMessage(handler: (raw: unknown) => void): void;
  offMessage(handler: (raw: unknown) => void): void;
}

/** Injected by the relay foundation to deliver outbound events. */
export interface RelayOutboundAdapter {
  send(event: OutboundEvent): Promise<void>;
}
```

The relay foundation implements these interfaces. Core never imports relay packages.

---

## 5. Dependency Rules

| Direction | Rule |
|---|---|
| Other packages → core | Allowed. Import types and factory functions only. |
| Core → other packages | Forbidden. Core has no runtime imports from this monorepo. |
| Core → relay foundation | Through adapter interfaces only. Core never imports relay packages. |
| Cloud layer → core | Allowed. Cloud layer may wrap or extend, but core must remain functional without it. |

---

## 6. `createAssistant` Factory

```typescript
export function createAssistant(
  definition: AssistantDefinition,
  adapters: {
    inbound: RelayInboundAdapter;
    outbound: RelayOutboundAdapter;
  },
): AssistantRuntime;
```

- Validates `definition` structure; throws `AssistantDefinitionError` on invalid input.
- Builds the internal capability dispatch table.
- Wires relay adapters to the internal event loop.
- Does **not** call `onStart` or begin processing; caller must call `runtime.start()`.

---

## 7. OSS vs Cloud Boundary

All types and factory functions in this spec are OSS. Nothing in core requires a hosted service.

The relay foundation layer (inbound/outbound adapters) may be implemented in OSS or cloud variants; core does not know which.

Cloud-only behavior (e.g., managed relay connections, centralized health dashboards) is implemented in a separate package that wraps core, never by modifying core.

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
created ──► active ──► suspended ──► active   (resume)
                    └──► expired               (TTL exceeded while suspended, or explicit expiry)

active ──► expired                             (explicit expiry while active)
```

| State | Meaning |
|---|---|
| `created` | Initialized but no message processed yet. |
| `active` | At least one message processed; within activity TTL. |
| `suspended` | No activity within TTL; may be resumed. Memory is preserved. |
| `expired` | Permanently closed. Memory may be archived per policy. |

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


---SURFACES SPEC---
# v1 Surfaces Spec — `@relay-assistant/surfaces`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/surfaces`
**Version target:** v0.1.0 (pre-1.0, provisional)

---

## 1. Responsibilities

`@relay-assistant/surfaces` manages the connections between the assistant runtime and user-facing interaction mediums. A surface is any channel through which a user sends messages to or receives messages from the assistant (web chat, Slack, desktop, API, etc.).

**Owns:**
- `SurfaceConnection` — registered connection to one surface; carries inbound and outbound contracts
- `SurfaceRegistry` — tracks all registered surface connections; routes outbound events to the correct adapter
- Inbound normalization — converts surface-specific raw payloads into `InboundMessage` before handing to core
- Outbound dispatch — converts `OutboundEvent` from core into surface-specific format via format hooks
- Fanout — when a session has multiple attached surfaces, deliver an outbound event to all of them (with configurable policy)
- Format hooks — product-supplied functions that transform text + metadata into surface-specific structures (Slack block kit, markdown, plain text, etc.)
- Surface capability advertising — surfaces may declare what formatting capabilities they support; format hooks receive this as context

**Does NOT own:**
- The underlying transport protocol (HTTP, WebSocket, Slack Events API). That is the relay foundation.
- Session attachment decisions (→ `@relay-assistant/sessions`)
- Routing decisions about which model to call (→ `@relay-assistant/routing`)
- Memory (→ `@relay-assistant/memory`)
- Delivery guarantees or retry logic (→ relay foundation)

---

## 2. Non-Goals

- Surfaces does not implement Slack, Teams, or any specific surface protocol. It defines the adapter interface; product code or a platform package provides the implementation.
- Surfaces does not manage authentication or access control for surface connections. That is the relay foundation's responsibility.
- Surfaces does not buffer or queue messages for offline surfaces. If a surface adapter's send fails, the error propagates to the caller.
- Surfaces does not know about conversation history. It handles one outbound event at a time.
- Surfaces is not a notification system. Proactive delivery is driven by `@relay-assistant/proactive`; surfaces handles the actual send once triggered.

---

## 3. Surface Lifecycle

```
registered → active → inactive → active  (reconnect)
          └──────────────────── removed
```

| State | Meaning |
|---|---|
| `registered` | Surface connection is registered with the registry. Adapter may not yet be connected. |
| `active` | Adapter reports it is connected and can send/receive. |
| `inactive` | Adapter has disconnected. Registry retains the connection record; messages directed here are dropped or queued per fanout policy. |

State transitions are driven by the adapter via callbacks; the registry does not poll.

---

## 4. Interfaces and Contracts

### 4.1 `SurfaceConnection`

```typescript
export interface SurfaceConnection {
  /** Stable ID matching the surfaceId in InboundMessage and Session.attachedSurfaces. */
  id: string;

  /** Human-readable surface type. Used in logs and admin UIs. */
  type: SurfaceType;

  /** Current connection state. Updated by adapter callbacks. */
  state: SurfaceState;

  /**
   * Declared formatting capabilities. Format hooks receive this to
   * tailor output (e.g., whether markdown is supported).
   */
  capabilities: SurfaceCapabilities;

  /**
   * The adapter implementation. Injected at registration time.
   * Registry calls adapter.send() to deliver outbound events.
   */
  adapter: SurfaceAdapter;

  /**
   * Optional format hook. If provided, called before adapter.send() to
   * transform the OutboundEvent into a surface-specific payload.
   * If not provided, adapter receives the OutboundEvent unchanged.
   */
  formatHook?: SurfaceFormatHook;
}

export type SurfaceType = 'web' | 'slack' | 'desktop' | 'api' | string;
export type SurfaceState = 'registered' | 'active' | 'inactive';
```

### 4.2 `SurfaceCapabilities`

```typescript
export interface SurfaceCapabilities {
  /** Surface renders markdown. */
  markdown: boolean;

  /** Surface renders structured blocks (e.g., Slack block kit). */
  richBlocks: boolean;

  /** Surface supports file attachments. */
  attachments: boolean;

  /** Surface supports streaming partial responses. */
  streaming: boolean;

  /**
   * Maximum response length in characters. 0 = no limit.
   * Format hooks should not produce output exceeding this.
   */
  maxResponseLength: number;
}
```

### 4.3 `SurfaceAdapter`

```typescript
/**
 * Interface implemented by the surface-specific transport integration.
 * The relay foundation or product code provides this implementation.
 * Surfaces package never imports a specific transport library.
 */
export interface SurfaceAdapter {
  /**
   * Send a formatted payload to the surface.
   * Throws SurfaceDeliveryError if delivery fails.
   */
  send(payload: SurfacePayload): Promise<void>;

  /**
   * Register a callback to be invoked when the connection becomes active.
   * Called once immediately if already active.
   */
  onConnect(callback: () => void): void;

  /**
   * Register a callback to be invoked when the connection becomes inactive.
   */
  onDisconnect(callback: () => void): void;
}
```

### 4.4 `SurfacePayload`

```typescript
/**
 * The normalized payload passed to SurfaceAdapter.send().
 * Contains both the original OutboundEvent and the formatted output.
 */
export interface SurfacePayload {
  /** Source OutboundEvent from core. */
  event: OutboundEvent;

  /**
   * Formatted content. Plain string if no formatHook; surface-specific
   * structure if formatHook was applied.
   */
  formatted: unknown;

  /** The surface's declared capabilities at send time. */
  surfaceCapabilities: SurfaceCapabilities;
}
```

### 4.5 `SurfaceFormatHook`

```typescript
/**
 * Transforms an OutboundEvent into surface-specific formatted content.
 * Products provide these; surfaces package defines the contract.
 */
export type SurfaceFormatHook = (
  event: OutboundEvent,
  capabilities: SurfaceCapabilities,
) => Promise<unknown> | unknown;
```

### 4.6 `SurfaceRegistry`

```typescript
export interface SurfaceRegistry {
  /**
   * Register a surface connection. Throws SurfaceConflictError if a
   * connection with this id is already registered.
   */
  register(connection: SurfaceConnection): void;

  /**
   * Remove a surface connection. Idempotent.
   */
  unregister(surfaceId: string): void;

  /**
   * Retrieve a registered surface connection. Returns null if not found.
   */
  get(surfaceId: string): SurfaceConnection | null;

  /**
   * List all registered surfaces, optionally filtered by state.
   */
  list(filter?: { state?: SurfaceState; type?: SurfaceType }): SurfaceConnection[];

  /**
   * Deliver an OutboundEvent to one specific surface.
   * Throws SurfaceNotFoundError if the surfaceId is not registered.
   * Throws SurfaceDeliveryError if the adapter fails.
   */
  send(event: OutboundEvent): Promise<void>;

  /**
   * Fanout an OutboundEvent to all surfaces attached to a session.
   * Reads attached surfaces from the provided session object.
   * Returns a FanoutResult describing per-surface delivery outcomes.
   */
  fanout(event: OutboundEvent, attachedSurfaceIds: string[], policy?: FanoutPolicy): Promise<FanoutResult>;
}
```

### 4.7 `FanoutPolicy`

```typescript
export interface FanoutPolicy {
  /**
   * What to do when one surface fails during fanout.
   * - 'continue': attempt all surfaces; collect errors; return FanoutResult.
   * - 'abort': throw on first error; remaining surfaces are not attempted.
   * Defaults to 'continue'.
   */
  onError?: 'continue' | 'abort';

  /**
   * Whether to skip inactive surfaces silently.
   * When false, inactive surfaces produce a FanoutOutcome with status='skipped'.
   * Defaults to true.
   */
  skipInactive?: boolean;
}
```

### 4.8 `FanoutResult`

```typescript
export interface FanoutResult {
  /** Total number of surfaces targeted. */
  total: number;

  /** Number of surfaces that received the event successfully. */
  delivered: number;

  /** Per-surface outcome. */
  outcomes: FanoutOutcome[];
}

export interface FanoutOutcome {
  surfaceId: string;
  status: 'delivered' | 'skipped' | 'failed';
  error?: Error;
}
```

### 4.9 `RelayInboundSurfaceAdapter`

```typescript
/**
 * How the relay foundation pushes raw inbound events into the surfaces
 * package for normalization before forwarding to core.
 *
 * Products wire this during initialization:
 *   relayFoundation.onRawMessage((surfaceId, raw) => {
 *     surfaceRegistry.receiveRaw(surfaceId, raw);
 *   });
 */
export interface RelayInboundSurfaceAdapter {
  /**
   * Called by the relay foundation when a raw message arrives.
   * Surfaces package normalizes it and calls the registered inboundHandler.
   */
  receiveRaw(surfaceId: string, raw: unknown): void;

  /**
   * Register the handler to call after normalization. Typically this is
   * core's RelayInboundAdapter.onMessage callback.
   */
  setInboundHandler(handler: (message: InboundMessage) => void): void;
}
```

### 4.10 Normalization

Inbound normalization extracts these fields from a raw relay event:

| Target field | Source | Fallback |
|---|---|---|
| `id` | `raw.messageId` or `raw.id` | Generated UUID |
| `surfaceId` | Provided by relay (first arg to `receiveRaw`) | Error if missing |
| `sessionId` | `raw.sessionId` or `raw.session?.id` | undefined |
| `text` | `raw.text` or `raw.content` or `raw.body` | Empty string; logs warning |
| `receivedAt` | `raw.timestamp` or `raw.receivedAt` | `new Date().toISOString()` |
| `raw` | Verbatim | Required |

Normalization does not fail on missing optional fields; it logs warnings and uses fallbacks.

### 4.11 Error types

```typescript
export class SurfaceNotFoundError extends Error {
  constructor(public readonly surfaceId: string) {
    super(`Surface not found: ${surfaceId}`);
  }
}

export class SurfaceConflictError extends Error {
  constructor(public readonly surfaceId: string) {

---MEMORY SPEC---
# v1 Memory Spec — `@relay-assistant/memory`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/memory`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.1 (after core, sessions, surfaces land)

---

## 1. Responsibilities

`@relay-assistant/memory` provides scoped, retrievable, promotable memory across assistant sessions. Memory is not conversation history; it is durable context that survives session boundaries and informs future interactions.

**Owns:**
- `MemoryEntry` — unit of stored context, always associated with a scope
- `MemoryStore` — retrieval, write, and deletion interface; storage backend is injected
- Memory scopes — user, session, workspace, org, object (defined below)
- Retrieval — structured queries by scope, tags, and recency
- Promotion — moving an entry from a narrower scope to a broader one (e.g., session → user)
- Compaction — merging or summarizing multiple entries into fewer, denser entries
- TTL / expiry — entries may declare an expiry; expired entries are excluded from retrieval
- Tagging — arbitrary string tags on entries; used to narrow retrieval queries

**Does NOT own:**
- The strategy for deciding what to write to memory (that is the capability handler's concern)
- The model call that generates compacted summaries (compaction requires a callback; memory does not call a model directly)
- Session lifecycle (→ `@relay-assistant/sessions`)
- Surface delivery (→ `@relay-assistant/surfaces`)
- Routing (→ `@relay-assistant/routing`)
- Policy enforcement on what may be stored (→ `@relay-assistant/policy`)

---

## 2. Non-Goals

- Memory is not a vector store. Retrieval in v1 is structured (scope + tags + recency). Semantic/embedding search is a future concern and will require a separate adapter interface.
- Memory does not implement the compaction LLM call. It provides a `CompactionCallback` interface; the caller provides the model invocation.
- Memory does not sync across distributed instances. Consistency is the storage adapter's responsibility.
- Memory does not own the decision of what to archive when a session expires. It provides a query + bulk-delete interface; the sessions or policy layer drives the archival workflow.
- Memory does not encrypt at rest. Encryption is the storage adapter's responsibility.

---

## 3. Memory Scopes

Scopes are hierarchical. Queries at a broader scope may optionally include entries from narrower scopes (configurable; defaults shown).

| Scope | Key | Description | Default query includes narrower? |
|---|---|---|---|
| `session` | sessionId | Lives for the duration of a session. Narrowest scope. | n/a |
| `user` | userId | Persists across sessions for one user. | Includes session (when sessionId provided) |
| `workspace` | workspaceId | Shared across users in a workspace. | Does not include user by default |
| `org` | orgId | Shared across workspaces in an org. | Does not include workspace by default |
| `object` | objectId + objectType | Attached to a specific domain object (e.g., a ticket, a document). | Independent scope |

Scope keys are opaque strings. Memory does not validate that they correspond to real entities.

A single entry belongs to exactly one scope. Promotion creates a new entry at the broader scope; the original is not deleted unless the caller requests it.

---

## 4. Interfaces and Contracts

### 4.1 `MemoryEntry`

```typescript
export interface MemoryEntry {
  /** Globally unique ID. Assigned by the store on write. */
  id: string;

  /** Scope this entry belongs to. */
  scope: MemoryScope;

  /** Content. Plain text in v1; structured content is a future extension. */
  content: string;

  /**
   * Arbitrary string tags. Used to narrow retrieval (e.g., 'preference',
   * 'fact', 'instruction', 'context').
   */
  tags: string[];

  /** ISO-8601 creation timestamp. */
  createdAt: string;

  /** ISO-8601 last-updated timestamp. */
  updatedAt: string;

  /**
   * ISO-8601 expiry timestamp. If set, store excludes this entry from
   * retrieval after this time. Store does not delete automatically.
   */
  expiresAt?: string;

  /**
   * If this entry was promoted from another entry, the source entry's ID.
   * Preserved for audit; does not affect retrieval.
   */
  promotedFromId?: string;

  /**
   * If this entry was produced by compaction, the IDs of source entries.
   * Preserved for audit.
   */
  compactedFromIds?: string[];

  /** Arbitrary key-value metadata for product extensions. */
  metadata: Record<string, unknown>;
}
```

### 4.2 `MemoryScope`

```typescript
export type MemoryScope =
  | { kind: 'session'; sessionId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'org'; orgId: string }
  | { kind: 'object'; objectId: string; objectType: string };
```

### 4.3 `MemoryStore`

```typescript
export interface MemoryStore {
  /**
   * Write a new memory entry. Returns the stored entry with assigned id
   * and timestamps.
   */
  write(input: WriteMemoryInput): Promise<MemoryEntry>;

  /**
   * Retrieve entries matching the query. Excludes expired entries.
   */
  retrieve(query: MemoryQuery): Promise<MemoryEntry[]>;

  /**
   * Retrieve a single entry by ID. Returns null if not found or expired.
   */
  get(entryId: string): Promise<MemoryEntry | null>;

  /**
   * Update the content and/or tags of an existing entry. Other fields
   * (scope, promotedFromId) are immutable after creation.
   */
  update(entryId: string, patch: UpdateMemoryPatch): Promise<MemoryEntry>;

  /**
   * Delete an entry by ID. Idempotent.
   */
  delete(entryId: string): Promise<void>;

  /**
   * Delete all entries matching the scope. Used during session expiry or
   * workspace teardown. Returns count of deleted entries.
   */
  deleteByScope(scope: MemoryScope): Promise<number>;

  /**
   * Promote an entry to a broader scope. Creates a new entry at the target
   * scope with promotedFromId set. Original entry is not deleted unless
   * deleteOriginal is true.
   */
  promote(input: PromoteMemoryInput): Promise<MemoryEntry>;

  /**
   * Compact multiple entries into one. Calls the provided callback to
   * generate the compacted content; writes the result at the target scope.
   * Source entries are not deleted unless deleteSourceEntries is true.
   */
  compact(input: CompactMemoryInput): Promise<MemoryEntry>;
}
```

### 4.4 `WriteMemoryInput`

```typescript
export interface WriteMemoryInput {
  scope: MemoryScope;
  content: string;
  tags?: string[];
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}
```

### 4.5 `MemoryQuery`

```typescript
export interface MemoryQuery {
  /** Primary scope to query. Required. */
  scope: MemoryScope;

  /**
   * When true, include entries from narrower scopes according to default
   * inclusion rules. E.g., querying user scope with sessionId provided
   * will also include session-scope entries. Defaults to false.
   */
  includeNarrower?: boolean;

  /** Filter to entries that have ALL of the specified tags. */
  tags?: string[];

  /** Return entries created/updated after this ISO-8601 timestamp. */
  since?: string;

  /** Maximum entries to return. Defaults to 20. */
  limit?: number;

  /** Sort order. Defaults to 'newest'. */
  order?: 'newest' | 'oldest';
}
```

### 4.6 `UpdateMemoryPatch`

```typescript
export interface UpdateMemoryPatch {
  content?: string;
  tags?: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}
```

### 4.7 `PromoteMemoryInput`

```typescript
export interface PromoteMemoryInput {
  sourceEntryId: string;
  targetScope: MemoryScope;
  /** If true, delete the source entry after promotion. Defaults to false. */
  deleteOriginal?: boolean;
  /** Override content in the promoted entry. Defaults to source content. */
  content?: string;
  /** Override tags. Defaults to source tags. */
  tags?: string[];
}
```

### 4.8 `CompactMemoryInput`

```typescript
export interface CompactMemoryInput {
  /** IDs of entries to compact. Must be non-empty. */
  sourceEntryIds: string[];

  /** Scope of the resulting compacted entry. */
  targetScope: MemoryScope;

  /**
   * Callback that receives the source entries and returns compacted content.
   * Memory does not call a model; the caller provides this function.
   */
  compactionCallback: CompactionCallback;

  /** If true, delete source entries after compaction. Defaults to false. */
  deleteSourceEntries?: boolean;

---CONNECTIVITY SPEC---
# v1 Connectivity Spec — `@relay-assistant/connectivity`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/connectivity`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.1 (after core, sessions, surfaces land)

---

## 1. Responsibilities

`@relay-assistant/connectivity` provides focused coordination signals for internal multi-agent communication. It is not a generic chat bus or message queue; it is a typed, routing-aware signaling layer that enables specialists to communicate state, confidence, conflicts, and handoffs to coordinators without verbose transcript exchange.

**Owns:**
- `ConnectivitySignal` — the canonical signal envelope (typed; covers five message classes)
- Signal emission — sending a signal to the appropriate audience
- Signal state machine — tracking signal lifecycle (emitted → active → superseded/expired/resolved)
- Suppression window — debouncing redundant signals within a step or time window
- Audience resolution — translating `self`, `coordinator`, `selected`, `all` to actual recipient identifiers
- Routing integration — escalation signals trigger mode changes in `@relay-assistant/routing`
- Signal log — ordered, queryable log of signals emitted in a thread; used for synthesis and debugging

**Does NOT own:**
- Model invocations or reasoning (→ capability handlers in product code)
- Message routing decisions (→ `@relay-assistant/routing`; receives escalation requests from connectivity)
- Coordinator/specialist orchestration (→ `@relay-assistant/coordination`; calls connectivity, not vice versa)
- Session or surface management
- Transport or delivery (signals are in-process in v1; distribution across processes is a future concern)

---

## 2. Non-Goals

- Connectivity is not a pub/sub system. It does not have topics, subscriptions, or fan-out to arbitrary consumers. Signal audiences are constrained to predefined semantic roles.
- Connectivity does not replace human-readable messages in surface delivery. Signals are internal; users never see them directly.
- Connectivity does not implement the routing algorithm. It emits an escalation signal with a requested mode; routing acts on it.
- Connectivity does not guarantee delivery ordering across distributed processes in v1. In-process ordering (within a single Node process) is guaranteed by the event loop.
- Connectivity does not store signals beyond the current thread's lifetime in v1. Persistence is a v1.2 concern.

---

## 3. Signal Lifecycle

```
emitted ──► active ──► superseded   (a newer signal replaces this one)
                   └──► expired      (expiresAtStep reached or TTL elapsed)
                   └──► resolved     (explicitly resolved by emitter or coordinator)
```

| State | Meaning |
|---|---|
| `emitted` | Signal created; not yet processed by any recipient. |
| `active` | At least one recipient has acknowledged or acted on it. |
| `superseded` | A newer signal with `replaces` pointing to this signal's ID has been emitted. |
| `expired` | The `expiresAtStep` has passed or the TTL window has closed. |
| `resolved` | The signaled condition is no longer relevant; explicitly closed. |

The signal log retains all signals regardless of state. State is updated in place.

---

## 4. Message Classes

| Class | Purpose | Typical audience |
|---|---|---|
| `attention` | Something another component should consider. Not urgent. | `coordinator`, `selected` |
| `confidence` | Stability grade of this specialist's current output. | `coordinator` |
| `conflict` | Two active views disagree in a way that affects the final answer. | `coordinator` |
| `handoff` | Downstream component can proceed; this specialist is done with its step. | `selected`, `coordinator` |
| `escalation` | Current path should change immediately; high urgency. | `coordinator`, `all` |

---

## 5. Signal Classes (within message class)

Signal class narrows the message class to a specific semantic:

| Signal class | Message class | Meaning |
|---|---|---|
| `attention.raise` | attention | Flagging something for another's consideration |
| `confidence.high` | confidence | Output is stable and well-supported |
| `confidence.medium` | confidence | Output is reasonable but has caveats |
| `confidence.low` | confidence | Output is speculative; coordinator should weigh carefully |
| `confidence.blocker` | confidence | Cannot produce useful output without more input |
| `conflict.active` | conflict | Conflict currently exists and is unresolved |
| `conflict.resolved` | conflict | Previously flagged conflict has been resolved |
| `handoff.ready` | handoff | Specialist's output is ready for downstream consumption |
| `handoff.partial` | handoff | Partial output available; more coming |
| `escalation.interrupt` | escalation | Immediate path change required |
| `escalation.uncertainty` | escalation | High uncertainty; requesting routing mode change |

---

## 6. Interfaces and Contracts

### 6.1 `ConnectivitySignal`

```typescript
export interface ConnectivitySignal {
  /** Globally unique ID within the thread. Assigned by the layer on emit. */
  id: string;

  /** Thread (session or coordination context) this signal belongs to. */
  threadId: string;

  /** Identifier of the component emitting this signal. */
  source: string;

  /** Semantic audience. Resolved to recipient IDs by the audience resolver. */
  audience: SignalAudience;

  /** Broad category of this signal. */
  messageClass: MessageClass;

  /** Narrow semantic within the message class. */
  signalClass: SignalClass;

  /**
   * Routing priority. Used by routing layer to adjust urgency.
   * - 'low': informational; does not interrupt current routing mode
   * - 'normal': advisory; may influence next routing decision
   * - 'high': may trigger immediate routing mode change
   * - 'critical': must trigger routing escalation
   */
  priority: SignalPriority;

  /**
   * Confidence level of the emitting specialist, 0.0–1.0.
   * Required for confidence and conflict signals; optional for others.
   */
  confidence?: number;

  /**
   * One-sentence summary. Required. Used by suppression deduplication and
   * signal log display.
   */
  summary: string;

  /**
   * Extended detail. Optional. Should be compact; not a transcript.
   * Routing layer may omit this from forwarding in 'cheap' mode.
   */
  details?: string;

  /**
   * ID of the signal this replaces. When set, the replaced signal is
   * transitioned to 'superseded'.
   */
  replaces?: string;

  /**
   * Step number at which this signal expires. The connectivity layer
   * transitions to 'expired' when the thread advances past this step.
   * When omitted, signal does not auto-expire.
   */
  expiresAtStep?: number;

  /** ISO-8601 timestamp of emission. Set by the layer. */
  emittedAt: string;

  /** Current lifecycle state. Managed by the layer. */
  state: SignalState;
}

export type SignalAudience = 'self' | 'coordinator' | 'selected' | 'all';
export type MessageClass = 'attention' | 'confidence' | 'conflict' | 'handoff' | 'escalation';
export type SignalClass =
  | 'attention.raise'
  | 'confidence.high'
  | 'confidence.medium'
  | 'confidence.low'
  | 'confidence.blocker'
  | 'conflict.active'
  | 'conflict.resolved'
  | 'handoff.ready'
  | 'handoff.partial'
  | 'escalation.interrupt'
  | 'escalation.uncertainty';
export type SignalPriority = 'low' | 'normal' | 'high' | 'critical';
export type SignalState = 'emitted' | 'active' | 'superseded' | 'expired' | 'resolved';
```

### 6.2 `ConnectivityLayer`

```typescript
export interface ConnectivityLayer {
  /**
   * Emit a signal. Returns the stored signal with assigned id, emittedAt,
   * and initial state='emitted'.
   *
   * Suppression: if a signal with the same source + signalClass + audience
   * was emitted within the current suppression window and has not been
   * resolved/superseded, this call returns the existing signal unchanged
   * (no duplicate stored). The caller can inspect the returned signal's id
   * to detect suppression.
   */
  emit(input: EmitSignalInput): ConnectivitySignal;

  /**
   * Transition a signal to 'resolved'. Idempotent if already resolved.
   */
  resolve(signalId: string): ConnectivitySignal;

  /**
   * Retrieve signals for a thread, optionally filtered.
   */
  query(query: SignalQuery): ConnectivitySignal[];

  /**
   * Retrieve a single signal by ID. Returns null if not found.
   */
  get(signalId: string): ConnectivitySignal | null;

  /**
   * Advance the step counter for the thread. Signals with expiresAtStep
   * <= current step are transitioned to 'expired'.
   */
  advanceStep(threadId: string): void;

  /**
   * Register a recipient resolver for the 'selected' audience.
   * When a signal is emitted with audience='selected', the resolver is
   * called to determine which component IDs to notify.
   */
  registerSelectedResolver(
    resolver: SelectedAudienceResolver,
  ): void;

  /**
   * Register a callback to be invoked whenever a signal is emitted,
   * superseded, or resolved. Used by coordination and routing layers
   * to react to signals without polling.
   */
  onSignal(callback: SignalCallback): void;

  /** Remove a previously registered callback. */
  offSignal(callback: SignalCallback): void;
}
```

### 6.3 `EmitSignalInput`

```typescript
export interface EmitSignalInput {
  threadId: string;
  source: string;
  audience: SignalAudience;
  messageClass: MessageClass;
  signalClass: SignalClass;
  priority: SignalPriority;
  summary: string;
  confidence?: number;
  details?: string;
  replaces?: string;
  expiresAtStep?: number;
}
```

### 6.4 `SignalQuery`

---ROUTING SPEC---
# v1 Routing Spec — `@relay-assistant/routing`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/routing`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.2 (after core, sessions, surfaces, memory, connectivity land)

---

## 1. Responsibilities

`@relay-assistant/routing` manages model selection and routing-mode decisions across an assistant's coordination context. It is the layer that translates cost/latency/quality requirements into concrete model choices, without knowing about business logic or user-facing content.

This package is directly informed by Workforce routing patterns: cheap/fast/deep mode tiers, per-request cost envelopes, and quality-preserving routing with configurable thresholds.

**Owns:**
- `RoutingMode` — the three-tier model: `cheap`, `fast`, `deep`
- `ModelSelector` — given a routing context, returns a model specification
- `RoutingPolicy` — per-assistant and per-capability routing rules; configures when to use each mode
- `RoutingContext` — the signal envelope passed to the model selector for each invocation
- Cost envelope tracking — per-thread accounting of token/cost budget; trips mode escalation when exceeded
- Latency envelope — per-request latency target; routing selects models that can meet it
- Escalation receiver — implements `RoutingEscalationHook` from `@relay-assistant/connectivity`; applies requested mode changes

**Does NOT own:**
- The actual model API calls (→ product code or capability handlers; routing provides the model spec, not the invocation)
- Prompts, context assembly, or response formatting (→ product capability handlers)
- Coordination logic or specialist delegation (→ `@relay-assistant/coordination`)
- Connectivity signals (→ `@relay-assistant/connectivity`; routing receives escalation signals from connectivity, does not emit them)
- Session management (→ `@relay-assistant/sessions`)
- Surface delivery (→ `@relay-assistant/surfaces`)

---

## 2. Non-Goals

- Routing does not implement load balancing, failover, or retries across providers. Those are relay-foundation or product concerns.
- Routing does not make semantic content decisions. It does not read message text to decide routing; it reads structured context (capability name, cost envelope, escalation signals, constraints).
- Routing does not define model IDs. It defines `ModelSpec` — a structured description that product code resolves to a concrete model ID. This keeps routing OSS and provider-agnostic.
- Routing does not enforce policy; it recommends. The caller may override a routing decision if it has product-specific reasons.
- Routing is not a multi-step planner. It returns a single `RoutingDecision` per invocation context.
- Routing does not maintain session state or per-user history.

---

## 3. Routing Modes

Workforce-informed three-tier model:

| Mode | Intent | Typical characteristics |
|---|---|---|
| `cheap` | Minimize cost; quality bar is acceptable for routine tasks | Smaller model, limited context window, no tool use |
| `fast` | Minimize latency; quality bar is good for interactive responses | Mid-tier model, moderate context, standard tool use |
| `deep` | Maximize quality; cost and latency are secondary | Largest model, full context, full tool use, may include chain-of-thought |

Modes are advisory. The model selector maps modes to `ModelSpec`; products configure which concrete models correspond to each mode.

---

## 4. Interfaces and Contracts

### 4.1 `RoutingMode`

```typescript
export type RoutingMode = 'cheap' | 'fast' | 'deep';
```

### 4.2 `ModelSpec`

```typescript
/**
 * A routing recommendation, not a concrete model ID.
 * Product code resolves this to a provider-specific model ID.
 */
export interface ModelSpec {
  /** Routing mode this spec corresponds to. */
  mode: RoutingMode;

  /**
   * Capability tier requested. Products map tiers to model IDs in their
   * configuration. Standard tiers: 'small', 'medium', 'large', 'frontier'.
   */
  tier: ModelTier;

  /**
   * Whether tool use is required. When true, the resolved model must support
   * function calling / tool use.
   */
  requiresToolUse: boolean;

  /**
   * Whether streaming is required. When true, the resolved model must support
   * streaming responses.
   */
  requiresStreaming: boolean;

  /**
   * Minimum context window required, in tokens. 0 = no requirement.
   */
  minContextTokens: number;

  /**
   * Maximum acceptable latency to first token, in milliseconds.
   * 0 = no requirement.
   */
  maxLatencyMs: number;

  /**
   * Arbitrary routing hints for product-specific resolution. Routing populates
   * these from RoutingPolicy; product code may use them to select among
   * multiple models that otherwise match.
   */
  hints: Record<string, unknown>;
}

export type ModelTier = 'small' | 'medium' | 'large' | 'frontier' | string;
```

### 4.3 `RoutingContext`

```typescript
/**
 * Input to the routing decision. Built by the caller (capability handler or
 * coordinator) and passed to router.decide().
 */
export interface RoutingContext {
  /** Thread or session this invocation belongs to. */
  threadId: string;

  /**
   * The capability being invoked. Routing policy may have per-capability
   * mode overrides.
   */
  capability: string;

  /**
   * Current accumulated cost for this thread, in abstract units.
   * Routing uses this to determine if the cost envelope has been exceeded.
   */
  accumulatedCost?: number;

  /**
   * Desired maximum latency for this response, in milliseconds.
   * 0 = no requirement (routing uses its default).
   */
  requestedMaxLatencyMs?: number;

  /**
   * Whether this invocation requires tool use.
   */
  requiresToolUse?: boolean;

  /**
   * Whether this invocation requires streaming.
   */
  requiresStreaming?: boolean;

  /**
   * Minimum context window required.
   */
  minContextTokens?: number;

  /**
   * Escalation signals active in this thread, from the connectivity layer.
   * Routing reads escalation signals to potentially upgrade the mode.
   */
  activeEscalations?: EscalationSummary[];

  /**
   * Caller-requested mode override. When set, routing respects this unless
   * the RoutingPolicy has a hard constraint.
   */
  requestedMode?: RoutingMode;
}

export interface EscalationSummary {
  signalClass: string;
  priority: string;
  requestedMode?: string;
}
```

### 4.4 `RoutingDecision`

```typescript
export interface RoutingDecision {
  /** The recommended routing mode. */
  mode: RoutingMode;

  /** The model specification for this decision. */
  modelSpec: ModelSpec;

  /**
   * The reason for this decision. Used for logging and debugging.
   * Not shown to users.
   */
  reason: RoutingReason;

  /**
   * Whether the mode was escalated from the policy default due to signals
   * or cost envelope.
   */
  escalated: boolean;

  /**
   * Whether the caller's requestedMode was overridden by policy.
   */
  overridden: boolean;
}

export type RoutingReason =
  | 'policy_default'
  | 'capability_override'
  | 'escalation_signal'
  | 'cost_envelope_exceeded'
  | 'latency_constraint'
  | 'caller_requested'
  | 'hard_constraint';
```

### 4.5 `Router`

```typescript
export interface Router {
  /**
   * Make a routing decision for the given context.
   * Never throws; returns a decision even when falling back to defaults.
   */
  decide(context: RoutingContext): RoutingDecision;

  /**
   * Record the actual cost of a completed invocation. Used for cost
   * envelope tracking within a thread.
   */
  recordCost(threadId: string, cost: number): void;

  /**
   * Get the current accumulated cost for a thread.
   */
  getAccumulatedCost(threadId: string): number;

  /**
   * Reset cost tracking for a thread (e.g., at session end).
   */
  resetCost(threadId: string): void;

  /**
   * Implements RoutingEscalationHook from @relay-assistant/connectivity.
   * Called by the connectivity layer when an escalation signal is emitted.
   * Returns the requested routing mode based on the signal.
   */
  onEscalation(signal: ConnectivityEscalationSignal): RequestedRoutingMode | void;
}
```

### 4.6 `RoutingPolicy`

```typescript
/**
