# v1 Connectivity Spec — `@agent-assistant/connectivity`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@agent-assistant/connectivity`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Canonical scope:** `docs/architecture/v1-connectivity-scope.md` (SCOPE_LOCKED)

---

## 1. Responsibilities

`@agent-assistant/connectivity` provides a typed, in-process signaling layer for internal multi-agent coordination. It is not a generic event bus or pub/sub system. It is the mechanism by which specialists, coordinators, and supporting subsystems communicate state, confidence, handoffs, conflicts, and escalations without verbose transcript exchange.

**Owns:**
- `ConnectivitySignal` — the canonical signal envelope and all supporting types
- Signal emission — assigning IDs, timestamps, and initial state
- Signal state machine — `emitted → active → [superseded | expired | resolved]`
- Signal log — in-memory, per-thread, queryable log of all signals
- Suppression — step-basis or time-basis duplicate detection
- Audience resolution — translating semantic audience (`self`, `coordinator`, `selected`, `all`) to recipient identifiers
- Routing escalation hook — one-directional interface to routing on escalation emit
- Signal salience — defined per signal class; used by suppression and convergence logic

**Does NOT own:**
- Model invocations or reasoning
- Routing mode selection or model spec (→ `@agent-assistant/routing`)
- Coordinator/specialist orchestration or work assignment (→ `@agent-assistant/coordination`)
- Session or surface management
- Transport or delivery (signals are in-process in v1)

---

## 2. Signal Envelope

### 2.1 `ConnectivitySignal`

```typescript
export interface ConnectivitySignal {
  /** Unique signal ID within the thread. Assigned by the layer on emit. Format: `sig_<nanoid>`. */
  id: string;

  /** Thread (coordination context) this signal belongs to. */
  threadId: string;

  /** Identifier of the component emitting this signal (e.g., 'specialist:reviewer', 'memory'). */
  source: string;

  /** Semantic delivery intent. Resolved to recipient IDs by the layer or SelectedAudienceResolver. */
  audience: SignalAudience;

  /** Broad intent category. One of five; see §4. */
  messageClass: MessageClass;

  /** Narrow semantic within the message class. One of eleven; see §5. */
  signalClass: SignalClass;

  /**
   * Routing urgency.
   * - 'low': informational; does not interrupt current routing mode
   * - 'normal': advisory; may influence next routing decision
   * - 'high': may trigger immediate routing mode change via escalation hook
   * - 'critical': must trigger routing escalation; coordinator must acknowledge; never suppressed
   */
  priority: SignalPriority;

  /**
   * Salience grade for this signal, 0.0–1.0.
   * Encodes how decision-relevant this signal is relative to the current thread state.
   * Required for `confidence.*` and `conflict.*` signal classes.
   * Optional for all others.
   * Connectivity stores and forwards the value; it does not evaluate it.
   * Interpretation is the responsibility of coordination and routing.
   *
   * Guidance by signal class:
   * - confidence.high → 0.8–1.0
   * - confidence.medium → 0.4–0.79
   * - confidence.low → 0.1–0.39
   * - confidence.blocker → 0.0
   * - conflict.active → required; must reflect how blocking the conflict is
   * - conflict.resolved → optional; set to the value from the resolved signal
   */
  confidence?: number;

  /**
   * One-sentence description of the signal. Required.
   * Used for suppression deduplication key and signal log display.
   * Should be specific enough for a coordinator to act on without reading `details`.
   */
  summary: string;

  /**
   * Optional extended detail. Should be compact — not a reasoning transcript.
   * Routing layer may omit this from forwarding in 'cheap' mode.
   * Max recommended length: 500 characters.
   */
  details?: string;

  /**
   * ID of the signal this supersedes. When set, the targeted signal transitions to 'superseded'.
   * Use when emitting an update that makes a prior signal obsolete.
   */
  replaces?: string;

  /**
   * Step number at which this signal auto-expires.
   * The layer transitions state to 'expired' when `advanceStep()` increments past this value.
   * When omitted, the signal does not auto-expire.
   */
  expiresAtStep?: number;

  /** ISO-8601 timestamp. Set by the layer during emit(). */
  emittedAt: string;

  /** Lifecycle state. Managed by the layer. See §3. */
  state: SignalState;
}
```

