# v1 Policy Package — Bounded Scope

**Status:** SCOPE_DEFINED
**Date:** 2026-04-12
**Package:** `@relay-assistant/policy`
**Version:** v0.1.0
**Inputs:** package-boundary-map.md, v1-workflow-backlog.md, extraction-roadmap.md, v1-proactive-scope.md, policy package placeholder README

---

## 1. What Policy Means in RelayAssistant

Policy governs what an assistant is **allowed to do** when it proposes or performs actions that have external consequences. It is the layer between "the assistant decided to act" and "the action actually executes."

This SDK package owns the **classification, gating, and audit contract** for assistant actions. It does not own product-specific governance rules, commercial tier logic, or hosted audit infrastructure.

### Policy concerns that belong in this package

- **Action risk classification:** Categorizing proposed actions by risk level (e.g., `low`, `medium`, `high`, `critical`) based on action type and context. The classification is a reusable vocabulary, not a product-specific rulebook.
- **Approval mode contracts:** Defining how actions are gated — auto-approve, human-in-the-loop, escalate — and the interface for resolution. Products supply the approval UX; this package defines the contract.
- **Action policy evaluation:** Given an action and its risk classification, evaluate registered policy rules to produce a decision: `allow`, `deny`, `require_approval`, or `escalate`.
- **Audit hooks:** A pluggable interface for recording action decisions (what was proposed, what risk was assigned, what decision was made, who approved). The package emits audit events; products route them to their audit backend.
- **External-action safeguards:** Contracts for actions that leave the assistant boundary — API calls, message sends, file writes, tool invocations — with a default-deny posture for unclassified actions.
- **Policy rule registration:** Products register policy rules that map action types and risk levels to decisions. Rules are composable and evaluated in priority order.
- **In-memory adapters:** Test and local-development adapters for policy stores and audit sinks, so the package is fully testable without external services.

### Policy concerns that do NOT belong in this package

| Concern | Owner | Reason |
|---|---|---|
| Product pricing, billing, or tier enforcement | Product repos | Commercial logic, not reusable assistant governance |
| Customer-specific escalation chains | Product repos | Business policy tied to one product's domain |
| User authentication and authorization | Relay foundation (relayauth) | Transport-level identity, not assistant-layer policy |
| Rate limiting across an assistant fleet | Relay foundation / cloud infra | Infrastructure concern, not per-action policy |
| Content moderation or safety filtering | External services / product repos | Domain-specific; not a reusable SDK contract |
| Domain-specific action catalogs (e.g., "PR merge rules") | Product repos | Only makes sense for one product's domain |
| Hosted audit pipelines and storage | `AgentWorkforce/cloud` | Infrastructure, not SDK |

---

## 2. Core Concepts

### 2.1 Action

An `Action` is a proposed assistant operation that has consequences beyond generating text. Actions are the unit of policy evaluation.

```ts
interface Action {
  /** Unique identifier for this action instance. */
  id: string;

  /** Action type string. Products define their own action types. */
  type: string;

  /** Human-readable description for audit and approval UI. */
  description: string;

  /** The session in which this action was proposed. */
  sessionId: string;

  /** The user on whose behalf the action is being taken. */
  userId: string;

  /** Whether this action was initiated proactively (no user message in current turn). */
  proactive: boolean;

  /** Product-supplied metadata about the action. */
  metadata?: Record<string, unknown>;
}
```

The package does not define a fixed set of action types. Products register their own types (e.g., `"send_email"`, `"merge_pr"`, `"create_ticket"`) and classify them through policy rules.

### 2.2 Risk Level

Risk is a four-level enum representing the potential impact of an action:

```ts
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
```

| Level | Meaning | Typical gating |
|---|---|---|
| `low` | Reversible, internal, no external side effects | Auto-approve |
| `medium` | External but limited blast radius | Auto-approve with audit |
| `high` | Significant external consequences, hard to reverse | Require human approval |
| `critical` | Irreversible, broad impact, or affects shared state | Escalate or deny |

These are defaults. Products override gating behavior through policy rules.

### 2.3 Risk Classifier

A function that assigns a risk level to an action. Products supply classifiers; the package provides the interface and a default classifier that assigns `medium` to all unclassified actions.

```ts
interface RiskClassifier {
  classify(action: Action): RiskLevel | Promise<RiskLevel>;
}
```

The default classifier (`defaultRiskClassifier`) returns `medium` for any action, ensuring unclassified actions are not silently auto-approved.

### 2.4 Policy Rule

A policy rule maps an action context to a decision. Rules are registered with a priority; lower numbers evaluate first.

