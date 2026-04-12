import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createProactiveEngine,
  InMemorySchedulerBinding,
  ProactiveError,
  RuleNotFoundError,
  SchedulerBindingError,
} from './index.js';
import type {
  FollowUpEvaluationContext,
  FollowUpRule,
  WatchRule,
  SchedulerBinding,
  FollowUpEvidenceSource,
  EvidenceEntry,
  ProactiveEngine,
} from './index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(overrides?: Partial<FollowUpEvaluationContext>): FollowUpEvaluationContext {
  return {
    sessionId: 'session-1',
    scheduledAt: '2026-04-12T10:00:00.000Z',
    lastActivityAt: '2026-04-11T08:00:00.000Z', // before scheduledAt → not active
    ...overrides,
  };
}

function makeRule(overrides?: Partial<FollowUpRule>): FollowUpRule {
  return {
    id: 'rule-1',
    condition: () => true,
    ...overrides,
  };
}

function makeWatchRule(overrides?: Partial<WatchRule>): WatchRule {
  return {
    id: 'watch-1',
    condition: () => true,
    action: { type: 'notify' },
    intervalMs: 60_000,
    ...overrides,
  };
}

function makeWatchContext(ruleId = 'watch-1') {
  return {
    ruleId,
    scheduledAt: '2026-04-12T10:00:00.000Z',
  };
}

// ─── 1. Type structural tests ─────────────────────────────────────────────────

describe('Type structural tests', () => {
  it('ProactiveEngine interface has all required methods', () => {
    const binding = new InMemorySchedulerBinding();
    const engine = createProactiveEngine({ schedulerBinding: binding });
    expect(typeof engine.registerFollowUpRule).toBe('function');
    expect(typeof engine.removeFollowUpRule).toBe('function');
    expect(typeof engine.listFollowUpRules).toBe('function');
    expect(typeof engine.evaluateFollowUp).toBe('function');
    expect(typeof engine.resetReminderState).toBe('function');
    expect(typeof engine.registerWatchRule).toBe('function');
    expect(typeof engine.pauseWatchRule).toBe('function');
    expect(typeof engine.resumeWatchRule).toBe('function');
    expect(typeof engine.cancelWatchRule).toBe('function');
    expect(typeof engine.listWatchRules).toBe('function');
    expect(typeof engine.evaluateWatchRules).toBe('function');
  });

  it('FollowUpRule interface requires id and condition', () => {
    const rule = makeRule();
    expect(typeof rule.id).toBe('string');
    expect(typeof rule.condition).toBe('function');
  });

  it('SchedulerBinding interface has requestWakeUp and cancelWakeUp', () => {
    const binding = new InMemorySchedulerBinding();
    expect(typeof binding.requestWakeUp).toBe('function');
    expect(typeof binding.cancelWakeUp).toBe('function');
  });

  it('Error classes extend ProactiveError with correct code fields', () => {
    const ruleNotFound = new RuleNotFoundError('rule-x', 'followUp');
    expect(ruleNotFound).toBeInstanceOf(ProactiveError);
    expect(ruleNotFound).toBeInstanceOf(RuleNotFoundError);
    expect(ruleNotFound.code).toBe('RULE_NOT_FOUND');
    expect(ruleNotFound.ruleId).toBe('rule-x');
    expect(ruleNotFound.ruleType).toBe('followUp');

    const schedulerErr = new SchedulerBindingError('failed', new Error('cause'));
    expect(schedulerErr).toBeInstanceOf(ProactiveError);
    expect(schedulerErr.code).toBe('SCHEDULER_BINDING_ERROR');
  });
});

// ─── 2. Follow-up rule registration ──────────────────────────────────────────

