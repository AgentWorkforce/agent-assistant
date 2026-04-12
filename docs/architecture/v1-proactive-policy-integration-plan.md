# v1 Proactive ↔ Policy Integration Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Date:** 2026-04-12
**Packages:** `@relay-assistant/proactive`, `@relay-assistant/policy`
**Input:** v1 proactive package review verdict, v1 policy package review verdict, integration contract
**Status:** COMPLETE

---

## 1. Integration Scope

### In scope

1. **Define the runtime boundary** between `@relay-assistant/proactive` and `@relay-assistant/policy` via the integration contract document.
2. **Implement minimal integration helpers** (`followUpToAction`, `watchTriggerToAction`) in a separate `packages/integration` package that encodes the field-mapping rules without coupling either package to the other.
3. **Write integration proof tests** covering all five required scenarios from the contract's integration test proof pattern (§7).
4. **Fix stale `evaluate()` return shape** in `packages/policy/README.md` proactive example (identified in the policy package review verdict).
5. **Document the integration proof** in `docs/architecture/v1-proactive-policy-integration-proof.md`.

### Out of scope (deferred to v1.1+)

- A shared adapter or combined engine that chains proactive + policy evaluation in one call (contract §6.1)
- Proactive-aware default policy rules shipped in the policy package (contract §6.2)
- Cross-engine state sharing, event bus, or callback mechanism (contract §6.3)
- Policy-level rate limiting for proactive actions (contract §6.4)
- Automatic retry after policy denial (contract §6.5)
- A combined test harness distributed as a package (contract §6.6)

---

## 2. Boundary Design: Product-Mediated Composition

### Design principle

Neither package imports the other. Integration is **product-mediated**: the orchestration layer (product code) receives proactive engine outputs, constructs policy `Action` objects from them, and acts on the policy `EvaluationResult`. The proactive engine never knows what the policy decided; the policy engine never knows it evaluated a proactive decision.

```
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│  proactive engine │  fire    │  product glue     │  Action  │  policy engine   │
│                  │─────────▶│  (orchestrator)   │─────────▶│                  │
│  evaluateFollowUp│          │                   │◀─────────│  evaluate()      │
│  evaluateWatch   │          │  helpers.ts:       │  Result  │  recordApproval()│
│  Rules()         │          │  followUpToAction  │          │  AuditSink       │
│                  │          │  watchTriggerTo    │          │                  │
└──────────────────┘          │  Action            │          └──────────────────┘
                              └──────────────────┘
```

### Why a separate integration package instead of helpers in either package

- Adding helpers to `@relay-assistant/proactive` would require it to import from `@relay-assistant/policy` (or vice versa), creating a runtime dependency that violates the boundary principle.
- `packages/integration` is `private: true` and lives outside both package trees. It is the only place where both type namespaces coexist. Products that want the helpers can copy or vendor them; they are intentionally thin.
- Products that do not need the helpers (e.g., they have richer orchestration with more session context) are not forced to take on any abstraction.

---

## 3. Integration Helpers

### Location

`packages/integration/src/helpers.ts`

### Helpers

| Helper | Input | Output |
|---|---|---|
| `followUpToAction(decision, userId, id)` | `FollowUpDecision` + product-resolved context | `Action` with `type: 'proactive_follow_up'` |
| `watchTriggerToAction(trigger, sessionId, userId, id)` | `WatchTrigger` + product-resolved context | `Action` with `type: 'proactive_watch_<type>'` |

### Field-mapping rules (from contract §2)

**Follow-up decision → Policy action:**

| Proactive output | Policy Action field | Notes |
|---|---|---|
| `decision.sessionId` | `action.sessionId` | Direct pass-through |
| `decision.ruleId` | `action.metadata.sourceRuleId` | Traceability; not a first-class policy field |
| `decision.routingHint` | `action.metadata.routingHint` | Policy does not interpret this |
| `decision.messageTemplate` | `action.description` | Human-readable description for audit |
| `(product-resolved)` | `action.userId` | Product looks up session → user mapping |
| `(literal true)` | `action.proactive` | Always `true` for proactive-originated actions |
| `(caller-supplied)` | `action.id` | Unique per evaluation attempt; deterministic in tests |

**Watch trigger → Policy action:**

| Proactive output | Policy Action field | Notes |
|---|---|---|
| `trigger.ruleId` | `action.metadata.sourceRuleId` | Traceability |
| `trigger.action` | `action.metadata.watchAction` | Full descriptor for downstream use |
| `trigger.triggeredAt` | `action.metadata.triggeredAt` | ISO-8601 trigger timestamp |
| `trigger.action.type` | `action.type` (suffix) | `proactive_watch_<type>` convention |

---

## 4. Integration Test Proof

### Location

`packages/integration/src/integration.test.ts`

### Package setup

```
packages/integration/
  package.json        — private: true; vitest + TypeScript dev deps only
  tsconfig.json       — NodeNext, strict, noEmit
  src/
    helpers.ts        — two pure field-mapping helpers
    integration.test.ts — 14 tests across 5 scenario groups
```

### Test inventory (14 tests)

