---RECONCILIATION RULES---
# Spec Reconciliation Rules

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

---RECONCILIATION REVIEW VERDICT---
# Spec Reconciliation Review Verdict

Date: 2026-04-11
Reviewer: non-interactive reviewer agent
Scope:
- `docs/architecture/spec-reconciliation-rules.md`
- `docs/architecture/spec-program-plan.md`
- `docs/architecture/v1-sectioning-and-priorities.md`
- `docs/workflows/v1-workflow-backlog.md`
- `docs/workflows/weekend-delivery-plan.md`
- `docs/consumer/how-to-build-an-assistant.md`
- `docs/specs/v1-core-spec.md`
- `docs/specs/v1-sessions-spec.md`
- `docs/specs/v1-surfaces-spec.md`
- `docs/specs/v1-memory-spec.md`
- `docs/specs/v1-connectivity-spec.md`
- `docs/specs/v1-routing-spec.md`

## Verdict

FAIL

## Summary

The reconciliation is not complete. The planning and consumer docs were updated to the intended post-reconciliation contract, but the canonical v1 specs still retain the pre-reconciliation contract in several critical places. Because `docs/specs/` are explicitly the source of truth, the docs set is not yet trustworthy as a reconciled whole.

## Findings

### 1. Stale API names

Mostly yes at the naming layer, but not fully clean.

- The obvious stale API names are largely gone from the reviewed planning, workflow, and consumer docs. The crosswalk and replacement guidance are clear in:
  - `docs/architecture/spec-reconciliation-rules.md`
  - `docs/architecture/v1-sectioning-and-priorities.md`
  - `docs/consumer/how-to-build-an-assistant.md`
- One stale state term still appears in active workflow prose:
  - `docs/workflows/v1-workflow-backlog.md:292` says "session resumed" even though the canonical state model is `created | active | suspended | expired`.
- The sessions spec still uses legacy narrative wording:
  - `docs/specs/v1-sessions-spec.md:55-56` says "may be resumed" and "Permanently closed". Those are not API identifiers, but they reintroduce old vocabulary the reconciliation was meant to remove.

Assessment: stale API identifiers are mostly removed, but the docs are not fully scrubbed.

### 2. Planning docs vs specs

No. The planning docs do not currently match the specs.

The planning docs consistently assume the contradiction resolutions are the intended implementation target:

- `InboundMessage` should include `userId` and `workspaceId?`
- `OutboundEvent.surfaceId` should be optional
- `runtime.emit()` should throw `OutboundEventError` when both `surfaceId` and `sessionId` are absent
- surfaces should own inbound normalization
- `SurfaceRegistry` should act as core's inbound/outbound adapter pair

But the canonical specs still disagree:

- Core still claims ownership of inbound normalization:
  - `docs/specs/v1-core-spec.md:19`
- Core `InboundMessage` still lacks `userId` and `workspaceId?`:
  - `docs/specs/v1-core-spec.md:92-117`
- Core `OutboundEvent.surfaceId` is still required:
  - `docs/specs/v1-core-spec.md:220-235`
- Core `RelayInboundAdapter` still accepts `raw: unknown` rather than `InboundMessage`:
  - `docs/specs/v1-core-spec.md:267-272`
- Core first implementation slice still says core normalizes raw events:
  - `docs/specs/v1-core-spec.md:348-351`
- Surfaces still defines a separate `RelayInboundSurfaceAdapter` / `setInboundHandler()` shape instead of clearly adopting the core adapter contract:
  - `docs/specs/v1-surfaces-spec.md:268-292`
- Surfaces normalization table still omits `userId` and `workspaceId`:
  - `docs/specs/v1-surfaces-spec.md:299-306`

The planning docs are internally consistent with the reconciliation rules, but they are ahead of the specs rather than aligned with them. Since the specs win, this is a hard failure.

### 3. Sage / MSD / NightCTO example credibility

Partially improved, but not implementation-credible yet against the actual source of truth.

What improved:

- The examples now use the new names and the intended assembly pattern:
  - `createAssistant(...)`
  - `AssistantDefinition`
  - `createSessionStore(...)`
  - `createSurfaceRegistry()`
  - `runtime.register("sessions", sessionStore)`
