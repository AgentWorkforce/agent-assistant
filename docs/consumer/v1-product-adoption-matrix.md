# v1 Product Adoption Matrix

**Date:** 2026-04-12
**Audience:** Sage, My Senior Dev (MSD), NightCTO
**Status:** CURRENT — reflects implemented packages as of 2026-04-12

This document gives each product a concrete, opinionated adoption path through the v1 SDK. It answers: which examples to start with, which packages to adopt now vs. later, and what each product keeps local.

---

## Quick Reference

| Product | Start with | Add next | Full-assembly target | Keep local |
|---|---|---|---|---|
| **Sage** | 01 → 02 | 04 (proactive) | 05 when policy needed | workspace knowledge, memory (until v1.1) |
| **MSD** | 01 → 03 | 02 (traits), then 05 | 05 | code review tools, PR workflows |
| **NightCTO** | 01 → 05 | (already at target) | 05 | specialist lineup, client-tier rules |

---

## Sage

### Priority packages
- `@agent-assistant/core` — start here
- `@agent-assistant/traits` — add immediately; traits are lightweight and establish identity early
- `@agent-assistant/proactive` — Sage's core value is follow-up and re-engagement; this is the priority path

### Deferred packages
- `@agent-assistant/policy` — add when proactive follow-ups need explicit gating (v1.2 milestone). Use `05-full-assembly.ts` for the bridge pattern when the time comes.
- `@agent-assistant/memory` — evaluate `@agent-relay/memory` first; do not build greenfield until assessed

### Adoption sequence

1. Wire the runtime using `01-minimal-assistant.ts` adapter pattern. Replace the in-memory stubs with Relay foundation transport adapters.
2. Add traits using `02-traits-assistant.ts`. Set Sage-specific trait values:
   ```ts
   createTraitsProvider(
     { voice: 'conversational', formality: 'professional', proactivity: 'high', riskPosture: 'moderate',
       domain: 'knowledge-and-workspace', vocabulary: ['digest', 'workspace', 'context'] },
     { preferMarkdown: true, preferredResponseLength: 800 },
   )
   ```
3. Add the proactive engine using `04-proactive-assistant.ts`. Replace `idleFollowUpRule` with Sage's knowledge follow-up heuristics. Replace `InMemorySchedulerBinding` with the Relay cron substrate.
4. When proactive follow-ups need gating: upgrade to `05-full-assembly.ts` pattern. Add the `followUpToAction` bridge and a policy engine with Sage-specific rules.

### What Sage keeps local

| Concern | Why |
|---|---|
| Workspace knowledge workflows | Product domain — does not generalize across products |
| Product-specific context shaping | Sage-specific prompt assembly |
| Slack-specific behavior | Not general enough for the SDK yet |
| Follow-up heuristics (specific conditions) | Sage product logic — use proactive rule `condition` functions |
| Memory retrieval | Until `@agent-assistant/memory` ships in v1.1 |

### Proof that the adoption path is realistic

`04-proactive-assistant.ts` demonstrates:
- Idle follow-up rule firing at the correct threshold
- Watch rule triggering on evaluation
- Engine retrievable from `runtime.get('proactive')`

Sage replaces `idleFollowUpRule.condition` with workspace-activity logic. Everything else is the same pattern.

---

## My Senior Dev (MSD)

### Priority packages
- `@agent-assistant/core` — start here
- `@agent-assistant/policy` — MSD code review operations need action gating and approval workflows immediately
- `@agent-assistant/traits` — establish assistant personality early

### Deferred packages
- `@agent-assistant/proactive` — add in v1.2 when automated PR follow-up behavior is prioritized
- `@agent-assistant/coordination` — when MSD's multi-specialist architecture is ready (v1.2)

### Adoption sequence

1. Wire the runtime using `01-minimal-assistant.ts` adapter pattern.
2. Add the policy engine using `03-policy-gated-assistant.ts`. Define MSD-specific rules:
   - `block-destructive` — deny actions that would irreversibly mutate production systems
   - `approve-pr-merge` — require approval before merging a PR
   - `approve-code-deploy` — require approval for deployments above a risk threshold
3. Add traits using `02-traits-assistant.ts`. Set MSD-specific trait values:
   ```ts
   createTraitsProvider(
     { voice: 'technical', formality: 'professional', proactivity: 'low', riskPosture: 'cautious',
       domain: 'code-review', vocabulary: ['diff', 'PR', 'review', 'merge', 'LGTM'] },
     { preferMarkdown: true, preferredResponseLength: 1000 },
   )
   ```
4. When proactive PR follow-ups are needed: add the proactive engine using `05-full-assembly.ts` as the composition reference.

### What MSD keeps local

| Concern | Why |
|---|---|
| Code review operations | MSD-specific tools — do not generalize |
| PR workflow logic | Review-specific orchestration |
| Review-specific escalation chains | Business rules belong in MSD, not the SDK |
| Coordinator delegation | Until `@agent-assistant/coordination` ships in v1.2 |
| Risk classifier logic | MSD's action risk taxonomy is domain-specific |

### Risk classifier example (product-owned)

```ts
// In MSD product code, not in the SDK
const msdClassifier: RiskClassifier = {
  classify(action) {
    if (action.type === 'merge_pr_to_main') return 'high';
    if (action.type === 'deploy_to_production') return 'critical';
    if (action.type === 'create_review_comment') return 'low';
    if (action.type === 'approve_pr') return 'medium';
    return 'medium';
  },
};
const policyEngine = createActionPolicy({ classifier: msdClassifier, auditSink });
```

### Proof that the adoption path is realistic

