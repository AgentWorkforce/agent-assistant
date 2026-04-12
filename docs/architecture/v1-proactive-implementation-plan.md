# v1 Proactive Implementation Plan

**Date:** 2026-04-12
**Package:** `@relay-assistant/proactive`
**Status:** IMPLEMENTATION_READY
**Spec:** `docs/specs/v1-proactive-spec.md`
**Scope reference:** `docs/architecture/v1-proactive-scope.md`
**Version target:** v0.1.0

---

## 1. Bounded v1 Scope

### What v1 Proactive Delivers

1. **ProactiveEngine factory** — `createProactiveEngine(config)` returns a stateful engine with all v1 methods
2. **Follow-up rule registration and evaluation** — register product-supplied rules; evaluate against session context; apply suppression logic
3. **Reminder policy and state tracking** — configurable `maxReminders`, `cooldownMs`, `suppressWhenActive`; in-memory per-`(sessionId, ruleId)` state
4. **Stale-thread detection pattern** — implemented as a follow-up rule condition; no special engine concept needed
5. **Watch rule lifecycle** — register, pause, resume, cancel, list; in-memory state only
6. **Watch rule evaluation with re-scheduling** — after every evaluation, active rules request a new wake-up via the scheduler binding
7. **SchedulerBinding interface** — thin contract between the engine and external scheduling infra; no implementation of relaycron
8. **InMemorySchedulerBinding** — test adapter that records pending wake-ups and allows manual trigger
9. **FollowUpEvidenceSource interface** — optional pluggable evidence injection for rule conditions
10. **Error types** — `ProactiveError`, `RuleNotFoundError`, `SchedulerBindingError`
11. **41+ tests** — per DoD standard established by memory, routing, and connectivity packages

### What v1 Proactive Does NOT Deliver

- **No relaycron binding implementation.** The `SchedulerBinding` interface is the full extent of scheduler involvement.
- **No persistent rule storage.** All rule and reminder state is in-memory in the engine instance.
- **No capability handler registration.** Products write their own `proactive` capability handler.
- **No connectivity signal emission.** Proactive actions flow through the normal runtime emit path.
- **No coordination wiring.** v1 proactive is single-agent.
- **No traits integration.** Proactive message voice is product-controlled via `messageTemplate`.
- **No `defer` action.** v1 evaluations return `fire` or `suppress` only.

---

## 2. File Manifest

All files under `packages/proactive/`.

### Package Infrastructure

| File | Purpose |
|---|---|
| `package.json` | Package manifest; `nanoid` is the only runtime dep |
| `tsconfig.json` | TypeScript config; ES2022, NodeNext, strict mode, declarations to `dist/` |

### Runtime Source (`src/`)

| File | Approx. lines | Purpose |
|---|---|---|
| `src/types.ts` | ~150 | All exported types, interfaces, and error classes |
| `src/proactive.ts` | ~400 | `createProactiveEngine` factory; follow-up evaluation; watch rule management; reminder state; suppression logic |
| `src/index.ts` | ~25 | Public API re-exports |

### Tests (`src/`)

| File | Approx. lines | Purpose |
|---|---|---|
| `src/proactive.test.ts` | ~500 | 41+ tests across all spec categories |

**Total: 6 files** (2 infrastructure + 3 runtime + 1 test)

---

## 3. Type Definitions (`src/types.ts`)

All types are new. There are no relay foundation types to reuse — this package has zero runtime dependencies on `@agent-relay/*` or `@relay-assistant/*`.

### 3.1 Core Decision Types

```ts
export type RoutingHint = 'cheap' | 'fast' | 'deep';

export type SuppressionReason = 'user_active' | 'cooldown' | 'max_reminders';

export type FollowUpAction = 'fire' | 'suppress';
// Note: 'defer' is reserved for v1.1
```

### 3.2 Reminder Policy

```ts
export interface ReminderPolicy {
  maxReminders?: number;    // default: 3
  cooldownMs?: number;      // default: 3_600_000 (1h)
  suppressWhenActive?: boolean; // default: true
}
```

### 3.3 Follow-Up Rule and Context

