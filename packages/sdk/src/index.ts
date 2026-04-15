// =============================================================================
// @agent-assistant/sdk — Top-Level Facade
// Re-exports the stable v1-baseline API surface across core SDK packages.
// No logic lives here. See individual packages for implementation details.
// =============================================================================

// --- @agent-assistant/core ---
export { createAssistant, AssistantDefinitionError, OutboundEventError } from '@agent-assistant/core';
export type {
  AssistantDefinition,
  AssistantRuntime,
  InboundMessage,
  OutboundEvent,
  CapabilityHandler,
  CapabilityContext,
  RuntimeStatus,
} from '@agent-assistant/core';

// --- @agent-assistant/traits ---
export { createTraitsProvider, TraitsValidationError } from '@agent-assistant/traits';
export type {
  AssistantTraits,
  SurfaceFormattingTraits,
  TraitsProvider,
} from '@agent-assistant/traits';

// --- @agent-assistant/sessions ---
export {
  createSessionStore,
  resolveSession,
  defaultAffinityResolver,
  InMemorySessionStoreAdapter,
  SessionConflictError,
  SessionNotFoundError,
  SessionStateError,
} from '@agent-assistant/sessions';
export type {
  Session,
  SessionStore,
  SessionStoreAdapter,
  SessionStoreConfig,
  SessionState,
} from '@agent-assistant/sessions';

// --- @agent-assistant/surfaces ---
export {
  createSurfaceRegistry,
  SurfaceConflictError,
  SurfaceNotFoundError,
  SurfaceDeliveryError,
} from '@agent-assistant/surfaces';
export type {
  SurfaceConnection,
  SurfaceRegistry,
  SurfaceCapabilities,
  SurfaceAdapter,
  SurfaceFormatHook,
  SurfaceType,
  SurfaceState,
} from '@agent-assistant/surfaces';

// --- @agent-assistant/policy ---
export {
  createActionPolicy,
  defaultRiskClassifier,
  InMemoryAuditSink,
  PolicyError,
  ClassificationError,
} from '@agent-assistant/policy';
export type {
  Action,
  PolicyEngine,
  PolicyEngineConfig,
  PolicyRule,
  PolicyDecision,
  EvaluationResult,
  AuditSink,
  RiskLevel,
} from '@agent-assistant/policy';

// --- @agent-assistant/proactive ---
export {
  createProactiveEngine,
  InMemorySchedulerBinding,
  ProactiveError,
  SchedulerBindingError,
} from '@agent-assistant/proactive';
export type {
  ProactiveEngine,
  ProactiveEngineConfig,
  FollowUpRule,
  WatchRule,
  SchedulerBinding,
} from '@agent-assistant/proactive';

// --- @agent-assistant/inbox ---
export {
  createInboxStore,
  createInboxMemoryProjector,
  createInboxEnrichmentProjector,
  InboxItemNotFoundError,
  InboxInvalidStatusTransitionError,
  InboxRelayNativeSourceError,
} from '@agent-assistant/inbox';
export type {
  InboxAdapterQuery,
  InboxItem,
  InboxItemKind,
  InboxItemScope,
  InboxItemStatus,
  InboxListQuery,
  InboxSourceTrust,
  InboxStore,
  InboxStoreAdapter,
  InboxStoreConfig,
  InboxToEnrichmentProjector,
  InboxToMemoryProjector,
  InboxWriteInput,
} from '@agent-assistant/inbox';