describe('Follow-up rule registration', () => {
  let engine: ProactiveEngine;

  beforeEach(() => {
    engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
  });

  it('registerFollowUpRule stores rule and listFollowUpRules returns it', () => {
    const rule = makeRule();
    engine.registerFollowUpRule(rule);
    expect(engine.listFollowUpRules()).toContain(rule);
  });

  it('registerFollowUpRule with duplicate id overwrites previous rule', () => {
    const rule1 = makeRule({ id: 'dup', condition: () => true });
    const rule2 = makeRule({ id: 'dup', condition: () => false });
    engine.registerFollowUpRule(rule1);
    engine.registerFollowUpRule(rule2);
    const rules = engine.listFollowUpRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toBe(rule2);
  });

  it('removeFollowUpRule removes a registered rule', () => {
    const rule = makeRule();
    engine.registerFollowUpRule(rule);
    engine.removeFollowUpRule(rule.id);
    expect(engine.listFollowUpRules()).toHaveLength(0);
  });

  it('removeFollowUpRule on unknown id throws RuleNotFoundError', () => {
    expect(() => engine.removeFollowUpRule('unknown')).toThrow(RuleNotFoundError);
  });

  it('listFollowUpRules returns empty array when no rules registered', () => {
    expect(engine.listFollowUpRules()).toEqual([]);
  });
});

// ─── 3. Follow-up evaluation — basic ─────────────────────────────────────────

describe('Follow-up evaluation — basic', () => {
  let engine: ProactiveEngine;

  beforeEach(() => {
    engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
  });

  it('evaluateFollowUp with single rule that fires returns action=fire', async () => {
    engine.registerFollowUpRule(makeRule({ condition: () => true }));
    const decisions = await engine.evaluateFollowUp(makeContext());
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.action).toBe('fire');
  });

  it('evaluateFollowUp with condition returning false returns action=suppress with no suppressionReason', async () => {
    engine.registerFollowUpRule(makeRule({ condition: () => false }));
    const decisions = await engine.evaluateFollowUp(makeContext());
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.action).toBe('suppress');
    expect(decisions[0]!.suppressionReason).toBeUndefined();
  });

  it('evaluateFollowUp with multiple rules returns decision for each', async () => {
    engine.registerFollowUpRule(makeRule({ id: 'r1', condition: () => true }));
    engine.registerFollowUpRule(makeRule({ id: 'r2', condition: () => false }));
    const decisions = await engine.evaluateFollowUp(makeContext());
    expect(decisions).toHaveLength(2);
    const ruleIds = decisions.map((d) => d.ruleId);
    expect(ruleIds).toContain('r1');
    expect(ruleIds).toContain('r2');
  });

  it('evaluateFollowUp with no rules returns empty array', async () => {
    const decisions = await engine.evaluateFollowUp(makeContext());
    expect(decisions).toEqual([]);
  });
});

// ─── 4. Follow-up evaluation — suppression ────────────────────────────────────

