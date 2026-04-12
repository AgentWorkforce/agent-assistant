# Proactive Runtime Notes — `@relay-assistant/proactive`

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Date:** 2026-04-12
**Status:** COMPLETE
**Feeds into:** `docs/specs/v1-proactive-spec.md`, `docs/architecture/v1-proactive-implementation-plan.md`

---

## 1. Purpose

This document records the runtime behavior decisions and design investigations for the v1 proactive package. It answers: how does the engine interact with the scheduler at runtime, what are the edge cases in suppression and re-scheduling, and what patterns from existing products informed the design?

---

## 2. Runtime Dispatch Path

### 2.1 How Proactive Actions Are Triggered

Proactive actions originate from a scheduled wake-up, not a user message. The dispatch path is:

```
relaycron fires scheduled entry
  → dispatches synthetic InboundMessage to assistant runtime
  → runtime routes to product's 'proactive' capability handler
  → handler calls engine.evaluateFollowUp() or engine.evaluateWatchRules()
  → engine returns decisions/triggers
  → handler emits outbound events via runtime.emit()
  → runtime delivers to attached surfaces
```

The proactive package participates only in the middle step — the engine call. It has no hooks into the runtime dispatch path, no event listeners, and no background processes.

### 2.2 Why the Engine Has No Async Lifecycle

The engine is a stateless decision library that is called synchronously from the capability handler. It does not:
- Register timers internally
- Subscribe to session events
- Maintain background goroutines or intervals

This is a deliberate choice. An engine with an async lifecycle would require teardown, error handling for background failures, and coordination with the runtime shutdown sequence. None of this is needed when the engine is purely called-in, returns a result, and exits.

Watch rules re-schedule via the `SchedulerBinding` at the end of each `evaluateWatchRules()` call. The next wake-up is external infrastructure's responsibility.

---

## 3. Suppression Logic — Edge Cases and Decisions

### 3.1 The scheduledAt / lastActivityAt Comparison

**Problem:** If the user sends a message after the wake-up is scheduled but before it fires, the assistant should not follow up — the user is already engaged.

**Solution:** The engine compares `lastActivityAt` to `scheduledAt`. If the user's last activity is newer than when the wake-up was scheduled, the assistant suppresses.

**Why `scheduledAt` and not `now`?** Using `now` would suppress follow-ups even when the user was active hours ago and the wake-up just fired. The relevant question is: "did the user engage after I decided to follow up?" — which is exactly `lastActivityAt > scheduledAt`.

**Who provides `scheduledAt`?** The `WakeUpContext` stored by the engine when it called `requestWakeUp`. The product's capability handler reads this from the synthetic message payload and passes it to `evaluateFollowUp`. The engine does not query the scheduler for this value.

### 3.2 suppressWhenActive = false

When `suppressWhenActive` is false, the engine does not check `lastActivityAt > scheduledAt`. This is for rules where the assistant should follow up even when the user is currently active — e.g., a system health alert where urgency outweighs social suppression.

Products set this per-rule via `rule.policy.suppressWhenActive = false`.

### 3.3 Cooldown Precision

Cooldown is measured from `lastReminderSentAt`, which is set to `Date.now().toISOString()` at the moment the engine produces a `fire` decision — not when the outbound message is delivered. This is intentional: the engine cannot know when delivery succeeded, and the distinction is typically irrelevant at reminder timescales (minutes to hours).

If delivery fails in the product's capability handler, the product code can call `engine.resetReminderState(sessionId, ruleId)` to un-count that reminder.

### 3.4 Max Reminders and the Ceiling

When `reminderCount >= maxReminders`, the suppression reason is `max_reminders`. The rule is still registered; it will continue to be checked for every subsequent evaluation but will always suppress until the reminder state is reset.

Products that want to permanently disable a rule after max reminders should call `engine.removeFollowUpRule(ruleId)` from their capability handler when they receive a `max_reminders` suppression.

---

## 4. Watch Rule Re-Scheduling — Edge Cases and Decisions

### 4.1 Re-Schedule on Every Evaluation (Not Just on Trigger)

A watch rule that monitors "has PR X been reviewed?" should keep checking until it is cancelled, not just until it triggers once. Re-scheduling on every evaluation (whether or not the condition fired) ensures continuous monitoring with no manual renewal.

