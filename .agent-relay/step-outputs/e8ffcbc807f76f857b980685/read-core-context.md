---README---
# Relay Agent Assistant

Shared open-source assistant SDK/runtime for AgentWorkforce products such as Sage, MSD, NightCTO, and future assistants.

## What This Repo Is

This repository defines the shared assistant layer that sits above Relay foundation infrastructure and below product-specific assistants.

It exists to centralize assistant concerns that should not be reimplemented in every product:

- assistant identity and runtime composition
- memory contracts and shared retrieval/persistence patterns
- session continuity across surfaces
- proactive behavior and scheduled follow-up engines
- multi-agent coordination behind one assistant identity
- policy, approvals, and audit hooks

This repo is intentionally docs-first. It establishes package boundaries, adoption guidance, and extraction order before implementation code is introduced.

Connectivity is one of the sharper early package candidates because internal assistant communication needs stronger rules than generic chatter. The package spike is documented here:

-  onnectivity package README](packages/connectivity/README.md)
-  onnectivity package spec](docs/architecture/connectivity-package-spec.md)
-  onnectivity adoption guide](docs/consumer/connectivity-adoption-guide.md)
-  onnectivity patterns research](docs/research/connectivity-patterns.md)

## What Consumers Should Expect

Products should eventually import focused SDK packages from this repo, for example:

- `@relay-assistant/core`
- `@relay-assistant/memory`
- `@relay-assistant/proactive`
- `@relay-assistant/sessions`
- `@relay-assistant/surfaces`
- `@relay-assistant/coordination`
- `@relay-assistant/connectivity`
- `@relay-assistant/routing`
- `@relay-assistant/policy`

Products such as Sage, MSD, and NightCTO should use this repo for reusable assistant runtime behavior while keeping their own domain logic, prompts, tools, UI, and product policy in their own repositories.

## Layer Model

### Relay foundation stays elsewhere

Keep these concerns in Relay family repos such as `relay`, `gateway`, `relaycron`, `relayauth`, and `relayfile`:

- transport adapters and webhook verification
- normalized inbound/outbound message primitives
- channel/session transport substrate
- auth and connection wiring
- low-level action dispatch
- scheduler and wake-up infrastructure
- relaycast and transport observability

### Assistant SDK lives here

This repo should own reusable assistant behavior built on top of Relay primitives:

- assistant construction and lifecycle
- memory scopes and adapters
- proactive engines and watch rules
- assistant session models
- assistant-facing surface contracts
- specialist coordination
- action policy and audit integration

### Product logic stays in product repos

Keep these concerns in Sage, MSD, NightCTO, and future product repositories:

- prompts and persona details beyond baseline identity fields
- product-specific workflows and tools
- domain-specific watchers and automations
- product UX and dashboards
- pricing, tiering, escalation, and customer policy

## Package Map

| Package | Purpose |
| --- | --- |
| `@relay-assistant/core` | Assistant definition, lifecycle, shared runtime composition |
| `@relay-assistant/memory` | Memory scopes, stores, retrieval, promotion, compaction hooks |
| `@relay-assistant/proactive` | Follow-up engines, watch rules, scheduler bindings |
| `@relay-assistant/sessions` | Cross-surface session identity, resume, attachment rules |
| `@relay-assistant/surfaces` | Assistant-facing surface abstractions above Relay transport |
| `@relay-assistant/coordination` | Coordinator/specialist orchestration and synthesis contracts |
| `@relay-assistant/connectivity` | Efficient inter-agent signaling, convergence, escalation, and communication contracts |
| `@relay-assistant/routing` | Model-choice, latency/depth/cost routing, and workload-router-aligned assistant policy |
| `@relay-assistant/policy` | Approvals, external-action safeguards, audit hooks |
| `@relay-assistant/examples` | Reference adoption examples, not production product code |

## Read This First

