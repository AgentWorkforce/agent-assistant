# v1 Policy Implementation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Date:** 2026-04-12
**Package:** `@relay-assistant/policy`
**Status:** IMPLEMENTATION_READY
**Spec:** `docs/specs/v1-policy-spec.md`
**Scope reference:** `docs/architecture/v1-policy-scope.md`
**Version target:** v0.1.0

---

## 1. Bounded v1 Scope

### What v1 Policy Delivers

1. **PolicyEngine factory** — `createActionPolicy(config)` returns a stateful engine with all v1 methods
2. **Risk classification** — `RiskClassifier` interface; `defaultRiskClassifier` returns `medium` for all unclassified actions
3. **Policy rule registration and management** — `registerRule`, `removeRule`, `listRules` with priority ordering
4. **Policy evaluation** — `engine.evaluate(action)` classifies risk, evaluates rules in priority order, applies fallback, records audit event
5. **Four decision outcomes** — `allow`, `deny`, `require_approval`, `escalate` with structured `PolicyDecision`
6. **Approval contract** — `ApprovalHint` on `require_approval` decisions; `ApprovalResolution` for recording outcomes
7. **Proactive action flag** — required `Action.proactive` field; `PolicyEvaluationContext.proactive` available to all rules
8. **Audit hooks** — `AuditSink` interface called on every evaluation; `InMemoryAuditSink` for tests
9. **Fallback decision** — configurable per engine instance; defaults to `require_approval`
10. **Error types** — `PolicyError`, `RuleNotFoundError`, `ClassificationError`
11. **45 tests** — per project DoD standard

### What v1 Policy Does NOT Deliver

- **No persistent rule storage.** All rule and engine state is in-memory in the engine instance.
- **No approval workflow engine.** The package defines the data contract; products own the UX and resolution flow.
- **No time-based auto-escalation.** Scheduler binding integration is deferred to v1.1.
- **No capability handler registration.** Products call `policyEngine.evaluate()` inside their own handlers.
- **No connectivity signal emission.** Decisions are returned to callers; what they do with them is product logic.
- **No rate limiting or fleet-level budgets.** That is infrastructure scope.
- **No traits package dependency.** Products map trait values to policy configuration at setup time.

---

## 2. File Manifest

All files under `packages/policy/`.

### Package Infrastructure

| File | Purpose |
|---|---|
| `package.json` | Package manifest; `nanoid` is the only runtime dep |
| `tsconfig.json` | TypeScript config; ES2022, NodeNext, strict mode, declarations to `dist/` |

### Runtime Source (`src/`)

| File | Approx. lines | Purpose |
|---|---|---|
| `src/types.ts` | ~130 | All exported types, interfaces, error classes |
| `src/policy.ts` | ~310 | `createActionPolicy` factory; rule registration; evaluation loop; classification; audit recording |
| `src/index.ts` | ~20 | Public API re-exports |

### Tests (`src/`)

| File | Approx. lines | Purpose |
|---|---|---|
| `src/policy.test.ts` | ~510 | 45 tests across all spec categories |

**Total: 6 files** (2 infrastructure + 3 runtime + 1 test)

---

## 3. Type Definitions (`src/types.ts`)

All types are new. Zero runtime dependency on any other `@relay-assistant/*` package.

### 3.1 Action and Classification Types

```ts
export interface Action {
  id: string;
  type: string;
  description: string;
  sessionId: string;
  userId: string;
  proactive: boolean;
  metadata?: Record<string, unknown>;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskClassifier {
  classify(action: Action): RiskLevel | Promise<RiskLevel>;
}

export const defaultRiskClassifier: RiskClassifier = {
  classify: (_action) => 'medium',
};
```

### 3.2 Policy Rule and Context