**Scenario 1 — Proactive action allowed by policy (2 tests)**

| # | Test | Asserts |
|---|---|---|
| 1 | Follow-up fires, policy allows | `policyDecision.action === 'allow'`; audit records `proactive: true`, `sourceRuleId`, `routingHint` |
| 2 | Watch trigger fires, policy allows | `action.type === 'proactive_watch_notify'`; audit records `watchAction` descriptor |

**Scenario 2 — Proactive action blocked pending approval (2 tests)**

| # | Test | Asserts |
|---|---|---|
| 3 | Policy returns `require_approval`; execution blocked | `auditEventId` available; `auditSink.events[0].approval === undefined` |
| 4 | Proactive engine state unaffected by policy blocking | Next evaluation suppresses with `cooldown` — proactive engine is isolated |

**Scenario 3 — Proactive action escalated (2 tests)**

| # | Test | Asserts |
|---|---|---|
| 5 | High-risk follow-up is escalated | `policyDecision.action === 'escalate'`; `riskLevel === 'high'`; audit records escalation |
| 6 | Critical-risk watch trigger is escalated | `action.type === 'proactive_watch_deploy'`; `riskLevel === 'critical'` |

**Scenario 4 — Approval resolution recorded cleanly (3 tests)**

| # | Test | Asserts |
|---|---|---|
| 7 | Approved: two audit events; approval event has `approved: true` and `approvedBy` | `auditSink.events.length === 2`; `approvalEvent.approval.approved === true` |
| 8 | Denied: approval event has `approved: false` and `comment` | `approvalEvent.approval.comment` preserved |
| 9 | Unknown `auditEventId` throws `PolicyError` | `policy.recordApproval('nonexistent', ...)` rejects with `PolicyError` |

**Scenario 5 — Audit/event correlation story is coherent (5 tests)**

| # | Test | Asserts |
|---|---|---|
| 10 | Multiple rules produce distinct audit events | Each event has correct `sourceRuleId` for its originating rule |
| 11 | Mixed follow-up + watch in one session → both in audit trail | `proactive_follow_up` and `proactive_watch_notify` events both present |
| 12 | Policy denial is audited | `policyDecision.action === 'deny'`; audit event recorded; proactive engine isolated |
| 13 | Approval event preserves full action context | `action.id`, `sessionId`, `userId`, `sourceRuleId` all intact after `recordApproval` |
| 14 | Structural isolation: engines independently testable | Both engines instantiate with empty state; no shared references |

---

## 5. Policy README Fix

`packages/policy/README.md` line 258 (proactive example) had a stale `evaluate()` call site that did not destructure `auditEventId`:

```ts
// BEFORE (stale)
const decision = await policyEngine.evaluate(action);

// AFTER (correct)
const { decision, auditEventId } = await policyEngine.evaluate(action);
```

This is required because `recordApproval` takes `auditEventId`. The fix was applied as part of this integration pass.

---

## 6. Implementation Order

| Step | Change | Location | Depends on |
|---|---|---|---|
| 1 | Read and verify proactive + policy package implementations | `packages/proactive/src/`, `packages/policy/src/` | — |
| 2 | Create `packages/integration/package.json` and `tsconfig.json` | `packages/integration/` | — |
| 3 | Implement `helpers.ts` from integration contract §2 field mapping | `packages/integration/src/helpers.ts` | Step 1 |
| 4 | Implement 14 integration tests across 5 scenarios | `packages/integration/src/integration.test.ts` | Steps 2–3 |
| 5 | Fix stale `evaluate()` return in policy README | `packages/policy/README.md` | Step 1 |
| 6 | Write integration proof document | `docs/architecture/v1-proactive-policy-integration-proof.md` | Steps 3–4 |
| 7 | Run `npm test` in `packages/integration` to confirm all 14 tests pass | — | Step 4 |

---

## 7. What This Plan Does NOT Change

- **`@relay-assistant/proactive`:** No code changes. All proactive engine behavior is used through its existing public API.
- **`@relay-assistant/policy`:** No code changes. Policy engine behavior is used through its existing public API. Only the README proactive example is corrected.
- **Package dependency graph at runtime:** Neither package gains a dependency on the other. `packages/integration` is `private: true` and is not published.
- **Existing tests in either package:** All proactive and policy unit tests continue to pass unchanged.

---

## 8. Definition of Done

- [x] `packages/integration/` exists with `package.json` (private), `tsconfig.json`, and `src/`
- [x] `helpers.ts` implements `followUpToAction` and `watchTriggerToAction` per contract §2
- [x] `integration.test.ts` covers all 5 required scenarios (14 tests)
- [x] All 14 integration tests pass (`npm test` in `packages/integration`)
- [x] `packages/policy/README.md` proactive example corrected to destructure `{ decision, auditEventId }`
- [x] `docs/architecture/v1-proactive-policy-integration-proof.md` documents all scenarios and the audit correlation chain
- [x] Neither proactive nor policy package imports the other
- [x] No new runtime dependencies added to either package

---

V1_PROACTIVE_POLICY_INTEGRATION_PLAN_READY
