# v1 Proactive ↔ Policy Integration Proof

**Status:** COMPLETE
**Date:** 2026-04-12
**Inputs:**
- `docs/architecture/v1-proactive-policy-integration-contract.md`
- `docs/architecture/v1-proactive-package-review-verdict.md`
- `docs/architecture/v1-policy-package-review-verdict.md`
- `packages/proactive/src/` (implementation)
- `packages/policy/src/` (implementation)

**Artifacts produced:**
- `packages/integration/src/helpers.ts` — minimal integration helpers
- `packages/integration/src/integration.test.ts` — integration proof tests
- `packages/integration/package.json` — test package manifest
- `packages/integration/tsconfig.json` — TypeScript configuration
- `packages/policy/README.md` — fixed stale `evaluate()` return shape in proactive example

---

## 1. Integration Model

The integration between `@relay-assistant/proactive` and `@relay-assistant/policy` is
**product-mediated composition**. Neither package imports the other. The only shared
concern is data shape: proactive outputs are translated into policy inputs by thin product
code (or the helpers in `packages/integration/src/helpers.ts`).

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

### Helpers (`packages/integration/src/helpers.ts`)

Two pure functions that encode the field-mapping rules from the integration contract (§2):

| Helper | Input | Output |
|---|---|---|
| `followUpToAction(decision, userId, id)` | `FollowUpDecision` + product-resolved context | `Action` with `type: 'proactive_follow_up'` |
| `watchTriggerToAction(trigger, sessionId, userId, id)` | `WatchTrigger` + product-resolved context | `Action` with `type: 'proactive_watch_<type>'` |

Both helpers set `proactive: true` and embed `sourceRuleId` in `action.metadata` for audit traceability.

The helpers do **not**:
- Import from `@relay-assistant/policy` internals
- Generate IDs (callers provide `id` — deterministic in tests, UUID in production)
- Own orchestration logic (calling evaluate, acting on results, managing state)

---

## 2. Proof Scenarios

All scenarios are exercised in `packages/integration/src/integration.test.ts`.

### Scenario 1 — Proactive action allowed by policy

**Test:** `Scenario 1 — proactive follow-up allowed by policy`

1. `proactive.evaluateFollowUp()` returns `decision.action === 'fire'`
2. `followUpToAction(decision, userId, id)` constructs a policy `Action`
3. `policy.evaluate(action)` returns `{ decision: { action: 'allow' }, auditEventId }`
4. `auditSink.events[0]` records the allow with `proactive: true` and `sourceRuleId`

Watch trigger variant also covered: `evaluateWatchRules()` → `watchTriggerToAction()` → `evaluate()` → `allow`.

### Scenario 2 — Proactive action blocked pending approval

**Test:** `Scenario 2 — proactive follow-up blocked pending approval`

1. A policy rule that returns `require_approval` for all proactive actions
2. Policy returns `{ decision: { action: 'require_approval' }, auditEventId }`
3. Execution is blocked — product holds `auditEventId` for later resolution
4. Audit records the pending state (no `approval` field yet)

**Isolation test:** Proactive engine reminder state advanced independently when `fire` was returned. After policy blocks, the product does NOT reset proactive state — the next wake-up produces `suppress` (cooldown), proving the engines are decoupled.

### Scenario 3 — Proactive action escalated

**Test:** `Scenario 3 — proactive action escalated`

1. A `classify: () => 'high'` classifier and a rule that escalates high-risk proactive actions
2. Policy returns `{ decision: { action: 'escalate' } }`
3. Audit records `decision.action === 'escalate'` with `sourceRuleId` intact

Watch trigger variant covered: `critical` risk watch action for a `deploy` action type.

### Scenario 4 — Approval resolution recorded cleanly

**Test:** `Scenario 4 — approval resolution recorded cleanly`

**Approved path:**
1. `policy.evaluate()` returns `require_approval` with `auditEventId`
2. Product presents approval UI; user approves
3. `policy.recordApproval(auditEventId, { approved: true, approvedBy, resolvedAt })`
4. `auditSink.events` has 2 entries: evaluation event + approval event
5. Approval event: `approval.approved === true`, full action context preserved

**Denied path:**
1. Same flow, `approved: false`, `comment` recorded

