# v1 Continuation Implementation Plan

**Date:** 2026-04-13
**Package:** `@agent-assistant/continuation`
**Status:** IMPLEMENTATION_READY
**Spec:** continuation spec (provided in broker init)
**Boundary doc:** continuation boundary (provided in broker init)
**Review verdict:** ADD_CONTINUATION_PRIMITIVE
**Version target:** v0.1.0

---

## 1. Bounded v1 Scope

### What v1 Continuation Delivers

1. **ContinuationRuntime factory** — `createContinuationRuntime(config)` returns the core runtime with `create`, `resume`, `stop`, and `get` methods
2. **Continuation record lifecycle** — create from resumable harness outcomes, transition through `pending → resuming → completed/cancelled/expired/superseded/failed`
3. **Wait condition and resume trigger matching** — typed wait conditions (`user_reply`, `approval_resolution`, `external_result`, `scheduled_wake`) validated against typed resume triggers
4. **TTL and bounding enforcement** — expiry checking, max resume attempt tracking, automatic terminal transitions
5. **Resumed-turn re-entry** — assemble `ContinuationResumedTurnInput` and invoke the `ContinuationHarnessAdapter` for a new bounded turn
6. **Delivery state tracking** — track delivery intent and status (`pending_delivery`, `delivered`, `suppressed_*`, `delivery_failed`) without owning transport
7. **Adapter interfaces** — `ContinuationStore`, `ContinuationHarnessAdapter`, `ContinuationDeliveryAdapter`, `ContinuationSchedulerAdapter`
8. **InMemoryContinuationStore** — test/dev adapter for point reads and writes
9. **Error types** — `ContinuationError`, `ContinuationNotFoundError`, `ContinuationExpiredError`, `ContinuationAlreadyTerminalError`, `ContinuationTriggerMismatchError`
10. **40+ tests** — covering all four continuation cases, lifecycle transitions, bounding rules, and error paths

### What v1 Continuation Does NOT Deliver

- **No persistent store implementation.** Only `InMemoryContinuationStore` ships. Products provide durable storage.
- **No scheduler implementation.** `ContinuationSchedulerAdapter` is the interface only; no relaycron or timer integration.
- **No delivery transport.** `ContinuationDeliveryAdapter` is the interface; products implement delivery via surfaces.
- **No multi-branch continuation graphs.** One live continuation per origin turn. No forking or fan-out.
- **No automatic supersession detection.** Products call `stop()` with `superseded_by_newer_turn` explicitly.
- **No session-reengagement detection.** Products set `suppressIfSessionReengaged` and call `stop()` when reengagement is detected.
- **No harness or turn-context integration wiring.** This package defines the contract; product code connects the pieces.
- **No proactive bridging.** Scheduled wakes are modeled but not wired to any external scheduler.

---

## 2. File Manifest

All files under `packages/continuation/`.

### Package Infrastructure

| File | Purpose |
|---|---|
| `package.json` | Package manifest; depends on `@agent-assistant/harness` for `HarnessContinuation`, `HarnessResult`, `HarnessUserMessage` types |
| `tsconfig.json` | TypeScript config; ES2022, NodeNext, strict mode, declarations to `dist/` |
| `README.md` | Package purpose, API reference, usage examples |

### Runtime Source (`src/`)

| File | Approx. lines | Purpose |
|---|---|---|
| `src/types.ts` | ~250 | All exported interfaces, type unions, and error classes |
| `src/continuation.ts` | ~350 | `createContinuationRuntime` factory; create/resume/stop/get logic; lifecycle validation; trigger matching; bounding enforcement |
| `src/store.ts` | ~50 | `InMemoryContinuationStore` test adapter |
| `src/index.ts` | ~30 | Public API re-exports |

### Tests (`src/`)

| File | Approx. lines | Purpose |
|---|---|---|
| `src/continuation.test.ts` | ~600 | 40+ tests across all spec categories |

**Total: 7 files** (3 infrastructure + 4 runtime + 1 test — store doubles as runtime and test utility)

---

## 3. Minimum Public API Surface