- [Docs index](docs/index.md)
- [Package boundary map](docs/architecture/package-boundary-map.md)
-  onnectivity package spec](docs/architecture/connectivity-package-spec.md)
- [Extraction roadmap](docs/architecture/extraction-roadmap.md)
- [OSS vs cloud split](docs/architecture/oss-vs-cloud-split.md)
- [How to build an assistant](docs/consumer/how-to-build-an-assistant.md)
- [How products should adopt this SDK](docs/consumer/how-products-should-adopt-relay-agent-assistant.md)
-  onnectivity adoption guide](docs/consumer/connectivity-adoption-guide.md)
-  onnectivity patterns research](docs/research/connectivity-patterns.md)
- [Internal system comparison](docs/research/internal-system-comparison.md)
- [Glossary](docs/reference/glossary.md)

## Current Status

Current repo state:

- no implementation packages yet
- no product code extracted yet
- docs define target package boundaries and migration order
- most package directories currently contain README placeholders only

## Implementation Direction

This repository should become the OSS core.

A later cloud implementation should be built on top of the OSS SDK in a separate package or repo, similar in spirit to other AgentWorkforce properties that keep the reusable core open-source and place Cloudflare-backed adapters and hosted infrastructure in a distinct cloud layer.

That later cloud layer should depend on this SDK, not replace it.

## Initial Adoption Rule

If a capability is reusable across multiple assistants with only configuration or adapter changes, it belongs here.

If a capability depends on product-specific ontology, customer workflow, or product policy, it stays in the product repo.

DOCS_FIRST_SCAFFOLD_READY

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

---SPEC PROGRAM PLAN---
# Spec Program Plan

Date: 2026-04-11
Revised: 2026-04-11 (post spec-reconciliation-rules — API vocabulary and file paths aligned to canonical specs)

> **Canonical source of truth:** Package specs in `docs/specs/` override this document. See `docs/architecture/spec-reconciliation-rules.md` for the full replacement table and contradiction resolutions.

## Goal

Move relay-agent-assistant from docs-first scaffold to consumable SDK by end of weekend (2026-04-13).

Sage, MSD, and NightCTO should be able to install `@relay-assistant/core`, `@relay-assistant/sessions`, and `@relay-assistant/surfaces` by Sunday night, with type contracts stable enough to write product adapter code against.

> **Note on "npm install" (Rule 5):** For v1, installation means local monorepo consumption via workspace references (e.g., `"@relay-assistant/core": "workspace:*"`) or `npm pack` tarballs. Packages are **not** published to the npm registry this weekend. Public npm publishing is a post-v1 task tracked separately.

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

> **v1 exception (Rule 4):** For v1, workflow documents in `docs/workflows/` are parallel planning artifacts, not sequential gates. The specs are the implementation gates. Code may be written directly against specs without a workflow document existing first. Workflow documents may be written retroactively. This exception applies only to v1; for v1.1 and later the full Doc → Spec → Workflow → Code pipeline resumes.

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

> **Note on spec status:** `docs/specs/v1-memory-spec.md` and `docs/specs/v1-connectivity-spec.md` are already marked `IMPLEMENTATION_READY` as of 2026-04-11. These specs were authored speculatively ahead of the implementation milestone. The implementation milestone for these packages remains v1.1; the specs existing early is expected and does not change the version gate.

Packages:

| Package | Stage entering v1.1 | Exit criteria |
| --- | --- | --- |
| `@relay-assistant/memory` | doc + spec (ahead of milestone) | workflows + code |
| `@relay-assistant/connectivity` | doc + spec (ahead of milestone) | workflows + code |

v1.1 success means: assistants can persist and retrieve memory across sessions, and multi-component assistants can exchange focused coordination signals.

### v1.2 — Proactive, Coordination, and Routing (follows v1.1)

> **Note on spec status:** `docs/specs/v1-routing-spec.md` is already marked `IMPLEMENTATION_READY` as of 2026-04-11. As with memory and connectivity, the spec existing early does not move the implementation milestone. The implementation milestone for routing remains v1.2. Proactive and coordination specs are not yet written.

Packages:

| Package | Stage entering v1.2 | Exit criteria |
| --- | --- | --- |
| `@relay-assistant/proactive` | doc | spec + workflows + code |
| `@relay-assistant/coordination` | doc | spec + workflows + code |
| `@relay-assistant/routing` | doc + spec (ahead of milestone) | workflows + code |

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

