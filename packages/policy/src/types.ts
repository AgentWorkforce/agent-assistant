// ─── Action and Classification ───────────────────────────────────────────────

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

// ─── Policy Rule and Context ──────────────────────────────────────────────────

export interface PolicyEvaluationContext {
  sessionId: string;
  userId: string;
  // workspaceId removed per reconciliation Decision 4 — use metadata.workspaceId if needed
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
  priority?: number; // default 100; lower evaluates first
  evaluate(
    action: Action,
    riskLevel: RiskLevel,
    context: PolicyEvaluationContext
  ): PolicyDecision | null | Promise<PolicyDecision | null>;
  description?: string;
}

// ─── Audit Types ──────────────────────────────────────────────────────────────

export interface ApprovalResolution {
  approved: boolean;
  approvedBy?: string;
  resolvedAt: string; // ISO-8601
  comment?: string;
}

export interface AuditEvent {
  id: string;
  action: Action;
  riskLevel: RiskLevel;
  decision: PolicyDecision;
  evaluatedAt: string; // ISO-8601
  approval?: ApprovalResolution;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

// ─── Engine Types ─────────────────────────────────────────────────────────────

/**
 * Returned by evaluate(). Contains the policy decision and the audit event ID
 * for approval correlation (reconciliation Decision 1).
 */
export interface EvaluationResult {
  decision: PolicyDecision;
  auditEventId: string;
}

export interface PolicyEngineConfig {
  classifier?: RiskClassifier;
  fallbackDecision?: PolicyDecision['action'];
  auditSink?: AuditSink;
}

export interface PolicyEngine {
  evaluate(action: Action): Promise<EvaluationResult>;
  registerRule(rule: PolicyRule): void;
  removeRule(ruleId: string): void;
  listRules(): PolicyRule[];

  /**
   * Record an approval resolution against a prior evaluation's audit event.
   * Emits a new AuditEvent to the sink with the original action, decision,
   * and the provided ApprovalResolution populated in the `approval` field.
   *
   * The engine stores a bounded map of auditEventId -> { action, riskLevel, decision }
   * from recent evaluations (cap: 1000, evicts oldest). Throws PolicyError if the
   * auditEventId is unknown or has been evicted.
   */
  recordApproval(auditEventId: string, resolution: ApprovalResolution): Promise<void>;
}

// ─── Error Types ──────────────────────────────────────────────────────────────

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

// ─── InMemoryAuditSink ────────────────────────────────────────────────────────

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }
}
