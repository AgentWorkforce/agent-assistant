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
- `RelayInboundAdapter` and `RelayOutboundAdapter` implementation — `SurfaceRegistry` implements both core adapter interfaces, acting as the bridge between the relay foundation and core
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
/**
 * Central surface management object. Implements both RelayInboundAdapter
 * and RelayOutboundAdapter from @relay-assistant/core, serving as the
 * bridge between the relay foundation and the assistant runtime.
 */
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

### 4.9 Inbound Adapter Contract

`SurfaceRegistry` implements core's `RelayInboundAdapter` interface:

```typescript
// From @relay-assistant/core
export interface RelayInboundAdapter {
  onMessage(handler: (message: InboundMessage) => void): void;
  offMessage(handler: (message: InboundMessage) => void): void;
}
```

Internally, `SurfaceRegistry` also exposes a `receiveRaw()` method for the relay foundation to push raw events:

```typescript
/**
 * Called by the relay foundation when a raw message arrives.
 * SurfaceRegistry normalizes the raw event into an InboundMessage,
 * then calls the handler registered via onMessage().
 *
 * Flow: relay foundation → receiveRaw(surfaceId, raw) → normalize → InboundMessage → handler
 */
receiveRaw(surfaceId: string, raw: unknown): void;
```

The `setInboundHandler()` method from earlier drafts is replaced by the standard `onMessage()` / `offMessage()` contract from `RelayInboundAdapter`. Products wire the registry during initialization:

```typescript
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,   // SurfaceRegistry implements RelayInboundAdapter
  outbound: surfaceRegistry,  // SurfaceRegistry implements RelayOutboundAdapter
});
```

### 4.10 Normalization

Inbound normalization extracts these fields from a raw relay event:

| Target field | Source | Fallback |
|---|---|---|
| `id` | `raw.messageId` or `raw.id` | Generated UUID |
| `surfaceId` | Provided by relay (first arg to `receiveRaw`) | Error if missing |
| `sessionId` | `raw.sessionId` or `raw.session?.id` | undefined |
| `userId` | `raw.userId` or `raw.user?.id` or `raw.user` (if string) | **Error:** reject message and log error. `userId` is required. |
| `workspaceId` | `raw.workspaceId` or `raw.workspace?.id` | `undefined` (optional) |
| `text` | `raw.text` or `raw.content` or `raw.body` | Empty string; logs warning |
| `receivedAt` | `raw.timestamp` or `raw.receivedAt` | `new Date().toISOString()` |
| `raw` | Verbatim | Required |

Normalization does not fail on missing optional fields; it logs warnings and uses fallbacks.

> **Required field:** `userId` is required on `InboundMessage` (per core spec). If normalization cannot extract a user identifier from the raw payload, it must reject the message and log an error. It must not silently assign an anonymous ID without the product opting into that behavior via a custom `normalizationHook`.

### 4.11 Error types

```typescript
export class SurfaceNotFoundError extends Error {
  constructor(public readonly surfaceId: string) {
    super(`Surface not found: ${surfaceId}`);
  }
}

export class SurfaceConflictError extends Error {
  constructor(public readonly surfaceId: string) {
    super(`Surface already registered: ${surfaceId}`);
  }
}

export class SurfaceDeliveryError extends Error {
  constructor(
    public readonly surfaceId: string,
    cause: Error,
  ) {
    super(`Delivery failed for surface ${surfaceId}: ${cause.message}`);
    this.cause = cause;
  }
}
```

---

## 5. `createSurfaceRegistry` Factory

```typescript
export function createSurfaceRegistry(
  config?: SurfaceRegistryConfig,
): SurfaceRegistry;

export interface SurfaceRegistryConfig {
  /** Default fanout policy applied when none is provided per-call. */
  defaultFanoutPolicy?: FanoutPolicy;

  /**
   * Normalization override. When provided, replaces the default normalization
   * logic. Useful for products with non-standard relay payloads.
   */
  normalizationHook?: (surfaceId: string, raw: unknown) => InboundMessage;
}
```

---

## 6. Package Boundaries