### 2.2 Supporting Types

```typescript
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
```

### 2.3 `EmitSignalInput`

Callers provide this to `emit()`. The layer assigns `id`, `emittedAt`, and initial `state`.

```typescript
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
```

**Validation rules enforced by `emit()`:**
- `threadId`, `source`, `summary` must be non-empty strings
- `signalClass` must be consistent with `messageClass` (e.g., `attention.raise` requires `messageClass='attention'`)
- `confidence` required when `messageClass` is `'confidence'` or `'conflict'`; must be 0.0–1.0 when present
- `replaces`, if set, must refer to a signal ID within the same `threadId`
- `priority='critical'` signals bypass suppression regardless of window

---

## 3. Signal Lifecycle

```
emitted ──► active ──► superseded   (replaces: newer signal targets this ID)
                   └──► expired      (expiresAtStep reached via advanceStep)
                   └──► resolved     (explicitly resolved via resolve())
```

| State | Meaning | Terminal? |
|---|---|---|
| `emitted` | Created; not yet acknowledged by any recipient | No |
| `active` | At least one `onSignal` callback has fired for this signal | No |
| `superseded` | A newer signal with `replaces` targeting this ID was emitted | Yes |
| `expired` | `expiresAtStep` passed; the step advanced past the threshold | Yes |
| `resolved` | The signaled condition is no longer relevant; explicitly closed | Yes |

**Rules:**
- The signal log retains all signals regardless of terminal state; state is updated in-place
- Transitions are one-way; a terminal state cannot transition to another state
- `onSignal` callbacks fire on every transition: `'emitted'`, `'superseded'`, `'expired'`, `'resolved'`
- When `advanceStep()` expires signals, `onSignal` fires with `event='expired'` for each

---

## 4. Message Classes

| Class | Semantic | Typical `audience` | `confidence` field |
|---|---|---|---|
| `attention` | Something another component should consider; not urgent | `coordinator`, `selected` | Optional |
| `confidence` | Stability grade of this specialist's current output | `coordinator` | **Required** |
| `conflict` | Two active views disagree in a way that affects the final answer | `coordinator` | **Required** |
| `handoff` | Downstream component can proceed; this specialist is done with its step | `selected`, `coordinator` | Optional |
| `escalation` | Current path must change immediately; highest urgency | `coordinator`, `all` | Optional |

---

## 5. Signal Classes

| Signal class | Message class | Semantic | Required `confidence` range |
|---|---|---|---|
| `attention.raise` | attention | Flag something for another's consideration | — |
| `confidence.high` | confidence | Output is stable and well-supported | 0.8–1.0 |
| `confidence.medium` | confidence | Output is reasonable but has caveats | 0.4–0.79 |
| `confidence.low` | confidence | Output is speculative; coordinator should weigh carefully | 0.1–0.39 |
| `confidence.blocker` | confidence | Cannot produce useful output; requires more input | 0.0 |
| `conflict.active` | conflict | Conflict exists and is unresolved | any 0.0–1.0 |
| `conflict.resolved` | conflict | Previously flagged conflict has been resolved | any 0.0–1.0 |
| `handoff.ready` | handoff | Output is ready for downstream consumption | — |
| `handoff.partial` | handoff | Partial output available; more is coming | — |
| `escalation.interrupt` | escalation | Immediate path change required; stop current plan | — |
| `escalation.uncertainty` | escalation | Uncertainty too high; requesting routing mode escalation | — |

