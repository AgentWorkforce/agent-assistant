export { createTurnContextAssembler } from './assembler.js';
export type { CreateTurnContextAssemblerOptions } from './assembler.js';

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
  TurnEnrichmentProjector,
  TurnInstructionComposer,
} from './types.js';

export { TurnContextValidationError } from './validation.js';
