import { describe, it, expect, vi } from 'vitest';
import {
  createActionPolicy,
  defaultRiskClassifier,
  InMemoryAuditSink,
  PolicyError,
  RuleNotFoundError,
  ClassificationError,
} from './index.js';
import type {
  Action,
  PolicyRule,
  PolicyDecision,
  RiskClassifier,
  ApprovalResolution,
} from './index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'act-001',
    type: 'test_action',
    description: 'A test action',
    sessionId: 'sess-abc',
    userId: 'user-xyz',
    proactive: false,
    ...overrides,
  };
}

function makeAllowRule(id = 'allow-rule', priority?: number): PolicyRule {
  return {
    id,
    priority,
    evaluate: (_action, riskLevel) => ({
      action: 'allow',
      ruleId: id,
      riskLevel,
    }),
  };
}

function makeDenyRule(id = 'deny-rule', priority?: number): PolicyRule {
  return {
    id,
    priority,
    evaluate: (_action, riskLevel) => ({
      action: 'deny',
      ruleId: id,
      riskLevel,
      reason: 'Denied by rule.',
    }),
  };
}

function makeNullRule(id = 'null-rule', priority?: number): PolicyRule {
  return {
    id,
    priority,
    evaluate: () => null,
  };
}

// ─── T: Type Structural Tests ─────────────────────────────────────────────────

describe('T: Structural exports', () => {
  it('T-01: createActionPolicy returns object with evaluate, registerRule, removeRule, listRules, recordApproval', () => {
    const engine = createActionPolicy();
    expect(typeof engine.evaluate).toBe('function');
    expect(typeof engine.registerRule).toBe('function');
    expect(typeof engine.removeRule).toBe('function');
    expect(typeof engine.listRules).toBe('function');
    expect(typeof engine.recordApproval).toBe('function');
  });

  it('T-02: defaultRiskClassifier is exported and returns medium synchronously', () => {
    expect(defaultRiskClassifier).toBeDefined();
    expect(defaultRiskClassifier.classify(makeAction())).toBe('medium');
  });

  it('T-03: InMemoryAuditSink is exported and has events array and clear() method', () => {
    const sink = new InMemoryAuditSink();
    expect(Array.isArray(sink.events)).toBe(true);
    expect(typeof sink.clear).toBe('function');
  });

  it('T-04: PolicyError, RuleNotFoundError, ClassificationError are exported and extend Error', () => {
    const pe = new PolicyError('test');
    const rne = new RuleNotFoundError('r1');
    const ce = new ClassificationError('test');
    expect(pe).toBeInstanceOf(Error);
    expect(rne).toBeInstanceOf(Error);
    expect(ce).toBeInstanceOf(Error);
  });
});

// ─── C: Risk Classification ───────────────────────────────────────────────────

describe('C: Risk classification', () => {
  it('C-01: default classifier returns medium for any action', async () => {
    const engine = createActionPolicy();
    engine.registerRule(makeAllowRule());
    const result = await engine.evaluate(makeAction());
    expect(result.decision.riskLevel).toBe('medium');
  });

  it('C-02: custom synchronous classifier is called and result used', async () => {
    const classifier: RiskClassifier = { classify: () => 'low' };
    const engine = createActionPolicy({ classifier });
    engine.registerRule(makeAllowRule());
    const result = await engine.evaluate(makeAction());
    expect(result.decision.riskLevel).toBe('low');
  });

  it('C-03: custom async classifier is awaited and result used', async () => {
    const classifier: RiskClassifier = {
      classify: async () => {
        await Promise.resolve();
        return 'high';
      },
    };
    const engine = createActionPolicy({ classifier });
    engine.registerRule(makeAllowRule());
    const result = await engine.evaluate(makeAction());
    expect(result.decision.riskLevel).toBe('high');
  });

  it('C-04: classifier that throws causes ClassificationError from evaluate()', async () => {
    const classifier: RiskClassifier = {
      classify: () => {
        throw new Error('classifier internal error');
      },
    };
    const engine = createActionPolicy({ classifier });
    await expect(engine.evaluate(makeAction())).rejects.toThrow(ClassificationError);
  });

  it('C-05: unclassified action type routes to medium via default classifier', async () => {
    const engine = createActionPolicy();
    engine.registerRule(makeAllowRule());
    const result = await engine.evaluate(makeAction({ type: 'completely_unknown_type' }));
    expect(result.decision.riskLevel).toBe('medium');
  });

  it('C-06: classifier returning invalid string throws ClassificationError', async () => {
    const classifier = { classify: () => 'extreme' as never };
    const engine = createActionPolicy({ classifier });
    await expect(engine.evaluate(makeAction())).rejects.toThrow(ClassificationError);
    await expect(engine.evaluate(makeAction())).rejects.toThrow(
      "Classifier returned invalid risk level 'extreme'",
    );
  });

  it('C-07: classifier returning undefined throws ClassificationError', async () => {
    const classifier = { classify: () => undefined as never };
    const engine = createActionPolicy({ classifier });
    await expect(engine.evaluate(makeAction())).rejects.toThrow(ClassificationError);
  });

  it('C-08: classifier returning null throws ClassificationError', async () => {
    const classifier = { classify: () => null as never };
    const engine = createActionPolicy({ classifier });
    await expect(engine.evaluate(makeAction())).rejects.toThrow(ClassificationError);
  });
});

