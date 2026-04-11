---SECTIONING---
# V1 Sectioning and Priorities

Date: 2026-04-11
Revised: 2026-04-11 (post spec-program-review-verdict)

> **Canonical source of truth:** Package specs in `docs/specs/` override any planning or workflow document when there is drift. This document aligns with reviewed specs as of 2026-04-11.

## API Crosswalk (old planning vocabulary → current spec vocabulary)

Planning and backlog documents written before the spec review used these names. They have been superseded:

| Old term (planning docs) | Current term (package specs) | Location |
|---|---|---|
| `AssistantConfig` | `AssistantDefinition` | `docs/specs/v1-core-spec.md §3.1` |
| `Assistant` | `AssistantRuntime` | `docs/specs/v1-core-spec.md §3.7` |
| `handleMessage` | `runtime.dispatch()` | `docs/specs/v1-core-spec.md §3.7` |
| `assistant.onMessage(handler)` | capability handler in `AssistantDefinition.capabilities` | `docs/specs/v1-core-spec.md §3.2` |
| `AssistantMessage` (inbound+outbound) | `InboundMessage` / `OutboundEvent` | `docs/specs/v1-core-spec.md §3.3, 3.8` |
| `createSurfaceConnection(...)` | `SurfaceConnection` registered in `createSurfaceRegistry(...)` | `docs/specs/v1-surfaces-spec.md §5` |
| `assistant.attachSurface(...)` | `surfaceRegistry.register(connection)` wired via relay adapter | `docs/specs/v1-surfaces-spec.md §4.6` |
| `sessions.suspend` / `sessions.resume` / `sessions.close` | `sessionStore.touch()` / `sessionStore.expire()` | `docs/specs/v1-sessions-spec.md §4.2` |
| Session state: `resumed` / `closed` | Session state: `active` (via touch) / `expired` | `docs/specs/v1-sessions-spec.md §4.1` |
| `docs/specs/core-v1.md` | `docs/specs/v1-core-spec.md` | actual file paths |
| `docs/specs/sessions-v1.md` | `docs/specs/v1-sessions-spec.md` | actual file paths |
| `docs/specs/surfaces-v1.md` | `docs/specs/v1-surfaces-spec.md` | actual file paths |

---

## v1 — Foundation

**Scope:** The minimum skeleton that all product adoption runs on.

**Success definition:** Sage, MSD, and NightCTO can `npm install` `@relay-assistant/core`, `@relay-assistant/sessions`, and `@relay-assistant/surfaces`, define an `AssistantDefinition`, create an `AssistantRuntime`, wire a `SessionStore`, register a `SurfaceRegistry`, and handle typed `InboundMessage` / `OutboundEvent` flows without any additional packages.

### v1 Packages

| Package | What ships |
| --- | --- |
| `@relay-assistant/core` | `createAssistant(definition, adapters)`, `AssistantDefinition`, `AssistantRuntime` interface, capability handler dispatch table, lifecycle (`start`/`stop`), `runtime.dispatch()`, `runtime.emit()`, `runtime.register()` / `runtime.get()`, `runtime.status()`, `RelayInboundAdapter` / `RelayOutboundAdapter` interfaces, hook system (`AssistantHooks`), error types |
| `@relay-assistant/sessions` | `createSessionStore(config)`, `SessionStore` interface, `Session` type, `SessionStoreAdapter` interface, lifecycle transitions (`created → active → suspended → expired`), `touch()`, `attachSurface()`, `detachSurface()`, `expire()`, `sweepStale()`, `AffinityResolver` interface, `resolveSession()` utility, in-memory adapter, error types |
| `@relay-assistant/surfaces` | `createSurfaceRegistry(config)`, `SurfaceRegistry` interface, `SurfaceConnection` type, `SurfaceAdapter` interface, `SurfaceCapabilities` type, `SurfaceFormatHook` type, `SurfacePayload` type, `FanoutPolicy` / `FanoutResult` types, inbound normalization (`receiveRaw` / `setInboundHandler`), outbound targeted send and session fanout, connection state management, error types |

### v1 Constraints

- Pure TypeScript: all contracts are interfaces and types, no runtime framework dependencies
- In-memory only: no network calls, no cloud service dependencies
- Test-per-workflow: each workflow ships with at least one test file
- No backwards-compatibility shims needed — this is greenfield
- `capabilities` field in `AssistantDefinition` is `Record<string, CapabilityHandler>`, not an array