The following three specs are written and marked `IMPLEMENTATION_READY`. They are the canonical implementation reference for all v1 code.

| Spec | Path | Status |
| --- | --- | --- |
| core v1 | `docs/specs/v1-core-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |
| sessions v1 | `docs/specs/v1-sessions-spec.md` | IMPLEMENTATION_READY |
| surfaces v1 | `docs/specs/v1-surfaces-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |

> **Pre-implementation gate:** Three cross-package contradictions identified in `docs/architecture/spec-reconciliation-rules.md` (Contradictions 1–3) have been resolved in the specs (both `docs/specs/v1-core-spec.md` and `docs/specs/v1-surfaces-spec.md` are marked `SPEC_RECONCILED`). Specifically:
> - **Contradiction 1** (`docs/specs/v1-core-spec.md` + `docs/specs/v1-surfaces-spec.md`): **Resolved.** Surfaces owns inbound normalization. `RelayInboundAdapter` accepts `InboundMessage`. Core section 1 no longer claims inbound normalization ownership.
> - **Contradiction 2** (`docs/specs/v1-core-spec.md`): **Resolved.** `userId` (required) and `workspaceId?` (optional) are present on `InboundMessage` in core spec §3.3.
> - **Contradiction 3** (`docs/specs/v1-core-spec.md` + `docs/specs/v1-surfaces-spec.md`): **Resolved.** `OutboundEvent.surfaceId` is optional; `OutboundEventError` is defined; the targeted-send vs. session-fanout normative rule is documented in both specs.
>
> All eight checklist actions in `docs/architecture/spec-reconciliation-rules.md` are complete. WF-1 implementation may begin.

### Spec 1: `docs/specs/v1-core-spec.md`

Must define:

- `createAssistant(definition, adapters)` factory signature: takes `AssistantDefinition` and `{ inbound: RelayInboundAdapter, outbound: RelayOutboundAdapter }`; returns `AssistantRuntime`
- `AssistantDefinition` type: `id`, `name`, `description?`, `capabilities` (`Record<string, CapabilityHandler>`), `hooks?` (`AssistantHooks`), `constraints?` (`RuntimeConstraints`)
- `AssistantRuntime` interface: lifecycle (`start`, `stop`), dispatch (`runtime.dispatch(message)`), emit (`runtime.emit(event)`), subsystem registration (`runtime.register(name, subsystem)` / `runtime.get<T>(name)`), health (`runtime.status()`)
- `InboundMessage` inbound envelope type (Contradiction 2 **resolved**: `userId` required, `workspaceId?` optional — in spec §3.3)
- `OutboundEvent` outbound envelope type (Contradiction 3 **resolved**: `surfaceId?` optional; `OutboundEventError` defined in §3.10)
- `CapabilityHandler` type: `(message: InboundMessage, context: CapabilityContext) => Promise<void> | void`
- `CapabilityContext` type: `{ runtime: AssistantRuntime, log: ContextLogger }`
- `AssistantHooks` type: `onStart`, `onStop`, `onMessage`, `onError`
- `RuntimeConstraints` type: `handlerTimeoutMs?`, `maxConcurrentHandlers?`
- `RuntimeStatus` type: `ready`, `startedAt`, `registeredSubsystems`, `registeredCapabilities`, `inFlightHandlers`
- `RelayInboundAdapter` / `RelayOutboundAdapter` interfaces (Contradiction 1 **resolved**: `RelayInboundAdapter.onMessage` accepts `InboundMessage`, not `raw: unknown` — in spec §4)
- Error types: `AssistantDefinitionError`, `OutboundEventError`
- What core does NOT own: session state, surface I/O, memory, transport, domain logic

### Spec 2: `docs/specs/v1-sessions-spec.md`

Must define:

- `createSessionStore(config)` factory signature: takes `{ adapter: SessionStoreAdapter, defaultTtlMs? }`; returns `SessionStore`
- `SessionStore` interface: `create`, `get`, `find`, `touch`, `attachSurface`, `detachSurface`, `expire`, `sweepStale`, `updateMetadata`
- `Session` type: `id`, `userId`, `workspaceId?`, `state`, `createdAt`, `lastActivityAt`, `stateChangedAt?`, `attachedSurfaces`, `metadata`
- `SessionState` union: `'created' | 'active' | 'suspended' | 'expired'`
- Session lifecycle: `created → active → suspended → expired` (no `resumed` or `closed` states)
- `touch(sessionId)` — transitions `created` or `suspended` to `active`; updates `lastActivityAt`
- `expire(sessionId)` — transitions any state to `expired`
- `sweepStale(ttlMs)` — caller-driven; marks stale sessions `suspended`
- Surface attachment model: `attachSurface` / `detachSurface`; a session may have multiple attached surfaces
- `AffinityResolver` interface and `resolveSession(message, store, resolver)` utility
- Integration contract with core: `runtime.register('sessions', sessionStore)`
- Error types: `SessionNotFoundError`, `SessionConflictError`, `SessionStateError`

### Spec 3: `docs/specs/v1-surfaces-spec.md`

Must define:

- `createSurfaceRegistry(config?)` factory signature; returns `SurfaceRegistry`
- `SurfaceConnection` type: `id`, `type`, `state`, `capabilities`, `adapter`, `formatHook?`
- `SurfaceRegistry` interface: `register`, `unregister`, `get`, `list`, `send`, `fanout`
- `SurfaceAdapter` interface: `send`, `onConnect`, `onDisconnect`
- `SurfaceCapabilities` type: `markdown`, `richBlocks`, `attachments`, `streaming`, `maxResponseLength`
- `SurfacePayload` type: `event`, `formatted`, `surfaceCapabilities`
- `SurfaceFormatHook` type
- `FanoutPolicy` / `FanoutResult` / `FanoutOutcome` types
- Inbound normalization contract: surfaces owns normalization. Flow: relay foundation calls `receiveRaw(surfaceId, raw)` → `SurfaceRegistry` normalizes to `InboundMessage` → handler registered via `RelayInboundAdapter.onMessage()` receives normalized `InboundMessage`. `SurfaceRegistry` implements core's `RelayInboundAdapter` interface (`onMessage` / `offMessage`). Note: `setInboundHandler()` from earlier drafts is superseded by the standard `onMessage`/`offMessage` contract — see `docs/specs/v1-surfaces-spec.md` §4.9.
- Outbound routing normative rule (**resolved** — Contradiction 3; now in both specs):
  - `surfaceId` present → `surfaceRegistry.send(event)` (targeted delivery)
  - `sessionId` present, no `surfaceId` → `surfaceRegistry.fanout(event, session.attachedSurfaces, policy?)` (session fanout)
  - Both absent → `OutboundEventError` thrown by `runtime.emit()`
- Integration contract with core: `surfaceRegistry` wired as both `inbound` and `outbound` relay adapter
- Error types: `SurfaceNotFoundError`, `SurfaceConflictError`, `SurfaceDeliveryError`

## v1 Workflow Backlog

Each workflow is a narrow vertical slice that produces working, testable code. Implement in order. See `docs/workflows/v1-workflow-backlog.md` for the full canonical workflow backlog with detailed acceptance criteria, PR scopes, cross-package notes, and dependency graph.

### WF-1: Define assistant and start runtime

Slice: `core`

Steps:
1. Define an `AssistantDefinition` with `id`, `name`, and a `capabilities` map (`Record<string, CapabilityHandler>`)
2. Call `createAssistant(definition, { inbound: stubAdapter, outbound: stubAdapter })` — returns `AssistantRuntime`
3. Call `runtime.start()` — verify `runtime.status().ready === true`
4. Call `runtime.stop()` — verify runtime is no longer accepting dispatches

Produces: `AssistantDefinition`, `AssistantRuntime`, `createAssistant`, lifecycle state machine, `runtime.status()`.

### WF-2: Handle inbound message via capability dispatch

Slice: `core`

Steps:
1. Create and start a runtime with a `"chat"` capability handler
2. Call `runtime.dispatch(inboundMessage)` where `inboundMessage.capability === "chat"`
3. Runtime invokes the `"chat"` handler with correct `InboundMessage` and `CapabilityContext`
4. Handler calls `context.runtime.emit(outboundEvent)` — verify stub outbound adapter receives the event
5. Verify response envelope is well-formed

