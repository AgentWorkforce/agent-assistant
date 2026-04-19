export { createAgentRelayProofTransport, runByohLocalProof } from './adapter/proof/byoh-local-proof.js';
export { createValidationSpecialist } from './adapter/proof/validation-specialist.js';

export type {
  ByohLocalProofConfig,
  ByohLocalProofResult,
  ByohProofScenario,
  ProofTurnContextAssembler,
  ProofRelayTransport,
} from './adapter/proof/byoh-local-proof.js';
export type { ValidationSpecialistConfig } from './adapter/proof/validation-specialist.js';