### v1 Spec Documents (canonical references)

Before any v1 code is written, three specs must be completed and treated as the authoritative implementation reference:

| Spec | Path | Status |
| --- | --- | --- |
| core v1 | `docs/specs/v1-core-spec.md` | IMPLEMENTATION_READY |
| sessions v1 | `docs/specs/v1-sessions-spec.md` | IMPLEMENTATION_READY |
| surfaces v1 | `docs/specs/v1-surfaces-spec.md` | IMPLEMENTATION_READY |

### v1 Workflows

Seven workflows constitute the v1 build. WF-1 through WF-5 are the minimum shippable v1. WF-6 and WF-7 are integration stretch goals.

| Workflow | Packages | Gates | Cross-package notes |
| --- | --- | --- | --- |
| WF-1: Define assistant and start runtime | core | core spec | Pure core; no sessions or surfaces |
| WF-2: Handle inbound message via dispatch | core | WF-1 | Exercises `dispatch()`, capability table, hooks, `emit()` |
| WF-3: Create and manage sessions | sessions | sessions spec | Parallel with WF-1; requires in-memory adapter |
| WF-4: Wire session store into runtime | core + sessions | WF-2, WF-3 | `runtime.register('sessions', store)` + session resolution in handler |
| WF-5: Register surface registry and route messages | core + surfaces | surfaces spec, WF-2 | WF-5 is cross-package: surfaces + core adapter wiring |
| WF-6: Multi-surface session fanout | core + sessions + surfaces | WF-4, WF-5 | First use of `surfaceRegistry.fanout()` vs targeted `send()` |
| WF-7: End-to-end assembly | core + sessions + surfaces | WF-6 | Full inbound → session → handler → `emit()` → format → adapter cycle |

### Fanout vs targeted send — normative rule

When an `OutboundEvent` carries a specific `surfaceId`: use `surfaceRegistry.send()`. When an `OutboundEvent` carries a `sessionId` but no `surfaceId`: use `surfaceRegistry.fanout()` against `session.attachedSurfaces`. The assistant layer (core) decides which mode to invoke; the registry carries out delivery.

### v1 Consumer Readiness Checklist

By end of v1, Sage, MSD, and NightCTO teams must be able to:

- [ ] `npm install @relay-assistant/core @relay-assistant/sessions @relay-assistant/surfaces`
- [ ] Define an assistant with `createAssistant(definition, adapters)` where `definition.capabilities` is `Record<string, CapabilityHandler>`
- [ ] Wire a `SessionStore` via `runtime.register('sessions', createSessionStore({ adapter }))`
- [ ] Resolve sessions inside capability handlers via `context.runtime.get<SessionStore>('sessions')`
- [ ] Register surfaces via `createSurfaceRegistry()` and wire it as the core relay adapter
- [ ] Handle `InboundMessage` through capability dispatch and emit `OutboundEvent` via `context.runtime.emit()`
- [ ] Return formatted responses to the originating surface or fanout across a session
- [ ] Write product adapter code against stable v1 types
- [ ] Run the SDK's own tests to verify correct integration

---

## v1.1 — Memory and Connectivity

**Scope:** Persistence and focused inter-agent signaling. Unblocks Sage and NightCTO real-world utility.

**Success definition:** Assistants can persist and retrieve memory across sessions. Multi-component assistants can exchange focused coordination signals over typed connectivity contracts.

> **Note on spec status:** `docs/specs/v1-memory-spec.md` and `docs/specs/v1-connectivity-spec.md` are already marked `IMPLEMENTATION_READY` as of 2026-04-11. These specs were authored speculatively ahead of the implementation milestone. The implementation milestone for these packages remains v1.1; the specs existing early is expected and does not change the version gate.

### v1.1 Packages

| Package | What ships |
| --- | --- |
| `@relay-assistant/memory` | `createMemoryStore`, `MemoryStore` interface, memory scopes (user / session / workspace / org / object), retrieval and write contracts, compaction and promotion extension points, adapter interfaces for future backends |
| `@relay-assistant/connectivity` | `createConnectivityLayer`, signal lifecycle state machine, suppression window semantics, `selected` audience resolution, routing escalation interface stub, coordination-connectivity interaction boundary, in-memory implementation |