Produces: `InboundMessage` / `OutboundEvent` types, capability dispatch table, `runtime.dispatch()`, `runtime.emit()`, `AssistantHooks.onMessage` pre-filter.

### WF-3: Create and manage sessions

Slice: `sessions`

Steps:
1. Create session store: `createSessionStore({ adapter: new InMemorySessionStoreAdapter() })`
2. Call `store.create({ id: uuid(), userId, workspaceId })` — returns `Session` with `state: 'created'`, timestamps
3. Call `store.get(sessionId)` — returns session
4. Call `store.touch(sessionId)` — state transitions to `'active'`, `lastActivityAt` updates
5. Call `store.expire(sessionId)` — state transitions to `'expired'`
6. Call `store.sweepStale(ttlMs)` — stale active sessions transition to `'suspended'`

Produces: `SessionStore`, `Session`, lifecycle transitions (`created → active → suspended → expired`), `InMemorySessionStoreAdapter`.

### WF-4: Wire session store into runtime

Slice: `core` + `sessions`

Steps:
1. Create `AssistantRuntime` and `SessionStore`
2. Call `runtime.register('sessions', sessionStore)` — verify `runtime.status().registeredSubsystems` includes `'sessions'`
3. In capability handler: call `context.runtime.get<SessionStore>('sessions')` — verify it returns the store
4. Use `resolveSession(message, store, defaultAffinityResolver)` — creates or resumes session
5. Session is accessible in message handler context

Produces: `runtime.register()` / `runtime.get()` integration, session-aware capability handling, `resolveSession()` utility.

### WF-5: Register surface registry and route messages

Slice: `core` + `surfaces`

Steps:
1. Create surface registry: `createSurfaceRegistry()`
2. Define `SurfaceConnection` for type `"slack"` with a mock `SurfaceAdapter` and `SurfaceCapabilities`
3. Define `SurfaceConnection` for type `"web"` with different `SurfaceCapabilities`
4. Call `surfaceRegistry.register(connection)` for each
5. Wire registry as relay adapters: `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })`
6. Simulate inbound via `surfaceRegistry.receiveRaw('slack-1', rawPayload)` — normalization produces well-formed `InboundMessage`
7. Runtime dispatches to capability handler; handler calls `context.runtime.emit({ surfaceId: 'slack-1', text: 'response' })`
8. Verify `surfaceRegistry.send()` delivers a `SurfacePayload` to the correct adapter

Produces: `SurfaceRegistry`, `SurfaceConnection`, `SurfaceAdapter`, `SurfaceCapabilities`, inbound normalization, outbound targeted send, connection state management.

### WF-6: Multi-surface session

Slice: `core` + `sessions` + `surfaces`

Steps:
1. Create runtime with sessions and two surfaces (slack + web)
2. User sends message via slack surface — `resolveSession()` creates new session; `store.attachSurface(sessionId, 'slack-1')` called
3. Same userId sends message via web surface — `resolveSession()` returns existing session; `store.attachSurface(sessionId, 'web-1')` called
4. Verify both surface interactions share session state
5. Emit with `surfaceId` set — targeted send to originating surface only
6. Emit with `sessionId` but no `surfaceId` — `surfaceRegistry.fanout()` delivers to all attached surfaces

Produces: cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout outbound rule validated in integration.

### WF-7: End-to-end assembly

Slice: `core` + `sessions` + `surfaces`

Steps:

---EXISTING CORE README---
# `@relay-assistant/core`

Status: placeholder package README, no implementation yet.

## Purpose

This package is intended to be the main entry point for constructing an assistant runtime.

Consumers should expect this package to own:

- assistant definition and identity
- runtime lifecycle
- capability registration
- composition of memory, sessions, surfaces, coordination, proactive behavior, and policy

## Expected Consumer Role

A product should import this package when it needs to define a user-facing assistant.

Illustrative usage target:

```ts
import { createAssistant } from "@relay-assistant/core";
```

The import above is directional only. It documents the intended package boundary.

## What Does Not Belong Here

- provider-specific transport code
- memory backend logic
- product-specific prompts and workflows
- cloud-only operational infrastructure