### Depends on
- `@relay-assistant/core` — imports `InboundMessage`, `OutboundEvent` types. The `SurfaceRegistry` acts as the inbound relay adapter for core.
- `@relay-assistant/sessions` — imports `Session` type to read `attachedSurfaces` for fanout.

### Depended on by
- Product code that registers surface connections.
- `@relay-assistant/proactive` — calls `surfaceRegistry.send()` or `fanout()` to deliver proactive messages.

### Relay foundation boundary
- Surfaces never opens sockets or calls relay APIs directly. The relay foundation calls `surfaceRegistry.receiveRaw()` (push model) and implements `SurfaceAdapter.send()` for each surface type.
- The separation is explicit: relay handles transport; surfaces handles normalization, format, and fanout.

---

## 7. Dependency Rules

| Direction | Rule |
|---|---|
| Surfaces → core | Allowed. Import types only (InboundMessage, OutboundEvent). |
| Surfaces → sessions | Allowed. Import Session type for fanout. |
| Surfaces → memory | Forbidden. |
| Surfaces → routing | Forbidden. |
| Surfaces → relay foundation | Forbidden. Relay foundation depends on surfaces, not vice versa. |
| Other packages → surfaces | Allowed. Import SurfaceRegistry, SurfaceConnection types. |

---

## 8. Fanout Behavior Detail

Fanout is triggered when a response should reach all surfaces in a session:

1. Core emits an `OutboundEvent` with a `sessionId` but no specific `surfaceId`.
2. The runtime's outbound adapter calls `surfaceRegistry.fanout(event, session.attachedSurfaces, policy)`.
3. For each surface ID, registry looks up the connection.
4. If connection is `active`, call `formatHook` (if present) then `adapter.send()`.
5. If connection is `inactive` and `skipInactive=true`, add a 'skipped' outcome.
6. Collect outcomes; return `FanoutResult`.

When the event specifies a `surfaceId` (targeted delivery), `send()` is used instead of `fanout()`.

**Ordering:** Fanout sends are concurrent (Promise.all-equivalent). There is no ordering guarantee across surfaces.

### Outbound Routing Rule (normative — matches core spec)

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

### Steps

1. Import only `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces` — no other packages
2. Define `AssistantDefinition` with `id`, `name`, `capabilities: { chat: chatHandler }`
3. Create `InMemorySessionStoreAdapter` and `createSessionStore({ adapter })`
4. Create `createSurfaceRegistry()` with slack and web connections (stub adapters)
5. Wire: `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })`
6. `runtime.register('sessions', sessionStore)`
7. In `chatHandler`: resolve session via `resolveSession(message, store, resolver)` (reads `message.userId`), touch it, emit a response
8. Call `runtime.start()`
9. Simulate inbound message from slack → session created → handler called → response emitted → slack adapter receives `SurfacePayload`
10. Simulate second message from web surface → session reactivated via touch → fanout to both surfaces
11. Call `runtime.stop()` — runtime drains in-flight handlers cleanly
12. Verify `runtime.status()` after stop reflects correct state

### Acceptance criteria

- Full end-to-end cycle passes in a single test with no external dependencies
- Assembly uses only `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces`
- Assembly pattern matches the canonical pattern from `docs/architecture/spec-reconciliation-rules.md §3b`:
  ```typescript
  const definition: AssistantDefinition = { id, name, capabilities };
  const sessionStore = createSessionStore({ adapter });
  const surfaceRegistry = createSurfaceRegistry();
  surfaceRegistry.register(connection);
  const runtime = createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry });
  runtime.register('sessions', sessionStore);
  await runtime.start();
  ```
- The test passes without any cloud, network, or external dependency
- Package READMEs for core, sessions, and surfaces are updated with real API docs replacing placeholder text
- v1 release tag is prepared

---

## Dependency Graph

