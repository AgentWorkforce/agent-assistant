// =============================================================================
// @agent-assistant/sdk — Top-Level Facade
// Re-exports the stable v1-baseline API surface across core SDK packages.
// No logic lives here. See individual packages for implementation details.
// =============================================================================
// --- @agent-assistant/core ---
export { createAssistant, AssistantDefinitionError, OutboundEventError } from '@agent-assistant/core';
// --- @agent-assistant/traits ---
export { createTraitsProvider, TraitsValidationError } from '@agent-assistant/traits';
// --- @agent-assistant/sessions ---
export { createSessionStore, resolveSession, defaultAffinityResolver, InMemorySessionStoreAdapter, SessionConflictError, SessionNotFoundError, SessionStateError, } from '@agent-assistant/sessions';
// --- @agent-assistant/surfaces ---
export { createSurfaceRegistry, SurfaceConflictError, SurfaceNotFoundError, SurfaceDeliveryError, } from '@agent-assistant/surfaces';
// --- @agent-assistant/policy ---
export { createActionPolicy, defaultRiskClassifier, InMemoryAuditSink, PolicyError, ClassificationError, } from '@agent-assistant/policy';
// --- @agent-assistant/proactive ---
export { createProactiveEngine, InMemorySchedulerBinding, ProactiveError, SchedulerBindingError, } from '@agent-assistant/proactive';
// --- @agent-assistant/inbox ---
export { createInboxStore, createInboxMemoryProjector, createInboxEnrichmentProjector, InboxItemNotFoundError, InboxInvalidStatusTransitionError, InboxRelayNativeSourceError, } from '@agent-assistant/inbox';
//# sourceMappingURL=index.js.map