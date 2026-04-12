# Spec Reconciliation Rules

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-11
Triggered by: `docs/architecture/spec-program-review-verdict.md` (FAIL verdict, 2026-04-11)

---

## Rule 0: Package Specs Are the Source of Truth

When any planning document, workflow document, backlog, delivery plan, adoption example, or architecture overview conflicts with a canonical package spec in `docs/specs/`, **the package spec wins**.

Documents subject to this rule (non-exhaustive):

| Document | Path | Role |
|---|---|---|
| Spec Program Plan | `docs/architecture/spec-program-plan.md` | Planning; subordinate to specs |
| V1 Sectioning | `docs/architecture/v1-sectioning-and-priorities.md` | Planning; subordinate to specs |
| V1 Workflow Backlog | `docs/workflows/v1-workflow-backlog.md` | Implementation guide; subordinate to specs |
| Weekend Delivery Plan | `docs/workflows/weekend-delivery-plan.md` | Schedule; subordinate to specs |
| Review Verdict | `docs/architecture/spec-program-review-verdict.md` | Diagnostic; does not override specs |

Canonical specs (authoritative):

| Spec | Path |
|---|---|
| Core v1 | `docs/specs/v1-core-spec.md` |
| Sessions v1 | `docs/specs/v1-sessions-spec.md` |
| Surfaces v1 | `docs/specs/v1-surfaces-spec.md` |
| Memory v1 | `docs/specs/v1-memory-spec.md` |
| Connectivity v1 | `docs/specs/v1-connectivity-spec.md` |
| Routing v1 | `docs/specs/v1-routing-spec.md` |

If a spec itself contains an internal contradiction, the interface definition (TypeScript block) takes precedence over prose descriptions within the same spec.

---

## Rule 1: Stale API Terms — Full Replacement Table

The following terms appear in planning docs written before the spec review. They are **retired**. Any document or code using a stale term must be updated to the current term before implementation begins.

| Stale term | Current term | Canonical source |
|---|---|---|
| `AssistantConfig` | `AssistantDefinition` | `docs/specs/v1-core-spec.md` section 3.1 |
| `Assistant` (as the live object type) | `AssistantRuntime` | `docs/specs/v1-core-spec.md` section 3.7 |
| `handleMessage(msg)` | `runtime.dispatch(msg)` | `docs/specs/v1-core-spec.md` section 3.7 |
| `assistant.onMessage(handler)` | `AssistantDefinition.capabilities` (`Record<string, CapabilityHandler>`) | `docs/specs/v1-core-spec.md` sections 3.1, 3.2 |
| `AssistantMessage` (single envelope) | `InboundMessage` (inbound) / `OutboundEvent` (outbound) | `docs/specs/v1-core-spec.md` sections 3.3, 3.8 |
| `createSurfaceConnection(config)` | `SurfaceConnection` registered via `createSurfaceRegistry()` | `docs/specs/v1-surfaces-spec.md` sections 4.1, 5 |
| `assistant.attachSurface(surface)` | `surfaceRegistry.register(connection)` | `docs/specs/v1-surfaces-spec.md` section 4.6 |
| `sessions.suspend(id)` | Automatic via `sessionStore.sweepStale(ttlMs)` | `docs/specs/v1-sessions-spec.md` section 4.2 |
| `sessions.resume(id)` | `sessionStore.touch(id)` (transitions `suspended` -> `active`) | `docs/specs/v1-sessions-spec.md` section 4.2 |
| `sessions.close(id)` | `sessionStore.expire(id)` | `docs/specs/v1-sessions-spec.md` section 4.2 |
| Session state `resumed` | Session state `active` (reached via `touch()`) | `docs/specs/v1-sessions-spec.md` section 4.1 |
| Session state `closed` | Session state `expired` | `docs/specs/v1-sessions-spec.md` section 4.1 |
| `docs/specs/core-v1.md` | `docs/specs/v1-core-spec.md` | Actual file path |
| `docs/specs/sessions-v1.md` | `docs/specs/v1-sessions-spec.md` | Actual file path |
| `docs/specs/surfaces-v1.md` | `docs/specs/v1-surfaces-spec.md` | Actual file path |