**Excluded from v1 vocabulary** (see `v1-connectivity-scope.md §4.3`):
- `attention.dismiss` → use `resolve()` instead
- `handoff.blocked` → use `confidence.blocker`
- `escalation.required` / `escalation.immediate` → consolidated into `escalation.interrupt`
- `conflict.detected` → renamed to `conflict.active`

---

## 6. Signal Salience

**Salience** is the degree to which a signal is decision-relevant relative to the current thread state. It is expressed through the `confidence` field (0.0–1.0) when applicable, and through `priority` for all signals.

Connectivity does not evaluate salience. It stores and forwards it. Coordination and routing interpret it.

**Salience rules:**
- `priority='critical'` signals are always high-salience; they bypass suppression and must be delivered
- `priority='high'` signals with `confidence < 0.2` on a `confidence.*` class indicate a high-salience blocker
- `priority='low'` signals with no `confidence` field are the lowest-salience; suppressed most aggressively
- For suppression purposes, two signals with identical `threadId + source + signalClass + audience` are treated as the same logical signal regardless of salience value (the existing signal is returned unchanged)

---

## 7. Suppression

Suppression prevents redundant signals from accumulating within a coordination window.

### 7.1 Duplicate Definition

Two signals are considered duplicates when all of the following are identical:
- `threadId`
- `source`
- `signalClass`
- `audience`

And neither signal has been resolved or superseded.

### 7.2 Suppression Config

```typescript
export interface SuppressionConfig {
  /**
   * Basis for suppression window.
   * - 'step': suppress within the same step; advanceStep() resets the window
   * - 'time': suppress within a sliding time window
   */
  basis: 'step' | 'time';

  /**
   * Window in milliseconds. Only applies when basis='time'.
   * Default: 5000.
   */
  windowMs?: number;
}
```

### 7.3 Suppression Behavior

- When a duplicate is suppressed, `emit()` **returns the existing signal unchanged**. No new signal is stored.
- Callers detect suppression by comparing the returned signal's `id` to the ID they expected (a new ID would have been assigned; a suppressed call returns the old ID).
- `priority='critical'` signals are **never suppressed** regardless of window or config.
- `priority='high'` escalation signals (`escalation.interrupt`, `escalation.uncertainty`) are not suppressed within the same step if their `summary` differs from the existing signal's `summary`.

---

## 8. `ConnectivityLayer` Interface

```typescript
export interface ConnectivityLayer {
  /**
   * Emit a signal. Returns the stored signal with assigned id, emittedAt, state='emitted'.
   *
   * Suppression: if a duplicate exists within the current window (see §7), returns
   * the existing signal unchanged. No new signal is created.
   *
   * Supersession: if `input.replaces` is set, the targeted signal transitions to 'superseded'
   * before this signal is stored.
   *
   * Escalation hook: if signalClass is 'escalation.interrupt' or 'escalation.uncertainty',
   * the registered RoutingEscalationHook.onEscalation() is called synchronously before
   * onSignal callbacks fire.
   */
  emit(input: EmitSignalInput): ConnectivitySignal;

  /**
   * Transition a signal to 'resolved'. Idempotent if already resolved.
   * Fires onSignal with event='resolved'.
   * Throws if signalId is not found in the log.
   */
  resolve(signalId: string): ConnectivitySignal;

  /**
   * Retrieve a single signal by ID. Returns null if not found.
   */
  get(signalId: string): ConnectivitySignal | null;

  /**
   * Query the signal log for a thread with optional filters.
   * Default state filter is ['emitted', 'active'] (excludes terminal states).
   */
  query(query: SignalQuery): ConnectivitySignal[];

  /**
   * Advance the step counter for a thread.
   * Signals with expiresAtStep <= current step transition to 'expired'.
   * onSignal fires with event='expired' for each.
   */
  advanceStep(threadId: string): void;

  /**
   * Register a SelectedAudienceResolver for audience='selected' signals.
   * Only one resolver is active at a time; subsequent calls replace the previous.
   * Called by coordination during initialization.
   */
  registerSelectedResolver(resolver: SelectedAudienceResolver): void;

  /**
   * Register a callback invoked on every signal state transition event.
   * Events: 'emitted', 'superseded', 'resolved', 'expired'.
   */
  onSignal(callback: SignalCallback): void;

  /** Remove a previously registered callback. No-op if callback is not registered. */
  offSignal(callback: SignalCallback): void;
}
```