```ts
export interface EvidenceEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface FollowUpEvaluationContext {
  sessionId: string;
  scheduledAt: string;       // ISO-8601
  lastActivityAt: string;    // ISO-8601
  evidence?: EvidenceEntry[];
}

export interface FollowUpRule {
  id: string;
  condition(ctx: FollowUpEvaluationContext, evidence: EvidenceEntry[]): boolean | Promise<boolean>;
  description?: string;
  policy?: ReminderPolicy;
  routingHint?: RoutingHint;
  messageTemplate?: string;
}

export interface FollowUpDecision {
  ruleId: string;
  sessionId: string;
  action: FollowUpAction;
  suppressionReason?: SuppressionReason;
  routingHint: RoutingHint;
  messageTemplate?: string;
}
```

### 3.4 Watch Rule Types

```ts
export interface WatchAction {
  type: string;
  payload?: Record<string, unknown>;
}

export interface WatchEvaluationContext {
  ruleId: string;
  scheduledAt: string; // ISO-8601
  metadata?: Record<string, unknown>;
}

export interface WatchRule {
  id: string;
  condition(ctx: WatchEvaluationContext): boolean | Promise<boolean>;
  action: WatchAction;
  intervalMs: number;
  description?: string;
}

export interface WatchTrigger {
  ruleId: string;
  triggeredAt: string; // ISO-8601
  action: WatchAction;
  context: WatchEvaluationContext;
}

export type WatchRuleLifecycleStatus = 'active' | 'paused' | 'cancelled';

export interface WatchRuleStatus {
  rule: WatchRule;
  status: WatchRuleLifecycleStatus;
  lastEvaluatedAt: string | null;
  nextWakeUpBindingId: string | null;
}
```

### 3.5 Scheduler Binding

```ts
export interface WakeUpContext {
  sessionId: string;
  ruleId?: string;
  scheduledAt: string; // ISO-8601
  metadata?: Record<string, unknown>;
}

export interface SchedulerBinding {
  requestWakeUp(at: Date, context: WakeUpContext): Promise<string>; // returns bindingId
  cancelWakeUp(bindingId: string): Promise<void>;
}
```

### 3.6 Evidence Source

```ts
export interface FollowUpEvidenceSource {
  getRecentEntries(
    sessionId: string,
    options?: { limit?: number; tags?: string[] }
  ): Promise<EvidenceEntry[]>;
}
```

### 3.7 Engine Interface and Config

```ts
export interface ProactiveEngineConfig {
  schedulerBinding: SchedulerBinding;
  evidenceSource?: FollowUpEvidenceSource;
  defaultReminderPolicy?: ReminderPolicy;
}

export interface ProactiveEngine {
  // Follow-up rules
  registerFollowUpRule(rule: FollowUpRule): void;
  removeFollowUpRule(ruleId: string): void;
  listFollowUpRules(): FollowUpRule[];
  evaluateFollowUp(context: FollowUpEvaluationContext): Promise<FollowUpDecision[]>;
  resetReminderState(sessionId: string, ruleId?: string): void;

  // Watch rules
  registerWatchRule(rule: WatchRule): void;
  pauseWatchRule(ruleId: string): void;
  resumeWatchRule(ruleId: string): void;
  cancelWatchRule(ruleId: string): void;
  listWatchRules(): WatchRuleStatus[];
  evaluateWatchRules(context: WatchEvaluationContext): Promise<WatchTrigger[]>;
}
```

### 3.8 Error Classes

```ts
export class ProactiveError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ProactiveError';
    this.code = code;
  }
}

export class RuleNotFoundError extends ProactiveError {
  readonly ruleId: string;
  readonly ruleType: 'followUp' | 'watch';
  constructor(ruleId: string, ruleType: 'followUp' | 'watch') {
    super(`Rule not found: ${ruleId} (${ruleType})`, 'RULE_NOT_FOUND');
    this.name = 'RuleNotFoundError';
    this.ruleId = ruleId;
    this.ruleType = ruleType;
  }
}

export class SchedulerBindingError extends ProactiveError {
  readonly bindingId?: string;
  readonly cause: unknown;
  constructor(message: string, cause: unknown, bindingId?: string) {
    super(message, 'SCHEDULER_BINDING_ERROR');
    this.name = 'SchedulerBindingError';
    this.cause = cause;
    this.bindingId = bindingId;
  }
}
```

---

## 4. Engine Implementation (`src/proactive.ts`)