```
[v1-core-spec]    ──→ WF-1 ──→ WF-2 ──┐
                                        ├──→ WF-4 ──┐

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

---SESSIONS REVIEW VERDICT---
# v1 Sessions Package — Review Verdict

**Status:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Reviewer:** non-interactive review agent
**Package:** `@relay-assistant/sessions`
**Spec:** `docs/specs/v1-sessions-spec.md`
**Plan:** `docs/architecture/v1-sessions-implementation-plan.md`

---

## Verdict Summary

**PASS_WITH_FOLLOWUPS**

The implementation is spec-faithful and production-ready for v1 / WF-3. All interfaces match the canonical spec exactly, all 26 planned tests are present and logically correct, and the core integration contract is verified at compile time with zero runtime dependencies on other packages. A set of minor follow-ups are identified below; none block WF-3 completion or the move to surfaces coding.

---

## 1. Spec Conformance

### Types (`packages/sessions/src/types.ts`)

| Export | Spec Section | Status |
|---|---|---|
| `Session` interface | §4.1 | ✅ Exact field-for-field match |
| `SessionState` type | §4.1 | ✅ All four states present |
| `SessionStore` interface | §4.2 | ✅ All 9 methods, signatures match |
| `CreateSessionInput` | §4.3 | ✅ Exact match |
| `SessionQuery` | §4.4 | ✅ All fields including `activeAfter` and `limit` |
| `SessionStoreAdapter` | §4.5 | ✅ Exact match |
| `AffinityResolver` | §4.6 | ✅ Exact match |
| `SessionStoreConfig` | §5 | ✅ Exact match |
| `SessionNotFoundError` | §4.7 | ✅ Correct constructor shape; bonus `.name` assignment |
| `SessionConflictError` | §4.7 | ✅ Correct constructor shape |
| `SessionStateError` | §4.7 | ✅ All three public fields; message template matches spec |
| `SessionResolvableMessage` | Plan §3.3 | ✅ Correct structural subset of `InboundMessage` |

### `createSessionStore` lifecycle logic (`packages/sessions/src/sessions.ts`)

All state transitions from plan §5 are correctly implemented:

| Transition | Trigger | Implementation Status |
|---|---|---|
| `created` → `active` | `touch()` | ✅ |
| `active` → `active` | `touch()` | ✅ updates `lastActivityAt` only |
| `active` → `suspended` | `sweepStale()` | ✅ |
| `active` → `expired` | `expire()` | ✅ |
| `suspended` → `active` | `touch()` | ✅ |
| `suspended` → `expired` | `expire()` | ✅ |
| `expired` → `expired` | `expire()` | ✅ idempotent, no-op |
| `expired` → any | `touch()` | ✅ throws `SessionStateError` |
| `created` → `expired` | `expire()` | ✅ (via the generic "any non-expired" path) |

Other correctness checks:
- `create()` — checks for existing ID before insert (conflict detection correct); initializes `attachedSurfaces` from `initialSurfaceId` if provided; shallow-merges seed metadata. ✅
- `attachSurface()` / `detachSurface()` — idempotency guards correct. ✅
- `sweepStale()` — correctly scoped to `state: 'active'`; uses `Number.MAX_SAFE_INTEGER` as the fetch limit to get all active sessions before filtering. This is correct for the in-memory adapter but see follow-up F-5.
- `updateMetadata()` — uses `{ ...session.metadata, ...metadata }` for shallow merge (no replace). ✅
- `resolveSession()` — calls `resolver.resolve`, touches on hit, creates on miss. ✅
- `defaultAffinityResolver()` — sorts by `lastActivityAt` descending, prefers surface match before falling back to recency. ✅

### `InMemorySessionStoreAdapter`

- Backed by `Map<string, Session>` with `structuredClone` for deep isolation. ✅
- `fetchMany()` applies all `SessionQuery` fields: `userId`, `workspaceId`, `state` (normalized to array), `surfaceId`, `activeAfter`, `limit`. ✅
- `update()` uses `Object.assign`-equivalent spread and throws `SessionNotFoundError` on missing key. ✅
- `insert()` throws `SessionConflictError` on duplicate — note this creates a double-conflict check path since `createSessionStore.create()` also checks before calling `insert()`. The redundancy is harmless and provides defense in depth.

---

## 2. Core Integration Shape

The `SessionStore.get(sessionId): Promise<Session | null>` method satisfies core's internal duck type:

```typescript
// core.ts lines 29–37
type SessionSubsystem =
  | { get(sessionId: string): SessionRecord | null | undefined | Promise<SessionRecord | null | undefined>; }
  | { getSession(...): ... };