```ts
interface PolicyRule {
  id: string;

  /** Lower priority numbers evaluate first. Default: 100. */
  priority?: number;

  /**
   * Returns a decision for the given action and risk level,
   * or null to defer to the next rule.
   */
  evaluate(
    action: Action,
    riskLevel: RiskLevel,
    context: PolicyEvaluationContext
  ): PolicyDecision | null | Promise<PolicyDecision | null>;

  /** Human-readable description for observability. */
  description?: string;
}
```

When a rule returns `null`, evaluation continues to the next rule. If no rule matches, the fallback decision applies (configurable; defaults to `require_approval`).

### 2.5 Policy Decision

```ts
interface PolicyDecision {
  /** What the policy engine recommends. */
  action: 'allow' | 'deny' | 'require_approval' | 'escalate';

  /** The rule that produced this decision. */
  ruleId: string;

  /** The risk level that was evaluated. */
  riskLevel: RiskLevel;

  /** Human-readable reason for the decision. */
  reason?: string;

  /**
   * When action is 'require_approval': hints for the approval UX.
   * The package does not implement approval UX — products do.
   */
  approvalHint?: ApprovalHint;
}

interface ApprovalHint {
  /** Suggested approver role or identity. */
  approver?: string;

  /** Suggested timeout before auto-escalating. Milliseconds. */
  timeoutMs?: number;

  /** Message to present to the approver. */
  prompt?: string;
}
```

### 2.6 Policy Evaluation Context

```ts
interface PolicyEvaluationContext {
  /** The session in which evaluation occurs. */
  sessionId: string;

  /** The user on whose behalf the action was proposed. */
  userId: string;

  /** Workspace context, if available. */
  workspaceId?: string;

  /** Whether the action originates from a proactive engine (no user message). */
  proactive: boolean;

  /** Product-supplied context values. */
  metadata?: Record<string, unknown>;
}
```

### 2.7 Audit Event

```ts
interface AuditEvent {
  /** Unique event ID. */
  id: string;

  /** The action that was evaluated. */
  action: Action;

  /** The risk level assigned. */
  riskLevel: RiskLevel;

  /** The decision that was reached. */
  decision: PolicyDecision;

  /** ISO-8601 timestamp of evaluation. */
  evaluatedAt: string;

  /** If approval was required: the resolution. */
  approval?: ApprovalResolution;
}

interface ApprovalResolution {
  approved: boolean;
  approvedBy?: string;
  resolvedAt: string; // ISO-8601
  comment?: string;
}

interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}
```

Products wire their own `AuditSink` (e.g., database, log aggregator, cloud audit service). The package ships `InMemoryAuditSink` for tests.

---

## 3. v1 Scope vs. Deferred

### In scope for v1

| Capability | Detail |
|---|---|
| `createActionPolicy(config)` factory | Returns a `PolicyEngine` with all v1 methods |
| Risk classifier interface + default classifier | `RiskClassifier` interface; `defaultRiskClassifier` returns `medium` for all actions |
| Policy rule registration | `engine.registerRule(rule)` — products supply domain rules with priority ordering |
| Policy evaluation | `engine.evaluate(action)` — classifies risk, evaluates rules in priority order, returns `PolicyDecision` |
| Fallback decision | Configurable via `config.fallbackDecision`; defaults to `require_approval` |
| Approval contract | `ApprovalHint` on decisions; `ApprovalResolution` for recording outcomes. No approval UX. |
| Audit hook interface | `AuditSink` interface; `engine.evaluate()` records to sink after every evaluation |
| `InMemoryAuditSink` | Test adapter that accumulates audit events in an accessible array |
| Proactive action flag | `Action.proactive` and `PolicyEvaluationContext.proactive` — allows rules to apply stricter gating to proactive actions |
| Rule management | `engine.registerRule()`, `engine.removeRule(ruleId)`, `engine.listRules()` |
| Error types | `PolicyError`, `RuleNotFoundError`, `ClassificationError` |
| 40+ tests | Per DoD standard |

### Deferred (v1.1 or later)

| Capability | Target | Reason for deferral |
|---|---|---|
| Persistent rule storage adapter | v1.1 | v1 is in-memory only; persistence requires adapter design |
| Approval workflow engine | v1.1 | v1 defines the contract; products implement approval UX and resolution flow |
| Time-based auto-escalation | v1.1 | Depends on scheduler binding integration (from proactive) |
| Cumulative risk budgets per session | v1.1 | Requires tracking action history within a session |
| Cross-session / org-level policy | v2 | Requires broader scoping model |
| Policy inheritance and override chains | v2 | v1 uses flat priority-ordered rules |
| ML-based risk classification | v2+ | v1 classifiers are function-based; ML integration is additive |
| Distributed policy evaluation | v2+ | Single-process in v1 |
| Action rollback contracts | v2+ | Requires action-specific undo semantics not yet designed |
| Compliance framework mappings (SOC2, GDPR) | v3+ | Enterprise concern; not v1 SDK scope |

