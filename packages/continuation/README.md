# `@agent-assistant/continuation`

> The bounded runtime primitive that turns resumable harness outcomes into explicit state, validated resume triggers, and real follow-up delivery.

## Overview

A continuation begins when `@agent-assistant/harness` stops a turn honestly but not finally — the assistant asked a clarifying question, an action is waiting for approval, or work was deferred because an external process is still pending. The continuation package owns everything that happens after that stop:

- persisting the resumable turn state as a typed `ContinuationRecord`
- accepting an explicit resume trigger that matches what the continuation is waiting for
- validating liveness (not expired, not already terminal, within max attempt bounds)
- re-entering harness with a new bounded turn
- recording follow-up delivery state

**What it does not own:**
- bounded turn execution → `@agent-assistant/harness`
- session identity/lifecycle → `@agent-assistant/sessions`
- transport delivery → `@agent-assistant/surfaces`
- approval/risk decisions → `@agent-assistant/policy`
- long-term memory → `@agent-assistant/memory`
- generic scheduled nudges → `@agent-assistant/proactive`

---

## Installation

```sh
npm install @agent-assistant/continuation
```

---

## Quick start

```ts
import { createContinuationRuntime, InMemoryContinuationStore } from '@agent-assistant/continuation';

const runtime = createContinuationRuntime({
  store: new InMemoryContinuationStore(),
  harness: myHarnessAdapter,    // implements ContinuationHarnessAdapter
  delivery: myDeliveryAdapter,  // optional: implements ContinuationDeliveryAdapter
});

// 1. After harness returns needs_clarification:
const { continuation } = await runtime.create({
  assistantId: 'sage',
  sessionId: 'session-123',
  originTurnId: 'turn-abc',
  harnessResult,  // the HarnessResult with outcome: 'needs_clarification'
});
// continuation.status === 'pending'
// continuation.waitFor.type === 'user_reply'

// 2. When the user replies:
const result = await runtime.resume({
  continuationId: continuation.id,
  trigger: {
    type: 'user_reply',
    message: { id: 'msg-2', text: 'London', receivedAt: new Date().toISOString() },
    receivedAt: new Date().toISOString(),
  },
});
// result.continuation.status === 'completed'
// result.harnessResult — the result of the resumed bounded turn

// 3. Cancel when no longer needed:
await runtime.stop({
  continuationId: continuation.id,
  reason: 'cancelled_by_user',
});
```

---

## API Reference

### `createContinuationRuntime(config)`

Returns a `ContinuationRuntime` bound to the provided config.

```ts
interface ContinuationConfig {
  store: ContinuationStore;
  harness: ContinuationHarnessAdapter;
  delivery?: ContinuationDeliveryAdapter;
  scheduler?: ContinuationSchedulerAdapter;
  clock?: ContinuationClock;
  trace?: ContinuationTraceSink;
  defaults?: ContinuationDefaults;
}
```

### `ContinuationRuntime`

| Method | Description |
|---|---|
| `create(input)` | Create a continuation from a resumable harness result |
| `resume(input)` | Resume a pending continuation with an explicit trigger |
| `stop(input)` | Terminate a continuation with a truthful reason |
| `get({ continuationId })` | Retrieve a continuation record by id |

### `create(input)`

Accepts a resumable `HarnessResult` (`needs_clarification`, `awaiting_approval`, `deferred`) and returns a `ContinuationCreateResult` containing the new `ContinuationRecord`.

**Rejects non-resumable outcomes** (`completed`, `failed`) with `ContinuationInvalidInputError`.

The wait condition is derived from the outcome:

| Outcome | Wait condition |
|---|---|
| `needs_clarification` | `user_reply` |
| `awaiting_approval` | `approval_resolution` — requires `approvalId` in continuation state or metadata |
| `deferred` (default) | `external_result` — requires `operationId` in continuation state or metadata |
| `deferred` + `metadata.scheduledWake: true` | `scheduled_wake` |

### `resume(input)`

Accepts a `ContinuationResumeTrigger` and re-enters harness if all validation passes:

1. Record exists
2. Record status is `pending`
3. Current time is before `expiresAt`
4. Trigger type matches `waitFor.type`
5. Correlation identifiers match (approvalId, operationId)
6. `resumeAttempts < maxResumeAttempts`

**Approval denied:** if trigger is `approval_resolution` with `decision: 'denied'`, harness is not called and the record is marked `cancelled` with reason `approval_denied`.

**Re-pending:** if harness returns another resumable outcome, the record is re-pended with a new wait condition (not a new record).

### `stop(input)`

