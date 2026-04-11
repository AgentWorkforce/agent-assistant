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
| emit() orchestration matches spec | PASS |
| Lifecycle state machine correct | PASS |
| Suppression logic correct | PASS |
| Routing boundary clean | PASS |
| Coordination boundary clean | PASS |
| No forbidden dependencies | PASS |
| Public API surface | NEAR PASS (extra constants exported) |
| tsconfig strictness | GAP (missing exactOptionalPropertyTypes) |
| Test count vs. plan minimum | GAP (~20 of 60+ tests) |
| All 4 workflow shapes covered | PASS (WF-C1, WF-C4 complete; WF-C2 partial; WF-C3 partial) |

The implementation is functionally correct, boundary-clean, and demonstrates all four v1 workflow shapes. The core logic faithfully implements the spec. The gaps are in test completeness and one tsconfig flag — neither blocks the implementation from being valid, but both should be resolved before integration dependencies accumulate. Integration work can begin in parallel with FU-1 and FU-2 being addressed.

---

V1_CONNECTIVITY_PACKAGE_REVIEW_COMPLETE

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


---CONNECTIVITY PLAN---
# v1 Connectivity Package Implementation Plan

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Canonical spec:** `docs/specs/v1-connectivity-spec.md` (V1_CONNECTIVITY_SPEC_READY)
**Scope reference:** `docs/architecture/v1-connectivity-scope.md` (SCOPE_LOCKED)
**Implementation plan reference:** `docs/architecture/v1-connectivity-implementation-plan.md` (V1_CONNECTIVITY_IMPLEMENTATION_PLAN_READY)
**Signal catalog:** `docs/reference/connectivity-signal-catalog.md`
**Package:** `@relay-assistant/connectivity`
**Version target:** v0.1.0

---

## 1. Exact Files to Create

```
packages/connectivity/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Public API barrel export
│   ├── types.ts                    # All interfaces, union types, type aliases
│   ├── errors.ts                   # ConnectivityError, SignalValidationError, SignalNotFoundError
│   ├── id.ts                       # generateSignalId() → sig_<nanoid>
│   ├── validate.ts                 # Input validation for emit()
│   ├── log.ts                      # SignalLog: in-memory Map<threadId, ConnectivitySignal[]>
│   ├── lifecycle.ts                # State machine: resolve(), supersede(), expire()
│   ├── suppression.ts              # SuppressionWindow: step-basis and time-basis duplicate detection
│   ├── audience.ts                 # AudienceResolver: self, coordinator, selected, all
│   ├── callbacks.ts                # CallbackRegistry: onSignal/offSignal management
│   ├── layer.ts                    # createConnectivityLayer() factory, ConnectivityLayer impl
│   └── __tests__/
│       ├── types.test.ts           # Type export structural checks
│       ├── log.test.ts             # emit, get, query
│       ├── lifecycle.test.ts       # resolve, supersede transitions
│       ├── suppression.test.ts     # Duplicate detection behavior
│       ├── step.test.ts            # advanceStep and expiry
│       ├── callbacks.test.ts       # onSignal / offSignal firing rules
│       ├── audience.test.ts        # Audience resolution logic
│       ├── routing.test.ts         # Routing escalation hook
│       └── integration/
│           ├── wf-c1.test.ts       # WF-C1: Narrowcast attention
│           ├── wf-c2.test.ts       # WF-C2: Reviewer conflict
│           ├── wf-c3.test.ts       # WF-C3: Specialist handoff
│           └── wf-c4.test.ts       # WF-C4: Blocker uncertainty routing
```

**Total: 24 files.** One runtime dependency: `nanoid` for ID generation.

Note: `validate.ts` and `callbacks.ts` are split out from the broader plan's `log.ts` and `layer.ts` respectively, to keep each file focused on a single concern and under ~150 lines.

---

## 2. Minimal v1 Slice

The v1 implementation is the complete in-process signaling layer. There is no "partial v1" — all 8 implementation steps are required for the four workflow shapes (WF-C1 through WF-C4) to function. However, the steps are strictly ordered by dependency and can be implemented and tested incrementally.

### What v1 includes

