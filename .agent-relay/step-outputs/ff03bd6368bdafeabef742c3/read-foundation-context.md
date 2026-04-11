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
[v1-sessions-spec] → WF-3 ─────────────┘            ├──→ WF-6 ──→ WF-7
                                                     │
[v1-surfaces-spec] ──────────────────── WF-5 ────────┘
                                        ↑
                                      (WF-2 for types)
```

Parallelizable once gated tasks are done:
- WF-1 and WF-3 can be written simultaneously — they depend on different specs and different packages
- WF-2 depends on WF-1 completing
- WF-4 and WF-5 can be started in parallel once WF-2 and WF-3 are both done (WF-5 only needs WF-2 for `InboundMessage` / `OutboundEvent` type shapes, not WF-3/4)

---

## Execution Order

| Step | Task | Depends on | Parallelizable with |
| --- | --- | --- | --- |
| 0 | ~~Apply Contradiction 1–3 resolutions to specs~~ — **COMPLETE** (both specs are `SPEC_RECONCILED`; all 8 reconciliation actions done) | — | — |
| 1 | `docs/specs/v1-core-spec.md` — DONE (`SPEC_RECONCILED`) | — | — |
| 2 | `docs/specs/v1-sessions-spec.md` — DONE | — | — |
| 3 | `docs/specs/v1-surfaces-spec.md` — DONE (`SPEC_RECONCILED`) | — | — |
| 4 | Implement WF-1 | core spec | Step 5 (WF-3) |
| 5 | Implement WF-3 | sessions spec | Step 4 (WF-1) |
| 6 | Implement WF-2 | WF-1 | — |
| 7 | Implement WF-4 | WF-2, WF-3 | Step 8 (WF-5) |
| 8 | Implement WF-5 | surfaces spec, WF-2 (types) | Step 7 (WF-4) |
| 9 | Implement WF-6 | WF-4, WF-5 | — |
| 10 | Implement WF-7 | WF-6 | — |
| 11 | Update package READMEs | WF-7 | — |
| 12 | Tag v1 release | all above | — |

---

## First Implementation Workflow Documents to Write Next

After this backlog document, the next artifacts to produce (as standalone implementation guides) are, in order:

1. `docs/workflows/wf-1-define-assistant.md` — narrow implementation guide for WF-1 with exact type definitions, step-by-step instructions, and acceptance test assertions. An engineer executes this without additional context.
2. `docs/workflows/wf-3-sessions.md` — parallel with wf-1; covers `InMemorySessionStoreAdapter`, full lifecycle including `sweepStale`, and `resolveSession` utility.

---WEEKEND DELIVERY---
# Weekend Delivery Plan

Date: 2026-04-11
Revised: 2026-04-11 (spec-reconciliation pass — all examples updated to match canonical specs; workspace install note added)
Target: 2026-04-13 (Sunday night)

> **Canonical source of truth:** Package specs in `docs/specs/` override any example code in this document. All assembly examples below have been updated to match the reviewed specs and `docs/architecture/spec-reconciliation-rules.md`. If a code example conflicts with a spec, **trust the spec, not this document**.
>
> **npm install note (Rule 5):** For v1, "npm install" means **local monorepo consumption** via workspace references (`"@relay-assistant/core": "workspace:*"`) or `npm pack` tarballs — not the public npm registry. Public publishing is a post-v1 task tracked separately.

## Goal

Sage, MSD, and NightCTO teams can `npm install @relay-assistant/core @relay-assistant/sessions @relay-assistant/surfaces` by Sunday night, with type contracts stable enough to write product adapter code against.

The v1 type contracts that must be stable by Sunday night:

- `AssistantDefinition` (core)
- `AssistantRuntime` (core)
- `InboundMessage` / `OutboundEvent` (core)
- `CapabilityHandler` / `CapabilityContext` (core)
- `Session` / `SessionStore` (sessions)
- `AffinityResolver` / `resolveSession` (sessions)
- `SurfaceRegistry` / `SurfaceConnection` / `SurfaceAdapter` (surfaces)
- `SurfaceCapabilities` / `SurfaceFormatHook` / `FanoutResult` (surfaces)

---

## Timeline

### Saturday Morning (2026-04-12, first half)

**Focus: Confirm specs and scaffold packages**

All three specs are already `IMPLEMENTATION_READY`. Saturday morning is for reading them, confirming there are no implementation blockers, setting up package scaffolding (`package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts`), and writing the first type exports for each package.

| Task | Deliverable | Notes |
| --- | --- | --- |
| Read and confirm core spec | Mental model of `AssistantDefinition`, `AssistantRuntime`, adapters | Block implementation on spec, not on estimate |
| Read and confirm sessions spec | Mental model of `Session`, `SessionStore`, `InMemorySessionStoreAdapter` | Note: `touch`/`expire`, not `resume`/`close` |
| Read and confirm surfaces spec | Mental model of `SurfaceRegistry`, `SurfaceConnection`, fanout vs targeted send | Note: `createSurfaceRegistry()`, not `createSurfaceConnection()` |
| Scaffold `packages/core` | `package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts` (type exports only) | |
| Scaffold `packages/sessions` | same | |
| Scaffold `packages/surfaces` | same | |

Exit criteria for Saturday morning: package shells exist, all spec types are exported with no implementation, TypeScript compiler accepts conforming objects.

---

### Saturday Afternoon (2026-04-12, second half)

**Focus: WF-1, WF-2, WF-3 (core and sessions foundations)**

WF-1 and WF-3 can be worked simultaneously by two engineers. WF-2 depends on WF-1 completing.

| Workflow | Package | Key output |
| --- | --- | --- |
| WF-1: Define assistant and start runtime | core | `createAssistant`, `AssistantDefinition` validation, `AssistantRuntime`, `runtime.start()` / `runtime.stop()`, `runtime.status()` |
| WF-2: Handle inbound message via dispatch | core | Capability dispatch table, `runtime.dispatch()`, `AssistantHooks.onMessage` pre-filter, `runtime.emit()` |
| WF-3: Create and manage sessions | sessions | `createSessionStore`, `InMemorySessionStoreAdapter`, full lifecycle (`touch`, `expire`, `sweepStale`), `attachSurface`, `detachSurface`, `resolveSession` |

Exit criteria for Saturday afternoon: WF-1, WF-2, and WF-3 all passing tests, committed.

---

### Saturday Evening / Sunday Morning (2026-04-12 evening – 2026-04-13 morning)

**Focus: WF-4 and WF-5 (integration)**

WF-4 and WF-5 can be worked in parallel. WF-5 needs `InboundMessage` / `OutboundEvent` types from WF-2, but does not need WF-3 or WF-4.

| Workflow | Packages | Key output |
| --- | --- | --- |
| WF-4: Wire session store into runtime | core + sessions | `runtime.register('sessions', store)`, `runtime.get<SessionStore>('sessions')`, `resolveSession` in handler |
| WF-5: Register surface registry and route messages | core + surfaces | `createSurfaceRegistry`, `SurfaceConnection`, adapter wiring as core relay adapters, inbound normalization, outbound targeted send, `formatHook` |

> **WF-5 cross-package note:** WF-5 requires surfaces to implement `RelayInboundAdapter` and `RelayOutboundAdapter` as defined in the core spec. The surfaces `SurfaceRegistry` implements both. Wire them at `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })`.

Exit criteria: WF-4 and WF-5 all passing tests, committed.

---

### Sunday Afternoon (2026-04-13 afternoon)

**Focus: WF-6 and WF-7 (cross-package integration and final assembly)**

| Workflow | Packages | Key output |
| --- | --- | --- |
| WF-6: Multi-surface session fanout | core + sessions + surfaces | Cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout rule validated |
| WF-7: End-to-end assembly | core + sessions + surfaces | Full inbound→session→handler→emit→format→adapter cycle, validated assembly, updated READMEs |

Exit criteria: WF-6 and WF-7 passing, READMEs updated, v1 tag prepared.

---

### Sunday Night (2026-04-13)

**Focus: Consumer readiness verification**

Each product team runs the consumer readiness checklist against the released packages:

- [ ] `npm install @relay-assistant/core @relay-assistant/sessions @relay-assistant/surfaces` (resolves via workspace protocol or local tarballs — not the public npm registry for v1)
- [ ] Define an assistant with `createAssistant(definition, adapters)` where `definition.capabilities` is `Record<string, CapabilityHandler>`
- [ ] Wire a `SessionStore` via `runtime.register('sessions', createSessionStore({ adapter }))`
- [ ] Register surfaces via `createSurfaceRegistry()` and wire it as the core relay adapter pair
- [ ] Handle `InboundMessage` through capability dispatch and emit `OutboundEvent` via `context.runtime.emit()`
- [ ] Return formatted responses to the originating surface via targeted send or fanout
- [ ] Write product adapter code against stable v1 types
- [ ] Run the SDK's own tests to verify correct integration

Tag v1 release once all checks pass.

---

## Product-Specific Adoption Paths

### Sage Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. Draft a memory adapter interface stub so v1.1 memory integration can start Monday.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define the Sage assistant identity using `createAssistant()`. Wire `createSessionStore({ adapter: new InMemorySessionStoreAdapter() })`. Register a Slack `SurfaceConnection` in a `SurfaceRegistry`. |
| Immediate after v1 | Begin adapter stub for `@relay-assistant/memory` (v1.1). Sage's existing memory patterns are the primary signal for the memory spec. |
| v1.1 gates | Full memory persistence across Sage sessions. Proactive follow-up engine. |

**Sage v1 minimum viable assembly:**

```ts
import { createAssistant } from "@relay-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@relay-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@relay-assistant/sessions";
import type { SessionStore } from "@relay-assistant/sessions";
import { createSurfaceRegistry } from "@relay-assistant/surfaces";
import type { SurfaceConnection, SurfaceCapabilities } from "@relay-assistant/surfaces";