### v1.1 Connectivity Spec Obligations (resolved in spec; confirmed for implementation)

The connectivity spec resolves all six gaps previously flagged in the connectivity review verdict. These are not pending; they are defined in `docs/specs/v1-connectivity-spec.md`. Implementation must conform to those definitions:

| Gap | Resolution in spec |
| --- | --- |
| Signal lifecycle state machine | Defined in `docs/specs/v1-connectivity-spec.md` |
| Suppression window semantics | Defined in `docs/specs/v1-connectivity-spec.md` |
| `selected` audience resolution | Defined jointly with coordination boundary in spec |
| Connectivity-to-routing escalation interface | Stub interface defined in spec; full resolution in v1.2 when routing ships |
| Coordination-connectivity interaction boundary | Call direction and owned interfaces defined in spec |
| Four workflow specs | Produce as `docs/workflows/connectivity-wf-*.md` during v1.1 implementation |

### v1.1 Consumer Notes

- Sage needs `memory` immediately after v1 ships — v1.1 is the next critical gate for Sage adoption
- NightCTO needs both `memory` and `connectivity` for multi-component assistant flows
- MSD does not strictly require v1.1 for basic adoption but will benefit from `memory` for session continuity

---

## v1.2 — Proactive, Coordination, and Routing

**Scope:** Autonomous behavior, specialist orchestration, and model-aware routing decisions.

**Success definition:** Assistants can act without user prompting, orchestrate multiple specialists behind one identity, and make explicit model-choice and operating-envelope decisions through typed routing contracts.

> **Note on spec status:** `docs/specs/v1-routing-spec.md` is already marked `IMPLEMENTATION_READY` as of 2026-04-11. As with memory and connectivity, the spec existing early does not move the implementation milestone.

### v1.2 Packages

| Package | What ships |
| --- | --- |
| `@relay-assistant/proactive` | `createProactiveEngine`, watcher and reminder contracts, scheduler binding interfaces over Relay substrate, evidence model for proactive decisions |
| `@relay-assistant/coordination` | `createCoordinator`, specialist registry contracts, delegation plan and synthesis contracts, many-agents-one-assistant orchestration semantics |
| `@relay-assistant/routing` | `createRoutingPolicy`, latency/depth/cost response modes, model-choice policy above raw provider clients, integration points for workforce workload-router style persona/tier resolution |

### Why routing ships in v1.2 and not v2

Routing contracts must exist before connectivity and coordination can make real depth/cost decisions. Deferring routing to v2 would force those packages to invent ad hoc routing assumptions that would need to be ripped out later. Routing is included in v1.2 to prevent that architectural debt.

### v1.2 Consumer Notes

- Sage needs `proactive` for follow-ups and stale-thread handling
- NightCTO needs `proactive` for monitoring and digests, `coordination` for specialist orchestration
- MSD needs `coordination` for orchestration requirements
- All three products need `routing` for production-grade model selection

---

## v2 — Policy and Examples

**Scope:** External action governance and reference implementations. The full package map is production-grade after v2.

**Success definition:** All ten packages are implemented and production-grade. Products can reference complete example assemblies for each assistant archetype.

### v2 Packages

| Package | What ships |
| --- | --- |
| `@relay-assistant/policy` | `createActionPolicy`, approval modes, external-action safeguards, action risk classification, audit hooks |
| `@relay-assistant/examples` | Reference examples for Sage-style, MSD-style, and NightCTO-style assistant assemblies; migration examples from product repos to SDK packages |

### v2 Consumer Notes

- Policy is needed for NightCTO and MSD governance scenarios; MSD should stub the policy interface in v1 using a passthrough implementation
- Examples land in v2 once the full package map is stable enough to reference confidently

---

## Version Sequence Summary

| Version | Ships | Critical for |
| --- | --- | --- |
| v1 | core, sessions, surfaces | All products — blocks initial adoption |
| v1.1 | memory, connectivity | Sage, NightCTO — blocks real utility |
| v1.2 | proactive, coordination, routing | All products — blocks full multi-agent and autonomous behavior |
| v2 | policy, examples | NightCTO, MSD governance; full reference material |

---

## What Is Explicitly Out of Scope for All Versions

- Cloud adapters or hosted infrastructure
- Product-specific migrations from Sage, MSD, or NightCTO
- CI/CD pipeline setup
- npm publishing configuration
- Provider-specific transport code (stays in Relay foundation)
- Domain logic for any single product

