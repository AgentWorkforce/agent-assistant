# V1 Sectioning and Priorities

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-11
Revised: 2026-04-11 (post spec-program-review-verdict and spec-reconciliation-rules)

> **Canonical source of truth:** Package specs in `docs/specs/` override any planning or workflow document when there is drift. This document aligns with reviewed specs as of 2026-04-11. See `docs/architecture/spec-reconciliation-rules.md` for the full replacement table and contradiction resolutions that govern all v1 implementation work.

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
| `sessions.suspend` / `sessions.resume` / `sessions.close` | `sessionStore.touch()` / `sessionStore.expire()` / `sessionStore.sweepStale()` | `docs/specs/v1-sessions-spec.md §4.2` |
| Session state: `resumed` / `closed` | Session state: `active` (via `touch`) / `expired` | `docs/specs/v1-sessions-spec.md §4.1` |
| `docs/specs/core-v1.md` | `docs/specs/v1-core-spec.md` | actual file paths |
| `docs/specs/sessions-v1.md` | `docs/specs/v1-sessions-spec.md` | actual file paths |
| `docs/specs/surfaces-v1.md` | `docs/specs/v1-surfaces-spec.md` | actual file paths |

---

## v1 — Foundation

**Scope:** The minimum skeleton that all product adoption runs on.

**Success definition:** Sage, MSD, and NightCTO can install `@relay-assistant/core`, `@relay-assistant/sessions`, and `@relay-assistant/surfaces` via local workspace references, define an `AssistantDefinition`, create an `AssistantRuntime`, wire a `SessionStore`, register a `SurfaceRegistry`, and handle typed `InboundMessage` / `OutboundEvent` flows without any additional packages.

> **Note on installation:** For v1, "install" means local monorepo consumption via workspace references (e.g., `"@relay-assistant/core": "workspace:*"`) or `npm pack` tarballs. Packages are not published to the npm registry this weekend. Public npm publishing is a post-v1 task.

### Spec Contradictions — Resolved (Pre-WF-1 Gate Cleared)

Three cross-package contradictions defined in `docs/architecture/spec-reconciliation-rules.md` (Contradictions 1–3) have been resolved in the specs. Both `docs/specs/v1-core-spec.md` and `docs/specs/v1-surfaces-spec.md` are now marked `SPEC_RECONCILED`. All eight checklist actions in the reconciliation rules document are complete. WF-1 implementation may begin.

| Contradiction | Spec resolution (applied) | Planning doc impact |
|---|---|---|
| **1 — Inbound normalization ownership** | `v1-core-spec.md`: "owns inbound normalization" removed from §1 responsibilities. `RelayInboundAdapter.onMessage` accepts `InboundMessage`. `v1-surfaces-spec.md §4.9`: `SurfaceRegistry` confirmed as `RelayInboundAdapter` implementor; `setInboundHandler` retired in favor of standard `onMessage`/`offMessage` contract. | WF-5 cross-package note; WF-7 assembly pattern |
| **2 — Missing identity fields on `InboundMessage`** | `v1-core-spec.md §3.3`: `userId: string` (required) and `workspaceId?: string` (optional) present on `InboundMessage`. Normalization table in `v1-surfaces-spec.md §4.10` updated with extraction rules. | WF-2 acceptance criteria; WF-3/4 session resolution steps |
| **3 — `OutboundEvent.surfaceId` required vs. fanout** | `v1-core-spec.md §3.8`: `surfaceId?` is optional; `OutboundEventError` defined in §3.10. Normative targeted-vs-fanout routing rule documented in both specs. | WF-2 acceptance criteria; WF-6 fanout behavior |

### v1 Packages

| Package | What ships |
| --- | --- |
| `@relay-assistant/core` | `createAssistant(definition, adapters)`, `AssistantDefinition`, `AssistantRuntime` interface, capability handler dispatch table, lifecycle (`start`/`stop`), `runtime.dispatch()`, `runtime.emit()`, `runtime.register()` / `runtime.get()`, `runtime.status()`, `RelayInboundAdapter` / `RelayOutboundAdapter` interfaces, hook system (`AssistantHooks`), error types (`AssistantDefinitionError`, `OutboundEventError`) |
| `@relay-assistant/sessions` | `createSessionStore(config)`, `SessionStore` interface, `Session` type, `SessionStoreAdapter` interface, lifecycle transitions (`created → active → suspended → expired`), `touch()`, `attachSurface()`, `detachSurface()`, `expire()`, `sweepStale()`, `AffinityResolver` interface, `resolveSession()` utility, in-memory adapter, error types |
| `@relay-assistant/surfaces` | `createSurfaceRegistry(config?)`, `SurfaceRegistry` interface (implements both `RelayInboundAdapter` and `RelayOutboundAdapter`), `SurfaceConnection` type, `SurfaceAdapter` interface, `SurfaceCapabilities` type, `SurfaceFormatHook` type, `SurfacePayload` type, `FanoutPolicy` / `FanoutResult` / `FanoutOutcome` types, inbound normalization (`receiveRaw(surfaceId, raw)` → `RelayInboundAdapter.onMessage`/`offMessage` contract; `setInboundHandler` is retired — see `docs/specs/v1-surfaces-spec.md` §4.9), outbound targeted send and session fanout, connection state management, error types |