```ts
export interface PolicyEvaluationContext {
  sessionId: string;
  userId: string;
  workspaceId?: string;
  proactive: boolean;
  metadata?: Record<string, unknown>;
}

export interface ApprovalHint {
  approver?: string;
  timeoutMs?: number;
  prompt?: string;
}

export interface PolicyDecision {
  action: 'allow' | 'deny' | 'require_approval' | 'escalate';
  ruleId: string;
  riskLevel: RiskLevel;
  reason?: string;
  approvalHint?: ApprovalHint;
}

export interface PolicyRule {
  id: string;
  priority?: number;
  evaluate(
    action: Action,
    riskLevel: RiskLevel,
    context: PolicyEvaluationContext
  ): PolicyDecision | null | Promise<PolicyDecision | null>;
  description?: string;
}
```

### 3.3 Audit Types

```ts
export interface ApprovalResolution {
  approved: boolean;
  approvedBy?: string;
  resolvedAt: string;
  comment?: string;
}

export interface AuditEvent {
  id: string;
  action: Action;
  riskLevel: RiskLevel;
  decision: PolicyDecision;
  evaluatedAt: string;
  approval?: ApprovalResolution;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}
```

### 3.4 Engine Types

```ts
export interface PolicyEngineConfig {
  classifier?: RiskClassifier;
  fallbackDecision?: PolicyDecision['action'];
  auditSink?: AuditSink;
}

export interface PolicyEngine {
  evaluate(action: Action): Promise<PolicyDecision>;
  registerRule(rule: PolicyRule): void;
  removeRule(ruleId: string): void;
  listRules(): PolicyRule[];
}
```

### 3.5 Error Types

```ts
export class PolicyError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PolicyError';
  }
}

export class RuleNotFoundError extends PolicyError {
  constructor(public readonly ruleId: string) {
    super(`Policy rule not found: ${ruleId}`);
    this.name = 'RuleNotFoundError';
  }
}

export class ClassificationError extends PolicyError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'ClassificationError';
  }
}
```

### 3.6 InMemoryAuditSink

```ts
export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }
}
```

---

## 4. Engine Implementation (`src/policy.ts`)

### 4.1 Internal State

```ts
// Inside createActionPolicy closure:
const rules: Array<{ rule: PolicyRule; registrationIndex: number }> = [];
let registrationCounter = 0;
const resolvedClassifier = config?.classifier ?? defaultRiskClassifier;
const resolvedFallback: PolicyDecision['action'] = config?.fallbackDecision ?? 'require_approval';
const resolvedAuditSink: AuditSink = config?.auditSink ?? { record: async () => {} };
```

### 4.2 Rule Registration

```ts
registerRule(rule: PolicyRule): void {
  if (rules.some(r => r.rule.id === rule.id)) {
    throw new PolicyError(`Rule with id '${rule.id}' is already registered.`);
  }
  rules.push({ rule, registrationIndex: registrationCounter++ });
}

removeRule(ruleId: string): void {
  const index = rules.findIndex(r => r.rule.id === ruleId);
  if (index === -1) throw new RuleNotFoundError(ruleId);
  rules.splice(index, 1);
}

listRules(): PolicyRule[] {
  return getSortedRules().map(r => r.rule);
}
```

### 4.3 Sort Helper

```ts
function getSortedRules() {
  return [...rules].sort((a, b) => {
    const pa = a.rule.priority ?? 100;
    const pb = b.rule.priority ?? 100;
    if (pa !== pb) return pa - pb;
    return a.registrationIndex - b.registrationIndex;
  });
}
```

### 4.4 Evaluation

