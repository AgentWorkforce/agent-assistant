---COORDINATION README---
# `@relay-assistant/coordination`

Status: placeholder package README, no implementation yet.

## Purpose

This package is intended to define many-agents-one-assistant coordination contracts.

Consumers should expect this package to own:

- coordinator and specialist registry contracts
- delegation plans
- synthesis interfaces
- assistant-level orchestration semantics

## Expected Consumer Role

A product should import this package when one assistant should orchestrate multiple internal specialists.

Illustrative usage target:

```ts
import { createCoordinator } from "@relay-assistant/coordination";
```

## What Stays Outside

- fixed specialist lineups for a specific product
- product-specific dispatch heuristics
- domain workflows that do not generalize

---PACKAGE BOUNDARY MAP---
# Package Boundary Map

Date: 2026-04-11

## Purpose

This document defines what belongs in:

- Relay foundation repos
- `relay-agent-assistant` OSS SDK packages
- product repositories such as Sage, MSD, and NightCTO

The goal is to prevent duplicate assistant-runtime work while avoiding leakage of transport infrastructure or product-specific behavior into the wrong layer.

## Boundary Rule

Use this rule first:

- if the capability is transport, auth, scheduling substrate, or low-level action dispatch, keep it in Relay foundation
- if the capability assumes an assistant identity, memory model, session continuity model, specialist orchestration model, or focused inter-agent connectivity model, move it here
- if the capability only makes sense for one product's domain, keep it in that product repo

## Layer Ownership

### Relay foundation

Relay family repos should continue to own:

- inbound webhook verification and provider-specific parsing
- normalized message and outbound delivery primitives
- channel and transport session substrate
- auth and connection wiring
- low-level action dispatch
- scheduler and wake-up substrate
- relaycast or other communication infrastructure
- transport-level observability

Examples that stay out of this repo:

- Slack signature verification
- WhatsApp payload parsing
- generic cron registration
- raw `spawn_agent` or message-delivery plumbing

### Relay Agent Assistant SDK

This repo should own reusable assistant-runtime behavior:

- assistant definition and capability registration
- memory scopes, retrieval, persistence contracts, promotion, compaction
- proactive engines, watch rules, reminders, scheduler bindings
- assistant session continuity across surfaces
- assistant-facing surface abstractions above normalized transport events
- coordinator and specialist orchestration
- focused inter-agent connectivity, signaling, and convergence contracts
- assistant-level routing, latency, depth, and budget-aware policy hooks
- policy, approvals, audit hooks, and action risk classification

Examples that should land here:

- a shared `AssistantSession` model
- a reusable `MemoryStore` contract
- a generic `ProactiveEngine`
- a coordinator that can delegate to specialists and synthesize one assistant response

### Product repositories

Product repos should continue to own:

- prompts and persona behavior beyond baseline assistant identity fields
- product-specific tools and workflows
- domain-specific watcher rules
- product UX and surface conventions
- business policy, escalation, and commercial rules
- product-specific specialist definitions

Examples:

- MSD review heuristics and PR-specific workflows
- Sage knowledge-capture behavior and workspace semantics
- NightCTO founder communication patterns and service-tier policy

## Package Responsibilities

### `@relay-assistant/core`

Owns:

- `createAssistant()` and assistant definition types
- runtime lifecycle and capability registration
- assistant identity fields shared across packages
- lightweight composition entrypoints and shared cross-package types

Composition note:
- `core` should not become a heavy package that hard-depends on every other package by default
- prefer interface-first composition and optional package wiring so consumers can adopt only the packages they need
- if `core` exposes convenience assembly helpers, they should live alongside modular entrypoints rather than replacing them

Must not own:

- provider-specific transport code
- memory backend implementation details
- product workflows

### `@relay-assistant/memory`

Owns:

- memory scopes such as user, session, workspace, org, and object
- retrieval, write, compaction, and promotion contracts
- memory adapter interfaces for future backends

Must not own:

- one product's tag taxonomy
- one surface's thread model as the only memory key shape

### `@relay-assistant/proactive`

Owns:

- follow-up engines
- watcher definitions
- reminder policies
- scheduler bindings over Relay substrate
- evidence contracts for stale-session or follow-up decisions

Must not own:

- product-only trigger logic
- surface-specific evidence collection that cannot generalize

### `@relay-assistant/sessions`

Owns:

- assistant session identity
- attachment of multiple surfaces to one assistant session
- resume, reattach, and affinity rules
- scoping rules across user, workspace, org, and object contexts

Must not own:

- raw transport sessions
- provider webhook semantics

### `@relay-assistant/surfaces`

Owns:

- assistant-facing inbound and outbound abstractions
- assistant-layer fanout policy describing which connected surfaces should receive a given assistant response
- formatter and capability hooks above Relay normalization
- surface metadata such as threading or attachment support

Fanout boundary note:
- Relay foundation still owns actual transport delivery to each destination
- `surfaces` only decides assistant-level targeting and formatting across attached surfaces
- Example: deciding that one assistant summary should go to web plus Slack belongs here; the actual Slack API post and web transport delivery remain in Relay foundation

Must not own:

- webhook verification
- provider SDK clients as foundational transport code

### `@relay-assistant/coordination`

Owns:

- coordinator and specialist registry contracts
- delegation plan and synthesis contracts
- many-agents-one-assistant orchestration semantics

Must not own:

- a fixed specialist lineup for any one product
- product-specific dispatch heuristics that cannot generalize

### `@relay-assistant/connectivity`

Owns:

- focused inter-agent signaling contracts
- convergence and escalation semantics
- attention, salience, confidence, and handoff message classes
- communication efficiency rules for internal assistant coordination

Must not own:

- raw message transport or relaycast substrate
- product-specific specialist registries
- generic user-facing messaging APIs

### `@relay-assistant/routing`

Owns:

- assistant-facing routing contracts
- latency/depth/cost response modes
- model-choice policy above raw provider clients
- integration points for workforce workload-router style persona/tier resolution

Must not own:

- raw transport routing
- provider SDK implementation details
- product-specific commercial routing rules

### `@relay-assistant/policy`

Owns:

- approval modes
- external-action safeguards
- action risk classification
- audit hooks

Must not own:

- one product's commercial rules or customer-tier behavior

### `@relay-assistant/examples`

Owns:

- reference examples showing how products should integrate the SDK
- skeletal example assistants and adoption patterns

Must not own:

- production product code
- private cloud adapters

## Extraction Guidance From Existing Systems

| Source | Signal | Destination |
| --- | --- | --- |
| Relay gateway and adapter infrastructure | transport, verification, normalization, raw actions | stay in Relay foundation |
| Sage memory and proactive behavior | reusable memory and follow-up patterns | `memory`, `proactive`, parts of `core` |
| MSD session and surface convergence design | shared chat surface and runtime/session attachment | `sessions`, `surfaces`, parts of `core` |
| NightCTO specialist orchestration and per-client continuity | many-agents-one-assistant and proactive monitoring | `coordination`, `connectivity`, `policy`, `memory`, `proactive` |
| Workforce workload-router and persona tiers | quality-preserving routing across depth/latency/cost envelopes | `routing`, parts of `core`, links to `coordination` |

## Import Guidance For Consumers

Consumers should import only the package boundaries they need.

Examples:

- a simple assistant may import `@relay-assistant/core`, `@relay-assistant/sessions`, and `@relay-assistant/surfaces`
- a memory-heavy assistant may additionally import `@relay-assistant/memory`
- a specialist-based assistant may add `@relay-assistant/coordination` and `@relay-assistant/policy`

Consumers should not import Relay infrastructure directly to bypass assistant-level contracts unless they are implementing a transport adapter or other foundational infrastructure outside this repo.

---HOW TO BUILD AN ASSISTANT---
# How To Build An Assistant

Date: 2026-04-11
Revised: 2026-04-11 (spec-reconciliation pass — all examples updated to match canonical specs)

> **Canonical source of truth:** Package specs in `docs/specs/` override any example or description in this document. If an API name, import path, or assembly pattern in this document conflicts with a spec, trust the spec. See `docs/architecture/spec-reconciliation-rules.md` for the full replacement table.

## Purpose

This document explains how a consumer should think about building an assistant on top of this SDK once implementation begins.

It is intentionally architectural. It does not assume package code exists yet.

## Start With One Assistant Definition

A product should model one user-facing assistant as:

- one assistant identity
- one assistant session model
- zero or more internal specialists
- optional memory and proactive capabilities

The external user experience should remain one coherent assistant even if multiple internal runtimes contribute.

## Expected Package Imports

Consumers should expect to import only the packages they need.

Canonical import shape for v1 packages (core, sessions, surfaces):

```ts
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
  InMemorySessionStoreAdapter,
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

Later packages (v1.1+) follow the same pattern:

```ts
import { createMemoryStore } from "@relay-assistant/memory";
import { createProactiveEngine } from "@relay-assistant/proactive";
import { createCoordinator } from "@relay-assistant/coordination";
import { createConnectivityLayer } from "@relay-assistant/connectivity";
import { createActionPolicy } from "@relay-assistant/policy";
```

The names above for future packages are illustrative. v1 names (`createAssistant`, `createSessionStore`, `createSurfaceRegistry`) are spec-confirmed.

## Minimum Build Order

Build an assistant in this order:

1. define the assistant identity and runtime boundary in `@relay-assistant/core`
2. define how inbound activity maps into an assistant session via `@relay-assistant/sessions`
3. attach surfaces through `@relay-assistant/surfaces`
4. add memory via `@relay-assistant/memory` if continuity is needed
5. add proactive behavior via `@relay-assistant/proactive` if the assistant should act when the user is not actively messaging
6. add specialist orchestration via `@relay-assistant/coordination` if one assistant needs multiple internal agents
7. add focused internal signaling via `@relay-assistant/connectivity` when multiple subsystems or specialists must coordinate efficiently
8. govern external actions with `@relay-assistant/policy`

## What The Product Must Supply

The SDK should not replace product logic.

Each product still supplies:

- domain prompts and instruction sets
- product-specific tools and workflows
- domain-specific watcher definitions
- UI or surface presentation choices
- business policy and escalation rules

## Recommended Mental Model

Think in three layers:

### Layer 1: Relay foundation

Use Relay family repos for transport, webhook verification, delivery, auth, scheduler substrate, and low-level action dispatch.

### Layer 2: Assistant SDK

Use this repo for assistant runtime contracts and reusable assistant behavior.

### Layer 3: Product assistant

Use the product repo for the actual product experience.

## Basic Assembly Pattern

A typical product assembles an assistant in five steps:

1. declare an `AssistantDefinition` with `id`, `name`, and `capabilities` (`Record<string, CapabilityHandler>`)
2. create a `SessionStore` via `createSessionStore({ adapter })`
3. create a `SurfaceRegistry` via `createSurfaceRegistry()` and register one or more `SurfaceConnection` objects
4. create the runtime via `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })` — the surface registry implements both relay adapter interfaces
5. call `runtime.register("sessions", sessionStore)` then `runtime.start()`

Future subsystems (memory, proactive, coordination, policy) are also registered on the runtime via `runtime.register(name, subsystem)`.

## Skeletal Assembly Example

```ts
import { createAssistant } from "@relay-assistant/core";
import type {
  AssistantDefinition,
  InboundMessage,
  CapabilityContext,
} from "@relay-assistant/core";
import {
  createSessionStore,
  InMemorySessionStoreAdapter,
  resolveSession,
  createDefaultAffinityResolver,
} from "@relay-assistant/sessions";
import type { SessionStore } from "@relay-assistant/sessions";
import { createSurfaceRegistry } from "@relay-assistant/surfaces";
import type { SurfaceConnection, SurfaceCapabilities } from "@relay-assistant/surfaces";

// Step 1: Define assistant identity and capabilities
const definition: AssistantDefinition = {
  id: "my-assistant",
  name: "My Assistant",
  capabilities: {
    chat: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);
      await store.attachSurface(session.id, message.surfaceId);

      // Targeted send: reply to the originating surface (surfaceId present)
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "response text", // product logic here
      });

      // Session fanout: broadcast to ALL attached surfaces (surfaceId absent)
      // Only needed when a session spans multiple surfaces (e.g., Slack + web).
      // await context.runtime.emit({
      //   sessionId: session.id,
      //   text: "broadcast to all session surfaces",
      // });

      // Invalid (throws OutboundEventError): neither surfaceId nor sessionId present.
    },
  },
};

// Step 2: Create session store
const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

// Step 3: Define and register surface connections
const slackCapabilities: SurfaceCapabilities = {
  markdown: false,
  richBlocks: true,
  attachments: true,
  streaming: false,
  maxResponseLength: 3000,
};

const slackConnection: SurfaceConnection = {
  id: "my-assistant-slack",
  type: "slack",
  state: "registered",
  capabilities: slackCapabilities,
  adapter: slackAdapter, // provided by relay foundation or product code
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);

// Step 4: Create runtime — surfaces implement both relay adapter interfaces
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});