// 1. Define the Sage assistant
const definition: AssistantDefinition = {
  id: "sage",
  name: "Sage",
  capabilities: {
    chat: async (message: InboundMessage, context: CapabilityContext) => {
      // Resolve or create a session for this user
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);

      // Sage domain handler — product-owned logic
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "...", // Sage-specific response
      });
    },
  },
};

// 2. Wire sessions
const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

// 3. Wire surfaces (relay foundation provides real SurfaceAdapter implementations)
const slackCapabilities: SurfaceCapabilities = {
  markdown: false,
  richBlocks: true,
  attachments: true,
  streaming: false,
  maxResponseLength: 3000,
};

const slackConnection: SurfaceConnection = {
  id: "sage-slack",
  type: "slack",
  state: "registered",
  capabilities: slackCapabilities,
  adapter: stubSlackAdapter, // provided by relay foundation or product code
  formatHook: (event, caps) => ({ blocks: [{ type: "section", text: event.text }] }),
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);

// 4. Create runtime and register subsystems
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});
runtime.register("sessions", sessionStore);

await runtime.start();
```

**What stays in Sage for now:**
- Knowledge and workspace-specific prompt behavior
- Product-specific follow-up heuristics
- Slack-specific UI conventions and block kit templates
- Memory retrieval logic (until v1.1 `@relay-assistant/memory` ships)

---

### MSD Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. MSD's cross-surface session design maps directly onto the v1 session model. Focus on the Slack + web multi-surface path.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define the MSD assistant identity. Wire session store. Register Slack and web surface connections in the surface registry. |
| After v1 | Stub `@relay-assistant/policy` interface for approval-mode scaffolding (policy ships in v2 but MSD can define the interface contract early as a passthrough). |
| v1.2 gates | Coordination for review orchestration. Policy for external action governance. |

**MSD v1 minimum viable assembly:**

```ts
import { createAssistant } from "@relay-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@relay-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@relay-assistant/sessions";
import type { SessionStore } from "@relay-assistant/sessions";
import { createSurfaceRegistry } from "@relay-assistant/surfaces";
import type { SurfaceConnection } from "@relay-assistant/surfaces";

