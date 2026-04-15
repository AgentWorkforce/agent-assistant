import type { TurnEnrichmentCandidate } from '@agent-assistant/turn-context';

import type { InboxItem, InboxToEnrichmentProjector } from './types.js';

function getFreshness(receivedAt: string): TurnEnrichmentCandidate['freshness'] {
  const ageMs = Date.now() - Date.parse(receivedAt);

  if (ageMs < 60 * 60 * 1000) {
    return 'current';
  }

  if (ageMs < 24 * 60 * 60 * 1000) {
    return 'recent';
  }

  return 'stale';
}

function getKind(item: InboxItem): TurnEnrichmentCandidate['kind'] {
  switch (item.kind) {
    case 'imported_chat':
      return 'external_snapshot';
    case 'forwarded_message':
      return 'handoff';
    case 'external_transcript':
      return 'external_snapshot';
    case 'trusted_memo':
      return 'specialist_memo';
    case 'other':
      return 'other';
  }
}

function getImportance(item: InboxItem): TurnEnrichmentCandidate['importance'] {
  switch (item.source.trustLevel) {
    case 'verified':
      return 'high';
    case 'trusted':
      return 'medium';
    case 'unverified':
      return 'low';
  }
}

function getConfidence(item: InboxItem): number {
  switch (item.source.trustLevel) {
    case 'verified':
      return 0.95;
    case 'trusted':
      return 0.75;
    case 'unverified':
      return 0.4;
  }
}

export function createInboxEnrichmentProjector(): InboxToEnrichmentProjector {
  return {
    project(item: InboxItem): TurnEnrichmentCandidate | null {
      if (item.status === 'dismissed' || item.status === 'expired') {
        return null;
      }

      return {
        id: `inbox:${item.id}`,
        kind: getKind(item),
        source: item.source.sourceId,
        title: item.title,
        content: item.content,
        importance: getImportance(item),
        confidence: getConfidence(item),
        freshness: getFreshness(item.receivedAt),
        audience: 'assistant',
        metadata: {
          inbox: {
            kind: item.kind,
            assistantId: item.assistantId,
            trustLevel: item.source.trustLevel,
            threadId: item.scope?.threadId,
          },
        },
      };
    },
  };
}
