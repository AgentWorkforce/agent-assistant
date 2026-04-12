# v1 Policy Contract Reconciliation

**Status:** RECONCILED
**Date:** 2026-04-12
**Inputs:** v1-policy-review-verdict.md (PASS_WITH_FOLLOWUPS), v1-policy-spec.md, v1-policy-implementation-plan.md, packages/policy/README.md
**Output:** Five binding decisions that amend the spec and implementation plan before coding begins.

---

## Decision 1: Approval Outcome Audit Correlation

**Review finding:** `evaluate()` returns only `PolicyDecision`. Products cannot correlate approval outcomes back to the original audit record without reconstructing the audit event or reaching into sink internals.

**Decision:** `evaluate()` returns an `EvaluationResult` containing both the decision and the audit event ID. A new `recordApprovalResolution()` method on `PolicyEngine` accepts an audit event ID and an `ApprovalResolution`, and records a follow-up audit entry.

### Contract Changes

**New return type (replaces bare `PolicyDecision` return):**

```ts
interface EvaluationResult {
  decision: PolicyDecision;
  auditEventId: string;
}
```

**New engine method:**

```ts
interface PolicyEngine {
  evaluate(action: Action): Promise<EvaluationResult>;
  registerRule(rule: PolicyRule): void;
  removeRule(ruleId: string): void;
  listRules(): PolicyRule[];

  /**
   * Record an approval resolution against a prior evaluation's audit event.
   * Emits a new AuditEvent to the sink with the original action, decision,
   * and the provided ApprovalResolution populated in the `approval` field.
   *
   * The engine stores a map of auditEventId -> { action, riskLevel, decision }
   * from recent evaluations. Throws PolicyError if the auditEventId is unknown.
   */
  recordApproval(auditEventId: string, resolution: ApprovalResolution): Promise<void>;
}
```

**Implementation detail:** The engine keeps an in-memory `Map<string, { action, riskLevel, decision }>` of recent evaluations. `recordApproval()` looks up the original context, constructs a new `AuditEvent` with the `approval` field populated, and records it to the sink. The map is bounded (cap at 1000 entries, evict oldest) to prevent unbounded growth. This is v1-appropriate; persistent correlation is deferred.

**What this replaces:** The spec's suggestion that products manually reconstruct audit events and call `auditSink.record()` directly. Products now call `engine.recordApproval(auditEventId, resolution)` instead.

---

## Decision 2: Classifier Output Validation

**Review finding:** The spec says `ClassificationError` is thrown for invalid classifier return values, but the implementation plan only wraps thrown errors and never validates the returned value.

**Decision:** `evaluate()` validates the classifier's return value against the four valid `RiskLevel` values. If the value is not one of `'low' | 'medium' | 'high' | 'critical'`, throw `ClassificationError`.

### Contract Changes

**Add to evaluation algorithm (step 1, after awaiting classifier):**

```ts
const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

// After: riskLevel = await resolvedClassifier.classify(action)
if (!VALID_RISK_LEVELS.has(riskLevel)) {
  throw new ClassificationError(
    `Classifier returned invalid risk level '${riskLevel}' for action '${action.id}'. ` +
    `Expected one of: low, medium, high, critical.`
  );
}
```

**Required tests:**
- Classifier returning an invalid string (e.g., `'extreme'`) throws `ClassificationError`.
- Classifier returning `undefined` throws `ClassificationError`.
- Classifier returning a valid level proceeds normally (existing tests cover this).

---

## Decision 3: Default Posture Wording

**Review finding:** The scope doc says "default-deny posture for unclassified actions" but the actual defaults are `medium` risk + `require_approval` fallback, which is a "default-block-pending-approval" posture, not deny.

**Decision:** The scope doc wording is incorrect. The actual runtime behavior (`require_approval` fallback) is the intended posture. Amend scope and README wording.

### Contract Changes

**Scope doc amendment (v1-policy-scope.md, "External-action safeguards" bullet):**

