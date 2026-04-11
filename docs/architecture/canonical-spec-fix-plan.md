# Canonical Spec Fix Plan

Date: 2026-04-11
Triggered by: `docs/architecture/spec-reconciliation-review-verdict.md` (FAIL verdict)
Input documents:
- `docs/architecture/spec-reconciliation-rules.md` (rules and resolution definitions)
- `docs/architecture/spec-reconciliation-review-verdict.md` (FAIL verdict with specific findings)
- `docs/specs/v1-core-spec.md` (current, pre-reconciliation)
- `docs/specs/v1-surfaces-spec.md` (current, pre-reconciliation)
- `docs/specs/v1-sessions-spec.md` (current, minor cleanup needed)
- `docs/workflows/v1-workflow-backlog.md` (current, stale-term fix needed)

---

## 1. Exact Edits Required in `docs/specs/v1-core-spec.md`

### Edit 1.1 — Remove "owns inbound normalization" from section 1 (Contradiction 1)

**Location:** Section 1 "Responsibilities", "Owns" list, line 19

**Current text:**
```
- Inbound message normalization — converts raw relay-layer events into the canonical `InboundMessage` type before routing to handlers
```

**Action:** Remove this bullet entirely. Core does not own inbound normalization; surfaces does.

### Edit 1.2 — Add clarification that core receives already-normalized messages (Contradiction 1)

**Location:** Section 1 "Responsibilities", after the "Owns" list (after line 20 / the health probe bullet)

**Action:** Add a new paragraph:

```markdown
> **Normalization boundary:** Core does not normalize raw relay events. It receives already-normalized `InboundMessage` objects from the surfaces layer. The `SurfaceRegistry` (from `@relay-assistant/surfaces`) implements core's `RelayInboundAdapter` interface and performs normalization before calling the registered handler. See Contradiction 1 resolution in `docs/architecture/spec-reconciliation-rules.md`.
```

### Edit 1.3 — Add `userId` and `workspaceId?` to `InboundMessage` (Contradiction 2)

**Location:** Section 3.3 `InboundMessage` interface, lines 92-117

**Current interface** is missing `userId` and `workspaceId`.

**Action:** Add two fields after the `sessionId?` field:

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

### Edit 1.4 — Make `OutboundEvent.surfaceId` optional (Contradiction 3)

**Location:** Section 3.8 `OutboundEvent` interface, lines 220-235

**Current:** `surfaceId: string;` (required)

**Action:** Replace the full interface with:

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

### Edit 1.5 — Add `OutboundEventError` type (Contradiction 3)

**Location:** After section 3.9 `RuntimeStatus` (after line 248), add a new section 3.10.

**Action:** Add:

```markdown
### 3.10 `OutboundEventError`

\```typescript
export class OutboundEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundEventError';
  }
}
\```

Thrown by `runtime.emit()` when an `OutboundEvent` has neither `surfaceId` nor `sessionId` set.
```

### Edit 1.6 — Add normative outbound routing rule to `runtime.emit()` contract (Contradiction 3)

**Location:** Section 3.7 `AssistantRuntime`, the `emit()` method JSDoc (lines 184-186)

**Action:** Replace the `emit()` JSDoc + signature block with:

```typescript
  /**
   * Emit an outbound event. Routing rule:
   * - **Targeted send:** When `event.surfaceId` is present, calls `RelayOutboundAdapter.send(event)`.
   * - **Session fanout:** When `event.surfaceId` is absent and `event.sessionId` is present,
   *   the runtime resolves the session's `attachedSurfaces` and calls
   *   `outboundAdapter.fanout(event, attachedSurfaceIds)` (implemented by `SurfaceRegistry`).
   * - **Invalid:** When both `surfaceId` and `sessionId` are absent, throws `OutboundEventError`.
   */
  emit(event: OutboundEvent): Promise<void>;
```

### Edit 1.7 — Update `RelayInboundAdapter` to accept `InboundMessage` (Contradiction 1)

**Location:** Section 4 "Package Boundaries", `RelayInboundAdapter` interface, lines 267-272

**Current:**
```typescript
export interface RelayInboundAdapter {
  onMessage(handler: (raw: unknown) => void): void;
  offMessage(handler: (raw: unknown) => void): void;
}
```

**Action:** Replace with:

```typescript
/** Injected by the surfaces layer to push normalized inbound messages into core. */
export interface RelayInboundAdapter {
  onMessage(handler: (message: InboundMessage) => void): void;
  offMessage(handler: (message: InboundMessage) => void): void;
}
```