### 8.1 `SignalQuery`

```typescript
export interface SignalQuery {
  threadId: string;

  /** Filter by emitting source component ID. */
  source?: string;

  /** Filter by message class (single or array). */
  messageClass?: MessageClass | MessageClass[];

  /** Filter by signal class (single or array). */
  signalClass?: SignalClass | SignalClass[];

  /**
   * Filter by lifecycle state. Defaults to ['emitted', 'active'].
   * Pass explicit array to include terminal states.
   */
  state?: SignalState | SignalState[];

  /** Filter by priority (single or array). */
  priority?: SignalPriority | SignalPriority[];

  /** Return only signals emitted after this ISO-8601 timestamp. */
  since?: string;

  /** Maximum results to return. Defaults to 50. */
  limit?: number;

  /** Sort order. Defaults to 'newest'. */
  order?: 'newest' | 'oldest';
}
```

### 8.2 `SignalCallback` and `SignalEvent`

```typescript
export type SignalEvent = 'emitted' | 'superseded' | 'resolved' | 'expired';

export type SignalCallback = (
  signal: ConnectivitySignal,
  event: SignalEvent,
) => void;
```

### 8.3 `SelectedAudienceResolver`

```typescript
/**
 * Provided by coordination. Called by connectivity when audience='selected'.
 * Returns the list of component IDs to notify.
 */
export type SelectedAudienceResolver = (
  signal: ConnectivitySignal,
) => string[];
```

---

## 9. Routing Integration Contract

Connectivity and routing interact via a single, one-directional hook interface.

```typescript
/**
 * Implemented by @agent-assistant/routing.
 * Registered with connectivity at initialization via ConnectivityLayerConfig.
 */
export interface RoutingEscalationHook {
  /**
   * Called synchronously during emit() when signalClass is 'escalation.interrupt'
   * or 'escalation.uncertainty'.
   *
   * Returns a requested routing mode or void.
   * Connectivity does not store or act on the returned mode.
   * Routing applies or ignores it internally.
   */
  onEscalation(signal: ConnectivitySignal): RequestedRoutingMode | void;
}

export type RequestedRoutingMode = 'cheap' | 'fast' | 'deep';
```

**Call sequence during escalation emit:**
1. Connectivity receives `emit(input)` with escalation signalClass
2. Suppression check (critical priority bypasses)
3. Signal stored with `state='emitted'`
4. `routingEscalationHook.onEscalation(signal)` called synchronously (if registered)
5. Returned mode noted by routing; connectivity does not act on it
6. `onSignal(signal, 'emitted')` fired to all registered callbacks

**Design invariants:**
- Connectivity imports `RequestedRoutingMode` type only from routing; never calls routing methods
- Routing implements `RoutingEscalationHook`; connectivity does not know the implementation
- If no hook is registered, escalation signals still emit and reach `onSignal` subscribers
- The hook is synchronous; there is no queuing or deferred application in v1

---

## 10. Factory and Configuration

```typescript
export interface ConnectivityLayerConfig {
  /**
   * Suppression window configuration.
   * Defaults to step-basis if omitted.
   */
  suppressionConfig?: SuppressionConfig;

  /**
   * Routing escalation hook. Optional.
   * When registered, called synchronously on escalation signal emit.
   */
  routingEscalationHook?: RoutingEscalationHook;
}

/**
 * Create a thread-aware connectivity layer.
 * Multiple threads share one instance; all state is partitioned by threadId.
 * All state is in-process in v1.
 */
export function createConnectivityLayer(
  config?: ConnectivityLayerConfig,
): ConnectivityLayer;
```

