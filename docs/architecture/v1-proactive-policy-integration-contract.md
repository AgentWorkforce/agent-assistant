# v1 Proactive ↔ Policy Integration Contract

**Status:** DEFINED
**Date:** 2026-04-12
**Inputs:**
- `docs/architecture/v1-proactive-contract-reconciliation.md`
- `docs/architecture/v1-policy-contract-reconciliation.md`
- `docs/architecture/v1-proactive-package-review-verdict.md`
- `docs/architecture/v1-policy-package-review-verdict.md`
- `packages/proactive/src/types.ts` (runtime types)
- `packages/policy/src/types.ts` (runtime types)
- `packages/proactive/README.md`
- `packages/policy/README.md`

**Purpose:** Define the clean runtime boundary between `@relay-assistant/proactive` and `@relay-assistant/policy` — how proactive decisions become policy-evaluated actions, what data crosses the boundary, and what stays product-owned.

---

## 1. Boundary Principle

The two packages have **no runtime dependency on each other**. Neither imports the other. All integration happens in product code through a thin orchestration layer that:

1. Receives a proactive `FollowUpDecision` (action: `'fire'`) or `WatchTrigger` from the proactive engine
2. Constructs a policy `Action` from the proactive output
3. Passes that `Action` to the policy engine's `evaluate()`
4. Acts on the policy `EvaluationResult`

This is the only integration path. There is no callback, event bus, or shared state between the two packages.

```
┌──────────────┐         ┌──────────────────┐         ┌──────────────┐
│   proactive   │  fire   │   product glue    │  Action │    policy     │
│   engine      │────────▶│   (orchestrator)  │────────▶│    engine     │
│               │         │                   │◀────────│              │
│  FollowUp     │         │  constructs       │  Result │  evaluates   │
│  Decision /   │         │  Action from      │         │  & audits    │
│  WatchTrigger │         │  proactive output │         │              │
└──────────────┘         └──────────────────┘         └──────────────┘
```

---

## 2. Data Flow: Proactive → Policy

### 2.1 Follow-Up Decision → Policy Action

When `evaluateFollowUp()` returns a `FollowUpDecision` with `action: 'fire'`, the product constructs a policy `Action`:

```ts
import type { FollowUpDecision } from '@relay-assistant/proactive';
import type { Action } from '@relay-assistant/policy';

function followUpToAction(
  decision: FollowUpDecision,
  userId: string,
): Action {
  return {
    id: generateId(),                    // product-generated, unique per action attempt
    type: 'proactive_follow_up',         // product-defined action type
    description: decision.messageTemplate
      ?? `Proactive follow-up from rule ${decision.ruleId}`,
    sessionId: decision.sessionId,
    userId,                              // resolved by product from session store
    proactive: true,                     // REQUIRED — this is a proactive action
    metadata: {
      sourceRuleId: decision.ruleId,     // traceability back to proactive rule
      routingHint: decision.routingHint, // passed through for downstream routing
    },
  };
}
```

**Field mapping:**

| Proactive output | Policy Action field | Notes |
|---|---|---|
| `decision.sessionId` | `action.sessionId` | Direct pass-through |
| `decision.ruleId` | `action.metadata.sourceRuleId` | Traceability; not a first-class policy field |
| `decision.routingHint` | `action.metadata.routingHint` | Policy does not interpret this; product reads it post-evaluation |
| `decision.messageTemplate` | `action.description` | Used as human-readable description for audit |
| *(product-resolved)* | `action.userId` | Product looks up session → user mapping |
| *(literal `true`)* | `action.proactive` | Always `true` for proactive-originated actions |
| *(product-generated)* | `action.id` | Unique per evaluation attempt, not per rule |

### 2.2 Watch Trigger → Policy Action

When `evaluateWatchRules()` returns a `WatchTrigger`, the product constructs a policy `Action` similarly:

```ts
import type { WatchTrigger } from '@relay-assistant/proactive';
import type { Action } from '@relay-assistant/policy';

function watchTriggerToAction(
  trigger: WatchTrigger,
  sessionId: string,
  userId: string,
): Action {
  return {
    id: generateId(),
    type: `proactive_watch_${trigger.action.type}`,  // product convention
    description: `Watch rule ${trigger.ruleId} triggered: ${trigger.action.type}`,
    sessionId,                                        // product-resolved; watch triggers may be cross-session
    userId,
    proactive: true,
    metadata: {
      sourceRuleId: trigger.ruleId,
      watchAction: trigger.action,                    // full action descriptor for downstream handling
      triggeredAt: trigger.triggeredAt,
    },
  };
}
```

**Key difference from follow-ups:** Watch triggers carry a `WatchAction` (type + payload) that describes what the product should do. The policy engine does not interpret `WatchAction` — it evaluates the constructed `Action` against rules. The product reads `metadata.watchAction` after policy allows the action.

---

## 3. Policy Evaluation and Outcome Flow

### 3.1 The Orchestration Sequence

```ts
// Product-owned proactive capability handler (pseudocode)
async function handleProactiveWakeUp(wakeUpContext, sessionStore, proactiveEngine, policyEngine) {
  const session = await sessionStore.get(wakeUpContext.sessionId);

  // Step 1: Proactive evaluation
  const decisions = await proactiveEngine.evaluateFollowUp({
    sessionId: wakeUpContext.sessionId,
    scheduledAt: wakeUpContext.scheduledAt,
    lastActivityAt: session.lastActivityAt,
  });

  for (const decision of decisions) {
    if (decision.action !== 'fire') continue;

    // Step 2: Construct policy Action
    const action = followUpToAction(decision, session.userId);

    // Step 3: Policy evaluation
    const { decision: policyDecision, auditEventId } = await policyEngine.evaluate(action);

    // Step 4: Act on policy outcome
    switch (policyDecision.action) {
      case 'allow':
        await executeFollowUp(decision, session);
        break;

      case 'require_approval':
        await enterApprovalFlow(decision, policyDecision, auditEventId, session);
        break;

      case 'deny':
        // Log and drop — proactive actions that are denied are silently suppressed
        break;

      case 'escalate':
        await routeToEscalation(decision, policyDecision, session);
        break;
    }
  }
}
```

### 3.2 Outcome Semantics for Proactive Actions

| Policy decision | Proactive follow-up behavior | Proactive watch behavior |
|---|---|---|
| `allow` | Execute the follow-up (send message, invoke model, etc.) | Execute the watch action |
| `deny` | Silently suppress. Do **not** re-schedule. Do **not** count as a reminder for cooldown/maxReminders purposes. | Silently suppress the action. Watch rule continues to re-schedule normally — only this trigger is denied. |
| `require_approval` | Enter approval flow. Block execution until resolved. Product decides whether to count the pending approval against reminder state. | Enter approval flow. Watch rule re-schedules independently — the next evaluation is not blocked by a pending approval. |
| `escalate` | Route to escalation target. Execution is blocked. Treat like `deny` for reminder-state purposes. | Route to escalation target. Watch rule re-schedules normally. |

**Critical invariant:** Policy outcomes do **not** flow back into the proactive engine. The proactive engine's reminder state (cooldown, maxReminders) is managed by the product based on whether the follow-up was actually delivered, not based on the policy decision. This keeps the two engines decoupled.

### 3.3 Denied Follow-Ups and Reminder State

When policy denies a proactive follow-up:

- The product should **not** call any proactive engine method to record the denial.
- The reminder counter should **not** be incremented (the user never saw the message).
- The product may choose to re-schedule a retry or simply drop the follow-up.
- If the product wants to track policy-denied proactive actions, it reads the audit sink — the policy engine already recorded the denial.

This is product-owned logic. The proactive engine has no awareness of policy outcomes.

---

## 4. Audit Correlation

### 4.1 Single Audit Trail via Policy

Every proactive action that reaches the policy engine is audited by the policy engine's `AuditSink`. The `AuditEvent` contains:

```ts
{
  id: string;                    // audit event ID
  action: {
    id: string;
    type: 'proactive_follow_up'; // or 'proactive_watch_*'
    proactive: true;
    metadata: {
      sourceRuleId: string;      // links back to proactive rule
      routingHint?: string;
    },
    // ... other Action fields
  };
  riskLevel: RiskLevel;
  decision: PolicyDecision;
  evaluatedAt: string;
  approval?: ApprovalResolution; // populated if recordApproval() is called
}
```

**Traceability chain:** `AuditEvent.action.metadata.sourceRuleId` → proactive rule ID. This is sufficient to correlate a policy audit record back to the proactive rule that originated the action.

### 4.2 Approval Correlation for Proactive Actions

When a proactive action receives `require_approval`:

1. The product stores `auditEventId` from the `EvaluationResult`.
2. The product runs its approval flow (surface to user, wait for response).
3. On resolution, the product calls `policyEngine.recordApproval(auditEventId, resolution)`.
4. If approved, the product then executes the proactive action.

```ts
async function enterApprovalFlow(followUpDecision, policyDecision, auditEventId, session) {
  // Surface approval prompt to user
  const resolution = await presentApproval(policyDecision.approvalHint, session);

  // Record resolution in policy audit trail
  await policyEngine.recordApproval(auditEventId, {
    approved: resolution.approved,
    approvedBy: resolution.approvedBy,
    resolvedAt: new Date().toISOString(),
  });

  // If approved, execute the follow-up
  if (resolution.approved) {
    await executeFollowUp(followUpDecision, session);
  }
}
```

### 4.3 What the Proactive Engine Does Not Audit

The proactive engine has no audit sink. It emits `FollowUpDecision` and `WatchTrigger` objects but does not record them to any persistent store. Products wanting a complete proactive audit trail should:

1. Log proactive decisions (fire/suppress) in their own observability layer.
2. Rely on the policy engine's audit trail for all actions that reached policy evaluation.

This is intentional. Adding an audit sink to the proactive engine would duplicate the policy audit trail for all `fire` decisions and create a consistency problem. Proactive suppression logging is a product concern — different products may want different granularity.

---

## 5. Ownership Matrix

### 5.1 Package-Owned Responsibilities

| Responsibility | Owner | Rationale |
|---|---|---|
| Follow-up rule evaluation, suppression, reminder state | `@relay-assistant/proactive` | Core proactive domain |
| Watch rule lifecycle, condition evaluation, re-scheduling | `@relay-assistant/proactive` | Core proactive domain |
| Risk classification of actions | `@relay-assistant/policy` | Core policy domain |
| Policy rule evaluation, decision rendering | `@relay-assistant/policy` | Core policy domain |
| Audit event recording for policy decisions | `@relay-assistant/policy` | Audit is a policy concern |
| Approval correlation (`recordApproval`) | `@relay-assistant/policy` | Approval is a policy concern |

### 5.2 Product-Owned Responsibilities

| Responsibility | Why product-owned |
|---|---|
| Constructing `Action` from `FollowUpDecision` / `WatchTrigger` | Requires session/user context only products have |
| Calling `policyEngine.evaluate()` after proactive `fire` | Orchestration is integration glue, not domain logic |
| Deciding whether to policy-gate proactive actions at all | Some products may skip policy for low-risk proactive actions |
| Mapping policy outcomes to proactive behavior (execute, drop, approval flow) | Product-specific UX and business rules |
| Managing reminder state based on policy outcomes | Products decide what counts as "delivered" |
| Follow-up scheduling (initial and subsequent) | Proactive reconciliation Decision 5: product-owned |
| Defining `RiskClassifier` behavior for proactive action types | Product determines risk semantics |
| Registering policy rules that handle `action.proactive === true` | Product defines proactive gating rules |
| Proactive suppression observability/logging | Different products want different granularity |

### 5.3 Not Owned by Either Package

