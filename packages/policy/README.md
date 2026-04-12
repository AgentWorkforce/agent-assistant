# `@relay-assistant/policy`

**Status:** IMPLEMENTED
**Version:** 0.1.0 (pre-1.0, provisional)
**Spec:** `docs/specs/v1-policy-spec.md`
**Implementation plan:** `docs/architecture/v1-policy-implementation-plan.md`

---

## What This Package Does

`@relay-assistant/policy` is the classification, gating, and audit layer for assistant actions — the boundary between "the assistant decided to act" and "the action actually executes."

It provides:

- **PolicyEngine** — evaluates actions against registered policy rules, applies risk classification, and returns structured decisions (`allow`, `deny`, `require_approval`, `escalate`)
- **Risk classification** — `RiskClassifier` interface with a pluggable classify function; `defaultRiskClassifier` returns `medium` for all unclassified actions
- **Policy rule registration** — products register `PolicyRule` objects with priority ordering; evaluation is first-match-wins
- **Approval contract** — `ApprovalHint` on `require_approval` decisions; `ApprovalResolution` for recording outcomes after approval flows complete
- **Audit hooks** — `AuditSink` interface called on every `evaluate()` call; every decision is recorded regardless of outcome
- **InMemoryAuditSink** — test adapter with an accessible `events` array; no external infrastructure required
- **Proactive action flag** — `Action.proactive` is a required field; rules may apply stricter gating to proactive actions
- **Fallback decision** — configurable per engine instance; defaults to `require_approval` (default-block posture: unclassified/unmatched actions are gated behind approval rather than silently allowed or denied)

This package does **not** own approval UX, approval workflows, scheduling, notification flows, session lifecycle, message delivery, persistent rule storage, or product-specific action catalogs. All of that stays in product code or other packages.

---

## Installation

```sh
npm install @relay-assistant/policy
```

No `@relay-assistant/*` runtime dependencies. Only `nanoid` is required at runtime.

---

## Quick Start

```ts
import { createActionPolicy, InMemoryAuditSink } from '@relay-assistant/policy';
import type { PolicyRule, RiskClassifier } from '@relay-assistant/policy';

const auditSink = new InMemoryAuditSink();

// Supply a product-specific classifier
const classifier: RiskClassifier = {
  classify(action) {
    switch (action.type) {
      case 'send_email': return 'high';
      case 'create_draft': return 'medium';
      case 'read_inbox': return 'low';
      default: return 'medium';
    }
  },
};

const policyEngine = createActionPolicy({ classifier, auditSink });

// Register rules
policyEngine.registerRule({
  id: 'deny-critical',
  priority: 1,
  description: 'Deny all critical-risk actions in v1',
  evaluate(action, riskLevel) {
    if (riskLevel === 'critical') {
      return {
        action: 'deny',
        ruleId: 'deny-critical',
        riskLevel,
        reason: 'Critical actions are not permitted.',
      };
    }
    return null; // defer to next rule
  },
});

policyEngine.registerRule({
  id: 'require-approval-high',
  priority: 10,
  description: 'Require human approval for high-risk actions',
  evaluate(action, riskLevel) {
    if (riskLevel === 'high') {
      return {
        action: 'require_approval',
        ruleId: 'require-approval-high',
        riskLevel,
        reason: 'High-risk actions require explicit human approval.',
        approvalHint: {
          approver: 'user',
          prompt: `The assistant is about to: ${action.description}. Approve?`,
        },
      };
    }
    return null;
  },
});

// Evaluate an action before executing it
const action = {
  id: 'act-001',
  type: 'send_email',
  description: 'Send follow-up to stakeholders',
  sessionId: 'sess-abc',
  userId: 'user-xyz',
  proactive: false,
};

// evaluate() returns EvaluationResult: { decision, auditEventId }
const { decision, auditEventId } = await policyEngine.evaluate(action);

if (decision.action === 'allow') {
  // execute the action
} else if (decision.action === 'require_approval') {
  // enter approval flow using decision.approvalHint, then record resolution:
  // await policyEngine.recordApproval(auditEventId, { approved: true, resolvedAt: ... });
} else if (decision.action === 'deny') {
  // surface denial to user
} else if (decision.action === 'escalate') {
  // route to configured escalation target
}
```