This means the wake-up density equals `1 wake-up per rule per interval` regardless of trigger rate. For N active watch rules each with interval I, the scheduler sees N/I wake-ups per second (usually very small numbers in practice).

### 4.2 Cancel Before Re-Schedule

Before requesting a new wake-up, the engine cancels the previous `bindingId`. This prevents duplicate wake-ups if the scheduler holds the old entry and the new entry fires concurrently.

**Edge case:** If `cancelWakeUp` fails (e.g., the binding has already fired), the engine swallows the error and proceeds with `requestWakeUp`. A binding that already fired cannot produce a duplicate; only a pending binding can. If `requestWakeUp` fails, the engine wraps the error in `SchedulerBindingError` and re-throws — the watch rule is left with a stale `nextWakeUpBindingId` and will not re-schedule until the next successful evaluation.

### 4.3 Paused Rules and Re-Scheduling

Paused rules are not evaluated and do not re-schedule. This means a paused rule will not fire another wake-up, so the scheduler will not call the capability handler for that rule until it is resumed. When the rule is resumed, the product is responsible for scheduling the next wake-up (typically by calling `engine.evaluateWatchRules()` from a manual trigger or an explicit "resume and reschedule" helper).

**v1 decision:** There is no `engine.resumeAndReschedule()` method. Products call `resumeWatchRule()` and then manually request a wake-up via the scheduler binding. This keeps the engine from owning scheduling directly.

### 4.4 Cancelled Rules

Cancelled rules are permanently inactive. `cancelWatchRule` cancels the pending `bindingId` (if any) via `schedulerBinding.cancelWakeUp()` and sets status to `cancelled`. The rule entry remains in `listWatchRules()` for observability but is never evaluated.

Products can re-register with the same `id` after cancellation. The existing cancelled record is overwritten.

---

## 5. InMemorySchedulerBinding — Test Patterns

### 5.1 Basic Wake-Up Inspection

```ts
const binding = new InMemorySchedulerBinding();
const engine = createProactiveEngine({ schedulerBinding: binding });

engine.registerWatchRule({
  id: 'test-rule',
  condition: () => true,
  action: { type: 'alert' },
  intervalMs: 60_000,
});

await engine.evaluateWatchRules({ ruleId: 'test-rule', scheduledAt: new Date().toISOString() });

// Inspect what was scheduled
expect(binding.pendingWakeUps.size).toBe(1);
const [bindingId, entry] = [...binding.pendingWakeUps.entries()][0];
expect(entry.context.ruleId).toBe('test-rule');
```

### 5.2 Manual Trigger

```ts
const context = await binding.trigger(bindingId);
// context.ruleId === 'test-rule'
// The binding is now removed from pendingWakeUps
expect(binding.pendingWakeUps.has(bindingId)).toBe(false);
```

### 5.3 Simulating a User-Active Suppression

```ts
const now = new Date();
const scheduledAt = new Date(now.getTime() - 60_000).toISOString(); // 1 min ago
const lastActivityAt = new Date(now.getTime() - 30_000).toISOString(); // 30s ago (after scheduledAt)

const decisions = await engine.evaluateFollowUp({
  sessionId: 'test-session',
  scheduledAt,
  lastActivityAt,
});

const fired = decisions.find(d => d.action === 'fire');
expect(fired).toBeUndefined();
const suppressed = decisions.find(d => d.suppressionReason === 'user_active');
expect(suppressed).toBeDefined();
```

---

## 6. Evidence Source — Design Rationale

### 6.1 Why Interface-Based, Not Direct Import

The proactive engine must be usable without `@relay-assistant/memory`. Many follow-up rules (stale-thread detection, inactivity checks) need no memory evidence at all. Forcing a dependency on memory for the simplest case violates the zero-dependency principle and couples package versions.

The `FollowUpEvidenceSource` interface lets products opt in to memory-informed rules by wiring a memory-backed implementation, without the engine knowing about memory at all.

### 6.2 Pre-Fetched vs. Engine-Fetched Evidence

The engine supports two evidence paths:

1. **Context-provided:** `context.evidence` is already populated. The engine uses it directly and does not call the evidence source. Use this when the capability handler pre-fetches evidence for other purposes (e.g., logging, tracing) and wants to avoid a second fetch.

2. **Engine-fetched:** `context.evidence` is absent and `evidenceSource` is configured. The engine calls `getRecentEntries` once per `evaluateFollowUp` call (not per rule). All rules in that evaluation share the same evidence batch.

