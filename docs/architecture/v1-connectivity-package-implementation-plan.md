# v1 Connectivity Package Implementation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

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

### Step 8 — Layer Assembly and Routing Escalation Hook

**File:** `src/layer.ts`

The `createConnectivityLayer()` factory wires all components:

```typescript
export function createConnectivityLayer(config?: ConnectivityLayerConfig): ConnectivityLayer;
```

**`ConnectivityLayerConfig`:**

```typescript
export interface ConnectivityLayerConfig {
  suppressionConfig?: SuppressionConfig;
  routingEscalationHook?: RoutingEscalationHook;
}
```

**`emit()` orchestration order:**
1. Validate input via `validateEmitInput()`
2. If `input.replaces` is set, validate the target exists in the same thread
3. Check suppression — if duplicate, return existing signal (no callbacks, no hook)
4. If `input.replaces` is set, call `supersedeSignal()` and fire `'superseded'` callback
5. Create signal: assign `id`, `emittedAt`, `state='emitted'`
6. Store signal in log
7. If `signalClass` is `'escalation.interrupt'` or `'escalation.uncertainty'`, call `routingEscalationHook.onEscalation(signal)` wrapped in `try/catch`
8. Fire `onSignal(signal, 'emitted')` callback
9. Return stored signal

**Routing escalation hook contract:**
- `RoutingEscalationHook` is an interface with one method: `onEscalation(signal: ConnectivitySignal): RequestedRoutingMode | void`
- Connectivity calls it synchronously during `emit()`, after the signal is stored but before `onSignal` callbacks fire
- Connectivity does NOT store, act on, or forward the returned mode
- If the hook throws, the exception is caught and logged; `onSignal` callbacks still fire
- If no hook is configured, escalation signals are emitted normally — they still reach `onSignal` subscribers

This keeps routing interaction abstract. Connectivity defines the `RoutingEscalationHook` interface. Routing implements it. Connectivity never imports routing implementation code.

---

### Step 9 — Barrel Export

**File:** `src/index.ts`

```typescript
// Types
export type {
  ConnectivitySignal,
  EmitSignalInput,
  SignalQuery,
  ConnectivityLayer,
  ConnectivityLayerConfig,
  SuppressionConfig,
  RoutingEscalationHook,
  SelectedAudienceResolver,
  SignalCallback,
  SignalAudience,
  MessageClass,
  SignalClass,
  SignalPriority,
  SignalState,
  SignalEvent,
  RequestedRoutingMode,
} from './types';

// Errors
export {
  ConnectivityError,
  SignalValidationError,
  SignalNotFoundError,
} from './errors';

// Factory
export { createConnectivityLayer } from './layer';
```

No other internal classes or functions are exported. `SignalLog`, `SuppressionWindow`, `CallbackRegistry`, `AudienceResolver`, `validateEmitInput`, and `generateSignalId` are internal implementation details.

---

## 4. Package Boundaries

### What this package owns

| Concern | Implementation |
|---|---|
| Signal envelope (`ConnectivitySignal`) | `types.ts` — canonical type definition |
| Signal emission | `layer.ts` — `emit()` with validation, suppression, supersession |
| Signal lifecycle state machine | `lifecycle.ts` — resolve, supersede, expire transitions |
| In-memory signal log | `log.ts` — `Map<threadId, ConnectivitySignal[]>` |
| Suppression | `suppression.ts` — step-basis and time-basis duplicate detection |
| Audience resolution | `audience.ts` — translates semantic audience to recipient IDs |
| Callback system | `callbacks.ts` — `onSignal`/`offSignal` subscription |
| Routing escalation hook interface | `types.ts` — `RoutingEscalationHook` interface definition |

### What this package does NOT own

| Concern | Owner | Interaction |
|---|---|---|
| Routing mode selection | `@relay-assistant/routing` | Routing implements `RoutingEscalationHook`; connectivity calls it |
| Coordinator/specialist orchestration | `@relay-assistant/coordination` | Coordination calls `emit()`, `query()`, `resolve()`, `onSignal()` |
| Model invocations | Product code | Connectivity has no awareness of models |
| Session/surface management | `@relay-assistant/sessions`, `@relay-assistant/surfaces` | No interaction |
| Transport/delivery | None in v1 | Signals are in-process function calls |