// ─── R: Rule Registration ─────────────────────────────────────────────────────

describe('R: Policy rule registration', () => {
  it('R-01: registerRule adds a rule; listRules returns it', () => {
    const engine = createActionPolicy();
    const rule = makeAllowRule('r1');
    engine.registerRule(rule);
    expect(engine.listRules()).toContain(rule);
  });

  it('R-02: listRules returns rules sorted by priority ascending', () => {
    const engine = createActionPolicy();
    const r10 = makeAllowRule('r10', 10);
    const r1 = makeAllowRule('r1', 1);
    const r5 = makeAllowRule('r5', 5);
    engine.registerRule(r10);
    engine.registerRule(r1);
    engine.registerRule(r5);
    const ids = engine.listRules().map((r) => r.id);
    expect(ids).toEqual(['r1', 'r5', 'r10']);
  });

  it('R-03: rules with same priority are returned in registration order', () => {
    const engine = createActionPolicy();
    const rA = makeAllowRule('rA', 5);
    const rB = makeAllowRule('rB', 5);
    const rC = makeAllowRule('rC', 5);
    engine.registerRule(rA);
    engine.registerRule(rB);
    engine.registerRule(rC);
    const ids = engine.listRules().map((r) => r.id);
    expect(ids).toEqual(['rA', 'rB', 'rC']);
  });

  it('R-04: removeRule removes existing rule; listRules no longer returns it', () => {
    const engine = createActionPolicy();
    engine.registerRule(makeAllowRule('r1'));
    engine.removeRule('r1');
    expect(engine.listRules().map((r) => r.id)).not.toContain('r1');
  });

  it('R-05: registerRule throws PolicyError when duplicate id is registered', () => {
    const engine = createActionPolicy();
    engine.registerRule(makeAllowRule('r1'));
    expect(() => engine.registerRule(makeAllowRule('r1'))).toThrow(PolicyError);
    expect(() => engine.registerRule(makeAllowRule('r1'))).toThrow(
      "Rule with id 'r1' is already registered.",
    );
  });

  it('R-06: removeRule throws RuleNotFoundError for unknown id', () => {
    const engine = createActionPolicy();
    expect(() => engine.removeRule('nonexistent')).toThrow(RuleNotFoundError);
  });

  it('R-07: registerRule duplicate throws PolicyError not RuleNotFoundError', () => {
    const engine = createActionPolicy();
    engine.registerRule(makeAllowRule('dup'));
    let thrownError: unknown;
    try {
      engine.registerRule(makeAllowRule('dup'));
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeInstanceOf(PolicyError);
    expect(thrownError).not.toBeInstanceOf(RuleNotFoundError);
  });
});

// ─── E: Policy Evaluation — Basic ────────────────────────────────────────────

describe('E: Policy evaluation — basic', () => {
  it('E-01: rule returning allow produces allow decision', async () => {
    const engine = createActionPolicy();
    engine.registerRule(makeAllowRule());
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('allow');
  });

  it('E-02: rule returning deny produces deny decision', async () => {
    const engine = createActionPolicy();
    engine.registerRule(makeDenyRule());
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('deny');
  });

  it('E-03: rule returning require_approval produces decision with approvalHint', async () => {
    const engine = createActionPolicy();
    const hint = { approver: 'user', prompt: 'Approve?', timeoutMs: 30000 };
    engine.registerRule({
      id: 'approval-rule',
      evaluate: (_a, riskLevel) => ({
        action: 'require_approval',
        ruleId: 'approval-rule',
        riskLevel,
        approvalHint: hint,
      }),
    });
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('require_approval');
    expect(decision.approvalHint).toEqual(hint);
  });

  it('E-04: rule returning escalate produces escalate decision', async () => {
    const engine = createActionPolicy();
    engine.registerRule({
      id: 'escalate-rule',
      evaluate: (_a, riskLevel) => ({
        action: 'escalate',
        ruleId: 'escalate-rule',
        riskLevel,
      }),
    });
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('escalate');
  });

  it('E-05: rule returning null defers to next rule; second rule decision is used', async () => {
    const engine = createActionPolicy();
    engine.registerRule(makeNullRule('skip', 1));
    engine.registerRule(makeDenyRule('deny', 2));
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('deny');
    expect(decision.ruleId).toBe('deny');
  });

  it('E-06: when no rule matches, fallback decision is returned with ruleId: fallback', async () => {
    const engine = createActionPolicy();
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.ruleId).toBe('fallback');
    expect(decision.action).toBe('require_approval'); // default fallback
  });

  it('E-07: evaluate returns EvaluationResult with decision and auditEventId', async () => {
    const engine = createActionPolicy();
    engine.registerRule(makeAllowRule());
    const result = await engine.evaluate(makeAction());
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('auditEventId');
    expect(typeof result.auditEventId).toBe('string');
    expect(result.auditEventId.length).toBeGreaterThan(0);
  });
});

