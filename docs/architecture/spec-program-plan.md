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
1. Import only `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces`
2. Define `AssistantDefinition` with `id`, `name`, `capabilities: { chat: chatHandler }`
3. Wire sessions, attach surfaces via `surfaceRegistry`
4. Process a full inbound → session → handler → `emit()` → surface cycle
5. Verify the complete flow works with only v1 packages
6. Call `runtime.stop()` — verify runtime drains in-flight handlers cleanly

Produces: integration test, validated canonical assembly pattern, updated package READMEs, v1 release tag prepared.

## Implementation Constraints

### Weekend budget

Three specs, seven workflows. Specs are already written (Saturday morning, after Contradiction resolutions are applied). Workflows WF-1 through WF-5 are the minimum shippable v1. WF-6 and WF-7 are stretch goals that validate integration.

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

## Connectivity Spec Gap Resolution

The connectivity review verdict identified six gaps. These are resolved in `docs/specs/v1-connectivity-spec.md` (spec is marked `IMPLEMENTATION_READY` as of 2026-04-11). The spec existing early does not move the implementation milestone — connectivity ships in v1.1. Implementation must conform to definitions in the spec.

| Gap | Resolution |
| --- | --- |
| Signal lifecycle state machine | Defined in `docs/specs/v1-connectivity-spec.md` |
| Suppression window semantics | Defined in `docs/specs/v1-connectivity-spec.md` |
| `selected` audience resolution | Defined jointly with coordination boundary in `docs/specs/v1-connectivity-spec.md` |
| Connectivity-to-routing escalation interface | Stub interface in `docs/specs/v1-connectivity-spec.md`; full resolution in v1.2 when routing ships |
| Coordination-connectivity interaction boundary | Call direction and owned interfaces defined in `docs/specs/v1-connectivity-spec.md` |
| Four workflow specs | Produce as `docs/workflows/connectivity-wf-*.md` during v1.1 implementation |

## Package Criticality

### v1-critical (blocks all product adoption)

- `@relay-assistant/core` — without this, nothing composes
- `@relay-assistant/sessions` — without this, no continuity
- `@relay-assistant/surfaces` — without this, no inbound/outbound

### v1.1-critical (blocks real product utility)

- `@relay-assistant/memory` — Sage and NightCTO need this immediately
- `@relay-assistant/connectivity` — NightCTO and MSD multi-component flows need this

### v1.2-critical (blocks full multi-agent and routing-aware products)

- `@relay-assistant/proactive` — Sage and NightCTO proactive behavior
- `@relay-assistant/coordination` — NightCTO specialist orchestration
- `@relay-assistant/routing` — workforce-aligned model selection, required before connectivity and coordination can make real depth/cost decisions

### Follow-on (needed for governance and reference material)

- `@relay-assistant/policy` — external action governance
- `@relay-assistant/examples` — reference implementations

## Consumer Readiness Checklist

By end of weekend, Sage/MSD/NightCTO teams should be able to:

- [ ] Install `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces` via local workspace references (not npm registry — see Rule 5 note above)
- [ ] Call `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })` with their product config
- [ ] Wire a session store via `runtime.register('sessions', createSessionStore({ adapter }))`
- [ ] Register surfaces via `createSurfaceRegistry()` wired as both inbound and outbound relay adapters
- [ ] Handle `InboundMessage` through typed capability dispatch and emit `OutboundEvent` via `context.runtime.emit()`
- [ ] Return formatted responses to the originating surface (targeted send) or fanout across a session
- [ ] Write product adapter code against stable v1 types
- [ ] Run the SDK's own tests to verify correct integration

## Execution Order

| Order | Task | Depends on |
| --- | --- | --- |
| 0 | ~~Apply Contradiction 1–3 resolutions~~ — **COMPLETE.** Both `docs/specs/v1-core-spec.md` and `docs/specs/v1-surfaces-spec.md` are now `SPEC_RECONCILED`. All eight checklist actions in `docs/architecture/spec-reconciliation-rules.md` are done. | — |
| 1 | `docs/specs/v1-core-spec.md` — DONE (`SPEC_RECONCILED`) | action 0 |
| 2 | `docs/specs/v1-sessions-spec.md` — DONE | this plan |
| 3 | `docs/specs/v1-surfaces-spec.md` — DONE (`SPEC_RECONCILED`) | action 0 |
| 4 | Implement WF-1: define assistant and start runtime | core spec |
| 5 | Implement WF-2: handle inbound message via dispatch | WF-1 |
| 6 | Implement WF-3: create and manage sessions | sessions spec |
| 7 | Implement WF-4: wire session store into runtime | WF-2, WF-3 |
| 8 | Implement WF-5: register surface registry and route messages | surfaces spec, WF-2 |
| 9 | Implement WF-6: multi-surface session | WF-4, WF-5 |
| 10 | Implement WF-7: end-to-end assembly | WF-6 |
| 11 | Update package READMEs with real API docs | WF-7 |
| 12 | Tag v1 release | all above |

## What This Plan Does Not Cover

- Cloud adapters or hosted infrastructure
- Product-specific migrations from Sage, MSD, or NightCTO
- CI/CD pipeline setup
- npm publishing configuration (packages install via workspace references for v1; public npm publishing is post-v1)
- v1.1+ spec documents (those are written after v1 ships, except memory/connectivity/routing specs which are already marked `IMPLEMENTATION_READY` speculatively — see version notes in `docs/architecture/v1-sectioning-and-priorities.md`)

SPEC_PROGRAM_PLAN_READY
