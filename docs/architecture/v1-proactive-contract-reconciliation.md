# v1 Proactive Contract Reconciliation

**Status:** RECONCILED
**Date:** 2026-04-12
**Inputs:** v1-proactive-review-verdict.md (7 follow-ups)
**Purpose:** Lock down one unambiguous implementation contract for `@relay-assistant/proactive` v0.1.0

This document resolves every contradiction identified in the review verdict. Each decision is final for v1 implementation. Where docs disagree, the simpler and better-bounded choice wins.

---

## Decision 1: No `defer` in v1

**Contradiction:** The spec defines `action: 'fire' | 'suppress' | 'defer'` in the `FollowUpDecision` type, but the implementation plan and runtime notes say v1 returns only `fire | suppress`.

**Decision:** v1 ships `FollowUpAction = 'fire' | 'suppress'` only. `defer` does not appear in any v1 type.

**Rationale:** `defer` requires retry/backoff logic that is not designed. Including it in the union invites callers to handle a case the engine never produces.

**Implementation contract:**
```ts
export type FollowUpAction = 'fire' | 'suppress';
```
No `defer` in `FollowUpDecision.action`. No `defer` case in suppression logic. The word `defer` may appear in a code comment noting it is reserved for v1.1.

---

## Decision 2: `suppressWhenActive` uses simple timestamp comparison

**Contradiction:** Suppression logic says `lastActivityAt > scheduledAt` (simple comparison). The `ReminderPolicy` JSDoc says "Recent is defined as within the last 5 minutes relative to scheduledAt."

**Decision:** The check is `new Date(lastActivityAt) > new Date(scheduledAt)`. No 5-minute window. No configurable threshold.

**Rationale:** The 5-minute window adds a magic number with no clear product motivation. The simple comparison answers the precise question: "did the user engage after we decided to follow up?" That is sufficient for v1.

**Implementation contract:**
```ts
// In suppression logic, when policy.suppressWhenActive is true:
if (new Date(context.lastActivityAt) > new Date(context.scheduledAt)) {
  return { suppressed: true, reason: 'user_active' };
}
```

The `ReminderPolicy.suppressWhenActive` JSDoc must read:
```ts
/**
 * If true, suppress when the user's last activity is after the wake-up's scheduledAt.
 * Default: true.
 */
suppressWhenActive?: boolean;
```

---

## Decision 3: Evidence is fetched once per `evaluateFollowUp` call

**Contradiction:** The spec says "fetches evidence before calling each rule's condition function" (reads as per-rule). The runtime notes and implementation plan say one fetch per `evaluateFollowUp` call shared across all rules.

**Decision:** One fetch per `evaluateFollowUp()` call. All rules in that evaluation receive the same evidence array.

**Rationale:** Per-rule fetching multiplies calls to the evidence source with no benefit, since all rules evaluate the same session. Batching is simpler and cheaper.

**Implementation contract:**
```
evaluateFollowUp(context):
  evidence = context.evidence                          // caller pre-fetched
    ?? (evidenceSource ? await evidenceSource.getRecentEntries(context.sessionId) : [])
  // 'evidence' is now fixed for this entire evaluation pass
  for each rule:
    ... rule.condition(context, evidence) ...
```

The evidence source is called at most once. If `context.evidence` is provided, the source is not called at all.

---

## Decision 4: The method is `removeFollowUpRule`

**Contradiction:** The interface definition uses `removeFollowUpRule(ruleId)`. A prose paragraph references `cancelFollowUpRule(ruleId)`.

**Decision:** The canonical name is `removeFollowUpRule`. `cancelFollowUpRule` does not exist.

**Rationale:** `remove` is consistent with the registration model (register/remove). `cancel` is reserved for watch rules, which have a distinct paused/cancelled lifecycle.

**Implementation contract:**
```ts
interface ProactiveEngine {
  removeFollowUpRule(ruleId: string): void; // throws RuleNotFoundError
}
```

Calling `removeFollowUpRule` also clears all reminder state for that `ruleId` across all sessions.

---

## Decision 5: Watch lifecycle includes `resume`; scheduling responsibility is explicit

**Contradiction:** The scope doc lists `pause`, `cancel`, `list` only. The spec and plan add `resumeWatchRule`. Initial scheduling ownership is unclear across docs.

**Decision:** v1 watch lifecycle methods are: `registerWatchRule`, `pauseWatchRule`, `resumeWatchRule`, `cancelWatchRule`, `listWatchRules`, `evaluateWatchRules`.

**Scheduling responsibility split:**

| Event | Who schedules | How |
|---|---|---|
| First wake-up after `registerWatchRule` | **The engine**, inside `registerWatchRule` | Calls `schedulerBinding.requestWakeUp(now + intervalMs, ...)` |
| Next wake-up after `evaluateWatchRules` | **The engine**, inside `evaluateWatchRules` | Cancels previous binding, requests new one at `now + intervalMs` |
| Wake-up after `resumeWatchRule` | **The engine**, inside `resumeWatchRule` | Calls `schedulerBinding.requestWakeUp(now + intervalMs, ...)` |
| Initial follow-up wake-up | **The product** | Product calls `schedulerBinding.requestWakeUp` directly or uses its own scheduling logic |
| Subsequent follow-up wake-ups | **The product** | Product decides whether to re-schedule after receiving a `fire` or `suppress` decision |

