export type {
  Action,
  RiskLevel,
  RiskClassifier,
  PolicyRule,
  PolicyDecision,
  PolicyEvaluationContext,
  PolicyEngineConfig,
  PolicyEngine,
  ApprovalHint,
  ApprovalResolution,
  AuditEvent,
  AuditSink,
  EvaluationResult,
} from './types.js';

export {
  defaultRiskClassifier,
  InMemoryAuditSink,
  PolicyError,
  RuleNotFoundError,
  ClassificationError,
} from './types.js';

export { createActionPolicy } from './policy.js';