---WORKFLOW BACKLOG---
# V1 Workflow Backlog

Date: 2026-04-11
Revised: 2026-04-11 (post spec-program-review-verdict — aligned to canonical spec vocabulary)

> **Canonical source of truth:** Package specs in `docs/specs/` override this document when there is drift. This backlog was updated to align with `docs/specs/v1-core-spec.md`, `docs/specs/v1-sessions-spec.md`, and `docs/specs/v1-surfaces-spec.md` after the spec program review on 2026-04-11.

## Purpose

This document is the canonical ordered backlog of implementation workflows for v1. Each workflow is a narrow, PR-sized vertical slice through one or more packages. Workflows produce working, testable code and are the unit of implementation work.

Implement in order. Each workflow gates the next unless explicitly noted as parallelizable.

---

## Pre-Workflow: Spec Phase (Complete — do not block on)

Three spec documents are finalized and marked `IMPLEMENTATION_READY`. They are the authoritative implementation reference for all workflow code.

| Spec | Path | Status |
| --- | --- | --- |
| core v1 | `docs/specs/v1-core-spec.md` | IMPLEMENTATION_READY |
| sessions v1 | `docs/specs/v1-sessions-spec.md` | IMPLEMENTATION_READY |
| surfaces v1 | `docs/specs/v1-surfaces-spec.md` | IMPLEMENTATION_READY |

Key canonical terms (do not use old planning vocabulary):
- `AssistantDefinition` (not `AssistantConfig`)
- `AssistantRuntime` (not `Assistant`)
- `runtime.dispatch()` (not `handleMessage`)
- `InboundMessage` / `OutboundEvent` (not `AssistantMessage`)
- `createSurfaceRegistry()` + `SurfaceConnection` (not `createSurfaceConnection()`)
- `sessionStore.touch()` / `sessionStore.expire()` (not `resume` / `close`)
- Session states: `created → active → suspended → expired` (not `resumed` or `closed`)

---

## WF-1: Define assistant and start runtime

**Package:** `core`
**Depends on:** `docs/specs/v1-core-spec.md`
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
- `RelayInboundAdapter` and `RelayOutboundAdapter` interfaces are exported

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

- `InboundMessage` type is defined and exported (id, surfaceId, sessionId?, text, raw, receivedAt, capability)
- `OutboundEvent` type is defined and exported (surfaceId, sessionId?, text, format?)
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

### Steps

1. Create an `AssistantRuntime` and a `SessionStore`
2. Call `runtime.register('sessions', store)` — verify `runtime.status().registeredSubsystems` includes `'sessions'`
3. In the capability handler, call `context.runtime.get<SessionStore>('sessions')` — verify it returns the store
4. Use `resolveSession(message, store, defaultAffinityResolver)` inside the handler — verify it creates a new session for a new userId
5. Dispatch a second message with the same userId — verify `resolveSession` returns the existing session
6. Touch the session inside the handler — verify `session.state === 'active'`
7. Verify `runtime.get('nonexistent')` throws with a clear error

### Acceptance criteria

- `runtime.register(name, subsystem)` returns `AssistantRuntime` for chaining
- `runtime.get<T>(name)` is generic; throws if name is not registered
- `resolveSession()` utility is exported from `packages/sessions/src/index.ts`
- Integration test does not import any surfaces package
- Session auto-create and session reuse are both tested

---

## WF-5: Register surface registry and route messages

**Package:** `core` + `surfaces`
**Depends on:** `docs/specs/v1-surfaces-spec.md`, WF-2 (for `InboundMessage` / `OutboundEvent` type shapes)
**Produces:** `SurfaceRegistry`, `SurfaceConnection`, `SurfaceAdapter`, `SurfaceCapabilities`, inbound normalization, outbound targeted send, connection state management
**PR scope:** `packages/surfaces/src/types.ts`, `packages/surfaces/src/surfaces.ts`, `packages/surfaces/src/surfaces.test.ts`, additions to `packages/core/src/core.ts` for adapter wiring

> **Cross-package note:** WF-5 is a cross-package workflow. It requires `surfaceRegistry` to be wired as both the `RelayInboundAdapter` and `RelayOutboundAdapter` for the core runtime. The surfaces package implements both adapter interfaces defined in core.