Replace:
> Contracts for actions that leave the assistant boundary [...] with a default-deny posture for unclassified actions.

With:
> Contracts for actions that leave the assistant boundary [...] with a default-block posture: unclassified actions are gated behind approval (`require_approval`) rather than silently allowed or silently denied.

**Rationale:** `require_approval` is strictly better than `deny` for v1 because it keeps products in the loop without silently dropping actions. Products wanting true deny can set `fallbackDecision: 'deny'`. No runtime behavior change.

---

## Decision 4: `workspaceId` in Evaluation Context

**Review finding:** `PolicyEvaluationContext.workspaceId` exists but `Action` has no `workspaceId` field, and the evaluation loop never populates it. It is an orphaned field.

**Decision:** Remove `workspaceId` from `PolicyEvaluationContext` in v1. Products needing workspace-scoped rules pass workspace ID through `Action.metadata` and `context.metadata`.

### Contract Changes

**Remove from `PolicyEvaluationContext`:**

```ts
interface PolicyEvaluationContext {
  sessionId: string;
  userId: string;
  // workspaceId removed — use metadata.workspaceId if needed
  proactive: boolean;
  metadata?: Record<string, unknown>;
}
```

**Rationale:** Adding `workspaceId` to `Action` would be scope creep (it implies the engine understands workspace boundaries). Leaving it as an unpopulated optional field is a package-boundary leak. `metadata` is the correct extensibility path. If workspace-scoped policy evaluation becomes common across multiple products, `workspaceId` can be promoted to a first-class field in v1.1.

**Product migration pattern:**

```ts
const action: Action = {
  // ...
  metadata: { workspaceId: 'ws-123' },
};

// In a rule:
evaluate(action, riskLevel, context) {
  const wsId = context.metadata?.workspaceId as string | undefined;
  // ...
}
```

---

## Decision 5: Duplicate Registration Error Type

**Review finding:** The spec says `registerRule()` throws `RuleNotFoundError` on duplicate IDs. The implementation plan correctly throws `PolicyError`. `RuleNotFoundError` is semantically wrong for a duplicate.

**Decision:** `registerRule()` throws `PolicyError` (not `RuleNotFoundError`) on duplicate rule IDs. The spec text is incorrect and must be fixed.

### Contract Changes

**Spec fix (v1-policy-spec.md, section 6.2):**

Replace:
> Register a policy rule. Throws `RuleNotFoundError` if a rule with the same id is already registered.

With:
> Register a policy rule. Throws `PolicyError` if a rule with the same id is already registered.

**Error message:** `"Rule with id '<id>' is already registered."` (as in the implementation plan).

**Required test:** `registerRule()` with a duplicate ID throws `PolicyError` with the correct message.

---

## Summary of Amendments

| # | Finding | Decision | Affects |
|---|---|---|---|
| 1 | Approval audit correlation | `evaluate()` returns `EvaluationResult`; add `recordApproval()` method | types.ts, policy.ts, index.ts, spec, README |
| 2 | Classifier output validation | Validate return value against `RiskLevel` enum; throw `ClassificationError` | policy.ts, spec |
| 3 | Default posture wording | Change "default-deny" to "default-block" in scope doc | scope doc, README |
| 4 | Orphaned `workspaceId` | Remove from `PolicyEvaluationContext`; use `metadata` instead | types.ts, spec |
| 5 | Duplicate registration error | `PolicyError`, not `RuleNotFoundError` | spec |

## Implementation Impact

- **File count:** unchanged (6 files).
- **New types:** `EvaluationResult` (~4 lines).
- **New engine method:** `recordApproval()` (~20 lines implementation).
- **New internal state:** `Map<string, EvalRecord>` with bounded eviction (~10 lines).
- **Test count adjustment:** 45 -> ~50 (add ~5 tests for classifier validation, duplicate registration, recordApproval, bounded map eviction).
- **No new dependencies.**
- **No new cross-package runtime imports.**

---

V1_POLICY_CONTRACT_RECONCILED