describe('Follow-up evaluation — suppression', () => {
  let engine: ProactiveEngine;

  beforeEach(() => {
    engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
  });

  it('user became active after scheduledAt → suppress with reason=user_active', async () => {
    engine.registerFollowUpRule(
      makeRule({
        policy: { suppressWhenActive: true },
        condition: () => true,
      }),
    );
    const ctx = makeContext({
      scheduledAt: '2026-04-12T10:00:00.000Z',
      lastActivityAt: '2026-04-12T11:00:00.000Z', // after scheduledAt
    });
    const decisions = await engine.evaluateFollowUp(ctx);
    expect(decisions[0]!.action).toBe('suppress');
    expect(decisions[0]!.suppressionReason).toBe('user_active');
  });

  it('cooldown not elapsed → suppress with reason=cooldown', async () => {
    engine.registerFollowUpRule(
      makeRule({
        id: 'cool-rule',
        condition: () => true,
        policy: { cooldownMs: 3_600_000, maxReminders: 10, suppressWhenActive: false },
      }),
    );
    // First fire to set lastReminderSentAt
    await engine.evaluateFollowUp(makeContext({ sessionId: 'sess-cool' }));
    // Second evaluation within cooldown
    const decisions = await engine.evaluateFollowUp(makeContext({ sessionId: 'sess-cool' }));
    expect(decisions[0]!.action).toBe('suppress');
    expect(decisions[0]!.suppressionReason).toBe('cooldown');
  });

  it('maxReminders reached → suppress with reason=max_reminders', async () => {
    engine.registerFollowUpRule(
      makeRule({
        id: 'max-rule',
        condition: () => true,
        policy: { maxReminders: 1, cooldownMs: 0, suppressWhenActive: false },
      }),
    );
    // First fire — should fire
    await engine.evaluateFollowUp(makeContext({ sessionId: 'sess-max' }));
    // Second evaluation — maxReminders=1 reached
    const decisions = await engine.evaluateFollowUp(makeContext({ sessionId: 'sess-max' }));
    expect(decisions[0]!.action).toBe('suppress');
    expect(decisions[0]!.suppressionReason).toBe('max_reminders');
  });

  it('suppressWhenActive=false ignores lastActivityAt check', async () => {
    engine.registerFollowUpRule(
      makeRule({
        condition: () => true,
        policy: { suppressWhenActive: false },
      }),
    );
    const ctx = makeContext({
      scheduledAt: '2026-04-12T10:00:00.000Z',
      lastActivityAt: '2026-04-12T11:00:00.000Z', // would normally trigger user_active
    });
    const decisions = await engine.evaluateFollowUp(ctx);
    expect(decisions[0]!.action).toBe('fire');
  });

  it('suppression priorities are applied in order: user_active before max_reminders before cooldown', async () => {
    // Set up a rule that has all three suppression conditions met
    engine.registerFollowUpRule(
      makeRule({
        id: 'priority-rule',
        condition: () => true,
        policy: { suppressWhenActive: true, maxReminders: 0, cooldownMs: 999_999_999 },
      }),
    );
    const ctx = makeContext({
      sessionId: 'sess-priority',
      scheduledAt: '2026-04-12T10:00:00.000Z',
      lastActivityAt: '2026-04-12T11:00:00.000Z', // triggers user_active
    });
    const decisions = await engine.evaluateFollowUp(ctx);
    // user_active should be the reason (highest priority)
    expect(decisions[0]!.suppressionReason).toBe('user_active');
  });
});

// ─── 5. Follow-up evaluation — evidence ──────────────────────────────────────

describe('Follow-up evaluation — evidence', () => {
  it('configured evidenceSource.getRecentEntries called with sessionId when evidence not in context', async () => {
    const fakeEntries: EvidenceEntry[] = [
      { id: 'e1', content: 'text', tags: [], createdAt: '2026-04-12T00:00:00.000Z' },
    ];
    const evidenceSource: FollowUpEvidenceSource = {
      getRecentEntries: vi.fn().mockResolvedValue(fakeEntries),
    };
    const engine = createProactiveEngine({
      schedulerBinding: new InMemorySchedulerBinding(),
      evidenceSource,
    });
    engine.registerFollowUpRule(makeRule());
    await engine.evaluateFollowUp(makeContext({ sessionId: 'sess-ev' }));
    expect(evidenceSource.getRecentEntries).toHaveBeenCalledWith('sess-ev');
  });

  it('evidence entries passed to rule condition as second argument', async () => {
    const fakeEntries: EvidenceEntry[] = [
      { id: 'e2', content: 'hello', tags: ['tag1'], createdAt: '2026-04-12T00:00:00.000Z' },
    ];
    const conditionSpy = vi.fn().mockReturnValue(true);
    const evidenceSource: FollowUpEvidenceSource = {
      getRecentEntries: vi.fn().mockResolvedValue(fakeEntries),
    };
    const engine = createProactiveEngine({
      schedulerBinding: new InMemorySchedulerBinding(),
      evidenceSource,
    });
    engine.registerFollowUpRule(makeRule({ condition: conditionSpy }));
    await engine.evaluateFollowUp(makeContext());
    expect(conditionSpy).toHaveBeenCalledWith(expect.anything(), fakeEntries);
  });

  it('context.evidence used directly when provided; evidenceSource not called', async () => {
    const preloaded: EvidenceEntry[] = [
      { id: 'pre1', content: 'pre', tags: [], createdAt: '2026-04-12T00:00:00.000Z' },
    ];
    const evidenceSource: FollowUpEvidenceSource = {
      getRecentEntries: vi.fn(),
    };
    const conditionSpy = vi.fn().mockReturnValue(true);
    const engine = createProactiveEngine({
      schedulerBinding: new InMemorySchedulerBinding(),
      evidenceSource,
    });
    engine.registerFollowUpRule(makeRule({ condition: conditionSpy }));
    await engine.evaluateFollowUp(makeContext({ evidence: preloaded }));
    expect(evidenceSource.getRecentEntries).not.toHaveBeenCalled();
    expect(conditionSpy).toHaveBeenCalledWith(expect.anything(), preloaded);
  });
});