### 4.1 Internal State

```ts
// Internal shapes — not exported
interface ReminderState {
  reminderCount: number;
  lastReminderSentAt: string | null; // ISO-8601
}

interface WatchRuleRecord {
  rule: WatchRule;
  status: WatchRuleLifecycleStatus;
  lastEvaluatedAt: string | null;
  nextWakeUpBindingId: string | null;
}
```

State maps:
- `followUpRules: Map<string, FollowUpRule>` — keyed by `rule.id`
- `reminderStates: Map<string, ReminderState>` — keyed by `${sessionId}:${ruleId}`
- `watchRuleRecords: Map<string, WatchRuleRecord>` — keyed by `rule.id`

### 4.2 Suppression Logic (ordered)

```
function applyFollowUpSuppression(
  context: FollowUpEvaluationContext,
  rule: FollowUpRule,
  policy: Required<ReminderPolicy>,
  reminderState: ReminderState,
  now: Date
): { suppressed: boolean; reason?: SuppressionReason }
```

Order of checks:
1. `suppressWhenActive && new Date(ctx.lastActivityAt) > new Date(ctx.scheduledAt)` → `{ suppressed: true, reason: 'user_active' }`
2. `reminderState.reminderCount >= policy.maxReminders` → `{ suppressed: true, reason: 'max_reminders' }`
3. `reminderState.lastReminderSentAt && now.getTime() - new Date(lastReminderSentAt).getTime() < policy.cooldownMs` → `{ suppressed: true, reason: 'cooldown' }`
4. Otherwise → `{ suppressed: false }`

If not suppressed, the condition function is still evaluated. A false condition returns `action: 'suppress'` with no `suppressionReason`.

### 4.3 Follow-Up Evaluation Flow

```
evaluateFollowUp(context):
  if evidenceSource configured and context.evidence not provided:
    evidence = await evidenceSource.getRecentEntries(context.sessionId)
  else:
    evidence = context.evidence ?? []

  decisions = []
  for each rule in followUpRules:
    policy = merge(defaultReminderPolicy, rule.policy)
    reminderState = reminderStates.get(key) ?? { reminderCount: 0, lastReminderSentAt: null }
    suppression = applyFollowUpSuppression(context, rule, policy, reminderState, now)

    if suppression.suppressed:
      decisions.push({ ruleId, sessionId, action: 'suppress', suppressionReason, routingHint, messageTemplate })
      continue

    conditionResult = await rule.condition(context, evidence)
    if not conditionResult:
      decisions.push({ action: 'suppress', ... })
      continue

    // Fire: update reminder state
    reminderStates.set(key, { reminderCount: reminderState.reminderCount + 1, lastReminderSentAt: now.toISOString() })
    decisions.push({ action: 'fire', routingHint: rule.routingHint ?? 'cheap', ... })

  return decisions
```

### 4.4 Watch Rule Evaluation Flow

```
evaluateWatchRules(context):
  triggers = []
  for each record in watchRuleRecords where status === 'active':
    ruleContext = { ruleId: record.rule.id, scheduledAt: context.scheduledAt, metadata: context.metadata }
    conditionResult = await record.rule.condition(ruleContext)
    record.lastEvaluatedAt = now.toISOString()

    if conditionResult:
      triggers.push({ ruleId, triggeredAt: now.toISOString(), action: record.rule.action, context: ruleContext })

    // Re-schedule regardless of trigger
    if record.nextWakeUpBindingId:
      await schedulerBinding.cancelWakeUp(record.nextWakeUpBindingId)
    nextAt = new Date(Date.now() + record.rule.intervalMs)
    try:
      newBindingId = await schedulerBinding.requestWakeUp(nextAt, {
        sessionId: context.metadata?.sessionId ?? '_watch',
        ruleId: record.rule.id,
        scheduledAt: nextAt.toISOString(),
        metadata: context.metadata,
      })
      record.nextWakeUpBindingId = newBindingId
    catch (err):
      throw new SchedulerBindingError('Failed to re-schedule watch rule', err)

  return triggers
```

### 4.5 InMemorySchedulerBinding Implementation

