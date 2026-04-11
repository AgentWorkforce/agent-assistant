---CONNECTIVITY SPEC---
# v1 Connectivity Spec — `@relay-assistant/connectivity`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/connectivity`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Canonical scope:** `docs/architecture/v1-connectivity-scope.md` (SCOPE_LOCKED)

---

## 1. Responsibilities

`@relay-assistant/connectivity` provides a typed, in-process signaling layer for internal multi-agent coordination. It is not a generic event bus or pub/sub system. It is the mechanism by which specialists, coordinators, and supporting subsystems communicate state, confidence, handoffs, conflicts, and escalations without verbose transcript exchange.

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
- Routing mode selection or model spec (→ `@relay-assistant/routing`)
- Coordinator/specialist orchestration or work assignment (→ `@relay-assistant/coordination`)
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

---CONNECTIVITY PLAN---
# v1 Connectivity Implementation Plan

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Canonical spec:** `docs/specs/v1-connectivity-spec.md` (V1_CONNECTIVITY_SPEC_READY)
**Scope reference:** `docs/architecture/v1-connectivity-scope.md` (SCOPE_LOCKED)
**Package:** `@relay-assistant/connectivity`
**Covers:** WF-C1 (Narrowcast Attention), WF-C2 (Reviewer Conflict), WF-C3 (Specialist Handoff), WF-C4 (Blocker Uncertainty Routing)

---

## 1. Files to Create

```
packages/connectivity/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Public API barrel export
│   ├── types.ts              # All interfaces, union types, and enums
│   ├── errors.ts             # ConnectivityError, ValidationError
│   ├── id.ts                 # Signal ID generation (sig_<nanoid>)
│   ├── log.ts                # In-memory signal log (Map<threadId, ConnectivitySignal[]>)
│   ├── suppression.ts        # Duplicate detection (step-basis and time-basis)
│   ├── lifecycle.ts          # State machine transitions (resolve, supersede, expire)
│   ├── audience.ts           # Audience resolution (self, coordinator, selected, all)
│   ├── layer.ts              # ConnectivityLayer implementation + createConnectivityLayer factory
│   └── __tests__/
│       ├── types.test.ts        # Step 1: TypeScript structural validation
│       ├── log.test.ts          # Step 2: emit, get, query
│       ├── lifecycle.test.ts    # Step 3: resolve, supersede state transitions
│       ├── suppression.test.ts  # Step 4: duplicate detection
│       ├── step.test.ts         # Step 5: advanceStep and expiry
│       ├── callbacks.test.ts    # Step 6: onSignal / offSignal
│       ├── audience.test.ts     # Step 7: audience resolution
│       ├── routing.test.ts      # Step 8: routing escalation hook
│       └── integration/
│           ├── wf-c1.test.ts    # WF-C1: Narrowcast attention
│           ├── wf-c2.test.ts    # WF-C2: Reviewer conflict
│           ├── wf-c3.test.ts    # WF-C3: Specialist handoff
│           └── wf-c4.test.ts    # WF-C4: Blocker uncertainty routing
```

**Total: 22 files.** No external runtime dependencies beyond `nanoid` for ID generation.

---

## 2. Implementation Slices

### Step 1 — Type Exports

**File:** `src/types.ts`

Export all types defined in the spec §2 and §8. No runtime logic.

| Export | Notes |
|---|---|
| `ConnectivitySignal` | Full interface with all fields |
| `EmitSignalInput` | Input shape for `emit()` |
| `SignalQuery` | Query filter interface |
| `ConnectivityLayerConfig` | Factory config with `suppressionConfig` and `routingEscalationHook` |
| `SuppressionConfig` | `basis: 'step' \| 'time'`, `windowMs?: number` |
| `RoutingEscalationHook` | Interface with `onEscalation(signal)` |
| `SelectedAudienceResolver` | `(signal) => string[]` |
| `SignalCallback` | `(signal, event) => void` |
| `ConnectivityLayer` | Full interface |
| `SignalAudience` | `'self' \| 'coordinator' \| 'selected' \| 'all'` |
| `MessageClass` | 5-value union |
| `SignalClass` | 11-value union |
| `SignalPriority` | `'low' \| 'normal' \| 'high' \| 'critical'` |
| `SignalState` | `'emitted' \| 'active' \| 'superseded' \| 'expired' \| 'resolved'` |
| `SignalEvent` | `'emitted' \| 'superseded' \| 'resolved' \| 'expired'` |
| `RequestedRoutingMode` | `'cheap' \| 'fast' \| 'deep'` |

**File:** `src/errors.ts`

```typescript
export class ConnectivityError extends Error {
  name = 'ConnectivityError';
}

export class SignalValidationError extends ConnectivityError {
  name = 'SignalValidationError';
}

export class SignalNotFoundError extends ConnectivityError {
  name = 'SignalNotFoundError';
}
```