### 3.1 Factory

```ts
export function createContinuationRuntime(
  config: ContinuationConfig,
): ContinuationRuntime;
```

### 3.2 `ContinuationRuntime` Interface

```ts
export interface ContinuationRuntime {
  create(input: CreateContinuationInput): Promise<ContinuationCreateResult>;
  resume(input: ResumeContinuationInput): Promise<ContinuationResumeResult>;
  stop(input: StopContinuationInput): Promise<ContinuationStopResult>;
  get(input: { continuationId: string }): Promise<ContinuationRecord | null>;
}
```

### 3.3 `ContinuationConfig`

```ts
export interface ContinuationConfig {
  store: ContinuationStore;
  harness: ContinuationHarnessAdapter;
  delivery?: ContinuationDeliveryAdapter;
  scheduler?: ContinuationSchedulerAdapter;
  clock?: ContinuationClock;
  trace?: ContinuationTraceSink;
  defaults?: ContinuationDefaults;
}
```

### 3.4 Result Types

```ts
export interface ContinuationCreateResult {
  continuation: ContinuationRecord;
  scheduledWakeId?: string; // if scheduler was invoked for deferred+scheduled_wake
}

export interface ContinuationResumeResult {
  continuation: ContinuationRecord;   // updated record after resume
  harnessResult: HarnessResult;       // result from the resumed bounded turn
  delivered: boolean;                  // whether delivery was attempted
}

export interface ContinuationStopResult {
  continuation: ContinuationRecord;   // record in terminal state
}
```

### 3.5 Exports Summary

From `src/index.ts`:

```ts
// Factory
export { createContinuationRuntime } from './continuation.js';

// Store adapter
export { InMemoryContinuationStore } from './store.js';

// Error classes
export {
  ContinuationError,
  ContinuationNotFoundError,
  ContinuationExpiredError,
  ContinuationAlreadyTerminalError,
  ContinuationTriggerMismatchError,
} from './types.js';

// All types
export type { /* all interfaces and type unions from types.ts */ } from './types.js';
```

---

## 4. Type Definitions (`src/types.ts`)

### 4.1 Continuation Record

```ts
export interface ContinuationRecord {
  id: string;
  assistantId: string;
  sessionId?: string;
  threadId?: string;
  userId?: string;

  origin: ContinuationOrigin;
  status: ContinuationStatus;
  waitFor: ContinuationWaitCondition;
  continuation: HarnessContinuation;
  delivery: ContinuationDeliveryState;
  bounds: ContinuationBounds;

  createdAt: string;
  updatedAt: string;
  lastResumedAt?: string;
  terminalReason?: ContinuationTerminalReason;
  metadata?: Record<string, unknown>;
}
```

### 4.2 Origin

```ts
export interface ContinuationOrigin {
  turnId: string;
  outcome: 'needs_clarification' | 'awaiting_approval' | 'deferred';
  stopReason: string;
  createdAt: string;
}
```

### 4.3 Status

```ts
export type ContinuationStatus =
  | 'pending'
  | 'resuming'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'superseded'
  | 'failed';
```

### 4.4 Wait Conditions

```ts
export type ContinuationWaitCondition =
  | { type: 'user_reply'; correlationKey?: string }
  | { type: 'approval_resolution'; approvalId: string }
  | { type: 'external_result'; operationId: string }
  | { type: 'scheduled_wake'; wakeUpId?: string };
```

### 4.5 Resume Triggers

```ts
export type ContinuationResumeTrigger =
  | { type: 'user_reply'; message: HarnessUserMessage; receivedAt: string }
  | { type: 'approval_resolution'; approvalId: string; decision: 'approved' | 'denied'; resolvedAt: string; metadata?: Record<string, unknown> }
  | { type: 'external_result'; operationId: string; resolvedAt: string; payload?: Record<string, unknown> }
  | { type: 'scheduled_wake'; wakeUpId?: string; firedAt: string };
```

### 4.6 Bounds

```ts
export interface ContinuationBounds {
  expiresAt: string;
  maxResumeAttempts: number;
  resumeAttempts: number;
}
```