### Edit 1.8 — Update `RelayOutboundAdapter` to include fanout capability (Contradiction 3)

**Location:** Section 4, `RelayOutboundAdapter` interface, lines 274-277

**Current:**
```typescript
export interface RelayOutboundAdapter {
  send(event: OutboundEvent): Promise<void>;
}
```

**Action:** Replace with:

```typescript
/** Injected by the surfaces layer to deliver outbound events. */
export interface RelayOutboundAdapter {
  /** Targeted send to a single surface. */
  send(event: OutboundEvent): Promise<void>;
  /** Fanout to all attached surfaces of a session. */
  fanout?(event: OutboundEvent, attachedSurfaceIds: string[]): Promise<void>;
}
```

Note: `fanout` is optional on the interface so that test stubs can implement just `send`. `SurfaceRegistry` implements both.

### Edit 1.9 — Update first implementation slice step 3 (Contradiction 1)

**Location:** Section 9 "First Implementation Slice", Step 3, lines 348-351

**Current:**
```
- Wire `RelayInboundAdapter.onMessage` to normalize raw events into `InboundMessage` and route to the correct handler.
- Tests: mock adapter pushes a raw event; correct handler is called with correct `InboundMessage`.
```

**Action:** Replace with:

```
- Wire `RelayInboundAdapter.onMessage` to receive normalized `InboundMessage` and route to the correct handler by `message.capability`.
- Tests: mock adapter pushes an `InboundMessage`; correct handler is called with correct message and `CapabilityContext`.
```

### Edit 1.10 — Append `SPEC_RECONCILED` marker

**Location:** End of file, after `SPEC_READY` on line 371.

**Action:** Append on a new line:

```
SPEC_RECONCILED
```

---

## 2. Exact Edits Required in `docs/specs/v1-surfaces-spec.md`

### Edit 2.1 — State that `SurfaceRegistry` implements core's adapter interfaces (Contradiction 1)

**Location:** Section 1 "Responsibilities", "Owns" list, after the "Inbound normalization" bullet (line 17)

**Action:** Add a new bullet after "Inbound normalization":

```markdown
- `RelayInboundAdapter` and `RelayOutboundAdapter` implementation — `SurfaceRegistry` implements both core adapter interfaces, acting as the bridge between the relay foundation and core
```

### Edit 2.2 — Add `userId` and `workspaceId` to normalization table (Contradiction 2)

**Location:** Section 4.10 "Normalization" table, lines 299-306

**Current table** has rows for `id`, `surfaceId`, `sessionId`, `text`, `receivedAt`, `raw` but is missing `userId` and `workspaceId`.

**Action:** Add two rows to the table, after the `sessionId` row:

| Target field | Source | Fallback |
|---|---|---|
| `userId` | `raw.userId` or `raw.user?.id` or `raw.user` (if string) | **Error:** reject message and log error. `userId` is required. |
| `workspaceId` | `raw.workspaceId` or `raw.workspace?.id` | `undefined` (optional) |

Also add after the table:

```markdown
> **Required field:** `userId` is required on `InboundMessage` (per core spec). If normalization cannot extract a user identifier from the raw payload, it must reject the message and log an error. It must not silently assign an anonymous ID without the product opting into that behavior via a custom `normalizationHook`.
```

### Edit 2.3 — Reconcile `RelayInboundSurfaceAdapter` with core's `RelayInboundAdapter` (Contradiction 1)

**Location:** Section 4.9 `RelayInboundSurfaceAdapter`, lines 268-292

**Current:** Defines a separate `RelayInboundSurfaceAdapter` with `receiveRaw()` and `setInboundHandler()`.

**Action:** Rewrite section 4.9 to clarify the relationship:

```markdown
### 4.9 Inbound Adapter Contract

`SurfaceRegistry` implements core's `RelayInboundAdapter` interface:

\```typescript
// From @relay-assistant/core
export interface RelayInboundAdapter {
  onMessage(handler: (message: InboundMessage) => void): void;
  offMessage(handler: (message: InboundMessage) => void): void;
}
\```

Internally, `SurfaceRegistry` also exposes a `receiveRaw()` method for the relay foundation to push raw events:

\```typescript
/**
 * Called by the relay foundation when a raw message arrives.
 * SurfaceRegistry normalizes the raw event into an InboundMessage,
 * then calls the handler registered via onMessage().
 *
 * Flow: relay foundation → receiveRaw(surfaceId, raw) → normalize → InboundMessage → handler
 */
receiveRaw(surfaceId: string, raw: unknown): void;
\```

The `setInboundHandler()` method from earlier drafts is replaced by the standard `onMessage()` / `offMessage()` contract from `RelayInboundAdapter`. Products wire the registry during initialization:

\```typescript
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,   // SurfaceRegistry implements RelayInboundAdapter
  outbound: surfaceRegistry,  // SurfaceRegistry implements RelayOutboundAdapter
});
\```
```

### Edit 2.4 — Add normative outbound routing rule reference (Contradiction 3)

**Location:** Section 8 "Fanout Behavior Detail", after the existing content (after line 399)

**Action:** Add a subsection:

```markdown
### Outbound Routing Rule (normative — matches core spec)

The outbound routing decision is made by core's `runtime.emit()` and delegated to the surfaces layer:

- **Targeted send:** When `OutboundEvent.surfaceId` is present, `surfaceRegistry.send(event)` delivers to exactly one surface.
- **Session fanout:** When `OutboundEvent.surfaceId` is absent and `OutboundEvent.sessionId` is present, `surfaceRegistry.fanout(event, attachedSurfaceIds, policy?)` delivers to all session-attached surfaces.
- **Invalid:** When both `surfaceId` and `sessionId` are absent, core's `runtime.emit()` throws `OutboundEventError` before reaching the surfaces layer.

This rule is defined once in `docs/specs/v1-core-spec.md` (section 3.7, `runtime.emit()` contract) and referenced here. Surfaces implements the delivery; core implements the routing decision.
```

### Edit 2.5 — Update `SurfaceRegistry` interface to note adapter implementation (Contradiction 1)

**Location:** Section 4.6 `SurfaceRegistry` interface, lines 187-223

**Action:** Add a JSDoc comment above the interface:

```typescript
/**
 * Central surface management object. Implements both RelayInboundAdapter
 * and RelayOutboundAdapter from @relay-assistant/core, serving as the
 * bridge between the relay foundation and the assistant runtime.
 */
export interface SurfaceRegistry {
  // ... (existing methods unchanged)
}
```

### Edit 2.6 — Append `SPEC_RECONCILED` marker

**Location:** End of file, after `SPEC_READY` on line 459.

**Action:** Append on a new line:

```
SPEC_RECONCILED
```

---

## 3. Stale-Term Cleanup in `docs/specs/v1-sessions-spec.md` and `docs/workflows/v1-workflow-backlog.md`

### Edit 3.1 — Sessions spec: remove legacy "resumed" / "closed" narrative wording

**Location:** `docs/specs/v1-sessions-spec.md`, section 3 "Session Lifecycle", lines 55-56

**Current:**
```
| `suspended` | No activity within TTL; may be resumed. Memory is preserved. |
| `expired` | Permanently closed. Memory may be archived per policy. |
```

**Action:** Replace with:

```
| `suspended` | No activity within TTL; transitions back to `active` via `touch()`. Memory is preserved. |
| `expired` | Terminal state. Memory may be archived per policy. No further transitions. |
```

This removes the words "resumed" and "closed" which conflict with the canonical state vocabulary.

### Edit 3.2 — Sessions spec lifecycle diagram: remove "resume" annotation

**Location:** `docs/specs/v1-sessions-spec.md`, section 3, line 45

**Current:**
```
created ──► active ──► suspended ──► active   (resume)
```

**Action:** Replace with:

```
created ──► active ──► suspended ──► active   (touch)
```

### Edit 3.3 — Workflow backlog: remove "session resumed"

**Location:** `docs/workflows/v1-workflow-backlog.md`, line 292 (WF-7 step 10)

**Current:**
```
10. Simulate second message from web surface → session resumed → fanout to both surfaces
```

**Action:** Replace with:

```
10. Simulate second message from web surface → session reactivated via touch → fanout to both surfaces
```

---

## 4. Post-Reconciliation Source-of-Truth Model

After all edits above are applied, the authority model is:

### Canonical specs are the single source of truth