// ─── P: Policy Evaluation — Priority ─────────────────────────────────────────

describe('P: Policy evaluation — priority', () => {
  it('P-01: lower priority number evaluates first', async () => {
    const engine = createActionPolicy();
    const evaluated: string[] = [];
    engine.registerRule({
      id: 'priority-10',
      priority: 10,
      evaluate: (_a, riskLevel) => {
        evaluated.push('priority-10');
        return { action: 'allow', ruleId: 'priority-10', riskLevel };
      },
    });
    engine.registerRule({
      id: 'priority-1',
      priority: 1,
      evaluate: (_a, riskLevel) => {
        evaluated.push('priority-1');
        return { action: 'allow', ruleId: 'priority-1', riskLevel };
      },
    });
    await engine.evaluate(makeAction());
    expect(evaluated[0]).toBe('priority-1');
  });

  it('P-02: first non-null result wins; lower-priority rules are not evaluated after a match', async () => {
    const engine = createActionPolicy();
    const evaluatedIds: string[] = [];
    engine.registerRule({
      id: 'first',
      priority: 1,
      evaluate: (_a, riskLevel) => {
        evaluatedIds.push('first');
        return { action: 'allow', ruleId: 'first', riskLevel };
      },
    });
    engine.registerRule({
      id: 'second',
      priority: 2,
      evaluate: (_a, riskLevel) => {
        evaluatedIds.push('second');
        return { action: 'deny', ruleId: 'second', riskLevel };
      },
    });
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('allow');
    expect(evaluatedIds).toEqual(['first']);
  });

  it('P-03: rules with same priority are evaluated in registration order', async () => {
    const engine = createActionPolicy();
    const order: string[] = [];
    for (const id of ['rA', 'rB', 'rC']) {
      engine.registerRule({
        id,
        priority: 5,
        evaluate: (_a, riskLevel) => {
          order.push(id);
          return { action: 'allow', ruleId: id, riskLevel };
        },
      });
    }
    await engine.evaluate(makeAction());
    expect(order[0]).toBe('rA');
  });

  it('P-04: after removeRule, removed rule is not evaluated', async () => {
    const engine = createActionPolicy();
    const spy = vi.fn().mockReturnValue(null);
    engine.registerRule({ id: 'removable', priority: 1, evaluate: spy });
    engine.registerRule(makeAllowRule('fallback-allow', 2));
    engine.removeRule('removable');
    await engine.evaluate(makeAction());
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── PG: Proactive Action Gating ─────────────────────────────────────────────

describe('PG: Proactive action gating', () => {
  it('PG-01: action.proactive=true is passed to context.proactive in rule evaluate', async () => {
    const engine = createActionPolicy();
    let capturedProactive: boolean | undefined;
    engine.registerRule({
      id: 'capture',
      evaluate: (_a, riskLevel, ctx) => {
        capturedProactive = ctx.proactive;
        return { action: 'allow', ruleId: 'capture', riskLevel };
      },
    });
    await engine.evaluate(makeAction({ proactive: true }));
    expect(capturedProactive).toBe(true);
  });

  it('PG-02: rule gating on proactive+high returns require_approval', async () => {
    const classifier: RiskClassifier = { classify: () => 'high' };
    const engine = createActionPolicy({ classifier });
    engine.registerRule({
      id: 'proactive-high-gate',
      priority: 1,
      evaluate: (_a, riskLevel, ctx) => {
        if (ctx.proactive && riskLevel === 'high') {
          return { action: 'require_approval', ruleId: 'proactive-high-gate', riskLevel };
        }
        return null;
      },
    });
    engine.registerRule(makeAllowRule('allow-fallback', 100));
    const { decision } = await engine.evaluate(makeAction({ proactive: true }));
    expect(decision.action).toBe('require_approval');
  });

  it('PG-03: non-proactive action with same risk passes proactive-only gate rule', async () => {
    const classifier: RiskClassifier = { classify: () => 'high' };
    const engine = createActionPolicy({ classifier });
    engine.registerRule({
      id: 'proactive-only-gate',
      priority: 1,
      evaluate: (_a, riskLevel, ctx) => {
        if (ctx.proactive && riskLevel === 'high') {
          return { action: 'require_approval', ruleId: 'proactive-only-gate', riskLevel };
        }
        return null;
      },
    });
    engine.registerRule(makeAllowRule('allow-non-proactive', 100));
    const { decision } = await engine.evaluate(makeAction({ proactive: false }));
    expect(decision.action).toBe('allow');
  });

  it('PG-04: proactive=false allows low-risk action through permissive rule', async () => {
    const classifier: RiskClassifier = { classify: () => 'low' };
    const engine = createActionPolicy({ classifier });
    engine.registerRule({
      id: 'low-allow',
      evaluate: (_a, riskLevel) => {
        if (riskLevel === 'low') {
          return { action: 'allow', ruleId: 'low-allow', riskLevel };
        }
        return null;
      },
    });
    const { decision } = await engine.evaluate(makeAction({ proactive: false }));
    expect(decision.action).toBe('allow');
  });
});

// ─── A: Approval Contract ─────────────────────────────────────────────────────

describe('A: Approval contract', () => {
  it('A-01: require_approval decision may include full ApprovalHint', async () => {
    const engine = createActionPolicy();
    engine.registerRule({
      id: 'approval-with-hint',
      evaluate: (_a, riskLevel) => ({
        action: 'require_approval',
        ruleId: 'approval-with-hint',
        riskLevel,
        approvalHint: {
          approver: 'workspace_admin',
          timeoutMs: 60000,
          prompt: 'Do you approve?',
        },
      }),
    });
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.approvalHint?.approver).toBe('workspace_admin');
    expect(decision.approvalHint?.timeoutMs).toBe(60000);
    expect(decision.approvalHint?.prompt).toBe('Do you approve?');
  });

  it('A-02: ApprovalResolution type has approved, approvedBy, resolvedAt, comment fields', () => {
    const resolution: ApprovalResolution = {
      approved: true,
      approvedBy: 'admin-user',
      resolvedAt: new Date().toISOString(),
      comment: 'Approved after review',
    };
    expect(resolution.approved).toBe(true);
    expect(resolution.approvedBy).toBe('admin-user');
    expect(resolution.resolvedAt).toBeTruthy();
    expect(resolution.comment).toBe('Approved after review');
  });

  it('A-03: audit event approval field can be populated via recordApproval', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule({
      id: 'approval-rule',
      evaluate: (_a, riskLevel) => ({
        action: 'require_approval',
        ruleId: 'approval-rule',
        riskLevel,
      }),
    });
    const { auditEventId } = await engine.evaluate(makeAction());
    const resolution: ApprovalResolution = {
      approved: true,
      approvedBy: 'user-xyz',
      resolvedAt: new Date().toISOString(),
    };
    await engine.recordApproval(auditEventId, resolution);
    const approvalEvent = sink.events[sink.events.length - 1];
    expect(approvalEvent.approval).toEqual(resolution);
  });
});

// ─── REC: recordApproval (reconciliation Decision 1) ─────────────────────────

describe('REC: recordApproval', () => {
  it('REC-01: recordApproval emits a new AuditEvent with approval field', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule(makeAllowRule());
    const { auditEventId } = await engine.evaluate(makeAction());
    const resolution: ApprovalResolution = {
      approved: false,
      approvedBy: 'reviewer',
      resolvedAt: new Date().toISOString(),
      comment: 'Rejected due to policy.',
    };
    await engine.recordApproval(auditEventId, resolution);
    expect(sink.events).toHaveLength(2); // original + approval
    expect(sink.events[1].approval).toEqual(resolution);
  });

  it('REC-02: recordApproval throws PolicyError for unknown auditEventId', async () => {
    const engine = createActionPolicy();
    await expect(
      engine.recordApproval('unknown-id-xyz', {
        approved: true,
        resolvedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(PolicyError);
    await expect(
      engine.recordApproval('unknown-id-xyz', {
        approved: true,
        resolvedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("Unknown auditEventId 'unknown-id-xyz'");
  });

  it('REC-03: recordApproval correlates back to original action and decision', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule(makeDenyRule());
    const action = makeAction({ id: 'corr-act', type: 'corr_type' });
    const { auditEventId } = await engine.evaluate(action);
    await engine.recordApproval(auditEventId, {
      approved: false,
      resolvedAt: new Date().toISOString(),
    });
    const approvalEvent = sink.events[1];
    expect(approvalEvent.action.id).toBe('corr-act');
    expect(approvalEvent.decision.action).toBe('deny');
  });

  it('REC-04: recordApproval emitted event has a new unique id', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule(makeAllowRule());
    const { auditEventId } = await engine.evaluate(makeAction());
    await engine.recordApproval(auditEventId, {
      approved: true,
      resolvedAt: new Date().toISOString(),
    });
    expect(sink.events[0].id).not.toBe(sink.events[1].id);
  });
});

// ─── AU: Audit Sink ───────────────────────────────────────────────────────────

describe('AU: Audit sink', () => {
  it('AU-01: InMemoryAuditSink records events from evaluate()', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule(makeAllowRule());
    await engine.evaluate(makeAction());
    expect(sink.events).toHaveLength(1);
  });

  it('AU-02: recorded audit event contains id, action, riskLevel, decision, evaluatedAt', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule(makeAllowRule());
    await engine.evaluate(makeAction());
    const event = sink.events[0];
    expect(event.id).toBeTruthy();
    expect(event.action).toBeDefined();
    expect(event.riskLevel).toBe('medium');
    expect(event.decision).toBeDefined();
    expect(event.evaluatedAt).toBeTruthy();
  });

  it('AU-03: audit event is recorded for allow decisions', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule(makeAllowRule());
    await engine.evaluate(makeAction());
    expect(sink.events[0].decision.action).toBe('allow');
  });

  it('AU-04: audit event is recorded for deny decisions', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule(makeDenyRule());
    await engine.evaluate(makeAction());
    expect(sink.events[0].decision.action).toBe('deny');
  });

  it('AU-05: audit event recorded for require_approval; clear() empties events', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule({
      id: 'approval',
      evaluate: (_a, riskLevel) => ({
        action: 'require_approval',
        ruleId: 'approval',
        riskLevel,
      }),
    });
    await engine.evaluate(makeAction());
    expect(sink.events[0].decision.action).toBe('require_approval');
    sink.clear();
    expect(sink.events).toHaveLength(0);
  });

  it('AU-06: auditEventId returned by evaluate() matches the recorded event id', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule(makeAllowRule());
    const { auditEventId } = await engine.evaluate(makeAction());
    expect(sink.events[0].id).toBe(auditEventId);
  });
});

