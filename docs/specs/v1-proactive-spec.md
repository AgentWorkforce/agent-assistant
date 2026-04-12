# v1 Proactive Spec — `@relay-assistant/proactive`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-12
**Package:** `@relay-assistant/proactive`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.3 (after core, sessions, surfaces, memory, connectivity, routing, coordination land)
**Scope reference:** `docs/architecture/v1-proactive-scope.md`

---

## 1. Responsibilities

`@relay-assistant/proactive` provides the **decision layer** for proactive assistant behavior. Proactive behavior is any assistant action that originates without a direct user message in the current turn.

**Owns:**
- `ProactiveEngine` — the central evaluator for follow-up rules and watch rules
- `FollowUpRule` — product-supplied rule definition with condition, suppression policy, and routing hint
- `WatchRule` — long-running monitoring rule with interval, condition, and action
- `ReminderPolicy` — configurable policy controlling reminder cadence, cooldown, and suppression
- `FollowUpDecision` — output of follow-up evaluation; tells the caller what to do (`fire | suppress | defer`)
- `WatchTrigger` — output of watch rule evaluation; tells the caller a condition was met
- `SchedulerBinding` — interface contract between the engine and external scheduling infrastructure (relaycron)
- `InMemorySchedulerBinding` — test adapter for the scheduler binding interface
- `FollowUpEvidenceSource` — optional interface for injecting evidence (memory entries, session metadata) into evaluation
- Reminder state tracking — in-memory per-session, per-rule reminder counts and last-sent timestamps
- Suppression logic — compares `scheduledAt` vs. `lastActivityAt` to gate follow-up firing
- Watch rule lifecycle — `pause`, `cancel`, `list`, re-scheduling after evaluation
- Error types — `ProactiveError`, `RuleNotFoundError`, `SchedulerBindingError`

**Does NOT own:**
- Domain-specific rule definitions (→ product repos)
- Product-specific timing thresholds (→ product configuration)
- Scheduling infrastructure — timers, cron registration, dispatch (→ Relay foundation / relaycron)
- Memory persistence and retrieval (→ `@relay-assistant/memory`, accessed through `FollowUpEvidenceSource`)
- Session lifecycle (→ `@relay-assistant/sessions`; engine reads session values from evaluation context)
- Outbound message delivery (→ `@relay-assistant/surfaces` + Relay runtime)
- Cross-agent coordination of proactive actions (→ `@relay-assistant/coordination`, v1.2)
- Proactive action risk classification or approval gates (→ `@relay-assistant/policy`, v2)

---

## 2. Non-Goals

- This package does not register a capability handler on the runtime. Products write their own `proactive` capability handler and call engine methods inside it.
- This package does not implement a scheduler. The `SchedulerBinding` interface is the extent of its scheduler involvement.
- This package does not own persistent rule storage. v1 is in-memory only.
- This package does not emit connectivity signals. That is a product-layer concern in v1.
- This package does not inspect message text or apply NLP. All conditions are function-based, returning `boolean | Promise<boolean>`.
- This package does not rate-limit proactive actions across the assistant fleet. That belongs in `@relay-assistant/policy`.

---

## 3. Scheduler Binding Contract

The proactive engine communicates with external scheduling infrastructure (relaycron) through a `SchedulerBinding` interface. This keeps the engine testable without a live scheduler.

### 3.1 Interface

```ts
interface SchedulerBinding {
  /** Request a wake-up at the given time. Returns a bindingId the engine uses to cancel. */
  requestWakeUp(at: Date, context: WakeUpContext): Promise<string>;

  /** Cancel a previously requested wake-up by its bindingId. No-op if already fired or not found. */
  cancelWakeUp(bindingId: string): Promise<void>;
}

interface WakeUpContext {
  sessionId: string;
  ruleId?: string;
  scheduledAt: string; // ISO-8601; stored so the engine can detect if user became active since
  metadata?: Record<string, unknown>;
}
```

### 3.2 InMemorySchedulerBinding

The package ships `InMemorySchedulerBinding` for tests and local development. It:
- Records all `requestWakeUp` calls in an accessible `pendingWakeUps` map
- Supports manual trigger via `trigger(bindingId): Promise<void>`
- No-ops on `cancelWakeUp` for unknown IDs

Products wire a real relaycron binding (not in this package) that implements this interface for production use.

### 3.3 Wake-Up Dispatch Path

At wake-up time, relaycron dispatches a synthetic `InboundMessage` to the assistant runtime. The proactive package does not receive a callback. The product's `proactive` capability handler is invoked by the runtime, reads the `WakeUpContext` from the message payload, and calls engine methods directly.

This means the engine has no async lifecycle of its own — it is purely a decision library called by the handler.

---

## 4. Follow-Up Rules

### 4.1 FollowUpRule