// Step 5: Register subsystems and start
runtime.register("sessions", sessionStore);
await runtime.start();
```

The example above is spec-conformant for v1. Future packages (memory, proactive, etc.) register the same way: `runtime.register("memory", memoryStore)`.

## Graceful Degradation Guidance

Consumers should assume that some assistant subsystems will be temporarily unavailable.

Examples:
- if memory is unavailable, the assistant should continue with reduced continuity rather than fail closed for every request
- if proactive scheduling is unavailable, inbound interactions should still work normally
- if coordination fails mid-turn, the assistant should prefer a narrower single-agent answer over total failure when safe
- if one surface is degraded, the session should remain intact for other attached surfaces

## What To Avoid

Do not:

- couple assistant runtime contracts directly to one surface
- put domain logic into shared SDK packages just because multiple products need something vaguely similar
- bypass session contracts by using raw thread IDs as the only continuity key
- assume any future cloud service exists
- use stale API names — see `docs/architecture/spec-reconciliation-rules.md` Rule 1 for the full replacement table:

| Stale (do not use) | Current |
|---|---|
| `AssistantConfig` | `AssistantDefinition` |
| `Assistant` (live object type) | `AssistantRuntime` |
| `handleMessage(msg)` | `runtime.dispatch(msg)` |
| `assistant.onMessage(handler)` | `AssistantDefinition.capabilities` (`Record<string, CapabilityHandler>`) |
| `AssistantMessage` | `InboundMessage` (inbound) / `OutboundEvent` (outbound) |
| `createSurfaceConnection(config)` | `SurfaceConnection` registered via `createSurfaceRegistry()` |
| `assistant.attachSurface(surface)` | `surfaceRegistry.register(connection)` |
| `sessions.suspend(id)` | `sessionStore.sweepStale(ttlMs)` |
| `sessions.resume(id)` | `sessionStore.touch(id)` |
| `sessions.close(id)` | `sessionStore.expire(id)` |
| Session state `resumed` | Session state `active` (reached via `touch()`) |
| Session state `closed` | Session state `expired` |

## Product Examples

> **Spec conformance:** All assembly code in this section and in `docs/workflows/weekend-delivery-plan.md` conforms to the reconciled v1 specs. If these examples ever drift from the specs in `docs/specs/`, **trust the specs**. The replacement table in `docs/architecture/spec-reconciliation-rules.md` Rule 1 is the primary stale-term reference.

### Sage-style assistant

Use:

- `core`
- `sessions`
- `surfaces`
- `memory` (v1.1)
- `proactive` (v1.2)

Keep in Sage:

- knowledge and workspace-specific prompt behavior
- product-specific follow-up heuristics
- memory retrieval logic (until `@relay-assistant/memory` ships in v1.1)

See `docs/workflows/weekend-delivery-plan.md` for the Sage v1 minimum viable assembly.

### MSD-style assistant

Use:

- `core`
- `sessions`
- `surfaces`
- `memory` (v1.1)
- `coordination` (v1.2)
- `connectivity` (v1.1)
- `policy` (v2)

Keep in MSD:

- review-specific tools
- PR and code-review heuristics
- coordinator delegation (until `@relay-assistant/coordination` ships in v1.2)

See `docs/workflows/weekend-delivery-plan.md` for the MSD v1 minimum viable assembly.

### NightCTO-style assistant

Use:

- `core`
- `sessions`
- `surfaces`
- `memory` (v1.1)
- `proactive` (v1.2)
- `coordination` (v1.2)
- `connectivity` (v1.1)
- `policy` (v2)

Keep in NightCTO:

- founder-facing service behavior
- specialist lineup choices
- business escalation and client-tier rules
- per-client memory (until `@relay-assistant/memory` ships in v1.1)
- proactive monitoring (until `@relay-assistant/proactive` ships in v1.2)

See `docs/workflows/weekend-delivery-plan.md` for the NightCTO v1 minimum viable assembly.

---CONNECTIVITY REVIEW VERDICT---
# v1 Connectivity Package Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Reviewer:** v1-connectivity-package-review agent
**Package:** `@relay-assistant/connectivity`
**Files reviewed:**
- `docs/specs/v1-connectivity-spec.md`
- `docs/architecture/v1-connectivity-package-implementation-plan.md`
- `docs/reference/connectivity-signal-catalog.md`
- `docs/specs/v1-routing-spec.md`
- `packages/connectivity/package.json`
- `packages/connectivity/tsconfig.json`
- `packages/connectivity/src/index.ts`
- `packages/connectivity/src/types.ts`
- `packages/connectivity/src/connectivity.ts`
- `packages/connectivity/src/connectivity.test.ts`
- `packages/connectivity/README.md`

---

## 1. Spec Conformance

### Types — PASS

All types in `types.ts` match the canonical spec (§2.1–2.3, §7.2, §8–10) exactly:

| Type | Spec source | Match |
|---|---|---|
| `ConnectivitySignal` | §2.1 | ✓ All 14 fields present, correct optionality |
| `EmitSignalInput` | §2.3 | ✓ Excludes `id`, `emittedAt`, `state` |
| `SignalAudience` | §2.2 | ✓ 4 values |
| `MessageClass` | §2.2 | ✓ 5 values |
| `SignalClass` | §2.2 | ✓ 11 values, matches v1 vocabulary |
| `SignalPriority` | §2.2 | ✓ |
| `SignalState` | §2.2 | ✓ |
| `SignalEvent` | §8.2 | ✓ |
| `RequestedRoutingMode` | §9 | ✓ `'cheap' \| 'fast' \| 'deep'` |
| `SignalQuery` | §8.1 | ✓ Uses `since` per spec; adds `before` (harmless extension) |
| `SuppressionConfig` | §7.2 | ✓ |
| `RoutingEscalationHook` | §9 | ✓ |
| `ConnectivityLayerConfig` | §10 | ✓ |
| `ConnectivityLayer` interface | §8 | ✓ All 8 methods present with matching signatures |
| `SelectedAudienceResolver` | §8.3 | ✓ |
| `SignalCallback` | §8.2 | ✓ |

The implementation plan called for `errors.ts` as a separate file. The implementation places error classes inside `types.ts`. This is a non-functional structural deviation — acceptable.

### `emit()` Orchestration — PASS

The emit order in `connectivity.ts` matches spec §8 and implementation plan Step 8:

1. Validate input ✓
2. Validate `replaces` cross-thread ✓
3. Suppression check (critical bypasses) ✓
4. Supersede target + fire `'superseded'` callback ✓
5. Create signal with `id`, `emittedAt`, `state='emitted'` ✓
6. Store in thread array and by-ID index ✓
7. Routing escalation hook called (wrapped in try/catch) ✓
8. `onSignal(signal, 'emitted')` fired ✓
9. `state` promoted to `'active'` if any callback fired ✓
10. Return signal ✓

### Lifecycle State Machine — PASS

All transitions implemented correctly:
- `emitted → active`: after first `onSignal` callback fires ✓
- `active → superseded`: via `emit(replaces=...)` ✓
- `active → expired`: via `advanceStep()` ✓
- `active → resolved`: via `resolve()` ✓
- Terminal states blocked from further transition ✓
- `resolve()` idempotent for already-resolved signals ✓
- `resolve()` throws `ConnectivityError` for `superseded`/`expired` signals ✓

### Suppression — PASS

Duplicate key: `threadId|source|signalClass|audience` ✓

Suppression rules from spec §7.3:
- Returns existing signal unchanged on duplicate ✓
- `priority='critical'` bypasses suppression ✓
- `priority='high'` escalation with different `summary` bypasses suppression ✓
- Resolved signals do not count as duplicates; new signal is created ✓
- Step-basis: suppresses within same step, resets on `advanceStep()` ✓
- Time-basis: `windowMs` sliding window (defaults to 5000ms) ✓

### Validation — PASS

All rules from spec §2.3 enforced:
- `threadId`, `source`, `summary` non-empty strings ✓
- `messageClass`/`signalClass` cross-consistency check ✓
- `confidence` required for `confidence.*` and `conflict.*` classes ✓
- `confidence` range `[0.0, 1.0]` enforced when present ✓
- Per-class confidence ranges enforced (e.g., `confidence.high` requires `0.8–1.0`) ✓
- `expiresAtStep` must be non-negative integer ✓
- `replaces` must reference a signal in the same `threadId` ✓

### `advanceStep()` — PASS

Increments step counter, scans thread for `expiresAtStep <= currentStep` on non-terminal signals, transitions to `'expired'`, fires `onSignal(signal, 'expired')`. No-op on unknown thread. ✓

### `query()` — PASS

Matches spec §8.1:
- Default state filter `['emitted', 'active']` ✓
- All filters AND-combined, array-valued filters OR-within ✓
- `since`/`before` ISO-8601 time filters ✓
- `limit` defaults to 50 ✓
- `order` defaults to `'newest'` ✓

### Audience Resolution — PASS

| Audience | Behavior | Match |
|---|---|---|
| `self` | `[signal.source]` | ✓ |
| `coordinator` | `['coordinator']` | ✓ |
| `selected` | calls `SelectedAudienceResolver`; `[]` if none registered | ✓ |
| `all` | all thread sources + `'coordinator'` | ✓ |

Per spec: resolved recipients are informational only; `onSignal` fires to all subscribers regardless of audience. ✓

### File Structure Deviation — ACCEPTABLE

The implementation plan specified 24 files (8 runtime + 12 test + 4 integration test). The implementation uses 3 runtime files (`types.ts`, `connectivity.ts`, `index.ts`). All logic from the planned 8 runtime files is correctly consolidated into `connectivity.ts` (~445 lines). This is a pragmatic simplification that does not affect correctness or the public API surface.

### One Spec Deviation — MINOR

The implementation plan §7 explicitly required `"exactOptionalPropertyTypes": true` in `tsconfig.json`. The actual `tsconfig.json` omits this flag. Without it, TypeScript allows assigning `undefined` to optional properties as if they were present (e.g., `{ confidence: undefined }` satisfies `{ confidence?: number }`). The code is likely correct as written, but this weakens the type safety of the `EmitSignalInput` and `ConnectivitySignal` interfaces.

---

## 2. Boundary Cleanliness

### Routing Boundary — PASS

- `RoutingEscalationHook` is an interface defined in connectivity; routing implements it. ✓
- `RequestedRoutingMode` is defined in connectivity; routing re-defines its own mirror (`ConnectivityEscalationSignal`) to avoid circular imports per routing spec §4.7. ✓
- `connectivity.ts` calls `config.routingEscalationHook?.onEscalation(signal)` and ignores the returned mode. ✓
- No `@relay-assistant/routing` in `package.json` dependencies. ✓

### Coordination Boundary — PASS

- Coordination is not imported or referenced anywhere. ✓
- `SelectedAudienceResolver` is registered by coordination, called by connectivity — correct inversion. ✓
- Connectivity never calls coordination. ✓

### Transport / Persistence / Session / Surface Boundary — PASS

- All signals are in-process. ✓
- No network, queue, or storage dependencies. ✓
- `package.json` has exactly one runtime dependency: `nanoid`. ✓

### Public API Surface — NEAR PASS

Spec §15 specifies the exact export surface. The implementation exports everything from spec §15 and additionally exports the runtime constants:

```
MESSAGE_CLASSES, MESSAGE_CLASS_TO_SIGNAL_PREFIX, SIGNAL_AUDIENCES,
SIGNAL_CLASSES, SIGNAL_EVENTS, SIGNAL_PRIORITIES, SIGNAL_STATES, TERMINAL_STATES
```

These are beyond the spec's stated API surface. They do not expose internals (no `SignalLog`, `SuppressionWindow`, etc.) and are useful for downstream consumers doing validation. However, they widen the public API beyond what the spec intended for v1.

---

## 3. Test Coverage Assessment

### What Is Covered — STRONG

The consolidated `connectivity.test.ts` covers all four workflow shapes and the most important behaviors:

| Workflow / Behavior | Covered |
|---|---|
| WF-C1: Narrowcast attention, selected resolver called, signal queryable + resolvable | ✓ |
| WF-C2: Two conflict.active signals queryable; resolve clears them from active set | ✓ (partial — resolves only one, not both) |
| WF-C3: handoff.ready emits and fires onSignal | ✓ |
| WF-C4: escalation.uncertainty triggers hook; hook failure does not block callbacks | ✓ |
| ID format (`sig_<nanoid>`), ISO-8601 timestamp, initial state=emitted | ✓ |
| get() returns null for unknown IDs | ✓ |
| query() by messageClass, state, priority, limit, order, unknown thread | ✓ |
| resolve() emitted→resolved, active→resolved, idempotent | ✓ |
| resolve() throws for unknown signal, superseded signal | ✓ |
| Suppression within step, bypass on resolve, bypass on step advance | ✓ |
| Critical priority bypasses suppression | ✓ |
| High-priority escalation with different summary bypasses suppression | ✓ |
| Time-basis suppression with fake timers | ✓ |
| expiresAtStep expiry on advanceStep | ✓ |
| Already-terminal signals not re-expired | ✓ |
| advanceStep on unknown thread is no-op | ✓ |
| onSignal fires emitted/superseded/resolved/expired events | ✓ |
| offSignal stops delivery | ✓ |
| Callback exception isolation | ✓ |
| Routing hook called for escalation.interrupt and escalation.uncertainty, not for others | ✓ |
| Hook failure does not block onSignal callbacks | ✓ |
| messageClass/signalClass cross-consistency rejected | ✓ |
| Per-class confidence range rejected (confidence.blocker at 0.1) | ✓ |

### What Is Missing — GAPS

These scenarios from the implementation plan's minimum test spec are absent:

| Missing scenario | Plan source |
|---|---|
| `handoff.partial` → `handoff.ready` with `replaces` supersedes the partial signal | `wf-c3.test.ts` test 2 |
| `audience='self'` resolves to `[signal.source]` | `audience.test.ts` |
| `audience='all'` includes all thread sources + coordinator | `audience.test.ts` |
| `audience='selected'` with no resolver returns `[]` | `audience.test.ts` |
| Registering a new resolver replaces the prior one | `audience.test.ts` |
| Different `audience` bypasses suppression | `suppression.test.ts` |
| Superseding a terminal signal throws `ConnectivityError` | `lifecycle.test.ts` |
| Signal without `expiresAtStep` does not expire | `step.test.ts` |
| Signal with `expiresAtStep=2` not expired after one advanceStep | `step.test.ts` |
| EmitSignalInput does not include id/emittedAt/state (structural) | `types.test.ts` |
| Suppressed emit does NOT fire callbacks | `callbacks.test.ts` + `suppression.test.ts` |
| WF-C2: resolving BOTH conflict.active signals clears both from active query | `wf-c2.test.ts` test 2 |

**Overall test count:** approximately 16–20 `it()` blocks vs. the plan's minimum of 60. The plan's 12-file / 60-test target is not met.

---

## 4. Follow-ups Before Integration Work Begins

The following items should be addressed or tracked before `@relay-assistant/connectivity` is integrated as a dependency in `@relay-assistant/coordination` or product code:

### Required Before Integration

**FU-1: Add `exactOptionalPropertyTypes: true` to tsconfig.json**
The implementation plan explicitly required this flag. Without it, optional property semantics are weaker than intended. Risk: low for current code, higher as consumers start passing `EmitSignalInput` objects with explicit `undefined` values.

**FU-2: Add missing test scenarios**
The following gaps should be closed before coordination starts writing integration tests that depend on this package:
- `handoff.partial` → `handoff.ready` supersession (WF-C3 second case)
- `audience='self'` and `audience='all'` resolution paths
- `audience='selected'` with no resolver returns `[]`
- Different `audience` bypasses suppression
- Superseding a terminal signal throws `ConnectivityError`
- Suppressed emit does NOT fire callbacks
- Resolving both conflict signals clears both from active query (WF-C2 complete)

**FU-3: Decide on extra constant exports**
`MESSAGE_CLASSES`, `SIGNAL_CLASSES`, `SIGNAL_AUDIENCES`, `SIGNAL_EVENTS`, `SIGNAL_PRIORITIES`, `SIGNAL_STATES`, `TERMINAL_STATES`, and `MESSAGE_CLASS_TO_SIGNAL_PREFIX` are exported beyond spec §15's stated surface. This is useful for downstream consumers but was not in the spec. Either document these as intentional v1 extensions or remove them before consumers take a dependency.

### Advisory (Can Follow Integration)

**FU-4: Run `tsc --noEmit` and verify zero errors**
The implementation plan's Definition of Done (§9, item 3) requires `tsc --noEmit` to pass with strict mode. This was not independently verified during this review. Run before marking v1 complete.

**FU-5: Verify `advanceStep()` expiry boundary condition**
The expiry condition is `expiresAtStep <= currentStep`. With step-basis suppression, a signal emitted at step 0 with `expiresAtStep=1` should expire after the first `advanceStep()` (step becomes 1, `1 <= 1` is true). This is correct per implementation plan test target. Add an explicit test to lock this behavior before routing integration tests depend on it.

**FU-6: Document the `active` state promotion edge case**
`state='active'` is assigned after callbacks fire, conditioned on `callbacks.size > 0 && signal.state === 'emitted'`. If a callback calls `resolve()` on the signal during the fire loop, the signal lands in `'resolved'` rather than `'active'`. This is correct but worth a comment in the code and a test for coordination's benefit.

---

## Summary

| Dimension | Verdict |
|---|---|
| Type definitions match spec | PASS |

---CONNECTIVITY TYPES---
export type SignalAudience = 'self' | 'coordinator' | 'selected' | 'all';

export type MessageClass =
  | 'attention'
  | 'confidence'
  | 'conflict'
  | 'handoff'
  | 'escalation';

export type SignalClass =
  | 'attention.raise'
  | 'confidence.high'
  | 'confidence.medium'
  | 'confidence.low'
  | 'confidence.blocker'
  | 'conflict.active'
  | 'conflict.resolved'
  | 'handoff.ready'
  | 'handoff.partial'
  | 'escalation.interrupt'
  | 'escalation.uncertainty';

export type SignalPriority = 'low' | 'normal' | 'high' | 'critical';
export type SignalState = 'emitted' | 'active' | 'superseded' | 'expired' | 'resolved';
export type SignalEvent = 'emitted' | 'superseded' | 'resolved' | 'expired';
export type RequestedRoutingMode = 'cheap' | 'fast' | 'deep';

export interface ConnectivitySignal {
  id: string;
  threadId: string;
  source: string;
  audience: SignalAudience;
  messageClass: MessageClass;
  signalClass: SignalClass;
  priority: SignalPriority;
  confidence?: number;
  summary: string;
  details?: string;
  replaces?: string;
  expiresAtStep?: number;
  emittedAt: string;
  state: SignalState;
}

export interface EmitSignalInput {
  threadId: string;
  source: string;
  audience: SignalAudience;
  messageClass: MessageClass;
  signalClass: SignalClass;
  priority: SignalPriority;
  summary: string;
  confidence?: number;
  details?: string;
  replaces?: string;
  expiresAtStep?: number;
}

export interface SignalQuery {
  threadId: string;
  source?: string;
  messageClass?: MessageClass | MessageClass[];
  signalClass?: SignalClass | SignalClass[];
  state?: SignalState | SignalState[];
  priority?: SignalPriority | SignalPriority[];
  since?: string;
  before?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
}

export interface SuppressionConfig {
  basis: 'step' | 'time';
  windowMs?: number;
}

export interface RoutingEscalationHook {
  onEscalation(signal: ConnectivitySignal): RequestedRoutingMode | void;
}

export type SelectedAudienceResolver = (signal: ConnectivitySignal) => string[];
export type SignalCallback = (signal: ConnectivitySignal, event: SignalEvent) => void;

export interface ConnectivityLayerConfig {
  suppressionConfig?: SuppressionConfig;
  routingEscalationHook?: RoutingEscalationHook;
}

export interface ConnectivityLayer {
  emit(input: EmitSignalInput): ConnectivitySignal;
  resolve(signalId: string): ConnectivitySignal;
  get(signalId: string): ConnectivitySignal | null;
  query(query: SignalQuery): ConnectivitySignal[];
  advanceStep(threadId: string): void;
  registerSelectedResolver(resolver: SelectedAudienceResolver): void;
  onSignal(callback: SignalCallback): void;
  offSignal(callback: SignalCallback): void;
}

export const SIGNAL_AUDIENCES = [
  'self',
  'coordinator',
  'selected',
  'all',
] as const satisfies readonly SignalAudience[];

export const MESSAGE_CLASSES = [
  'attention',
  'confidence',
  'conflict',
  'handoff',
  'escalation',
] as const satisfies readonly MessageClass[];

export const SIGNAL_CLASSES = [
  'attention.raise',
  'confidence.high',
  'confidence.medium',
  'confidence.low',
  'confidence.blocker',
  'conflict.active',
  'conflict.resolved',
  'handoff.ready',
  'handoff.partial',
  'escalation.interrupt',
  'escalation.uncertainty',
] as const satisfies readonly SignalClass[];

export const SIGNAL_PRIORITIES = [
  'low',
  'normal',
  'high',
  'critical',
] as const satisfies readonly SignalPriority[];

export const SIGNAL_STATES = [
  'emitted',
  'active',
  'superseded',
  'expired',
  'resolved',
] as const satisfies readonly SignalState[];

export const SIGNAL_EVENTS = [
  'emitted',
  'superseded',
  'resolved',
  'expired',
] as const satisfies readonly SignalEvent[];

export const MESSAGE_CLASS_TO_SIGNAL_PREFIX: Record<MessageClass, string> = {
  attention: 'attention.',
  confidence: 'confidence.',
  conflict: 'conflict.',
  handoff: 'handoff.',
  escalation: 'escalation.',
};

export const TERMINAL_STATES = [
  'superseded',
  'expired',
  'resolved',
] as const satisfies readonly SignalState[];

export class ConnectivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectivityError';
  }
}

export class SignalValidationError extends ConnectivityError {
  constructor(message: string) {
    super(message);
    this.name = 'SignalValidationError';
  }
}

export class SignalNotFoundError extends ConnectivityError {
  constructor(signalId: string) {
    super(`Signal not found: ${signalId}`);
    this.name = 'SignalNotFoundError';
  }
}

---CONNECTIVITY IMPLEMENTATION---
import { nanoid } from 'nanoid';

import {
  ConnectivityError,
  MESSAGE_CLASSES,
  MESSAGE_CLASS_TO_SIGNAL_PREFIX,
  SIGNAL_AUDIENCES,
  SIGNAL_CLASSES,
  SIGNAL_PRIORITIES,
  SIGNAL_STATES,
  SignalNotFoundError,
  SignalValidationError,
  TERMINAL_STATES,
} from './types.js';
import type {
  ConnectivityLayer,
  ConnectivityLayerConfig,
  ConnectivitySignal,
  EmitSignalInput,
  MessageClass,
  SelectedAudienceResolver,
  SignalCallback,
  SignalEvent,
  SignalPriority,
  SignalQuery,
  SignalState,
  SuppressionConfig,
} from './types.js';

const DEFAULT_LIMIT = 50;
const DEFAULT_SUPPRESSION_CONFIG: SuppressionConfig = {
  basis: 'step',
};

const CLASS_CONFIDENCE_RULES: Partial<Record<ConnectivitySignal['signalClass'], [number, number]>> = {
  'confidence.high': [0.8, 1.0],
  'confidence.medium': [0.4, 0.79],
  'confidence.low': [0.1, 0.39],
  'confidence.blocker': [0.0, 0.0],
  'conflict.active': [0.0, 1.0],
  'conflict.resolved': [0.0, 1.0],
};

function nowIso(): string {
  return new Date().toISOString();
}

function generateSignalId(): string {
  return `sig_${nanoid()}`;
}

function toArray<T>(value?: T | T[]): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}

function isTerminalState(state: SignalState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new SignalValidationError(`Invalid ${label}: ${value}`);
  }
}

function validateConfidenceForSignal(input: EmitSignalInput): void {
  const confidenceRequired =
    input.messageClass === 'confidence' || input.messageClass === 'conflict';

  if (confidenceRequired && input.confidence === undefined) {
    throw new SignalValidationError(
      `confidence is required for ${input.messageClass} signals`,
    );
  }

  if (input.confidence === undefined) {
    return;
  }

  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new SignalValidationError('confidence must be between 0.0 and 1.0');
  }

  const rule = CLASS_CONFIDENCE_RULES[input.signalClass];
  if (!rule) {
    return;
  }

  const [min, max] = rule;
  if (input.confidence < min || input.confidence > max) {
    throw new SignalValidationError(
      `confidence for ${input.signalClass} must be between ${min} and ${max}`,
    );
  }
}

function validateEmitInput(input: EmitSignalInput): void {
  if (!isNonEmptyString(input.threadId)) {
    throw new SignalValidationError('threadId must be a non-empty string');
  }

  if (!isNonEmptyString(input.source)) {
    throw new SignalValidationError('source must be a non-empty string');
  }

  if (!isNonEmptyString(input.summary)) {
    throw new SignalValidationError('summary must be a non-empty string');
  }

  assertEnum(input.audience, SIGNAL_AUDIENCES, 'audience');
  assertEnum(input.messageClass, MESSAGE_CLASSES, 'messageClass');
  assertEnum(input.signalClass, SIGNAL_CLASSES, 'signalClass');
  assertEnum(input.priority, SIGNAL_PRIORITIES, 'priority');

  const expectedPrefix = MESSAGE_CLASS_TO_SIGNAL_PREFIX[input.messageClass];
  if (!input.signalClass.startsWith(expectedPrefix)) {
    throw new SignalValidationError(
      `signalClass ${input.signalClass} does not match messageClass ${input.messageClass}`,
    );
  }

  if (
    input.expiresAtStep !== undefined &&
    (!Number.isInteger(input.expiresAtStep) || input.expiresAtStep < 0)
  ) {
    throw new SignalValidationError('expiresAtStep must be a non-negative integer');
  }

  validateConfidenceForSignal(input);
}

function getDuplicateKey(input: EmitSignalInput): string {
  return `${input.threadId}|${input.source}|${input.signalClass}|${input.audience}`;
}

function fireCallbacks(
  callbacks: Set<SignalCallback>,
  signal: ConnectivitySignal,
  event: SignalEvent,
): void {
  for (const callback of callbacks) {
    try {
      callback(signal, event);
    } catch (error) {
      console.error('Connectivity signal callback failed', error);
    }
  }
}

function resolveAudience(
  signal: ConnectivitySignal,
  threadSignals: ConnectivitySignal[],
  selectedResolver?: SelectedAudienceResolver,
): string[] {
  switch (signal.audience) {
    case 'self':
      return [signal.source];
    case 'coordinator':
      return ['coordinator'];
    case 'selected':
      return selectedResolver ? selectedResolver(signal) : [];
    case 'all': {
      const recipients = new Set<string>(['coordinator']);
      for (const candidate of threadSignals) {
        recipients.add(candidate.source);
      }
      return [...recipients];
    }
    default:
      return [];
  }
}

function shouldSuppress(
  input: EmitSignalInput,
  candidates: ConnectivitySignal[],
  suppressionConfig: SuppressionConfig,
  currentStep: number,
  emittedSteps: Map<string, number>,
): ConnectivitySignal | null {
  if (input.priority === 'critical') {
    return null;
  }

  const duplicateKey = getDuplicateKey(input);
  for (const existing of candidates) {
    if (isTerminalState(existing.state)) {
      continue;
    }

    if (getDuplicateKey(existing) !== duplicateKey) {
      continue;
    }

    if (
      input.priority === 'high' &&
      input.messageClass === 'escalation' &&
      existing.summary !== input.summary
    ) {
      continue;
    }

    if (suppressionConfig.basis === 'step') {
      const emittedStep = emittedSteps.get(existing.id);
      if (emittedStep === currentStep) {
        return existing;
      }
      continue;
    }

    const windowMs = suppressionConfig.windowMs ?? 5_000;
    if (Date.now() - Date.parse(existing.emittedAt) <= windowMs) {
      return existing;
    }
  }

  return null;
}

function ensureMutableSignal(signal: ConnectivitySignal): void {
  if (isTerminalState(signal.state)) {
    throw new ConnectivityError(
      `Signal ${signal.id} is already in terminal state ${signal.state}`,
    );
  }
}

function filterByEnum<T extends string>(value: T, filter?: T[]): boolean {
  if (!filter || filter.length === 0) {
    return true;
  }

  return filter.includes(value);
}

export function createConnectivityLayer(
  config: ConnectivityLayerConfig = {},
): ConnectivityLayer {
  const suppressionConfig = config.suppressionConfig ?? DEFAULT_SUPPRESSION_CONFIG;
  const signalsByThread = new Map<string, ConnectivitySignal[]>();
  const signalsById = new Map<string, ConnectivitySignal>();
  const stepsByThread = new Map<string, number>();
  const emittedSteps = new Map<string, number>();
  const callbacks = new Set<SignalCallback>();
  let selectedResolver: SelectedAudienceResolver | undefined;

  const getThreadSignals = (threadId: string): ConnectivitySignal[] => {
    return signalsByThread.get(threadId) ?? [];
  };

  const getSignal = (signalId: string): ConnectivitySignal => {
    const signal = signalsById.get(signalId);
    if (!signal) {
      throw new SignalNotFoundError(signalId);
    }
    return signal;
  };

  return {
    emit(input) {
      validateEmitInput(input);

      if (input.replaces) {
        const replaced = getSignal(input.replaces);
        if (replaced.threadId !== input.threadId) {
          throw new SignalValidationError(
            `replaces must reference a signal in thread ${input.threadId}`,
          );
        }
      }

      const currentStep = stepsByThread.get(input.threadId) ?? 0;
      const threadSignals = getThreadSignals(input.threadId);
      const suppressed = shouldSuppress(
        input,
        threadSignals,
        suppressionConfig,
        currentStep,
        emittedSteps,
      );
      if (suppressed) {
        return suppressed;
      }

      if (input.replaces) {
        const replaced = getSignal(input.replaces);
        ensureMutableSignal(replaced);
        replaced.state = 'superseded';
        fireCallbacks(callbacks, replaced, 'superseded');
      }

      const signal: ConnectivitySignal = {
        ...input,
        id: generateSignalId(),
        emittedAt: nowIso(),
        state: 'emitted',
      };

      const nextThreadSignals = [...threadSignals, signal];
      signalsByThread.set(input.threadId, nextThreadSignals);
      signalsById.set(signal.id, signal);
      emittedSteps.set(signal.id, currentStep);

      resolveAudience(signal, nextThreadSignals, selectedResolver);

      if (
        signal.signalClass === 'escalation.interrupt' ||
        signal.signalClass === 'escalation.uncertainty'
      ) {
        try {
          config.routingEscalationHook?.onEscalation(signal);
        } catch (error) {
          console.error('Connectivity routing escalation hook failed', error);
        }
      }

      fireCallbacks(callbacks, signal, 'emitted');
      // A callback may resolve the signal during the emitted event loop. In that case
      // the state has already moved past emitted and must not be promoted to active.
      if (callbacks.size > 0 && signal.state === 'emitted') {
        signal.state = 'active';
      }

      return signal;
    },

    resolve(signalId) {
      const signal = getSignal(signalId);
      if (signal.state === 'resolved') {
        return signal;
      }

      if (signal.state === 'superseded' || signal.state === 'expired') {
        throw new ConnectivityError(
          `Cannot resolve signal ${signalId} from terminal state ${signal.state}`,
        );
      }

      signal.state = 'resolved';
      fireCallbacks(callbacks, signal, 'resolved');
      return signal;
    },

    get(signalId) {
      return signalsById.get(signalId) ?? null;
    },

    query(query) {

---FOUNDATION INTEGRATION REVIEW---
# v1 Foundation Integration Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Reviewer:** Non-interactive review agent
**Scope:** WF-4 (core + sessions) and WF-6 (core + sessions + surfaces)
**Artifacts reviewed:**
- `docs/architecture/v1-foundation-integration-plan.md`
- `packages/core/src/core.ts`
- `packages/core/src/core-sessions.test.ts`
- `packages/core/src/core-sessions-surfaces.test.ts`
- `packages/sessions/src/sessions.ts`
- `packages/surfaces/src/surfaces.ts`
- `docs/architecture/v1-core-review-verdict.md`
- `docs/architecture/v1-sessions-review-verdict.md`
- `docs/architecture/v1-surfaces-review-verdict.md`

---

## 1. Do the Integration Tests Actually Prove WF-4 and WF-6 Behavior?

### WF-4 Coverage (`core-sessions.test.ts`)

The plan specified 9 tests. All 9 are present and correctly exercising the intended behaviors.

| Plan item | Test name | Result |
|---|---|---|
| 2.1 — Subsystem registration | "registers the session store as a runtime subsystem" | ✅ |
| 2.2 — Session resolution (new) + touch | "resolves a new session on first message, attaches the surface, and touches it active" | ✅ |
| 2.2 — Session resolution (existing) | "resolves the existing session for subsequent messages" | ✅ |
| 2.3 — Emit → session → per-surface send | "emits to every surface attached to the session when fanout is unavailable" | ✅ |
| 2.3 — Emit → session → fanout | "uses outbound fanout when the adapter exposes it" | ✅ |
| 2.5 — Nonexistent sessionId throws | "throws when emit references a nonexistent session" | ✅ |
| 2.5 — No routing target throws OutboundEventError | "throws OutboundEventError when emit lacks both surfaceId and sessionId" | ✅ |
| 2.4 — Touch updates lastActivityAt | "updates lastActivityAt when the session is touched during dispatch integration" | ✅ with gap (see §4) |
| WF-4 2.4 — Attach/detach affects fanout | "reflects surface attach and detach effects in runtime fanout targets" | ✅ |

**Finding:** All 9 behaviors are exercised. The WF-4 proof is substantially complete.

**One weak point — test 8 ("dispatch integration"):** The test title implies wiring through `runtime.dispatch()`, but the test calls `resolveSession()` directly with a mock resolver. `resolveSession` is shown to call `store.touch()`, which is correct. However, the path from `runtime.dispatch()` → capability handler → `resolveSession()` → `store.touch()` is NOT exercised end-to-end in this test. Plan spec item 2.4 states "every dispatch through the integration path calls `store.touch(sessionId)`" — but since session touching is a responsibility of capability handlers (not the runtime itself), the test validates the mechanism but not the wiring. This is a naming/scoping mismatch, not a correctness failure, but it's worth clarifying in follow-ups.

### WF-6 Coverage (`core-sessions-surfaces.test.ts`)

The plan specified 10 tests. The implementation consolidates some into 6 tests that collectively cover all 10 plan behaviors.

| Plan item | Covered by | Result |
|---|---|---|
| 3.1 — Registry as inbound+outbound adapter | Test 1 | ✅ |
| 3.2 — receiveRaw → normalize → dispatch → handler fires | Test 2 | ✅ |
| 3.3 — Handler emits → sessionId → fanout → all surfaces | Test 2 | ✅ |
| 3.4 — Attach expands fanout targets | Test 3 | ✅ |
| 3.4 — Detach shrinks fanout targets | Test 3 | ✅ |
| 3.6 — Inactive surface skipped (default policy) | Test 4 | ✅ |
| 3.5 — Full lifecycle start → receive → emit → stop | Test 2 (implicitly), Test 5 | ✅ |
| 3.5 — Stop drains in-flight handlers | Test 5 | ✅ |
| Normalization drop (missing userId) | Test 6 | ✅ |
| maxConcurrentHandlers enforced | Test 5 | ✅ |

**Finding:** All 10 WF-6 behaviors are exercised. The consolidation is pragmatic and the combined tests are readable. Test 5 correctly validates both drain-on-stop and concurrency limiting in one well-structured scenario.

**One compositional note — Test 2:** This test is complex and multi-purpose (inbound normalization + session resolution + emit + fanout in one test). If it fails, the failure site is harder to identify. The plan intended these as separate tests. This is acceptable for v1 but slightly reduces diagnostic clarity.

---

## 2. Are the Package Interactions Clean and Spec-Aligned?

### Core ↔ Sessions

**Duck-type contract (clean):** `core.ts` defines an internal `SessionSubsystem` type that accepts either `{ get(id) }` or `{ getSession(id) }`. `SessionStore.get(sessionId)` satisfies the `get` branch. `Session` is a structural superset of `SessionRecord`. No adapter or wrapper is needed. This was pre-verified with a compile-time contract check in the sessions test file.

**Registration pattern (clean):** `runtime.register('sessions', store)` / `runtime.get<SessionStore>('sessions')` is direct and type-safe via the generic.

**Emit path (correct):** `core.ts:resolveAttachedSurfaces()` (lines 165–179) correctly calls either `getSession` or `get` depending on what the registered subsystem exposes, then copies `attachedSurfaces` defensively.

### Core ↔ Surfaces

**Adapter contract (clean):** `surfaces.ts` defines local `CoreInboundAdapterShape` and `CoreOutboundAdapterShape` types that mirror core's `RelayInboundAdapter` and `RelayOutboundAdapter` without importing from core. `createSurfaceRegistry()` returns the intersection type. The surfaces test file has compile-time contract checks (`const _inboundContractCheck: CoreInboundAdapter = createSurfaceRegistry()`).

**Fanout return-type asymmetry (acceptable):** `surfaces.ts:fanout()` returns `Promise<FanoutResult>`, but `CoreOutboundAdapterShape.fanout?` specifies `Promise<void>`. This is reconciled via a `as` type assertion on line 196. This works correctly because `core.ts` ignores the fanout return value (just `await`s it). However, `Promise<FanoutResult>` is assignable to `Promise<void>` in TypeScript's structural system, so the `as` cast is defensively correct but introduces an implicit contract that should be confirmed at compile time rather than only at runtime. See follow-up item I-1.

**Fanout third parameter (acceptable):** `surfaces.ts:fanout()` accepts an optional third `policy?` parameter not present in `CoreOutboundAdapterShape`. TypeScript allows extra optional parameters in function types, so the structural assignment is valid. This is a non-issue.

### Sessions ↔ Surfaces

**Correct absence of coupling:** Surfaces does not import sessions. The fanout receives `string[]` of surfaceIds, with session-to-surfaceId resolution performed in `core.ts:resolveAttachedSurfaces()`. The dependency direction is correct: `core → sessions` (session resolution), `core → surfaces` (delivery). `surfaces → sessions` coupling is absent.

---

## 3. Were Changes Kept Narrow and Integration-Focused?

**Yes.** The plan explicitly stated "None expected" for changes to `core.ts`, `sessions.ts`, and `surfaces.ts`. The implementation delivered this constraint exactly:

- Two new test files were created: `core-sessions.test.ts` and `core-sessions-surfaces.test.ts`.
- No modifications to the three package implementation files were required to make the integration tests pass.
- The tests import from package source files directly without introducing new exports, types, or adapters.
- Tests use `InMemorySessionStoreAdapter` with no external dependencies.
- Surface adapters in WF-6 tests are simple mock objects tracking sent payloads.
- No new packages, no cloud assumptions, no product-specific logic were introduced.

This confirms the plan's key architectural claim: the three packages were designed with these integration contracts already in mind and required no retroactive changes to satisfy cross-package use.

---

## 4. Follow-ups Before Moving to the Next Package Layers

The following items are ordered by priority. Items marked **MUST** block progression to the next phase. Items marked **SHOULD** are recommended before the next phase. Advisory items can be deferred.

### I-1 — Clarify the `fanout()` return-type mismatch at compile time [SHOULD]

**Current state:** `surfaces.ts` returns `registry as SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape` using a type assertion. `fanout()` returns `Promise<FanoutResult>` while `CoreOutboundAdapterShape.fanout` declares `Promise<void>`.

**Risk:** The `as` cast suppresses compile-time enforcement of the return type. If `core.ts` is ever updated to read the fanout result, the mismatch would silently produce `undefined` instead of a `FanoutResult`.

**Action:** Either (a) update `CoreOutboundAdapterShape.fanout` to return `Promise<void | FanoutResult>`, or (b) add a compile-time narrowing check in the surfaces test alongside the existing contract checks, verifying the fanout return type is at minimum compatible with `Promise<void>`.

---

### I-2 — Rename or clarify test 8 in `core-sessions.test.ts` [SHOULD]

**Current state:** The test is named "updates lastActivityAt when the session is touched during dispatch integration" but does not call `runtime.dispatch()`. It tests `resolveSession()` directly.

**Risk:** Future contributors may expect a full dispatch loop in this test and be misled by the title.

**Action:** Either (a) rename the test to "resolveSession touches the session and updates lastActivityAt" to match what it actually does, or (b) extend it to push a message through `runtime.dispatch()` with a capability handler that calls `resolveSession`, then assert the updated timestamp. Option (b) would close the proof gap for spec item 2.4 more completely.

---

### I-3 — Add a dedicated end-to-end lifecycle test in `core-sessions-surfaces.test.ts` [SHOULD]

**Current state:** The full lifecycle path (start → receive → dispatch → emit → fanout → stop) is covered by test 2 implicitly and test 5 partially, but there is no single test that exercises all steps together while asserting clean shutdown.

**Action:** Add a focused test matching plan item 3.5 ("Full runtime lifecycle") with explicit assertions on `runtime.status().ready` before and after stop, and that no in-flight handlers remain. This improves diagnostic clarity without duplicating existing coverage.

---

### Carried-over items (not yet resolved)

The following follow-ups from prior package reviews remain open and are unaffected by the integration work:

| Item | Source | Priority | Description |
|---|---|---|---|
| C-4.1 | Core review | SHOULD | Add test for missing `name` validation |
| C-4.2 | Core review | SHOULD | Export `SessionSubsystem` from core types |
| C-4.3 | Core review | ADVISORY | Document stop-drain timeout behavior |
| S-F-2 | Sessions review | SHOULD | Add expire() from created/suspended state tests |
| S-F-3 | Sessions review | SHOULD | Expand find() query filter tests |
| S-F-4 | Sessions review | MINOR | Remove dead `?? defaultTtlMs` in sweepStale |
| S-F-5 | Sessions review | MINOR | Document MAX_SAFE_INTEGER bypass in sweepStale |
| S-F-6 | Sessions review | OPEN | Resolve OQ-2 (max surfaces) and OQ-3 (delete vs. retain) |
| Su-F-1 | Surfaces review | SHOULD | Resolve OQ-2: send() behavior for inactive surfaces |
| Su-F-2 | Surfaces review | SHOULD | Add concurrency test for fanout |
| Su-F-6 | Surfaces review | NICE | Document normalizationHook null/undefined drop behavior |

Items S-F-6 (OQ-2, OQ-3) and Su-F-1 (inactive surface in send()) are the most load-bearing of the carried items. OQ-2 in particular needs an owner and resolution before WF-7 assembly, since it affects session attachment limits which are exercised in the integration tests.

---

## Summary

| Dimension | Result |
|---|---|
| WF-4 behaviors proved (9/9 plan items) | ✅ All covered; one naming/scoping note on test 8 |
| WF-6 behaviors proved (10/10 plan items) | ✅ All covered; some tests are composite |
| Package interaction cleanliness | ✅ Clean; one return-type asymmetry worth confirming at compile time |
| Spec alignment of package contracts | ✅ Correct; duck-typing verified structurally |
| Scope discipline (no spurious package changes) | ✅ Strictly integration-test-only additions |
| Prior required follow-ups fulfilled | ✅ Sessions F-1 and Surfaces F-3/F-4 (WF-4, WF-6 integration tests) complete |
| New follow-ups introduced | 3 items (I-1 through I-3), all SHOULD or lower |

The v1 foundation integration is functionally complete and correct. The three packages wire together as the spec intended, with no glue code, no retroactive modifications, and no cross-package runtime imports. The integration tests cover all planned behaviors across both WF-4 and WF-6.

**VERDICT: PASS_WITH_FOLLOWUPS**

The foundation is ready for the next package layers (connectivity, memory, policy). The three new follow-up items (I-1 through I-3) should be resolved during that phase or as a targeted patch before WF-7 assembly begins.

---

V1_FOUNDATION_INTEGRATION_REVIEW_COMPLETE