### Steps

1. Create a surface registry: `createSurfaceRegistry()`
2. Define a `SurfaceConnection` for type `"slack"` with a mock `SurfaceAdapter` and `SurfaceCapabilities`
3. Define a `SurfaceConnection` for type `"web"` with different `SurfaceCapabilities` (e.g., markdown=true)
4. Call `surfaceRegistry.register(slackConnection)` and `surfaceRegistry.register(webConnection)`
5. Wire registry as the core relay adapter pair: `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })`
6. Simulate an inbound raw event from the slack surface via `surfaceRegistry.receiveRaw('slack-1', rawPayload)`
7. Verify normalization produces a well-formed `InboundMessage` (id, surfaceId='slack-1', text, receivedAt, raw preserved)
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
- Inbound normalization handles missing optional fields with fallbacks (no throw)
- Outbound targeted `send()` uses format hook when present
- Connection state transitions (`registered → active → inactive`) via adapter callbacks are tested
- `SurfaceNotFoundError`, `SurfaceConflictError`, `SurfaceDeliveryError` exported

### Open questions to resolve before coding

- OQ-1: Fanout is concurrent (Promise.all-equivalent) for v1
- OQ-3: Normalization is permissive (warn + fallback) for v1

---

## WF-6: Multi-surface session fanout

**Package:** `core` + `sessions` + `surfaces`
**Depends on:** WF-4, WF-5
**Produces:** cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout outbound rule validated in integration
**PR scope:** new integration test `packages/core/src/core-sessions-surfaces.test.ts`

### Steps

1. Create a runtime with sessions and a surface registry (slack + web connections)
2. User sends a message via slack surface — `resolveSession()` creates a new session; `store.attachSurface(sessionId, 'slack-1')` is called
3. Same userId sends a message via web surface — `resolveSession()` returns existing session; `store.attachSurface(sessionId, 'web-1')` is called
4. Verify `session.attachedSurfaces` contains both `'slack-1'` and `'web-1'`
5. Handler emits `OutboundEvent` with `surfaceId` set to originating surface — verify only that surface's adapter receives the event (targeted send)
6. Handler emits `OutboundEvent` with `sessionId` but no `surfaceId` — verify `surfaceRegistry.fanout()` is called and both adapters receive the event (fanout)
7. Call `store.detachSurface(sessionId, 'slack-1')` — verify fanout no longer includes slack
8. Verify `FanoutResult` reports correct `total`, `delivered`, `outcomes` fields

### Acceptance criteria

- Session correctly accumulates surface references across multiple surface interactions from the same userId
- Targeted send (`surfaceId` present) routes only to specified adapter
- Fanout (`sessionId` present, no `surfaceId`) routes to all `session.attachedSurfaces` via `surfaceRegistry.fanout()`
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
7. In `chatHandler`: resolve session via `resolveSession()`, touch it, emit a response
8. Call `runtime.start()`
9. Simulate inbound message from slack → session created → handler called → response emitted → slack adapter receives `SurfacePayload`
10. Simulate second message from web surface → session resumed → fanout to both surfaces
11. Call `runtime.stop()` — runtime drains in-flight handlers cleanly
12. Verify `runtime.status()` after stop reflects correct state

### Acceptance criteria

- Full end-to-end cycle passes in a single test with no external dependencies
- Assembly uses only `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces`
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
| 1 | Confirm `docs/specs/v1-core-spec.md` — DONE | — | — |
| 2 | Confirm `docs/specs/v1-sessions-spec.md` — DONE | — | — |
| 3 | Confirm `docs/specs/v1-surfaces-spec.md` — DONE | — | — |
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

## First Implementation Workflows to Write Next

After this backlog document, the next artifacts to produce (as standalone implementation guides) are, in order:

1. `docs/workflows/wf-1-define-assistant.md` — narrow implementation guide for WF-1 with exact type definitions, step-by-step instructions, and acceptance test assertions. An engineer executes this without additional context.
2. `docs/workflows/wf-3-sessions.md` — parallel with wf-1; covers `InMemorySessionStoreAdapter`, full lifecycle including `sweepStale`, and `resolveSession` utility.
3. `docs/workflows/wf-2-dispatch.md` — covers capability dispatch table, `dispatch()`, `emit()`, hook pre-filter; references WF-1 types.
4. `docs/workflows/wf-4-sessions-wire.md` — covers `runtime.register`, `runtime.get`, integration test structure; references WF-2 and WF-3 types.
5. `docs/workflows/wf-5-surfaces.md` — covers `SurfaceRegistry` creation, adapter wiring as core relay adapters, normalization, targeted send; cross-package ownership notes included.