Terminal reasons map to statuses:

| Reason | Status |
|---|---|
| `completed` | `completed` |
| `cancelled_by_user`, `cancelled_by_product`, `approval_denied` | `cancelled` |
| `superseded_by_newer_turn` | `superseded` |
| `expired_ttl` | `expired` |
| All others | `failed` |

Stop is **idempotent**: calling stop on an already-terminal record returns it unchanged.

---

## Continuation lifecycle

```
                    ┌─────────────┐
                    │   pending    │
                    └──────┬───────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                  │
         ▼                 ▼                  ▼
  ┌────────────┐  ┌────────────────┐  ┌──────────────┐
  │  resuming   │  │    expired     │  │  cancelled/  │
  └──────┬─────┘  └────────────────┘  │  superseded  │
         │                            └──────────────┘
  ┌──────┼──────┐
  │      │      │
  ▼      ▼      ▼
completed failed pending (re-pend)
```

---

## Wait conditions and triggers

| Wait condition | Resume trigger |
|---|---|
| `user_reply` | `{ type: 'user_reply', message, receivedAt }` |
| `approval_resolution` | `{ type: 'approval_resolution', approvalId, decision, resolvedAt }` |
| `external_result` | `{ type: 'external_result', operationId, resolvedAt, payload? }` |
| `scheduled_wake` | `{ type: 'scheduled_wake', wakeUpId?, firedAt }` |

---

## TTL defaults

| Outcome | Default TTL |
|---|---|
| `needs_clarification` | 1 hour (3,600,000 ms) |
| `awaiting_approval` | 24 hours (86,400,000 ms) |
| `deferred` | 1 hour |
| `scheduled_wake` | 1 hour |

Override defaults via `config.defaults` or per-record via `create({ bounds })`.

---

## Adapters

### `ContinuationHarnessAdapter`

```ts
interface ContinuationHarnessAdapter {
  runResumedTurn(input: ContinuationResumedTurnInput): Promise<HarnessResult>;
}
```

Products implement this to wire turn-context assembly before calling harness.

### `ContinuationDeliveryAdapter`

```ts
interface ContinuationDeliveryAdapter {
  deliver(input: ContinuationDeliveryInput): Promise<ContinuationDeliveryResult>;
}
```

Optional. When present, called after a resumed turn produces a user-visible terminal result.

### `ContinuationSchedulerAdapter`

```ts
interface ContinuationSchedulerAdapter {
  scheduleWake(input: { continuationId: string; wakeAtMs: number }): Promise<{ wakeUpId: string }>;
  cancelWake?(wakeUpId: string): Promise<void>;
}
```

Optional. Required only for `scheduled_wake` continuations.

### `ContinuationStore`

```ts
interface ContinuationStore {
  put(record: ContinuationRecord): Promise<void>;
  get(continuationId: string): Promise<ContinuationRecord | null>;
  delete?(continuationId: string): Promise<void>;
  listBySession?(sessionId: string): Promise<ContinuationRecord[]>;
}
```

Only `put` and `get` are required. Use `InMemoryContinuationStore` for tests and development.

---

## Delivery state

| Status | Meaning |
|---|---|
| `not_applicable` | No delivery adapter configured |
| `pending_delivery` | Delivery adapter present; delivery not yet attempted |
| `delivered` | Follow-up successfully delivered |
| `suppressed_session_reengaged` | User re-engaged; follow-up suppressed |
| `suppressed_superseded` | Continuation superseded before delivery |
| `suppressed_expired` | Continuation expired before delivery |
| `delivery_failed` | Delivery adapter returned failure |

---

## Error types

| Error | Thrown when |
|---|---|
| `ContinuationNotFoundError` | Record id not in store |
| `ContinuationExpiredError` | Record TTL has passed |
| `ContinuationAlreadyTerminalError` | Resume called on non-pending record |
| `ContinuationTriggerMismatchError` | Trigger type or correlation id mismatch |
| `ContinuationInvalidInputError` | Invalid creation input (bad outcome, missing required fields) |

---

## Boundaries

- **Harness emits resumable outcomes. Continuation operationalizes them.** Harness is not affected by this package.
- **Proactive vs continuation:** if there is no originating stopped turn id, it is proactive. If the assistant is resuming a known unfinished turn lineage, it is continuation.
- **Continuation is not a scheduler.** Scheduled wake is a trigger *type*, not a scheduler implementation.
- **Continuation is not a memory system.** It stores short-lived operational state for one unfinished turn lineage only.
- **v1 scope:** one live record per origin turn. Multi-branch continuation graphs are explicitly out of scope.
