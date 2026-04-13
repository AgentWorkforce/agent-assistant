# v1 Continuation Spec — `@agent-assistant/continuation`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-13
**Package:** `@agent-assistant/continuation`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Adoption posture:** direct-import / wave-2 until implementation and one consumer proof exist

---

## 1. Responsibilities

`@agent-assistant/continuation` owns the bounded runtime lifecycle for a stopped-but-resumable assistant turn.

It exists to convert resumable harness outcomes into:
- explicit persisted continuation state
- validated resume triggers
- resumed bounded turns
- inspectable follow-up delivery state

**Owns:**
- continuation record creation and lifecycle
- typed wait conditions and resume triggers
- TTL / expiry / resume-attempt bounds
- resumed-turn re-entry contract
- follow-up delivery status contract
- continuation-specific stop reasons
- store and adapter interfaces needed for the above

**Does NOT own:**
- bounded turn execution itself (→ `@agent-assistant/harness`)
- turn-scoped identity/context assembly (→ `@agent-assistant/turn-context`)
- session identity/lifecycle (→ `@agent-assistant/sessions`)
- transport delivery implementations (→ `@agent-assistant/surfaces`)
- approval/risk decisions (→ `@agent-assistant/policy`)
- long-term memory persistence (→ `@agent-assistant/memory`)
- generic reminders/watch rules (→ `@agent-assistant/proactive`)
- product business heuristics

---

## 2. Non-goals

- not a background autonomous agent framework
- not a generic workflow engine
- not a scheduler abstraction for arbitrary jobs
- not a memory system
- not a policy engine
- not a multi-branch continuation graph system in v1
- not an invisible retry loop that keeps acting after returning

---

## 3. Canonical execution model

A continuation lifecycle begins only after a bounded turn returns a resumable harness result.

Canonical shape:

1. product runs one bounded turn through harness
2. harness returns one of:
   - `needs_clarification`
   - `awaiting_approval`
   - `deferred`
3. product/runtime creates a `ContinuationRecord`
4. runtime waits for one explicit resume trigger
5. continuation validates the trigger and record liveness
6. continuation creates a new bounded resumed turn invocation
7. harness runs again and returns a new `HarnessResult`
8. continuation either:
   - terminates the record, or
   - replaces/updates it with a fresh pending state if still resumable
9. user-visible follow-up is delivered or truthfully suppressed

---

## 4. Interfaces and contracts

### 4.1 `ContinuationRuntime`

```ts
export interface ContinuationRuntime {
  create(input: CreateContinuationInput): Promise<ContinuationCreateResult>;
  resume(input: ResumeContinuationInput): Promise<ContinuationResumeResult>;
  stop(input: StopContinuationInput): Promise<ContinuationStopResult>;
  get(input: { continuationId: string }): Promise<ContinuationRecord | null>;
}
```

### 4.2 `ContinuationConfig`

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

### 4.3 `ContinuationDefaults`

```ts
export interface ContinuationDefaults {
  clarificationTtlMs?: number;
  approvalTtlMs?: number;
  deferredTtlMs?: number;
  scheduledWakeTtlMs?: number;
  maxResumeAttempts?: number;
}
```

### 4.4 `CreateContinuationInput`

```ts
export interface CreateContinuationInput {
  assistantId: string;
  sessionId?: string;
  threadId?: string;
  userId?: string;

  originTurnId: string;
  harnessResult: HarnessResult;

  delivery?: ContinuationDeliveryTarget;
  bounds?: Partial<ContinuationBounds>;
  metadata?: Record<string, unknown>;
}
```

### 4.5 Creation rule

`create()` must reject non-resumable harness results.
Only these outcomes may produce a live continuation in v1:
- `needs_clarification`
- `awaiting_approval`
- `deferred`

`completed` and `failed` are terminal and must not create a live continuation.

### 4.6 `ResumeContinuationInput`

```ts
export interface ResumeContinuationInput {
  continuationId: string;
  trigger: ContinuationResumeTrigger;
  metadata?: Record<string, unknown>;
}
```

### 4.7 `StopContinuationInput`

```ts
export interface StopContinuationInput {
  continuationId: string;
  reason: ContinuationTerminalReason;
  metadata?: Record<string, unknown>;
}
```

---

## 5. Core types

### 5.1 `ContinuationRecord`

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

### 5.2 `ContinuationOrigin`

```ts
export interface ContinuationOrigin {
  turnId: string;
  outcome: 'needs_clarification' | 'awaiting_approval' | 'deferred';
  stopReason: string;
  createdAt: string;
}
```

### 5.3 `ContinuationStatus`

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