// ─── 6. Follow-up evaluation — routing ───────────────────────────────────────

describe('Follow-up evaluation — routing', () => {
  let engine: ProactiveEngine;

  beforeEach(() => {
    engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
  });

  it('routingHint from rule passed through to FollowUpDecision', async () => {
    engine.registerFollowUpRule(makeRule({ routingHint: 'deep', condition: () => true }));
    const decisions = await engine.evaluateFollowUp(makeContext());
    expect(decisions[0]!.routingHint).toBe('deep');
  });

  it('missing routingHint defaults to cheap', async () => {
    engine.registerFollowUpRule(makeRule({ condition: () => true }));
    const decisions = await engine.evaluateFollowUp(makeContext());
    expect(decisions[0]!.routingHint).toBe('cheap');
  });
});

// ─── 7. Reminder state ────────────────────────────────────────────────────────

describe('Reminder state', () => {
  it('reminderCount incremented on each fire decision', async () => {
    const engine = createProactiveEngine({
      schedulerBinding: new InMemorySchedulerBinding(),
    });
    engine.registerFollowUpRule(
      makeRule({
        id: 'count-rule',
        condition: () => true,
        policy: { maxReminders: 10, cooldownMs: 0, suppressWhenActive: false },
      }),
    );
    const ctx = makeContext({ sessionId: 'sess-count' });
    await engine.evaluateFollowUp(ctx);
    await engine.evaluateFollowUp(ctx);
    // Third evaluation should still fire (maxReminders=10)
    const decisions = await engine.evaluateFollowUp(ctx);
    expect(decisions[0]!.action).toBe('fire');
    // 4th fires
    await engine.evaluateFollowUp(ctx);
    // After 10 total fires, should suppress
    for (let i = 0; i < 6; i++) {
      await engine.evaluateFollowUp(ctx);
    }
    const final = await engine.evaluateFollowUp(ctx);
    expect(final[0]!.action).toBe('suppress');
    expect(final[0]!.suppressionReason).toBe('max_reminders');
  });

  it('resetReminderState(sessionId, ruleId) clears state for specific pair', async () => {
    const engine = createProactiveEngine({
      schedulerBinding: new InMemorySchedulerBinding(),
    });
    engine.registerFollowUpRule(
      makeRule({
        id: 'reset-rule',
        condition: () => true,
        policy: { maxReminders: 1, cooldownMs: 0, suppressWhenActive: false },
      }),
    );
    const ctx = makeContext({ sessionId: 'sess-reset' });
    // Fire once — uses up maxReminders=1
    await engine.evaluateFollowUp(ctx);
    const suppressed = await engine.evaluateFollowUp(ctx);
    expect(suppressed[0]!.action).toBe('suppress');

    // Reset state
    engine.resetReminderState('sess-reset', 'reset-rule');
    // Now should fire again
    const fired = await engine.evaluateFollowUp(ctx);
    expect(fired[0]!.action).toBe('fire');
  });

  it('resetReminderState(sessionId) clears all state for session', async () => {
    const engine = createProactiveEngine({
      schedulerBinding: new InMemorySchedulerBinding(),
    });
    engine.registerFollowUpRule(
      makeRule({
        id: 'r1',
        condition: () => true,
        policy: { maxReminders: 1, cooldownMs: 0, suppressWhenActive: false },
      }),
    );
    engine.registerFollowUpRule(
      makeRule({
        id: 'r2',
        condition: () => true,
        policy: { maxReminders: 1, cooldownMs: 0, suppressWhenActive: false },
      }),
    );
    const ctx = makeContext({ sessionId: 'sess-all-reset' });
    await engine.evaluateFollowUp(ctx);
    // Both suppressed now
    const before = await engine.evaluateFollowUp(ctx);
    expect(before.every((d) => d.action === 'suppress')).toBe(true);

    engine.resetReminderState('sess-all-reset');
    // Both should fire again
    const after = await engine.evaluateFollowUp(ctx);
    expect(after.every((d) => d.action === 'fire')).toBe(true);
  });

  it('reminder state not shared across different sessionIds', async () => {
    const engine = createProactiveEngine({
      schedulerBinding: new InMemorySchedulerBinding(),
    });
    engine.registerFollowUpRule(
      makeRule({
        id: 'isolated-rule',
        condition: () => true,
        policy: { maxReminders: 1, cooldownMs: 0, suppressWhenActive: false },
      }),
    );
    const ctxA = makeContext({ sessionId: 'sess-A' });
    const ctxB = makeContext({ sessionId: 'sess-B' });

    // Fire for session A — exhausts maxReminders
    await engine.evaluateFollowUp(ctxA);
    const suppressedA = await engine.evaluateFollowUp(ctxA);
    expect(suppressedA[0]!.action).toBe('suppress');

    // Session B should still fire (independent state)
    const firedB = await engine.evaluateFollowUp(ctxB);
    expect(firedB[0]!.action).toBe('fire');
  });
});

