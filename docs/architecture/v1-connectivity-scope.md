# v1 Connectivity Scope — `@relay-assistant/connectivity`

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Date:** 2026-04-11
**Status:** SCOPE_LOCKED
**Prerequisite:** v1 foundation integration (core + sessions + surfaces) — PASS_WITH_FOLLOWUPS

---

## 1. What v1 Connectivity Absolutely Includes

### 1.1 Signal Envelope and Types

The package exports `ConnectivitySignal` and all supporting types as the canonical signal contract. Every signal carries:

- `id` — unique within the thread, assigned by the layer on emit
- `threadId` — scopes the signal to a coordination context
- `source` — identifies the emitting component
- `audience` — semantic delivery intent (`self`, `coordinator`, `selected`, `all`)
- `messageClass` — broad intent category (one of five; see §4)
- `signalClass` — narrow semantic within the message class (one of eleven; see §4)
- `priority` — routing urgency (`low`, `normal`, `high`, `critical`)
- `confidence` — optional numeric stability grade (0.0–1.0), required for confidence and conflict signals
- `summary` — one-sentence description, required, used for suppression deduplication
- `details` — optional compact extension, not a transcript
- `replaces` — optional signal ID; triggers supersession of the replaced signal
- `expiresAtStep` — optional step number for automatic expiry
- `emittedAt` — ISO-8601 timestamp, set by the layer
- `state` — lifecycle state, managed by the layer

### 1.2 Signal Lifecycle State Machine

```
emitted ──► active ──► superseded   (a newer signal with `replaces` targeting this ID)
                   └──► expired      (expiresAtStep reached via advanceStep)
                   └──► resolved     (explicitly resolved by emitter or coordinator)
```

Five states: `emitted`, `active`, `superseded`, `expired`, `resolved`. The signal log retains all signals regardless of terminal state. State transitions are updated in place.

### 1.3 In-Memory Signal Log

A `Map<threadId, ConnectivitySignal[]>` storing all signals for all active threads. Supports:

- `emit(input)` — create and store a signal, assign id and timestamp, return stored signal
- `get(signalId)` — retrieve a single signal by ID
- `query(query)` — retrieve signals with filters by source, messageClass, signalClass, state, priority, time range, with limit and sort order
- `resolve(signalId)` — transition a signal to `resolved`, idempotent
- `advanceStep(threadId)` — increment step counter, expire signals past their `expiresAtStep`

### 1.4 Suppression

Duplicate detection prevents redundant signals within a suppression window. Two signals are duplicates when they share the same `threadId` + `source` + `signalClass` + `audience` and neither has been resolved or superseded.

Suppression basis is configurable:

- **step-basis** — duplicates suppressed within the same step; `advanceStep()` resets the window
- **time-basis** — duplicates suppressed within a configurable `windowMs` (default 5000ms)

When suppressed, `emit()` returns the existing signal unchanged. Callers detect suppression by comparing the returned signal's `id` to what they expected.

### 1.5 Callback System

- `onSignal(callback)` — register a callback fired on every `emitted`, `superseded`, `resolved`, and `expired` event
- `offSignal(callback)` — remove a previously registered callback

This is the primary integration point. Coordination and routing layers subscribe to signal events without polling.

### 1.6 Audience Resolution

- `self`, `coordinator`, `all` — resolved by the layer directly based on the thread's registered components
- `selected` — resolved by calling a `SelectedAudienceResolver` function registered by the coordination layer

The `registerSelectedResolver(resolver)` method accepts a function `(signal: ConnectivitySignal) => string[]` that returns the component IDs to notify. Coordination owns the resolver implementation. Connectivity owns the interface.

### 1.7 Routing Escalation Hook

Connectivity can influence routing decisions without owning routing (see §5 for full treatment). The v1 mechanism:

- `ConnectivityLayerConfig` accepts an optional `routingEscalationHook: RoutingEscalationHook`
- When an escalation signal (`escalation.interrupt` or `escalation.uncertainty`) is emitted, `emit()` synchronously calls `routingEscalationHook.onEscalation(signal)`
- The hook returns `RequestedRoutingMode` (`'cheap' | 'fast' | 'deep'`) or `void`
- Connectivity does not act on the returned mode. It is the routing layer's responsibility to apply or ignore it.

### 1.8 Factory Function

```typescript
createConnectivityLayer(config?: ConnectivityLayerConfig): ConnectivityLayer
```

Returns a thread-aware layer. Multiple threads share one instance. All state is in-process in v1.

### 1.9 Four Workflow Shapes

The following workflows are proved in v1 integration tests:

| ID | Name | Signal path |
|---|---|---|
| WF-C1 | Narrowcast attention | Specialist → emit(attention.raise, selected) → audience resolver → onSignal → coordination reads |
| WF-C2 | Reviewer conflict | Specialist A → emit(conflict.active, coordinator) → onSignal → coordination queries → arbitrates → resolve() |
| WF-C3 | Specialist handoff | Specialist A → emit(handoff.ready, selected) → onSignal → downstream specialist begins → coordination resolves |
| WF-C4 | Blocker uncertainty routing | Specialist → emit(escalation.uncertainty, high) → routingEscalationHook → routing returns mode → onSignal → coordination adjusts |

### 1.10 Package Boundary and Dependency Rules

| Direction | Rule |
|---|---|
| Connectivity → core | Allowed. Import types only. |
| Connectivity → routing | Import `RequestedRoutingMode` type only. Never call routing methods directly. |
| Connectivity → sessions | Forbidden. |
| Connectivity → surfaces | Forbidden. |
| Connectivity → memory | Forbidden. |
| Connectivity → coordination | Forbidden. Coordination depends on connectivity, not vice versa. |
| Coordination → connectivity | Allowed. Coordination imports and uses `ConnectivityLayer`. |
| Routing → connectivity | Allowed. Routing implements `RoutingEscalationHook`. |

---

## 2. What Is Explicitly Deferred Beyond v1

### 2.1 Not in v1

| Capability | Reason for deferral | Target |
|---|---|---|
| Distributed / cross-process signal delivery | v1 is single-process; distribution requires transport integration | v1.2+ |
| Persistent signal log | In-memory only; persistence requires storage adapter | v1.2+ |
| Signal log retention beyond thread lifetime | Signals scoped to thread; cross-thread history requires persistence | v1.2+ |
| Tenant-aware signal routing | No multi-tenant semantics in v1; cloud concern | Cloud adapter |
| Cloud observability pipelines | OSS logging only; hosted telemetry is adapter-based | Cloud adapter |
| Product-specific signal classes | The 5 message classes and 11 signal classes are the complete v1 vocabulary; products do not add custom classes in v1 | v1.1+ |
| Provider-specific real-time delivery | In-process callbacks only; WebSocket/SSE delivery is product concern | Product layer |
| Async `emit()` | v1 `emit()` is synchronous; async complicates call sites and is unnecessary without distributed delivery | v1.2 (with distribution) |
| Maximum active signals per thread | No cap in v1; runaway signaling protection deferred | v1.1 |
| Broadcast suppression policy | No differentiated suppression for `audience='all'` vs narrowcast | Before WF-C2 hardening |
| Queued vs immediate routing mode application | v1 applies routing hints immediately via hook; queuing deferred | Before WF-C4 hardening |

### 2.2 Boundaries That Will Not Move

These are permanent scope exclusions, not deferrals:

- Connectivity will never own model invocations or reasoning
- Connectivity will never own message routing decisions (routing's job)
- Connectivity will never own coordinator/specialist orchestration (coordination's job)
- Connectivity will never own session or surface management
- Connectivity will never be a generic pub/sub system with topics and subscriptions
- Connectivity will never produce user-visible messages; signals are internal only

---

## 3. Connectivity vs Adjacent Packages

### 3.1 Connectivity vs Coordination

| Dimension | Connectivity | Coordination |
|---|---|---|
| Core question | "What signal should move between participants right now?" | "Who is doing what work?" |
| Owns | Signal envelope, lifecycle, suppression, audience resolution, escalation hook | Specialist assignment, output collection, synthesis orchestration |
| Call direction | Coordination calls connectivity (`emit`, `query`, `resolve`, `onSignal`). Connectivity never calls coordination. | Coordination provides `SelectedAudienceResolver` to connectivity. |
| Example | Reviewer emits `conflict.active` to coordinator | Coordinator decides whether to re-delegate or arbitrate after receiving the conflict signal |

The boundary is strict: connectivity is the signaling mechanism; coordination is the decision-maker that uses signals as input. Coordination registers an `onSignal` callback to react. Coordination provides the `SelectedAudienceResolver` so connectivity can resolve `audience='selected'` without knowing the coordination topology.

### 3.2 Connectivity vs Routing

| Dimension | Connectivity | Routing |
|---|---|---|
| Core question | "What urgency and confidence does this signal carry?" | "What model tier and cost envelope should this invocation use?" |
| Owns | Signal classes, priority levels, escalation emission | Mode selection (`cheap`/`fast`/`deep`), model spec, cost tracking |
| Call direction | One-directional: connectivity calls routing's `RoutingEscalationHook.onEscalation()` during escalation emit. Routing never calls connectivity. | Routing implements `RoutingEscalationHook` and registers it with connectivity at initialization. |
| Example | Specialist emits `escalation.uncertainty` with `priority='high'` → connectivity calls hook | Router receives the signal, returns `'deep'` as requested mode, applies it to subsequent `decide()` calls |

Connectivity does not know what routing does with the escalation. Routing does not emit signals. The interface between them is a single hook with a single method.

### 3.3 Connectivity vs Relay Transport

| Dimension | Connectivity | Relay Transport |
|---|---|---|
| Core question | "Why does this signal exist, who should see it, and when can it be dropped?" | "How do bytes move from A to B?" |
| Owns | Signal semantics, audience intent, suppression, lifecycle | Delivery infrastructure, queues, connections, retries |
| Interaction in v1 | None. Signals are in-process. No transport layer involved. | Transport delivers user-facing messages via surfaces, not internal signals. |
| Future interaction | When signals cross process boundaries (v1.2+), transport becomes the delivery mechanism for signals. Connectivity will define signal serialization; transport will deliver it. | Transport will gain a signal delivery adapter alongside its existing message delivery. |

In v1, connectivity has zero runtime dependency on transport. Signals are function calls and callbacks within a single Node process.

---

## 4. Minimum Signal Classes and Semantics

### 4.1 Message Classes (5)

| Class | Semantic | When to use |
|---|---|---|
| `attention` | Something another component should consider; not urgent | Memory finds context that changes likely intent; retrieval finds contradictory background |
| `confidence` | Stability grade of a specialist's current output | Specialist declares how trustworthy its result is before synthesis consumes it |
| `conflict` | Two active views disagree in a way that affects the final answer | Reviewer evidence contradicts the current draft; two specialists propose incompatible actions |
| `handoff` | Downstream component can proceed; this specialist is done with its step | Planner finished a plan; reviewer completed a pass; memory enrichment is ready for synthesis |
| `escalation` | Current path should change immediately; high urgency | Policy issue discovered; unsafe action path; uncertainty too high for current routing mode |

### 4.2 Signal Classes (11)

| Signal class | Parent message class | Semantic |
|---|---|---|
| `attention.raise` | attention | Flag something for another's consideration |
| `confidence.high` | confidence | Output is stable and well-supported |
| `confidence.medium` | confidence | Output is reasonable but has caveats |
| `confidence.low` | confidence | Output is speculative; coordinator should weigh carefully |
| `confidence.blocker` | confidence | Cannot produce useful output without more input |
| `conflict.active` | conflict | Conflict currently exists and is unresolved |
| `conflict.resolved` | conflict | Previously flagged conflict has been resolved |
| `handoff.ready` | handoff | Output is ready for downstream consumption |
| `handoff.partial` | handoff | Partial output available; more coming |
| `escalation.interrupt` | escalation | Immediate path change required |
| `escalation.uncertainty` | escalation | High uncertainty; requesting routing mode change |

### 4.3 What This Vocabulary Excludes (and Why)

The following signal classes appear in the earlier docs spike but are **not** in the v1 vocabulary:

| Excluded | Reason |
|---|---|
| `attention.dismiss` | Dismissal is handled by `resolve()`, not by a separate signal class |
| `handoff.blocked` | Blocked state is expressed by `confidence.blocker`; a separate handoff-blocked class creates ambiguity about which to use |
| `escalation.required` / `escalation.immediate` | Consolidated into `escalation.interrupt` (immediate) and `escalation.uncertainty` (requesting deeper routing); two classes cover the same semantic space with clearer distinction |
| `conflict.detected` | Renamed to `conflict.active` for consistency with the lifecycle model (a conflict is a state, not a one-time event) |

The vocabulary is intentionally small. Products that need finer distinctions use the `details` field on the signal, not new signal classes.

### 4.4 Priority Semantics

| Priority | Effect on routing | Effect on suppression |
|---|---|---|
| `low` | Informational; does not influence routing mode | May be suppressed aggressively |
| `normal` | Advisory; may influence next routing decision | Standard suppression window |
| `high` | May trigger immediate routing mode change via escalation hook | Suppression window shortened or bypassed |
| `critical` | Must trigger routing escalation; coordinator must acknowledge | Never suppressed |

### 4.5 Confidence Field Semantics

The `confidence` field is a number from 0.0 to 1.0. It is:

- **Required** on `confidence.*` and `conflict.*` signal classes
- **Optional** on all other signal classes
- **Interpreted** by coordination and routing, not by connectivity itself

Connectivity stores and forwards the value. It does not make decisions based on the value. This keeps the interpretation logic in coordination and routing where it belongs.

---

## 5. How Connectivity Influences Routing Without Owning Routing

### 5.1 The Problem

A specialist may discover that the current routing mode (`cheap` or `fast`) cannot produce an answer that meets the fixed quality bar. The system needs a way to request a deeper routing mode without connectivity making routing decisions directly.

### 5.2 The v1 Mechanism

The interaction is one-directional and hook-based:

```
Specialist ──emit(escalation.uncertainty, priority=high)──► ConnectivityLayer
ConnectivityLayer ──routingEscalationHook.onEscalation(signal)──► Router
Router ──returns 'deep' | 'fast' | void──► ConnectivityLayer (noted but not acted upon)
ConnectivityLayer ──onSignal(signal, 'emitted')──► Coordination callback
Coordination ──reads signal + routing context──► adjusts specialist budget or re-delegates
```

Step by step:

1. **Specialist emits** an escalation signal via `connectivityLayer.emit()`. The signal carries `messageClass='escalation'`, a `signalClass` (`interrupt` or `uncertainty`), and a `priority`.

2. **Connectivity calls the routing hook** synchronously during `emit()`. The `RoutingEscalationHook.onEscalation(signal)` method receives the full signal. Routing decides whether to change the mode for subsequent `router.decide()` calls. It returns the requested mode or `void`.

3. **Connectivity does not store or act on the returned mode.** It is a notification, not a command. The routing layer applies it internally to its own state.

4. **Connectivity fires `onSignal` callbacks** to notify coordination and any other subscribers that the escalation was emitted.

5. **Coordination reads the escalation signal** and the current routing context to decide what action to take — re-delegate, adjust budgets, request more input, or proceed.

### 5.3 What This Design Preserves

- **Connectivity does not know about routing modes.** It imports the `RequestedRoutingMode` type for the hook interface but never evaluates or stores mode values.
- **Routing does not depend on connectivity at runtime.** Routing implements the hook interface and registers itself. If no hook is registered, escalation signals are still emitted and reach `onSignal` subscribers — routing just does not react to them automatically.
- **The quality bar is routing's responsibility.** Connectivity signals that something is wrong. Routing decides whether to change the envelope. Coordination decides whether to change the plan.
- **The hook is optional.** Systems without routing (e.g., single-model setups) can use connectivity for coordination signals without wiring a routing hook. Escalation signals still function as coordination signals.

### 5.4 What This Design Does Not Do

- Connectivity does not queue routing requests. The hook is called synchronously during emit and the result is fire-and-forget from connectivity's perspective.
- Connectivity does not enforce that routing actually changes the mode. Routing may ignore the escalation if policy constraints prevent mode change.
- Connectivity does not escalate on behalf of coordination. Only the component that detects the problem emits the escalation. Coordination reacts to it but does not re-emit.

---

## 6. Open Questions Carried Into Implementation

These questions from the v1 connectivity spec remain open. They do not block the scope definition but must be resolved during implementation:

| # | Question | Resolution target |
|---|---|---|
| OQ-1 | Should `emit()` be synchronous or async? (Scoped synchronous for v1.) | First implementation slice |
| OQ-2 | Should `audience='all'` signals be suppressed more aggressively? | Before WF-C2 hardening |
| OQ-3 | Should `advanceStep()` expiry fire `onSignal` callbacks? (Spec says yes.) | First implementation slice |
| OQ-4 | Maximum active signals per thread? | v1.1 |
| OQ-5 | Should routing mode requests be queued or applied immediately? | Before WF-C4 hardening |

---

## 7. Relationship to Foundation Follow-ups

The following items from the foundation integration review (PASS_WITH_FOLLOWUPS) are relevant to connectivity scope:

| Item | Impact on connectivity |
|---|---|
| I-1 (fanout return-type mismatch) | No impact. Connectivity does not interact with surfaces fanout. |
| I-2 (test naming in core-sessions) | No impact. Connectivity does not interact with sessions. |
| I-3 (lifecycle test in core-sessions-surfaces) | No impact. Connectivity tests are independent of foundation integration tests. |
| S-F-6 / OQ-2 (max surfaces per session) | Indirect. If session attachment limits change, escalation signals may need to reflect capacity constraints. Resolve before WF-7 assembly. |
| Su-F-1 (send() for inactive surfaces) | No impact. Connectivity signals are in-process callbacks, not surface delivery. |

Connectivity implementation can proceed without waiting for these items. S-F-6 should be resolved before WF-7 assembly but does not block connectivity's own implementation slice.

---

## 8. Implementation Slice Summary

The v1 connectivity implementation follows the 8-step plan from the spec:

| Step | Deliverable | Dependencies |
|---|---|---|
| 1 | Type exports (all interfaces, types, enums) | None |
| 2 | Signal log (in-memory Map, emit, get, query) | Step 1 |
| 3 | State transitions (resolve, supersede) | Step 2 |
| 4 | Suppression (duplicate detection within window) | Step 3 |
| 5 | advanceStep and expiry | Step 3 |
| 6 | onSignal / offSignal callbacks | Step 3 |
| 7 | Audience resolution (selected resolver) | Step 6 |
| 8 | Routing escalation hook | Step 6 |

**Definition of done:** A specialist handler can emit a confidence signal, a coordinator can receive it via `onSignal`, and an escalation signal can trigger a routing mode request — all within a single in-process thread. The four workflow shapes (WF-C1 through WF-C4) are proved in integration tests.

---

V1_CONNECTIVITY_SCOPE_READY