### Dependency rules

| Import | Allowed | Notes |
|---|---|---|
| `connectivity → nanoid` | Yes | Runtime dependency for ID generation |
| `connectivity → @relay-assistant/routing` | `import type` only | `RequestedRoutingMode` type for hook return |
| `connectivity → @relay-assistant/core` | `import type` only | If needed for shared base types |
| `connectivity → sessions/surfaces/memory/coordination` | **No** | Hard boundary |
| `coordination → connectivity` | Yes | Primary consumer |
| `routing → connectivity` | Yes | Implements `RoutingEscalationHook` |
| Product specialist handlers → connectivity | Yes | Call `emit()` directly |

---

## 5. Minimum Tests

### Unit Tests (8 files)

**`types.test.ts`** — 3 tests minimum
- All 16 type exports are present (TypeScript compilation check)
- `EmitSignalInput` does not include `id`, `emittedAt`, or `state`
- `SignalClass` values are consistent with `MessageClass` groupings (each signal class prefix matches its message class)

**`log.test.ts`** — 8 tests minimum
- `emit` assigns `id` starting with `sig_` and ISO-8601 `emittedAt`
- `emit` sets initial `state='emitted'`
- `get` returns `null` for unknown ID
- `query` with `messageClass` filter returns only matching signals
- `query` with `state=['active']` excludes `emitted` signals
- `query` with `limit=2` returns at most 2 results
- `query` with `order='oldest'` returns chronological order
- `query` on unknown `threadId` returns empty array

**`lifecycle.test.ts`** — 7 tests minimum
- `resolve` transitions `emitted` → `resolved`
- `resolve` transitions `active` → `resolved`
- `resolve` is idempotent on already-resolved signal
- `resolve` throws `ConnectivityError` on superseded signal
- `resolve` throws `SignalNotFoundError` on unknown signal ID
- `supersede` via `emit(replaces=...)` transitions the target to `superseded`
- `supersede` of terminal signal throws `ConnectivityError`

**`suppression.test.ts`** — 8 tests minimum
- Second `emit()` with identical key returns first signal unchanged
- Suppressed `emit` does not add a new entry to the log
- Different `signalClass` is not suppressed
- Different `audience` is not suppressed
- `priority='critical'` bypasses suppression
- Resolved signal does not count as duplicate; new signal is created
- Step advance resets the step-basis window
- Time-basis: signal outside `windowMs` is not suppressed

**`step.test.ts`** — 5 tests minimum
- Signal without `expiresAtStep` does not expire
- Signal with `expiresAtStep=1` expires after one `advanceStep()` call
- Signal with `expiresAtStep=2` does not expire after one `advanceStep()` call
- Already-terminal signals are not affected by expiry scan
- `advanceStep()` on unknown thread is a no-op (does not throw)

**`callbacks.test.ts`** — 7 tests minimum
- `onSignal` callback fires with `event='emitted'` on emit
- `onSignal` callback fires with `event='resolved'` on resolve
- `onSignal` callback fires with `event='superseded'` when signal is replaced
- `onSignal` callback fires with `event='expired'` for each expired signal on `advanceStep()`
- `offSignal` removes callback; it does not fire after removal
- Multiple callbacks all fire; exception in one does not block subsequent callbacks
- Suppressed `emit` does NOT fire callbacks

**`audience.test.ts`** — 6 tests minimum
- `audience='self'` resolves to `[signal.source]`
- `audience='coordinator'` resolves to `['coordinator']`
- `audience='selected'` calls registered resolver with the signal
- `audience='selected'` with no resolver returns `[]`
- `audience='all'` returns all thread participants plus `'coordinator'`
- Registering a new resolver replaces the prior one

