export * from './shared/index.js';
export * from './github/index.js';
export * from './linear/index.js';
export * from './notion/index.js';
export {
  createSpecialistBridge,
  resolveSpecialistTransports,
} from './bridge.js';
export type {
  SpecialistBridge,
  SpecialistTransports,
  SpecialistTransportResolver,
  CreateSpecialistBridgeOptions,
} from './bridge.js';

export { runSpecialistFallback } from './fallback.js';
export type {
  SpecialistFallbackInput,
  SpecialistFallbackResult,
  RunSpecialistFallbackOptions,
} from './fallback.js';