```ts
interface FollowUpRule {
  id: string;

  /**
   * Condition function. Receives the evaluation context and optional evidence.
   * Returns true if the assistant should consider following up.
   */
  condition(
    context: FollowUpEvaluationContext,
    evidence: EvidenceEntry[]
  ): boolean | Promise<boolean>;

  /** Human-readable description for logging. */
  description?: string;

  /** ReminderPolicy governs suppression. If omitted, defaults are used. */
  policy?: ReminderPolicy;

  /** Routing hint passed through to the caller's routing logic. Defaults to 'cheap'. */
  routingHint?: 'cheap' | 'fast' | 'deep';

  /** Free-form message template. The caller is responsible for final rendering. */
  messageTemplate?: string;
}
```

### 4.2 FollowUpEvaluationContext

The engine receives all session signal values as plain data. It does not import or call any session package directly.

```ts
interface FollowUpEvaluationContext {
  sessionId: string;

  /** ISO-8601 — when the wake-up was originally scheduled. Used for suppression comparison. */
  scheduledAt: string;

  /** ISO-8601 — the session's last user activity timestamp. */
  lastActivityAt: string;

  /** Optional pre-fetched evidence entries from the evidence source. */
  evidence?: EvidenceEntry[];
}
```

### 4.3 FollowUpDecision

```ts
interface FollowUpDecision {
  ruleId: string;
  sessionId: string;

  /** What the engine recommends the caller do. */
  action: 'fire' | 'suppress' | 'defer';

  /**
   * suppressionReason is present when action === 'suppress'.
   * - 'user_active': user became active after the wake-up was scheduled
   * - 'cooldown': too soon after the previous reminder
   * - 'max_reminders': rule's maxReminders count has been reached
   */
  suppressionReason?: 'user_active' | 'cooldown' | 'max_reminders';

  /** Routing hint from the rule. Callers should use this to select a model tier. */
  routingHint: 'cheap' | 'fast' | 'deep';

  /** Message template from the rule, if provided. Caller renders the final message. */
  messageTemplate?: string;
}
```

### 4.4 Suppression Logic

The engine applies suppression checks in order. The first matching condition wins:

1. **user_active:** `lastActivityAt > scheduledAt` — user became active after the wake-up was scheduled. Always suppress.
2. **max_reminders:** reminder count for this `(sessionId, ruleId)` pair has reached `policy.maxReminders`. Suppress.
3. **cooldown:** `now - lastReminderSentAt < policy.cooldownMs`. Suppress.
4. **condition false:** the rule's condition function returns false. Suppress (no suppressionReason set; action is `suppress`).
5. **no suppression:** action is `fire`. Engine increments reminder count and records `lastReminderSentAt`.

When action is `defer`, no suppression condition matched but the engine has queued a later evaluation (not in v1 — `defer` is reserved for v1.1 deferred retry logic; v1 always returns `fire` or `suppress`).

---

## 5. Reminder Policy

```ts
interface ReminderPolicy {
  /** Maximum number of reminders to send per (sessionId, ruleId). Default: 3. */
  maxReminders?: number;

  /**
   * Minimum milliseconds between reminders for the same (sessionId, ruleId).
   * Default: 3_600_000 (1 hour).
   */
  cooldownMs?: number;

  /**
   * If true, suppress the reminder when the user is currently active (lastActivityAt is recent).
   * "Recent" is defined as within the last 5 minutes relative to scheduledAt.
   * Default: true.
   */
  suppressWhenActive?: boolean;
}

const DEFAULT_REMINDER_POLICY: Required<ReminderPolicy> = {
  maxReminders: 3,
  cooldownMs: 3_600_000,
  suppressWhenActive: true,
};
```

Reminder state is stored in-memory in the engine instance. It is keyed by `${sessionId}:${ruleId}` and tracks:
- `reminderCount: number`
- `lastReminderSentAt: string | null` (ISO-8601)

Reminder state resets when:
- The rule is cancelled via `engine.cancelFollowUpRule(ruleId)`
- The session key is explicitly cleared via `engine.resetReminderState(sessionId, ruleId)`

There is no automatic reset on session closure in v1. Products manage this via the capability handler.

---

## 6. Watch Rules

### 6.1 WatchRule

```ts
interface WatchRule {
  id: string;

  /**
   * Condition function evaluated on each scheduled check.
   * Returns true if the watch rule should trigger an action.
   */
  condition(context: WatchEvaluationContext): boolean | Promise<boolean>;

  /**
   * Action descriptor. The engine does not execute actions — it returns WatchTrigger
   * objects that the caller handles.
   */
  action: WatchAction;

  /**
   * Interval in milliseconds between condition checks.
   * The engine requests a new wake-up after every evaluation regardless of trigger result.
   */
  intervalMs: number;

  /** Optional description for logging and observability. */
  description?: string;
}

interface WatchEvaluationContext {
  ruleId: string;

  /** ISO-8601 — when this evaluation was scheduled. */
  scheduledAt: string;

  /** Product-supplied metadata from the original WakeUpContext. */
  metadata?: Record<string, unknown>;
}

interface WatchAction {
  /** Short descriptor used by the caller to identify what to do. */
  type: string;

  /** Optional payload passed through to the caller unchanged. */
  payload?: Record<string, unknown>;
}
```