**Enforcement:** Any PR that introduces a stale term in code, types, tests, or docs must be rejected in review. The v1 sectioning document's API Crosswalk table is the secondary reference; this table is the primary reference.

---

## Rule 2: High-Risk Contradictions Requiring Immediate Resolution

The spec program review identified three cross-package contract conflicts that **must be resolved in the specs before any v1 code is committed**. Each contradiction is stated below with the required resolution.

### Contradiction 1: Inbound normalization ownership

**Conflict:** Core spec says core owns inbound normalization and defines `RelayInboundAdapter` with `onMessage(handler) / offMessage(handler)` over raw events. Surfaces spec says surfaces owns normalization, defines `RelayInboundSurfaceAdapter` with `receiveRaw() / setInboundHandler()`, and the workflow docs wire `surfaceRegistry` directly as the inbound adapter.

**Resolution (must be applied to specs):**

Surfaces owns inbound normalization. The flow is:

```
relay foundation -> surfaceRegistry.receiveRaw(surfaceId, raw) -> normalization -> InboundMessage -> core.dispatch()
```

Required spec changes:
- `docs/specs/v1-core-spec.md`: Remove the claim that core owns inbound normalization (section 1, "Owns" list). Core receives already-normalized `InboundMessage` via `runtime.dispatch()`. The `RelayInboundAdapter` interface in core must be updated to accept `InboundMessage` (not raw events), or core must accept that `surfaceRegistry` implements `RelayInboundAdapter` by normalizing before calling the registered handler.
- `docs/specs/v1-surfaces-spec.md`: Confirm that `SurfaceRegistry` implements `RelayInboundAdapter` from core. The `setInboundHandler` callback receives normalized `InboundMessage`, not raw payloads.
- Both specs must agree on a single adapter interface shape. The recommended shape is:

```typescript
// In core — what core expects to receive
export interface RelayInboundAdapter {
  onMessage(handler: (message: InboundMessage) => void): void;
  offMessage(handler: (message: InboundMessage) => void): void;
}

// SurfaceRegistry implements RelayInboundAdapter:
// - receiveRaw() is called by relay foundation
// - normalization happens inside SurfaceRegistry
// - the registered handler from onMessage() receives InboundMessage
```

### Contradiction 2: Missing identity fields for session resolution

**Conflict:** `InboundMessage` in core spec carries `id`, `surfaceId`, `sessionId?`, `text`, `raw`, `receivedAt`, `capability`. Sessions spec and all workflow/adoption examples depend on `userId` (and sometimes `workspaceId`) being available for `resolveSession()`. There is no canonical `userId` on `InboundMessage`.

**Resolution (must be applied to specs):**

Add `userId` and `workspaceId?` to `InboundMessage` in `docs/specs/v1-core-spec.md`:

```typescript
export interface InboundMessage {
  id: string;
  surfaceId: string;
  sessionId?: string;
  userId: string;           // ADDED — required for session resolution
  workspaceId?: string;     // ADDED — optional; used for scoped session affinity
  text: string;
  raw: unknown;
  receivedAt: string;
  capability: string;
}
```

- `userId` is **required**. Surfaces normalization must extract it from the raw payload (or the relay foundation must provide it). If the raw event does not contain a user identifier, normalization must reject the message or assign a system-generated anonymous ID — this is a normalization-layer decision, not a core decision.
- `workspaceId` is **optional**. Products that scope sessions by workspace provide it; others omit it.
- `resolveSession(message, store, resolver)` in `docs/specs/v1-sessions-spec.md` reads `message.userId` and `message.workspaceId` directly. No separate input contract is needed.

Update the normalization table in `docs/specs/v1-surfaces-spec.md` section 4.10:

| Target field | Source | Fallback |
|---|---|---|
| `userId` | `raw.userId` or `raw.user?.id` or `raw.user` (if string) | Error: reject message; log error |
| `workspaceId` | `raw.workspaceId` or `raw.workspace?.id` | `undefined` |

### Contradiction 3: Outbound targeting — required `surfaceId` vs. fanout