### v1 Constraints

- Pure TypeScript: all contracts are interfaces and types, no runtime framework dependencies
- In-memory only: no network calls, no cloud service dependencies
- Test-per-workflow: each workflow ships with at least one test file
- No backwards-compatibility shims needed — this is greenfield
- `capabilities` field in `AssistantDefinition` is `Record<string, CapabilityHandler>`, not an array

### v1 Spec Documents (canonical references)

Three specs are at `IMPLEMENTATION_READY` status with all contradiction resolutions applied:

| Spec | Path | Status |
| --- | --- | --- |
| core v1 | `docs/specs/v1-core-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |
| sessions v1 | `docs/specs/v1-sessions-spec.md` | IMPLEMENTATION_READY |
| surfaces v1 | `docs/specs/v1-surfaces-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |

### v1 Workflows

Seven workflows constitute the v1 build. WF-1 through WF-5 are the minimum shippable v1. WF-6 and WF-7 are integration stretch goals.

| Workflow | Package owner(s) | Gates | Cross-package notes |
| --- | --- | --- | --- |
| WF-1: Define assistant and start runtime | `core` | core spec | Pure core; no sessions or surfaces |
| WF-2: Handle inbound message via dispatch | `core` | WF-1 | Exercises `dispatch()`, capability table, hooks, `emit()`; `InboundMessage` requires `userId` per Contradiction 2 resolution |
| WF-3: Create and manage sessions | `sessions` | sessions spec | Parallel with WF-1; requires in-memory adapter |
| WF-4: Wire session store into runtime | `core` + `sessions` | WF-2, WF-3 | `runtime.register('sessions', store)` + `resolveSession()` in handler; `sessions` does not inject middleware — product wires it |
| WF-5: Register surface registry and route messages | `core` + `surfaces` | surfaces spec, WF-2 | **Surfaces owns inbound normalization** (Contradiction 1 resolution): `surfaceRegistry.receiveRaw()` normalizes raw → `InboundMessage`; `surfaceRegistry` implements both `RelayInboundAdapter` and `RelayOutboundAdapter` for core |
| WF-6: Multi-surface session fanout | `core` + `sessions` + `surfaces` | WF-4, WF-5 | First use of `surfaceRegistry.fanout()` vs. targeted `send()`; `runtime.emit()` throws `OutboundEventError` when both `surfaceId` and `sessionId` are absent. **Cross-package ownership:** when fanout is triggered (sessionId present, no surfaceId), core resolves `attachedSurfaces` by calling `runtime.get('sessions')` internally to retrieve the `SessionStore`, then reads `session.attachedSurfaces` before delegating to `outboundAdapter.fanout()`. Sessions owns the list; surfaces owns delivery. This requires the session store to be registered via `runtime.register('sessions', store)` before any fanout emit is called. |
| WF-7: End-to-end assembly | `core` + `sessions` + `surfaces` | WF-6 | Full inbound → session → handler → `emit()` → format → adapter cycle; produces integration test and updated READMEs |

### Fanout vs. targeted send — normative rule

When an `OutboundEvent` carries a specific `surfaceId`: use `surfaceRegistry.send()` (targeted delivery to exactly one surface).

When an `OutboundEvent` carries a `sessionId` but no `surfaceId`: use `surfaceRegistry.fanout(event, session.attachedSurfaces, policy?)` (session fanout to all attached surfaces per `FanoutPolicy`).

When an `OutboundEvent` carries neither `surfaceId` nor `sessionId`: `runtime.emit()` must throw `OutboundEventError`. This is an invalid outbound event.

The assistant layer (core) decides which mode to invoke; the registry carries out delivery. This rule is stated in both `docs/specs/v1-core-spec.md` (§3.7, `runtime.emit()` contract) and `docs/specs/v1-surfaces-spec.md` (§8, outbound routing rule). See Contradiction 3 resolution in `docs/architecture/spec-reconciliation-rules.md`.

### v1 Consumer Readiness Checklist

By end of v1, Sage, MSD, and NightCTO teams must be able to:

- [ ] Install `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces` via local workspace references
- [ ] Define an assistant with `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })` where `definition.capabilities` is `Record<string, CapabilityHandler>`
- [ ] Wire a `SessionStore` via `runtime.register('sessions', createSessionStore({ adapter }))`
- [ ] Resolve sessions inside capability handlers via `context.runtime.get<SessionStore>('sessions')` + `resolveSession(message, store, resolver)`
- [ ] Register surfaces via `createSurfaceRegistry()` wired as the core relay adapter pair (both inbound and outbound)
- [ ] Handle `InboundMessage` through capability dispatch and emit `OutboundEvent` via `context.runtime.emit()`
- [ ] Return formatted responses to the originating surface (targeted send) or fanout across a session
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

> **Note on spec status:** `docs/specs/v1-routing-spec.md` is already marked `IMPLEMENTATION_READY` as of 2026-04-11. As with memory and connectivity, the spec existing early does not move the implementation milestone. The implementation milestone for routing remains v1.2.

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
- npm publishing configuration (packages install via workspace references for v1; public npm publishing is post-v1)
- Provider-specific transport code (stays in Relay foundation)
- Domain logic for any single product