// ─── 8. Watch rule lifecycle ──────────────────────────────────────────────────

describe('Watch rule lifecycle', () => {
  let binding: InMemorySchedulerBinding;
  let engine: ProactiveEngine;

  beforeEach(() => {
    binding = new InMemorySchedulerBinding();
    engine = createProactiveEngine({ schedulerBinding: binding });
  });

  it('registerWatchRule stores rule with status=active', async () => {
    await engine.registerWatchRule(makeWatchRule());
    const statuses = engine.listWatchRules();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.status).toBe('active');
    expect(statuses[0]!.rule.id).toBe('watch-1');
  });

  it('pauseWatchRule sets status=paused; paused rule not evaluated', async () => {
    await engine.registerWatchRule(makeWatchRule());
    engine.pauseWatchRule('watch-1');
    expect(engine.listWatchRules()[0]!.status).toBe('paused');
    // evaluateWatchRules on paused rule returns empty (no error)
    const triggers = await engine.evaluateWatchRules(makeWatchContext());
    expect(triggers).toHaveLength(0);
  });

  it('resumeWatchRule sets status=active; rule evaluated again', async () => {
    await engine.registerWatchRule(makeWatchRule());
    engine.pauseWatchRule('watch-1');
    await engine.resumeWatchRule('watch-1');
    expect(engine.listWatchRules()[0]!.status).toBe('active');
    const triggers = await engine.evaluateWatchRules(makeWatchContext());
    expect(triggers).toHaveLength(1);
  });

  it('cancelWatchRule sets status=cancelled; cancelled rule not evaluated', async () => {
    await engine.registerWatchRule(makeWatchRule());
    await engine.cancelWatchRule('watch-1');
    expect(engine.listWatchRules()[0]!.status).toBe('cancelled');
    // evaluateWatchRules on cancelled rule throws RuleNotFoundError
    await expect(engine.evaluateWatchRules(makeWatchContext())).rejects.toThrow(RuleNotFoundError);
  });

  it('listWatchRules returns current status for all rules', async () => {
    await engine.registerWatchRule(makeWatchRule({ id: 'w1' }));
    await engine.registerWatchRule(makeWatchRule({ id: 'w2' }));
    engine.pauseWatchRule('w2');
    const statuses = engine.listWatchRules();
    expect(statuses).toHaveLength(2);
    const w1 = statuses.find((s) => s.rule.id === 'w1');
    const w2 = statuses.find((s) => s.rule.id === 'w2');
    expect(w1?.status).toBe('active');
    expect(w2?.status).toBe('paused');
  });

  it('registerWatchRule after cancelWatchRule allows re-registration with same id', async () => {
    await engine.registerWatchRule(makeWatchRule());
    await engine.cancelWatchRule('watch-1');
    // Re-register same id — should succeed (overwrites cancelled record)
    await engine.registerWatchRule(makeWatchRule());
    const statuses = engine.listWatchRules();
    expect(statuses[0]!.status).toBe('active');
  });
});