**Conflict:** Core spec defines `OutboundEvent.surfaceId` as required (non-optional string). Surfaces spec, sectioning doc, and workflow backlog all require a fanout case where an event carries `sessionId` but no `surfaceId`, and `surfaceRegistry.fanout()` delivers to all session-attached surfaces.

**Resolution (must be applied to specs):**

Make `surfaceId` optional on `OutboundEvent` in `docs/specs/v1-core-spec.md`:

```typescript
export interface OutboundEvent {
  surfaceId?: string;      // CHANGED from required to optional
  sessionId?: string;
  text: string;
  format?: unknown;
}
```

The normative outbound routing rule (must appear in both core and surfaces specs):

- **Targeted send:** When `surfaceId` is present, use `surfaceRegistry.send(event)`. Delivers to exactly one surface.
- **Session fanout:** When `surfaceId` is absent and `sessionId` is present, the caller must resolve `session.attachedSurfaces` and call `surfaceRegistry.fanout(event, attachedSurfaceIds, policy?)`. Delivers to all attached surfaces per `FanoutPolicy`.
- **Invalid:** When both `surfaceId` and `sessionId` are absent, `runtime.emit()` must throw an `OutboundEventError` (new error type to add to core).

This rule must be stated once in `docs/specs/v1-core-spec.md` (in the `runtime.emit()` contract) and once in `docs/specs/v1-surfaces-spec.md` (in the `SurfaceRegistry.send()` / `SurfaceRegistry.fanout()` contract).

---

## Rule 3: Keeping Weekend Examples Spec-Conformant

All code examples in planning docs, adoption paths, and workflow guides must conform to the canonical specs **after the contradiction resolutions above are applied**. The following rules govern example conformance:

### 3a. Import paths and factory names

Examples must use these exact imports:

```typescript
// Core
import { createAssistant } from "@relay-assistant/core";
import type {
  AssistantDefinition,
  AssistantRuntime,
  InboundMessage,
  OutboundEvent,
  CapabilityHandler,
  CapabilityContext,
} from "@relay-assistant/core";

// Sessions
import {
  createSessionStore,
  InMemorySessionStoreAdapter,  // or createInMemorySessionStoreAdapter()
  resolveSession,
  createDefaultAffinityResolver,
} from "@relay-assistant/sessions";
import type { Session, SessionStore } from "@relay-assistant/sessions";

// Surfaces
import { createSurfaceRegistry } from "@relay-assistant/surfaces";
import type {
  SurfaceConnection,
  SurfaceRegistry,
  SurfaceAdapter,
  SurfaceCapabilities,
  SurfaceFormatHook,
} from "@relay-assistant/surfaces";
```

### 3b. Assembly pattern

The canonical v1 assembly pattern is:

```typescript
// 1. Define
const definition: AssistantDefinition = { id, name, capabilities };

// 2. Create subsystems
const sessionStore = createSessionStore({ adapter });
const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(connection);

// 3. Create runtime with surfaces as relay adapters
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,   // surfaces implements RelayInboundAdapter
  outbound: surfaceRegistry,  // surfaces implements RelayOutboundAdapter
});

// 4. Register subsystems
runtime.register("sessions", sessionStore);

// 5. Start
await runtime.start();
```

Any example that deviates from this pattern must be corrected before it appears in a committed document.

### 3c. Capability handler pattern

Handlers must use current vocabulary:

```typescript
const handler: CapabilityHandler = async (
  message: InboundMessage,
  context: CapabilityContext,
) => {
  // Session resolution uses message.userId (not extracted from raw)
  const store = context.runtime.get<SessionStore>("sessions");
  const session = await resolveSession(message, store, affinityResolver);
  await store.touch(session.id);

  // Outbound: targeted send (surfaceId present)
  await context.runtime.emit({
    surfaceId: message.surfaceId,
    sessionId: session.id,
    text: "response",
  });

  // Outbound: session fanout (surfaceId absent)
  await context.runtime.emit({
    sessionId: session.id,
    text: "broadcast to all session surfaces",
  });
};
```

### 3d. Validation checklist for any new or updated example

Before committing any example code to the repo:

- [ ] All type names match Rule 1 current vocabulary (no stale terms)
- [ ] `InboundMessage` includes `userId` (required) and `workspaceId?` (optional)
- [ ] `OutboundEvent.surfaceId` is treated as optional
- [ ] `surfaceRegistry` is wired as both `inbound` and `outbound` adapter to `createAssistant()`
- [ ] Session resolution uses `resolveSession(message, store, resolver)`, not manual `userId` extraction
- [ ] No references to `handleMessage`, `AssistantConfig`, `createSurfaceConnection`, `sessions.resume`, or `sessions.close`
- [ ] Factory names match: `createAssistant`, `createSessionStore`, `createSurfaceRegistry`
- [ ] If the example touches fanout, it demonstrates the targeted-vs-fanout rule from Contradiction 3 resolution

---

## Rule 4: Workflow Model Reconciliation

The spec program plan states a four-stage pipeline: Doc -> Spec -> Workflow -> Code.

The weekend delivery plan schedules code implementation before workflow documents are written. These are in conflict.

**Resolution:**

For v1, workflow documents in `docs/workflows/` are **parallel planning artifacts**, not sequential gates. The specs are the implementation gates. Code may be written directly against specs without a workflow document existing first.

However:
- Each workflow (WF-1 through WF-7) must still be implemented in the dependency order defined in `docs/workflows/v1-workflow-backlog.md`.
- Each workflow's acceptance criteria (as stated in the backlog) must pass before the next dependent workflow begins.
- Workflow documents may be written retroactively to capture implementation decisions, but they are not required to exist before coding starts during the v1 weekend push.

This exception applies only to v1. For v1.1 and later, the full Doc -> Spec -> Workflow -> Code pipeline resumes.

---

## Rule 5: Release and Adoption Path Clarification

The weekend delivery plan promises `npm install` by Sunday night but marks npm publishing configuration as out of scope.

**Resolution:**

For v1, "npm install" means **local monorepo consumption** via workspace references or `npm pack` tarballs. Packages are not published to the npm registry this weekend.

The consumer readiness checklist item should read:

```
npm install @relay-assistant/core @relay-assistant/sessions @relay-assistant/surfaces
```

...where the install resolves via workspace protocol (e.g., `"@relay-assistant/core": "workspace:*"`) or local file references, not the public npm registry.

Public npm publishing is a post-v1 task and should be tracked separately.

---

## Reconciliation Checklist — Actions Before Code Starts

| # | Action | Owner | Blocked by |
|---|---|---|---|
| 1 | Update `docs/specs/v1-core-spec.md`: remove "owns inbound normalization" from section 1; update `RelayInboundAdapter` to receive `InboundMessage` | Spec author | Nothing |
| 2 | Update `docs/specs/v1-core-spec.md`: add `userId` (required) and `workspaceId?` (optional) to `InboundMessage` | Spec author | Nothing |
| 3 | Update `docs/specs/v1-core-spec.md`: make `OutboundEvent.surfaceId` optional; add `OutboundEventError` for missing both fields | Spec author | Nothing |
| 4 | Update `docs/specs/v1-core-spec.md`: add normative outbound routing rule to `runtime.emit()` contract | Spec author | Action 3 |
| 5 | Update `docs/specs/v1-surfaces-spec.md`: confirm `SurfaceRegistry` implements core's `RelayInboundAdapter`; add `userId`/`workspaceId` to normalization table | Spec author | Action 1, 2 |
| 6 | Update `docs/specs/v1-surfaces-spec.md`: add normative outbound routing rule reference | Spec author | Action 3 |
| 7 | Update all adoption examples in `docs/workflows/weekend-delivery-plan.md` to match resolved contracts | Delivery plan author | Actions 1-6 |
| 8 | Search all docs for stale terms in Rule 1 table; replace with current terms | Any contributor | Nothing |

All eight actions must be completed before WF-1 implementation begins. Actions 1-3 have no dependencies and can be done in parallel. Actions 4-6 depend on 1-3. Actions 7-8 can proceed once 1-6 are done.

---

SPEC_RECONCILIATION_RULES_READY
