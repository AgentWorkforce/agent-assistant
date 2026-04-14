// Factory
export { createContinuationRuntime } from './continuation.js';

// Store adapter
export { InMemoryContinuationStore } from './store.js';

// Error classes
export {
  ContinuationError,
  ContinuationNotFoundError,
  ContinuationExpiredError,
  ContinuationAlreadyTerminalError,
  ContinuationTriggerMismatchError,
  ContinuationInvalidInputError,
} from './types.js';

// All types
export type {
  // Core record
  ContinuationRecord,
  ContinuationOrigin,
  ContinuationStatus,
  ContinuationBounds,
  ContinuationTerminalReason,
  ContinuationWaitCondition,
  ContinuationResumeTrigger,

  // Delivery
  ContinuationDeliveryTarget,
  ContinuationDeliveryState,
  ContinuationDeliveryStatus,

  // Config
  ContinuationConfig,
  ContinuationDefaults,
  ContinuationClock,

  // Adapters
  ContinuationStore,
  ContinuationHarnessAdapter,
  ContinuationDeliveryAdapter,
  ContinuationSchedulerAdapter,
  ContinuationResumedTurnInput,
  ContinuationDeliveryInput,
  ContinuationDeliveryResult,

  // Trace
  ContinuationTraceSink,
  ContinuationTraceEvent,

  // Input/output
  CreateContinuationInput,
  ResumeContinuationInput,
  StopContinuationInput,
  ContinuationCreateResult,
  ContinuationResumeResult,
  ContinuationStopResult,

  // Runtime interface
  ContinuationRuntime,

  // Re-exported harness types
  HarnessContinuation,
  HarnessResult,
  HarnessUserMessage,
} from './types.js';