---

## 4. Interaction with Other Packages

### Proactive (`@relay-assistant/proactive`)

**Relationship:** Proactive actions are a primary policy consumer. No direct import.

Proactive actions originate without a user message, which makes them inherently higher-risk. The policy package provides the `proactive: boolean` flag on `Action` and `PolicyEvaluationContext` so that policy rules can apply stricter gating to proactive actions.

Products wire the integration in their proactive capability handler:

```ts
// In the proactive capability handler, after engine.evaluateFollowUp() returns 'fire':
const action: Action = {
  id: generateId(),
  type: 'proactive_follow_up',
  description: decision.messageTemplate ?? 'Proactive follow-up',
  sessionId: decision.sessionId,
  userId: sessionUserId,
  proactive: true,
};

const policyDecision = await policyEngine.evaluate(action);
if (policyDecision.action === 'allow') {
  await context.runtime.emit({ sessionId: decision.sessionId, text: renderedMessage });
} else if (policyDecision.action === 'require_approval') {
  // Product handles approval UX
}
```

**v1 boundary:** The proactive package does not import or depend on policy. The proactive scope doc explicitly lists "action risk classification or approval gates" as deferred to policy. Products bridge the two packages in their capability handlers.

### Traits (`@relay-assistant/traits`)

**Relationship:** Traits may inform policy defaults. No direct import.

An assistant's `riskTolerance` trait (e.g., `'cautious'` vs. `'assertive'`) may influence default risk classification or fallback decisions. This is wired by products, not by a package dependency:

```ts
const policyEngine = createActionPolicy({
  fallbackDecision: sageTraits.riskTolerance === 'cautious' ? 'deny' : 'require_approval',
  classifier: traitAwareClassifier(sageTraits),
});
```

The policy package does not read traits directly. Products map trait values to policy configuration at setup time.

### Coordination (`@relay-assistant/coordination`)

**Relationship:** Specialist actions may require policy gating. No direct import in v1.

When a coordinator delegates work to a specialist that performs external actions, those actions should be policy-evaluated. In v1, this is the product's responsibility — the specialist's capability handler calls `policyEngine.evaluate()` before executing.

**v1.1 integration path:** A `PolicyAwareCoordinator` wrapper or middleware could automatically gate specialist actions through policy evaluation before execution. This requires stable coordination and policy packages.

### Surfaces (`@relay-assistant/surfaces`)

**Relationship:** Indirect. Policy decisions may prevent outbound events.

When policy denies or gates an action, the assistant does not emit the corresponding `OutboundEvent`. The policy engine does not interact with surfaces directly — it returns a decision, and the capability handler decides whether to call `runtime.emit()`.

Surface context (which surface originated the action) may be included in `PolicyEvaluationContext.metadata` by the product if surface-specific policy rules are needed (e.g., stricter rules for actions initiated from a public Slack channel vs. a private web session).

### Memory (`@relay-assistant/memory`)

**Relationship:** Audit events may be persisted via memory. No direct import.

The `AuditSink` interface is the policy package's persistence boundary. A product may implement an `AuditSink` backed by the memory store, but the policy package does not import `@relay-assistant/memory`.

**v1.1 connection:** Policy decisions could inform memory promotion — e.g., a denied high-risk action might be worth preserving in user-scoped memory. This is product logic, not a package dependency.

### Routing (`@relay-assistant/routing`)

**Relationship:** None.

Policy is about whether to act. Routing is about how to respond (depth/latency/cost). These are orthogonal concerns. A policy decision does not influence routing mode selection, and routing mode does not influence policy evaluation.

### Connectivity (`@relay-assistant/connectivity`)

**Relationship:** None in v1.

Policy does not emit connectivity signals. If multi-agent policy coordination is needed (e.g., one agent's policy decision affecting another's), it would go through connectivity in a future version.

---

## 5. Implementation Feasibility

### Package structure

```
packages/policy/
  package.json          — zero runtime dependencies (nanoid for IDs)
  tsconfig.json
  src/
    types.ts            — all exported types, interfaces, error classes
    policy.ts           — createActionPolicy factory, rule evaluation, classification, audit
    index.ts            — public re-exports
    policy.test.ts      — 40+ tests
  README.md
```