### 6.2 WatchTrigger

```ts
interface WatchTrigger {
  ruleId: string;
  triggeredAt: string; // ISO-8601 — when the condition returned true
  action: WatchAction;
  context: WatchEvaluationContext;
}
```

### 6.3 Watch Rule Lifecycle

```ts
interface ProactiveEngine {
  // --- Follow-up rules ---
  registerFollowUpRule(rule: FollowUpRule): void;
  removeFollowUpRule(ruleId: string): void; // throws RuleNotFoundError if not found
  listFollowUpRules(): FollowUpRule[];
  evaluateFollowUp(context: FollowUpEvaluationContext): Promise<FollowUpDecision[]>;
  resetReminderState(sessionId: string, ruleId?: string): void;

  // --- Watch rules ---
  registerWatchRule(rule: WatchRule): void;
  pauseWatchRule(ruleId: string): void;   // throws RuleNotFoundError if not found
  resumeWatchRule(ruleId: string): void;  // throws RuleNotFoundError if not found
  cancelWatchRule(ruleId: string): void;  // throws RuleNotFoundError if not found
  listWatchRules(): WatchRuleStatus[];
  evaluateWatchRules(context: WatchEvaluationContext): Promise<WatchTrigger[]>;
}

interface WatchRuleStatus {
  rule: WatchRule;
  status: 'active' | 'paused' | 'cancelled';
  lastEvaluatedAt: string | null; // ISO-8601
  nextWakeUpBindingId: string | null;
}
```

### 6.4 Re-scheduling Behavior

After every `evaluateWatchRules()` call, the engine requests a new wake-up for each active (non-paused, non-cancelled) rule:

```
nextWakeUpAt = new Date(Date.now() + rule.intervalMs)
bindingId = await schedulerBinding.requestWakeUp(nextWakeUpAt, {
  sessionId: context.metadata?.sessionId ?? '_watch',
  ruleId: rule.id,
  scheduledAt: nextWakeUpAt.toISOString(),
  metadata: context.metadata,
})
```

The previous `bindingId` is cancelled before requesting the new one to avoid duplicate wake-ups.

Paused rules do not re-schedule. Cancelled rules do not re-schedule and cannot be re-activated; products must re-register.

---

## 7. Stale-Thread Detection

Stale-thread detection is a follow-up evaluation pattern, not a separate engine concept. A product implements it by registering a follow-up rule whose condition checks whether the session has been inactive for a threshold duration.

**Reference implementation pattern:**

```ts
engine.registerFollowUpRule({
  id: 'stale-thread',
  description: 'Follow up on sessions silent for more than 24 hours',
  condition: (ctx) => {
    const inactiveMs = new Date(ctx.scheduledAt).getTime()
      - new Date(ctx.lastActivityAt).getTime();
    return inactiveMs > 24 * 60 * 60 * 1000;
  },
  policy: {
    maxReminders: 2,
    cooldownMs: 24 * 60 * 60 * 1000, // 24h between reminders
    suppressWhenActive: true,
  },
  routingHint: 'cheap',
  messageTemplate: 'Checking in — any updates on this thread?',
});
```

The engine handles suppression (cooldown, max count, user-active check). The caller handles scheduling the initial wake-up and dispatching the outbound message after receiving a `fire` decision.

---

## 8. Evidence Source Integration

The `FollowUpEvidenceSource` interface is optional. Products wire it to provide evidence to follow-up rule conditions. The engine does not call evidence sources automatically in v1 — evidence must be pre-fetched and passed in the evaluation context, or the engine calls the source during evaluation if one is configured.

```ts
interface FollowUpEvidenceSource {
  getRecentEntries(
    sessionId: string,
    options?: { limit?: number; tags?: string[] }
  ): Promise<EvidenceEntry[]>;
}

interface EvidenceEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string; // ISO-8601
  metadata?: Record<string, unknown>;
}
```

**Engine behavior with a configured evidence source:**

When `evaluateFollowUp()` is called and an `evidenceSource` is configured, the engine fetches evidence for the `sessionId` before calling each rule's condition function. Evidence is passed as the second argument to the condition.

**Engine behavior without an evidence source:**

Evidence is an empty array `[]` passed to all condition functions.

Products can pre-fetch evidence themselves and pass it in `context.evidence` to avoid the engine fetching it per-rule.

