// Factory
export { createContinuationRuntime } from './continuation.js';
// Store adapter
export { InMemoryContinuationStore } from './store.js';
// Error classes
export { ContinuationError, ContinuationNotFoundError, ContinuationExpiredError, ContinuationAlreadyTerminalError, ContinuationTriggerMismatchError, ContinuationInvalidInputError, } from './types.js';