### 5.4 `ContinuationWaitCondition`

```ts
export type ContinuationWaitCondition =
  | { type: 'user_reply'; correlationKey?: string }
  | { type: 'approval_resolution'; approvalId: string }
  | { type: 'external_result'; operationId: string }
  | { type: 'scheduled_wake'; wakeUpId?: string };
```

### 5.5 `ContinuationBounds`

```ts
export interface ContinuationBounds {
  expiresAt: string;
  maxResumeAttempts: number;
  resumeAttempts: number;
}
```

### 5.6 `ContinuationTerminalReason`

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

### 5.7 `ContinuationResumeTrigger`

```ts
export type ContinuationResumeTrigger =
  | {
      type: 'user_reply';
      message: HarnessUserMessage;
      receivedAt: string;
    }
  | {
      type: 'approval_resolution';
      approvalId: string;
      decision: 'approved' | 'denied';
      resolvedAt: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'external_result';
      operationId: string;
      resolvedAt: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: 'scheduled_wake';
      wakeUpId?: string;
      firedAt: string;
    };
```

---

## 6. Delivery model types

### 6.1 `ContinuationDeliveryTarget`

```ts
export interface ContinuationDeliveryTarget {
  surfaceIds?: string[];
  fanoutMode?: 'originating_surface' | 'attached_surfaces' | 'product_defined';
  suppressIfSessionReengaged?: boolean;
}
```

### 6.2 `ContinuationDeliveryState`

```ts
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

---

## 7. Adapter interfaces

### 7.1 `ContinuationStore`

```ts
export interface ContinuationStore {
  put(record: ContinuationRecord): Promise<void>;
  get(continuationId: string): Promise<ContinuationRecord | null>;
  delete?(continuationId: string): Promise<void>;
  listBySession?(sessionId: string): Promise<ContinuationRecord[]>;
}
```

V1 only requires point reads/writes.
Advanced querying is optional.

### 7.2 `ContinuationHarnessAdapter`

```ts
export interface ContinuationHarnessAdapter {
  runResumedTurn(input: ContinuationResumedTurnInput): Promise<HarnessResult>;
}
```

### 7.3 `ContinuationResumedTurnInput`

```ts
export interface ContinuationResumedTurnInput {
  continuation: ContinuationRecord;
  trigger: ContinuationResumeTrigger;
  resumedTurnId: string;
}
```

This adapter exists so continuation does not need to know how product code assembles turn-context before calling harness.

### 7.4 `ContinuationDeliveryAdapter`

```ts
export interface ContinuationDeliveryAdapter {
  deliver(input: ContinuationDeliveryInput): Promise<ContinuationDeliveryResult>;
}
```

### 7.5 `ContinuationDeliveryInput`

```ts
export interface ContinuationDeliveryInput {
  continuation: ContinuationRecord;
  harnessResult: HarnessResult;
}
```

### 7.6 `ContinuationDeliveryResult`

```ts
export interface ContinuationDeliveryResult {
  status:
    | 'delivered'
    | 'suppressed_session_reengaged'
    | 'suppressed_superseded'
    | 'suppressed_expired'
    | 'delivery_failed';
  deliveredAt?: string;
  metadata?: Record<string, unknown>;
}
```

### 7.7 `ContinuationSchedulerAdapter`

```ts
export interface ContinuationSchedulerAdapter {
  requestWakeUp(at: Date, context: { continuationId: string }): Promise<string>;
  cancelWakeUp?(wakeUpId: string): Promise<void>;
}
```

This adapter is optional and only for the v1 `scheduled_wake` case tied to a live continuation.

---

## 8. Creation semantics

### 8.1 Outcome mapping rules

`create()` must map harness outcomes to wait conditions as follows.

#### `needs_clarification`
- status → `pending`
- waitFor → `{ type: 'user_reply' }`
- TTL default → `clarificationTtlMs`

#### `awaiting_approval`
- status → `pending`
- waitFor → `{ type: 'approval_resolution', approvalId }`
- TTL default → `approvalTtlMs`
- if no approval correlation id exists in the harness continuation payload, creation must fail as invalid input

#### `deferred`
- status → `pending`
- waitFor must be derivable from the continuation payload or product-supplied metadata
- valid v1 deferred wait conditions:
  - `external_result`
  - `scheduled_wake`
- TTL default → `deferredTtlMs` unless `scheduled_wake` then `scheduledWakeTtlMs`

### 8.2 Bounds initialization rules

When bounds are omitted:
- `resumeAttempts` starts at `0`
- `maxResumeAttempts` defaults from config
- `expiresAt` derives from outcome-specific TTL default

If the product supplies `bounds`, the package should validate:
- `expiresAt` is in the future
- `maxResumeAttempts >= 1`
- `resumeAttempts >= 0`

---

## 9. Resume semantics

### 9.1 Preflight validation

`resume()` must validate, in order:

1. record exists
2. record status is `pending`
3. current time is before `expiresAt`
4. trigger type matches `waitFor.type`
5. correlation identifiers match where applicable
6. `resumeAttempts < maxResumeAttempts`

If any check fails, the runtime must return a terminal or no-op result with a truthful reason.

### 9.2 Approval-denied rule

If the trigger is `approval_resolution` and `decision === 'denied'`:
- do not re-enter harness
- mark record terminal with `approval_denied`
- delivery may be product-defined; v1 may treat this as terminal-without-follow-up unless the delivery adapter chooses otherwise

### 9.3 Resume attempt accounting

Before calling harness:
- increment `resumeAttempts`
- update status to `resuming`
- persist the updated record

After harness returns:
- if result is terminal (`completed` or `failed`) → stop record accordingly
- if result is resumable again → replace/update record with fresh pending state and new origin turn id

### 9.4 New bounded turn rule

Every resume must create a new bounded turn id.
The original turn id remains in `origin.turnId` for lineage.

---

## 10. Follow-up delivery semantics

### 10.1 Delivery requirement

When a resumed turn yields a user-visible terminal result, the runtime should attempt delivery through `ContinuationDeliveryAdapter` if configured.

### 10.2 Delivery does not replace surfaces

The delivery adapter may internally call product/runtime emit methods backed by `@agent-assistant/surfaces`, but this package does not define transport delivery protocols itself.

### 10.3 Suppression support

The delivery adapter may truthfully suppress a follow-up when:
- session re-engagement made it stale
- continuation was superseded before delivery
- continuation expired before delivery

### 10.4 Delivery bookkeeping

The store must persist final delivery status on the record before completion is reported.

---

## 11. Result shapes

### 11.1 `ContinuationCreateResult`

```ts
export interface ContinuationCreateResult {
  record: ContinuationRecord;
}
```

### 11.2 `ContinuationResumeResult`

```ts
export interface ContinuationResumeResult {
  record: ContinuationRecord;
  harnessResult?: HarnessResult;
  delivery?: ContinuationDeliveryResult;
}
```

### 11.3 `ContinuationStopResult`

```ts
export interface ContinuationStopResult {
  record: ContinuationRecord;
}
```

---

## 12. Trace events

V1 should expose trace hooks for:
- continuation created
- continuation creation rejected
- continuation resume requested
- continuation resume rejected
- continuation expired
- continuation resumed turn started
- continuation resumed turn finished
- continuation delivery attempted
- continuation delivery finalized
- continuation terminated

Minimum trace fields:
- `continuationId`
- `assistantId`
- `sessionId?`
- `originTurnId`
- `resumedTurnId?`
- `status`
- `waitFor.type`
- `terminalReason?`
- timestamp

---

## 13. v1 package file expectation

```text
packages/continuation/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    types.ts
    continuation.ts
    continuation.test.ts