- All 16 type exports (see §3)
- Synchronous `emit()` with validation, suppression, supersession, and escalation hook
- In-memory signal log partitioned by `threadId`
- Full signal lifecycle state machine: `emitted → active → [superseded | expired | resolved]`
- Step-basis and time-basis suppression
- `onSignal`/`offSignal` callback system
- Audience resolution with pluggable `SelectedAudienceResolver`
- One-directional routing escalation hook (interface only)
- `createConnectivityLayer()` factory

### What v1 does NOT include

- Distributed or cross-process signal delivery
- Persistent signal log (in-memory only, no serialization)
- Async `emit()`
- Custom signal classes beyond the 11 defined
- Maximum active signals per thread cap
- Cloud observability or telemetry hooks

---

## 3. Implementation Steps

### Step 1 — Types and Errors

**Files:** `src/types.ts`, `src/errors.ts`

No runtime logic. Pure type definitions.

**`types.ts` exports:**

| Export | Kind | Source |
|---|---|---|
| `ConnectivitySignal` | interface | Spec §2.1 |
| `EmitSignalInput` | interface | Spec §2.3 |
| `SignalQuery` | interface | Spec §8.1 |
| `ConnectivityLayerConfig` | interface | Spec §15 |
| `SuppressionConfig` | interface | Spec §7.2 |
| `RoutingEscalationHook` | interface | Spec §8, scope §1.7 |
| `SelectedAudienceResolver` | type alias | `(signal: ConnectivitySignal) => string[]` |
| `SignalCallback` | type alias | `(signal: ConnectivitySignal, event: SignalEvent) => void` |
| `ConnectivityLayer` | interface | Spec §8 |
| `SignalAudience` | union type | `'self' \| 'coordinator' \| 'selected' \| 'all'` |
| `MessageClass` | union type | 5 values |
| `SignalClass` | union type | 11 values |
| `SignalPriority` | union type | `'low' \| 'normal' \| 'high' \| 'critical'` |
| `SignalState` | union type | `'emitted' \| 'active' \| 'superseded' \| 'expired' \| 'resolved'` |
| `SignalEvent` | union type | `'emitted' \| 'superseded' \| 'resolved' \| 'expired'` |
| `RequestedRoutingMode` | union type | `'cheap' \| 'fast' \| 'deep'` |

**`errors.ts` exports:**

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

**Runtime constants** (also in `types.ts`):

```typescript
/** Map from messageClass to valid signalClass prefixes, used by validation. */
export const MESSAGE_CLASS_TO_SIGNAL_PREFIX: Record<MessageClass, string> = {
  attention: 'attention.',
  confidence: 'confidence.',
  conflict: 'conflict.',
  handoff: 'handoff.',
  escalation: 'escalation.',
};

/** Terminal states that cannot transition further. */
export const TERMINAL_STATES: readonly SignalState[] = ['superseded', 'expired', 'resolved'];
```

---

### Step 2 — ID Generation and Validation

**Files:** `src/id.ts`, `src/validate.ts`

**`id.ts`:**

```typescript
import { nanoid } from 'nanoid';

export function generateSignalId(): string {
  return `sig_${nanoid()}`;
}
```

**`validate.ts`:**

Exports a single function: `validateEmitInput(input: EmitSignalInput): void` that throws `SignalValidationError` on any violation.

Validation rules (from spec §2.3):
1. `threadId`, `source`, `summary` must be non-empty strings
2. `signalClass` must start with `messageClass + '.'` (e.g., `'confidence.high'` requires `messageClass='confidence'`)
3. `confidence` must be present and in `[0.0, 1.0]` when `messageClass` is `'confidence'` or `'conflict'`
4. `confidence` must be in `[0.0, 1.0]` when present on any signal class
5. `signalClass` must be one of the 11 defined values
6. `messageClass` must be one of the 5 defined values
7. `priority` must be one of the 4 defined values

Note: `replaces` validation (must reference a valid signal in the same thread) is performed in `log.ts` where the log is accessible, not here.

---

### Step 3 — Signal Log

**File:** `src/log.ts`

