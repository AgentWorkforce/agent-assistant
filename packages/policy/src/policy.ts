import { nanoid } from 'nanoid';
import {
  ClassificationError,
  InMemoryAuditSink as _InMemoryAuditSink,
  PolicyError,
  RuleNotFoundError,
  defaultRiskClassifier,
  type Action,
  type ApprovalResolution,
  type AuditEvent,
  type AuditSink,
  type EvaluationResult,
  type PolicyDecision,
  type PolicyEngine,
  type PolicyEngineConfig,
  type PolicyEvaluationContext,
  type PolicyRule,
  type RiskClassifier,
  type RiskLevel,
} from './types.js';

const VALID_RISK_LEVELS = new Set<string>(['low', 'medium', 'high', 'critical']);

/** Cap for the bounded eval-record map used for approval correlation. */
const EVAL_RECORD_CAP = 1000;

interface EvalRecord {
  action: Action;
  riskLevel: RiskLevel;
  decision: PolicyDecision;
}

export function createActionPolicy(config?: PolicyEngineConfig): PolicyEngine {
  // ── Internal state ────────────────────────────────────────────────────────

  const rules: Array<{ rule: PolicyRule; registrationIndex: number }> = [];
  let registrationCounter = 0;

  const resolvedClassifier: RiskClassifier = config?.classifier ?? defaultRiskClassifier;
  const resolvedFallback: PolicyDecision['action'] = config?.fallbackDecision ?? 'require_approval';
  const resolvedAuditSink: AuditSink = config?.auditSink ?? { record: async () => {} };

  // Bounded map for approval correlation (reconciliation Decision 1).
  const evalRecords = new Map<string, EvalRecord>();
  const evalRecordOrder: string[] = [];

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getSortedRules(): Array<{ rule: PolicyRule; registrationIndex: number }> {
    return [...rules].sort((a, b) => {
      const pa = a.rule.priority ?? 100;
      const pb = b.rule.priority ?? 100;
      if (pa !== pb) return pa - pb;
      return a.registrationIndex - b.registrationIndex;
    });
  }

  function storeEvalRecord(id: string, record: EvalRecord): void {
    evalRecords.set(id, record);
    evalRecordOrder.push(id);
    if (evalRecordOrder.length > EVAL_RECORD_CAP) {
      const oldest = evalRecordOrder.shift()!;
      evalRecords.delete(oldest);
    }
  }

  // ── Engine ────────────────────────────────────────────────────────────────

  return {
    registerRule(rule: PolicyRule): void {
      if (rules.some((r) => r.rule.id === rule.id)) {
        // Decision 5: throw PolicyError, not RuleNotFoundError
        throw new PolicyError(`Rule with id '${rule.id}' is already registered.`);
      }
      rules.push({ rule, registrationIndex: registrationCounter++ });
    },

    removeRule(ruleId: string): void {
      const index = rules.findIndex((r) => r.rule.id === ruleId);
      if (index === -1) {
        throw new RuleNotFoundError(ruleId);
      }
      rules.splice(index, 1);
    },

    listRules(): PolicyRule[] {
      return getSortedRules().map((r) => r.rule);
    },

    async evaluate(action: Action): Promise<EvaluationResult> {
      // 1. Classify risk — validate return value (reconciliation Decision 2)
      let riskLevel: RiskLevel;
      try {
        const raw = await resolvedClassifier.classify(action);
        if (!VALID_RISK_LEVELS.has(raw as string)) {
          throw new ClassificationError(
            `Classifier returned invalid risk level '${raw}' for action '${action.id}'. ` +
              `Expected one of: low, medium, high, critical.`,
          );
        }
        riskLevel = raw;
      } catch (err) {
        if (err instanceof ClassificationError) throw err;
        throw new ClassificationError(`Classifier failed for action '${action.id}'`, err);
      }

      // 2. Build evaluation context (no workspaceId per reconciliation Decision 4)
      const context: PolicyEvaluationContext = {
        sessionId: action.sessionId,
        userId: action.userId,
        proactive: action.proactive,
        metadata: action.metadata,
      };

      // 3. Evaluate rules in priority order (first-match-wins)
      let decision: PolicyDecision | null = null;
      for (const { rule } of getSortedRules()) {
        try {
          const result = await rule.evaluate(action, riskLevel, context);
          if (result !== null) {
            decision = result;
            break;
          }
        } catch (err) {
          throw new PolicyError(`Rule '${rule.id}' threw during evaluation`, err);
        }
      }

      // 4. Apply fallback when no rule matched
      if (decision === null) {
        decision = {
          action: resolvedFallback,
          ruleId: 'fallback',
          riskLevel,
          reason: 'No registered rule matched this action.',
        };
      }

      // 5. Record audit event
      const auditEventId = nanoid();
      const auditEvent: AuditEvent = {
        id: auditEventId,
        action,
        riskLevel,
        decision,
        evaluatedAt: new Date().toISOString(),
      };
      await resolvedAuditSink.record(auditEvent);

      // 6. Store eval record for approval correlation (bounded, reconciliation Decision 1)
      storeEvalRecord(auditEventId, { action, riskLevel, decision });

      return { decision, auditEventId };
    },

    async recordApproval(
      auditEventId: string,
      resolution: ApprovalResolution,
    ): Promise<void> {
      const record = evalRecords.get(auditEventId);
      if (!record) {
        throw new PolicyError(
          `Unknown auditEventId '${auditEventId}'. Cannot record approval resolution.`,
        );
      }

      const approvalAuditEvent: AuditEvent = {
        id: nanoid(),
        action: record.action,
        riskLevel: record.riskLevel,
        decision: record.decision,
        evaluatedAt: new Date().toISOString(),
        approval: resolution,
      };
      await resolvedAuditSink.record(approvalAuditEvent);
    },
  };
}
