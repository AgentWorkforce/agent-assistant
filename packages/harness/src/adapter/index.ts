export { ClaudeCodeExecutionAdapter, createClaudeCodeAdapter } from './claude-code-adapter.js';
export { BuiltInHarnessAdapter, createBuiltInHarnessAdapter } from './built-in-harness-adapter.js';
export type { BuiltInHarnessAdapterConfig } from './built-in-harness-adapter.js';
// NOTE: AgentRelayExecutionAdapter is intentionally NOT re-exported from
// the default barrel. It imports RelayAdapter from @agent-relay/sdk, which
// has a Node-only implementation — the SDK's workerd/worker conditional
// export omits RelayAdapter, so bundlers targeting Cloudflare Workers fail
// to link this file when it's pulled in transitively.
//
// Consumers that need the adapter should import from the dedicated subpath:
//     import { createAgentRelayExecutionAdapter } from '@agent-assistant/harness/agent-relay';
// Workers bundlers won't resolve that subpath unless the consumer asks
// for it explicitly, so worker bundles stay clean.
export { LocalCommandExecutionAdapter, createLocalCommandAdapter } from './local-command-adapter.js';
export { OpenRouterExecutionAdapter, createOpenRouterAdapter } from './openrouter-adapter.js';
export { AnthropicModelAdapter, createAnthropicModelAdapter } from './anthropic-model-adapter.js';
export { OpenAIModelAdapter, createOpenAIModelAdapter } from './openai-model-adapter.js';
export { GeminiModelAdapter, createGeminiModelAdapter } from './gemini-model-adapter.js';

// Type-only re-exports are stripped by the TS compiler to nothing in JS,
// so bundlers never follow the link. Safe to keep here for convenience.
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
export type { AnthropicModelAdapterConfig } from './anthropic-model-adapter.js';
export type { OpenAIModelAdapterConfig } from './openai-model-adapter.js';
export type { GeminiModelAdapterConfig } from './gemini-model-adapter.js';
export type {
  OpenRouterResponseCacheConfig,
  OpenRouterResponseCacheOption,
} from './openrouter-cache.js';
export type {
  ExecutionAdapter,
  ExecutionCapabilities,
  ExecutionNegotiation,
  ExecutionNegotiationReason,
  ExecutionRequest,
  ExecutionRequirements,
  ExecutionResult,
  ExecutionStreamError,
  ExecutionStreamEvent,
  ExecutionToolDescriptor,
  ExecutionToolResult,
  ExecutionTrace,
  ExecutionTraceEvent,
  ExecutionUsage,
} from './types.js';