### 4.7 Delivery State

```ts
export interface ContinuationDeliveryTarget {
  surfaceIds?: string[];
  fanoutMode?: 'originating_surface' | 'attached_surfaces' | 'product_defined';
  suppressIfSessionReengaged?: boolean;
}

export interface ContinuationDeliveryState {
  target?: ContinuationDeliveryTarget;
  status:
    | 'not_applicable'
    | 'pending_delivery'
    | 'delivered'
    | 'suppressed_session_reengaged'
    | 'suppressed_superseded'
    | 'suppressed_expired'
    | 'delivery_failed';
  lastDeliveryAttemptAt?: string;
  deliveredAt?: string;
}
```

### 4.8 Terminal Reasons

```ts
export type ContinuationTerminalReason =
  | 'completed'
  | 'cancelled_by_user'
  | 'cancelled_by_product'
  | 'expired_ttl'
  | 'superseded_by_newer_turn'
  | 'approval_denied'
  | 'invalid_resume_trigger'
  | 'max_resume_attempts_reached'
  | 'resume_runtime_error'
  | 'delivery_failed'
  | 'session_no_longer_deliverable';
```

### 4.9 Defaults

```ts
export interface ContinuationDefaults {
  clarificationTtlMs?: number;   // default: 3_600_000 (1 hour)
  approvalTtlMs?: number;        // default: 86_400_000 (24 hours)
  deferredTtlMs?: number;        // default: 3_600_000 (1 hour)
  scheduledWakeTtlMs?: number;   // default: 3_600_000 (1 hour)
  maxResumeAttempts?: number;    // default: 3
}
```

### 4.10 Error Classes

```ts
export class ContinuationError extends Error {
  constructor(message: string, public readonly continuationId?: string) {
    super(message);
    this.name = 'ContinuationError';
  }
}

export class ContinuationNotFoundError extends ContinuationError { ... }
export class ContinuationExpiredError extends ContinuationError { ... }
export class ContinuationAlreadyTerminalError extends ContinuationError { ... }
export class ContinuationTriggerMismatchError extends ContinuationError { ... }
```

---

## 5. Adapter Interfaces

### 5.1 `ContinuationStore`

```ts
export interface ContinuationStore {
  put(record: ContinuationRecord): Promise<void>;
  get(continuationId: string): Promise<ContinuationRecord | null>;
  delete?(continuationId: string): Promise<void>;
  listBySession?(sessionId: string): Promise<ContinuationRecord[]>;
}
```

V1 requires `put` and `get` only. `delete` and `listBySession` are optional.

### 5.2 `ContinuationHarnessAdapter`

```ts
export interface ContinuationHarnessAdapter {
  runResumedTurn(input: ContinuationResumedTurnInput): Promise<HarnessResult>;
}

export interface ContinuationResumedTurnInput {
  continuation: ContinuationRecord;
  trigger: ContinuationResumeTrigger;
  resumedTurnId: string;
}
```

This adapter exists so continuation does not need to know how product code assembles turn-context before calling harness. Products implement this adapter to wire turn-context assembly → harness invocation.

### 5.3 `ContinuationDeliveryAdapter`

```ts
export interface ContinuationDeliveryAdapter {
  deliver(input: ContinuationDeliveryInput): Promise<ContinuationDeliveryResult>;
}

export interface ContinuationDeliveryInput {
  continuation: ContinuationRecord;
  harnessResult: HarnessResult;
}

export interface ContinuationDeliveryResult {
  delivered: boolean;
  failureReason?: string;
}
```

### 5.4 `ContinuationSchedulerAdapter`

```ts
export interface ContinuationSchedulerAdapter {
  scheduleWake(input: {
    continuationId: string;
    wakeAtMs: number;
  }): Promise<{ wakeUpId: string }>;

  cancelWake?(wakeUpId: string): Promise<void>;
}
```

### 5.5 `ContinuationClock` and `ContinuationTraceSink`