type SessionRecord = { attachedSurfaces?: string[] };
```

`Session.attachedSurfaces: string[]` is a structural superset of `SessionRecord.attachedSurfaces?: string[]`. The return type `Promise<Session | null>` is assignable to `Promise<SessionRecord | null | undefined>`. No wrapper, adapter, or type assertion needed.

The compile-time contract check at the top of `sessions.test.ts` catches any future drift:

```typescript
const _contractCheck: SessionSubsystemGet = {} as SessionStore; // must compile
```

This is correctly placed and well-formed. ✅

Package has **zero runtime dependencies** — no import from `@relay-assistant/core` at runtime. `SessionResolvableMessage` is a locally-defined structural subset, allowing `InboundMessage` to be passed without an import. ✅

`runtime.register('sessions', store)` / `runtime.get<SessionStore>('sessions')` pattern is clean and requires no adaptation code. ✅

---

## 3. Test Coverage

### Planned test count vs actual

Plan §6 specified 26 tests across 8 groups. All 26 are implemented. Mapping verified:

| Group | Plan | Actual | Status |
|---|---|---|---|
| 6.1 Session creation | 4 | 4 | ✅ |
| 6.2 Session retrieval | 3 | 3 | ✅ |
| 6.3 Lifecycle transitions | 6 | 6 | ✅ |
| 6.4 Surface attachment | 3 | 3 | ✅ |
| 6.5 Sweep and metadata | 3 | 3 | ✅ |
| 6.6 Error cases | 3 | 3 | ✅ |
| 6.7 Affinity and resolution | 3 | 3 | ✅ |
| 6.8 Contract check | 1 | 1 | ✅ |
| **Total** | **26** | **26** | ✅ |

### Test quality notes

- `vi.useFakeTimers()` + `vi.setSystemTime()` used correctly for time-sensitive tests. No real-time sleeps. ✅
- `beforeEach(() => vi.useRealTimers())` cleanup guards correctly present in scoped describes. ✅
- Lifecycle tests verify both state transitions and timestamp mutations. ✅
- `resolveSession` tests use explicit `vi.fn()` spy to verify resolver call arguments. ✅
- Tests import from `./index.js` (the public surface), not internal files directly. ✅

### Minor test gaps (see follow-ups)

- `expire()` from `created` and `suspended` states are not explicitly tested (only `active → expired` and idempotency are tested).
- `detachSurface()` on an unknown session ID is not tested (implementation correctly throws `SessionNotFoundError`, but no test asserts this).
- `defaultAffinityResolver` surface-preference branch (the path where `surfaceId` is provided and a matching session is found) is not exercised.
- `find()` with `workspaceId`, `surfaceId`, and `activeAfter` query fields are not individually tested.
- The `sweepStale` test only tests a single stale session; a multi-session scenario (some stale, some not) would add confidence.

---

## 4. Follow-Ups Before Surfaces Coding

The following items are required or recommended before `@relay-assistant/surfaces` starts taking a dependency on this package.

### F-1 (Required): WF-4 Integration Test

Per plan §4.2, `packages/core/src/core-sessions.test.ts` must be written to validate the full path: `runtime.register('sessions', store)` → `emit({ sessionId })` → `resolveAttachedSurfaces()` → fanout. This is explicitly out of scope for this PR but must exist before surfaces depends on the sessions + core integration.

### F-2 (Recommended): Missing Lifecycle Transition Tests

Add tests for:
- `expire()` from `created` state (plan §5 includes this transition explicitly)
- `expire()` from `suspended` state
- `detachSurface()` on unknown session → `SessionNotFoundError`
- `defaultAffinityResolver` with surfaceId that matches an attached surface (exercises the surface-preference branch)

These paths work correctly in the implementation; the tests are missing.

### F-3 (Recommended): Expand `find()` Query Tests

The `fetchMany()` filters for `workspaceId`, `surfaceId`, and `activeAfter` are implemented and correct but have no test coverage. Add targeted tests for each filter to guard against regressions in the adapter and to document expected semantics.

### F-4 (Minor): Dead Code in `sweepStale`

```typescript
// sessions.ts line 156
const effectiveTtlMs = ttlMs ?? defaultTtlMs;
```

`ttlMs` is typed as `number` (required) in both `SessionStore` and `sweepStale`'s own signature, so the `??` fallback is dead code — TypeScript prevents `ttlMs` from ever being nullish. Either make `ttlMs` optional in the `SessionStore` interface (so the fallback is live) or remove the `?? defaultTtlMs` expression. The spec shows the signature as `sweepStale(ttlMs: number)` so removing the fallback is the spec-compliant option.

### F-5 (Minor): Document `Number.MAX_SAFE_INTEGER` in `sweepStale`

```typescript
// sessions.ts line 159
const activeSessions = await adapter.fetchMany({
  state: 'active',
  limit: Number.MAX_SAFE_INTEGER,
});
```

This is intentional and correct for the in-memory adapter, but future persistent adapter authors need to know that `sweepStale` deliberately bypasses the default limit. A brief inline comment explaining this intent will prevent future adapter implementations from silently honoring the limit and producing incomplete sweeps.

### F-6 (Open from Spec): OQ-2 and OQ-3 Still Open

Per spec §10:
- **OQ-2**: Maximum surfaces per session — unresolved. Must be resolved before WF-4 workflow where surfaces depend on session attachment semantics.
- **OQ-3**: Delete vs. retain expired records — unresolved. Must be resolved before a persistent adapter (Redis/Postgres) is implemented.

These do not block surfaces coding directly but should be assigned an owner and resolution target before the next spec iteration.

---

## Summary

| Dimension | Result |
|---|---|
| Spec conformance (types, interfaces, errors) | ✅ Complete |
| Lifecycle implementation (all transitions) | ✅ Correct |
| In-memory adapter | ✅ Correct, deep-clone isolated |
| `resolveSession` + `defaultAffinityResolver` | ✅ Correct |
| Core integration shape | ✅ Verified, compile-time contract check present |
| Dependency rules (no core/surfaces/memory imports) | ✅ Enforced by zero runtime deps |
| Planned test count (26/26) | ✅ Complete |
| Test quality (fakes, cleanup, assertions) | ✅ Good |
| README accuracy | ✅ Accurate |
| Minor gaps | F-2 through F-5 — none block v1 |
| Open spec questions | OQ-2, OQ-3 need resolution before persistent adapters |

Coding can proceed to surfaces. WF-4 integration test must be completed as the first task in the surfaces phase.

---

V1_SESSIONS_REVIEW_COMPLETE

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

---SESSIONS TYPES---
export interface Session {
  id: string;
  userId: string;
  workspaceId?: string;
  state: SessionState;
  createdAt: string;
  lastActivityAt: string;
  stateChangedAt?: string;
  attachedSurfaces: string[];
  metadata: Record<string, unknown>;
}

export type SessionState = 'created' | 'active' | 'suspended' | 'expired';

export interface SessionStore {
  create(input: CreateSessionInput): Promise<Session>;
  get(sessionId: string): Promise<Session | null>;
  find(query: SessionQuery): Promise<Session[]>;
  touch(sessionId: string): Promise<Session>;
  attachSurface(sessionId: string, surfaceId: string): Promise<Session>;
  detachSurface(sessionId: string, surfaceId: string): Promise<Session>;
  expire(sessionId: string): Promise<Session>;
  sweepStale(ttlMs: number): Promise<Session[]>;
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<Session>;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  workspaceId?: string;
  initialSurfaceId?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionQuery {
  userId?: string;
  workspaceId?: string;
  state?: SessionState | SessionState[];
  surfaceId?: string;
  activeAfter?: string;
  limit?: number;
}

export interface SessionStoreAdapter {
  insert(session: Session): Promise<void>;
  fetchById(sessionId: string): Promise<Session | null>;
  fetchMany(query: SessionQuery): Promise<Session[]>;
  update(sessionId: string, patch: Partial<Session>): Promise<Session>;
  delete(sessionId: string): Promise<void>;
}

export interface AffinityResolver {
  resolve(userId: string, surfaceId?: string): Promise<Session | null>;
}

export interface SessionStoreConfig {
  adapter: SessionStoreAdapter;
  defaultTtlMs?: number;
}

export interface SessionResolvableMessage {
  userId: string;
  workspaceId?: string;
  surfaceId: string;
}

export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionConflictError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session already exists: ${sessionId}`);
    this.name = 'SessionConflictError';
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
    this.name = 'SessionStateError';
  }
}