**Tests (`types.test.ts`):**
- Verify all type exports are present and structurally correct via TypeScript compiler
- `EmitSignalInput` does not include `id`, `emittedAt`, or `state`
- `SignalClass` values are consistent with `MessageClass` groupings

---

### Step 2 — Signal Log (In-Memory)

**File:** `src/id.ts`

```typescript
import { nanoid } from 'nanoid';
export function generateSignalId(): string {
  return `sig_${nanoid()}`;
}
```

**File:** `src/log.ts`

```typescript
class SignalLog {
  private readonly log: Map<string, ConnectivitySignal[]>;

  emit(input: EmitSignalInput): ConnectivitySignal;  // validates, assigns id/emittedAt/state
  get(signalId: string): ConnectivitySignal | null;
  query(query: SignalQuery): ConnectivitySignal[];
  getByThread(threadId: string): ConnectivitySignal[];
}
```

**`emit()` implementation details:**
1. Validate input — throw `SignalValidationError` on violations:
   - `threadId`, `source`, `summary` non-empty
   - `signalClass` consistent with `messageClass`
   - `confidence` present and in range when required
   - `replaces` references a valid signal in same thread (if set)
2. Assign `id = generateSignalId()`, `emittedAt = new Date().toISOString()`, `state = 'emitted'`
3. Append to `log.get(threadId) ?? []`
4. Return stored signal

**`query()` implementation details:**
- Default `state` filter: `['emitted', 'active']`
- Apply all filters with AND semantics
- Default `limit`: 50
- Default `order`: `'newest'` (sort by `emittedAt` descending)
- Array-valued filters (`messageClass[]`, etc.) use OR semantics within the filter

**Tests (`log.test.ts`):**
- emit assigns id (starts with `sig_`) and ISO-8601 `emittedAt`
- emit sets initial `state='emitted'`
- get returns null for unknown ID
- query with `messageClass` filter returns only matching signals
- query with `state=['active']` excludes emitted signals
- query with `limit=2` returns at most 2 results
- query with `order='oldest'` returns chronological order
- query on unknown `threadId` returns empty array

---

### Step 3 — State Transitions

**File:** `src/lifecycle.ts`

```typescript
class SignalLifecycle {
  resolve(log: SignalLog, signalId: string): ConnectivitySignal;
  supersede(log: SignalLog, replacedId: string): ConnectivitySignal;
}
```

**`resolve()` behavior:**
- Retrieve signal by ID; throw `SignalNotFoundError` if not found
- If already `'resolved'`, return unchanged (idempotent)
- If in terminal state (`'superseded'`, `'expired'`), throw `ConnectivityError` (cannot resolve terminal state)
- Transition `state` to `'resolved'`

**`supersede()` behavior:**
- Called by `emit()` when `input.replaces` is set
- Retrieve the replaced signal; throw `SignalNotFoundError` if not found
- If already in a terminal state, throw `ConnectivityError`
- Transition `state` to `'superseded'`

**Tests (`lifecycle.test.ts`):**
- resolve transitions `emitted` → `resolved`
- resolve transitions `active` → `resolved`
- resolve is idempotent on already-resolved signal
- resolve throws on superseded signal
- resolve throws on unknown signal ID
- supersede via `emit(replaces=...)` transitions the target to `superseded`
- supersede of terminal signal throws

---

### Step 4 — Suppression

**File:** `src/suppression.ts`

```typescript
class SuppressionWindow {
  constructor(config: SuppressionConfig);

  /**
   * Returns the existing signal if the input is a duplicate within the window.
   * Returns null if the signal is not suppressed (should be created).
   */
  check(
    input: EmitSignalInput,
    existingSignals: ConnectivitySignal[],
  ): ConnectivitySignal | null;

  /**
   * Called by advanceStep(). Resets the step window.
   */
  advanceStep(): void;
}
```

**Duplicate key:** `threadId + source + signalClass + audience`

**Suppression exclusions:**
- `priority='critical'` — never suppressed
- Signal is already resolved or superseded — not considered a duplicate

**Step-basis:** Window resets on each `advanceStep()` call. All non-terminal signals from the same step count as potential duplicates.

**Time-basis:** Signal is a duplicate if an existing non-terminal signal with the same key was emitted within the last `windowMs` milliseconds.

**Tests (`suppression.test.ts`):**
- Second `emit()` with identical key returns first signal unchanged
- Suppressed emit does not add a new entry to the log
- Different `signalClass` is not suppressed
- Different `audience` is not suppressed
- `priority='critical'` bypasses suppression
- Resolved signal does not count as duplicate; new signal is created
- Step advance resets the step window
- Time window: signal outside window is not suppressed

---

### Step 5 — `advanceStep()` and Expiry

**File:** `src/log.ts` (extend)

