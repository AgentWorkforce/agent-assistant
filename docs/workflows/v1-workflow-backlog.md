# V1 Workflow Backlog

Date: 2026-04-11
Revised: 2026-04-11 (post spec-program-review-verdict and spec-reconciliation-rules — aligned to canonical spec vocabulary; fanout/targeting rules and cross-package ownership clarified)
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — implementation status updated; WF-1 through WF-5 marked COMPLETE; routing DoD gap noted; traits context added)

> **Canonical source of truth:** Package specs in `docs/specs/` override this document when there is drift. This backlog was updated to align with `docs/specs/v1-core-spec.md`, `docs/specs/v1-sessions-spec.md`, and `docs/specs/v1-surfaces-spec.md` after the spec program review and reconciliation rules pass on 2026-04-11.

## Implementation Status Summary

| Workflow | Package(s) | Status | Tests |
| --- | --- | --- | --- |
| WF-1: Define assistant and start runtime | core | **COMPLETE** | 44 pass |
| WF-2: Handle inbound message via dispatch | core | **COMPLETE** | (included in core 44) |
| WF-3: Create and manage sessions | sessions | **COMPLETE** | 25 pass |
| WF-4: Wire session store into runtime | core + sessions | **COMPLETE** | (included in above) |
| WF-5: Register surface registry and route messages | core + surfaces | **COMPLETE** | 28 pass (surfaces) |
| WF-6: Multi-surface session fanout | core + sessions + surfaces | **COMPLETE** — `packages/core/src/core-sessions-surfaces.test.ts` (WF-6 label, line 99) covers multi-surface session attachment, fanout, targeted send, and detach behavior |
| WF-7: End-to-end assembly | core + sessions + surfaces | **OPEN** — no assembly test in `packages/examples/src/` (directory not yet created); core/sessions/surfaces READMEs are substantive (not placeholders) |

**Blocking DoD failure (not cleared):** `@relay-assistant/routing` has 12 tests against a required 40+ target. Routing is implemented but is gated from product consumption until this is resolved. See `docs/architecture/v1-routing-review-verdict.md` for F-1 (test count) and F-2 (escalated flag) details.

**Additional implemented packages (beyond WF-1 through WF-5 scope):**
- `@relay-assistant/connectivity` — 87 tests passing
- `@relay-assistant/coordination` — 45 tests passing; routing integration reviewed; escalation-routing pipeline dormant (v1 known gap)

---

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

## WF-1: Define assistant and start runtime — **COMPLETE**

**Package:** `core`
**Status:** COMPLETE — 44 tests passing, `SPEC_RECONCILED`
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

---

## WF-2: Handle inbound message via capability dispatch — **COMPLETE**

**Package:** `core`
**Status:** COMPLETE — included in core 44 tests
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

---

## WF-3: Create and manage sessions — **COMPLETE**

**Package:** `sessions`
**Status:** COMPLETE — 25 tests passing, `IMPLEMENTATION_READY`
**Depends on:** `docs/specs/v1-sessions-spec.md` (independent of WF-1/WF-2 — parallelizable)
**Produces:** `SessionStore`, `Session`, lifecycle transitions, in-memory `SessionStoreAdapter`, error types
**PR scope:** `packages/sessions/src/types.ts`, `packages/sessions/src/sessions.ts`, `packages/sessions/src/sessions.test.ts`

### Acceptance criteria

- `Session` interface matches spec: `id`, `userId`, `workspaceId?`, `state`, `createdAt`, `lastActivityAt`, `stateChangedAt?`, `attachedSurfaces`, `metadata`
- `SessionState` union type: `'created' | 'active' | 'suspended' | 'expired'`
- `SessionStore` interface fully implemented with `create`, `get`, `find`, `touch`, `attachSurface`, `detachSurface`, `expire`, `sweepStale`, `updateMetadata`
- `createSessionStore` factory exported from `packages/sessions/src/index.ts`
- `InMemorySessionStoreAdapter` exported
- `SessionNotFoundError`, `SessionConflictError`, `SessionStateError` exported
- `AffinityResolver` interface exported; default implementation finds most recently active session for a userId

---

## WF-4: Wire session store into runtime — **COMPLETE**

**Package:** `core` + `sessions`
**Status:** COMPLETE — included in core and sessions test counts
**Depends on:** WF-2, WF-3
**Produces:** `runtime.register('sessions', store)`, session resolution in capability handler context, `resolveSession()` utility integration

> **Cross-package note:** Sessions does not inject session middleware into core's dispatch pipeline. Products wire session lookups into capability handlers themselves using `context.runtime.get<SessionStore>('sessions')` and the `resolveSession()` utility exported by `@relay-assistant/sessions`. Core remains unaware of session semantics.

---

## WF-5: Register surface registry and route messages — **COMPLETE**