Each workflow document must be a standalone implementation guide that an engineer can execute without additional context. It must include: exact type definitions, expected test file structure, and acceptance test assertions written as pseudocode or TypeScript.


---WEEKEND DELIVERY---
# Weekend Delivery Plan

Date: 2026-04-11
Revised: 2026-04-11 (post spec-program-review-verdict — API examples updated to match canonical specs)
Target: 2026-04-13 (Sunday night)

> **Canonical source of truth:** Package specs in `docs/specs/` override any example code in this document. All assembly examples below have been updated to match the reviewed specs. If a code example conflicts with a spec, trust the spec.

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

- [ ] `npm install @relay-assistant/core @relay-assistant/sessions @relay-assistant/surfaces`
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
      await context.runtime.emit({
        surfaceId: message.surfaceId, // targeted: reply to originating surface
        sessionId: session.id,
        text: "...", // MSD-specific response
      });
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
    // v1: single general capability; v1.2 adds specialist routing
    advise: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);
      await store.attachSurface(session.id, message.surfaceId);


---REVIEW VERDICT---
# Spec Program Review Verdict

Date: 2026-04-11
Reviewer mode: non-interactive
Verdict: FAIL

## Findings

### High

1. Core and surfaces disagree on who owns inbound normalization and which adapter interface is wired at runtime.
   - `docs/specs/v1-core-spec.md` says core owns inbound normalization and expects `RelayInboundAdapter.onMessage/offMessage` over raw events.
   - `docs/specs/v1-surfaces-spec.md` says surfaces owns normalization, defines `receiveRaw()/setInboundHandler()`, and the workflow docs wire `surfaceRegistry` directly into `createAssistant(...)`.
   - These are not equivalent contracts. WF-5 and the end-to-end assembly cannot be implemented cleanly until one boundary is chosen.

2. Core and sessions disagree on the minimum identity fields needed for session resolution.
   - `docs/specs/v1-core-spec.md` defines `InboundMessage` with `id`, `surfaceId`, `sessionId?`, `text`, `raw`, `receivedAt`, `capability`.
   - `docs/specs/v1-sessions-spec.md` and the v1 workflows assume `resolveSession(message, store, resolver)` can create or resume sessions by `userId` and often `workspaceId`.
   - There is no canonical `userId` or `workspaceId` on `InboundMessage`, so WF-4, WF-6, and the Sage/MSD/NightCTO examples depend on data that the core contract does not expose.

3. Core and surfaces disagree on outbound targeting.
   - `docs/specs/v1-core-spec.md` makes `OutboundEvent.surfaceId` required.
   - `docs/specs/v1-surfaces-spec.md`, `docs/architecture/v1-sectioning-and-priorities.md`, and `docs/workflows/v1-workflow-backlog.md` all require a fanout case where an event has `sessionId` but no `surfaceId`.
   - Targeted send versus session fanout cannot be implemented without changing `OutboundEvent` or introducing distinct outbound event shapes.

4. The workflow phase is sequenced inconsistently across the reviewed docs.
   - `docs/architecture/spec-program-plan.md` says workflow documents are Stage 3 and code is Stage 4, and that v1 specs must be finalized before code is committed.
   - `docs/workflows/weekend-delivery-plan.md` schedules scaffolding and implementation this weekend, then lists drafting workflow guides as work that starts after the weekend.
   - That breaks the stated “workflow as unit of implementation” model.

### Medium

5. The v1 sectioning is structurally good, but it relies on crosswalks because the plan and backlog still carry older assembly assumptions.
   - `docs/architecture/v1-sectioning-and-priorities.md` is useful as a correction layer, but needing a correction layer this early is itself a sign that the docs are not yet stable enough for direct implementation handoff.

6. The adoption goal is explicit but not fully operationalized.
   - The docs repeatedly say Sage, MSD, and NightCTO should be able to `npm install` the v1 packages by Sunday night.
   - The same sectioning doc marks npm publishing configuration out of scope.
   - If “npm install” means published packages, the delivery plan is missing packaging/release work. If it means local workspace consumption, the docs should say that directly.

