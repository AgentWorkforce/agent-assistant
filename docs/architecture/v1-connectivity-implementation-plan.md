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
if (signalClass === 'escalation.interrupt' || signalClass === 'escalation.uncertainty') {
  if (config.routingEscalationHook) {
    const requestedMode = config.routingEscalationHook.onEscalation(signal);
    // requestedMode is returned to routing; connectivity does not store or act on it
  }
}
```

The hook is called **after** the signal is stored and **before** `onSignal` callbacks fire. This ensures the signal exists in the log when the hook executes (routing may call `query()` inside `onEscalation` if needed, though this is not required).

**Tests (`routing.test.ts`):**
- Mock hook is called with the full `ConnectivitySignal` when `escalation.interrupt` is emitted
- Mock hook is called when `escalation.uncertainty` is emitted
- Mock hook is NOT called for non-escalation signals
- Hook returning `'deep'` does not change any connectivity state
- Hook returning `void` does not throw
- `onSignal` callback still fires when hook is registered
- `onSignal` callback still fires when no hook is registered
- Hook throwing does not prevent `onSignal` callbacks from firing (wrap in try/catch)

---

## 3. `layer.ts` — Assembly

`createConnectivityLayer` wires all components together:

```typescript
export function createConnectivityLayer(
  config?: ConnectivityLayerConfig,
): ConnectivityLayer {
  const log = new SignalLog();
  const lifecycle = new SignalLifecycle();
  const suppression = new SuppressionWindow(
    config?.suppressionConfig ?? { basis: 'step' },
  );
  const callbacks = new CallbackRegistry();
  const audience = new AudienceResolver();

  return {
    emit(input) {
      // 1. Validate input
      // 2. Suppression check — return existing signal if duplicate
      // 3. Supersession — if input.replaces set, transition target to 'superseded', fire callback
      // 4. Store signal
      // 5. If escalation signalClass, call routingEscalationHook (wrapped in try/catch)
      // 6. Fire onSignal(signal, 'emitted')
      // 7. Return stored signal
    },
    resolve(signalId) {
      const signal = lifecycle.resolve(log, signalId);
      callbacks.fire(signal, 'resolved');
      return signal;
    },
    get(signalId) { return log.get(signalId); },
    query(query) { return log.query(query); },
    advanceStep(threadId) {
      const expired = log.advanceStep(threadId);
      suppression.advanceStep();
      for (const s of expired) callbacks.fire(s, 'expired');
    },
    registerSelectedResolver(resolver) { audience.registerSelectedResolver(resolver); },
    onSignal(callback) { callbacks.register(callback); },
    offSignal(callback) { callbacks.unregister(callback); },
  };
}
```

---

## 4. Integration Test Specifications

### WF-C1: Narrowcast Attention (`wf-c1.test.ts`)

```
Setup:
  - layer = createConnectivityLayer()
  - resolver returns ['specialist-b']
  - layer.registerSelectedResolver(resolver)
  - collectedSignals = []
  - layer.onSignal((s, e) => { if (e === 'emitted') collectedSignals.push(s) })

Test: emit attention.raise to selected
  - layer.emit({ threadId: 't1', source: 'memory', audience: 'selected',
                 messageClass: 'attention', signalClass: 'attention.raise',
                 priority: 'normal', summary: 'New context found' })
  - assert: collectedSignals has 1 entry
  - assert: signal.source === 'memory'
  - assert: signal.signalClass === 'attention.raise'
  - assert: signal.state === 'emitted'

Test: resolver is called with the signal
  - assert: resolver called once with the emitted signal
```

### WF-C2: Reviewer Conflict (`wf-c2.test.ts`)

```
Setup:
  - layer = createConnectivityLayer()

Test: two conflicting signals from different sources
  - layer.emit({ ..., source: 'reviewer-a', signalClass: 'conflict.active',
                 confidence: 0.2, priority: 'high', audience: 'coordinator' })
  - layer.emit({ ..., source: 'reviewer-b', signalClass: 'conflict.active',
                 confidence: 0.3, priority: 'high', audience: 'coordinator' })
  - conflicts = layer.query({ threadId: 't1', messageClass: 'conflict', state: ['emitted', 'active'] })
  - assert: conflicts.length === 2

