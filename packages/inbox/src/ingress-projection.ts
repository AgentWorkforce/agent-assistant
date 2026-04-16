import type {
  IngressEnvelope,
  IngressResolutionResult,
} from './ingress-types.js';
import type {
  InboxItemKind,
  InboxSourceTrust,
  InboxWriteInput,
} from './types.js';

export function projectEnvelopeToInboxInput(input: {
  envelope: IngressEnvelope;
  resolution: IngressResolutionResult & { resolved: true };
  kind?: InboxItemKind;
  trustLevel?: InboxSourceTrust['trustLevel'];
  title?: string;
  tags?: string[];
}): InboxWriteInput {
  const { envelope, resolution } = input;

  return {
    assistantId: resolution.assistantId ?? resolution.workspaceId,
    kind: input.kind ?? 'other',
    source: {
      sourceId: envelope.provider,
      trustLevel: input.trustLevel ?? 'trusted',
      producedAt: envelope.receivedAt,
    },
    content: JSON.stringify(envelope.payload) as string,
    title: input.title,
    tags: input.tags,
    scope: {
      workspaceId: resolution.workspaceId,
    },
    metadata: {
      ingress: {
        provider: envelope.provider,
        eventType: envelope.eventType,
        connectionId: envelope.connectionId,
        resolvedVia: resolution.resolvedVia,
      },
    },
  };
}