// ─── ER: Error Handling ───────────────────────────────────────────────────────

describe('ER: Error handling', () => {
  it('ER-01: PolicyError has name === PolicyError and extends Error', () => {
    const err = new PolicyError('msg');
    expect(err.name).toBe('PolicyError');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('msg');
  });

  it('ER-02: RuleNotFoundError exposes ruleId; thrown by removeRule for unknown ids', () => {
    const engine = createActionPolicy();
    let caught: unknown;
    try {
      engine.removeRule('missing');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuleNotFoundError);
    expect((caught as RuleNotFoundError).ruleId).toBe('missing');
  });

  it('ER-03: ClassificationError wraps original classifier error as cause', async () => {
    const original = new Error('upstream failure');
    const classifier: RiskClassifier = {
      classify: () => {
        throw original;
      },
    };
    const engine = createActionPolicy({ classifier });
    let caught: unknown;
    try {
      await engine.evaluate(makeAction());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ClassificationError);
    expect((caught as ClassificationError).cause).toBe(original);
  });

  it('ER-04: rule that throws during evaluate wraps error in PolicyError', async () => {
    const engine = createActionPolicy();
    engine.registerRule({
      id: 'throwing-rule',
      evaluate: () => {
        throw new Error('rule internal error');
      },
    });
    await expect(engine.evaluate(makeAction())).rejects.toThrow(PolicyError);
    await expect(engine.evaluate(makeAction())).rejects.toThrow(
      "Rule 'throwing-rule' threw during evaluation",
    );
  });

  it('ER-05: ClassificationError has name === ClassificationError', () => {
    const err = new ClassificationError('msg');
    expect(err.name).toBe('ClassificationError');
  });

  it('ER-06: RuleNotFoundError has name === RuleNotFoundError', () => {
    const err = new RuleNotFoundError('r1');
    expect(err.name).toBe('RuleNotFoundError');
  });
});