const definition: AssistantDefinition = {
  id: "msd-review-assistant",
  name: "MSD",
  capabilities: {
    review: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);
      await store.attachSurface(session.id, message.surfaceId);

      // MSD review handler — product-owned logic

      // Targeted send: reply to originating surface (surfaceId present)
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "...", // MSD-specific response
      });

      // Session fanout: notify ALL attached surfaces (surfaceId absent, sessionId present)
      // Use when a cross-surface review event (e.g., PR approved) should reach both Slack and web.
      // await context.runtime.emit({
      //   sessionId: session.id,
      //   text: "PR review complete — notifying all attached surfaces",
      // });
    },
  },
};

const sessionStore = createSessionStore({ adapter: new InMemorySessionStoreAdapter() });

const slackConnection: SurfaceConnection = {
  id: "msd-slack",
  type: "slack",
  state: "registered",
  capabilities: { markdown: false, richBlocks: true, attachments: true, streaming: false, maxResponseLength: 3000 },
  adapter: stubSlackAdapter,
};

const webConnection: SurfaceConnection = {
  id: "msd-web",
  type: "web",
  state: "registered",
  capabilities: { markdown: true, richBlocks: false, attachments: false, streaming: true, maxResponseLength: 0 },
  adapter: stubWebAdapter,
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);
surfaceRegistry.register(webConnection);

const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});
runtime.register("sessions", sessionStore);