**Unknown auditEventId:**
1. `policy.recordApproval('nonexistent', ...)` throws `PolicyError`

### Scenario 5 — Audit/event correlation story is coherent

**Tests:** `Scenario 5 — audit/event correlation story is coherent`

1. **Multiple rules:** Two follow-up rules fire → two distinct audit events with correct `sourceRuleId` per event
2. **Mixed action types:** Follow-up + watch trigger in one session → both appear in audit trail, each with correct `action.type` and `sourceRuleId`
3. **Denied actions:** Policy denial is still audited; proactive engine is isolated (cooldown suppresses next eval, not the denial)
4. **Approval traceability:** After `recordApproval`, the approval event preserves the full original action context (`id`, `sessionId`, `userId`, `metadata.sourceRuleId`)
5. **Structural isolation:** Both engines instantiate independently with no shared state

---

## 3. Package Independence Proof

Neither package imports the other. This is enforced structurally:

- `packages/proactive/package.json` has no dependency on `@relay-assistant/policy`
- `packages/policy/package.json` has no dependency on `@relay-assistant/proactive`
- `packages/integration/` is `private: true` and lives outside both packages
- The helpers in `packages/integration/src/helpers.ts` import both type namespaces — this file is the **only** place where both type namespaces coexist

---

## 4. Audit Correlation Chain

For every proactive action that reaches policy evaluation, the full traceability chain is:

```
AuditEvent.id
  └── AuditEvent.action.id              (product-generated, unique per attempt)
      └── AuditEvent.action.proactive    (always true for proactive-originated actions)
      └── AuditEvent.action.type         ('proactive_follow_up' | 'proactive_watch_<type>')
      └── AuditEvent.action.metadata
          └── sourceRuleId               (→ proactive rule ID that originated the action)
          └── routingHint                (passthrough from FollowUpDecision)
          └── watchAction                (for watch triggers: full WatchAction descriptor)
          └── triggeredAt                (for watch triggers: ISO-8601 trigger timestamp)
```

If `recordApproval` was called, the approval event has:
```
AuditEvent.approval
  └── approved                           (boolean)
  └── approvedBy                         (identity of approver)
  └── resolvedAt                         (ISO-8601)
  └── comment                            (optional)
```

The approval event copies the full original action from the evaluation record, so `sourceRuleId` and all other metadata are available even in the approval event.

---

## 5. Outcome Semantics (Contract Compliance)

| Policy outcome | Follow-up behavior | Watch behavior | Proactive engine state |
|---|---|---|---|
| `allow` | Execute follow-up | Execute watch action | Unchanged by policy |
| `deny` | Silently suppress | Suppress this trigger; watch re-schedules normally | Engine already incremented reminder count on `fire`; product decides not to count delivery |
| `require_approval` | Block; enter approval flow | Block; watch re-schedules independently | Engine already incremented; product manages delivery state post-approval |
| `escalate` | Route to escalation; blocked | Route; watch re-schedules normally | Unchanged by policy |

**Critical invariant:** Policy outcomes do **not** flow back into the proactive engine. This is verified by the isolation test in Scenario 2.

---

## 6. Running the Integration Tests

```bash
cd packages/integration
npm install
npm test
```

The test file imports from `../../proactive/src/index.js` and `../../policy/src/index.js` using relative paths. No build step is required — vitest transpiles TypeScript at test time.

Both packages must be present in the monorepo. No workspace setup or cross-package linking is required.

---

## 7. Follow-Up Documentation Gaps (From Package Review Verdicts)

The integration proof does not close these gaps (they are spec-doc corrections, not integration concerns):

- `docs/specs/v1-proactive-spec.md` still contains stale `defer`, `cancelFollowUpRule`, and `suppressWhenActive` text (noted in `v1-proactive-package-review-verdict.md`)
- `docs/specs/v1-policy-spec.md` still describes the pre-reconciliation API (noted in `v1-policy-package-review-verdict.md`)

These are required follow-up doc corrections that should be addressed separately.

The `packages/policy/README.md` proactive example (stale `evaluate()` return shape, identified in `v1-policy-package-review-verdict.md`) has been fixed in this integration pass: line 258 now correctly destructures `{ decision, auditEventId }`.

---

V1_PROACTIVE_POLICY_INTEGRATION_READY