// ─── FB: Fallback Decision ────────────────────────────────────────────────────

describe('FB: Fallback decision', () => {
  it('FB-01: default fallback is require_approval when no rule matches', async () => {
    const engine = createActionPolicy();
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('require_approval');
    expect(decision.ruleId).toBe('fallback');
  });

  it('FB-02: fallback can be configured to allow', async () => {
    const engine = createActionPolicy({ fallbackDecision: 'allow' });
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('allow');
    expect(decision.ruleId).toBe('fallback');
  });

  it('FB-03: fallback decision is recorded in audit sink', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink, fallbackDecision: 'deny' });
    await engine.evaluate(makeAction());
    expect(sink.events[0].decision.ruleId).toBe('fallback');
    expect(sink.events[0].decision.action).toBe('deny');
  });

  it('FB-04: fallback can be configured to escalate', async () => {
    const engine = createActionPolicy({ fallbackDecision: 'escalate' });
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('escalate');
  });

  it('FB-05: fallback reason indicates no rule matched', async () => {
    const engine = createActionPolicy();
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.reason).toContain('No registered rule matched');
  });
});

// ─── EE: End-to-End ───────────────────────────────────────────────────────────

describe('EE: End-to-end paths', () => {
  it('EE-01: full allow path: classify -> rule match -> allow -> audit recorded', async () => {
    const sink = new InMemoryAuditSink();
    const classifier: RiskClassifier = { classify: () => 'low' };
    const engine = createActionPolicy({ classifier, auditSink: sink });
    engine.registerRule({
      id: 'allow-low',
      evaluate: (_a, riskLevel) => {
        if (riskLevel === 'low') return { action: 'allow', ruleId: 'allow-low', riskLevel };
        return null;
      },
    });
    const { decision } = await engine.evaluate(makeAction({ type: 'read_data' }));
    expect(decision.action).toBe('allow');
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0].riskLevel).toBe('low');
  });

  it('EE-02: full deny path: classify -> rule match -> deny -> audit recorded', async () => {
    const sink = new InMemoryAuditSink();
    const classifier: RiskClassifier = { classify: () => 'critical' };
    const engine = createActionPolicy({ classifier, auditSink: sink });
    engine.registerRule({
      id: 'deny-critical',
      priority: 1,
      evaluate: (_a, riskLevel) => {
        if (riskLevel === 'critical') {
          return { action: 'deny', ruleId: 'deny-critical', riskLevel, reason: 'Critical denied.' };
        }
        return null;
      },
    });
    const { decision } = await engine.evaluate(makeAction({ type: 'destructive_op' }));
    expect(decision.action).toBe('deny');
    expect(sink.events[0].decision.reason).toBe('Critical denied.');
  });

  it('EE-03: full escalate path: classify -> rule match -> escalate -> audit recorded', async () => {
    const sink = new InMemoryAuditSink();
    const classifier: RiskClassifier = { classify: () => 'high' };
    const engine = createActionPolicy({ classifier, auditSink: sink });
    engine.registerRule({
      id: 'escalate-high',
      evaluate: (_a, riskLevel) => {
        if (riskLevel === 'high') {
          return { action: 'escalate', ruleId: 'escalate-high', riskLevel };
        }
        return null;
      },
    });
    const { decision } = await engine.evaluate(makeAction());
    expect(decision.action).toBe('escalate');
    expect(sink.events).toHaveLength(1);
  });

  it('EE-04: proactive + high + approval-hint full path', async () => {
    const sink = new InMemoryAuditSink();
    const classifier: RiskClassifier = { classify: () => 'high' };
    const engine = createActionPolicy({ classifier, auditSink: sink });
    engine.registerRule({
      id: 'proactive-gate',
      priority: 1,
      evaluate: (_a, riskLevel, ctx) => {
        if (ctx.proactive && riskLevel === 'high') {
          return {
            action: 'require_approval',
            ruleId: 'proactive-gate',
            riskLevel,
            approvalHint: {
              approver: 'user',
              prompt: `Proactive action: ${_a.description}. Approve?`,
            },
          };
        }
        return null;
      },
    });
    const { decision, auditEventId } = await engine.evaluate(
      makeAction({ proactive: true }),
    );
    expect(decision.action).toBe('require_approval');
    expect(decision.approvalHint?.approver).toBe('user');
    // Record approval resolution
    await engine.recordApproval(auditEventId, {
      approved: true,
      approvedBy: 'user-xyz',
      resolvedAt: new Date().toISOString(),
    });
    expect(sink.events).toHaveLength(2);
    expect(sink.events[1].approval?.approved).toBe(true);
  });
});

