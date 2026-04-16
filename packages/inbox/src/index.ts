export { createInboxStore } from './inbox.js';
export { createInboxMemoryProjector } from './memory-projector.js';
export { createInboxEnrichmentProjector } from './enrichment-projector.js';
export { createIngressRouter } from './ingress-router.js';
export { projectEnvelopeToInboxInput } from './ingress-projection.js';

export {
  InboxItemNotFoundError,
  InboxInvalidStatusTransitionError,
  InboxRelayNativeSourceError,
} from './types.js';

export type {
  InboxAdapterQuery,
  InboxItem,
  InboxItemKind,
  InboxItemScope,
  InboxItemStatus,
  InboxListQuery,
  InboxSourceTrust,
  InboxStore,
  InboxStoreAdapter,
  InboxStoreConfig,
  InboxToEnrichmentProjector,
  InboxToMemoryProjector,
  InboxWriteInput,
} from './types.js';

export type {
  IngressEnvelope,
  IngressVerificationResult,
  IngressVerifier,
  IngressResolutionResult,
  IngressResolver,
  IngressHandlerResult,
  IngressHandler,
  IngressRouter,
  IngressOutcome,
} from './ingress-types.js';