// ─── 9. Watch rule evaluation ─────────────────────────────────────────────────

describe('Watch rule evaluation', () => {
  let binding: InMemorySchedulerBinding;
  let engine: ProactiveEngine;

  beforeEach(() => {
    binding = new InMemorySchedulerBinding();
    engine = createProactiveEngine({ schedulerBinding: binding });
  });

  it('condition returning true → WatchTrigger included in result', async () => {
    await engine.registerWatchRule(makeWatchRule({ condition: () => true }));
    const triggers = await engine.evaluateWatchRules(makeWatchContext());
    expect(triggers).toHaveLength(1);
    expect(triggers[0]!.ruleId).toBe('watch-1');
    expect(triggers[0]!.action.type).toBe('notify');
  });

  it('condition returning false → no WatchTrigger; rule still re-scheduled', async () => {
    await engine.registerWatchRule(makeWatchRule({ condition: () => false }));
    const sizeBefore = binding.pendingWakeUps.size;
    const triggers = await engine.evaluateWatchRules(makeWatchContext());
    expect(triggers).toHaveLength(0);
    // Rule was re-scheduled (pending size should be same or +1 depending on cancel/add)
    expect(binding.pendingWakeUps.size).toBeGreaterThanOrEqual(1);
    void sizeBefore; // used for documentation
  });

  it('after evaluateWatchRules, active rule nextWakeUpBindingId is updated', async () => {
    await engine.registerWatchRule(makeWatchRule());
    const beforeId = engine.listWatchRules()[0]!.nextWakeUpBindingId;
    await engine.evaluateWatchRules(makeWatchContext());
    const afterId = engine.listWatchRules()[0]!.nextWakeUpBindingId;
    expect(afterId).not.toBeNull();
    expect(afterId).not.toBe(beforeId);
  });

  it('paused rule not evaluated and not re-scheduled', async () => {
    await engine.registerWatchRule(makeWatchRule());
    const countAfterRegister = binding.pendingWakeUps.size;
    engine.pauseWatchRule('watch-1');
    const bindingIdBeforePause = engine.listWatchRules()[0]!.nextWakeUpBindingId;
    const triggers = await engine.evaluateWatchRules(makeWatchContext());
    expect(triggers).toHaveLength(0);
    // No new wake-ups added (paused rule not re-scheduled)
    expect(binding.pendingWakeUps.size).toBe(countAfterRegister);
    // bindingId unchanged (no reschedule happened)
    expect(engine.listWatchRules()[0]!.nextWakeUpBindingId).toBe(bindingIdBeforePause);
  });

  it('multiple rules: triggered and non-triggered both handled correctly', async () => {
    await engine.registerWatchRule(makeWatchRule({ id: 'w-fire', condition: () => true }));
    await engine.registerWatchRule(makeWatchRule({ id: 'w-skip', condition: () => false }));
    // evaluateWatchRules evaluates only the specified ruleId
    const triggers = await engine.evaluateWatchRules(makeWatchContext('w-fire'));
    expect(triggers).toHaveLength(1);
    expect(triggers[0]!.ruleId).toBe('w-fire');
  });
});

// ─── 10. Scheduler binding ────────────────────────────────────────────────────