```ts
class InMemorySchedulerBinding implements SchedulerBinding {
  readonly pendingWakeUps: Map<string, { at: Date; context: WakeUpContext }> = new Map();
  private _triggerCallbacks: Map<string, Array<() => void>> = new Map();

  async requestWakeUp(at: Date, context: WakeUpContext): Promise<string> {
    const bindingId = nanoid();
    this.pendingWakeUps.set(bindingId, { at, context });
    return bindingId;
  }

  async cancelWakeUp(bindingId: string): Promise<void> {
    this.pendingWakeUps.delete(bindingId);
  }

  /** Test helper: manually fire a pending wake-up. */
  async trigger(bindingId: string): Promise<WakeUpContext> {
    const entry = this.pendingWakeUps.get(bindingId);
    if (!entry) throw new Error(`No pending wake-up for bindingId: ${bindingId}`);
    this.pendingWakeUps.delete(bindingId);
    return entry.context;
  }
}
```

---

## 5. Public Exports (`src/index.ts`)

```ts
export type {
  RoutingHint,
  SuppressionReason,
  FollowUpAction,
  ReminderPolicy,
  EvidenceEntry,
  FollowUpEvaluationContext,
  FollowUpRule,
  FollowUpDecision,
  WatchAction,
  WatchEvaluationContext,
  WatchRule,
  WatchTrigger,
  WatchRuleStatus,
  WatchRuleLifecycleStatus,
  WakeUpContext,
  SchedulerBinding,
  FollowUpEvidenceSource,
  ProactiveEngineConfig,
  ProactiveEngine,
} from './types.js';

export {
  ProactiveError,
  RuleNotFoundError,
  SchedulerBindingError,
} from './types.js';

export { createProactiveEngine, InMemorySchedulerBinding } from './proactive.js';
```

---

## 6. Package Configuration

### `package.json`

```json
{
  "name": "@relay-assistant/proactive",
  "version": "0.1.0",
  "description": "Proactive decision engine for Relay Agent Assistant SDK",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "nanoid": "^5.0.7"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

### `tsconfig.json`

Same pattern as memory, routing, connectivity: ES2022 target, NodeNext module resolution, strict mode, declarations emitted to `dist/`.

---

## 7. Test Plan (`src/proactive.test.ts`)

### 7.1 Type Structural Tests (4 tests)

```
✓ ProactiveEngine interface has all required methods
✓ FollowUpRule interface requires id and condition
✓ SchedulerBinding interface has requestWakeUp and cancelWakeUp
✓ Error classes extend ProactiveError with correct code fields
```

### 7.2 Follow-Up Rule Registration (5 tests)

```
✓ registerFollowUpRule stores rule and listFollowUpRules returns it
✓ registerFollowUpRule with duplicate id throws (or overwrites — spec says duplicate rejection)
✓ removeFollowUpRule removes a registered rule
✓ removeFollowUpRule on unknown id throws RuleNotFoundError
✓ listFollowUpRules returns empty array when no rules registered
```

### 7.3 Follow-Up Evaluation — Basic (4 tests)

```
✓ evaluateFollowUp with single rule that fires returns action='fire'
✓ evaluateFollowUp with condition returning false returns action='suppress' with no suppressionReason
✓ evaluateFollowUp with multiple rules returns decision for each
✓ evaluateFollowUp with no rules returns empty array
```

### 7.4 Follow-Up Evaluation — Suppression (5 tests)

```
✓ user became active after scheduledAt → action='suppress', suppressionReason='user_active'
✓ cooldown not elapsed → action='suppress', suppressionReason='cooldown'
✓ maxReminders reached → action='suppress', suppressionReason='max_reminders'
✓ suppressWhenActive=false ignores lastActivityAt check
✓ all three suppression reasons tested in isolation with correct priority order
```

### 7.5 Follow-Up Evaluation — Evidence (3 tests)

```
✓ configured evidenceSource.getRecentEntries called with sessionId when evidence not in context
✓ evidence entries passed to rule condition as second argument
✓ context.evidence used directly when provided; evidenceSource not called
```

### 7.6 Follow-Up Evaluation — Routing (2 tests)

```
✓ routingHint from rule passed through to FollowUpDecision
✓ missing routingHint defaults to 'cheap'
```

### 7.7 Reminder State (4 tests)

```
✓ reminderCount incremented on each fire decision
✓ resetReminderState(sessionId, ruleId) clears state for specific pair
✓ resetReminderState(sessionId) clears all state for session
✓ reminder state not shared across different sessionIds
```

### 7.8 Watch Rule Lifecycle (6 tests)

```
✓ registerWatchRule stores rule with status='active'
✓ pauseWatchRule sets status='paused'; paused rule not evaluated
✓ resumeWatchRule sets status='active'; rule evaluated again
✓ cancelWatchRule sets status='cancelled'; cancelled rule not evaluated and not re-scheduled
✓ listWatchRules returns current status for all rules
✓ registerWatchRule after cancelWatchRule allows re-registration with same id
```

### 7.9 Watch Rule Evaluation (5 tests)

```
✓ condition returning true → WatchTrigger included in result
✓ condition returning false → no WatchTrigger; rule still re-scheduled
✓ after evaluateWatchRules, active rule's nextWakeUpBindingId updated
✓ paused rule not evaluated, not re-scheduled
✓ multiple rules: triggered and non-triggered both handled correctly
```

### 7.10 Scheduler Binding (4 tests)

```
✓ watch rule re-schedule calls schedulerBinding.requestWakeUp with correct intervalMs offset
✓ previous bindingId cancelled before new requestWakeUp
✓ InMemorySchedulerBinding records pending wake-ups in pendingWakeUps map
✓ InMemorySchedulerBinding.trigger() returns WakeUpContext and removes from pending
```

### 7.11 Error Handling (3 tests)

```
✓ removeFollowUpRule with unknown id throws RuleNotFoundError with ruleType='followUp'
✓ pauseWatchRule with unknown id throws RuleNotFoundError with ruleType='watch'
✓ schedulerBinding.requestWakeUp failure wrapped in SchedulerBindingError
```

**Total: 45 tests** (exceeds 41 minimum)

---

## 8. Capability Handler Pattern (for product documentation)

Products write their own `proactive` capability handler. The engine is a dependency of the handler, not a framework that calls products.

```ts
// Product code — not in the proactive package
import { createProactiveEngine, InMemorySchedulerBinding } from '@relay-assistant/proactive';
import type { AssistantDefinition } from '@relay-assistant/core';