// ─── BND: Bounded eval-record map ────────────────────────────────────────────

describe('BND: Bounded eval-record map', () => {
  it('BND-01: eval records are evicted after 1000 entries; oldest id is no longer valid', async () => {
    const engine = createActionPolicy();
    engine.registerRule(makeAllowRule());

    // Evaluate 1001 times; keep track of the very first auditEventId
    let firstId: string | undefined;
    for (let i = 0; i < 1001; i++) {
      const { auditEventId } = await engine.evaluate(makeAction({ id: `act-${i}` }));
      if (i === 0) firstId = auditEventId;
    }

    // The first id should be evicted
    await expect(
      engine.recordApproval(firstId!, {
        approved: true,
        resolvedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(PolicyError);
  }, 15000);

  it('BND-02: most recent eval record is still accessible after eviction', async () => {
    const sink = new InMemoryAuditSink();
    const engine = createActionPolicy({ auditSink: sink });
    engine.registerRule(makeAllowRule());

    let lastId: string | undefined;
    for (let i = 0; i < 1001; i++) {
      const { auditEventId } = await engine.evaluate(makeAction({ id: `act-${i}` }));
      lastId = auditEventId;
    }

    // The most recent id should still be resolvable
    await expect(
      engine.recordApproval(lastId!, {
        approved: false,
        resolvedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  }, 15000);
});