**Key principle:** The engine owns watch-rule scheduling because watch rules have a defined `intervalMs` and the engine manages their lifecycle. The engine does **not** own follow-up scheduling because follow-up timing is product-determined (session inactivity thresholds, business hours, etc.).

**Rationale:** `resume` is needed because `pause` without `resume` forces re-registration, which loses reminder-like state. Explicit scheduling ownership eliminates the ambiguity flagged in the review.

---

## Decision 6: Watch evaluation is per-rule, not evaluate-all

**Contradiction:** The scope doc says `evaluateWatchRules` evaluates all active rules. The wake-up context carries a specific `ruleId`. Evaluating all rules on every single-rule wake-up is wasteful.

**Decision:** `evaluateWatchRules(context)` evaluates **only the rule identified by `context.ruleId`**. If `context.ruleId` is not provided, it evaluates all active rules (batch mode for generic periodic ticks).

**Rationale:** Wake-ups are per-rule (each rule has its own interval and binding). Evaluating all rules on a single rule's wake-up fires conditions at incorrect intervals and re-schedules rules that shouldn't be touched.

**Implementation contract:**
```ts
evaluateWatchRules(context: WatchEvaluationContext): Promise<WatchTrigger[]>

// Behavior:
// - If context.ruleId is set: evaluate only that rule. Re-schedule only that rule.
// - If context.ruleId is undefined: evaluate all active rules. Re-schedule all active rules.
// - Paused and cancelled rules are always skipped.
// - Throws RuleNotFoundError if context.ruleId is set but not found or is cancelled.
```

**`WatchEvaluationContext.ruleId` changes from optional to required in practice** but remains typed as `string` (not optional) in the interface. Products always pass it from the wake-up payload. The evaluate-all fallback exists for testing convenience only.

Wait -- re-reading the type definition: `ruleId` is already `string` (required) in `WatchEvaluationContext`. That is correct. The engine evaluates only that rule. For batch evaluation in tests, products can call `evaluateWatchRules` in a loop over `listWatchRules()`.

**Revised implementation contract:**
```ts
// WatchEvaluationContext.ruleId is required (string, not optional)
// evaluateWatchRules always evaluates exactly the rule identified by context.ruleId
// Re-schedules only that rule
// Throws RuleNotFoundError if ruleId not found or cancelled
```

---

## Decision 7: Remove unsupported v1 claims

**Contradiction:** The scope doc says "the proactive engine detects [session end]" but the engine has no event subscriptions or async lifecycle. The README says "the engine handles scheduling" which overstates the engine's role for follow-ups.

**Decisions:**

### 7a: No session-end detection

The engine does not detect session end. It has no event subscriptions. Products call `resetReminderState(sessionId)` when a session closes. The sentence in the scope doc ("When a session ends and the proactive engine detects it") must be revised to: "When a session ends, the product calls `engine.resetReminderState(sessionId)` to clear reminder state."

### 7b: "Engine handles scheduling" must be scoped

The README statement "The engine handles scheduling" is only true for watch-rule re-scheduling. For follow-ups, the product owns all scheduling. The README must say: "The engine handles watch-rule re-scheduling via `SchedulerBinding`. Follow-up scheduling is product-owned."

**Implementation contract:** These are doc fixes only. No code impact. The engine implementation must not include any event listener registration, timer creation, or session-state polling.

---

## Consolidated v1 Public API

For implementor reference, the reconciled public API:

```ts
// Factory
createProactiveEngine(config: ProactiveEngineConfig): ProactiveEngine

// ProactiveEngine interface
interface ProactiveEngine {
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

// Key types
type FollowUpAction = 'fire' | 'suppress';  // no 'defer' in v1
type SuppressionReason = 'user_active' | 'cooldown' | 'max_reminders';
type RoutingHint = 'cheap' | 'fast' | 'deep';
```

---

## Checklist for Implementor

Before writing code, confirm these constraints are met:

- [ ] `FollowUpAction` is `'fire' | 'suppress'` — no `defer`
- [ ] `suppressWhenActive` compares `lastActivityAt > scheduledAt` — no 5-minute window
- [ ] Evidence is fetched once per `evaluateFollowUp` call, not per rule
- [ ] Follow-up removal method is `removeFollowUpRule` — no `cancelFollowUpRule`
- [ ] `removeFollowUpRule` clears reminder state for that ruleId
- [ ] `registerWatchRule` schedules the first wake-up via `schedulerBinding`
- [ ] `resumeWatchRule` schedules a wake-up via `schedulerBinding`
- [ ] `evaluateWatchRules` evaluates only `context.ruleId`, not all rules
- [ ] `evaluateWatchRules` re-schedules only the evaluated rule
- [ ] Engine has no event listeners, timers, or async lifecycle
- [ ] Follow-up scheduling is entirely product-owned
- [ ] Watch-rule scheduling (initial, re-schedule, resume) is engine-owned

---

V1_PROACTIVE_CONTRACT_RECONCILED