---

## 11. Convergence Rules

Convergence is the reduction of open signals within a thread toward a state where coordination can synthesize a final answer. Connectivity supports convergence through the following rules:

### 11.1 When to Resolve

A signal should be resolved when:
- The condition it describes is no longer true or relevant
- A `conflict.active` has been arbitrated (emit `conflict.resolved`, then resolve the `conflict.active`)
- A `handoff.ready` output has been consumed by the downstream component
- An `escalation.interrupt` has been acknowledged and the path has changed

Coordination is responsible for resolving signals. Connectivity provides `resolve()`.

### 11.2 When to Supersede

Use `replaces` when:
- Emitting an updated confidence grade that replaces the prior one (e.g., `confidence.low` → `confidence.high`)
- Emitting a corrected `attention.raise` that makes the prior one stale
- Emitting `handoff.ready` after a prior `handoff.partial` is no longer the latest state

### 11.3 Active Signal Budget

There is no hard cap in v1 (deferred to v1.1). As a convergence guideline, if a thread has more than 10 unresolved non-handoff signals from a single source, coordination should consider whether suppression config is too loose or signals are not being resolved after consumption.

### 11.4 Thread Convergence Signal

A thread is considered converged when:
- No `conflict.active` signals remain in `active` state
- No `escalation.*` signals remain unresolved
- All `confidence.*` signals from participating specialists are at `confidence.high` or `confidence.medium`

This is a coordination concern; connectivity provides the query tools (`query()`) to determine it.

---

## 12. Audience Resolution Rules

| Audience | Resolution behavior |
|---|---|
| `self` | Notifies only the source component (by ID). `onSignal` still fires for coordination subscribers. |
| `coordinator` | Notifies the registered coordinator component. Resolved by the layer based on thread registration. |
| `selected` | Resolved by calling the registered `SelectedAudienceResolver`. If no resolver is registered, signal is emitted but no component IDs are resolved. |
| `all` | Notifies all registered components in the thread. Use sparingly; see suppression guidance. |

`audience='all'` signals are subject to standard suppression rules. Use `audience='coordinator'` unless broadcast is explicitly required.

---

## 13. Coordination-Connectivity Boundary

Coordination calls connectivity. Connectivity never calls coordination.

| Direction | Permitted |
|---|---|
| Coordination → `emit()`, `query()`, `resolve()`, `onSignal()` | Yes |
| Coordination → `registerSelectedResolver()` | Yes (at initialization) |
| Connectivity → any coordination method | **No** |
| Coordination provides `SelectedAudienceResolver` | Yes (registered, not called back into coordination) |

---

## 14. Package Boundaries

### 14.1 Dependency Rules

| Direction | Rule |
|---|---|
| Connectivity → `@agent-assistant/core` | Allowed. Type imports only. |
| Connectivity → `@agent-assistant/routing` | Import `RequestedRoutingMode` type only. Never call routing methods. |
| Connectivity → `@agent-assistant/sessions` | **Forbidden.** |
| Connectivity → `@agent-assistant/surfaces` | **Forbidden.** |
| Connectivity → `@agent-assistant/memory` | **Forbidden.** |
| Connectivity → `@agent-assistant/coordination` | **Forbidden.** Coordination depends on connectivity, not vice versa. |
| `@agent-assistant/coordination` → connectivity | Allowed. Primary consumer. |
| `@agent-assistant/routing` → connectivity | Allowed. Routing implements `RoutingEscalationHook`. |
| Product specialist handlers → connectivity | Allowed. Specialists call `emit()` directly. |

### 14.2 Permanent Scope Exclusions