---SESSIONS IMPLEMENTATION---
import {
  SessionConflictError,
  SessionNotFoundError,
  SessionStateError,
} from './types.js';
import type {
  AffinityResolver,
  CreateSessionInput,
  Session,
  SessionQuery,
  SessionResolvableMessage,
  SessionState,
  SessionStore,
  SessionStoreAdapter,
  SessionStoreConfig,
} from './types.js';

const DEFAULT_TTL_MS = 3_600_000;
const DEFAULT_FIND_LIMIT = 50;

function cloneSession<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeLimit(limit?: number): number {
  return limit ?? DEFAULT_FIND_LIMIT;
}

function normalizeStateFilter(
  state?: SessionState | SessionState[],
): SessionState[] | undefined {
  if (!state) {
    return undefined;
  }

  return Array.isArray(state) ? state : [state];
}

function sortByRecentActivity(sessions: Session[]): Session[] {
  return [...sessions].sort((left, right) => {
    return (
      Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt)
    );
  });
}

async function getRequiredSession(
  adapter: SessionStoreAdapter,
  sessionId: string,
): Promise<Session> {
  const session = await adapter.fetchById(sessionId);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  return session;
}

export function createSessionStore(config: SessionStoreConfig): SessionStore {
  const { adapter } = config;
  const defaultTtlMs = config.defaultTtlMs ?? DEFAULT_TTL_MS;

  return {
    async create(input: CreateSessionInput): Promise<Session> {
      const existing = await adapter.fetchById(input.id);
      if (existing) {
        throw new SessionConflictError(input.id);
      }

      const timestamp = nowIso();
      const session: Session = {
        id: input.id,
        userId: input.userId,
        workspaceId: input.workspaceId,
        state: 'created',
        createdAt: timestamp,
        lastActivityAt: timestamp,
        attachedSurfaces: input.initialSurfaceId ? [input.initialSurfaceId] : [],
        metadata: { ...(input.metadata ?? {}) },
      };

      await adapter.insert(session);
      return cloneSession(session);
    },

    async get(sessionId: string): Promise<Session | null> {
      return adapter.fetchById(sessionId);
    },

    async find(query: SessionQuery): Promise<Session[]> {
      return adapter.fetchMany({
        ...query,
        limit: normalizeLimit(query.limit),
      });
    },

    async touch(sessionId: string): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);
      if (session.state === 'expired') {
        throw new SessionStateError(sessionId, session.state, 'touch');
      }

      const timestamp = nowIso();
      const patch: Partial<Session> = {
        lastActivityAt: timestamp,
      };

      if (session.state === 'created' || session.state === 'suspended') {
        patch.state = 'active';
        patch.stateChangedAt = timestamp;
      }

      return adapter.update(sessionId, patch);
    },

    async attachSurface(sessionId: string, surfaceId: string): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);
      if (session.attachedSurfaces.includes(surfaceId)) {
        return session;
      }

      return adapter.update(sessionId, {
        attachedSurfaces: [...session.attachedSurfaces, surfaceId],
      });
    },

    async detachSurface(sessionId: string, surfaceId: string): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);
      if (!session.attachedSurfaces.includes(surfaceId)) {
        return session;
      }

      return adapter.update(sessionId, {
        attachedSurfaces: session.attachedSurfaces.filter((value) => value !== surfaceId),
      });
    },

    async expire(sessionId: string): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);
      if (session.state === 'expired') {
        return session;
      }

      return adapter.update(sessionId, {
        state: 'expired',
        stateChangedAt: nowIso(),
      });
    },

    async sweepStale(ttlMs: number): Promise<Session[]> {
      const effectiveTtlMs = ttlMs ?? defaultTtlMs;
      const cutoff = Date.now() - effectiveTtlMs;
      const activeSessions = await adapter.fetchMany({
        state: 'active',
        limit: Number.MAX_SAFE_INTEGER,
      });
      const staleSessions = activeSessions.filter((session) => {
        return Date.parse(session.lastActivityAt) < cutoff;
      });

      const transitioned: Session[] = [];
      for (const session of staleSessions) {
        transitioned.push(
          await adapter.update(session.id, {
            state: 'suspended',
            stateChangedAt: nowIso(),
          }),
        );
      }

      return transitioned;
    },

    async updateMetadata(
      sessionId: string,
      metadata: Record<string, unknown>,
    ): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);

      return adapter.update(sessionId, {
        metadata: {
          ...session.metadata,
          ...metadata,
        },
      });
    },
  };
}