```typescript
export class SignalLog {
  private readonly signals: Map<string, ConnectivitySignal[]> = new Map();
  private readonly index: Map<string, ConnectivitySignal> = new Map(); // id → signal
  private readonly stepCounters: Map<string, number> = new Map();      // threadId → step

  store(signal: ConnectivitySignal): void;
  get(signalId: string): ConnectivitySignal | null;
  query(query: SignalQuery): ConnectivitySignal[];
  getByThread(threadId: string): ConnectivitySignal[];
  getStep(threadId: string): number;
  incrementStep(threadId: string): number;
}
```

**`store()`** appends the signal to the thread's array and indexes by `id`.

**`query()`** implementation:
- Default state filter: `['emitted', 'active']`
- All filters combined with AND semantics
- Array-valued filters (`messageClass[]`, `signalClass[]`, `state[]`, `priority[]`) use OR within the filter
- Optional filters: `source`, `after` (ISO-8601), `before` (ISO-8601)
- Default `limit`: 50
- Default `order`: `'newest'` (descending by `emittedAt`)

**`SignalQuery` interface** (from spec §8.1):

```typescript
export interface SignalQuery {
  threadId: string;
  source?: string;
  messageClass?: MessageClass | MessageClass[];
  signalClass?: SignalClass | SignalClass[];
  state?: SignalState[];
  priority?: SignalPriority | SignalPriority[];
  after?: string;
  before?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
}
```

---

### Step 4 — State Transitions

**File:** `src/lifecycle.ts`

```typescript
export function resolveSignal(log: SignalLog, signalId: string): ConnectivitySignal;
export function supersedeSignal(log: SignalLog, replacedId: string): ConnectivitySignal;
export function expireSignals(log: SignalLog, threadId: string, currentStep: number): ConnectivitySignal[];
```

**`resolveSignal()`:**
- Get signal by ID; throw `SignalNotFoundError` if not found
- If already `'resolved'`, return unchanged (idempotent)
- If in any other terminal state (`'superseded'`, `'expired'`), throw `ConnectivityError`
- Mutate `state` to `'resolved'` in place

**`supersedeSignal()`:**
- Get replaced signal by ID; throw `SignalNotFoundError` if not found
- If already in a terminal state, throw `ConnectivityError`
- Mutate `state` to `'superseded'` in place

**`expireSignals()`:**
- Scan thread's signals for `expiresAtStep !== undefined && expiresAtStep <= currentStep`
- Filter to non-terminal states only
- Mutate each to `state='expired'`
- Return the list of expired signals

---

### Step 5 — Suppression

**File:** `src/suppression.ts`

```typescript
export class SuppressionWindow {
  constructor(config: SuppressionConfig);

  check(input: EmitSignalInput, existingSignals: ConnectivitySignal[]): ConnectivitySignal | null;
  advanceStep(): void;
}
```

**Duplicate key:** `${threadId}|${source}|${signalClass}|${audience}`

**`check()` returns the existing signal when:**
1. An active (non-terminal) signal with the same key exists within the window
2. The input's `priority` is not `'critical'`

**`check()` returns null (signal is NOT suppressed) when:**
1. No matching key exists
2. All matching signals are in terminal states
3. `priority='critical'`
4. Time-basis: matching signal's `emittedAt` is older than `windowMs`

**`advanceStep()`:** Resets the step window. For step-basis, this means the next check starts fresh. For time-basis, this is a no-op (time window is always evaluated from current time).

---

### Step 6 — Callbacks

**File:** `src/callbacks.ts`

```typescript
export class CallbackRegistry {
  register(callback: SignalCallback): void;
  unregister(callback: SignalCallback): void;
  fire(signal: ConnectivitySignal, event: SignalEvent): void;
}
```

**`fire()` rules:**
- Callbacks called synchronously in registration order
- Each callback wrapped in `try/catch`; exceptions logged to `console.error` but do not abort subsequent callbacks
- Suppressed `emit()` calls do NOT fire callbacks (no new event occurred)

---

### Step 7 — Audience Resolution

**File:** `src/audience.ts`

```typescript
export class AudienceResolver {
  registerSelectedResolver(resolver: SelectedAudienceResolver): void;
  resolve(signal: ConnectivitySignal, log: SignalLog): string[];
}
```