| Concern | Where it lives |
|---|---|
| Approval UX and workflow | Product surfaces layer |
| Escalation routing and notification | Product coordination layer |
| Persistent audit storage | Infrastructure (audit sink implementation) |
| Cross-agent proactive rate limiting | Deferred (§6) |

---

## 6. Explicitly Deferred from v1

### 6.1 No Direct Package-to-Package Integration

v1 does not provide:
- A shared type or adapter that bridges `FollowUpDecision` → `Action`
- A combined engine that chains proactive + policy evaluation in one call
- Any import from `@relay-assistant/proactive` in `@relay-assistant/policy` or vice versa

**Why:** Premature coupling. Products vary in whether they policy-gate all proactive actions, some proactive actions, or none. A package-level bridge would impose one integration pattern on all products.

### 6.2 No Proactive-Aware Policy Rules in the Package

v1 does not ship policy rules that are aware of proactive semantics (e.g., "auto-deny all proactive actions above medium risk"). Products define these rules themselves:

```ts
// Product-defined rule — NOT shipped in @relay-assistant/policy
policyEngine.registerRule({
  id: 'gate-proactive-high',
  priority: 5,
  evaluate(action, riskLevel, context) {
    if (context.proactive && (riskLevel === 'high' || riskLevel === 'critical')) {
      return {
        action: 'require_approval',
        ruleId: 'gate-proactive-high',
        riskLevel,
        reason: 'High-risk proactive actions require approval.',
        approvalHint: { approver: 'user', prompt: action.description },
      };
    }
    return null;
  },
});
```

**Why:** Gating semantics are product-specific. Shipping default proactive rules in the policy package would create an opinion about proactive risk that doesn't belong in a generic policy engine.

### 6.3 No Cross-Engine State Sharing

The proactive engine does not read policy audit events. The policy engine does not read proactive reminder state. There is no shared state store, event bus, or callback mechanism between them.

**Why:** State coupling between engines would make both harder to test independently and would require a shared persistence layer that doesn't exist in v1.

### 6.4 No Proactive Action Rate Limiting in Policy

v1 policy does not enforce rate limits on proactive actions (e.g., "max 5 proactive actions per session per hour"). Rate limiting for proactive behavior is handled by the proactive engine's own `maxReminders` and `cooldownMs` mechanisms. Policy-level rate limiting across action types is a v2 concern.

### 6.5 No Automatic Retry After Policy Denial

When policy denies a proactive action, neither package automatically retries. The product decides retry behavior. A future version may support a `retry_after` field in `PolicyDecision`, but v1 does not.

### 6.6 No Combined Test Harness

v1 does not ship a shared test utility for proactive + policy integration tests. Products write integration tests using the existing test adapters from each package independently:

```ts
import { createProactiveEngine, InMemorySchedulerBinding } from '@relay-assistant/proactive';
import { createActionPolicy, InMemoryAuditSink } from '@relay-assistant/policy';

// Both engines are instantiated independently in tests
// Product test code wires the orchestration between them
```

---

## 7. Integration Test Proof Pattern

Products should write integration tests that prove the boundary works. The pattern:

```ts
import { describe, it, expect } from 'vitest';
import { createProactiveEngine, InMemorySchedulerBinding } from '@relay-assistant/proactive';
import type { FollowUpRule } from '@relay-assistant/proactive';
import { createActionPolicy, InMemoryAuditSink } from '@relay-assistant/policy';
import type { Action, PolicyRule } from '@relay-assistant/policy';

describe('proactive → policy integration', () => {
  it('policy-denied follow-up is not executed', async () => {
    // Setup proactive engine
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });

    const rule: FollowUpRule = {
      id: 'test-rule',
      condition: () => true,
      routingHint: 'cheap',
      messageTemplate: 'Test follow-up',
    };
    proactive.registerFollowUpRule(rule);

    // Setup policy engine with a deny-all-proactive rule
    const auditSink = new InMemoryAuditSink();
    const policy = createActionPolicy({ auditSink });

    const denyProactive: PolicyRule = {
      id: 'deny-proactive',
      priority: 1,
      evaluate(action, riskLevel, context) {
        if (context.proactive) {
          return { action: 'deny', ruleId: 'deny-proactive', riskLevel, reason: 'Denied' };
        }
        return null;
      },
    };
    policy.registerRule(denyProactive);

    // Evaluate proactive
    const decisions = await proactive.evaluateFollowUp({
      sessionId: 'sess-1',
      scheduledAt: '2026-04-12T10:00:00Z',
      lastActivityAt: '2026-04-12T09:00:00Z',
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('fire');

    // Construct policy action from proactive decision
    const action: Action = {
      id: 'act-1',
      type: 'proactive_follow_up',
      description: decisions[0].messageTemplate!,
      sessionId: decisions[0].sessionId,
      userId: 'user-1',
      proactive: true,
      metadata: { sourceRuleId: decisions[0].ruleId },
    };

    // Policy evaluation
    const { decision } = await policy.evaluate(action);
    expect(decision.action).toBe('deny');

    // Verify audit trail records the proactive action
    expect(auditSink.events).toHaveLength(1);
    expect(auditSink.events[0].action.proactive).toBe(true);
    expect(auditSink.events[0].action.metadata?.sourceRuleId).toBe('test-rule');
  });

  it('policy-approved follow-up records approval in audit trail', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });

    proactive.registerFollowUpRule({
      id: 'approval-rule',
      condition: () => true,
      messageTemplate: 'Needs approval',
    });

    const auditSink = new InMemoryAuditSink();
    const policy = createActionPolicy({ auditSink });

    policy.registerRule({
      id: 'require-approval-proactive',
      priority: 1,
      evaluate(action, riskLevel, context) {
        if (context.proactive) {
          return {
            action: 'require_approval',
            ruleId: 'require-approval-proactive',
            riskLevel,
            approvalHint: { approver: 'user', prompt: action.description },
          };
        }
        return null;
      },
    });

    const [decision] = await proactive.evaluateFollowUp({
      sessionId: 'sess-2',
      scheduledAt: '2026-04-12T10:00:00Z',
      lastActivityAt: '2026-04-12T09:00:00Z',
    });

    const action: Action = {
      id: 'act-2',
      type: 'proactive_follow_up',
      description: decision.messageTemplate!,
      sessionId: decision.sessionId,
      userId: 'user-2',
      proactive: true,
      metadata: { sourceRuleId: decision.ruleId },
    };

    const { decision: policyDecision, auditEventId } = await policy.evaluate(action);
    expect(policyDecision.action).toBe('require_approval');

    // Record approval
    await policy.recordApproval(auditEventId, {
      approved: true,
      approvedBy: 'user-2',
      resolvedAt: '2026-04-12T10:05:00Z',
    });

    // Verify approval is in audit trail
    expect(auditSink.events).toHaveLength(2); // evaluation + approval
    expect(auditSink.events[1].approval?.approved).toBe(true);
  });
});
```

These tests use only the public APIs of both packages with no mocking of internals. They prove the integration boundary works without coupling the packages.

---

## 8. Summary

The proactive-policy runtime boundary in v1 is **product-mediated, not package-coupled**:

- **Proactive engine** decides *whether* to act (fire vs. suppress).
- **Policy engine** decides *whether it's allowed* to act (allow, deny, require_approval, escalate).
- **Product code** is the glue: it translates proactive outputs into policy inputs, acts on policy outcomes, and manages the state consequences of those outcomes.
- **Audit** lives in the policy engine. Proactive traceability is achieved through `Action.metadata.sourceRuleId`.
- **Neither package imports the other.** No shared types, no shared state, no shared lifecycle.

This boundary is intentionally strict. Loosening it (e.g., a convenience adapter, a combined engine, shared state) is a v1.1+ decision that should be informed by real product integration experience.

---

V1_PROACTIVE_POLICY_INTEGRATION_CONTRACT_READY
