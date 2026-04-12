export type {
  RoutingHint,
  SuppressionReason,
  FollowUpAction,
  ReminderPolicy,
  EvidenceEntry,
  FollowUpEvaluationContext,
  FollowUpRule,
  FollowUpDecision,
  WatchAction,
  WatchEvaluationContext,
  WatchRule,
  WatchTrigger,
  WatchRuleStatus,
  WatchRuleLifecycleStatus,
  WakeUpContext,
  SchedulerBinding,
  FollowUpEvidenceSource,
  ProactiveEngineConfig,
  ProactiveEngine,
} from './types.js';

export {
  ProactiveError,
  RuleNotFoundError,
  SchedulerBindingError,
} from './types.js';

export { createProactiveEngine, InMemorySchedulerBinding } from './proactive.js';
