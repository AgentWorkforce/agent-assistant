# `@agent-assistant/proactive`

**Status:** IMPLEMENTATION_READY
**Version:** 0.1.0 (pre-1.0, provisional)
**Spec:** `docs/specs/v1-proactive-spec.md`
**Implementation plan:** `docs/architecture/v1-proactive-implementation-plan.md`

---

## What This Package Does

`@agent-assistant/proactive` is the decision layer for proactive assistant behavior — any assistant action that originates without a direct user message in the current turn.

It provides:

- **ProactiveEngine** — evaluates follow-up rules and watch rules against session context, applies suppression policy, and returns structured decisions
- **Follow-up rule evaluation** — rules fire, suppress, or are silenced by cooldown/max-count/user-activity checks
- **Reminder policy** — configurable `maxReminders`, `cooldownMs`, and `suppressWhenActive` per rule
- **Watch rules** — long-running monitoring rules that re-schedule themselves after every evaluation; lifecycle methods for pause, resume, and cancel
- **SchedulerBinding interface** — thin contract to external scheduling infrastructure (relaycron); this package does not own or wrap relaycron
- **InMemorySchedulerBinding** — test adapter with a manual trigger helper; no external infrastructure required for tests
- **FollowUpEvidenceSource interface** — optional pluggable evidence injection (e.g., memory entries) for rule conditions

This package does **not** own scheduling infrastructure, session lifecycle, message delivery, or domain-specific rule logic. All of that stays in product code or other packages.

---

## Installation

```sh
npm install @agent-assistant/proactive
```

No `@agent-assistant/*` runtime dependencies. Only `nanoid` is required at runtime.

---

## Quick Start

```ts
import {
  createProactiveEngine,
  InMemorySchedulerBinding,
} from '@agent-assistant/proactive';
import type { FollowUpRule } from '@agent-assistant/proactive';

// Wire a scheduler binding (InMemorySchedulerBinding for tests/dev)
const schedulerBinding = new InMemorySchedulerBinding();

const engine = createProactiveEngine({
  schedulerBinding,
  defaultReminderPolicy: {
    maxReminders: 3,
    cooldownMs: 3_600_000, // 1 hour
    suppressWhenActive: true,
  },
});

// Register a follow-up rule (stale-thread pattern)
const staleThreadRule: FollowUpRule = {
  id: 'stale-thread',
  description: 'Follow up if the session has been silent for more than 24 hours',
  condition: (ctx) => {
    const inactiveMs =
      new Date(ctx.scheduledAt).getTime() - new Date(ctx.lastActivityAt).getTime();
    return inactiveMs > 24 * 60 * 60 * 1000;
  },
  policy: {
    maxReminders: 2,
    cooldownMs: 24 * 60 * 60 * 1000,
  },
  routingHint: 'cheap',
  messageTemplate: 'Checking in — any updates on this thread?',
};

engine.registerFollowUpRule(staleThreadRule);
```

---

## Usage in a Capability Handler

The proactive package does not register a capability handler. Products write their own:

```ts
// In your assistant definition (product code)
const definition = {
  capabilities: {
    proactive: async (message, context) => {
      const wakeUpContext = message.payload; // parsed from the synthetic wake-up message

      // Fetch session state from your session store
      const session = await context.sessionStore.get(wakeUpContext.sessionId);

      // Evaluate follow-up rules
      const decisions = await engine.evaluateFollowUp({
        sessionId: wakeUpContext.sessionId,
        scheduledAt: wakeUpContext.scheduledAt,
        lastActivityAt: session.lastActivityAt,
      });

      for (const decision of decisions) {
        if (decision.action === 'fire') {
          await context.runtime.emit({
            sessionId: decision.sessionId,
            text: decision.messageTemplate ?? 'Following up.',
          });
        }
      }
    },
  },
};
```

---

## Follow-Up Rules

Rules are product-supplied. The engine handles watch-rule re-scheduling via `SchedulerBinding` and reminder state. Follow-up scheduling is product-owned.

```ts
interface FollowUpRule {
  id: string;
  condition(ctx: FollowUpEvaluationContext, evidence: EvidenceEntry[]): boolean | Promise<boolean>;
  description?: string;
  policy?: ReminderPolicy;       // overrides engine default when present
  routingHint?: 'cheap' | 'fast' | 'deep'; // defaults to 'cheap'
  messageTemplate?: string;
}
```

