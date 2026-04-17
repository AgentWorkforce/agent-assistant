export { ClaudeCodeExecutionAdapter, createClaudeCodeAdapter } from './claude-code-adapter.js';
export { OpenRouterExecutionAdapter, createOpenRouterAdapter } from './openrouter-adapter.js';
export { createAgentRelayProofTransport, runByohLocalProof } from './proof/byoh-local-proof.js';
export { createValidationSpecialist } from './proof/validation-specialist.js';

export type {
  ByohLocalProofConfig,
  ByohLocalProofResult,
  ByohProofScenario,
  ProofTurnContextAssembler,
  ProofRelayTransport,
} from './proof/byoh-local-proof.js';
export type { ValidationSpecialistConfig } from './proof/validation-specialist.js';
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
