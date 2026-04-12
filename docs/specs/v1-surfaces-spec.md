# v1 Surfaces Spec — `@agent-assistant/surfaces`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@agent-assistant/surfaces`
**Version target:** v0.1.0 (pre-1.0, provisional)

---

## 1. Responsibilities

`@agent-assistant/surfaces` manages the connections between the assistant runtime and user-facing interaction mediums. A surface is any channel through which a user sends messages to or receives messages from the assistant (web chat, Slack, desktop, API, etc.).

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
- Session attachment decisions (→ `@agent-assistant/sessions`)
- Routing decisions about which model to call (→ `@agent-assistant/routing`)
- Memory (→ `@agent-assistant/memory`)
- Delivery guarantees or retry logic (→ relay foundation)

---

## 2. Non-Goals

- Surfaces does not implement Slack, Teams, or any specific surface protocol. It defines the adapter interface; product code or a platform package provides the implementation.
- Surfaces does not manage authentication or access control for surface connections. That is the relay foundation's responsibility.
- Surfaces does not buffer or queue messages for offline surfaces. If a surface adapter's send fails, the error propagates to the caller.
- Surfaces does not know about conversation history. It handles one outbound event at a time.
- Surfaces is not a notification system. Proactive delivery is driven by `@agent-assistant/proactive`; surfaces handles the actual send once triggered.

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
 * and RelayOutboundAdapter from @agent-assistant/core, serving as the
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
// From @agent-assistant/core
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
- `@agent-assistant/core` — imports `InboundMessage`, `OutboundEvent` types. The `SurfaceRegistry` acts as the inbound relay adapter for core.
- `@agent-assistant/sessions` — imports `Session` type to read `attachedSurfaces` for fanout.

### Depended on by
- Product code that registers surface connections.
- `@agent-assistant/proactive` — calls `surfaceRegistry.send()` or `fanout()` to deliver proactive messages.

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

The outbound routing decision is made by core's `runtime.emit()` and delegated to the surfaces layer:

- **Targeted send:** When `OutboundEvent.surfaceId` is present, `surfaceRegistry.send(event)` delivers to exactly one surface.
- **Session fanout:** When `OutboundEvent.surfaceId` is absent and `OutboundEvent.sessionId` is present, `surfaceRegistry.fanout(event, attachedSurfaceIds, policy?)` delivers to all session-attached surfaces.
- **Invalid:** When both `surfaceId` and `sessionId` are absent, core's `runtime.emit()` throws `OutboundEventError` before reaching the surfaces layer.

This rule is defined once in `docs/specs/v1-core-spec.md` (section 3.7, `runtime.emit()` contract) and referenced here. Surfaces implements the delivery; core implements the routing decision.

---

## 9. OSS vs Cloud Boundary

All types, factory functions, and the in-memory registry are OSS.

Surface adapters for specific platforms (Slack, Teams, Intercom) may be cloud-specific packages or product code; this package defines only the `SurfaceAdapter` interface.

No surface behavior requires a hosted service. A self-hosted consumer can implement `SurfaceAdapter` backed by a local WebSocket server or HTTP endpoint.

---

## 10. Open Questions

| # | Question | Owner | Resolution target |
|---|---|---|---|
| OQ-1 | Should fanout be concurrent (current spec) or sequential? Concurrent is faster but makes error attribution harder. | Surfaces | Before WF-5 |
| OQ-2 | Should `SurfaceRegistry.send()` silently drop events for inactive surfaces, or throw? Current spec throws. | Surfaces + Core | Before WF-5 |
| OQ-3 | Should normalization be strict (throw on missing required fields) or permissive (warn + fallback)? Current spec is permissive. | Surfaces | First implementation slice |
| OQ-4 | Should surfaces expose a streaming API for progressive response delivery, or is that a v2 concern? | Surfaces | v1.1 (not blocking v1) |
| OQ-5 | When a session has surfaces of different types (e.g., web + Slack), should the same text be sent to both, or should there be a per-surface content override mechanism? | Surfaces | Before WF-6 (multi-surface stretch) |

---

## 11. First Implementation Slice

**Step 1 — Type exports only**
- Export all interfaces, types, and error classes.
- Tests: TypeScript structural checks.

**Step 2 — In-memory `SurfaceRegistry`**
- `register`, `unregister`, `get`, `list`.
- Tests: register; conflict error on duplicate; unregister is idempotent; list with state filter.

**Step 3 — `send()` with format hook**
- Call format hook if present; pass result to adapter.
- Tests: mock adapter receives correct payload; format hook output is used.

**Step 4 — Inbound normalization**
- Implement `receiveRaw` + `setInboundHandler` with field extraction logic.
- Tests: various raw payload shapes produce correct `InboundMessage`; missing optional fields use fallbacks.

**Step 5 — Fanout**
- Implement `fanout()` with continue/abort policy.
- Tests: two active surfaces both receive event; inactive surface is skipped; one failure does not abort others when policy is 'continue'.

**Step 6 — Connection state management**
- Implement `onConnect` / `onDisconnect` callbacks from adapter; update `SurfaceConnection.state`.
- Tests: state transitions from inactive → active on connect callback.

**Step 7 — Integration with core runtime**
- Wire registry as the `RelayInboundAdapter` and `RelayOutboundAdapter` for core.
- Tests: core dispatches inbound message through surfaces normalization; core outbound event reaches adapter.

**Definition of done:** WF-5 (Attach surface and route messages) workflow can run against this package with a stub relay foundation.

SPEC_READY
SPEC_RECONCILED