```ts
export interface ContinuationClock {
  nowMs(): number;
  nowIso(): string;
}

export interface ContinuationTraceSink {
  emit(event: ContinuationTraceEvent): void;
}

export type ContinuationTraceEvent =
  | { type: 'continuation_created'; continuationId: string; outcome: string; waitFor: string; timestamp: string }
  | { type: 'continuation_resumed'; continuationId: string; triggerType: string; timestamp: string }
  | { type: 'continuation_stopped'; continuationId: string; reason: ContinuationTerminalReason; timestamp: string }
  | { type: 'continuation_delivery'; continuationId: string; deliveryStatus: string; timestamp: string };
```

---

## 6. Continuation Record Model and Resumed-Turn Re-Entry

### 6.1 Record Lifecycle State Machine

```
                          ┌─────────────┐
                          │   pending    │
                          └──────┬───────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
              ▼                  ▼                   ▼
     ┌────────────┐    ┌────────────────┐   ┌──────────────┐
     │  resuming   │    │    expired     │   │  cancelled   │
     └──────┬─────┘    └────────────────┘   └──────────────┘
            │                                       ▲
     ┌──────┼──────┐                                │
     │      │      │                       (cancelled_by_user,
     ▼      ▼      ▼                        cancelled_by_product,
  completed failed  pending (re-pend)       superseded_by_newer_turn)
```

**Transitions:**

| From | To | Trigger |
|---|---|---|
| `pending` | `resuming` | Valid resume trigger received, record not expired, attempts not exhausted |
| `pending` | `expired` | TTL exceeded (checked on resume attempt or explicit stop) |
| `pending` | `cancelled` | Explicit `stop()` call with cancellation reason |
| `pending` | `superseded` | Explicit `stop()` with `superseded_by_newer_turn` |
| `resuming` | `completed` | Harness returns terminal result (`completed`, `failed`, `refusal`) |
| `resuming` | `failed` | Harness throws, or delivery fails fatally |
| `resuming` | `pending` | Harness returns another resumable outcome (re-pend with updated wait condition) |

### 6.2 Creation Rules

`create()` must:

1. **Reject non-resumable outcomes.** Only `needs_clarification`, `awaiting_approval`, and `deferred` harness outcomes may produce a continuation. `completed`, `failed`, and `refusal` are terminal.
2. **Derive wait condition from outcome.** `needs_clarification` → `user_reply`, `awaiting_approval` → `approval_resolution`, `deferred` → `external_result` or `scheduled_wake` (product specifies).
3. **Compute bounds.** Apply TTL from `ContinuationDefaults` based on outcome type. Set `maxResumeAttempts` from defaults. Initialize `resumeAttempts` to 0.
4. **Initialize delivery state.** If no `ContinuationDeliveryAdapter` is configured, set delivery status to `not_applicable`. Otherwise set to `pending_delivery`.
5. **Persist via store.** Call `store.put()` with the complete record.
6. **Schedule wake if applicable.** If wait condition is `scheduled_wake` and a `ContinuationSchedulerAdapter` is configured, call `scheduleWake()`.
7. **Emit trace event.**

### 6.3 Resume Rules

`resume()` must:

1. **Load the record.** Throw `ContinuationNotFoundError` if missing.
2. **Check terminal state.** Throw `ContinuationAlreadyTerminalError` if status is not `pending`.
3. **Check expiry.** If `bounds.expiresAt` has passed, transition to `expired`, persist, throw `ContinuationExpiredError`.
4. **Check resume attempts.** If `bounds.resumeAttempts >= bounds.maxResumeAttempts`, transition to `failed` with reason `max_resume_attempts_reached`, persist, throw.
5. **Validate trigger type.** The trigger's `type` must match the record's `waitFor.type`. Throw `ContinuationTriggerMismatchError` on mismatch.
6. **Validate trigger correlation.** For `approval_resolution`, verify `approvalId` matches. For `external_result`, verify `operationId` matches.
7. **Transition to `resuming`.** Increment `resumeAttempts`, set `lastResumedAt`, persist.
8. **Generate a `resumedTurnId`.** Format: `${continuationId}:resume:${resumeAttempts}`.
9. **Invoke `harness.runResumedTurn()`.** Pass the continuation record, trigger, and resumed turn id.
10. **Handle harness result:**
    - If result is terminal (`completed`, `failed`, `refusal`): transition record to `completed` or `failed`, attempt delivery if adapter exists, persist.
    - If result is resumable: create a new pending state on the same record (update `waitFor`, reset bounds for the new wait, persist). This is a re-pend, not a new record.
    - If harness throws: transition to `failed` with reason `resume_runtime_error`, persist.
