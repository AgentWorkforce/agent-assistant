export { createHarness } from './harness.js';
export { HarnessConfigError } from './types.js';
export * from './adapter/index.js';

export { OpenRouterModelAdapter, createOpenRouterModelAdapter } from './adapter/openrouter-model-adapter.js';
export type { OpenRouterModelAdapterConfig } from './adapter/openrouter-model-adapter.js';
export { BashToolRegistry, createBashToolRegistry } from './tools/bash-tool-registry.js';
export type { BashToolConfig } from './tools/bash-tool-registry.js';
export {
  CITE_SOURCE_PATHS_CLAUSE,
  EMPTY_RESULT_HONESTY_CLAUSE,
  HALLUCINATION_PREVENTION_CLAUSES,
  SURFACE_TOOL_ERRORS_CLAUSE,
} from './tools/prompt-fragments.js';
export {
  createWorkspaceToolRegistry,
  WORKSPACE_LIST_TOOL_NAME,
  WORKSPACE_READ_JSON_TOOL_NAME,
  WORKSPACE_READ_TOOL_NAME,
  WORKSPACE_SEARCH_TOOL_NAME,
  WORKSPACE_TOOL_NAMES,
} from './tools/workspace-tool-registry.js';
export type { WorkspaceToolRegistryOptions } from './tools/workspace-tool-registry.js';

export { OpenRouterSingleShotAdapter, createOpenRouterSingleShotAdapter } from './router/openrouter-singleshot-adapter.js';
export type { OpenRouterSingleShotAdapterConfig } from './router/openrouter-singleshot-adapter.js';
export { createTieredRunner } from './router/tiered-runner.js';
export type { TieredRunnerConfig } from './router/tiered-runner.js';
export type {
  Router,
  RouterInput,
  RoutingDecision,
  RoutingTier,
  SingleShotAdapter,
  SingleShotInput,
  SingleShotResult,
  TieredRunner,
  TieredRunnerResult,
  TieredRunnerFastResult,
  TieredRunnerHarnessResult,
  TieredRunnerRejectedResult,
} from './router/types.js';

export type {
  HarnessAggregateUsage,
  HarnessApprovalAdapter,
  HarnessApprovalEvent,
  HarnessApprovalRequest,
  HarnessApprovalRequestInput,
  HarnessApprovalRequestOutput,
  HarnessAssistantMessage,
  HarnessBaseTraceEvent,
  HarnessClarificationEvent,
  HarnessClarificationOutput,
  HarnessClock,
  HarnessConfig,
  HarnessContextBlock,
  HarnessContinuation,
  HarnessExecutionState,
  HarnessFinalAnswerOutput,
  HarnessHooks,
  HarnessInstructions,
  HarnessInvalidOutput,
  HarnessLimits,
  HarnessModelAdapter,
  HarnessModelCallRecord,
  HarnessModelInput,
  HarnessModelOutput,
  HarnessModelStepFinishedEvent,
  HarnessModelStepStartedEvent,
  HarnessOutcome,
  HarnessPreparedApproval,
  HarnessPreparedContext,
  HarnessResult,
  HarnessRuntime,
  HarnessStopReason,
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolError,
  HarnessToolExecutionContext,
  HarnessToolFailedEvent,
  HarnessToolFinishedEvent,
  HarnessToolRegistry,
  HarnessToolRequestOutput,
  HarnessToolRequestedEvent,
  HarnessToolResult,
  HarnessToolStartedEvent,
  HarnessTraceEvent,
  HarnessTraceSink,
  HarnessTraceSummary,
  HarnessTranscriptItem,
  HarnessTurnFinishedEvent,
  HarnessTurnInput,
  HarnessTurnStartedEvent,
  HarnessUsage,
  HarnessUserMessage,
} from './types.js';
