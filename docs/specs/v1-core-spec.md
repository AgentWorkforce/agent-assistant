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
- Health/readiness probe — `runtime.status()` returns a structured object suitable for a health endpoint

> **Normalization boundary:** Core does not normalize raw relay events. It receives already-normalized `InboundMessage` objects from the surfaces layer. The `SurfaceRegistry` (from `@relay-assistant/surfaces`) implements core's `RelayInboundAdapter` interface and performs normalization before calling the registered handler. See Contradiction 1 resolution in `docs/architecture/spec-reconciliation-rules.md`.

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

  /** User who sent this message. Required. Extracted during surface normalization. */
  userId: string;

  /** Workspace scope. Optional. Used for scoped session affinity. */
  workspaceId?: string;

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
   * Emit an outbound event. Routing rule:
   * - **Targeted send:** When `event.surfaceId` is present, calls `RelayOutboundAdapter.send(event)`.
   * - **Session fanout:** When `event.surfaceId` is absent and `event.sessionId` is present,
   *   the runtime resolves the session's `attachedSurfaces` and calls
   *   `outboundAdapter.fanout(event, attachedSurfaceIds)` (implemented by `SurfaceRegistry`).
   * - **Invalid:** When both `surfaceId` and `sessionId` are absent, throws `OutboundEventError`.
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
  /** Surface to deliver to. When present, targeted send. When absent, session fanout. */
  surfaceId?: string;

  /** Session context. When surfaceId is absent, used for fanout to all attached surfaces. */
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

### 3.10 `OutboundEventError`

```typescript
export class OutboundEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundEventError';
  }
}
```

Thrown by `runtime.emit()` when an `OutboundEvent` has neither `surfaceId` nor `sessionId` set.

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
/** Injected by the surfaces layer to push normalized inbound messages into core. */
export interface RelayInboundAdapter {
  onMessage(handler: (message: InboundMessage) => void): void;
  offMessage(handler: (message: InboundMessage) => void): void;
}

/** Injected by the surfaces layer to deliver outbound events. */
export interface RelayOutboundAdapter {
  /** Targeted send to a single surface. */
  send(event: OutboundEvent): Promise<void>;
  /** Fanout to all attached surfaces of a session. */
  fanout?(event: OutboundEvent, attachedSurfaceIds: string[]): Promise<void>;
}
```

The surfaces layer implements these interfaces. Core never imports relay packages.

Note: `fanout` is optional on the interface so that test stubs can implement just `send`. `SurfaceRegistry` implements both.

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

---

## 8. Open Questions

| # | Question | Owner | Resolution target |
|---|---|---|---|
| OQ-1 | Should `AssistantRuntime.emit()` be fire-and-forget or require an ack from the surface adapter? Current spec says `Promise<void>` but does not define ack semantics. | Core + Surfaces | Before WF-2 workflow implementation |
| OQ-2 | Should `register()` / `get()` use typed tokens (à la NestJS) or plain string keys? String keys are simpler but lose type safety at call sites. | Core | Before package shell is written |
| OQ-3 | Is `onMessage` hook the right place for pre-dispatch filtering, or should there be a separate `middleware` chain? | Core + Policy | Before WF-2 |
| OQ-4 | Should `RuntimeConstraints.handlerTimeoutMs` apply per-invocation or per-capability? | Core | First implementation slice |

---

## 9. First Implementation Slice

Implement in this order. Each step must pass its own unit tests before the next begins.

**Step 1 — Type exports only**
- Export all interfaces and types from this spec with no implementation.
- Tests: TypeScript compiler accepts conforming objects; rejects non-conforming objects.

**Step 2 — `createAssistant` validation**
- Implement definition validation (required fields, no empty capabilities map).
- Throws `AssistantDefinitionError` with a structured message.
- Tests: unit tests for missing `id`, missing `name`, empty capabilities.

**Step 3 — Capability dispatch table**
- Build internal `Map<string, CapabilityHandler>` from definition.
- Wire `RelayInboundAdapter.onMessage` to receive normalized `InboundMessage` and route to the correct handler by `message.capability`.
- Tests: mock adapter pushes an `InboundMessage`; correct handler is called with correct message and `CapabilityContext`.

**Step 4 — `runtime.dispatch()` (test path)**
- Implement direct dispatch bypassing the relay adapter.
- Tests: dispatch a synthetic message; handler is called; `onMessage` hook can drop it.

**Step 5 — `runtime.emit()` integration**
- Call `RelayOutboundAdapter.send()` with the `OutboundEvent`.
- Tests: mock outbound adapter receives correct event structure.

**Step 6 — Lifecycle hooks**
- Implement `start()` / `stop()` with `onStart` / `onStop` hooks.
- Tests: hook call order; stop drains in-flight handlers before calling `onStop`.

**Step 7 — `runtime.status()`**
- Implement structured health object.
- Tests: status reflects subsystem registrations and in-flight count.

**Definition of done:** WF-1 (Define assistant and start runtime) workflow can run against this package using a stub relay adapter and produce a running `AssistantRuntime`.

SPEC_READY
SPEC_RECONCILED