This batching is intentional — fetching evidence per rule would multiply calls to the memory store for each evaluation pass.

### 6.3 Evidence Scope

The evidence source receives `sessionId` and optional filter options. Session-scoped evidence is appropriate for most follow-up decisions. Cross-session evidence (e.g., "has this user asked about X in other sessions?") is a v1.1 concern; the interface supports it via `metadata` on `EvidenceEntry` that products can filter on.

---

## 7. Extraction Signals from Products

These runtime patterns were extracted from existing products and informed the v1 design. Products keep their domain-specific logic; the engine provides the infrastructure.

### 7.1 Sage — Stale-Thread Follow-Ups

**Pattern:** Sessions that go quiet for >24h receive a follow-up nudge. Max 2 reminders per session per topic thread. Cooldown of 24h between nudges. Suppressed if user re-engages before the nudge fires.

**Extracted to engine:** Follow-up rule evaluation, suppression logic (user_active, cooldown, max_reminders), reminder state per `(sessionId, ruleId)`.

**Stays in Sage:** The 24h threshold, the follow-up message text, the decision of which sessions to monitor (registered via `engine.registerFollowUpRule` at startup).

### 7.2 MSD — PR Review Reminders

**Pattern:** PRs open without a reviewer for >2h trigger a channel alert. Check every 30 minutes. Stop alerting after 3 reminders or when a reviewer is assigned. Pause alerting on weekends.

**Extracted to engine:** Watch rule registration, `intervalMs`-based re-scheduling, `pauseWatchRule`, reminder count ceiling.

**Stays in MSD:** The PR state query (product's data layer), the channel notification logic, weekend-aware pausing (product calls `engine.pauseWatchRule` / `engine.resumeWatchRule` on a schedule).

### 7.3 NightCTO — Service Health Watchers

**Pattern:** Monitor service health metrics. If degraded for >15 minutes, trigger a summary notification. Use a more capable model for the summary (deep routing hint). Include recent incident evidence in the summary.

**Extracted to engine:** Watch rule evaluation with `action.payload`, evidence source integration for context-enriched decisions, `routingHint: 'deep'` passthrough to caller.

**Stays in NightCTO:** Metric fetching, incident evidence retrieval (wired as `FollowUpEvidenceSource`), the model call for the summary, the notification dispatch.

---

## 8. v1.1 Paths (Not Scope, Just Notes)

These are runtime concerns that are explicitly deferred. Notes recorded here to avoid re-investigating.

### 8.1 Persistent Rule Storage

v1 engine state is in-memory. If the process restarts, all rule registrations and reminder states are lost. Products that need persistence across restarts must either:
- Re-register rules at startup (acceptable for static rule sets)
- Implement a `ProactiveStoreAdapter` interface (planned for v1.1, following `MemoryStoreAdapter` pattern)

The `ProactiveStoreAdapter` would need to persist: follow-up rules (as JSON-serializable objects minus the condition function), watch rule lifecycle status, reminder states, and pending `bindingId` values.

Condition functions cannot be serialized. v1.1 will likely require products to supply rule definitions and the adapter stores lifecycle state separately.

### 8.2 Real Relaycron Binding

The `SchedulerBinding` interface is designed to map cleanly onto relaycron's wake-up API. The expected implementation:

```ts
class RelaycronBinding implements SchedulerBinding {
  constructor(private readonly client: RelaycronClient) {}

  async requestWakeUp(at: Date, context: WakeUpContext): Promise<string> {
    const entry = await this.client.scheduleOnce({
      at: at.toISOString(),
      payload: context,
      capability: 'proactive',
    });
    return entry.id;
  }

  async cancelWakeUp(bindingId: string): Promise<void> {
    await this.client.cancel(bindingId);
  }
}
```

This is not shipped in v1 because relaycron's scheduling API is not yet finalized. Products that need production scheduling before v1.1 can implement this binding themselves using the interface.

### 8.3 `defer` Action

v1 evaluations return `fire` or `suppress`. The `defer` action is reserved for a future where the engine can request a later re-evaluation for the same rule in the same session — e.g., "not now, but try again in 2 hours regardless of the rule's normal interval."

This requires the engine to request a wake-up internally (not wait for the next scheduled interval), which complicates the scheduling model. Deferred to v1.1 after usage patterns are clearer.