**Package:** `core` + `surfaces`
**Status:** COMPLETE — 28 tests passing (surfaces), `SPEC_RECONCILED`
**Depends on:** `docs/specs/v1-surfaces-spec.md`, WF-2
**Produces:** `SurfaceRegistry`, `SurfaceConnection`, `SurfaceAdapter`, `SurfaceCapabilities`, inbound normalization, outbound targeted send, connection state management

> **Cross-package ownership note (Contradiction 1 resolution):** Surfaces owns inbound normalization. Core does not normalize raw events; it receives only `InboundMessage`.

---

## WF-6: Multi-surface session fanout — **COMPLETE**

**Package:** `core` + `sessions` + `surfaces`
**Status:** COMPLETE — `packages/core/src/core-sessions-surfaces.test.ts` (WF-6 describe block, line 99) covers multi-surface session attachment, fanout, targeted send, and detach behavior with full assertions.
**Depends on:** WF-4, WF-5
**Produces:** cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout outbound rule validated in integration

> **Fanout ownership note:** The surfaces package owns fanout delivery. When `runtime.emit()` is called with a `sessionId` but without a `surfaceId`, core resolves the session's `attachedSurfaces` and calls `surfaceRegistry.fanout(event, attachedSurfaceIds, policy?)`.

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
**Status:** OPEN — package READMEs for core (152 lines), sessions (118 lines), and surfaces (175 lines) are substantive API docs (not placeholders). However, the end-to-end assembly test in `packages/examples/src/` does not yet exist — `packages/examples/src/` directory has not been created. This is the remaining blocker for WF-7 and the v1 release tag.
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
- Assembly pattern matches the canonical pattern from `docs/architecture/spec-reconciliation-rules.md §3b`
- The test passes without any cloud, network, or external dependency
- Package READMEs for core, sessions, and surfaces are updated with real API docs replacing placeholder text
- v1 release tag is prepared

---

## Open Routing Issues (gates product consumption of `@relay-assistant/routing`)

These must be resolved before routing is consumed by any product:

| Issue | File | Status |
| --- | --- | --- |
| F-1: routing test count is 12, DoD requires 40+ | `packages/routing/src/routing.test.ts` | **OPEN — blocking** |
| F-2: `escalated` flag incorrect on hard-constraint caps | `packages/routing/src/routing.ts` | **OPEN — blocking** |
| OQ-5: escalation tiebreaker (deepest mode wins) undocumented | `docs/specs/v1-routing-spec.md` | OPEN — moderate |

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

---

## Execution Order

| Step | Task | Depends on | Status |
| --- | --- | --- | --- |
| 0 | Apply Contradiction 1–3 resolutions to specs | — | **COMPLETE** |
| 1 | `docs/specs/v1-core-spec.md` | — | **DONE (`SPEC_RECONCILED`)** |
| 2 | `docs/specs/v1-sessions-spec.md` | — | **DONE** |
| 3 | `docs/specs/v1-surfaces-spec.md` | — | **DONE (`SPEC_RECONCILED`)** |
| 4 | Implement WF-1 | core spec | **COMPLETE** |
| 5 | Implement WF-3 | sessions spec | **COMPLETE** |
| 6 | Implement WF-2 | WF-1 | **COMPLETE** |
| 7 | Implement WF-4 | WF-2, WF-3 | **COMPLETE** |
| 8 | Implement WF-5 | surfaces spec, WF-2 (types) | **COMPLETE** |
| 9 | Implement WF-6 | WF-4, WF-5 | **COMPLETE** (`core-sessions-surfaces.test.ts`) |
| 10 | Implement WF-7 | WF-6 | **OPEN** — examples/src not yet created |
| 11 | Update package READMEs | WF-7 | **DONE** — core/sessions/surfaces READMEs are substantive |
| 12 | Tag v1 release | all above | **OPEN** |

---

## Package Structure Per Workflow

Each v1 package ships with this structure. Workflows write into it:

```
packages/<name>/
  package.json
  tsconfig.json
  src/
    index.ts        # public exports only
    types.ts        # all exported types and interfaces
    <name>.ts       # factory function and implementation
    <name>.test.ts  # unit tests per workflow
  README.md         # updated from placeholder in WF-7
```

Integration tests that span packages live in `packages/core/src/` or `packages/examples/src/` as the workflow scopes dictate.

---

## Reuse-First Rule

Before authoring a new package implementation workflow, agents should inspect `relay` and related AgentWorkforce repos for reusable packages, contracts, or runtime capabilities.

Specific instruction for memory:
- use the existing `@agent-relay/memory` package as the starting point
- treat `@relay-assistant/memory` as an assistant-facing integration/adaptation layer unless a clear gap requires new implementation work

This applies equally to proactive, policy, and any future packages. Investigation is not optional — it is the first step.

---

V1_WORKFLOW_BACKLOG_UPDATED


## Future Capability Note — Librarian / Cross-Agent Consolidation

A future **v5-v8 level** capability should add a librarian/night-crawler style system that consolidates memory across multiple agents. This is explicitly out of scope for the current v1 workflows, but current memory-related work should preserve provenance, confidence, and timestamp metadata so later consolidation remains possible.
