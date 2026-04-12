# Policy Runtime Notes — `@relay-assistant/policy`

**Date:** 2026-04-12
**Status:** COMPLETE
**Feeds into:** `docs/specs/v1-policy-spec.md`, `docs/architecture/v1-policy-implementation-plan.md`

---

## 1. Purpose

This document records the runtime behavior decisions and design investigations for the v1 policy package. It answers: how does the engine interact with callers at runtime, what are the edge cases in rule evaluation and audit recording, and what patterns from existing products informed the design?

---

## 2. Runtime Dispatch Path

### 2.1 Where Policy Evaluation Lives

The policy engine is not wired into the assistant runtime directly. It is a library called by product capability handlers before executing any external action. The dispatch path is:

```
User message or proactive wake-up arrives at assistant runtime
  → runtime routes to product capability handler
  → capability handler proposes an Action (constructs Action object)
  → handler calls policyEngine.evaluate(action)
  → engine classifies risk, evaluates rules, returns PolicyDecision
  → handler checks decision.action:
      'allow'            → execute the action (e.g., runtime.emit, API call)
      'deny'             → surface denial to user; do not execute
      'require_approval' → enter product approval flow; block execution pending resolution
      'escalate'         → notify escalation target; block execution
  → audit event is recorded by the engine (always)
```

The policy package participates only in the `evaluate()` step. It has no hooks into the runtime dispatch path, no event listeners, and no background processes.

### 2.2 Why the Engine Has No Async Lifecycle

The engine is a synchronous decision library that is called from the capability handler. It does not:
- Register timers internally
- Subscribe to session or runtime events
- Maintain background state beyond in-memory rule and counter storage

This is a deliberate choice. An engine with an async lifecycle would require teardown, error handling for background failures, and coordination with the runtime shutdown sequence — none of which is needed when the engine is called-in, returns a result, and exits.

Audit recording is the one async operation in `evaluate()`, but it is awaited inline before the method returns. The caller's `await policyEngine.evaluate(action)` resolves only after the audit event is written.

---

## 3. Rule Evaluation — Edge Cases and Decisions

### 3.1 First-Match-Wins vs. Accumulation

**Question:** Should the engine collect all matching rule results and merge them, or use the first non-null result?

**Decision:** First-match-wins. The first rule (by priority, then registration order) that returns a non-null decision wins. Subsequent rules are not evaluated for that action.

**Rationale:** Accumulation requires a merge semantics that is hard to reason about. If two rules conflict — one returns `allow`, another returns `deny` — there is no obvious correct answer. First-match-wins pushes conflict resolution to rule priority, which is explicit and observable via `listRules()`.

**Implication for products:** Rules that should apply broadly (e.g., "deny all critical actions") should be registered at low priority numbers (evaluated first). Rules that are exceptions or overrides should be at even lower numbers (evaluated before the broad rule).

### 3.2 Null-Returning Rules and Fallback

**Problem:** A product registers rules for `high` and `critical` actions but leaves `medium` and `low` unhandled. What happens?

**Answer:** No rule returns a non-null decision, so the engine applies the fallback decision. The default fallback is `require_approval`. This is intentional — actions without explicit classification policy are not silently allowed.

**Production pattern:** Products should either:
1. Register a catch-all rule at low priority (e.g., priority 1000) that handles all unmatched actions
2. Configure the fallback decision explicitly at engine creation time

### 3.3 Rule Throws During Evaluation

**Problem:** A rule's `evaluate` function throws an exception (e.g., it makes an async call that fails).

**Decision:** The error propagates as a `PolicyError` wrapping the original. No audit event is recorded for that evaluation. The caller receives an unhandled error.

**Rationale:** A failed evaluation is not the same as a `deny` decision — it is an unexpected condition that the caller should handle explicitly. Silently converting errors to denials would mask bugs.

**Recommendation for products:** Wrap `policyEngine.evaluate()` in a try/catch. On `PolicyError`, log the failure and apply a safe default (e.g., deny or escalate) rather than allowing the action to proceed.

### 3.4 Async Classifiers

**Problem:** A classifier needs to make an external call (e.g., check PR branch protection rules) to determine risk level. This is async.

**Decision:** `RiskClassifier.classify` may return `Promise<RiskLevel>`. The engine awaits it before proceeding to rule evaluation.