```typescript
advanceStep(threadId: string): ConnectivitySignal[];  // returns expired signals
```

**Implementation:**
1. Increment internal step counter for `threadId` (initialize at 0 if not set)
2. Scan `log.get(threadId)` for signals where `expiresAtStep !== undefined && expiresAtStep <= currentStep`
3. Filter to non-terminal states only
4. Transition each to `state='expired'`
5. Reset the suppression window for step-basis config
6. Return the list of expired signals (for callback firing)

**Tests (`step.test.ts`):**
- Signal without `expiresAtStep` does not expire
- Signal with `expiresAtStep=1` expires after one `advanceStep()` call
- Signal with `expiresAtStep=2` does not expire after one `advanceStep()`
- Already-terminal signals are not processed by expiry scan
- `advanceStep()` on unknown thread is a no-op

---

### Step 6 — `onSignal` / `offSignal`

**File:** `src/layer.ts` (callback registry)

```typescript
class CallbackRegistry {
  register(callback: SignalCallback): void;
  unregister(callback: SignalCallback): void;
  fire(signal: ConnectivitySignal, event: SignalEvent): void;
}
```

**Firing rules:**
- Fire after every state transition: `emit()` → `'emitted'`, `supersede` → `'superseded'`, `resolve()` → `'resolved'`, `advanceStep()` expiry → `'expired'`
- Callbacks are called synchronously in registration order
- Exceptions in callbacks are caught and logged; they do not abort subsequent callbacks
- When `advanceStep()` expires multiple signals, `'expired'` fires once per expired signal

**Tests (`callbacks.test.ts`):**
- `onSignal` callback fires with `event='emitted'` on emit
- `onSignal` callback fires with `event='resolved'` on resolve
- `onSignal` callback fires with `event='superseded'` when signal is replaced
- `onSignal` callback fires with `event='expired'` for each expired signal on `advanceStep()`
- `offSignal` removes the callback; it does not fire after removal
- Multiple callbacks all fire; callback exception does not block subsequent callbacks
- Callback fires even for suppressed emit? **No** — suppressed emit returns the existing signal without firing a new event

---

### Step 7 — Audience Resolution

**File:** `src/audience.ts`

```typescript
class AudienceResolver {
  registerSelectedResolver(resolver: SelectedAudienceResolver): void;
  resolve(signal: ConnectivitySignal): string[];
}
```

**Resolution rules:**
- `'self'` → `[signal.source]`
- `'coordinator'` → `['coordinator']` (the layer uses the literal string `'coordinator'` as the coordinator component ID in v1; this is sufficient for in-process routing)
- `'selected'` → calls `SelectedAudienceResolver(signal)`, or `[]` if no resolver is registered
- `'all'` → returns all component IDs registered with the thread (in v1, this is the set of all sources that have emitted signals on the thread, plus `'coordinator'`)

The resolved recipient IDs are not stored on `ConnectivitySignal` in v1. They are computed at emit time and used only for callback targeting. `onSignal` callbacks always fire to all registered listeners regardless of audience (coordination decides what to do with signals not addressed to it).

**Tests (`audience.test.ts`):**
- `audience='self'` resolves to `[signal.source]`
- `audience='coordinator'` resolves to `['coordinator']`
- `audience='selected'` calls registered resolver with the signal
- `audience='selected'` with no resolver returns `[]`
- `audience='all'` returns all thread participants
- Registering a new resolver replaces the prior one

---

### Step 8 — Routing Escalation Hook

**File:** `src/layer.ts` (wired in `createConnectivityLayer`)

**Implementation in `emit()`:**

```

---CONNECTIVITY SIGNAL CATALOG---
# Connectivity Signal Catalog

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Spec reference:** `docs/specs/v1-connectivity-spec.md` (V1_CONNECTIVITY_SPEC_READY)

This catalog is the authoritative reference for all signal classes defined in `@relay-assistant/connectivity` v1. Each entry specifies: semantics, required and optional fields, valid audience values, expected `priority` range, convergence responsibilities, and anti-patterns.

---

## Vocabulary Summary

| Signal class | Message class | Priority default | `confidence` required | Typical audience |
|---|---|---|---|---|
| `attention.raise` | attention | `normal` | No | `coordinator`, `selected` |
| `confidence.high` | confidence | `normal` | **Yes** (0.8–1.0) | `coordinator` |
| `confidence.medium` | confidence | `normal` | **Yes** (0.4–0.79) | `coordinator` |
| `confidence.low` | confidence | `high` | **Yes** (0.1–0.39) | `coordinator` |
| `confidence.blocker` | confidence | `high` | **Yes** (0.0) | `coordinator` |
| `conflict.active` | conflict | `high` | **Yes** (any 0.0–1.0) | `coordinator` |
| `conflict.resolved` | conflict | `normal` | **Yes** (from source signal) | `coordinator` |
| `handoff.ready` | handoff | `normal` | No | `selected`, `coordinator` |
| `handoff.partial` | handoff | `normal` | No | `selected`, `coordinator` |
| `escalation.interrupt` | escalation | `critical` | No | `coordinator`, `all` |
| `escalation.uncertainty` | escalation | `high` | No | `coordinator` |

---

## 1. `attention.raise`

**Message class:** `attention`

### Semantic

A component has observed something that may change how another component should interpret the current context or proceed with its work. The signal does not demand immediate action; it raises the salience of a piece of information for the recipient.

### When to use

- Memory retrieves context that shifts the likely intent of a user request
- A supporting specialist notices a constraint that the primary specialist may not have considered
- A reviewer sees a background fact that contradicts an assumption in the current draft

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'attention'` |
| `signalClass` | `'attention.raise'` |
| `summary` | One sentence describing what changed and why it matters |