```ts
async evaluate(action: Action): Promise<PolicyDecision> {
  // 1. Classify risk
  let riskLevel: RiskLevel;
  try {
    riskLevel = await resolvedClassifier.classify(action);
  } catch (err) {
    throw new ClassificationError(`Classifier failed for action '${action.id}'`, err);
  }

  // 2. Build context
  const context: PolicyEvaluationContext = {
    sessionId: action.sessionId,
    userId: action.userId,
    proactive: action.proactive,
    metadata: action.metadata,
  };

  // 3. Evaluate rules in priority order
  let decision: PolicyDecision | null = null;
  for (const { rule } of getSortedRules()) {
    try {
      const result = await rule.evaluate(action, riskLevel, context);
      if (result !== null) {
        decision = result;
        break;
      }
    } catch (err) {
      throw new PolicyError(`Rule '${rule.id}' threw during evaluation`, err);
    }
  }

  // 4. Apply fallback
  if (decision === null) {
    decision = {
      action: resolvedFallback,
      ruleId: 'fallback',
      riskLevel,
      reason: 'No registered rule matched this action.',
    };
  }

  // 5. Record audit event
  const auditEvent: AuditEvent = {
    id: nanoid(),
    action,
    riskLevel,
    decision,
    evaluatedAt: new Date().toISOString(),
  };
  await resolvedAuditSink.record(auditEvent);

  return decision;
}
```

---

## 5. Public Exports (`src/index.ts`)

```ts
export type {
  Action,
  RiskLevel,
  RiskClassifier,
  PolicyRule,
  PolicyDecision,
  PolicyEvaluationContext,
  PolicyEngineConfig,
  PolicyEngine,
  ApprovalHint,
  ApprovalResolution,
  AuditEvent,
  AuditSink,
} from './types.js';

export {
  defaultRiskClassifier,
  InMemoryAuditSink,
  PolicyError,
  RuleNotFoundError,
  ClassificationError,
} from './types.js';

export { createActionPolicy } from './policy.js';
```

---

## 6. Package Infrastructure

### 6.1 `package.json`