| Spec | Path | Authority over |
|---|---|---|
| Core v1 | `docs/specs/v1-core-spec.md` | `AssistantDefinition`, `AssistantRuntime`, `InboundMessage`, `OutboundEvent`, `RelayInboundAdapter`, `RelayOutboundAdapter`, lifecycle, `OutboundEventError` |
| Sessions v1 | `docs/specs/v1-sessions-spec.md` | `Session`, `SessionStore`, `SessionStoreAdapter`, `AffinityResolver`, `resolveSession`, lifecycle states |
| Surfaces v1 | `docs/specs/v1-surfaces-spec.md` | `SurfaceRegistry`, `SurfaceConnection`, `SurfaceAdapter`, normalization, fanout, `SurfacePayload`, format hooks |

### Resolved ownership boundaries

| Concern | Owner | Notes |
|---|---|---|
| Inbound normalization (raw → `InboundMessage`) | Surfaces | `SurfaceRegistry.receiveRaw()` normalizes; core receives `InboundMessage` only |
| `userId` extraction | Surfaces (normalization) | Required field; normalization rejects messages without it |
| Outbound routing decision (targeted vs fanout vs error) | Core (`runtime.emit()`) | Core decides; surfaces executes |
| Outbound targeted delivery | Surfaces (`surfaceRegistry.send()`) | Single surface |
| Outbound fanout delivery | Surfaces (`surfaceRegistry.fanout()`) | All session-attached surfaces |
| Session `attachedSurfaces` list | Sessions | Read by core/surfaces for fanout resolution |

### Resolved type contracts

| Type | Key change | Spec |
|---|---|---|
| `InboundMessage` | Added `userId: string`, `workspaceId?: string` | Core |
| `OutboundEvent` | `surfaceId` changed from required to optional | Core |
| `OutboundEventError` | New error type for invalid emit | Core |
| `RelayInboundAdapter` | Handler receives `InboundMessage` (not `raw: unknown`) | Core |
| `RelayOutboundAdapter` | Added optional `fanout()` method | Core |
| `SurfaceRegistry` | Implements both core adapter interfaces | Surfaces |
| Normalization table | Added `userId` and `workspaceId` rows | Surfaces |

### Subordinate documents

All planning docs, workflow docs, consumer guides, and adoption examples are subordinate to the specs above. When they drift, update the subordinate doc — never the spec. The reconciliation rules in `docs/architecture/spec-reconciliation-rules.md` remain the reference for _why_ these changes were made.

---

## Execution Order

| # | Edit | File | Depends on | Parallelizable |
|---|---|---|---|---|
| 1 | 1.1, 1.2 (normalization ownership) | v1-core-spec.md | Nothing | Yes, with 2, 3 |
| 2 | 1.3 (userId/workspaceId) | v1-core-spec.md | Nothing | Yes, with 1, 3 |
| 3 | 1.4, 1.5 (optional surfaceId, OutboundEventError) | v1-core-spec.md | Nothing | Yes, with 1, 2 |
| 4 | 1.6 (outbound routing rule) | v1-core-spec.md | 3 | No |
| 5 | 1.7 (RelayInboundAdapter) | v1-core-spec.md | 1 | No |
| 6 | 1.8 (RelayOutboundAdapter fanout) | v1-core-spec.md | 3 | No |
| 7 | 1.9 (implementation slice) | v1-core-spec.md | 1 | No |
| 8 | 2.1 (SurfaceRegistry implements adapters) | v1-surfaces-spec.md | 5, 6 | No |
| 9 | 2.2 (normalization table) | v1-surfaces-spec.md | 2 | No |
| 10 | 2.3 (reconcile inbound adapter) | v1-surfaces-spec.md | 5 | No |
| 11 | 2.4 (outbound routing rule ref) | v1-surfaces-spec.md | 4 | No |
| 12 | 2.5 (SurfaceRegistry JSDoc) | v1-surfaces-spec.md | 8 | No |
| 13 | 3.1, 3.2 (sessions stale terms) | v1-sessions-spec.md | Nothing | Yes, with 1-3 |
| 14 | 3.3 (backlog stale term) | v1-workflow-backlog.md | Nothing | Yes, with 1-3 |
| 15 | 1.10 (SPEC_RECONCILED core) | v1-core-spec.md | 1-7 | No |
| 16 | 2.6 (SPEC_RECONCILED surfaces) | v1-surfaces-spec.md | 8-12 | No |

In practice, since one agent applies all edits sequentially, the ordering is: core edits (1.1-1.10), then surfaces edits (2.1-2.6), then stale-term cleanup (3.1-3.3).

---

CANONICAL_SPEC_FIX_PLAN_READY
