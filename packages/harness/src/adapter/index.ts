export { ClaudeCodeExecutionAdapter, createClaudeCodeAdapter } from './claude-code-adapter.js';
export { LocalCommandExecutionAdapter, createLocalCommandAdapter } from './local-command-adapter.js';
export { OpenRouterExecutionAdapter, createOpenRouterAdapter } from './openrouter-adapter.js';

export type {
  ClaudeCodeAdapterConfig,
} from './claude-code-adapter.js';
export type {
  LocalCommandAdapterConfig,
  LocalCommandChildProcess,
  LocalCommandSpawnFn,
  ParsedLocalCommandOutput,
} from './local-command-adapter.js';
export type {
  ExecutionAdapter,
  ExecutionCapabilities,
  ExecutionNegotiation,
  ExecutionNegotiationReason,
  ExecutionRequest,
  ExecutionRequirements,
  ExecutionResult,
  ExecutionToolDescriptor,
  ExecutionTrace,
  ExecutionTraceEvent,
} from './types.js';