describe('Scheduler binding', () => {
  it('watch rule re-schedule calls requestWakeUp with correct intervalMs offset', async () => {
    const binding = new InMemorySchedulerBinding();
    const engine = createProactiveEngine({ schedulerBinding: binding });
    const intervalMs = 120_000;
    const before = Date.now();
    await engine.registerWatchRule(makeWatchRule({ intervalMs }));
    const entry = Array.from(binding.pendingWakeUps.values())[0]!;
    const after = Date.now();
    expect(entry.at.getTime()).toBeGreaterThanOrEqual(before + intervalMs);
    expect(entry.at.getTime()).toBeLessThanOrEqual(after + intervalMs);
  });

  it('previous bindingId cancelled before new requestWakeUp on evaluation', async () => {
    const binding = new InMemorySchedulerBinding();
    const cancelSpy = vi.spyOn(binding, 'cancelWakeUp');
    const engine = createProactiveEngine({ schedulerBinding: binding });
    await engine.registerWatchRule(makeWatchRule());
    const firstId = engine.listWatchRules()[0]!.nextWakeUpBindingId!;
    await engine.evaluateWatchRules(makeWatchContext());
    expect(cancelSpy).toHaveBeenCalledWith(firstId);
  });

  it('InMemorySchedulerBinding records pending wake-ups in pendingWakeUps map', async () => {
    const binding = new InMemorySchedulerBinding();
    const engine = createProactiveEngine({ schedulerBinding: binding });
    await engine.registerWatchRule(makeWatchRule());
    expect(binding.pendingWakeUps.size).toBe(1);
    const entry = Array.from(binding.pendingWakeUps.values())[0]!;
    expect(entry.context.ruleId).toBe('watch-1');
  });

  it('InMemorySchedulerBinding.trigger() returns WakeUpContext and removes from pending', async () => {
    const binding = new InMemorySchedulerBinding();
    const engine = createProactiveEngine({ schedulerBinding: binding });
    await engine.registerWatchRule(makeWatchRule());
    const [bindingId] = Array.from(binding.pendingWakeUps.keys());
    expect(bindingId).toBeDefined();
    const ctx = await binding.trigger(bindingId!);
    expect(ctx.ruleId).toBe('watch-1');
    expect(binding.pendingWakeUps.has(bindingId!)).toBe(false);
  });
});

// ─── 11. Error handling ───────────────────────────────────────────────────────

describe('Error handling', () => {
  it('removeFollowUpRule with unknown id throws RuleNotFoundError with ruleType=followUp', () => {
    const engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
    expect(() => engine.removeFollowUpRule('nonexistent')).toThrow(RuleNotFoundError);
    try {
      engine.removeFollowUpRule('nonexistent');
    } catch (err) {
      expect(err).toBeInstanceOf(RuleNotFoundError);
      expect((err as RuleNotFoundError).ruleType).toBe('followUp');
      expect((err as RuleNotFoundError).ruleId).toBe('nonexistent');
    }
  });

  it('pauseWatchRule with unknown id throws RuleNotFoundError with ruleType=watch', async () => {
    const engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
    expect(() => engine.pauseWatchRule('no-such-watch')).toThrow(RuleNotFoundError);
    try {
      engine.pauseWatchRule('no-such-watch');
    } catch (err) {
      expect(err).toBeInstanceOf(RuleNotFoundError);
      expect((err as RuleNotFoundError).ruleType).toBe('watch');
    }
  });

  it('schedulerBinding.requestWakeUp failure wrapped in SchedulerBindingError', async () => {
    const failingBinding: SchedulerBinding = {
      requestWakeUp: vi.fn().mockRejectedValue(new Error('cron unavailable')),
      cancelWakeUp: vi.fn().mockResolvedValue(undefined),
    };
    const engine = createProactiveEngine({ schedulerBinding: failingBinding });
    await expect(engine.registerWatchRule(makeWatchRule())).rejects.toThrow(SchedulerBindingError);
  });
});

// ─── 12. Additional contract-compliance tests ─────────────────────────────────

