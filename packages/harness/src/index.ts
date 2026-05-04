export { createHarness } from './harness.js';
export { USING_RELAYFILE_VFS_SKILL } from './skills/using-relayfile-vfs.js';
export { HarnessConfigError } from './types.js';
export { exceedsEvidenceBudget } from './claim-density.js';
export type { EvidenceBudgetInput, EvidenceBudgetVerdict } from './claim-density.js';
export { stopReasonToUserMessage } from './stop-reason-message.js';
export { truthfulFailureReply } from './stop-reason-message.js';
export type { StopReasonMessageOptions } from './stop-reason-message.js';
export type { TruthfulFailureReplyOptions } from './stop-reason-message.js';
export * from './adapter/index.js';
export { EXECUTION_CONTRACT_SCHEMA_VERSION } from './adapter/types.js';
export type { ExecutionContractSchemaVersion } from './adapter/types.js';

export { OpenRouterModelAdapter, createOpenRouterModelAdapter } from './adapter/openrouter-model-adapter.js';
export type { OpenRouterModelAdapterConfig } from './adapter/openrouter-model-adapter.js';
import { createBashToolRegistry as createBashToolRegistryFromSubpath } from './tools/bash-tool-registry.js';
import { createGitHubPublicReviewToolRegistry as createGitHubPublicReviewToolRegistryFromSubpath } from './tools/github-public-review-tool-registry.js';
import { createWorkspaceToolRegistry as createWorkspaceToolRegistryFromSubpath } from './tools/workspace-tool-registry.js';
import { createMemoryToolRegistry as createMemoryToolRegistryFromSubpath } from './tools/memory-tool-registry.js';
import { createSubagentToolRegistry as createSubagentToolRegistryFromSubpath } from './subagent-registry.js';
import {
  createDefaultPlanStateAccessor as createDefaultPlanStateAccessorFromSubpath,
  createPlanningToolRegistry as createPlanningToolRegistryFromSubpath,
  getOrCreatePlanState as getOrCreatePlanStateFromSubpath,
} from './planning-registry.js';
import {
  createDefaultScratchpadStateAccessor as createDefaultScratchpadStateAccessorFromSubpath,
  createScratchpadToolRegistry as createScratchpadToolRegistryFromSubpath,
  getOrCreateScratchpadState as getOrCreateScratchpadStateFromSubpath,
} from './scratchpad-registry.js';
import {
  createOpenRouterSingleShotAdapter as createOpenRouterSingleShotAdapterFromSubpath,
} from './router/openrouter-singleshot-adapter.js';
import { createTieredRunner as createTieredRunnerFromSubpath } from './router/tiered-runner.js';
import { buildIntegrationsLayer as buildIntegrationsLayerFromSubpath } from './prompt/integrations-layer.js';

const rootDeprecationWarnings = new Set<string>();

function warnDeprecatedRootImport(symbol: string, subpath: string): void {
  if (rootDeprecationWarnings.has(symbol)) {
    return;
  }
  console.warn(
    `[@agent-assistant/harness] Importing ${symbol} from the root is deprecated. Use @agent-assistant/harness/${subpath} instead.`,
  );
  rootDeprecationWarnings.add(symbol);
}

export function createBashToolRegistry(
  ...args: Parameters<typeof createBashToolRegistryFromSubpath>
): ReturnType<typeof createBashToolRegistryFromSubpath> {
  warnDeprecatedRootImport('createBashToolRegistry', 'registries');
  return createBashToolRegistryFromSubpath(...args);
}

export function createGitHubPublicReviewToolRegistry(
  ...args: Parameters<typeof createGitHubPublicReviewToolRegistryFromSubpath>
): ReturnType<typeof createGitHubPublicReviewToolRegistryFromSubpath> {
  warnDeprecatedRootImport('createGitHubPublicReviewToolRegistry', 'registries');
  return createGitHubPublicReviewToolRegistryFromSubpath(...args);
}

export function createWorkspaceToolRegistry(
  ...args: Parameters<typeof createWorkspaceToolRegistryFromSubpath>
): ReturnType<typeof createWorkspaceToolRegistryFromSubpath> {
  warnDeprecatedRootImport('createWorkspaceToolRegistry', 'registries');
  return createWorkspaceToolRegistryFromSubpath(...args);
}

export function createMemoryToolRegistry(
  ...args: Parameters<typeof createMemoryToolRegistryFromSubpath>
): ReturnType<typeof createMemoryToolRegistryFromSubpath> {
  warnDeprecatedRootImport('createMemoryToolRegistry', 'registries');
  return createMemoryToolRegistryFromSubpath(...args);
}

export function createSubagentToolRegistry(
  ...args: Parameters<typeof createSubagentToolRegistryFromSubpath>
): ReturnType<typeof createSubagentToolRegistryFromSubpath> {
  warnDeprecatedRootImport('createSubagentToolRegistry', 'registries');
  return createSubagentToolRegistryFromSubpath(...args);
}