These are not deferrals; they will never be in scope:
- Connectivity will never own model invocations or reasoning
- Connectivity will never own routing mode selection
- Connectivity will never own coordinator/specialist orchestration
- Connectivity will never own session or surface management
- Connectivity will never be a generic pub/sub system with topics and subscriptions
- Connectivity will never produce user-visible messages; signals are internal only

---

## 15. v1 Package Exports

The following is the complete public API surface for v1. Nothing else is exported.

```typescript
// Types
export type {
  ConnectivitySignal,
  EmitSignalInput,
  SignalQuery,
  ConnectivityLayerConfig,
  SuppressionConfig,
  RoutingEscalationHook,
  SelectedAudienceResolver,
  SignalCallback,
};

// Union types
export type {
  SignalAudience,
  MessageClass,
  SignalClass,
  SignalPriority,
  SignalState,
  SignalEvent,
  RequestedRoutingMode,
};

// Interface
export type { ConnectivityLayer };

// Factory
export { createConnectivityLayer };
```

---

## 16. Workflow Shapes (Integration Test Targets)

### WF-C1: Narrowcast Attention

```
Specialist → emit(attention.raise, audience=selected, priority=normal)
           → SelectedAudienceResolver returns [componentId]
           → onSignal fired to coordination
           → coordination reads signal.details
           → coordination decides whether to act before synthesis
```

### WF-C2: Reviewer Conflict

```
Specialist A → emit(conflict.active, coordinator, priority=high, confidence=0.2)
             → onSignal fired to coordination
Specialist B → emit(conflict.active, coordinator, priority=high, confidence=0.3)
             → onSignal fired again
Coordination → query({ messageClass: 'conflict', state: ['emitted', 'active'] })
             → sees both conflicts
             → decides to arbitrate or re-route
             → emit(conflict.resolved, coordinator) from arbitrating specialist
             → resolve(signalId) for each conflict.active signal
```

### WF-C3: Specialist Handoff

```
Specialist A → emit(handoff.ready, audience=selected, priority=normal)
             → SelectedAudienceResolver returns [specialistB]
             → onSignal fired; specialistB begins processing A's output
             → signal state: emitted → active
Coordination → resolve(signalId) after handoff is consumed
```

### WF-C4: Blocker Uncertainty Routing

```
Specialist → emit(escalation.uncertainty, coordinator, priority=high)
           → routingEscalationHook.onEscalation(signal) called synchronously
           → routing returns 'deep' (or void)
           → onSignal fired to coordination
           → coordination reads signal + routing context
           → coordination adjusts specialist budget or re-delegates
```

---

## 17. Open Questions (Carried into Implementation)

| # | Question | Resolution target |
|---|---|---|
| OQ-1 | `emit()` synchronous (current spec) vs async. Sync for v1. | First implementation slice |
| OQ-2 | Should `audience='all'` signals be suppressed more aggressively than narrowcast? | Before WF-C2 hardening |
| OQ-3 | When `advanceStep()` expires signals, should `onSignal` fire? Current spec: yes. | First implementation slice |
| OQ-4 | Maximum active signals per thread? No cap in v1. | v1.1 |
| OQ-5 | Routing mode requests: queued or immediate? v1: immediate (fire-and-forget). | Before WF-C4 hardening |

---

## 18. Deferred Beyond v1

| Capability | Target |
|---|---|
| Distributed / cross-process signal delivery | v1.2+ |
| Persistent signal log | v1.2+ |
| Signal log retention beyond thread lifetime | v1.2+ |
| Tenant-aware signal routing | Cloud adapter |
| Cloud observability pipelines | Cloud adapter |
| Product-specific signal classes | v1.1+ |
| Provider-specific real-time delivery | Product layer |
| Async `emit()` | v1.2 (with distribution) |
| Maximum active signals per thread | v1.1 |
| Broadcast suppression policy | Before WF-C2 hardening |

---

V1_CONNECTIVITY_SPEC_READY