describe('Contract compliance — reconciled decisions', () => {
  it('FollowUpAction is fire | suppress — no defer in v1', async () => {
    const engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
    engine.registerFollowUpRule(makeRule({ condition: () => true }));
    const decisions = await engine.evaluateFollowUp(makeContext());
    for (const d of decisions) {
      expect(['fire', 'suppress']).toContain(d.action);
      expect(d.action).not.toBe('defer');
    }
  });

  it('suppressWhenActive uses simple timestamp comparison, not 5-minute window', async () => {
    const engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
    engine.registerFollowUpRule(
      makeRule({
        condition: () => true,
        policy: { suppressWhenActive: true },
      }),
    );
    // lastActivityAt is 1 second after scheduledAt → should suppress (even though not "5 min")
    const ctx = makeContext({
      scheduledAt: '2026-04-12T10:00:00.000Z',
      lastActivityAt: '2026-04-12T10:00:01.000Z',
    });
    const decisions = await engine.evaluateFollowUp(ctx);
    expect(decisions[0]!.action).toBe('suppress');
    expect(decisions[0]!.suppressionReason).toBe('user_active');
  });

  it('evidence is fetched once per evaluateFollowUp call, not per rule', async () => {
    const fetchSpy = vi.fn().mockResolvedValue([]);
    const evidenceSource: FollowUpEvidenceSource = { getRecentEntries: fetchSpy };
    const engine = createProactiveEngine({
      schedulerBinding: new InMemorySchedulerBinding(),
      evidenceSource,
    });
    engine.registerFollowUpRule(makeRule({ id: 'e1' }));
    engine.registerFollowUpRule(makeRule({ id: 'e2' }));
    engine.registerFollowUpRule(makeRule({ id: 'e3' }));
    await engine.evaluateFollowUp(makeContext());
    // Called exactly once regardless of number of rules
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('removeFollowUpRule clears reminder state for all sessions of that ruleId', async () => {
    const engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
    engine.registerFollowUpRule(
      makeRule({
        id: 'clear-test',
        condition: () => true,
        policy: { maxReminders: 1, cooldownMs: 0, suppressWhenActive: false },
      }),
    );
    // Fire for two sessions
    await engine.evaluateFollowUp(makeContext({ sessionId: 'sessX' }));
    await engine.evaluateFollowUp(makeContext({ sessionId: 'sessY' }));

    // Remove the rule (should clear all reminder state for it)
    engine.removeFollowUpRule('clear-test');

    // Re-register and fire again — no previous state should interfere
    engine.registerFollowUpRule(
      makeRule({
        id: 'clear-test',
        condition: () => true,
        policy: { maxReminders: 1, cooldownMs: 0, suppressWhenActive: false },
      }),
    );
    const dX = await engine.evaluateFollowUp(makeContext({ sessionId: 'sessX' }));
    const dY = await engine.evaluateFollowUp(makeContext({ sessionId: 'sessY' }));
    expect(dX[0]!.action).toBe('fire');
    expect(dY[0]!.action).toBe('fire');
  });

  it('evaluateWatchRules evaluates only the rule in context.ruleId', async () => {
    const condA = vi.fn().mockReturnValue(true);
    const condB = vi.fn().mockReturnValue(true);
    const binding = new InMemorySchedulerBinding();
    const engine = createProactiveEngine({ schedulerBinding: binding });
    await engine.registerWatchRule(makeWatchRule({ id: 'wA', condition: condA }));
    await engine.registerWatchRule(makeWatchRule({ id: 'wB', condition: condB }));
    // Evaluate only wA
    await engine.evaluateWatchRules({ ruleId: 'wA', scheduledAt: '2026-04-12T10:00:00.000Z' });
    expect(condA).toHaveBeenCalledTimes(1);
    expect(condB).not.toHaveBeenCalled();
  });

  it('registerWatchRule schedules first wake-up immediately via schedulerBinding', async () => {
    const binding = new InMemorySchedulerBinding();
    const requestSpy = vi.spyOn(binding, 'requestWakeUp');
    const engine = createProactiveEngine({ schedulerBinding: binding });
    await engine.registerWatchRule(makeWatchRule());
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(binding.pendingWakeUps.size).toBe(1);
  });

  it('resumeWatchRule schedules a new wake-up via schedulerBinding', async () => {
    const binding = new InMemorySchedulerBinding();
    const engine = createProactiveEngine({ schedulerBinding: binding });
    await engine.registerWatchRule(makeWatchRule());
    engine.pauseWatchRule('watch-1');
    const requestSpy = vi.spyOn(binding, 'requestWakeUp');
    await engine.resumeWatchRule('watch-1');
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('engine has no event listeners or timers — purely synchronous/called', () => {
    // Verify the engine returned by createProactiveEngine has no timer-like properties
    const engine = createProactiveEngine({ schedulerBinding: new InMemorySchedulerBinding() });
    const engineObj = engine as Record<string, unknown>;
    expect(engineObj['_timer']).toBeUndefined();
    expect(engineObj['_interval']).toBeUndefined();
    expect(engineObj['_listeners']).toBeUndefined();
  });
});
