export { createTurnContextAssembler } from './assembler.js';
export type { CreateTurnContextAssemblerOptions } from './assembler.js';
export { createMemoryTurnRetriever } from './memory-retriever.js';
export type { CreateMemoryTurnRetrieverOptions } from './memory-retriever.js';
export { projectToHarness, toExecutionRequest } from './projection.js';
export type {
  ExecutionRequestMessageInput,
  ProjectedExecutionRequest,
  ProjectedExecutionRequirements,
  ProjectedExecutionToolDescriptor,
  ToExecutionRequestOverrides,
} from './projection.js';

export type {
  // Assembler interface
  TurnContextAssembler,

  // Input types
  TurnContextInput,
  TurnIdentityInput,
  TurnShapingInput,
  TurnInstructionOverlay,
  TurnSessionInput,
  TurnMemoryInput,
  TurnMemoryRetrievalInput,
  TurnMemoryCandidate,
  TurnEnrichmentInput,
  TurnEnrichmentCandidate,
  TurnGuardrailInput,
  TurnGuardrailOverlay,
  TurnExpressionProfile,

  // Output types
  TurnContextAssembly,
  TurnIdentityProjection,
  TurnInstructionBundle,
  TurnInstructionSegment,
  TurnPreparedContext,
  TurnPreparedContextBlock,
  TurnContextProvenance,

  // Adapter seam interfaces
  TurnMemoryProjector,
  TurnMemoryRetriever,
  TurnEnrichmentProjector,
  TurnInstructionComposer,
} from './types.js';

export { TurnContextValidationError } from './validation.js';