11. **Attempt delivery.** If `ContinuationDeliveryAdapter` is configured and the harness produced a deliverable result, call `deliver()`. Update delivery state accordingly.
12. **Emit trace events.**

### 6.4 Stop Rules

`stop()` must:

1. **Load the record.** Throw `ContinuationNotFoundError` if missing.
2. **Check terminal state.** If already terminal, return the record as-is (idempotent).
3. **Transition to the appropriate terminal status** based on the provided reason:
   - `cancelled_by_user`, `cancelled_by_product` → `cancelled`
   - `superseded_by_newer_turn` → `superseded`
   - `expired_ttl` → `expired`
   - `approval_denied` → `cancelled`
   - All others → `failed`
4. **Update delivery state.** Set delivery status to the appropriate suppression value (`suppressed_superseded`, `suppressed_expired`, etc.).
5. **Cancel scheduled wake.** If scheduler adapter supports `cancelWake` and a `wakeUpId` exists, cancel it.
6. **Persist and emit trace event.**

---

## 7. Implementation Details (`src/continuation.ts`)

### 7.1 Factory Shape

```ts
export function createContinuationRuntime(
  config: ContinuationConfig,
): ContinuationRuntime {
  const normalizedConfig = normalizeConfig(config);
  return {
    create: (input) => createContinuation(normalizedConfig, input),
    resume: (input) => resumeContinuation(normalizedConfig, input),
    stop: (input) => stopContinuation(normalizedConfig, input),
    get: (input) => normalizedConfig.store.get(input.continuationId),
  };
}
```

### 7.2 Config Normalization

```ts
function normalizeConfig(config: ContinuationConfig): NormalizedConfig {
  return {
    ...config,
    clock: config.clock ?? defaultClock(),
    defaults: {
      clarificationTtlMs: config.defaults?.clarificationTtlMs ?? 3_600_000,
      approvalTtlMs: config.defaults?.approvalTtlMs ?? 86_400_000,
      deferredTtlMs: config.defaults?.deferredTtlMs ?? 3_600_000,
      scheduledWakeTtlMs: config.defaults?.scheduledWakeTtlMs ?? 3_600_000,
      maxResumeAttempts: config.defaults?.maxResumeAttempts ?? 3,
    },
  };
}
```

### 7.3 ID Generation

Continuation IDs follow the pattern: `cont_${originTurnId}_${timestamp}`.
Resumed turn IDs follow: `${continuationId}:resume:${attemptNumber}`.

### 7.4 Outcome-to-Wait-Condition Mapping

```ts
function deriveWaitCondition(
  input: CreateContinuationInput,
): ContinuationWaitCondition {
  const outcome = classifyOutcome(input.harnessResult);
  switch (outcome) {
    case 'needs_clarification':
      return { type: 'user_reply' };
    case 'awaiting_approval':
      return { type: 'approval_resolution', approvalId: extractApprovalId(input) };
    case 'deferred':
      return input.metadata?.scheduledWake
        ? { type: 'scheduled_wake' }
        : { type: 'external_result', operationId: extractOperationId(input) };
  }
}
```

The `classifyOutcome` helper inspects the `HarnessResult` stop reason to determine which of the three resumable outcomes it represents. This mapping is explicit, not inferred from free-text.

---

## 8. InMemoryContinuationStore (`src/store.ts`)

