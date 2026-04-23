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

export {
  DEFAULT_TTL_MS_BY_KIND,
  clearSignal,
  drainSignals,
  recordSignal,
} from './signal-inbox.js';
export type {
  DrainOptions,
  ProactiveSignal,
  ProactiveSignalKind,
  RecordSignalInput,
  SignalInboxStore,
} from './signal-inbox.js';
export { isInQuietHours, shouldDeferForQuietHours } from './quiet-hours.js';
export type { QuietHoursConfig, QuietHoursStore } from './quiet-hours.js';