7. v1.1 and v1.2 specs are detailed and useful, but they add noise to a weekend implementation push centered on v1.
   - They are not a blocker themselves.
   - They do, however, create pressure to reason about future boundaries before the v1 cross-package contracts are settled.

## Assessment

### 1. Are these docs concrete enough to become implementation inputs this weekend?

Not yet.

The package specs are individually concrete. The problem is that the cross-package contracts do not line up on three critical paths:

- inbound flow: relay -> surfaces -> core
- session resolution: core message -> sessions identity lookup
- outbound flow: targeted send versus session fanout

Those are implementation inputs, not editorial details. Starting code before fixing them will create churn immediately.

### 2. Is the v1 sectioning coherent and useful?

Yes, mostly.

The version split is coherent:

- v1 = `core + sessions + surfaces`
- v1.1 = `memory + connectivity`
- v1.2 = `proactive + coordination + routing`

That sequence is useful for adoption planning, and the product notes for Sage, MSD, and NightCTO are directionally correct. The weakness is not the sectioning model; it is that the weekend workflows still sit on top of unresolved v1 contract mismatches.

### 3. Is the workflow backlog sequenced sensibly?

Mostly yes at the dependency level, but not yet safe to execute as written.

Good:

- WF-1 and WF-3 in parallel is sensible.
- WF-2 after WF-1 is sensible.
- WF-4 after WF-2 and WF-3 is sensible.
- WF-6 and WF-7 as integration layers is sensible.

Not good enough yet:

- WF-5 assumes a concrete core-surfaces wiring that the specs currently contradict.
- WF-4 assumes session resolution inputs that the core message contract does not currently provide.
- The delivery plan also conflicts with the stated doc -> spec -> workflow -> code pipeline.

### 4. Are Sage, MSD, and NightCTO adoption goals actually reflected?

Yes at the roadmap level, only partially at the implementation level.

Reflected:

- All three products are named in the v1 goal and consumer-readiness criteria.
- The sectioning doc correctly maps near-term needs: all need v1, Sage and NightCTO need memory quickly, NightCTO and MSD need deeper later packages.
- The weekend plan includes product-specific adoption paths.

Not yet reflected strongly enough:

- Those adoption paths depend on `resolveSession(message, ...)`, but `message` does not carry canonical identity fields.
- They also depend on the current core-surfaces assembly examples being valid, which they are not until the adapter boundary is reconciled.
- The “npm install by Sunday night” promise is not backed by an explicit packaging/release path.

### 5. What still needs tightening before implementation workflows begin?

These items should be resolved before coding starts:

1. Choose one inbound boundary.
   - Option A: core owns raw-event normalization; surfaces only handles outbound formatting/registry.
   - Option B: surfaces owns normalization and passes canonical `InboundMessage` into core.
   - Then make the adapter interfaces and examples match that choice everywhere.

2. Add canonical identity fields to the message path used for session resolution.
   - Minimum likely fields: `userId`.
   - Probably also `workspaceId?` if workspace affinity is a real v1 requirement.
   - If those fields intentionally stay out of `InboundMessage`, then `resolveSession(...)` needs a different input contract.

3. Resolve targeted send versus fanout in the outbound contract.
   - Make `surfaceId` optional on `OutboundEvent`, or
   - split outbound events into targeted and session-scoped variants.
   - Then restate the normative rule once in the core/surfaces boundary and once in the workflow backlog.

4. Reconcile the workflow model with the weekend plan.
   - Either workflows are required implementation guides before code, or they are parallel planning artifacts. The docs currently claim both.

5. Clarify the release/adoption promise.
   - If packages will be published to npm this weekend, add the packaging/release work.
   - If teams will consume from the monorepo or tarballs first, replace `npm install` with the actual adoption path.

6. Reduce weekend scope noise.
   - Keep memory, connectivity, and routing as reviewed future inputs, but make the weekend plan explicitly v1-only so implementers do not treat future-package detail as part of the current build.

## Bottom Line

The docs are close, but they are not ready to serve as direct implementation inputs this weekend because the main v1 package boundaries still conflict on inbound flow, session identity, and outbound delivery semantics.

Artifact produced:
- `docs/architecture/spec-program-review-verdict.md`

SPEC_PROGRAM_REVIEW_COMPLETE