- The examples in `docs/workflows/weekend-delivery-plan.md` and `docs/consumer/how-to-build-an-assistant.md` are coherent with the intended reconciled design.

Why they are still not credible enough:

- They call `resolveSession(message, ...)` as if `message.userId` exists, but the core spec does not define that field yet.
- They wire `surfaceRegistry` as `inbound` and `outbound`, but the core spec still defines inbound delivery as raw-event based.
- They rely on targeted-send/fanout semantics that the core spec still does not canonically express.

That means the examples are credible only against the proposed future contract, not against the current canonical specs. For implementation planning, that is not sufficient.

### 4. Weekend workflow backlog trustworthiness

Not yet trustworthy as an execution artifact.

The backlog is well-structured and much improved, but it explicitly depends on reconciliation work that has not actually landed in the specs:

- `docs/workflows/v1-workflow-backlog.md:24-41` marks contradiction-resolution actions as pending.
- WF-1, WF-2, WF-5, WF-6, and WF-7 all assume the post-reconciliation contracts:
  - `docs/workflows/v1-workflow-backlog.md:80`
  - `docs/workflows/v1-workflow-backlog.md:108-112`
  - `docs/workflows/v1-workflow-backlog.md:200-205`
  - `docs/workflows/v1-workflow-backlog.md:248-267`
  - `docs/workflows/v1-workflow-backlog.md:289-309`

The document is honest about the pending gate, but that means it is not yet trustworthy for immediate implementation. It is a good target-state backlog, not a currently executable one.

### 5. Remaining follow-ups

Required follow-ups before this can pass:

1. Update `docs/specs/v1-core-spec.md` to complete Contradictions 1-3.
   - Remove core ownership of inbound normalization.
   - Add `userId: string` and `workspaceId?: string` to `InboundMessage`.
   - Make `OutboundEvent.surfaceId` optional.
   - Define `OutboundEventError`.
   - Change `RelayInboundAdapter` to normalized `InboundMessage`.
   - Update the implementation-slice language so core no longer normalizes raw events.

2. Update `docs/specs/v1-surfaces-spec.md` to match the reconciled adapter contract.
   - Explicitly state that `SurfaceRegistry` implements core's inbound/outbound adapter interfaces.
   - Reconcile `RelayInboundSurfaceAdapter` / `setInboundHandler()` with the core adapter shape, or remove the parallel contract.
   - Add `userId` and `workspaceId` to the normalization table and state required behavior when `userId` is missing.
   - State the same targeted-send vs session-fanout normative rule as core.

3. Re-run the stale-term sweep after the spec edits.
   - Remove "session resumed" from `docs/workflows/v1-workflow-backlog.md:292`.
   - Replace legacy narrative wording in `docs/specs/v1-sessions-spec.md:55-56` so the prose no longer reintroduces "resumed" / "closed".

4. Only after the spec edits land, re-validate the consumer examples and weekend plan against the updated specs.

## Direct Answers

1. Are stale API names gone?
   Mostly, but not completely.

2. Do the planning docs now match the specs?
   No.

3. Are Sage/MSD/NightCTO examples implementation-credible now?
   Not against the current canonical specs.

4. Is the weekend workflow backlog now trustworthy?
   Not yet; it is blocked on spec reconciliation actually landing in `docs/specs/`.

5. What follow-ups remain, if any?
   Core and surfaces spec edits are still required, followed by one more stale-term cleanup pass and a final re-review.

Artifact produced:
- `docs/architecture/spec-reconciliation-review-verdict.md`

SPEC_RECONCILIATION_REVIEW_COMPLETE

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
- Wire `RelayInboundAdapter.onMessage` to normalize raw events into `InboundMessage` and route to the correct handler.
- Tests: mock adapter pushes a raw event; correct handler is called with correct `InboundMessage`.

**Step 4 — `runtime.dispatch()` (test path)**
- Implement direct dispatch bypassing the relay adapter.
- Tests: dispatch a synthetic message; handler is called; `onMessage` hook can drop it.

**Step 5 — `runtime.emit()` integration**
- Call `RelayOutboundAdapter.send()` with the `OutboundEvent`.
- Tests: mock outbound adapter receives correct event structure.


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

