// ─── Core scalar types ────────────────────────────────────────────────────────

export type RoutingHint = 'cheap' | 'fast' | 'deep';

export type SuppressionReason = 'user_active' | 'cooldown' | 'max_reminders';

// 'defer' is reserved for v1.1 deferred retry logic; v1 returns only fire | suppress
export type FollowUpAction = 'fire' | 'suppress';

// ─── Reminder policy ──────────────────────────────────────────────────────────

export interface ReminderPolicy {
  /** Maximum number of reminders to send per (sessionId, ruleId). Default: 3. */
  maxReminders?: number;

  /**
   * Minimum milliseconds between reminders for the same (sessionId, ruleId).
   * Default: 3_600_000 (1 hour).
   */
  cooldownMs?: number;

  /**
   * If true, suppress when the user's last activity is after the wake-up's scheduledAt.
   * Default: true.
   */
  suppressWhenActive?: boolean;
}

// ─── Evidence ─────────────────────────────────────────────────────────────────

export interface EvidenceEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string; // ISO-8601
  metadata?: Record<string, unknown>;
}

// ─── Follow-up rule types ─────────────────────────────────────────────────────

export interface FollowUpEvaluationContext {
  sessionId: string;

  /** ISO-8601 — when the wake-up was originally scheduled. Used for suppression comparison. */
  scheduledAt: string;

  /** ISO-8601 — the session's last user activity timestamp. */
  lastActivityAt: string;

  /** Optional pre-fetched evidence entries from the evidence source. */
  evidence?: EvidenceEntry[];
}

export interface FollowUpRule {
  id: string;

  /**
   * Condition function. Receives the evaluation context and optional evidence.
   * Returns true if the assistant should consider following up.
   */
  condition(
    ctx: FollowUpEvaluationContext,
    evidence: EvidenceEntry[],
  ): boolean | Promise<boolean>;

  /** Human-readable description for logging. */
  description?: string;

  /** ReminderPolicy governs suppression. If omitted, defaults are used. */
  policy?: ReminderPolicy;

  /** Routing hint passed through to the caller's routing logic. Defaults to 'cheap'. */
  routingHint?: RoutingHint;

  /** Free-form message template. The caller is responsible for final rendering. */
  messageTemplate?: string;
}

export interface FollowUpDecision {
  ruleId: string;
  sessionId: string;

  /** What the engine recommends the caller do. */
  action: FollowUpAction;

  /**
   * suppressionReason is present when action === 'suppress' due to a policy check.
   * - 'user_active': user became active after the wake-up was scheduled
   * - 'cooldown': too soon after the previous reminder
   * - 'max_reminders': rule's maxReminders count has been reached
   * Not set when suppression is due to condition returning false.
   */
  suppressionReason?: SuppressionReason;

  /** Routing hint from the rule. Callers should use this to select a model tier. */
  routingHint: RoutingHint;

  /** Message template from the rule, if provided. Caller renders the final message. */
  messageTemplate?: string;
}

// ─── Watch rule types ─────────────────────────────────────────────────────────

export interface WatchAction {
  /** Short descriptor used by the caller to identify what to do. */
  type: string;

  /** Optional payload passed through to the caller unchanged. */
  payload?: Record<string, unknown>;
}

export interface WatchEvaluationContext {
  /** The specific rule to evaluate. Always required; wake-ups are per-rule. */
  ruleId: string;

  /** ISO-8601 — when this evaluation was scheduled. */
  scheduledAt: string;

  /** Product-supplied metadata from the original WakeUpContext. */
  metadata?: Record<string, unknown>;
}

export interface WatchRule {
  id: string;

  /**
   * Condition function evaluated on each scheduled check.
   * Returns true if the watch rule should trigger an action.
   */
  condition(ctx: WatchEvaluationContext): boolean | Promise<boolean>;

  /**
   * Action descriptor. The engine does not execute actions — it returns WatchTrigger
   * objects that the caller handles.
   */
  action: WatchAction;