`03-policy-gated-assistant.ts` demonstrates:
- Rule priority order (block-critical evaluates before approve-high)
- All four decision branches in the capability handler
- Audit sink capturing every evaluation

MSD replaces the example rules with domain-specific rules. The capability handler branching pattern is identical.

---

## NightCTO

### Priority packages
- All four implemented packages from the start: `core` + `traits` + `policy` + `proactive`
- NightCTO's multi-client, monitoring-heavy, policy-governed architecture exercises all four

### No deferred packages in v1
- All four implemented packages are relevant to NightCTO immediately
- `coordination` and `connectivity` are deferred only because they have blocking dependency gaps — not a NightCTO priority call

### Adoption sequence

1. Wire the runtime using `01-minimal-assistant.ts` adapter pattern.
2. Go directly to `05-full-assembly.ts` as the assembly reference. This is the canonical composition for NightCTO.
3. Define NightCTO-specific components:

**Traits** — founder-facing, authoritative, broad domain:
```ts
createTraitsProvider(
  { voice: 'formal', formality: 'professional', proactivity: 'high', riskPosture: 'assertive',
    domain: 'executive-advisory', vocabulary: ['runway', 'burn', 'pipeline', 'escalate', 'client'] },
  { preferMarkdown: false, preferredResponseLength: 400 },
)
```

**Policy rules** — client-tier and escalation:
```ts
// Deny actions that violate client-tier agreements
policyEngine.registerRule({
  id: 'block-cross-client-data',
  priority: 1,
  evaluate(action, riskLevel) {
    if (action.metadata?.crossClientScope) {
      return { action: 'deny', ruleId: 'block-cross-client-data', riskLevel,
               reason: 'Cross-client data access is not permitted.' };
    }
    return null;
  },
});

// Escalate critical actions to the human CTO
policyEngine.registerRule({
  id: 'escalate-critical',
  priority: 5,
  evaluate(_action, riskLevel) {
    if (riskLevel === 'critical') {
      return { action: 'escalate', ruleId: 'escalate-critical', riskLevel };
    }
    return null;
  },
});
```

**Proactive rules** — monitoring re-engagement:
```ts
proactiveEngine.registerFollowUpRule({
  id: 'client-status-check-in',
  description: 'Re-engage if client thread has been silent during a monitored window.',
  routingHint: 'fast',
  messageTemplate: 'Checking in on your pipeline status — any updates?',
  policy: { maxReminders: 1, cooldownMs: 86_400_000, suppressWhenActive: true },
  condition(ctx) {
    const idleMs = new Date(ctx.scheduledAt).getTime() - new Date(ctx.lastActivityAt).getTime();
    return idleMs > 12 * 60 * 60 * 1000; // idle > 12 hours during monitoring window
  },
});
```

4. Add the `followUpToAction` bridge from `05-full-assembly.ts` to connect proactive decisions to policy evaluation.
5. Replace `InMemorySchedulerBinding` with the Relay cron substrate. Replace `InMemoryAuditSink` with NightCTO's audit infrastructure.

### What NightCTO keeps local

| Concern | Why |
|---|---|
| Founder/CTO communication style | Highly personalized — not generalizable |
| Specialist lineup choices | NightCTO's internal agent roster is product-specific |
| Client-tier policy rules | Business rules that vary per client |
| Per-client memory | Until `@agent-assistant/memory` ships in v1.1 |
| Escalation routing and notification | Product UX, not SDK contract |

### Proof that the adoption path is realistic

`05-full-assembly.ts` demonstrates the exact assembly NightCTO needs:
- Traits frozen and accessible in handlers
- Policy gates every reply
- Proactive follow-up decisions bridged to policy (`followUpToAction`)
- Both policy and proactive engines registered and retrievable from the runtime
- Unified audit trail across all action types

NightCTO replaces example trait values, policy rules, and proactive conditions with domain-specific equivalents. The wiring pattern is identical.

---

## Integration Proof Pattern (all products)

When testing the proactive → policy bridge in product code:

```ts
// This pattern comes from packages/integration/src/helpers.ts and 05-full-assembly.ts

// 1. Get proactive decisions
const decisions = await proactiveEngine.evaluateFollowUp({ sessionId, scheduledAt, lastActivityAt });

// 2. For each 'fire' decision, bridge to policy
for (const decision of decisions) {
  if (decision.action !== 'fire') continue;

  const action: Action = {
    id: generateId(),
    type: 'proactive_follow_up',
    description: decision.messageTemplate ?? `Follow-up from ${decision.ruleId}`,
    sessionId: decision.sessionId,
    userId,           // product resolves from session store
    proactive: true,  // required — marks as proactive origin
    metadata: { sourceRuleId: decision.ruleId, routingHint: decision.routingHint },
  };

  const { decision: policyDecision, auditEventId } = await policyEngine.evaluate(action);

  if (policyDecision.action === 'allow') {
    // execute the follow-up
  } else if (policyDecision.action === 'deny') {
    // suppress — do not count against reminder state
  } else if (policyDecision.action === 'require_approval') {
    // enter product-owned approval flow, then call policyEngine.recordApproval(auditEventId, ...)
  }
}
```

The two packages have no runtime dependency on each other. This product-owned bridge is the only coupling point.

---

## What This Document Is Not

This is not a migration plan. It does not describe existing product code to remove or restructure.

It is a **starting point for adoption** — a concrete guide to which examples to read first, which packages to wire today, and what to keep in product repos.

For the authoritative adoption sequencing rule, see `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md`.

---

V1_PRODUCT_ADOPTION_MATRIX_READY