export function createPlanningToolRegistry(
  ...args: Parameters<typeof createPlanningToolRegistryFromSubpath>
): ReturnType<typeof createPlanningToolRegistryFromSubpath> {
  warnDeprecatedRootImport('createPlanningToolRegistry', 'registries');
  return createPlanningToolRegistryFromSubpath(...args);
}

export function createDefaultPlanStateAccessor(
  ...args: Parameters<typeof createDefaultPlanStateAccessorFromSubpath>
): ReturnType<typeof createDefaultPlanStateAccessorFromSubpath> {
  warnDeprecatedRootImport('createDefaultPlanStateAccessor', 'registries');
  return createDefaultPlanStateAccessorFromSubpath(...args);
}

export function getOrCreatePlanState(
  ...args: Parameters<typeof getOrCreatePlanStateFromSubpath>
): ReturnType<typeof getOrCreatePlanStateFromSubpath> {
  warnDeprecatedRootImport('getOrCreatePlanState', 'registries');
  return getOrCreatePlanStateFromSubpath(...args);
}

export function createScratchpadToolRegistry(
  ...args: Parameters<typeof createScratchpadToolRegistryFromSubpath>
): ReturnType<typeof createScratchpadToolRegistryFromSubpath> {
  warnDeprecatedRootImport('createScratchpadToolRegistry', 'registries');
  return createScratchpadToolRegistryFromSubpath(...args);
}

export function createDefaultScratchpadStateAccessor(
  ...args: Parameters<typeof createDefaultScratchpadStateAccessorFromSubpath>
): ReturnType<typeof createDefaultScratchpadStateAccessorFromSubpath> {
  warnDeprecatedRootImport('createDefaultScratchpadStateAccessor', 'registries');
  return createDefaultScratchpadStateAccessorFromSubpath(...args);
}

export function getOrCreateScratchpadState(
  ...args: Parameters<typeof getOrCreateScratchpadStateFromSubpath>
): ReturnType<typeof getOrCreateScratchpadStateFromSubpath> {
  warnDeprecatedRootImport('getOrCreateScratchpadState', 'registries');
  return getOrCreateScratchpadStateFromSubpath(...args);
}

export function createOpenRouterSingleShotAdapter(
  ...args: Parameters<typeof createOpenRouterSingleShotAdapterFromSubpath>
): ReturnType<typeof createOpenRouterSingleShotAdapterFromSubpath> {
  warnDeprecatedRootImport('createOpenRouterSingleShotAdapter', 'router');
  return createOpenRouterSingleShotAdapterFromSubpath(...args);
}

export function createTieredRunner(
  ...args: Parameters<typeof createTieredRunnerFromSubpath>
): ReturnType<typeof createTieredRunnerFromSubpath> {
  warnDeprecatedRootImport('createTieredRunner', 'router');
  return createTieredRunnerFromSubpath(...args);
}

export function buildIntegrationsLayer(
  ...args: Parameters<typeof buildIntegrationsLayerFromSubpath>
): ReturnType<typeof buildIntegrationsLayerFromSubpath> {
  warnDeprecatedRootImport('buildIntegrationsLayer', 'prompt');
  return buildIntegrationsLayerFromSubpath(...args);
}

export { BashToolRegistry } from './tools/bash-tool-registry.js';
export type { BashToolConfig } from './tools/bash-tool-registry.js';
export { GitHubPublicFetcher, GitHubPublicFetchError } from './tools/github-public-fetcher.js';
export type {
  GitHubPublicFetcherOptions,
  GitHubPublicReview,
} from './tools/github-public-fetcher.js';
export {
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
export type { IntegrationContextInput, IntegrationLayerOptions } from './prompt/integrations-layer.js';
export {
  WORKSPACE_LIST_TOOL_NAME,
  WORKSPACE_READ_JSON_TOOL_NAME,
  WORKSPACE_READ_TOOL_NAME,
  WORKSPACE_SEARCH_TOOL_NAME,
  WORKSPACE_TOOL_NAMES,
} from './tools/workspace-tool-registry.js';
export type { WorkspaceToolRegistryOptions } from './tools/workspace-tool-registry.js';
export {
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
  SCRATCHPAD_DEFAULT_MAX_FILE_BYTES,
  SCRATCHPAD_DEFAULT_MAX_TOTAL_BYTES,
  SCRATCHPAD_SCRATCH_KEY,
} from './scratchpad-registry.js';
export type {
  HarnessScratchFile,
  HarnessScratchpadState,
  CreateScratchpadToolRegistryOptions,
} from './scratchpad-registry.js';

export { OpenRouterSingleShotAdapter } from './router/openrouter-singleshot-adapter.js';
export type { OpenRouterSingleShotAdapterConfig } from './router/openrouter-singleshot-adapter.js';
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
  HarnessEvidenceDensityViolation,
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
  HarnessToolBatchStartedEvent,
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