---

## 9. Factory and Configuration

```ts
interface ProactiveEngineConfig {
  /** Optional evidence source wired to a memory store or other evidence backend. */
  evidenceSource?: FollowUpEvidenceSource;

  /** Required scheduler binding. Wire InMemorySchedulerBinding for tests. */
  schedulerBinding: SchedulerBinding;

  /** Default reminder policy applied when a rule does not specify its own policy. */
  defaultReminderPolicy?: ReminderPolicy;
}

function createProactiveEngine(config: ProactiveEngineConfig): ProactiveEngine;
```

**No runtime dependency on any other `@relay-assistant/*` package.** All integration is through the interfaces above, wired by product code.

---

## 10. Error Types

```ts
class ProactiveError extends Error {
  readonly code: string;
}

class RuleNotFoundError extends ProactiveError {
  readonly ruleId: string;
  readonly ruleType: 'followUp' | 'watch';
  readonly code = 'RULE_NOT_FOUND';
}

class SchedulerBindingError extends ProactiveError {
  readonly bindingId?: string;
  readonly code = 'SCHEDULER_BINDING_ERROR';
  readonly cause: unknown;
}
```

---

## 11. Package Structure

```
packages/proactive/
  package.json          — nanoid runtime dep only
  tsconfig.json         — ES2022, NodeNext, strict
  src/
    types.ts            — all exported types, interfaces, error classes (~150 lines)
    proactive.ts        — createProactiveEngine factory, evaluation logic, reminder state (~400 lines)
    index.ts            — public re-exports (~25 lines)
    proactive.test.ts   — 41 tests (~500 lines)
  README.md
```

### Dependencies

| Dependency | Type | Reason |
|---|---|---|
| `nanoid` | Runtime | Rule ID and binding ID generation |
| `vitest` | Dev | Testing |
| `typescript` | Dev | Build |

**Zero runtime dependency on any `@relay-assistant/*` package.**

---

## 12. Test Coverage (minimum 41 tests)

| Category | Count | Coverage |
|---|---|---|
| Type structural tests | 4 | Required types, interfaces, and error classes exist and are exported |
| Follow-up rule registration | 5 | Register, list, remove, duplicate-id rejection, validation (missing id) |
| Follow-up evaluation — basic | 4 | Single rule fires, single rule suppresses on condition false, multiple rules evaluated, empty rule list |
| Follow-up evaluation — suppression | 5 | user_active suppression, cooldown suppression, max_reminders suppression, suppress-when-active=false override, suppression reason field |
| Follow-up evaluation — evidence | 3 | Evidence source called, evidence passed to condition, pre-fetched evidence in context used without re-fetching |
| Follow-up evaluation — routing | 2 | routingHint passed through, default routingHint is 'cheap' |
| Reminder state | 4 | Count incremented on fire, reset via resetReminderState(sessionId, ruleId), reset all for session, state not shared across sessions |
| Watch rule lifecycle | 6 | Register, pause (skips evaluation), resume, cancel (skips evaluation + no re-schedule), list statuses, re-register after cancel |
| Watch rule evaluation | 5 | Condition true → WatchTrigger returned, condition false → no trigger, re-scheduling after evaluation, paused rule not evaluated, multiple rules mixed trigger |
| Scheduler binding | 4 | requestWakeUp called on watch re-schedule, cancelWakeUp called before re-schedule, InMemorySchedulerBinding records pending, InMemorySchedulerBinding manual trigger |
| Error handling | 3 | RuleNotFoundError on remove unknown, RuleNotFoundError on pause unknown, SchedulerBindingError wraps binding failure |
| **Total** | **45** | |

---

## 13. Deferred (v1.1+)

| Capability | Target | Reason |
|---|---|---|
| Real relaycron binding implementation | v1.1 | Requires relaycron API to be stable |
| Persistent rule storage adapter | v1.1 | v1 is in-memory only |
| Session archival trigger | v1.1 | Depends on memory promotion workflow being stable |
| Automatic memory-to-evidence pipeline | v1.1 | Requires `@relay-assistant/memory` integration |
| Coordination-driven proactive actions | v1.2 | Multi-agent proactive behavior |
| Traits-aware proactive voice | v1.2 | Depends on `@relay-assistant/traits` |
| `defer` action in FollowUpDecision | v1.1 | Retry scheduling for deferred evaluations |
| Proactive action budgets / rate limiting | v2 | Belongs in `@relay-assistant/policy` |
| Distributed watch rule evaluation | v2+ | Single-process only in v1 |
| Event-stream watchers | v1.2 | v1 is poll-based; event-driven watchers are additive |
| Cross-session rule scoping | v1.1 | v1 rules are scoped to a single session |

---

V1_PROACTIVE_SPEC_READY