**Suppression order:**
1. User became active after the wake-up was scheduled (`lastActivityAt > scheduledAt`)
2. Max reminders reached for this `(sessionId, ruleId)` pair
3. Cooldown window not elapsed since the last reminder
4. Condition function returned false

The first matching suppression wins. If none match, the decision is `fire`.

---

## Watch Rules

Watch rules are long-running monitors that re-schedule themselves after every evaluation — whether or not the condition triggered.

```ts
engine.registerWatchRule({
  id: 'unreviewed-pr',
  description: 'Alert if a PR has been open without review for over 2 hours',
  condition: async (ctx) => {
    // product fetches PR state from its own store
    return myStore.hasUnreviewedPRsOlderThan(2 * 60 * 60 * 1000);
  },
  action: { type: 'notify_channel', payload: { channel: 'eng-alerts' } },
  intervalMs: 30 * 60 * 1000, // check every 30 minutes
});

// Lifecycle
engine.pauseWatchRule('unreviewed-pr');
engine.resumeWatchRule('unreviewed-pr');
engine.cancelWatchRule('unreviewed-pr'); // permanent; re-register to restart

// List statuses
const statuses = engine.listWatchRules();
// [{ rule, status: 'active' | 'paused' | 'cancelled', lastEvaluatedAt, nextWakeUpBindingId }]

// Evaluate (called from your proactive capability handler after each wake-up)
const triggers = await engine.evaluateWatchRules({
  ruleId: wakeUpContext.ruleId,
  scheduledAt: wakeUpContext.scheduledAt,
  metadata: wakeUpContext.metadata,
});
for (const trigger of triggers) {
  await handleWatchAction(trigger.action, trigger.context);
}
```

---

## Scheduler Binding

The `SchedulerBinding` interface decouples the engine from scheduling infrastructure.

```ts
interface SchedulerBinding {
  requestWakeUp(at: Date, context: WakeUpContext): Promise<string>; // returns bindingId
  cancelWakeUp(bindingId: string): Promise<void>;
}
```

**For tests and local development:** use the built-in `InMemorySchedulerBinding`:

```ts
const binding = new InMemorySchedulerBinding();

// Inspect pending wake-ups
console.log(binding.pendingWakeUps); // Map<bindingId, { at, context }>

// Manually fire a wake-up in tests
const context = await binding.trigger(bindingId);
```

**For production:** implement `SchedulerBinding` against your relaycron client. The proactive package does not implement or ship a relaycron integration — that is a product/foundation concern.

---

## Evidence Sources

Optional. Wire an evidence source to give rule conditions access to recent memory entries or other context:

```ts
const evidenceSource = {
  getRecentEntries: (sessionId, opts) =>
    memoryStore.retrieve({ scope: { kind: 'session', sessionId }, limit: opts?.limit }),
};

const engine = createProactiveEngine({ schedulerBinding, evidenceSource });
```

If configured, the engine calls `getRecentEntries` once per `evaluateFollowUp` call (shared across all rules in that call). If `context.evidence` is pre-fetched and provided, the source is not called at all.

If not configured, condition functions receive an empty evidence array.

---

## Reminder State Management

Reminder state is in-memory and keyed by `(sessionId, ruleId)`.

```ts
// Clear state for a specific rule in a session (e.g., when user resolves the thread)
engine.resetReminderState('session-abc', 'stale-thread');

// Clear all reminder state for a session (e.g., on session close)
engine.resetReminderState('session-abc');
```

---

## What Stays Outside This Package

| Concern | Where it lives |
|---|---|
| Scheduling infrastructure (timers, cron, dispatch) | Relay foundation (relaycron) |
| Domain-specific rule definitions | Product repos |
| Product-specific timing thresholds | Product configuration |
| Memory persistence | `@agent-assistant/memory` (via `FollowUpEvidenceSource`) |
| Session lifecycle | `@agent-assistant/sessions` |
| Outbound message delivery | `@agent-assistant/surfaces` + Relay runtime |
| Cross-agent coordination of proactive actions | `@agent-assistant/coordination` (v1.2) |
| Proactive action rate limiting / budgets | `@agent-assistant/policy` (v2) |

---

## Package Structure

```
packages/proactive/
  package.json        — nanoid runtime dep only
  tsconfig.json
  src/
    types.ts          — all exported types, interfaces, error classes
    proactive.ts      — createProactiveEngine factory and all engine logic
    index.ts          — public re-exports
    proactive.test.ts — 45 tests
  README.md
```

---

PROACTIVE_PACKAGE_DIRECTION_READY
