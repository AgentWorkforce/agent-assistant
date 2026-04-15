export { createSurfaceRegistry } from './surfaces.js';

export {
  SurfaceConflictError,
  SurfaceDeliveryError,
  SurfaceNotFoundError,
} from './types.js';

export type {
  FanoutOutcome,
  FanoutPolicy,
  FanoutResult,
  NormalizedInboundMessage,
  SurfaceAdapter,
  SurfaceCapabilities,
  SurfaceConnection,
  SurfaceFormatHook,
  SurfaceOutboundEvent,
  SurfacePayload,
  SurfaceRegistry,
  SurfaceRegistryConfig,
  SurfaceState,
  SurfaceType,
} from './types.js';

export { SlackThreadGate } from "./slack-thread-gate.js";
export type {
  ActiveThreadContext,
  ActiveThreadStore,
  SlackThreadGateOptions,
  ThreadGateDecision,
  ThreadGateDropReason,
  ThreadGateEvent,
} from "./slack-thread-gate.js";