export class InMemorySessionStoreAdapter implements SessionStoreAdapter {
  private readonly sessions = new Map<string, Session>();

  async insert(session: Session): Promise<void> {
    if (this.sessions.has(session.id)) {
      throw new SessionConflictError(session.id);
    }

    this.sessions.set(session.id, cloneSession(session));
  }

  async fetchById(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    return session ? cloneSession(session) : null;
  }

  async fetchMany(query: SessionQuery): Promise<Session[]> {
    const states = normalizeStateFilter(query.state);
    const limit = normalizeLimit(query.limit);

    const matches = [...this.sessions.values()].filter((session) => {
      if (query.userId && session.userId !== query.userId) {
        return false;
      }

      if (query.workspaceId && session.workspaceId !== query.workspaceId) {
        return false;
      }

      if (states && !states.includes(session.state)) {
        return false;
      }

      if (query.surfaceId && !session.attachedSurfaces.includes(query.surfaceId)) {
        return false;
      }

      if (query.activeAfter && Date.parse(session.lastActivityAt) <= Date.parse(query.activeAfter)) {
        return false;
      }

      return true;
    });

    return matches.slice(0, limit).map((session) => cloneSession(session));
  }

  async update(sessionId: string, patch: Partial<Session>): Promise<Session> {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new SessionNotFoundError(sessionId);
    }

