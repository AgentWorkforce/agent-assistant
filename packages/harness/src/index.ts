export { createHarness } from './harness.js';
export { USING_RELAYFILE_VFS_SKILL } from './skills/using-relayfile-vfs.js';
export { HarnessConfigError } from './types.js';
export { stopReasonToUserMessage } from './stop-reason-message.js';
export type { StopReasonMessageOptions } from './stop-reason-message.js';
export * from './adapter/index.js';

export { OpenRouterModelAdapter, createOpenRouterModelAdapter } from './adapter/openrouter-model-adapter.js';
export type { OpenRouterModelAdapterConfig } from './adapter/openrouter-model-adapter.js';
export { BashToolRegistry, createBashToolRegistry } from './tools/bash-tool-registry.js';
export type { BashToolConfig } from './tools/bash-tool-registry.js';
export { GitHubPublicFetcher, GitHubPublicFetchError } from './tools/github-public-fetcher.js';
export type {
  GitHubPublicFetcherOptions,
  GitHubPublicReview,
} from './tools/github-public-fetcher.js';
export {
  createGitHubPublicReviewToolRegistry,
  GITHUB_PUBLIC_REVIEW_TOOL_NAME,
} from './tools/github-public-review-tool-registry.js';
export type { GitHubPublicReviewToolRegistryOptions } from './tools/github-public-review-tool-registry.js';
export {
  CITE_SOURCE_PATHS_CLAUSE,
  EMPTY_RESULT_HONESTY_CLAUSE,
  DRILL_IN_DISCIPLINE_CLAUSE,
  EXTERNAL_REPO_STEER_CLAUSE,
  HALLUCINATION_PREVENTION_CLAUSES,
  SURFACE_TOOL_ERRORS_CLAUSE,
  TOOL_DISCIPLINE_CLAUSES,
  TOOL_INPUT_SHAPE_REMINDER_CLAUSE,
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
export {
  createMemoryToolRegistry,
  MEMORY_FORGET_TOOL_NAME,
  MEMORY_RECALL_TOOL_NAME,
  MEMORY_REMEMBER_TOOL_NAME,
  MEMORY_TOOL_NAMES,
} from './tools/memory-tool-registry.js';
export type { MemoryToolRegistryOptions } from './tools/memory-tool-registry.js';
export {
  createToolEvidenceClarificationHook,
  detectToolEvidenceClarification,
} from './tool-evidence-clarification.js';
export type {
  ToolEvidenceClarificationOptions,
} from './tool-evidence-clarification.js';
export { createIdempotencyGuard, type IdempotencyGuardOptions } from './idempotency-guard.js';
export {
  createSubagentToolRegistry,
  filterParentContextForSubagent,
  SUBAGENT_DEFAULT_MAX_ITERATIONS,
  SUBAGENT_EXCLUDED_PARENT_KEYS,
} from './subagent-registry.js';
export type {
  CreateSubagentToolRegistryOptions,
  HarnessSubagent,
  HarnessSubagentRegistry,
  TaskToolInput,
  TaskToolResult,
} from './subagent-registry.js';
export {
  createPlanningToolRegistry,
  createDefaultPlanStateAccessor,
  getOrCreatePlanState,
  PLANNING_DEFAULT_MAX_TODOS,
  PLANNING_SCRATCH_KEY,
} from './planning-registry.js';
export type {
  TodoStatus,
  HarnessTodo,
  HarnessPlanState,
  CreatePlanningToolRegistryOptions,
} from './planning-registry.js';
export {
  createScratchpadToolRegistry,
  createDefaultScratchpadStateAccessor,
  getOrCreateScratchpadState,
  SCRATCHPAD_DEFAULT_MAX_FILE_BYTES,
  SCRATCHPAD_DEFAULT_MAX_TOTAL_BYTES,
  SCRATCHPAD_SCRATCH_KEY,
} from './scratchpad-registry.js';
export type {
  HarnessScratchFile,
  HarnessScratchpadState,
  CreateScratchpadToolRegistryOptions,
} from './scratchpad-registry.js';

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
  HarnessInvalidOutputCode,
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
  HarnessToolEvidenceClarification,
  HarnessToolEvidenceClarificationHook,
  HarnessToolEvidenceClarificationReason,
  HarnessToolDefinition,
  HarnessToolError,
  HarnessToolExecutionContext,
  HarnessToolFailedEvent,
  HarnessToolFinishedEvent,
  HarnessToolRegistry,
  HarnessToolRequestOutput,
  HarnessToolRequestedEvent,
  HarnessToolResult,
  HarnessToolRetriedEvent,
  HarnessToolRetryConfig,
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
