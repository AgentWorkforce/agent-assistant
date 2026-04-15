import type { TurnMemoryCandidate } from '@agent-assistant/turn-context';

import type { InboxItem, InboxToMemoryProjector } from './types.js';

function getFreshness(receivedAt: string): TurnMemoryCandidate['freshness'] {
  const ageMs = Date.now() - Date.parse(receivedAt);

  if (ageMs < 60 * 60 * 1000) {
    return 'current';
  }

  if (ageMs < 24 * 60 * 60 * 1000) {
    return 'recent';
  }

  return 'stale';
}

function getScope(item: InboxItem): TurnMemoryCandidate['scope'] {
  if (item.scope?.userId) {
    return 'user';
  }

  if (item.scope?.sessionId) {
    return 'session';
  }

  if (item.scope?.workspaceId) {
    return 'workspace';
  }

  return 'user';
}

function getRelevance(item: InboxItem): number {
  switch (item.source.trustLevel) {
    case 'verified':
      return 0.9;
    case 'trusted':
      return 0.7;
    case 'unverified':
      return 0.4;
  }
}

export function createInboxMemoryProjector(): InboxToMemoryProjector {
  return {
    project(item: InboxItem): TurnMemoryCandidate | null {
      if (item.status === 'dismissed' || item.status === 'expired') {
        return null;
      }

      return {
        id: `inbox:${item.id}`,
        text: item.content,
        scope: getScope(item),
        source: item.source.sourceId,
        relevance: getRelevance(item),
        freshness: getFreshness(item.receivedAt),
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