    const next = cloneSession({
      ...existing,
      ...patch,
    });
    this.sessions.set(sessionId, next);
    return cloneSession(next);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export async function resolveSession(
  message: SessionResolvableMessage,
  store: SessionStore,
  resolver: AffinityResolver,
): Promise<Session> {
  const existing = await resolver.resolve(message.userId, message.surfaceId);
  if (existing) {
    return store.touch(existing.id);
  }

  return store.create({
    id: globalThis.crypto.randomUUID(),
    userId: message.userId,
    workspaceId: message.workspaceId,
    initialSurfaceId: message.surfaceId,
  });
}

export function defaultAffinityResolver(store: SessionStore): AffinityResolver {
  return {
    async resolve(userId: string, surfaceId?: string): Promise<Session | null> {
      const sessions = sortByRecentActivity(
        await store.find({
          userId,
          state: ['active', 'suspended'],
          limit: DEFAULT_FIND_LIMIT,
        }),
      );

      if (surfaceId) {
        const attached = sessions.find((session) => session.attachedSurfaces.includes(surfaceId));
        if (attached) {
          return attached;
        }
      }

      return sessions[0] ?? null;
    },
  };
}

---EXISTING SURFACES README---
# `@relay-assistant/surfaces`

Status: placeholder package README, no implementation yet.

## Purpose

This package is intended to define assistant-facing surface abstractions above Relay transport primitives.

Consumers should expect this package to own:

- assistant-level surface connections
- assistant inbound and outbound message contracts
- response formatting hooks
- delivery fanout rules

## Expected Consumer Role

A product should import this package when it needs to attach one assistant runtime to multiple user-facing surfaces.

Illustrative usage target:

```ts
import { createSurfaceConnection } from "@relay-assistant/surfaces";
```

## What Stays Outside

- provider webhook verification
- transport adapter implementations
- one product's UI conventions