---

## Risk Levels

| Level | Meaning | Default gating |
|---|---|---|
| `low` | Reversible, internal, no external side effects | Auto-approve |
| `medium` | External but limited blast radius | Auto-approve with audit |
| `high` | Significant external consequences; hard to reverse | Require human approval |
| `critical` | Irreversible, broad impact, or affects shared state | Escalate or deny |

Products override gating behavior through registered policy rules. The defaults above describe intent, not enforcement — enforcement is through the rules you register.

---

## Risk Classifier

```ts
interface RiskClassifier {
  classify(action: Action): RiskLevel | Promise<RiskLevel>;
}
```

The `defaultRiskClassifier` returns `medium` for all actions. Pass your own classifier to `createActionPolicy`:

```ts
const policyEngine = createActionPolicy({ classifier: myClassifier });
```

Classifiers may be async — useful when external context (e.g., target branch protection, PR size) informs the risk level.

---

## Policy Rules

Rules are product-supplied. The engine evaluates them in priority order (lower number = higher priority). The first rule returning a non-null decision wins. If no rule matches, the fallback decision applies.

```ts
interface PolicyRule {
  id: string;
  priority?: number; // default 100; lower evaluates first
  evaluate(
    action: Action,
    riskLevel: RiskLevel,
    context: PolicyEvaluationContext
  ): PolicyDecision | null | Promise<PolicyDecision | null>;
  description?: string;
}
```

**Return `null`** to defer to the next rule. This is how you compose rules without conflicts.

**Rule management:**

```ts
policyEngine.registerRule(rule);      // register; throws PolicyError if id already exists
policyEngine.removeRule('rule-id');   // remove; throws RuleNotFoundError if not found
policyEngine.listRules();             // returns rules sorted by priority, then registration order
```

---

## Decisions

```ts
interface PolicyDecision {
  action: 'allow' | 'deny' | 'require_approval' | 'escalate';
  ruleId: string;
  riskLevel: RiskLevel;
  reason?: string;
  approvalHint?: ApprovalHint; // present when action is 'require_approval'
}
```

| Decision | Caller behavior |
|---|---|
| `allow` | Execute the action |
| `deny` | Do not execute; surface a denial reason to the user |
| `require_approval` | Block execution; enter approval flow using `approvalHint` |
| `escalate` | Block execution; notify configured escalation target |

---

## Approval Contract

When a rule returns `require_approval`, it may include an `ApprovalHint`:

```ts
interface ApprovalHint {
  approver?: string;   // suggested approver role (e.g., 'workspace_admin', 'user')
  timeoutMs?: number;  // suggested timeout before auto-escalating
  prompt?: string;     // message to present to the approver
}
```

After the product resolves the approval flow, record the outcome using `engine.recordApproval()`:

```ts
interface ApprovalResolution {
  approved: boolean;
  approvedBy?: string;
  resolvedAt: string; // ISO-8601
  comment?: string;
}

// auditEventId comes from the EvaluationResult returned by evaluate()
await policyEngine.recordApproval(auditEventId, {
  approved: true,
  approvedBy: 'user-xyz',
  resolvedAt: new Date().toISOString(),
  comment: 'Approved after review.',
});
```

`recordApproval()` emits a new `AuditEvent` to the configured sink with the original action, decision, and the `ApprovalResolution` populated in the `approval` field. Throws `PolicyError` if the `auditEventId` is unknown (evicted from the bounded in-memory map after 1000 evaluations).

---

## Proactive Action Gating

`Action.proactive` is a **required**, non-optional boolean. Callers must be explicit about whether an action originated from a user turn or from a proactive engine.

```ts
// In a proactive capability handler:
const action: Action = {
  id: nanoid(),
  type: 'proactive_follow_up',
  description: 'Proactive check-in on stale thread',
  sessionId: wakeUpContext.sessionId,
  userId: sessionUserId,
  proactive: true, // required
};

const { decision, auditEventId } = await policyEngine.evaluate(action);
```

Policy rules receive `context.proactive` and can apply stricter gating:

```ts
policyEngine.registerRule({
  id: 'proactive-high-require-approval',
  priority: 5,
  evaluate(action, riskLevel, context) {
    if (context.proactive && (riskLevel === 'high' || riskLevel === 'critical')) {
      return {
        action: 'require_approval',
        ruleId: 'proactive-high-require-approval',
        riskLevel,
        approvalHint: {
          approver: 'user',
          prompt: `The assistant is about to take a proactive action: ${action.description}. Approve?`,
        },
      };
    }
    return null;
  },
});
```

---

## Audit Hooks

Every `evaluate()` call records an `AuditEvent`, regardless of the decision:

```ts
interface AuditEvent {
  id: string;
  action: Action;
  riskLevel: RiskLevel;
  decision: PolicyDecision;
  evaluatedAt: string; // ISO-8601
  approval?: ApprovalResolution; // populated by the product after approval resolution
}

interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}
```

**For tests and local development:** use `InMemoryAuditSink`:

```ts
const sink = new InMemoryAuditSink();
const engine = createActionPolicy({ auditSink: sink });

// After evaluate():
console.log(sink.events); // AuditEvent[]
sink.clear();             // reset
```

**For production:** implement `AuditSink` against your own persistence backend (database, log aggregator, cloud audit service).

**No-op sink** when audit is not needed:

```ts
const engine = createActionPolicy({ auditSink: { record: async () => {} } });
```

---

## Wiring Traits to Policy

The policy package does not read traits directly. Products map trait values to policy configuration at setup time:

```ts
import { createActionPolicy } from '@relay-assistant/policy';

const policyEngine = createActionPolicy({
  fallbackDecision: traits.riskTolerance === 'cautious' ? 'deny' : 'require_approval',
  classifier: buildClassifierFromTraits(traits),
});
```

---

## Fallback Decision

When no registered rule produces a non-null decision, the engine applies the fallback:

```ts
// Default fallback: require_approval
const engine = createActionPolicy();

// Override to deny all unmatched actions:
const strictEngine = createActionPolicy({ fallbackDecision: 'deny' });

// Override to allow all unmatched actions (permissive dev setup):
const permissiveEngine = createActionPolicy({ fallbackDecision: 'allow' });
```

The fallback is recorded in the audit event with `ruleId: 'fallback'`.

---

## Error Types

```ts
// Base policy error
class PolicyError extends Error { cause?: unknown }

// Thrown by removeRule() when ruleId is not found
class RuleNotFoundError extends PolicyError { ruleId: string }

// Thrown when the risk classifier throws or returns an invalid value
class ClassificationError extends PolicyError { cause?: unknown }
```

---

## What Stays Outside This Package

| Concern | Where it lives |
|---|---|
| Product-specific action type catalogs | Product repos |
| Commercial tier and pricing enforcement | Product repos |
| Customer-specific escalation chains | Product repos |
| Approval UX (modals, Slack buttons, email) | Product repos |
| Approval workflow state and timeouts | Product repos |
| User authentication and identity | Relay foundation (relayauth) |
| Fleet-level rate limiting | Relay foundation / cloud infra |
| Content moderation and safety filtering | External services / product repos |
| Session lifecycle | `@relay-assistant/sessions` |
| Outbound message delivery | `@relay-assistant/surfaces` + Relay runtime |
| Hosted audit pipelines and storage | `AgentWorkforce/cloud` |
| Persistent rule storage | Deferred to v1.1 |
| Time-based auto-escalation | Deferred to v1.1 |

---

## Package Structure

```
packages/policy/
  package.json        — nanoid runtime dep only
  tsconfig.json
  src/
    types.ts          — Action, RiskLevel, RiskClassifier, PolicyRule, PolicyDecision,
                        EvaluationResult, PolicyEvaluationContext, ApprovalHint,
                        ApprovalResolution, AuditEvent, AuditSink, InMemoryAuditSink,
                        error classes
    policy.ts         — createActionPolicy factory and PolicyEngine implementation
    index.ts          — public re-exports
    policy.test.ts    — 64 tests
  README.md
```

---

POLICY_PACKAGE_DIRECTION_READY
