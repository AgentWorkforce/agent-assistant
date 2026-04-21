export { ClaudeCodeExecutionAdapter, createClaudeCodeAdapter } from './claude-code-adapter.js';
export {
  AGENT_RELAY_EXECUTION_REQUEST_TYPE,
  AGENT_RELAY_EXECUTION_RESULT_TYPE,
  AgentRelayExecutionAdapter,
  createAgentRelayExecutionAdapter,
} from './agent-relay-adapter.js';
export { LocalCommandExecutionAdapter, createLocalCommandAdapter } from './local-command-adapter.js';
export { OpenRouterExecutionAdapter, createOpenRouterAdapter } from './openrouter-adapter.js';

export type {
  AgentRelayExecutionAdapterConfig,
  AgentRelayExecutionRequestMessage,
  AgentRelayExecutionResultMessage,
  AgentRelayExecutionTransport,
  AgentRelayWorkerSpawnConfig,
} from './agent-relay-adapter.js';
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