**Resolution rules:**
- `'self'` → `[signal.source]`
- `'coordinator'` → `['coordinator']`
- `'selected'` → calls registered `SelectedAudienceResolver(signal)`, or `[]` if none registered
- `'all'` → all unique sources that have emitted signals on the thread (from log) plus `'coordinator'`

Resolved recipient IDs are not stored on the signal. They are computed at emit time. In v1, `onSignal` callbacks fire to all registered listeners regardless of audience — audience resolution is informational for coordination to act on.

---


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
  if (signal.state === 'resolved') {
    return;
  }

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
      const threadSignals = getThreadSignals(query.threadId);
      const messageClasses = toArray(query.messageClass);
      const signalClasses = toArray(query.signalClass);
      const priorities = toArray(query.priority);
      const states = toArray(query.state) ?? ['emitted', 'active'];
      const since = query.since ? Date.parse(query.since) : undefined;
      const before = query.before ? Date.parse(query.before) : undefined;
      const limit = query.limit ?? DEFAULT_LIMIT;
      const order = query.order ?? 'newest';

      const matches = threadSignals.filter((signal) => {
        if (query.source && signal.source !== query.source) {
          return false;
        }

        if (!filterByEnum(signal.messageClass, messageClasses)) {
          return false;
        }

        if (!filterByEnum(signal.signalClass, signalClasses)) {
          return false;
        }

        if (!filterByEnum(signal.priority, priorities)) {
          return false;
        }

        if (!filterByEnum(signal.state, states)) {
          return false;
        }

        const emittedAt = Date.parse(signal.emittedAt);
        if (since !== undefined && emittedAt <= since) {
          return false;
        }

        if (before !== undefined && emittedAt >= before) {
          return false;
        }

        return true;
      });

      const sorted = [...matches].sort((left, right) => {
        const delta = Date.parse(left.emittedAt) - Date.parse(right.emittedAt);
        return order === 'oldest' ? delta : -delta;
      });

      return sorted.slice(0, limit);
    },

    advanceStep(threadId) {
      const currentStep = (stepsByThread.get(threadId) ?? 0) + 1;
      stepsByThread.set(threadId, currentStep);

      for (const signal of getThreadSignals(threadId)) {
        if (
          signal.expiresAtStep === undefined ||

---CONNECTIVITY TESTS---
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConnectivityError,
  MESSAGE_CLASS_TO_SIGNAL_PREFIX,
  SignalNotFoundError,
  SignalValidationError,
  createConnectivityLayer,
} from './index.js';
import type {
  ConnectivityLayer,
  EmitSignalInput,
  SignalClass,
  SignalEvent,
  SignalState,
} from './types.js';

function baseInput(overrides: Partial<EmitSignalInput> = {}): EmitSignalInput {
  return {
    threadId: 'thread-1',
    source: 'specialist:reviewer',
    audience: 'coordinator',
    messageClass: 'confidence',
    signalClass: 'confidence.high',
    priority: 'normal',
    confidence: 0.9,
    summary: 'Ready for synthesis',
    ...overrides,
  };
}

function createLayer(): ConnectivityLayer {
  return createConnectivityLayer();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('type and validation behavior', () => {
  it('exports signal prefixes that align with every signal class', () => {
    const signalClasses: SignalClass[] = [
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
    ];

    for (const signalClass of signalClasses) {
      const [messageClass] = signalClass.split('.') as [keyof typeof MESSAGE_CLASS_TO_SIGNAL_PREFIX];
      expect(signalClass.startsWith(MESSAGE_CLASS_TO_SIGNAL_PREFIX[messageClass])).toBe(true);
    }
  });

  it('rejects inconsistent messageClass and signalClass combinations', () => {
    const layer = createLayer();

    expect(() =>
      layer.emit(
        baseInput({
          messageClass: 'attention',
          signalClass: 'confidence.high',
        }),
      ),
    ).toThrowError(SignalValidationError);
  });

  it('rejects invalid class-specific confidence ranges', () => {
    const layer = createLayer();

    expect(() =>
      layer.emit(
        baseInput({
          signalClass: 'confidence.blocker',
          confidence: 0.1,
          summary: 'Blocked',
        }),
      ),
    ).toThrowError(SignalValidationError);
  });
});

describe('emit, get, and query', () => {
  it('assigns ids and timestamps on emit', () => {
    const layer = createLayer();
    const signal = layer.emit(baseInput());

    expect(signal.id.startsWith('sig_')).toBe(true);
    expect(new Date(signal.emittedAt).toISOString()).toBe(signal.emittedAt);
    expect(signal.state).toBe('emitted');
  });

  it('returns null when a signal is missing', () => {
    expect(createLayer().get('missing')).toBeNull();
  });

  it('supports querying by class, state, priority, limit, and order', () => {
    vi.useFakeTimers();
    const layer = createLayer();

    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const first = layer.emit(baseInput());

    vi.setSystemTime(new Date('2026-04-11T00:00:01.000Z'));
    layer.onSignal(() => undefined);
    const second = layer.emit(
      baseInput({
        signalClass: 'conflict.active',
        messageClass: 'conflict',
        priority: 'high',
        confidence: 0.6,
        summary: 'Conflict found',
      }),
    );

    const conflicts = layer.query({
      threadId: 'thread-1',
      messageClass: 'conflict',
    });
    const actives = layer.query({
      threadId: 'thread-1',
      state: ['active'],
    });
    const oldest = layer.query({
      threadId: 'thread-1',
      state: ['emitted', 'active'],
      order: 'oldest',
      limit: 1,
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.id).toBe(second.id);
    expect(actives).toHaveLength(1);
    expect(actives[0]?.id).toBe(second.id);
    expect(oldest.map((item) => item.id)).toEqual([first.id]);
  });

  it('returns an empty array for unknown threads', () => {
    expect(createLayer().query({ threadId: 'missing' })).toEqual([]);
  });
});

describe('lifecycle, suppression, and expiry', () => {
  it('resolves emitted and active signals, idempotently for resolved signals', () => {
    const layer = createLayer();
    const emitted = layer.emit(baseInput());
    expect(layer.resolve(emitted.id).state).toBe('resolved');
    expect(layer.resolve(emitted.id).state).toBe('resolved');

    layer.onSignal(() => undefined);
    const active = layer.emit(
      baseInput({
        summary: 'Active signal',
      }),
    );
    expect(active.state).toBe('active');
    expect(layer.resolve(active.id).state).toBe('resolved');
  });

  it('throws for unknown or terminal signals during resolve', () => {
    const layer = createLayer();
    const original = layer.emit(baseInput());
    layer.emit(
      baseInput({
        signalClass: 'confidence.medium',
        confidence: 0.5,
        summary: 'Updated confidence',
        replaces: original.id,
      }),
    );

    expect(() => layer.resolve('missing')).toThrowError(SignalNotFoundError);
    expect(() => layer.resolve(original.id)).toThrowError(ConnectivityError);
  });

  it('suppresses duplicates within a step and allows them after resolution or step advance', () => {
    const layer = createLayer();
    const first = layer.emit(baseInput());
    const suppressed = layer.emit(baseInput({ summary: 'A different summary still suppresses' }));

    expect(suppressed.id).toBe(first.id);
    expect(layer.query({ threadId: 'thread-1', state: ['emitted', 'active'] })).toHaveLength(1);

    layer.resolve(first.id);
    const afterResolve = layer.emit(baseInput({ summary: 'Re-opened after resolve' }));
    expect(afterResolve.id).not.toBe(first.id);

    layer.advanceStep('thread-1');
    const afterStep = layer.emit(baseInput({ summary: 'Allowed on next step' }));
    expect(afterStep.id).not.toBe(afterResolve.id);
  });

  it('bypasses suppression for critical signals and for high-priority escalation summaries that differ', () => {
    const layer = createLayer();

    const criticalA = layer.emit(
      baseInput({
        messageClass: 'escalation',
        signalClass: 'escalation.interrupt',
        priority: 'critical',
        confidence: undefined,
        summary: 'Stop current plan',
      }),
    );
    const criticalB = layer.emit(
      baseInput({
        messageClass: 'escalation',
        signalClass: 'escalation.interrupt',
        priority: 'critical',
        confidence: undefined,
        summary: 'Stop current plan again',
      }),
    );
    const highA = layer.emit(
      baseInput({
        messageClass: 'escalation',
        signalClass: 'escalation.uncertainty',
        priority: 'high',
        confidence: undefined,
        summary: 'Need deeper routing for ambiguity A',
      }),
    );
    const highB = layer.emit(
      baseInput({
        messageClass: 'escalation',
        signalClass: 'escalation.uncertainty',
        priority: 'high',
        confidence: undefined,
        summary: 'Need deeper routing for ambiguity B',
      }),
    );

    expect(criticalB.id).not.toBe(criticalA.id);
    expect(highB.id).not.toBe(highA.id);
  });

  it('supports time-basis suppression windows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const layer = createConnectivityLayer({
      suppressionConfig: {
        basis: 'time',
        windowMs: 500,
      },
    });

    const first = layer.emit(baseInput());
    vi.setSystemTime(new Date('2026-04-11T00:00:00.250Z'));
    expect(layer.emit(baseInput()).id).toBe(first.id);

    vi.setSystemTime(new Date('2026-04-11T00:00:00.800Z'));
    expect(layer.emit(baseInput()).id).not.toBe(first.id);
  });

  it('expires signals by step and ignores already-terminal signals', () => {
    const layer = createLayer();
    const expiring = layer.emit(
      baseInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        confidence: undefined,
        expiresAtStep: 1,
        summary: 'Short-lived context',
      }),
    );
    const resolved = layer.emit(
      baseInput({
        signalClass: 'confidence.medium',
        confidence: 0.5,
        summary: 'Will resolve before expiry',
        expiresAtStep: 1,
      }),
    );
    layer.resolve(resolved.id);

    layer.advanceStep('thread-1');

    expect(layer.get(expiring.id)?.state).toBe('expired');
    expect(layer.get(resolved.id)?.state).toBe('resolved');
    expect(() => layer.advanceStep('missing')).not.toThrow();
  });
});