### Optional fields

| Field | Guidance |
|---|---|
| `confidence` | Omit unless you have a meaningful salience score to express |
| `details` | Include the specific context fragment if it is compact (<500 chars) |
| `expiresAtStep` | Set if the context is step-specific and will be stale by next synthesis |
| `replaces` | Set if this supersedes an earlier `attention.raise` from the same source |

### Audience guidance

- `coordinator` — when the coordinator should weigh this before synthesis
- `selected` — when a specific downstream specialist should consider this before producing output; requires `SelectedAudienceResolver`

### Priority guidance

Default: `normal`. Escalate to `high` only if the attention signal indicates a potential safety or policy issue that should interrupt current work. Do not use `critical`.

### Convergence responsibility

Coordination resolves `attention.raise` signals after synthesis consumes them or after they expire. Emitters should set `expiresAtStep` when possible to enable auto-expiry.

### Anti-patterns

- Do not emit `attention.raise` every time memory retrieves any context; emit only when the context changes the likely answer
- Do not use `attention.raise` to broadcast reasoning transcripts; use `details` compactly
- Do not emit with `audience='all'` unless every active specialist will change behavior based on this signal

---

## 2. `confidence.high`

**Message class:** `confidence`

### Semantic

The emitting specialist's current output is stable, well-supported, and ready for synthesis. The coordinator can treat this output as reliable input.

### When to use

- A specialist has completed its assigned subtask with high certainty
- Evidence for the conclusion is strong and consistent
- No conflicting signals remain unresolved for this source

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'confidence'` |
| `signalClass` | `'confidence.high'` |
| `confidence` | 0.8–1.0 |
| `summary` | What was concluded and why confidence is high |

### Audience guidance

`coordinator` only. Confidence signals are coordination inputs; they are not narrowcast to other specialists.

### Priority guidance

Default: `normal`. Do not use `high` or `critical` for confidence signals; high confidence does not require interruption.

### Convergence responsibility

Coordination resolves `confidence.*` signals once synthesis has consumed the output. Do not leave confidence signals unresolved across multiple steps.

### Supersession

When a specialist's confidence changes from a prior signal, emit the new confidence level with `replaces` pointing to the prior confidence signal. Do not emit a second confidence signal for the same step without superseding the first.

---

## 3. `confidence.medium`

**Message class:** `confidence`

### Semantic

The emitting specialist's output is reasonable but carries caveats. The coordinator should synthesize this output but may want to flag the caveats to the user or request a deeper review.

### When to use

- Evidence is consistent but not exhaustive
- The specialist completed work but under partial information
- There is one unresolved background assumption that does not block synthesis

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'confidence'` |
| `signalClass` | `'confidence.medium'` |
| `confidence` | 0.4–0.79 |
| `summary` | The conclusion and what caveat reduces confidence |

### Priority guidance

Default: `normal`. Use `high` if the caveat concerns a policy-sensitive area.

### Anti-patterns

- Do not use `confidence.medium` as a default when you have not assessed confidence; use it only when you have a specific reason for the caveat
- Do not emit `confidence.medium` and `confidence.low` simultaneously from the same source

---

## 4. `confidence.low`

**Message class:** `confidence`

### Semantic

The emitting specialist's output is speculative or weakly supported. The coordinator should consider whether to use this output at all, re-delegate to a more capable routing mode, or hold synthesis pending additional input.

### When to use