const schedulerBinding = new InMemorySchedulerBinding(); // replace with real binding in prod

const engine = createProactiveEngine({
  schedulerBinding,
  defaultReminderPolicy: { maxReminders: 3, cooldownMs: 3_600_000, suppressWhenActive: true },
});

engine.registerFollowUpRule({
  id: 'stale-thread',
  condition: (ctx) => {
    const inactiveMs = new Date(ctx.scheduledAt).getTime() - new Date(ctx.lastActivityAt).getTime();
    return inactiveMs > 24 * 60 * 60 * 1000;
  },
  policy: { maxReminders: 2, cooldownMs: 24 * 60 * 60 * 1000 },
  routingHint: 'cheap',
  messageTemplate: 'Checking in — any updates on this thread?',
});

const definition: AssistantDefinition = {
  capabilities: {
    proactive: async (message, context) => {
      const wakeUpContext = message.payload as WakeUpContext;
      const session = await context.sessionStore.get(wakeUpContext.sessionId);
      const decisions = await engine.evaluateFollowUp({
        sessionId: wakeUpContext.sessionId,
        scheduledAt: wakeUpContext.scheduledAt,
        lastActivityAt: session.lastActivityAt,
      });
      for (const decision of decisions) {
        if (decision.action === 'fire') {
          await context.runtime.emit({
            sessionId: decision.sessionId,
            text: decision.messageTemplate ?? 'Following up on our conversation.',
          });
        }
      }
    },
  },
};
```

---

## 9. PR Scope

**Single PR.** The package is self-contained:
- No changes to any other `@relay-assistant/*` package
- No changes to `packages/core` or any shared infra
- Products adopt by importing and wiring `schedulerBinding` and optional `evidenceSource`

The PR ships:
- `packages/proactive/package.json`
- `packages/proactive/tsconfig.json`
- `packages/proactive/src/types.ts`
- `packages/proactive/src/proactive.ts`
- `packages/proactive/src/index.ts`
- `packages/proactive/src/proactive.test.ts`
- `packages/proactive/README.md` (update from placeholder)

---

V1_PROACTIVE_IMPLEMENTATION_PLAN_READY
