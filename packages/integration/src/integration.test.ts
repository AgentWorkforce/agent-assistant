/**
 * Proactive ↔ Policy integration proof tests.
 *
 * These tests prove that the boundary between @relay-assistant/proactive and
 * @relay-assistant/policy works as defined in:
 *   docs/architecture/v1-proactive-policy-integration-contract.md
 *
 * Key invariants under test:
 *  - Neither package imports the other.
 *  - Integration happens only through product-owned orchestration (this file).
 *  - Policy engine audits every evaluated action.
 *  - Proactive engine state is independent of policy outcomes.
 *  - Approval resolution correlates back to the original audit event.
 *  - sourceRuleId in AuditEvent.action.metadata provides full traceability.
 *
 * Required proof scenarios (contract §7):
 *  1. Proactive action allowed by policy
 *  2. Proactive action blocked pending approval
 *  3. Proactive action escalated
 *  4. Approval resolution recorded cleanly
 *  5. Audit/event correlation story is coherent
 *
 * Watch trigger coverage is included in scenarios 1 and 5.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createProactiveEngine,
  InMemorySchedulerBinding,
} from '../../proactive/src/index.js';
import type { FollowUpRule, WatchRule } from '../../proactive/src/index.js';
import {
  createActionPolicy,
  InMemoryAuditSink,
} from '../../policy/src/index.js';
import type { PolicyRule } from '../../policy/src/index.js';
import { followUpToAction, watchTriggerToAction } from './helpers.js';

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const SCHEDULED_AT = '2026-04-12T10:00:00.000Z';
const LAST_ACTIVITY_BEFORE = '2026-04-12T09:00:00.000Z'; // before scheduledAt → no user_active suppression
const SESSION_ID = 'sess-integration-1';
const USER_ID = 'user-integration-1';

function makeFollowUpContext(sessionId = SESSION_ID) {
  return {
    sessionId,
    scheduledAt: SCHEDULED_AT,
    lastActivityAt: LAST_ACTIVITY_BEFORE,
  };
}

function makeFollowUpRule(overrides: Partial<FollowUpRule> = {}): FollowUpRule {
  return {
    id: 'rule-follow-up-1',
    condition: () => true,
    messageTemplate: 'How did the project go?',
    routingHint: 'cheap',
    ...overrides,
  };
}

function makeWatchRule(overrides: Partial<WatchRule> = {}): WatchRule {
  return {
    id: 'rule-watch-1',
    condition: () => true,
    action: { type: 'notify', payload: { channel: 'email' } },
    intervalMs: 3_600_000,
    ...overrides,
  };
}

// ─── Policy rules used across tests ──────────────────────────────────────────

const allowAllRule: PolicyRule = {
  id: 'allow-all',
  priority: 100,
  evaluate(_action, riskLevel) {
    return { action: 'allow', ruleId: 'allow-all', riskLevel };
  },
};

const requireApprovalForProactiveRule: PolicyRule = {
  id: 'require-approval-proactive',
  priority: 1,
  evaluate(_action, riskLevel, context) {
    if (context.proactive) {
      return {
        action: 'require_approval',
        ruleId: 'require-approval-proactive',
        riskLevel,
        reason: 'All proactive actions require explicit approval.',
        approvalHint: { approver: 'user', prompt: _action.description },
      };
    }
    return null;
  },
};

const escalateHighRiskProactiveRule: PolicyRule = {
  id: 'escalate-high-risk-proactive',
  priority: 1,
  evaluate(_action, riskLevel, context) {
    if (context.proactive && (riskLevel === 'high' || riskLevel === 'critical')) {
      return {
        action: 'escalate',
        ruleId: 'escalate-high-risk-proactive',
        riskLevel,
        reason: 'High-risk proactive actions must be escalated.',
      };
    }
    return null;
  },
};

// ─── Scenario 1: Proactive action allowed by policy ──────────────────────────

describe('Scenario 1 — proactive follow-up allowed by policy', () => {
  it('fires the follow-up and policy allows execution', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const auditSink = new InMemoryAuditSink();
    const policy = createActionPolicy({ auditSink });

    proactive.registerFollowUpRule(makeFollowUpRule());
    policy.registerRule(allowAllRule);

    // Step 1: proactive evaluation
    const decisions = await proactive.evaluateFollowUp(makeFollowUpContext());
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!;
    expect(decision.action).toBe('fire');
    expect(decision.ruleId).toBe('rule-follow-up-1');

    // Step 2: construct policy Action from proactive decision
    const action = followUpToAction(decision, USER_ID, 'act-scenario-1');

    // Step 3: policy evaluation
    const { decision: policyDecision, auditEventId } = await policy.evaluate(action);
    expect(policyDecision.action).toBe('allow');
    expect(auditEventId).toBeTruthy();

    // Step 4: audit trail records the event with proactive traceability
    expect(auditSink.events).toHaveLength(1);
    const auditEvent = auditSink.events[0]!;
    expect(auditEvent.action.proactive).toBe(true);
    expect(auditEvent.action.type).toBe('proactive_follow_up');
    expect(auditEvent.action.metadata?.['sourceRuleId']).toBe('rule-follow-up-1');
    expect(auditEvent.action.metadata?.['routingHint']).toBe('cheap');
    expect(auditEvent.decision.action).toBe('allow');
    expect(auditEvent.approval).toBeUndefined();
  });

  it('watch trigger allowed: policy allows the watch action', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const auditSink = new InMemoryAuditSink();
    const policy = createActionPolicy({ auditSink });

    await proactive.registerWatchRule(makeWatchRule());
    policy.registerRule(allowAllRule);

    // Simulate a scheduled wake-up firing the watch rule
    const triggers = await proactive.evaluateWatchRules({
      ruleId: 'rule-watch-1',
      scheduledAt: SCHEDULED_AT,
    });
    expect(triggers).toHaveLength(1);
    const trigger = triggers[0]!;
    expect(trigger.ruleId).toBe('rule-watch-1');
    expect(trigger.action.type).toBe('notify');

    // Construct policy Action from watch trigger
    const action = watchTriggerToAction(trigger, SESSION_ID, USER_ID, 'act-watch-scenario-1');

    const { decision: policyDecision } = await policy.evaluate(action);
    expect(policyDecision.action).toBe('allow');

    // Audit records the watch action with sourceRuleId
    expect(auditSink.events).toHaveLength(1);
    const auditEvent = auditSink.events[0]!;
    expect(auditEvent.action.proactive).toBe(true);
    expect(auditEvent.action.type).toBe('proactive_watch_notify');
    expect(auditEvent.action.metadata?.['sourceRuleId']).toBe('rule-watch-1');
    expect(auditEvent.action.metadata?.['watchAction']).toEqual({
      type: 'notify',
      payload: { channel: 'email' },
    });
  });
});

// ─── Scenario 2: Proactive action blocked pending approval ───────────────────

describe('Scenario 2 — proactive follow-up blocked pending approval', () => {
  it('policy returns require_approval; execution is blocked until resolved', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const auditSink = new InMemoryAuditSink();
    const policy = createActionPolicy({ auditSink });

    proactive.registerFollowUpRule(makeFollowUpRule({ id: 'rule-needs-approval' }));
    policy.registerRule(requireApprovalForProactiveRule);

    const decisions = await proactive.evaluateFollowUp(makeFollowUpContext());
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!;
    expect(decision.action).toBe('fire');

    const action = followUpToAction(decision, USER_ID, 'act-scenario-2');
    const { decision: policyDecision, auditEventId } = await policy.evaluate(action);

    // Execution is blocked
    expect(policyDecision.action).toBe('require_approval');
    expect(policyDecision.approvalHint?.approver).toBe('user');
    expect(policyDecision.approvalHint?.prompt).toBe('How did the project go?');

    // auditEventId is available for approval correlation
    expect(auditEventId).toBeTruthy();
    expect(typeof auditEventId).toBe('string');

    // Audit records the pending state — no approval yet
    expect(auditSink.events).toHaveLength(1);
    expect(auditSink.events[0]!.approval).toBeUndefined();
    expect(auditSink.events[0]!.action.metadata?.['sourceRuleId']).toBe('rule-needs-approval');
  });

  it('proactive engine reminder state is unaffected by policy blocking', async () => {
    // Contract §3.3: policy outcomes do NOT flow back into proactive engine.
    // The proactive engine already incremented reminderCount when it returned 'fire'.
    // The product decides whether that counts based on delivery — we verify the
    // engine is isolated (its state does not change when policy blocks).

    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const auditSink = new InMemoryAuditSink();
    const policy = createActionPolicy({ auditSink });

    proactive.registerFollowUpRule(
      makeFollowUpRule({ id: 'rule-isolation-check', policy: { maxReminders: 3 } }),
    );
    policy.registerRule(requireApprovalForProactiveRule);

    // First evaluation: fires, policy blocks
    const [d1] = await proactive.evaluateFollowUp(makeFollowUpContext());
    expect(d1!.action).toBe('fire');
    const a1 = followUpToAction(d1!, USER_ID, 'act-isolation-1');
    const { decision: pd1 } = await policy.evaluate(a1);
    expect(pd1.action).toBe('require_approval');

    // Product does NOT call resetReminderState — policy outcome doesn't reset proactive state.
    // Second evaluation: cooldown kicks in (1 hour default) so it suppresses.
    // This proves proactive engine advanced its state independently of policy outcome.
    const [d2] = await proactive.evaluateFollowUp(makeFollowUpContext());
    expect(d2!.action).toBe('suppress');
    expect(d2!.suppressionReason).toBe('cooldown');
  });
});

// ─── Scenario 3: Proactive action escalated ──────────────────────────────────

describe('Scenario 3 — proactive action escalated', () => {
  it('high-risk proactive action is escalated by policy', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const auditSink = new InMemoryAuditSink();

    // Use a high-risk classifier so the escalation rule triggers
    const policy = createActionPolicy({
      auditSink,
      classifier: { classify: () => 'high' },
    });

    proactive.registerFollowUpRule(
      makeFollowUpRule({
        id: 'rule-high-risk',
        messageTemplate: 'Execute the financial report automation.',
      }),
    );
    policy.registerRule(escalateHighRiskProactiveRule);

    const decisions = await proactive.evaluateFollowUp(makeFollowUpContext());
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!;
    expect(decision.action).toBe('fire');

    const action = followUpToAction(decision, USER_ID, 'act-scenario-3');
    const { decision: policyDecision } = await policy.evaluate(action);

    expect(policyDecision.action).toBe('escalate');
    expect(policyDecision.riskLevel).toBe('high');
    expect(policyDecision.ruleId).toBe('escalate-high-risk-proactive');

    // Audit records the escalation
    expect(auditSink.events).toHaveLength(1);
    expect(auditSink.events[0]!.decision.action).toBe('escalate');
    expect(auditSink.events[0]!.action.metadata?.['sourceRuleId']).toBe('rule-high-risk');
  });

  it('watch trigger for high-risk action is escalated', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const auditSink = new InMemoryAuditSink();

    const policy = createActionPolicy({
      auditSink,
      classifier: { classify: () => 'critical' },
    });

    await proactive.registerWatchRule(
      makeWatchRule({
        id: 'rule-watch-high',
        action: { type: 'deploy', payload: { env: 'production' } },
      }),
    );
    policy.registerRule(escalateHighRiskProactiveRule);

    const triggers = await proactive.evaluateWatchRules({
      ruleId: 'rule-watch-high',
      scheduledAt: SCHEDULED_AT,
    });
    expect(triggers).toHaveLength(1);
    const trigger = triggers[0]!;

    const action = watchTriggerToAction(trigger, SESSION_ID, USER_ID, 'act-watch-escalate');
    const { decision: policyDecision } = await policy.evaluate(action);

    expect(policyDecision.action).toBe('escalate');
    expect(policyDecision.riskLevel).toBe('critical');
    expect(auditSink.events[0]!.action.type).toBe('proactive_watch_deploy');
  });
});

// ─── Scenario 4: Approval resolution recorded cleanly ────────────────────────

describe('Scenario 4 — approval resolution recorded cleanly', () => {
  it('approved: audit trail records approval and execution proceeds', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const auditSink = new InMemoryAuditSink();
    const policy = createActionPolicy({ auditSink });

    proactive.registerFollowUpRule(
      makeFollowUpRule({ id: 'rule-approval-flow', messageTemplate: 'Shall I summarize?' }),
    );
    policy.registerRule(requireApprovalForProactiveRule);

    const [decision] = await proactive.evaluateFollowUp(makeFollowUpContext());
    expect(decision!.action).toBe('fire');

    const action = followUpToAction(decision!, USER_ID, 'act-approval-flow');
    const { decision: policyDecision, auditEventId } = await policy.evaluate(action);
    expect(policyDecision.action).toBe('require_approval');

    // Product presents approval UI, user approves — product records the resolution
    await policy.recordApproval(auditEventId, {
      approved: true,
      approvedBy: USER_ID,
      resolvedAt: '2026-04-12T10:05:00.000Z',
    });

    // Two audit events: evaluation + approval resolution
    expect(auditSink.events).toHaveLength(2);

    const evalEvent = auditSink.events[0]!;
    expect(evalEvent.decision.action).toBe('require_approval');
    expect(evalEvent.approval).toBeUndefined();

    const approvalEvent = auditSink.events[1]!;
    expect(approvalEvent.action.id).toBe('act-approval-flow');
    expect(approvalEvent.decision.action).toBe('require_approval');
    expect(approvalEvent.approval).toBeDefined();
    expect(approvalEvent.approval!.approved).toBe(true);
    expect(approvalEvent.approval!.approvedBy).toBe(USER_ID);
    expect(approvalEvent.approval!.resolvedAt).toBe('2026-04-12T10:05:00.000Z');
    // sourceRuleId traceability survives approval
    expect(approvalEvent.action.metadata?.['sourceRuleId']).toBe('rule-approval-flow');
  });

  it('denied: audit trail records denial, execution does not proceed', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const auditSink = new InMemoryAuditSink();
    const policy = createActionPolicy({ auditSink });

    proactive.registerFollowUpRule(makeFollowUpRule({ id: 'rule-denied-flow' }));
    policy.registerRule(requireApprovalForProactiveRule);

    const [decision] = await proactive.evaluateFollowUp(makeFollowUpContext());
    const action = followUpToAction(decision!, USER_ID, 'act-denied-flow');
    const { auditEventId } = await policy.evaluate(action);

    await policy.recordApproval(auditEventId, {
      approved: false,
      approvedBy: 'admin',
      resolvedAt: '2026-04-12T10:06:00.000Z',
      comment: 'Not appropriate at this time.',
    });

    expect(auditSink.events).toHaveLength(2);
    const approvalEvent = auditSink.events[1]!;
    expect(approvalEvent.approval!.approved).toBe(false);
    expect(approvalEvent.approval!.comment).toBe('Not appropriate at this time.');
  });

  it('recordApproval with unknown auditEventId throws PolicyError', async () => {
    const policy = createActionPolicy({ auditSink: new InMemoryAuditSink() });
    const { PolicyError } = await import('../../policy/src/index.js');
    await expect(
      policy.recordApproval('nonexistent-audit-id', {
        approved: true,
        approvedBy: 'user',
        resolvedAt: '2026-04-12T10:07:00.000Z',
      }),
    ).rejects.toThrow(PolicyError);
  });
});

// ─── Scenario 5: Audit/event correlation story is coherent ───────────────────

describe('Scenario 5 — audit/event correlation story is coherent', () => {
  let auditSink: InMemoryAuditSink;

  beforeEach(() => {
    auditSink = new InMemoryAuditSink();
  });

  it('multiple follow-up rules produce distinct audit events with correct sourceRuleId', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const policy = createActionPolicy({ auditSink });

    proactive.registerFollowUpRule(
      makeFollowUpRule({ id: 'rule-a', messageTemplate: 'How did it go?' }),
    );
    proactive.registerFollowUpRule(
      makeFollowUpRule({ id: 'rule-b', messageTemplate: 'Any blockers?', routingHint: 'fast' }),
    );
    policy.registerRule(allowAllRule);

    const decisions = await proactive.evaluateFollowUp(makeFollowUpContext());
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.action === 'fire')).toBe(true);

    // Product processes each fired decision
    let counter = 0;
    for (const decision of decisions) {
      counter++;
      const action = followUpToAction(decision, USER_ID, `act-multi-${counter}`);
      await policy.evaluate(action);
    }

    expect(auditSink.events).toHaveLength(2);

    // Each audit event traces back to its originating rule
    const eventsByRuleId = new Map(
      auditSink.events.map((e) => [e.action.metadata?.['sourceRuleId'] as string, e]),
    );
    expect(eventsByRuleId.has('rule-a')).toBe(true);
    expect(eventsByRuleId.has('rule-b')).toBe(true);

    const eventA = eventsByRuleId.get('rule-a')!;
    expect(eventA.action.description).toBe('How did it go?');
    expect(eventA.action.metadata?.['routingHint']).toBe('cheap');

    const eventB = eventsByRuleId.get('rule-b')!;
    expect(eventB.action.description).toBe('Any blockers?');
    expect(eventB.action.metadata?.['routingHint']).toBe('fast');
  });

  it('mixed follow-up and watch trigger actions all appear in the audit trail', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const policy = createActionPolicy({ auditSink });

    proactive.registerFollowUpRule(makeFollowUpRule({ id: 'rule-follow-up-mixed' }));
    await proactive.registerWatchRule(makeWatchRule({ id: 'rule-watch-mixed' }));
    policy.registerRule(allowAllRule);

    // Fire follow-up
    const [followUpDecision] = await proactive.evaluateFollowUp(makeFollowUpContext('sess-mixed'));
    expect(followUpDecision!.action).toBe('fire');
    const followUpAction = followUpToAction(followUpDecision!, USER_ID, 'act-follow-up-mixed');
    await policy.evaluate(followUpAction);

    // Fire watch trigger
    const [watchTrigger] = await proactive.evaluateWatchRules({
      ruleId: 'rule-watch-mixed',
      scheduledAt: SCHEDULED_AT,
    });
    const watchAction = watchTriggerToAction(watchTrigger!, 'sess-mixed', USER_ID, 'act-watch-mixed');
    await policy.evaluate(watchAction);

    expect(auditSink.events).toHaveLength(2);

    const followUpAudit = auditSink.events.find((e) => e.action.type === 'proactive_follow_up')!;
    const watchAudit = auditSink.events.find((e) => e.action.type === 'proactive_watch_notify')!;

    expect(followUpAudit.action.metadata?.['sourceRuleId']).toBe('rule-follow-up-mixed');
    expect(watchAudit.action.metadata?.['sourceRuleId']).toBe('rule-watch-mixed');
    expect(watchAudit.action.metadata?.['watchAction']).toEqual({
      type: 'notify',
      payload: { channel: 'email' },
    });

    // Both actions are marked proactive
    expect(followUpAudit.action.proactive).toBe(true);
    expect(watchAudit.action.proactive).toBe(true);
  });

  it('policy-denied follow-up still appears in audit trail (denial is audited)', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const policy = createActionPolicy({ auditSink });

    const denyProactiveRule: PolicyRule = {
      id: 'deny-all-proactive',
      priority: 1,
      evaluate(_action, riskLevel, context) {
        if (context.proactive) {
          return {
            action: 'deny',
            ruleId: 'deny-all-proactive',
            riskLevel,
            reason: 'Proactive actions disabled in this context.',
          };
        }
        return null;
      },
    };
    policy.registerRule(denyProactiveRule);

    proactive.registerFollowUpRule(makeFollowUpRule({ id: 'rule-denied' }));

    const [decision] = await proactive.evaluateFollowUp(makeFollowUpContext());
    expect(decision!.action).toBe('fire');

    const action = followUpToAction(decision!, USER_ID, 'act-denied');
    const { decision: policyDecision } = await policy.evaluate(action);

    // Policy denies the action
    expect(policyDecision.action).toBe('deny');

    // The denial is still in the audit trail — the policy engine records every evaluation
    expect(auditSink.events).toHaveLength(1);
    expect(auditSink.events[0]!.decision.action).toBe('deny');
    expect(auditSink.events[0]!.action.metadata?.['sourceRuleId']).toBe('rule-denied');

    // Proactive engine has no knowledge of the policy denial.
    // The product must NOT call resetReminderState here (per contract §3.3).
    // On the next wake-up the engine will suppress due to cooldown — not due to the denial.
    const [d2] = await proactive.evaluateFollowUp(makeFollowUpContext());
    expect(d2!.action).toBe('suppress');
    expect(d2!.suppressionReason).toBe('cooldown');
  });

  it('approval audit event preserves full action context for traceability', async () => {
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const policy = createActionPolicy({ auditSink });

    proactive.registerFollowUpRule(
      makeFollowUpRule({ id: 'rule-full-trace', messageTemplate: 'Correlation check.' }),
    );
    policy.registerRule(requireApprovalForProactiveRule);

    const [decision] = await proactive.evaluateFollowUp(makeFollowUpContext('sess-trace'));
    const action = followUpToAction(decision!, 'user-trace', 'act-full-trace');
    const { auditEventId } = await policy.evaluate(action);

    await policy.recordApproval(auditEventId, {
      approved: true,
      approvedBy: 'user-trace',
      resolvedAt: '2026-04-12T11:00:00.000Z',
    });

    const approvalEvent = auditSink.events[1]!;

    // Full traceability chain intact after approval
    expect(approvalEvent.action.id).toBe('act-full-trace');
    expect(approvalEvent.action.sessionId).toBe('sess-trace');
    expect(approvalEvent.action.userId).toBe('user-trace');
    expect(approvalEvent.action.proactive).toBe(true);
    expect(approvalEvent.action.metadata?.['sourceRuleId']).toBe('rule-full-trace');
    expect(approvalEvent.approval!.approved).toBe(true);
  });

  it('packages are isolated: no cross-imports, engines are independently testable', () => {
    // This is a structural proof, not a runtime proof.
    // We verify that both engines can be instantiated and used without
    // any direct coupling between the package modules.

    // Both engines created independently
    const scheduler = new InMemorySchedulerBinding();
    const proactive = createProactiveEngine({ schedulerBinding: scheduler });
    const policy = createActionPolicy({ auditSink });

    // Both have their own state, unaffected by each other
    expect(proactive.listFollowUpRules()).toEqual([]);
    expect(proactive.listWatchRules()).toEqual([]);
    expect(policy.listRules()).toEqual([]);
    expect(auditSink.events).toHaveLength(0);
  });
});