- The specialist completed the task but with significant uncertainty
- Evidence is contradictory or sparse
- The result depends heavily on an assumption the specialist cannot verify

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'confidence'` |
| `signalClass` | `'confidence.low'` |
| `confidence` | 0.1–0.39 |
| `summary` | What makes confidence low; what would increase it |

### Priority guidance

Default: `high`. Low confidence output affects synthesis quality; the coordinator should be alerted promptly.

### Convergence responsibility

Coordination should either re-delegate this subtask in a deeper routing mode, request more input, or explicitly decide to proceed with the low-confidence output. If re-delegating, resolve the `confidence.low` signal after the new specialist emits.

---

## 5. `confidence.blocker`

**Message class:** `confidence`

### Semantic

The emitting specialist cannot produce useful output without additional input, clarification, or a routing mode change. Synthesis should not proceed for this specialist's subtask until the blocker is resolved.

### When to use

- The specialist lacks a required piece of information
- The task cannot be completed under the current routing mode's constraints
- A dependency on another specialist's output has not been satisfied

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'confidence'` |
| `signalClass` | `'confidence.blocker'` |
| `confidence` | 0.0 (exactly) |
| `summary` | What is missing; what would unblock |

### Priority guidance

Default: `high`. If the blocker involves a policy issue or would corrupt final output, use `critical`.

### Convergence responsibility

The coordinator must act on `confidence.blocker` before synthesis. Options: request more information, re-route to a deeper mode, substitute an alternative specialist, or communicate the limitation to the user. After resolution, emit a superseding `confidence.*` signal with `replaces` pointing to the blocker.

### Anti-patterns

- Do not emit `confidence.blocker` speculatively as a first response; attempt the task and only emit if genuinely blocked
- Do not leave `confidence.blocker` unresolved across multiple steps without coordination action

---

## 6. `conflict.active`

**Message class:** `conflict`

### Semantic

The emitting component has identified a disagreement between two active views or outputs that affects the final answer. The conflict is unresolved and requires coordination action before synthesis can proceed.

### When to use

- A reviewer finds that the current draft contradicts a verified fact
- Two specialists have produced outputs that cannot both be correct
- Memory context contradicts a live evidence conclusion

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'conflict'` |
| `signalClass` | `'conflict.active'` |
| `confidence` | The emitter's confidence that the conflict is real (0.0–1.0) |
| `summary` | What the two conflicting views are; which sources hold each view |

### Optional fields

| Field | Guidance |
|---|---|
| `details` | Compact evidence supporting the conflict claim |
| `priority` | `high` is standard; `critical` if the conflict would produce incorrect or unsafe output |

### Priority guidance

Default: `high`. Do not use `low` or `normal` for unresolved conflicts.

### Convergence responsibility

Coordination must arbitrate or re-route when `conflict.active` signals are present. After resolution, emit `conflict.resolved` and call `resolve()` on each `conflict.active` signal. Synthesis should not proceed while `conflict.active` signals remain in `active` state.

### Multiple conflicts

Multiple `conflict.active` signals from different sources are normal. Coordination's `query()` for `messageClass='conflict', state=['emitted','active']` retrieves all open conflicts at once.

---

## 7. `conflict.resolved`

**Message class:** `conflict`

### Semantic

A previously flagged conflict has been arbitrated or dissolved. The emitter is declaring that the conflict is no longer blocking synthesis.

### When to use

- After coordination arbitrates between conflicting views and a winner is determined
- After re-routing to a deeper mode produces a consistent answer
- After new information dissolves the conflict

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'conflict'` |
| `signalClass` | `'conflict.resolved'` |
| `confidence` | Confidence that the resolution is correct (carry forward from the winning signal or set explicitly) |
| `summary` | How the conflict was resolved |

### Convergence responsibility

After emitting `conflict.resolved`, coordination should call `resolve()` on all related `conflict.active` signals. The `conflict.resolved` signal itself should be resolved after synthesis consumes it.

---

## 8. `handoff.ready`

**Message class:** `handoff`

### Semantic

The emitting specialist has completed its work for the current step. Its output is ready for downstream consumption. The downstream component can proceed without polling.

### When to use

- A planner finishes a plan and hands it to reviewers
- A reviewer completes its pass and hands findings to the synthesis component
- Memory enrichment is complete and the enriched context is available

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'handoff'` |
| `signalClass` | `'handoff.ready'` |
| `summary` | What output is ready and where it can be accessed |

---ROUTING SPEC---
# v1 Routing Spec — `@relay-assistant/routing`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/routing`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.2 (after core, sessions, surfaces, memory, connectivity land)

---

## 1. Responsibilities

`@relay-assistant/routing` manages model selection and routing-mode decisions across an assistant's coordination context. It is the layer that translates cost/latency/quality requirements into concrete model choices, without knowing about business logic or user-facing content.

This package is directly informed by Workforce routing patterns: cheap/fast/deep mode tiers, per-request cost envelopes, and quality-preserving routing with configurable thresholds.

**Owns:**
- `RoutingMode` — the three-tier model: `cheap`, `fast`, `deep`
- `ModelSelector` — given a routing context, returns a model specification
- `RoutingPolicy` — per-assistant and per-capability routing rules; configures when to use each mode
- `RoutingContext` — the signal envelope passed to the model selector for each invocation
- Cost envelope tracking — per-thread accounting of token/cost budget; trips mode escalation when exceeded
- Latency envelope — per-request latency target; routing selects models that can meet it
- Escalation receiver — implements `RoutingEscalationHook` from `@relay-assistant/connectivity`; applies requested mode changes