```

The first implementation should stay compact and adapter-driven.

---

## 14. Definition of done

A truthful v1 is ready only if all of the following are true.

### Contract and docs
- canonical boundary and spec exist
- README explains create/resume/stop semantics
- harness / proactive / sessions boundaries are explicit

### Implementation quality
- non-resumable harness results are rejected at create time
- resumable results create valid continuation records
- resume preflight validation is enforced
- expiry and max-attempt rules are enforced
- approval-denied path is terminal without false resume
- resumed work always re-enters harness as a new bounded turn
- delivery state is persisted truthfully

### Test quality
- clarification continuation path
- approval continuation path
- approval denied path
- external-result deferred path
- scheduled-wake deferred path
- invalid trigger rejection
- TTL expiry path
- max-resume-attempt path
- superseded path
- delivery suppressed path
- delivery failed path
- resumed result creates a fresh pending continuation path

### Product credibility
- at least one realistic consumer proof exists where:
  - harness produces a resumable outcome
  - continuation persists it
  - a later trigger resumes it
  - follow-up is delivered or truthfully suppressed

---

## 15. Final judgment

`@agent-assistant/continuation` is implementation-ready when kept inside this sentence:

> It is the bounded runtime that owns resumable turn state and follow-up delivery after a harness result stops honestly but not finally.

If implementation drifts into general workflow orchestration, scheduler ownership, or autonomy loops, the boundary has been violated.

V1_CONTINUATION_SPEC_READY