await runtime.start();
```

**What stays in MSD for now:**
- Code review operations and PR workflows
- Review-specific orchestration logic
- PR-specific tools and heuristics
- Coordinator delegation (until v1.2 `@relay-assistant/coordination` ships)

---

### NightCTO Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. NightCTO exercises more of the SDK than Sage or MSD, but v1 is still the foundation. Focus on getting the skeleton working with typed session continuity. v1.1 and v1.2 are where NightCTO's depth shows.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define NightCTO assistant identity. Wire session store. Register primary Slack surface connection in the registry. |
| v1.1 gates | Memory for per-client continuity. Connectivity for multi-component flows. These are the next critical gates for NightCTO. |
| v1.2 gates | Proactive monitoring and digests. Coordination for specialist orchestration. Routing for model selection and depth/cost decisions. |

**NightCTO v1 minimum viable assembly:**

```ts
import { createAssistant } from "@relay-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@relay-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@relay-assistant/sessions";
import type { SessionStore } from "@relay-assistant/sessions";
import { createSurfaceRegistry } from "@relay-assistant/surfaces";
import type { SurfaceConnection } from "@relay-assistant/surfaces";

const definition: AssistantDefinition = {
  id: "nightcto",
  name: "NightCTO",
  capabilities: {

---CORE REVIEW---
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

---SESSIONS REVIEW---
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

---SURFACES REVIEW---
# v1 Surfaces Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Package:** `@relay-assistant/surfaces`
**Spec:** `docs/specs/v1-surfaces-spec.md` (SPEC_RECONCILED)
**Plan:** `docs/architecture/v1-surfaces-implementation-plan.md`

---

## Summary

The implementation is well-executed. All required types are present and structurally correct. The factory function, normalization logic, fanout, connection state management, and package boundary constraints are all implemented as specified. The tests cover the critical paths. Six follow-up items are identified below — none are blocking for the WF-5 PR, but three should be addressed before v1 assembly.

---

## 1. Spec Conformance

### 1.1 Type Exports

All types from spec §4 are implemented in `packages/surfaces/src/types.ts` and re-exported from `index.ts`:

| Spec section | Export | Status |
|---|---|---|
| §4.1 | `SurfaceConnection`, `SurfaceType`, `SurfaceState` | ✅ Exact match |
| §4.2 | `SurfaceCapabilities` | ✅ Exact match |
| §4.3 | `SurfaceAdapter` | ✅ Exact match |
| §4.4 | `SurfacePayload` | ✅ Matches (uses `SurfaceOutboundEvent` locally instead of `OutboundEvent` — same shape) |
| §4.5 | `SurfaceFormatHook` | ✅ Exact match |
| §4.6 | `SurfaceRegistry` | ✅ All methods present; see §1.3 for minor deviation |
| §4.7 | `FanoutPolicy` | ✅ Exact match |
| §4.8 | `FanoutResult`, `FanoutOutcome` | ✅ Exact match |
| §4.9–4.10 | Inbound adapter + normalization | ✅ Correctly implemented |
| §4.11 | `SurfaceNotFoundError`, `SurfaceConflictError`, `SurfaceDeliveryError` | ✅ Exact match including `this.name` and `this.cause` |
| §5 | `SurfaceRegistryConfig`, `createSurfaceRegistry` | ✅ Implemented |

Structural types `NormalizedInboundMessage` and `SurfaceOutboundEvent` match `core.InboundMessage` and `core.OutboundEvent` field-for-field. The zero-runtime-import pattern works correctly.

### 1.2 Factory Behavior

- `register()`: conflict check + adapter callback wiring ✅
- `unregister()`: idempotent ✅
- `get()`: returns null for missing ✅
- `list()`: state and type filter ✅
- `send()`: format hook application, SurfaceDeliveryError wrapping ✅
- `fanout()`: concurrent (Promise.all) for `continue`, sequential (for-of) for `abort`, correct FanoutResult construction ✅
- `receiveRaw()`: normalization hook bypass or default extraction ✅
- Default normalization: all field paths from spec §4.10 are implemented, `userId`-missing rejection is correct, `text`-missing warning is correct ✅
- `onMessage()` / `offMessage()`: implemented with a `Set` (correct; avoids duplicates and gives O(1) removal) ✅

### 1.3 Minor Spec Deviations

**`SurfaceRegistry` interface includes `receiveRaw`, `onMessage`, `offMessage`**

The spec's §4.6 `SurfaceRegistry` interface only defines `register`, `unregister`, `get`, `list`, `send`, and `fanout`. The implementation adds `receiveRaw`, `onMessage`, and `offMessage` directly to the `SurfaceRegistry` interface in `types.ts`. This is a pragmatic improvement — products can call `receiveRaw()` without needing to cast the registry. It is a minor deviation but not a problem for v1.

**`normalizationHook` return type extended**

The spec (§5) defines the hook as `(surfaceId, raw) => InboundMessage`. The implementation uses `(surfaceId, raw) => NormalizedInboundMessage | null | undefined`, which allows custom hooks to drop messages by returning null or undefined. This is a sensible extension and should be treated as a deliberate v1 decision. Worth documenting.

**`send()` does not guard against inactive surface state**

Spec OQ-2 states: "Current spec throws" for inactive surfaces targeted via `send()`. The implementation's `send()` does not check `connection.state` — it looks up the connection and attempts delivery regardless of state. The fanout path correctly handles inactive surfaces via `skipInactive`. This is an unresolved open question; see Follow-up F-1 below.

---

## 2. Adapter Integration with Core and Sessions

### 2.1 Core integration

The integration pattern is clean and explicit.

`createSurfaceRegistry()` returns `SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape`. The two shape types are locally defined structural aliases of core's `RelayInboundAdapter` and `RelayOutboundAdapter` — no runtime import of core occurs.

The intended wiring pattern:

```typescript
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,   // satisfies RelayInboundAdapter
  outbound: surfaceRegistry,  // satisfies RelayOutboundAdapter
});
```

is structurally sound. `core.ts` calls `adapters.inbound.onMessage(handler)` on start and `adapters.inbound.offMessage(handler)` on stop; both are implemented. `core.ts` calls `adapters.outbound.send(event)` for targeted delivery and `adapters.outbound.fanout(event, surfaceIds)` for session fanout; both are implemented with the correct signatures.

The compile-time contract assertions in the test file (lines 38–41) confirm structural assignability:

```typescript
const _inboundContractCheck: CoreInboundAdapter = createSurfaceRegistry();
const _outboundContractCheck: CoreOutboundAdapter = createSurfaceRegistry();
```

These checks will catch interface drift at compile time.

### 2.2 Sessions integration

Surfaces does not import sessions at all — confirmed by `package.json` (zero runtime dependencies). The fanout receives `attachedSurfaceIds: string[]` as a parameter, with session-to-surface-ID resolution happening in `core.ts:resolveAttachedSurfaces()` (lines 165–179). The dependency direction is clean: `core → sessions` (for resolution) and `core → surfaces` (for delivery). `surfaces → sessions` dependency is correctly absent.

---

## 3. Test Coverage

### 3.1 Coverage by area

| Area | Plan count | Implemented | Notes |
|---|---|---|---|
| Surface registration | 5 | 5 | ✅ Full |
| Connection state management | 3 | 3 | ✅ Full |
| Inbound normalization + handlers | 6+3 | 7 | `offMessage` test folded into normalization describe; multi-handler test present |
| Outbound targeted send | 4 | 5 | ✅ Extra test for missing surfaceId |
| Outbound delivery errors | 2 | 2 | ✅ Full |
| Fanout | 7 | 6 | Missing concurrency timing test (see F-2) |
| RelayInboundAdapter contract | 3 | folded | Covered in normalization group, no dedicated describe |
| RelayOutboundAdapter contract | 2 | partially | Implicitly covered; no explicit "adapter contract" describe |
| Compile-time contract checks | 1 | 1 | Present at module level, not in a describe block |

### 3.2 Strengths

- All error paths are tested: `SurfaceConflictError`, `SurfaceNotFoundError`, `SurfaceDeliveryError` with cause chain.
- Normalization paths are well-covered: complete payload, missing userId (drop), missing text (warn + empty string), optional field fallbacks, normalization hook override.
- Fanout policy: continue-on-error, abort-on-first-failure, skipInactive=true (default), skipInactive=false (via defaultFanoutPolicy), unknown surface → skipped.
- Connection state lifecycle is covered: registered → active → inactive → active.
- `vi.spyOn(console, 'error')` and `console.warn` are correctly used to assert log side effects.

### 3.3 Gaps

- **No concurrency test** (plan test 27). The plan required timing-based verification that fanout sends overlap in time. Absent. Acceptable for WF-5 but worth adding.
- **No dedicated `RelayInboundAdapter` / `RelayOutboundAdapter` describe blocks** (plan tests 28–32). The coverage exists but is distributed across other describe groups and compile-time checks.
- **Compile-time contract check not inside a `describe` block.** The checks at lines 38–41 run at module load and will cause a TypeScript compile error if the contract drifts, but they are not structured as a named test. Minor organizational issue.

---

## 4. Follow-ups Before v1 Assembly/Integration

### F-1 — Resolve OQ-2: `send()` behavior for inactive surfaces (SHOULD-FIX before assembly)

**Current behavior:** `send()` looks up the connection and attempts delivery regardless of `connection.state`. There is no inactive guard in the targeted send path.

**Spec position:** OQ-2 is unresolved. The spec note says "current spec throws." The fanout path handles inactive via `skipInactive` policy, but targeted send is silent.

**Required action:** Decide and implement. Options: (a) throw `SurfaceDeliveryError` if `connection.state === 'inactive'`; (b) add an `allowInactive` flag to `send()`; (c) document that inactive state is advisory only for direct sends. Whichever is chosen should match the resolution of OQ-2 and be tested.

---

### F-2 — Add concurrency test for fanout (SHOULD-FIX before assembly)

**Current behavior:** Fanout uses `Promise.all` for the `continue` path, which is correct. But there is no test that verifies the concurrent behavior.

**Required action:** Add a timing-based test using `vi.useFakeTimers()` or delay-injecting mock adapters that verifies sends overlap (i.e., all adapter.send() calls are initiated before any resolve). This matches plan test 27.

---

### F-3 — WF-6 integration test (`packages/core/src/core-sessions-surfaces.test.ts`) (MUST before assembly)

The plan (§4, Slice 2) requires a WF-6 integration test in `packages/core/` covering:
- Session accumulates surface references across interactions
- Targeted send routes only to the specified adapter
- Fanout routes to all `session.attachedSurfaces`
- Invalid emit (no surfaceId, no sessionId) throws `OutboundEventError`
- Detach removes surface from fanout targets
- `FanoutResult` structure is correct

This test does not exist yet. It is the primary acceptance gate for v1 surfaces integration and must exist before the assembly step.

---

### F-4 — WF-4 integration test (`packages/core/src/core-sessions.test.ts`) (MUST before assembly)

Carried from sessions review (F-1). This test validates `runtime.register('sessions', store)` → `emit({ sessionId })` → fanout resolution. Required to verify the core fanout path before adding the surfaces layer on top.

---

### F-5 — Export `SessionSubsystem` from core (NICE-TO-HAVE)

Carried from core review (F-2). `SessionSubsystem` is defined as a local type in `core.ts` (lines 29–37). It is not exported. The surfaces package does not need it (fanout receives `string[]`), but exporting it would allow product code to type-check subsystem registrations. Non-blocking for surfaces v1.

---

### F-6 — Document `normalizationHook` null/undefined return (NICE-TO-HAVE)

The spec defines the hook return type as `InboundMessage`. The implementation returns `NormalizedInboundMessage | null | undefined`, where null/undefined drops the message. This is a useful extension but the README does not mention it. Update the README and spec to document this behavior explicitly so product authors know hooks can drop messages.

---

## Verdict

**PASS_WITH_FOLLOWUPS**

The implementation faithfully delivers the surfaces spec for WF-5: all types, the factory, normalization, send, fanout, state management, format hooks, and the adapter contract are correctly implemented. The package boundary (zero runtime imports from core or sessions) is enforced. Tests cover the essential paths.

F-3 (WF-6 integration test) and F-4 (WF-4 integration test) are required before v1 assembly. F-1 (inactive surface handling in `send()`) and F-2 (concurrency test) should be resolved in this same PR or a targeted patch before assembly. F-5 and F-6 are non-blocking.

V1_SURFACES_REVIEW_COMPLETE

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
      drainWaiter.promise,
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting ${STOP_DRAIN_TIMEOUT_MS}ms for in-flight handlers to drain`,
            ),
          );
        }, STOP_DRAIN_TIMEOUT_MS);
      }),
    ]);
  }

  function runNext(): void {
    while (
      lifecycleState === 'started' &&
      inFlightCount < constraints.maxConcurrentHandlers &&
      pendingDispatches.length > 0
    ) {
      const nextDispatch = pendingDispatches.shift();
      if (!nextDispatch) {
        return;
      }

      void executeDispatch(nextDispatch);
    }
  }

  async function executeDispatch(dispatchJob: QueuedDispatch): Promise<void> {
    const { message, resolve, reject } = dispatchJob;

    try {
      const shouldProcess = await frozenDefinition.hooks?.onMessage?.(message);
      if (shouldProcess === false) {
        resolve();
        return;
      }

      const handler = capabilityMap.get(message.capability);
      if (!handler) {

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

---SURFACES TYPES---
export type SurfaceType = 'web' | 'slack' | 'desktop' | 'api' | string;
export type SurfaceState = 'registered' | 'active' | 'inactive';

export interface SurfaceCapabilities {
  markdown: boolean;
  richBlocks: boolean;
  attachments: boolean;
  streaming: boolean;
  maxResponseLength: number;
}

export interface SurfaceOutboundEvent {
  surfaceId?: string;
  sessionId?: string;
  text: string;
  format?: unknown;
}

export interface NormalizedInboundMessage {
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

export interface SurfacePayload {
  event: SurfaceOutboundEvent;
  formatted: unknown;
  surfaceCapabilities: SurfaceCapabilities;
}

export interface SurfaceAdapter {
  send(payload: SurfacePayload): Promise<void>;
  onConnect(callback: () => void): void;
  onDisconnect(callback: () => void): void;
}

export type SurfaceFormatHook = (
  event: SurfaceOutboundEvent,
  capabilities: SurfaceCapabilities,
) => Promise<unknown> | unknown;

export interface SurfaceConnection {
  id: string;
  type: SurfaceType;
  state: SurfaceState;
  capabilities: SurfaceCapabilities;
  adapter: SurfaceAdapter;
  formatHook?: SurfaceFormatHook;
}

export interface FanoutPolicy {
  onError?: 'continue' | 'abort';
  skipInactive?: boolean;
}

export interface FanoutOutcome {
  surfaceId: string;
  status: 'delivered' | 'skipped' | 'failed';
  error?: Error;
}

export interface FanoutResult {
  total: number;
  delivered: number;
  outcomes: FanoutOutcome[];
}

export interface SurfaceRegistryConfig {
  defaultFanoutPolicy?: FanoutPolicy;
  normalizationHook?: (
    surfaceId: string,
    raw: unknown,
  ) => NormalizedInboundMessage | null | undefined;
}

export interface SurfaceRegistry {
  register(connection: SurfaceConnection): void;
  unregister(surfaceId: string): void;
  get(surfaceId: string): SurfaceConnection | null;
  list(filter?: { state?: SurfaceState; type?: SurfaceType }): SurfaceConnection[];
  send(event: SurfaceOutboundEvent): Promise<void>;
  fanout(
    event: SurfaceOutboundEvent,
    attachedSurfaceIds: string[],
    policy?: FanoutPolicy,
  ): Promise<FanoutResult>;
  receiveRaw(surfaceId: string, raw: unknown): void;
  onMessage(handler: (message: NormalizedInboundMessage) => void): void;
  offMessage(handler: (message: NormalizedInboundMessage) => void): void;
}

export class SurfaceNotFoundError extends Error {
  constructor(public readonly surfaceId: string) {
    super(`Surface not found: ${surfaceId}`);
    this.name = 'SurfaceNotFoundError';
  }
}

export class SurfaceConflictError extends Error {
  constructor(public readonly surfaceId: string) {
    super(`Surface already registered: ${surfaceId}`);
    this.name = 'SurfaceConflictError';
  }
}

export class SurfaceDeliveryError extends Error {
  constructor(
    public readonly surfaceId: string,
    cause: Error,
  ) {
    super(`Delivery failed for surface ${surfaceId}: ${cause.message}`);
    this.name = 'SurfaceDeliveryError';
    this.cause = cause;
  }
}

---SURFACES IMPLEMENTATION---
import {
  SurfaceConflictError,
  SurfaceDeliveryError,
  SurfaceNotFoundError,
} from './types.js';
import type {
  FanoutOutcome,
  FanoutPolicy,
  FanoutResult,
  NormalizedInboundMessage,
  SurfaceConnection,
  SurfaceOutboundEvent,
  SurfaceRegistry,
  SurfaceRegistryConfig,
} from './types.js';

type CoreInboundAdapterShape = {
  onMessage(handler: (message: NormalizedInboundMessage) => void): void;
  offMessage(handler: (message: NormalizedInboundMessage) => void): void;
};

type CoreOutboundAdapterShape = {
  send(event: SurfaceOutboundEvent): Promise<void>;
  fanout?(event: SurfaceOutboundEvent, attachedSurfaceIds: string[]): Promise<void>;
};

export function createSurfaceRegistry(
  config: SurfaceRegistryConfig = {},
): SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape {
  const connections = new Map<string, SurfaceConnection>();
  const messageHandlers = new Set<(message: NormalizedInboundMessage) => void>();
  const defaultPolicy: Required<FanoutPolicy> = {
    onError: config.defaultFanoutPolicy?.onError ?? 'continue',
    skipInactive: config.defaultFanoutPolicy?.skipInactive ?? true,
  };

  const registry: SurfaceRegistry = {
    register(connection) {
      if (connections.has(connection.id)) {
        throw new SurfaceConflictError(connection.id);
      }

      connections.set(connection.id, connection);
      connection.adapter.onConnect(() => {
        connection.state = 'active';
      });
      connection.adapter.onDisconnect(() => {
        connection.state = 'inactive';
      });
    },

    unregister(surfaceId) {
      connections.delete(surfaceId);
    },

    get(surfaceId) {
      return connections.get(surfaceId) ?? null;
    },

    list(filter = {}) {
      return [...connections.values()].filter((connection) => {
        if (filter.state && connection.state !== filter.state) {
          return false;
        }

        if (filter.type && connection.type !== filter.type) {
          return false;
        }

        return true;
      });
    },

    async send(event) {
      const surfaceId = event.surfaceId ?? '';
      if (!surfaceId) {
        throw new SurfaceNotFoundError(surfaceId);
      }

      const connection = connections.get(surfaceId);
      if (!connection) {
        throw new SurfaceNotFoundError(surfaceId);
      }

      try {
        const formatted = connection.formatHook
          ? await connection.formatHook(event, connection.capabilities)
          : event.text;

        await connection.adapter.send({
          event,
          formatted,
          surfaceCapabilities: connection.capabilities,
        });
      } catch (error) {
        throw new SurfaceDeliveryError(surfaceId, toError(error));
      }
    },

    async fanout(event, attachedSurfaceIds, policy = {}) {
      const mergedPolicy: Required<FanoutPolicy> = {
        onError: policy.onError ?? defaultPolicy.onError,
        skipInactive: policy.skipInactive ?? defaultPolicy.skipInactive,
      };

      if (mergedPolicy.onError === 'abort') {
        const outcomes: FanoutOutcome[] = [];
        let delivered = 0;

        for (const surfaceId of attachedSurfaceIds) {
          const connection = connections.get(surfaceId);
          if (!connection) {
            outcomes.push({ surfaceId, status: 'skipped' });
            continue;
          }

          if (connection.state === 'inactive' && mergedPolicy.skipInactive) {
            outcomes.push({ surfaceId, status: 'skipped' });
            continue;
          }

          try {
            await registry.send({ ...event, surfaceId });
            outcomes.push({ surfaceId, status: 'delivered' });
            delivered += 1;
          } catch (error) {
            if (error instanceof SurfaceDeliveryError) {
              throw error;
            }

            throw new SurfaceDeliveryError(surfaceId, toError(error));
          }
        }

        return {
          total: attachedSurfaceIds.length,
          delivered,
          outcomes,
        };
      }

      const outcomes = await Promise.all(
        attachedSurfaceIds.map(async (surfaceId): Promise<FanoutOutcome> => {
          const connection = connections.get(surfaceId);
          if (!connection) {
            return { surfaceId, status: 'skipped' };
          }

          if (connection.state === 'inactive' && mergedPolicy.skipInactive) {
            return { surfaceId, status: 'skipped' };
          }

          try {
            await registry.send({ ...event, surfaceId });
            return { surfaceId, status: 'delivered' };
          } catch (error) {
            return {
              surfaceId,
              status: 'failed',
              error: error instanceof Error ? error : toError(error),
            };
          }
        }),
      );

      return {
        total: attachedSurfaceIds.length,
        delivered: outcomes.filter((outcome) => outcome.status === 'delivered').length,
        outcomes,
      };
    },

    receiveRaw(surfaceId, raw) {
      const normalized = config.normalizationHook
        ? config.normalizationHook(surfaceId, raw) ?? null
        : normalizeRawEvent(surfaceId, raw);

      if (!normalized) {
        return;
      }

      for (const handler of messageHandlers) {
        handler(normalized);
      }
    },

    onMessage(handler) {
      messageHandlers.add(handler);
    },

    offMessage(handler) {
      messageHandlers.delete(handler);
    },
  };

  return registry as SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape;
}

function normalizeRawEvent(
  surfaceId: string,
  raw: unknown,
): NormalizedInboundMessage | null {
  if (!surfaceId) {
    console.error('Dropping inbound message because surfaceId is missing');
    return null;
  }

  if (!isRecord(raw)) {
    console.error('Dropping inbound message because raw payload is not an object', {
      surfaceId,
    });
    return null;
  }

  const messageId = getString(raw.messageId) ?? getString(raw.id) ?? crypto.randomUUID();
  const sessionId = getString(raw.sessionId) ?? getNestedString(raw.session, 'id');
  const userId =
    getString(raw.userId) ??
    getNestedString(raw.user, 'id') ??
    (typeof raw.user === 'string' ? raw.user : undefined);
  const workspaceId = getString(raw.workspaceId) ?? getNestedString(raw.workspace, 'id');
  const text = getString(raw.text) ?? getString(raw.content) ?? getString(raw.body) ?? '';
  const receivedAt =
    getString(raw.timestamp) ?? getString(raw.receivedAt) ?? new Date().toISOString();
  const capability = getString(raw.capability) ?? getString(raw.type) ?? 'chat';

  if (!userId) {
    console.error('Dropping inbound message because userId is missing', {
      surfaceId,
      messageId,
    });
    return null;
  }

  if (text.length === 0) {
    console.warn('Inbound message text missing; using empty string', {
      surfaceId,
      messageId,
    });
  }

  return {
    id: messageId,
    surfaceId,
    sessionId,
    userId,
    workspaceId,
    text,
    raw,
    receivedAt,
    capability,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getNestedString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return getString(value[key]);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
