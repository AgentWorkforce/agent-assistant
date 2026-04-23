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

// ── Notify-channel resolution ───────────────────────────────────────────────
// Dynamic channel picking for proactive Slack posts: discover bot-member
// channels, pick one with an injected LLM, persist the user's confirmation
// in a pluggable pref store.
export {
  getNotifyChannelPref,
  hasPrefStore,
  incrementUnconfirmedPosts,
  setNotifyChannelPref,
} from './notify-channel-prefs.js';
export type { NotifyChannelPref, PrefStore } from './notify-channel-prefs.js';

export { pickChannel } from './channel-picker.js';
export type {
  ChatFn,
  ChatMessage,
  ChatOptions,
  PickedChannel,
  ProactivePayload,
} from './channel-picker.js';

export {
  CONFIRM_PROMPT_SUFFIX,
  normalizeChannelName,
  parseConfirmReply,
  parseRedirectChannelName,
} from './notify-channel-reply.js';
export type { ConfirmReplyParse } from './notify-channel-reply.js';

export {
  AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS,
  resolveNotifyChannel,
} from './notify-channel-resolver.js';
export type {
  ListBotChannelsFn,
  ResolvedNotifyChannel,
  ResolveNotifyChannelInput,
} from './notify-channel-resolver.js';