Test: resolve both conflicts after arbitration
  - layer.resolve(conflicts[0].id)
  - layer.resolve(conflicts[1].id)
  - remaining = layer.query({ threadId: 't1', messageClass: 'conflict', state: ['emitted', 'active'] })
  - assert: remaining.length === 0
```

### WF-C3: Specialist Handoff (`wf-c3.test.ts`)

```
Setup:
  - layer = createConnectivityLayer()
  - handoffReceived = false
  - layer.onSignal((s, e) => { if (s.signalClass === 'handoff.ready' && e === 'emitted') handoffReceived = true })

Test: emit handoff.ready and resolve after consumption
  - signal = layer.emit({ ..., source: 'specialist-a', signalClass: 'handoff.ready',
                          audience: 'selected', priority: 'normal', summary: 'Plan ready' })
  - assert: handoffReceived === true
  - layer.resolve(signal.id)
  - resolved = layer.get(signal.id)
  - assert: resolved.state === 'resolved'

Test: handoff.partial followed by handoff.ready supersedes the partial
  - partial = layer.emit({ ..., signalClass: 'handoff.partial', ... })
  - ready = layer.emit({ ..., signalClass: 'handoff.ready', replaces: partial.id, ... })
  - assert: layer.get(partial.id).state === 'superseded'
  - assert: ready.state === 'emitted'
```

### WF-C4: Blocker Uncertainty Routing (`wf-c4.test.ts`)

```
Setup:
  - hookCalled = false
  - capturedMode = null
  - hook = { onEscalation: (signal) => { hookCalled = true; return 'deep'; } }
  - layer = createConnectivityLayer({ routingEscalationHook: hook })
  - coordinationReceived = false
  - layer.onSignal((s, e) => { if (s.signalClass === 'escalation.uncertainty') coordinationReceived = true })

Test: escalation triggers hook and onSignal
  - layer.emit({ ..., source: 'specialist', signalClass: 'escalation.uncertainty',
                 audience: 'coordinator', priority: 'high',
                 summary: 'Cannot answer with current routing mode' })
  - assert: hookCalled === true
  - assert: coordinationReceived === true

Test: hook exception does not prevent onSignal from firing
  - badHook = { onEscalation: () => { throw new Error('hook error') } }
  - layer2 = createConnectivityLayer({ routingEscalationHook: badHook })
  - callbackFired = false
  - layer2.onSignal((s, e) => { callbackFired = true })
  - layer2.emit({ ..., signalClass: 'escalation.interrupt', priority: 'critical', ... })
  - assert: callbackFired === true
```

---

## 5. `package.json` Shape

```json
{
  "name": "@relay-assistant/connectivity",
  "version": "0.1.0",
  "description": "Internal coordination signaling layer for relay-assistant",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.0.0"
  },
  "peerDependencies": {}
}
```

No runtime dependency on any other `@relay-assistant/*` package. Type-only imports from `@relay-assistant/routing` for `RequestedRoutingMode` are acceptable; use `import type`.

---

## 6. `tsconfig.json` Shape

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/__tests__"]
}
```

---

## 7. Definition of Done

The v1 connectivity implementation is complete when:

1. All 8 implementation steps have corresponding passing unit tests
2. All 4 workflow integration tests (WF-C1 through WF-C4) pass
3. The public API surface matches §15 of the spec exactly (no extra exports, no missing exports)
4. TypeScript compilation is clean with `strict: true` and `exactOptionalPropertyTypes: true`
5. A specialist handler can emit a `confidence.high` signal, a coordinator can receive it via `onSignal`, and a `escalation.uncertainty` signal triggers a mock routing hook — all within a single in-process thread
6. No runtime dependencies on `@relay-assistant/sessions`, `@relay-assistant/surfaces`, `@relay-assistant/coordination`, or `@relay-assistant/memory`
7. `import type { RequestedRoutingMode }` from routing is the only cross-package import

---

V1_CONNECTIVITY_IMPLEMENTATION_PLAN_READY