### Estimated size

- `types.ts`: ~120 lines (Action, RiskLevel, PolicyRule, PolicyDecision, AuditEvent, ApprovalHint, errors)
- `policy.ts`: ~300 lines (engine factory, rule registration, evaluation loop, classification, audit recording)
- `index.ts`: ~20 lines
- `policy.test.ts`: ~500 lines (40+ tests)
- Total: ~940 lines

### Dependencies

| Dependency | Type | Reason |
|---|---|---|
| `nanoid` | Runtime | Action and audit event ID generation |
| `vitest` | Dev | Testing |
| `typescript` | Dev | Build |

**No runtime dependency on any other `@relay-assistant/*` package.** All cross-package integration is through interfaces that products wire.

### Test categories (minimum 40)

| Category | Count | Coverage |
|---|---|---|
| Type structural tests | 4 | All required types and interfaces exist and export correctly |
| Risk classification | 5 | Default classifier, custom classifier, async classifier, classification error handling, unclassified action default |
| Policy rule registration | 5 | Register, list, remove, duplicate rejection, priority ordering |
| Policy evaluation — basic | 6 | Single rule allow, deny, require_approval, escalate, null-deferral to next rule, fallback when no rule matches |
| Policy evaluation — priority | 4 | Priority ordering, first-match-wins, same-priority stability, rule removal mid-evaluation |
| Proactive action gating | 4 | Proactive flag respected, stricter rules for proactive, proactive + high risk, proactive + low risk |
| Approval contract | 3 | ApprovalHint present on require_approval, ApprovalResolution recording, approval metadata |
| Audit sink | 5 | InMemoryAuditSink recording, audit event structure, audit after allow, audit after deny, audit after require_approval |
| Error handling | 3 | PolicyError, RuleNotFoundError, ClassificationError |
| Fallback decision | 3 | Default fallback is require_approval, configurable fallback, fallback with audit |
| **Total** | **42** | |

### PR scope

Single PR. The package is self-contained with no cross-package code changes needed. Products adopt by importing the package and registering policy rules for their action types.

---

## 6. Key Design Decisions

### Default-deny for unclassified actions

The default risk classifier assigns `medium` to all unclassified actions, and the default fallback decision is `require_approval`. This means any action that a product has not explicitly classified and written a rule for will be gated. This is intentional — silent auto-approval of unknown actions is a security risk.

Products that want permissive defaults can override both:

```ts
const engine = createActionPolicy({
  classifier: { classify: () => 'low' },
  fallbackDecision: 'allow',
});
```

### Priority-ordered flat rules, not inheritance chains

v1 uses a flat list of rules evaluated in priority order. The first rule that returns a non-null decision wins. This is simple to reason about and debug.

Policy inheritance (org → workspace → user) and override chains are deferred to v2. They add complexity that is not justified until multiple products demonstrate the need.

### Approval is a contract, not a workflow

The policy package defines `ApprovalHint` (what approval is needed) and `ApprovalResolution` (what happened), but it does not implement approval UX, timeouts, or notification flows. Products own the full approval workflow — the package only provides the data contract.

This keeps the package small and avoids coupling to any specific approval mechanism (Slack buttons, web modals, email confirmations, etc.).

### Proactive flag is first-class

The `proactive: boolean` field on `Action` and `PolicyEvaluationContext` is required, not optional. This forces products to be explicit about whether an action originated from a user turn or from a proactive engine. Policy rules that differentiate proactive vs. user-initiated actions are a core use case, not an edge case.

### Audit is always-on

Every `engine.evaluate()` call records an `AuditEvent` to the configured `AuditSink`, regardless of the decision. Products that don't need audit can pass a no-op sink, but the default behavior is to record everything. This makes the audit trail complete by default rather than requiring opt-in.

---

## 7. Extraction Signals

The policy package generalizes governance patterns from three products:

| Product | Pattern | What gets extracted |
|---|---|---|
| Sage | Knowledge-action approval (e.g., confirming before updating a workspace doc) | Action risk classification, require_approval gating, audit recording |
| MSD | PR merge/close safeguards, destructive-action confirmation | Risk level hierarchy, high/critical action gating, proactive action stricter defaults |
| NightCTO | Service-action governance (e.g., confirming before sending a client communication) | External-action safeguards, approval contracts, escalation decisions |

Products keep their domain-specific action types and classification rules. The engine provides the evaluation, gating, and audit infrastructure.

---

V1_POLICY_SCOPE_READY