**Does NOT own:**
- The actual model API calls (→ product code or capability handlers; routing provides the model spec, not the invocation)
- Prompts, context assembly, or response formatting (→ product capability handlers)
- Coordination logic or specialist delegation (→ `@relay-assistant/coordination`)
- Connectivity signals (→ `@relay-assistant/connectivity`; routing receives escalation signals from connectivity, does not emit them)
- Session management (→ `@relay-assistant/sessions`)
- Surface delivery (→ `@relay-assistant/surfaces`)

---

## 2. Non-Goals

- Routing does not implement load balancing, failover, or retries across providers. Those are relay-foundation or product concerns.
- Routing does not make semantic content decisions. It does not read message text to decide routing; it reads structured context (capability name, cost envelope, escalation signals, constraints).
- Routing does not define model IDs. It defines `ModelSpec` — a structured description that product code resolves to a concrete model ID. This keeps routing OSS and provider-agnostic.
- Routing does not enforce policy; it recommends. The caller may override a routing decision if it has product-specific reasons.
- Routing is not a multi-step planner. It returns a single `RoutingDecision` per invocation context.
- Routing does not maintain session state or per-user history.

---

## 3. Routing Modes

Workforce-informed three-tier model:

| Mode | Intent | Typical characteristics |
|---|---|---|
| `cheap` | Minimize cost; quality bar is acceptable for routine tasks | Smaller model, limited context window, no tool use |
| `fast` | Minimize latency; quality bar is good for interactive responses | Mid-tier model, moderate context, standard tool use |
| `deep` | Maximize quality; cost and latency are secondary | Largest model, full context, full tool use, may include chain-of-thought |

Modes are advisory. The model selector maps modes to `ModelSpec`; products configure which concrete models correspond to each mode.

---

## 4. Interfaces and Contracts

### 4.1 `RoutingMode`

```typescript
export type RoutingMode = 'cheap' | 'fast' | 'deep';
```

### 4.2 `ModelSpec`

```typescript
/**
 * A routing recommendation, not a concrete model ID.
 * Product code resolves this to a provider-specific model ID.
 */
export interface ModelSpec {
  /** Routing mode this spec corresponds to. */
  mode: RoutingMode;

  /**
   * Capability tier requested. Products map tiers to model IDs in their
   * configuration. Standard tiers: 'small', 'medium', 'large', 'frontier'.
   */
  tier: ModelTier;

  /**
   * Whether tool use is required. When true, the resolved model must support
   * function calling / tool use.
   */
  requiresToolUse: boolean;

  /**
   * Whether streaming is required. When true, the resolved model must support
   * streaming responses.
   */
  requiresStreaming: boolean;

  /**
   * Minimum context window required, in tokens. 0 = no requirement.
   */
  minContextTokens: number;

  /**
   * Maximum acceptable latency to first token, in milliseconds.
   * 0 = no requirement.
   */
  maxLatencyMs: number;

  /**
   * Arbitrary routing hints for product-specific resolution. Routing populates
   * these from RoutingPolicy; product code may use them to select among
   * multiple models that otherwise match.
   */
  hints: Record<string, unknown>;
}

export type ModelTier = 'small' | 'medium' | 'large' | 'frontier' | string;
```

### 4.3 `RoutingContext`

```typescript
/**
 * Input to the routing decision. Built by the caller (capability handler or
 * coordinator) and passed to router.decide().
 */
export interface RoutingContext {
  /** Thread or session this invocation belongs to. */
  threadId: string;

  /**
   * The capability being invoked. Routing policy may have per-capability
   * mode overrides.
   */
  capability: string;

  /**
   * Current accumulated cost for this thread, in abstract units.
   * Routing uses this to determine if the cost envelope has been exceeded.
   */
  accumulatedCost?: number;

  /**
   * Desired maximum latency for this response, in milliseconds.
   * 0 = no requirement (routing uses its default).
   */
  requestedMaxLatencyMs?: number;

  /**
   * Whether this invocation requires tool use.
   */
  requiresToolUse?: boolean;

  /**
   * Whether this invocation requires streaming.
   */
  requiresStreaming?: boolean;

  /**
   * Minimum context window required.
   */
  minContextTokens?: number;

  /**
   * Escalation signals active in this thread, from the connectivity layer.
   * Routing reads escalation signals to potentially upgrade the mode.
   */
  activeEscalations?: EscalationSummary[];

  /**
   * Caller-requested mode override. When set, routing respects this unless
   * the RoutingPolicy has a hard constraint.
   */
  requestedMode?: RoutingMode;
}

export interface EscalationSummary {
  signalClass: string;
  priority: string;
  requestedMode?: string;
}
```

