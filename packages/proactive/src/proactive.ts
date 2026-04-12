import { nanoid } from 'nanoid';
import type {
  EvidenceEntry,
  FollowUpDecision,
  FollowUpEvaluationContext,
  FollowUpEvidenceSource,
  FollowUpRule,
  ProactiveEngine,
  ProactiveEngineConfig,
  ReminderPolicy,
  RoutingHint,
  SchedulerBinding,
  SuppressionReason,
  WakeUpContext,
  WatchEvaluationContext,
  WatchRule,
  WatchRuleLifecycleStatus,
  WatchRuleStatus,
  WatchTrigger,
} from './types.js';
import {
  RuleNotFoundError,
  SchedulerBindingError,
} from './types.js';

// ─── Internal state shapes (not exported) ─────────────────────────────────────

interface ReminderState {
  reminderCount: number;
  lastReminderSentAt: string | null; // ISO-8601
}

interface WatchRuleRecord {
  rule: WatchRule;
  status: WatchRuleLifecycleStatus;
  lastEvaluatedAt: string | null;
  nextWakeUpBindingId: string | null;
}

// ─── Default policy ───────────────────────────────────────────────────────────

const POLICY_DEFAULTS: Required<ReminderPolicy> = {
  maxReminders: 3,
  cooldownMs: 3_600_000, // 1 hour
  suppressWhenActive: true,
};

function mergePolicy(
  base: Required<ReminderPolicy>,
  override?: ReminderPolicy,
): Required<ReminderPolicy> {
  if (!override) return base;
  return {
    maxReminders: override.maxReminders ?? base.maxReminders,
    cooldownMs: override.cooldownMs ?? base.cooldownMs,
    suppressWhenActive: override.suppressWhenActive ?? base.suppressWhenActive,
  };
}

// ─── Suppression logic ────────────────────────────────────────────────────────

function applySuppression(
  context: FollowUpEvaluationContext,
  policy: Required<ReminderPolicy>,
  state: ReminderState,
  now: Date,
): { suppressed: boolean; reason?: SuppressionReason } {
  // 1. user_active: user became active after the wake-up was scheduled
  if (
    policy.suppressWhenActive &&
    new Date(context.lastActivityAt) > new Date(context.scheduledAt)
  ) {
    return { suppressed: true, reason: 'user_active' };
  }

  // 2. max_reminders: reminder count for this (sessionId, ruleId) has reached maxReminders
  if (state.reminderCount >= policy.maxReminders) {
    return { suppressed: true, reason: 'max_reminders' };
  }

  // 3. cooldown: not enough time since last reminder
  if (
    state.lastReminderSentAt !== null &&
    now.getTime() - new Date(state.lastReminderSentAt).getTime() < policy.cooldownMs
  ) {
    return { suppressed: true, reason: 'cooldown' };
  }

  return { suppressed: false };
}

// ─── InMemorySchedulerBinding ─────────────────────────────────────────────────

export class InMemorySchedulerBinding implements SchedulerBinding {
  readonly pendingWakeUps: Map<string, { at: Date; context: WakeUpContext }> = new Map();

  async requestWakeUp(at: Date, context: WakeUpContext): Promise<string> {
    const bindingId = nanoid();
    this.pendingWakeUps.set(bindingId, { at, context });
    return bindingId;
  }

  async cancelWakeUp(bindingId: string): Promise<void> {
    this.pendingWakeUps.delete(bindingId);
  }

  /**
   * Test helper: manually fire a pending wake-up.
   * Returns the WakeUpContext and removes it from pending.
   */
  async trigger(bindingId: string): Promise<WakeUpContext> {
    const entry = this.pendingWakeUps.get(bindingId);
    if (!entry) {
      throw new Error(`No pending wake-up for bindingId: ${bindingId}`);
    }
    this.pendingWakeUps.delete(bindingId);
    return entry.context;
  }
}

// ─── ProactiveEngine factory ──────────────────────────────────────────────────