**Latency implication:** Async classifiers add latency to every `evaluate()` call. Products should cache classification results where appropriate (e.g., per action type, per session configuration) rather than making uncached network calls per evaluation.

### 3.5 Classification Errors

**Problem:** The classifier throws or returns an invalid value (not one of `'low' | 'medium' | 'high' | 'critical'`).

**Decision:** The engine wraps the error in `ClassificationError` and throws it. Evaluation does not proceed. No audit event is recorded.

**Why not fall back to `medium`?** A classifier that throws has encountered an unexpected condition. Silently falling back to `medium` could allow high-risk actions to proceed with only auto-approve-with-audit gating. The safe behavior is to fail loudly and let the caller decide.

---

## 4. Audit Recording — Design Decisions

### 4.1 Audit is Always-On

Every `evaluate()` call records an `AuditEvent`, regardless of the decision. Products that do not need audit pass a no-op sink.

**Why not opt-in?** Opt-in audit creates risk that developers will forget to enable it in production. The cost of recording to a no-op sink is negligible; the cost of missing audit records for a production incident is high.

### 4.2 Audit Event Does Not Include Approval Resolution

The engine records the audit event at decision time. At that point, the approval resolution is not yet known — the product's approval flow may take seconds to hours.

Products update the audit record after approval resolves by passing an updated `AuditEvent` (with `approval` populated) to the sink's `record()` method. This is a product-side write, not an engine operation.

**Why not have the engine manage an "open" audit record?** This would require the engine to hold mutable state keyed by action ID, and expose a `resolveApproval(actionId, resolution)` method. This complicates the engine considerably and is unnecessary in v1 where the approval workflow is product-owned.

### 4.3 AuditEvent ID Generation

The engine generates the `AuditEvent.id` using `nanoid()`. The `Action.id` is provided by the product. These are separate IDs — the audit event is not identified by the action ID, because the same action might theoretically be re-evaluated (e.g., after a classifier is updated).

### 4.4 Audit Sink Errors

If the `AuditSink.record()` call throws, the error propagates from `evaluate()`. The `PolicyDecision` has already been computed at that point, but the error prevents it from being returned.

**Rationale:** Audit failure should be loud. If the audit backend is unavailable, the product should know — silently swallowing the error could cause compliance gaps. Products that want to tolerate audit failures should implement a resilient `AuditSink` that handles retries internally.

---

## 5. Proactive Action Patterns

### 5.1 Why Proactive is Required, Not Optional

The `proactive: boolean` field on `Action` is required. There is no `undefined` or default.

**Rationale:** If proactive were optional, a product could inadvertently omit it (i.e., send `undefined`), causing rules that check `context.proactive === true` to silently never fire for proactive actions. Making the field required forces the product to be explicit at action construction time.

### 5.2 The Proactive-Default-Stricter Pattern

The most common proactive policy pattern is: apply the standard rules for interactive actions, but add a stricter gate for proactive ones. This is implemented as a high-priority rule that checks `context.proactive`:

```ts
// Priority 1: stricter gate for proactive high-risk actions
policyEngine.registerRule({
  id: 'proactive-high-approval',
  priority: 1,
  evaluate(action, riskLevel, context) {
    if (context.proactive && riskLevel === 'high') {
      return { action: 'require_approval', ruleId: 'proactive-high-approval', riskLevel };
    }
    return null; // fall through to interactive rules at priority 100+
  },
});

// Priority 100: standard interactive rule for high-risk (may allow or require approval)
policyEngine.registerRule({
  id: 'high-risk-gate',
  priority: 100,
  evaluate(action, riskLevel) {
    if (riskLevel === 'high') {
      return { action: 'allow', ruleId: 'high-risk-gate', riskLevel };
    }
    return null;
  },
});
```

With this setup:
- Proactive high-risk → `require_approval` (priority-1 rule matches first)
- Interactive high-risk → `allow` (priority-1 rule returns null; priority-100 rule matches)

### 5.3 Connecting to the Proactive Package

The policy package does not import `@relay-assistant/proactive`. The connection is made by the product in its capability handler:

```ts
// Product capability handler (not in either package):
const followUpDecisions = await proactiveEngine.evaluateFollowUp(ctx);

for (const decision of followUpDecisions) {
  if (decision.action !== 'fire') continue;

  const policyDecision = await policyEngine.evaluate({
    id: nanoid(),
    type: 'proactive_follow_up',
    description: decision.messageTemplate ?? 'Proactive follow-up',
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    proactive: true,
  });

  if (policyDecision.action === 'allow') {
    await runtime.emit({ sessionId: ctx.sessionId, text: decision.messageTemplate });
  }
}
```

This explicit wiring in product code is intentional. Neither package should depend on the other.

---

## 6. Patterns from Existing Products

### 6.1 Sage: Knowledge-Action Approval

**Pattern observed:** Before updating a workspace document (a high-consequence action), Sage requests explicit user confirmation with a summary of what will change.

**Policy extraction:** This maps directly to `require_approval` with an `ApprovalHint.prompt` describing the change. The classifier assigns `high` to document-update action types. A rule at priority 10 gates `high` actions on interactive sessions.

**What stays in Sage:** The document-update action type definition, the change summary generation logic, and the approval UX (a confirmation message rendered in the Sage chat surface).

### 6.2 MSD: PR Merge and Destructive Action Safeguards

**Pattern observed:** MSD prevents merging PRs to protected branches without a second confirmation when the PR touches more than N files. It also gates "close PR" actions differently than "merge PR" — close is medium-risk, merge is high-risk.

**Policy extraction:** The risk level hierarchy (`low | medium | high | critical`) and the pattern of classifying action types by consequence. The async classifier pattern (classifier fetches PR metadata to determine risk) originates here.

**What stays in MSD:** The PR metadata fetch logic, the file-count threshold for risk escalation, and the branch protection rule definitions. The policy package provides the evaluation framework; MSD supplies the classifier and rules.

### 6.3 NightCTO: Client Communication Governance

**Pattern observed:** Before sending a client-facing message (e.g., a status update to a stakeholder), NightCTO requires either an explicit send command or a timed auto-send after a review window. Sending to a public channel is treated more strictly than sending to a private thread.

**Policy extraction:** The `escalate` decision (when no approver is available and the action should be routed to a higher authority), and the surface-context-in-metadata pattern (the originating surface — public vs. private channel — is passed as `action.metadata.channelType` and used by rules to differentiate).

**What stays in NightCTO:** The channel-type detection logic, the approval notification flow (sends a review-request message to a designated approver channel), and the auto-send timer. The policy package provides the decision contract; NightCTO implements the approval UX.

---

## 7. What the v1 Engine Explicitly Does Not Do

These are decisions made to keep the engine small and testable. Each is a potential v1.1 or v2 addition.

**No scheduler binding.** Time-based auto-escalation (escalate after approval timeout) requires a scheduler binding. This is deferred to v1.1 when the proactive and policy packages can be coordinated.

**No approval state machine.** The engine does not track which actions are awaiting approval, whether timeouts have elapsed, or whether an approver has responded. This is all product code in v1.

**No cross-rule communication.** Rules are evaluated independently. One rule cannot inspect what another rule would decide. If rules need shared context, products pass it through `action.metadata` or `context.metadata`.

**No history access in rules.** Rules cannot query past decisions for the same session or user. Cumulative risk budget enforcement (e.g., deny an action type after 3 approvals in one session) is deferred to v1.1.

**No rule composition utilities.** The package does not ship helper functions for building common rule patterns (e.g., `riskGateRule('high', 'require_approval')`). These are easy to write inline and premature abstraction at v1 scope.

---

## 8. Open Questions for v1.1

1. **Persistent rule storage adapter:** What is the right interface for persisting and loading rules from a database or config store? Should the engine accept an async `loadRules()` at startup, or should products hydrate the engine from their own persistence before each use?

2. **Approval workflow binding:** Should v1.1 introduce an `ApprovalBinding` interface analogous to `SchedulerBinding` in the proactive package, or should approval workflow remain fully product-owned?

3. **Session-scoped risk budget:** How should the engine accumulate and enforce risk budgets (e.g., max 3 high-risk actions per session)? Requires action history storage per session ID.

4. **Rule reload without restart:** Should the engine support hot-reloading rules (add/remove without recreating the engine instance)? Rule management methods already support this in v1 — the question is whether to add events or callbacks when the rule set changes.

5. **Escalation target binding:** `escalate` currently means "the caller handles this." A future `EscalationSink` interface (similar to `AuditSink`) could standardize escalation routing in the engine.