### 4.4 `RoutingDecision`

```typescript
export interface RoutingDecision {
  /** The recommended routing mode. */
  mode: RoutingMode;

  /** The model specification for this decision. */
  modelSpec: ModelSpec;

  /**
   * The reason for this decision. Used for logging and debugging.
   * Not shown to users.
   */
  reason: RoutingReason;

  /**
   * Whether the mode was escalated from the policy default due to signals
   * or cost envelope.
   */
  escalated: boolean;

  /**
   * Whether the caller's requestedMode was overridden by policy.
   */
  overridden: boolean;
}

export type RoutingReason =
  | 'policy_default'
  | 'capability_override'
  | 'escalation_signal'
  | 'cost_envelope_exceeded'
  | 'latency_constraint'
  | 'caller_requested'
  | 'hard_constraint';
```

### 4.5 `Router`

```typescript
export interface Router {
  /**
   * Make a routing decision for the given context.
   * Never throws; returns a decision even when falling back to defaults.
   */
  decide(context: RoutingContext): RoutingDecision;

  /**
   * Record the actual cost of a completed invocation. Used for cost
   * envelope tracking within a thread.
   */
  recordCost(threadId: string, cost: number): void;

  /**
   * Get the current accumulated cost for a thread.
   */
  getAccumulatedCost(threadId: string): number;

  /**
   * Reset cost tracking for a thread (e.g., at session end).
   */
  resetCost(threadId: string): void;

  /**
   * Implements RoutingEscalationHook from @relay-assistant/connectivity.
   * Called by the connectivity layer when an escalation signal is emitted.
   * Returns the requested routing mode based on the signal.
   */
  onEscalation(signal: ConnectivityEscalationSignal): RequestedRoutingMode | void;
}
```

### 4.6 `RoutingPolicy`

```typescript
/**

---CONNECTIVITY README---
# @relay-assistant/connectivity

**Version:** 0.1.0 (pre-1.0, provisional)
**Status:** v1 spec locked — ready for implementation
**Spec:** [`docs/specs/v1-connectivity-spec.md`](../../docs/specs/v1-connectivity-spec.md)
**Signal catalog:** [`docs/reference/connectivity-signal-catalog.md`](../../docs/reference/connectivity-signal-catalog.md)
**Implementation plan:** [`docs/architecture/v1-connectivity-implementation-plan.md`](../../docs/architecture/v1-connectivity-implementation-plan.md)

---

## What This Package Is

`@relay-assistant/connectivity` is the typed, in-process signaling layer for internal multi-agent coordination. It gives specialists, coordinators, and supporting subsystems a structured way to communicate state, confidence, conflicts, handoffs, and escalations — without verbose transcript exchange.

It is not a generic event bus. Signals are small, typed, and semantically constrained. Every signal declares who should receive it, how urgent it is, and when it can be discarded.

## What This Package Is Not

- Not a pub/sub system. There are no topics or subscriptions; audience is a semantic role (`self`, `coordinator`, `selected`, `all`).
- Not a transport layer. Signals are in-process function calls and callbacks in v1. No network, no queue, no retry.
- Not a routing engine. Connectivity can request a routing mode change via an escalation hook; routing decides whether to apply it.
- Not a coordination engine. Connectivity does not assign work, collect outputs, or orchestrate specialists. That is `@relay-assistant/coordination`.
- Not a user-facing layer. Signals never leave the process; users never see them.

---

## Quick Start

```typescript
import { createConnectivityLayer } from '@relay-assistant/connectivity';

const layer = createConnectivityLayer();

// Subscribe to all signal events
layer.onSignal((signal, event) => {
  console.log(`[${event}] ${signal.signalClass} from ${signal.source}: ${signal.summary}`);
});

// Emit a confidence signal from a specialist
const signal = layer.emit({
  threadId: 'thread-123',
  source: 'specialist:reviewer',
  audience: 'coordinator',
  messageClass: 'confidence',
  signalClass: 'confidence.high',
  priority: 'normal',
  confidence: 0.92,
  summary: 'Review complete — no issues found',
});