export function createProactiveEngine(config: ProactiveEngineConfig): ProactiveEngine {
  const { schedulerBinding, evidenceSource } = config;
  const defaultPolicy = mergePolicy(POLICY_DEFAULTS, config.defaultReminderPolicy);

  // Follow-up state
  const followUpRules: Map<string, FollowUpRule> = new Map();
  const reminderStates: Map<string, ReminderState> = new Map();

  // Watch rule state
  const watchRuleRecords: Map<string, WatchRuleRecord> = new Map();

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function reminderKey(sessionId: string, ruleId: string): string {
    return `${sessionId}:${ruleId}`;
  }

  function getReminderState(sessionId: string, ruleId: string): ReminderState {
    return (
      reminderStates.get(reminderKey(sessionId, ruleId)) ?? {
        reminderCount: 0,
        lastReminderSentAt: null,
      }
    );
  }

  async function scheduleWatchWakeUp(
    record: WatchRuleRecord,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const nextAt = new Date(Date.now() + record.rule.intervalMs);
    try {
      const bindingId = await schedulerBinding.requestWakeUp(nextAt, {
        sessionId: (metadata?.['sessionId'] as string | undefined) ?? '_watch',
        ruleId: record.rule.id,
        scheduledAt: nextAt.toISOString(),
        metadata,
      });
      return bindingId;
    } catch (err) {
      throw new SchedulerBindingError(
        `Failed to schedule wake-up for watch rule: ${record.rule.id}`,
        err,
      );
    }
  }

  // ── Follow-up rule methods ────────────────────────────────────────────────────

  function registerFollowUpRule(rule: FollowUpRule): void {
    followUpRules.set(rule.id, rule);
  }

  function removeFollowUpRule(ruleId: string): void {
    if (!followUpRules.has(ruleId)) {
      throw new RuleNotFoundError(ruleId, 'followUp');
    }
    followUpRules.delete(ruleId);
    // Clear all reminder state for this ruleId across all sessions
    for (const key of reminderStates.keys()) {
      if (key.endsWith(`:${ruleId}`)) {
        reminderStates.delete(key);
      }
    }
  }

  function listFollowUpRules(): FollowUpRule[] {
    return Array.from(followUpRules.values());
  }

  async function evaluateFollowUp(
    context: FollowUpEvaluationContext,
  ): Promise<FollowUpDecision[]> {
    // Fetch evidence once for this entire evaluation pass (Decision 3)
    let evidence: EvidenceEntry[];
    if (context.evidence !== undefined) {
      evidence = context.evidence;
    } else if (evidenceSource) {
      evidence = await (evidenceSource as FollowUpEvidenceSource).getRecentEntries(
        context.sessionId,
      );
    } else {
      evidence = [];
    }

    const now = new Date();
    const decisions: FollowUpDecision[] = [];

    for (const rule of followUpRules.values()) {
      const policy = mergePolicy(defaultPolicy, rule.policy);
      const state = getReminderState(context.sessionId, rule.id);
      const suppression = applySuppression(context, policy, state, now);

      const routingHint: RoutingHint = rule.routingHint ?? 'cheap';

      if (suppression.suppressed) {
        decisions.push({
          ruleId: rule.id,
          sessionId: context.sessionId,
          action: 'suppress',
          suppressionReason: suppression.reason,
          routingHint,
          messageTemplate: rule.messageTemplate,
        });
        continue;
      }

      // Evaluate condition
      const conditionResult = await rule.condition(context, evidence);
      if (!conditionResult) {
        decisions.push({
          ruleId: rule.id,
          sessionId: context.sessionId,
          action: 'suppress',
          // No suppressionReason when condition returns false
          routingHint,
          messageTemplate: rule.messageTemplate,
        });
        continue;
      }

      // Fire: update reminder state
      const key = reminderKey(context.sessionId, rule.id);
      reminderStates.set(key, {
        reminderCount: state.reminderCount + 1,
        lastReminderSentAt: now.toISOString(),
      });

      decisions.push({
        ruleId: rule.id,
        sessionId: context.sessionId,
        action: 'fire',
        routingHint,
        messageTemplate: rule.messageTemplate,
      });
    }

    return decisions;
  }

  function resetReminderState(sessionId: string, ruleId?: string): void {
    if (ruleId !== undefined) {
      reminderStates.delete(reminderKey(sessionId, ruleId));
    } else {
      // Clear all reminder state for the given session
      const prefix = `${sessionId}:`;
      for (const key of reminderStates.keys()) {
        if (key.startsWith(prefix)) {
          reminderStates.delete(key);
        }
      }
    }
  }

  // ── Watch rule methods ────────────────────────────────────────────────────────

  async function registerWatchRule(rule: WatchRule): Promise<void> {
    const record: WatchRuleRecord = {
      rule,
      status: 'active',
      lastEvaluatedAt: null,
      nextWakeUpBindingId: null,
    };
    watchRuleRecords.set(rule.id, record);
    // Engine owns initial watch scheduling (Decision 5)
    const bindingId = await scheduleWatchWakeUp(record);
    record.nextWakeUpBindingId = bindingId;
  }

  function pauseWatchRule(ruleId: string): void {
    const record = watchRuleRecords.get(ruleId);
    if (!record || record.status === 'cancelled') {
      throw new RuleNotFoundError(ruleId, 'watch');
    }
    record.status = 'paused';
  }

  async function resumeWatchRule(ruleId: string): Promise<void> {
    const record = watchRuleRecords.get(ruleId);
    if (!record || record.status === 'cancelled') {
      throw new RuleNotFoundError(ruleId, 'watch');
    }
    record.status = 'active';
    // Engine schedules wake-up on resume (Decision 5)
    const bindingId = await scheduleWatchWakeUp(record);
    record.nextWakeUpBindingId = bindingId;
  }

  async function cancelWatchRule(ruleId: string): Promise<void> {
    const record = watchRuleRecords.get(ruleId);
    if (!record || record.status === 'cancelled') {
      throw new RuleNotFoundError(ruleId, 'watch');
    }
    // Cancel any pending wake-up
    if (record.nextWakeUpBindingId) {
      await schedulerBinding.cancelWakeUp(record.nextWakeUpBindingId);
      record.nextWakeUpBindingId = null;
    }
    record.status = 'cancelled';
  }

  function listWatchRules(): WatchRuleStatus[] {
    return Array.from(watchRuleRecords.values()).map((r) => ({
      rule: r.rule,
      status: r.status,
      lastEvaluatedAt: r.lastEvaluatedAt,
      nextWakeUpBindingId: r.nextWakeUpBindingId,
    }));
  }

  async function evaluateWatchRules(context: WatchEvaluationContext): Promise<WatchTrigger[]> {
    // Decision 6: evaluates only the rule identified by context.ruleId
    const record = watchRuleRecords.get(context.ruleId);
    if (!record || record.status === 'cancelled') {
      throw new RuleNotFoundError(context.ruleId, 'watch');
    }

    // Paused rules are skipped (no error, just empty result)
    if (record.status === 'paused') {
      return [];
    }

    const now = new Date();
    const triggers: WatchTrigger[] = [];

    const ruleContext: WatchEvaluationContext = {
      ruleId: record.rule.id,
      scheduledAt: context.scheduledAt,
      metadata: context.metadata,
    };

    const conditionResult = await record.rule.condition(ruleContext);
    record.lastEvaluatedAt = now.toISOString();

    if (conditionResult) {
      triggers.push({
        ruleId: record.rule.id,
        triggeredAt: now.toISOString(),
        action: record.rule.action,
        context: ruleContext,
      });
    }

    // Re-schedule only the evaluated rule (Decision 6)
    if (record.nextWakeUpBindingId) {
      await schedulerBinding.cancelWakeUp(record.nextWakeUpBindingId);
      record.nextWakeUpBindingId = null;
    }

    const newBindingId = await scheduleWatchWakeUp(record, context.metadata);
    record.nextWakeUpBindingId = newBindingId;

    return triggers;
  }

  return {
    registerFollowUpRule,
    removeFollowUpRule,
    listFollowUpRules,
    evaluateFollowUp,
    resetReminderState,
    registerWatchRule,
    pauseWatchRule,
    resumeWatchRule,
    cancelWatchRule,
    listWatchRules,
    evaluateWatchRules,
  };
}