  /**
   * Interval in milliseconds between condition checks.
   * The engine requests a new wake-up after every evaluation regardless of trigger result.
   */
  intervalMs: number;

  /** Optional description for logging and observability. */
  description?: string;
}

export interface WatchTrigger {
  ruleId: string;
  triggeredAt: string; // ISO-8601 — when the condition returned true
  action: WatchAction;
  context: WatchEvaluationContext;
}

export type WatchRuleLifecycleStatus = 'active' | 'paused' | 'cancelled';

export interface WatchRuleStatus {
  rule: WatchRule;
  status: WatchRuleLifecycleStatus;
  lastEvaluatedAt: string | null; // ISO-8601
  nextWakeUpBindingId: string | null;
}

// ─── Scheduler binding ────────────────────────────────────────────────────────

export interface WakeUpContext {
  sessionId: string;
  ruleId?: string;
  scheduledAt: string; // ISO-8601
  metadata?: Record<string, unknown>;
}

export interface SchedulerBinding {
  /** Request a wake-up at the given time. Returns a bindingId the engine uses to cancel. */
  requestWakeUp(at: Date, context: WakeUpContext): Promise<string>;

  /** Cancel a previously requested wake-up by its bindingId. No-op if already fired or not found. */
  cancelWakeUp(bindingId: string): Promise<void>;
}

// ─── Evidence source ──────────────────────────────────────────────────────────

export interface FollowUpEvidenceSource {
  getRecentEntries(
    sessionId: string,
    options?: { limit?: number; tags?: string[] },
  ): Promise<EvidenceEntry[]>;
}

// ─── Engine interface and config ──────────────────────────────────────────────

export interface ProactiveEngineConfig {
  /** Required scheduler binding. Wire InMemorySchedulerBinding for tests. */
  schedulerBinding: SchedulerBinding;

  /** Optional evidence source wired to a memory store or other evidence backend. */
  evidenceSource?: FollowUpEvidenceSource;

  /** Default reminder policy applied when a rule does not specify its own policy. */
  defaultReminderPolicy?: ReminderPolicy;
}

export interface ProactiveEngine {
  // Follow-up rules
  registerFollowUpRule(rule: FollowUpRule): void;
  removeFollowUpRule(ruleId: string): void; // throws RuleNotFoundError if not found
  listFollowUpRules(): FollowUpRule[];
  evaluateFollowUp(context: FollowUpEvaluationContext): Promise<FollowUpDecision[]>;
  resetReminderState(sessionId: string, ruleId?: string): void;

  // Watch rules
  registerWatchRule(rule: WatchRule): Promise<void>;
  pauseWatchRule(ruleId: string): void; // throws RuleNotFoundError if not found
  resumeWatchRule(ruleId: string): Promise<void>; // throws RuleNotFoundError if not found
  cancelWatchRule(ruleId: string): Promise<void>; // throws RuleNotFoundError if not found
  listWatchRules(): WatchRuleStatus[];
  evaluateWatchRules(context: WatchEvaluationContext): Promise<WatchTrigger[]>;
}

// ─── Error classes ────────────────────────────────────────────────────────────

export class ProactiveError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ProactiveError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RuleNotFoundError extends ProactiveError {
  readonly ruleId: string;
  readonly ruleType: 'followUp' | 'watch';

  constructor(ruleId: string, ruleType: 'followUp' | 'watch') {
    super(`Rule not found: ${ruleId} (${ruleType})`, 'RULE_NOT_FOUND');
    this.name = 'RuleNotFoundError';
    this.ruleId = ruleId;
    this.ruleType = ruleType;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SchedulerBindingError extends ProactiveError {
  readonly bindingId?: string;
  readonly cause: unknown;

  constructor(message: string, cause: unknown, bindingId?: string) {
    super(message, 'SCHEDULER_BINDING_ERROR');
    this.name = 'SchedulerBindingError';
    this.cause = cause;
    this.bindingId = bindingId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