// Resolve after synthesis consumes it
layer.resolve(signal.id);
```

---

## Signal Classes

Five message classes, eleven signal classes. No custom classes in v1.

| Signal class | When to use |
|---|---|
| `attention.raise` | Flag context that may change another component's behavior |
| `confidence.high` | Output is stable (0.8–1.0) |
| `confidence.medium` | Output has caveats (0.4–0.79) |
| `confidence.low` | Output is speculative (0.1–0.39) |
| `confidence.blocker` | Cannot produce output without more input (0.0) |
| `conflict.active` | Two active views disagree; synthesis should wait |
| `conflict.resolved` | A prior conflict has been arbitrated |
| `handoff.ready` | Output is complete; downstream can proceed |
| `handoff.partial` | Partial output available; more is coming |
| `escalation.interrupt` | Stop the current path immediately (`priority='critical'`) |
| `escalation.uncertainty` | Current routing mode is insufficient; requesting escalation (`priority='high'`) |

See [`docs/reference/connectivity-signal-catalog.md`](../../docs/reference/connectivity-signal-catalog.md) for full semantics, required fields, and anti-patterns per signal class.

---

## Core API

### `createConnectivityLayer(config?)`

Returns a `ConnectivityLayer` instance. Multiple threads share one instance; all state is partitioned by `threadId`.

```typescript
const layer = createConnectivityLayer({
  suppressionConfig: { basis: 'step' },          // default
  routingEscalationHook: myRoutingHook,           // optional
});
```

### `layer.emit(input)`

Emit a signal. Returns the stored signal. If the signal is a duplicate within the current suppression window, returns the existing signal unchanged (no new signal stored).

```typescript
const signal = layer.emit({
  threadId: string,
  source: string,
  audience: 'self' | 'coordinator' | 'selected' | 'all',
  messageClass: MessageClass,
  signalClass: SignalClass,
  priority: 'low' | 'normal' | 'high' | 'critical',
  summary: string,
  confidence?: number,      // required for confidence.* and conflict.*
  details?: string,
  replaces?: string,        // supersedes the target signal
  expiresAtStep?: number,
});
```

### `layer.resolve(signalId)`

Transition a signal to `resolved`. Idempotent. Fires `onSignal` callback with `event='resolved'`.

### `layer.query(query)`

Query signals in a thread. Default state filter is `['emitted', 'active']`.

```typescript
const openConflicts = layer.query({
  threadId: 'thread-123',
  messageClass: 'conflict',
  state: ['emitted', 'active'],
});
```

### `layer.get(signalId)`

Retrieve a single signal by ID. Returns `null` if not found.

### `layer.advanceStep(threadId)`

Advance the step counter for a thread. Signals with `expiresAtStep` at or before the new step are expired and `onSignal` fires with `event='expired'` for each.

### `layer.registerSelectedResolver(resolver)`

Register a function that resolves `audience='selected'` signals to a list of component IDs. Called by coordination at initialization.

```typescript
layer.registerSelectedResolver((signal) => {
  return myCoordinationContext.getDownstreamComponents(signal);
});
```

### `layer.onSignal(callback)` / `layer.offSignal(callback)`

Subscribe or unsubscribe from all signal state transitions: `'emitted'`, `'superseded'`, `'resolved'`, `'expired'`.

---

## Signal Lifecycle

```
emitted ──► active ──► superseded   (newer signal with replaces= targeting this ID)
                   └──► expired      (expiresAtStep passed via advanceStep)
                   └──► resolved     (explicitly resolved via resolve())
```

Terminal states (`superseded`, `expired`, `resolved`) cannot transition further. All signals are retained in the log regardless of state.

---

## Suppression

Suppression prevents duplicate signals within a coordination step or time window.

Two signals are duplicates when they share `threadId + source + signalClass + audience` and neither has been resolved or superseded.

- `priority='critical'` signals are **never suppressed**
- Default basis: `'step'` (window resets on `advanceStep()`)
- Alternative: `'time'` with a configurable `windowMs` (default 5000ms)

When a duplicate is suppressed, `emit()` returns the existing signal unchanged. Detect suppression by checking if the returned `id` differs from what you expected.

---

## Routing Integration

Connectivity influences routing via a one-directional escalation hook. Routing never calls connectivity.

```typescript
// Routing implements this interface:
interface RoutingEscalationHook {
  onEscalation(signal: ConnectivitySignal): 'cheap' | 'fast' | 'deep' | void;
}

// Register at initialization:
const layer = createConnectivityLayer({
  routingEscalationHook: myRoutingLayer,
});
```

When `escalation.interrupt` or `escalation.uncertainty` is emitted, the hook is called synchronously. Routing decides whether to change its mode. Connectivity does not store or act on the returned mode.

---

## Package Boundaries

| Import direction | Permitted |
|---|---|
| Connectivity → `@relay-assistant/core` | Yes — type imports only |
| Connectivity → `@relay-assistant/routing` | Yes — `import type { RequestedRoutingMode }` only |
| Connectivity → sessions / surfaces / memory / coordination | **No** |
| `@relay-assistant/coordination` → connectivity | Yes — primary consumer |
| `@relay-assistant/routing` → connectivity | Yes — implements `RoutingEscalationHook` |
| Product specialist handlers → connectivity | Yes — call `emit()` directly |

---

## v1 Deferrals

These are not in scope for v1:

- Distributed or cross-process signal delivery
- Persistent signal log (in-memory only)
- Async `emit()`
- Custom product-specific signal classes
- Maximum active signals per thread
- Cloud observability pipelines

---

CONNECTIVITY_PACKAGE_READY