describe('callbacks, audience, and routing hook behavior', () => {
  it('fires emitted, superseded, resolved, and expired events in the expected cases', () => {
    const events: Array<{ id: string; event: SignalEvent; state: SignalState }> = [];
    const layer = createLayer();
    const callback = vi.fn((signal, event) => {
      events.push({ id: signal.id, event, state: signal.state });
    });
    layer.onSignal(callback);

    const first = layer.emit(baseInput());
    const second = layer.emit(
      baseInput({
        signalClass: 'confidence.medium',
        confidence: 0.5,
        summary: 'Superseding update',
        replaces: first.id,
      }),
    );
    layer.resolve(second.id);
    layer.emit(
      baseInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        confidence: undefined,
        summary: 'Expiring note',
        expiresAtStep: 1,
      }),
    );
    layer.advanceStep('thread-1');
    layer.offSignal(callback);
    layer.emit(
      baseInput({
        summary: 'No callback after offSignal',
      }),
    );

    expect(callback).toHaveBeenCalled();
    expect(events.map((item) => item.event)).toContain('emitted');
    expect(events.map((item) => item.event)).toContain('superseded');
    expect(events.map((item) => item.event)).toContain('resolved');
    expect(events.map((item) => item.event)).toContain('expired');
  });

  it('continues firing callbacks when one callback throws', () => {
    const layer = createLayer();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = vi.fn(() => {
      throw new Error('boom');
    });
    const second = vi.fn();

    layer.onSignal(first);
    layer.onSignal(second);
    layer.emit(baseInput());

    expect(errorSpy).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('calls the selected audience resolver for narrowcast attention and exposes the first workflow', () => {
    const layer = createLayer();
    const resolver = vi.fn(() => ['specialist:writer']);
    const callback = vi.fn();
    layer.registerSelectedResolver(resolver);
    layer.onSignal(callback);

    const signal = layer.emit(
      baseInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        audience: 'selected',
        confidence: undefined,
        summary: 'Memory found a user-specific constraint',
      }),
    );

    expect(resolver).toHaveBeenCalledWith(signal);
    expect(callback).toHaveBeenCalledWith(signal, 'emitted');
    expect(layer.query({ threadId: 'thread-1', messageClass: 'attention' })).toHaveLength(1);
    expect(layer.resolve(signal.id).state).toBe('resolved');
  });

  it('supports reviewer conflict and specialist handoff workflows', () => {
    const layer = createLayer();

    const conflictA = layer.emit(
      baseInput({
        source: 'specialist:reviewer-a',
        messageClass: 'conflict',
        signalClass: 'conflict.active',
        priority: 'high',
        confidence: 0.8,
        summary: 'Reviewer A found a factual conflict',
      }),
    );
    const conflictB = layer.emit(
      baseInput({
        source: 'specialist:reviewer-b',
        messageClass: 'conflict',
        signalClass: 'conflict.active',
        priority: 'high',
        confidence: 0.7,
        summary: 'Reviewer B found a policy conflict',
      }),
    );
    const handoff = layer.emit(
      baseInput({
        source: 'specialist:planner',
        messageClass: 'handoff',
        signalClass: 'handoff.ready',
        audience: 'selected',
        confidence: undefined,
        summary: 'The plan is ready for execution review',
      }),
    );

    expect(
      layer.query({
        threadId: 'thread-1',
        messageClass: 'conflict',
      }).map((item) => item.id).sort(),
    ).toEqual([conflictA.id, conflictB.id].sort());
    expect(handoff.signalClass).toBe('handoff.ready');
    expect(layer.resolve(conflictA.id).state).toBe('resolved');
  });

  it('calls the routing escalation hook for escalation workflow signals and does not let hook failures block callbacks', () => {
    const callback = vi.fn();
    const hook = {

---CONNECTIVITY TSCONFIG---
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true
  },
  "include": [
    "src/**/*.ts"
  ],
  "exclude": [
    "src/**/*.test.ts"
  ]
}

---CONNECTIVITY README---
# `@relay-assistant/connectivity`

`@relay-assistant/connectivity` implements the v1 in-process signaling layer for internal assistant coordination. It provides a bounded signal vocabulary, validation, suppression, lifecycle management, audience resolution hooks, and an escalation hook that routing can implement without handing routing ownership to this package.

## Scope

This package owns:

- the canonical `ConnectivitySignal` envelope and supporting TypeScript types
- synchronous `emit()` with validation, ID assignment, timestamps, suppression, and supersession
- an in-memory per-thread signal log with `get()` and `query()`
- lifecycle transitions for `resolved`, `superseded`, and `expired`
- audience semantics for `self`, `coordinator`, `selected`, and `all`
- callback subscriptions through `onSignal()` and `offSignal()`
- escalation hook interfaces that routing may implement

This package does not own:

- routing decisions or mode application
- coordinator work assignment or synthesis policy
- transport, queues, or cross-process delivery
- cloud telemetry or persistence
- product-specific signal classes beyond the v1 catalog

## Install Shape

The package is TypeScript-first and builds to `dist/`.

```ts
import {
  createConnectivityLayer,
  type ConnectivitySignal,
  type EmitSignalInput,
} from '@relay-assistant/connectivity';
```

## Signal Model

v1 includes five message classes and eleven signal classes:

- `attention.raise`
- `confidence.high`
- `confidence.medium`
- `confidence.low`
- `confidence.blocker`
- `conflict.active`
- `conflict.resolved`
- `handoff.ready`
- `handoff.partial`
- `escalation.interrupt`
- `escalation.uncertainty`

`confidence` is numeric and bounded to `0.0..1.0` when present. It is required for all `confidence.*` and `conflict.*` signals, and class-specific ranges are enforced for the confidence signal classes:

- `confidence.high`: `0.8..1.0`
- `confidence.medium`: `0.4..0.79`
- `confidence.low`: `0.1..0.39`
- `confidence.blocker`: `0.0`

## Core API

### `createConnectivityLayer(config?)`

Creates a thread-aware in-memory layer.

```ts
const layer = createConnectivityLayer({
  suppressionConfig: { basis: 'step' },
  routingEscalationHook: {
    onEscalation(signal) {
      if (signal.signalClass === 'escalation.uncertainty') {
        return 'deep';
      }
    },
  },
});
```

### `emit(input)`

Creates a validated signal, assigns `id`, `emittedAt`, and initial `state`, then stores it in the thread log.

Key behaviors:

- validates required fields and class consistency
- suppresses duplicates within the configured suppression window
- bypasses suppression for `priority='critical'`
- bypasses suppression for high-priority escalation signals when the summary changes
- supersedes the target of `replaces` before storing the new signal
- invokes the routing escalation hook for `escalation.interrupt` and `escalation.uncertainty`
- fires `onSignal(signal, 'emitted')` synchronously

### `resolve(signalId)`

Moves a signal to `resolved`. It is idempotent for already-resolved signals and throws for `expired` or `superseded` signals.

### `get(signalId)` and `query(query)`

`get()` returns a single signal or `null`. `query()` reads a thread slice with filters for source, class, priority, state, and time boundaries. By default, `query()` returns only `emitted` and `active` signals.

### `advanceStep(threadId)`

Increments the thread step counter. Signals with `expiresAtStep <= currentStep` become `expired`, and `onSignal(signal, 'expired')` fires for each.

### `registerSelectedResolver(resolver)`

Registers the coordination-owned resolver used for `audience='selected'`. The resolver is invoked during emit. Connectivity computes the audience result but does not deliver or persist recipients.

### `onSignal(callback)` / `offSignal(callback)`

Registers or removes synchronous callbacks for:

- `emitted`
- `superseded`
- `resolved`
- `expired`

If one callback throws, the error is logged and later callbacks still run.

## Lifecycle and Convergence

Signals move through:

```text
emitted -> active -> superseded
                  -> expired
                  -> resolved
```

`active` is reached after at least one `onSignal` callback fires for a newly emitted signal. Convergence stays intentionally lightweight in v1: the package gives coordination the primitives it needs to converge a thread without taking coordination ownership itself.

Those primitives are:

- `replaces` for supersession when a newer signal obsoletes an older one
- `resolve()` for explicit closure after synthesis or arbitration
- `advanceStep()` plus `expiresAtStep` for stale transient signals
- `query()` for checking unresolved conflicts, escalations, and current confidence state

## Suppression

Duplicate detection uses the logical key:

```text
threadId + source + signalClass + audience
```

Duplicates are suppressed only when the existing signal is still non-terminal.

Supported suppression modes:

- `basis: 'step'`
  `advanceStep()` resets the suppression window
- `basis: 'time'`
  uses a sliding `windowMs`, defaulting to `5000`

## Routing Boundary

Connectivity exposes a routing hook interface only:

```ts
interface RoutingEscalationHook {
  onEscalation(signal: ConnectivitySignal): 'cheap' | 'fast' | 'deep' | void;
}
```

Connectivity does not store the returned mode, does not choose routing modes, and does not import a routing implementation. The hook exists so routing can react to escalation signals without blurring package ownership.

## Example

```ts
import { createConnectivityLayer } from '@relay-assistant/connectivity';

const layer = createConnectivityLayer();

layer.onSignal((signal, event) => {
  console.log(event, signal.signalClass, signal.summary);
});

const confidence = layer.emit({
  threadId: 'thread-42',
  source: 'specialist:reviewer',
  audience: 'coordinator',
  messageClass: 'confidence',
  signalClass: 'confidence.high',
  priority: 'normal',
  confidence: 0.92,
  summary: 'Review completed with stable evidence',
});

layer.emit({
  threadId: 'thread-42',
  source: 'specialist:reviewer',
  audience: 'selected',
  messageClass: 'handoff',
  signalClass: 'handoff.ready',
  priority: 'normal',
  summary: 'Downstream writer can synthesize the reviewed draft',
});

layer.resolve(confidence.id);
```

## Development

Run inside `packages/connectivity`:

```sh
npm install
npm test
npm run build
```

The test suite covers the intended first workflows:

- narrowcast attention
- reviewer conflict
- specialist handoff
- blocker uncertainty routing escalation

CONNECTIVITY_PACKAGE_IMPLEMENTED