---WORKFLOW BACKLOG---
# V1 Workflow Backlog

Date: 2026-04-11
Revised: 2026-04-11 (post spec-program-review-verdict and spec-reconciliation-rules — aligned to canonical spec vocabulary; fanout/targeting rules and cross-package ownership clarified)

> **Canonical source of truth:** Package specs in `docs/specs/` override this document when there is drift. This backlog was updated to align with `docs/specs/v1-core-spec.md`, `docs/specs/v1-sessions-spec.md`, and `docs/specs/v1-surfaces-spec.md` after the spec program review and reconciliation rules pass on 2026-04-11.

## Purpose

This document is the canonical ordered backlog of implementation workflows for v1. Each workflow is a narrow, PR-sized vertical slice through one or more packages. Workflows produce working, testable code and are the unit of implementation work.

Implement in order. Each workflow gates the next unless explicitly noted as parallelizable.

---

## Pre-Workflow: Reconciliation Phase (Required — block on this before WF-1)

### Spec Phase

Three spec documents are finalized and marked `IMPLEMENTATION_READY`. They are the authoritative implementation reference for all workflow code.

| Spec | Path | Status |
| --- | --- | --- |
| core v1 | `docs/specs/v1-core-spec.md` | IMPLEMENTATION_READY (pending Contradiction 1–3 resolution) |
| sessions v1 | `docs/specs/v1-sessions-spec.md` | IMPLEMENTATION_READY |
| surfaces v1 | `docs/specs/v1-surfaces-spec.md` | IMPLEMENTATION_READY (pending Contradiction 1 resolution) |

### Contradiction Resolutions (Pre-WF-1 gate)

Three cross-package contradictions identified in `docs/architecture/spec-reconciliation-rules.md` must be resolved **in the specs** before any WF-1 code is committed. All eight checklist actions in the reconciliation rules document must be complete.

| Action | Target | Contradiction | Status |
| --- | --- | --- | --- |
| 1 | `docs/specs/v1-core-spec.md`: remove "owns inbound normalization" from §1; update `RelayInboundAdapter` to accept `InboundMessage` (not `raw: unknown`) | 1 — inbound normalization ownership | Pending |
| 2 | `docs/specs/v1-core-spec.md §3.3`: add `userId: string` (required) and `workspaceId?: string` (optional) to `InboundMessage` | 2 — missing identity fields | Pending |
| 3 | `docs/specs/v1-core-spec.md §3.8`: make `OutboundEvent.surfaceId` optional (`surfaceId?`); add `OutboundEventError` | 3 — required surfaceId vs. fanout | Pending |
| 4 | `docs/specs/v1-core-spec.md`: add normative outbound routing rule to `runtime.emit()` contract | 3 | Pending (depends on action 3) |
| 5 | `docs/specs/v1-surfaces-spec.md`: confirm `SurfaceRegistry` implements `RelayInboundAdapter`; add `userId`/`workspaceId` to normalization table §4.10 | 1, 2 | Pending (depends on actions 1, 2) |
| 6 | `docs/specs/v1-surfaces-spec.md`: add normative outbound routing rule reference | 3 | Pending (depends on action 3) |
| 7 | Update adoption examples in `docs/workflows/weekend-delivery-plan.md` to match resolved contracts | all | Pending (depends on 1–6) |
| 8 | Search all docs for stale terms (Rule 1 table); replace with current terms | all | Pending |

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
**Depends on:** `docs/specs/v1-core-spec.md` (after Contradiction 1–3 resolutions applied)
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
**Depends on:** `docs/specs/v1-surfaces-spec.md` (after Contradiction 1 resolution applied), WF-2 (for `InboundMessage` / `OutboundEvent` type shapes)
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

> **Fanout ownership note:** The surfaces package owns fanout delivery. When `runtime.emit()` is called without a `surfaceId`, core resolves the session's `attachedSurfaces` and calls `surfaceRegistry.fanout(event, attachedSurfaceIds, policy?)`. The registry handles concurrent delivery and collects `FanoutResult`. Sessions owns the `attachedSurfaces` list; surfaces owns delivery.

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
10. Simulate second message from web surface → session resumed → fanout to both surfaces
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
