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
  ActiveThreadKey,
  ActiveThreadStore,
  SlackThreadGateOptions,
  ThreadGateDecision,
  ThreadGateDropReason,
  ThreadGateEvent,
} from "./slack-thread-gate.js";

export { classifySlackIngressEvent } from "./slack-ingress.js";
export type {
  SlackIngressClassification,
  SlackIngressKind,
} from "./slack-ingress.js";

export { classifySlackPresenceSignal } from './slack-presence-signal.js';

export { classifyGithubProactiveSignal } from './github-signal-source.js';

export {
  SlackEventDedupGate,
  getSlackDeduplicationKey,
} from "./slack-event-dedup.js";
export type {
  SlackEventDedupDecision,
  SlackEventDedupDropReason,
  SlackEventDedupGateOptions,
  SlackEventDedupInput,
  SlackEventDedupStore,
} from "./slack-event-dedup.js";