**`routing.test.ts`** — 8 tests minimum
- Mock hook is called with the full signal when `escalation.interrupt` is emitted
- Mock hook is called when `escalation.uncertainty` is emitted
- Mock hook is NOT called for non-escalation signals (e.g., `confidence.high`)
- Hook returning `'deep'` does not change any connectivity state
- Hook returning `void` does not throw
- `onSignal` callback fires when hook is registered
- `onSignal` callback fires when no hook is registered
- Hook throwing does not prevent `onSignal` callbacks from firing

### Integration Tests (4 files)

**`wf-c1.test.ts`** — Narrowcast Attention (2 tests)
- Emit `attention.raise` with `audience='selected'`; `onSignal` callback fires; resolver is called with the signal
- Signal is queryable and resolvable after emit

**`wf-c2.test.ts`** — Reviewer Conflict (2 tests)
- Two `conflict.active` signals from different sources are both stored; `query(messageClass='conflict')` returns both
- Resolving both conflicts clears them from active query results

**`wf-c3.test.ts`** — Specialist Handoff (2 tests)
- `handoff.ready` fires `onSignal` callback; signal is resolvable
- `handoff.partial` followed by `handoff.ready` with `replaces` supersedes the partial signal

**`wf-c4.test.ts`** — Blocker Uncertainty Routing (2 tests)
- `escalation.uncertainty` triggers routing escalation hook AND `onSignal` callback
- Hook exception does not prevent `onSignal` from firing

### Test Totals

| Category | Files | Min tests |
|---|---|---|
| Unit tests | 8 | 52 |
| Integration tests | 4 | 8 |
| **Total** | **12** | **60** |

---

## 6. `package.json`

```json
{
  "name": "@relay-assistant/connectivity",
  "version": "0.1.0",
  "description": "Internal coordination signaling layer for relay-assistant",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
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
  }
}
```

No runtime dependency on any `@relay-assistant/*` package. Type-only imports from `@relay-assistant/routing` for `RequestedRoutingMode` do not appear in `dependencies` or `peerDependencies`.

---

## 7. `tsconfig.json`

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

## 8. Implementation Order

Steps must be implemented in order. Each step's tests must pass before proceeding.

| Step | Files | Depends on | Deliverable |
|---|---|---|---|
| 1 | `types.ts`, `errors.ts` | — | All type exports, error classes |
| 2 | `id.ts`, `validate.ts` | Step 1 | ID generation, input validation |
| 3 | `log.ts` | Steps 1–2 | Signal storage, get, query |
| 4 | `lifecycle.ts` | Step 3 | resolve, supersede, expire transitions |
| 5 | `suppression.ts` | Steps 3–4 | Duplicate detection |
| 6 | `callbacks.ts` | Step 4 | onSignal/offSignal registry |
| 7 | `audience.ts` | Step 3 | Audience resolution |
| 8 | `layer.ts`, `index.ts` | Steps 1–7 | Factory, barrel export, escalation hook wiring |
| 9 | Integration tests | Step 8 | WF-C1 through WF-C4 |

---

## 9. Definition of Done

The v1 connectivity package implementation is complete when:

1. All 52+ unit tests pass across 8 test files
2. All 8 integration tests pass across 4 workflow test files (WF-C1 through WF-C4)
3. `tsc --noEmit` passes with `strict: true` and `exactOptionalPropertyTypes: true`
4. The public API surface is exactly: `createConnectivityLayer` (function), 16 type exports, 3 error classes — no extra exports
5. A specialist can emit a `confidence.high` signal, a coordinator receives it via `onSignal`, and an `escalation.uncertainty` signal triggers a mock routing hook — all in-process
6. No runtime dependencies on `@relay-assistant/sessions`, `@relay-assistant/surfaces`, `@relay-assistant/coordination`, or `@relay-assistant/memory`
7. `import type { RequestedRoutingMode }` from routing is the only cross-package type import
8. No `import type` from sessions, surfaces, memory, or coordination

---

V1_CONNECTIVITY_PACKAGE_IMPLEMENTATION_PLAN_READY