```json
{
  "name": "@relay-assistant/policy",
  "version": "0.1.0",
  "description": "Action classification, gating, and audit contracts for relay assistants",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

### 6.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

---

## 7. Test Plan (`src/policy.test.ts`)

### 7.1 Type Structural Tests (4)

| # | Test |
|---|---|
| T-01 | `createActionPolicy` returns an object with `evaluate`, `registerRule`, `removeRule`, `listRules` |
| T-02 | `defaultRiskClassifier` is exported and returns `medium` synchronously |
| T-03 | `InMemoryAuditSink` is exported and has `events` array and `clear()` method |
| T-04 | `PolicyError`, `RuleNotFoundError`, `ClassificationError` are exported and extend Error |

### 7.2 Risk Classification (5)

| # | Test |
|---|---|
| C-01 | Default classifier returns `medium` for any action |
| C-02 | Custom synchronous classifier is called and its result used |
| C-03 | Custom async classifier is awaited and its result used |
| C-04 | Classifier that throws causes `ClassificationError` to be thrown from `evaluate()` |
| C-05 | Unclassified action type routes to `medium` via default classifier |

### 7.3 Policy Rule Registration (5)

| # | Test |
|---|---|
| R-01 | `registerRule` adds a rule; `listRules` returns it |
| R-02 | `listRules` returns rules sorted by priority ascending |
| R-03 | Rules with same priority are returned in registration order |
| R-04 | `removeRule` removes an existing rule; `listRules` no longer returns it |
| R-05 | `registerRule` throws `PolicyError` when duplicate id is registered |

### 7.4 Policy Evaluation — Basic (6)

| # | Test |
|---|---|
| E-01 | Rule returning `allow` produces `allow` decision |
| E-02 | Rule returning `deny` produces `deny` decision |
| E-03 | Rule returning `require_approval` produces decision with `approvalHint` |
| E-04 | Rule returning `escalate` produces `escalate` decision |
| E-05 | Rule returning `null` defers to next rule; second rule's decision is used |
| E-06 | When no rule matches, fallback decision is returned with `ruleId: 'fallback'` |

### 7.5 Policy Evaluation — Priority (4)

| # | Test |
|---|---|
| P-01 | Lower priority number evaluates first |
| P-02 | First non-null result wins; higher-priority rules are not evaluated after a match |
| P-03 | Rules with same priority are evaluated in registration order |
| P-04 | After `removeRule`, the removed rule is not evaluated |

### 7.6 Proactive Action Gating (4)

| # | Test |
|---|---|
| PG-01 | `action.proactive = true` is passed to `context.proactive` in rule evaluate |
| PG-02 | Rule that gates on `context.proactive && riskLevel === 'high'` returns `require_approval` |
| PG-03 | Non-proactive action with same risk level passes a proactive-only gate rule |
| PG-04 | `action.proactive = false` allows low-risk action through a permissive rule |

### 7.7 Approval Contract (3)

| # | Test |
|---|---|
| A-01 | Decision with `action: 'require_approval'` may include `approvalHint` with `approver`, `timeoutMs`, `prompt` |
| A-02 | `ApprovalResolution` type has `approved`, `approvedBy`, `resolvedAt`, `comment` fields |
| A-03 | Audit event `approval` field can be populated by the caller post-resolution |

### 7.8 Audit Sink (5)

| # | Test |
|---|---|
| AU-01 | `InMemoryAuditSink` records events from `evaluate()` |
| AU-02 | Recorded audit event contains `id`, `action`, `riskLevel`, `decision`, `evaluatedAt` |
| AU-03 | Audit event is recorded for `allow` decisions |
| AU-04 | Audit event is recorded for `deny` decisions |
| AU-05 | Audit event is recorded for `require_approval` decisions; `clear()` empties events |

### 7.9 Error Handling (3)

| # | Test |
|---|---|
| ER-01 | `PolicyError` has `name === 'PolicyError'` and extends `Error` |
| ER-02 | `RuleNotFoundError` exposes `ruleId`; thrown by `removeRule` for unknown ids |
| ER-03 | `ClassificationError` wraps original classifier error as `cause` |

### 7.10 Fallback Decision (3)

| # | Test |
|---|---|
| FB-01 | Default fallback is `require_approval` when no rule matches |
| FB-02 | Fallback can be configured to `allow` |
| FB-03 | Fallback decision is recorded in audit sink |

### 7.11 End-to-End Allow/Deny/Escalate (3)

| # | Test |
|---|---|
| EE-01 | Full allow path: classify → rule match → allow → audit recorded |
| EE-02 | Full deny path: classify → rule match → deny → audit recorded |
| EE-03 | Full escalate path: classify → rule match → escalate → audit recorded |

**Total: 45 tests**

---

## 8. PR Scope

Single PR. The package is self-contained with no cross-package code changes needed. Products adopt by importing the package, supplying a classifier, registering rules, and calling `policyEngine.evaluate()` in their capability handlers.

The only files changed outside `packages/policy/` are:
- `docs/specs/v1-policy-spec.md` (new)
- `docs/architecture/v1-policy-implementation-plan.md` (this file)
- `packages/policy/README.md` (replace placeholder)
- `docs/research/policy-runtime-notes.md` (new)

---

## 9. Acceptance Criteria (Definition of Done)

- [ ] All 45 tests pass (`vitest run`)
- [ ] `tsc --noEmit` reports no errors
- [ ] `createActionPolicy` factory is exported and functional
- [ ] `evaluate()` classifies risk, evaluates rules in priority order, applies fallback, records audit
- [ ] `InMemoryAuditSink` accumulates events accessible via `.events`
- [ ] `defaultRiskClassifier` exported and returns `medium` for all inputs
- [ ] `RuleNotFoundError`, `ClassificationError`, `PolicyError` exported from package root
- [ ] `Action.proactive` is a required non-optional boolean field
- [ ] Fallback decision configurable and defaults to `require_approval`
- [ ] `packages/policy/README.md` reflects final implementation

---

V1_POLICY_IMPLEMENTATION_PLAN_READY