```ts
export class InMemoryContinuationStore implements ContinuationStore {
  private records = new Map<string, ContinuationRecord>();

  async put(record: ContinuationRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }

  async get(continuationId: string): Promise<ContinuationRecord | null> {
    const record = this.records.get(continuationId);
    return record ? structuredClone(record) : null;
  }

  async delete(continuationId: string): Promise<void> {
    this.records.delete(continuationId);
  }

  async listBySession(sessionId: string): Promise<ContinuationRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.sessionId === sessionId)
      .map(structuredClone);
  }
}
```

Uses `structuredClone` to prevent mutation of stored records.

---

## 9. Test Plan (`src/continuation.test.ts`)

### 9.1 Creation Tests (8 tests)

| # | Test | Validates |
|---|---|---|
| 1 | Creates clarification continuation from `needs_clarification` result | Happy path; record is `pending` with `user_reply` wait condition |
| 2 | Creates approval continuation from `awaiting_approval` result | Happy path; `approval_resolution` wait condition with correct `approvalId` |
| 3 | Creates deferred continuation from `deferred` result | Happy path; `external_result` wait condition |
| 4 | Creates scheduled-wake continuation from `deferred` result with scheduler | Scheduler adapter invoked; `wakeUpId` returned |
| 5 | Rejects `completed` harness result | Throws `ContinuationError` |
| 6 | Rejects `failed` harness result | Throws `ContinuationError` |
| 7 | Applies correct TTL per outcome type | Clarification gets 1h, approval gets 24h |
| 8 | Emits `continuation_created` trace event | Trace sink receives event |

### 9.2 Resume Tests — Clarification (6 tests)

| # | Test | Validates |
|---|---|---|
| 9 | Resumes with matching `user_reply` trigger | Record transitions `pending → resuming → completed`; harness invoked |
| 10 | Rejects resume with wrong trigger type | Throws `ContinuationTriggerMismatchError` |
| 11 | Rejects resume on expired record | Transitions to `expired`; throws `ContinuationExpiredError` |
| 12 | Rejects resume on already-terminal record | Throws `ContinuationAlreadyTerminalError` |
| 13 | Rejects resume when max attempts exhausted | Transitions to `failed`; reason is `max_resume_attempts_reached` |
| 14 | Increments `resumeAttempts` on each attempt | Bounds correctly tracked |

### 9.3 Resume Tests — Approval (5 tests)

| # | Test | Validates |
|---|---|---|
| 15 | Resumes with `approved` decision | Harness invoked; record completed |
| 16 | Stops with `denied` decision | Record transitions to `cancelled`; reason `approval_denied` |
| 17 | Rejects mismatched `approvalId` | Throws `ContinuationTriggerMismatchError` |
| 18 | Handles approval after expiry | Expired wins over approval |
| 19 | Emits trace events for approval resume | Both `resumed` and `stopped` events emitted |

### 9.4 Resume Tests — External Result (4 tests)

| # | Test | Validates |
|---|---|---|
| 20 | Resumes with matching `external_result` trigger | Happy path |
| 21 | Rejects mismatched `operationId` | Throws trigger mismatch |
| 22 | Handles harness runtime error during resume | Record transitions to `failed`; reason `resume_runtime_error` |
| 23 | Re-pends when harness returns another resumable outcome | Record stays `pending` with updated wait condition |

### 9.5 Resume Tests — Scheduled Wake (3 tests)

| # | Test | Validates |
|---|---|---|
| 24 | Resumes on `scheduled_wake` trigger | Happy path |
| 25 | Rejects wake for non-scheduled continuation | Trigger mismatch |
| 26 | Ignores wake for already-expired continuation | Expiry wins |

### 9.6 Stop Tests (6 tests)

| # | Test | Validates |
|---|---|---|
| 27 | Stops with `cancelled_by_user` | Record terminal; delivery suppressed |
| 28 | Stops with `cancelled_by_product` | Record terminal |
| 29 | Stops with `superseded_by_newer_turn` | Status is `superseded` |
| 30 | Stops with `expired_ttl` | Status is `expired` |
| 31 | Stop is idempotent on already-terminal record | Returns record; no error |
| 32 | Cancels scheduled wake on stop | Scheduler `cancelWake` invoked |

### 9.7 Delivery Tests (5 tests)

| # | Test | Validates |
|---|---|---|
| 33 | Delivers follow-up after successful resume | Delivery adapter called; state is `delivered` |
| 34 | Marks `delivery_failed` when adapter rejects | Delivery state updated |
| 35 | Skips delivery when no adapter configured | Delivery status stays `not_applicable` |
| 36 | Sets `suppressed_expired` delivery state on expiry | Delivery not attempted |
| 37 | Sets `suppressed_superseded` delivery state on supersession | Delivery not attempted |

### 9.8 Bounding and Liveness Tests (4 tests)

| # | Test | Validates |
|---|---|---|
| 38 | Default TTL values applied correctly | Clock-based expiry calculation |
| 39 | Custom TTL overrides defaults | Per-input bounds respected |
| 40 | Max resume attempts enforced across multiple resumes | Third attempt fails after 2 allowed |
| 41 | Get returns null for nonexistent id | No error; returns null |

### 9.9 Edge Cases (3 tests)

| # | Test | Validates |
|---|---|---|
| 42 | Concurrent resume attempts — second attempt finds record already `resuming` | Throws `ContinuationAlreadyTerminalError` (or product handles) |
| 43 | Resume with `approval_denied` stops record without invoking harness | No harness call; terminal |
| 44 | Trace sink is optional — no error when omitted | Runtime works without trace |

**Total: 44 tests**

---

## 10. Package Dependencies

```json
{
  "name": "@agent-assistant/continuation",
  "version": "0.1.0",
  "dependencies": {
    "@agent-assistant/harness": "file:../harness"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

The only runtime dependency is `@agent-assistant/harness` for shared types (`HarnessContinuation`, `HarnessResult`, `HarnessUserMessage`). No other runtime packages are imported.

---

## 11. What Is Intentionally Deferred

### Deferred to v0.2 or Later

| Item | Reason |
|---|---|
| **Durable store implementations** (Redis, Postgres, DynamoDB) | Products own persistence; in-memory is sufficient for v1 proof |
| **Scheduler integration** (relaycron, setTimeout wrappers) | Interface is defined; implementation requires external infra |
| **Automatic expiry sweeping** | v1 checks expiry on access; background sweeping adds operational complexity |
| **Automatic supersession detection** | Requires session-level awareness of turn ordering; products call `stop()` explicitly |
| **Session-reengagement suppression logic** | Products detect reengagement and call `stop()` |
| **Multi-branch continuations** | One record per origin turn in v1; forking/fan-out deferred |
| **Continuation record migration/versioning** | Not needed until record shape changes |
| **Delivery retry with backoff** | v1 attempts delivery once; retry is product-owned |
| **Metrics/observability beyond trace events** | Trace sink is the v1 observability contract |
| **`listByAssistant` / `listByUser` store queries** | Only `get` and `put` are required; advanced queries deferred |
| **Integration with `@agent-assistant/surfaces` delivery adapters** | v1 defines the `ContinuationDeliveryAdapter` interface only |
| **Integration with `@agent-assistant/turn-context` for resumed assembly** | Products wire this through `ContinuationHarnessAdapter` |

### Explicitly Not Planned

| Item | Reason |
|---|---|
| General-purpose workflow engine | Out of scope permanently; this is one-turn-lineage resumption |
| Autonomous agent loops | Continuation resumes, not initiates |
| Recursive delegation chains | Each resume is one bounded turn |
| Hidden retry loops | Every resume is user-visible state |

---

## 12. Implementation Order

1. **`src/types.ts`** — all interfaces, type unions, error classes
2. **`src/store.ts`** — `InMemoryContinuationStore`
3. **`src/continuation.ts`** — `createContinuationRuntime` factory with create/resume/stop/get
4. **`src/index.ts`** — public exports
5. **`src/continuation.test.ts`** — 44 tests
6. **`package.json`** + **`tsconfig.json`** — package infrastructure
7. **`README.md`** — usage examples and API reference

---

V1_CONTINUATION_IMPLEMENTATION_PLAN_READY
