import type { MemoryEntry, MemoryQuery, MemoryStore, MemoryScope } from '@agent-assistant/memory';

import type { TurnMemoryCandidate, TurnMemoryRetriever, TurnMemoryRetrievalInput } from './types.js';

export interface CreateMemoryTurnRetrieverOptions {
  store: MemoryStore;
  defaultLimit?: number;
  includeSessionScope?: boolean;
  includeUserScope?: boolean;
  includeWorkspaceScope?: boolean;
  workspaceIdResolver?: (input: TurnMemoryRetrievalInput) => string | undefined;
  queryTagger?: (input: TurnMemoryRetrievalInput) => string[] | undefined;
}

const DEFAULT_LIMIT = 6;

export function createMemoryTurnRetriever(
  options: CreateMemoryTurnRetrieverOptions,
): TurnMemoryRetriever {
  return {
    async retrieve(input: TurnMemoryRetrievalInput): Promise<TurnMemoryCandidate[]> {
      const limit = input.limit ?? options.defaultLimit ?? DEFAULT_LIMIT;
      const tags = options.queryTagger?.(input);
      const queries: MemoryQuery[] = [];

      if (options.includeSessionScope !== false && input.sessionId) {
        queries.push({
          scope: { kind: 'session', sessionId: input.sessionId },
          limit,
          tags,
          order: 'newest',
        });
      }

      if (options.includeUserScope !== false && input.userId) {
        queries.push({
          scope: { kind: 'user', userId: input.userId },
          limit,
          tags,
          order: 'newest',
          includeNarrower: Boolean(input.sessionId),
          context: input.sessionId ? { sessionId: input.sessionId } : undefined,
        });
      }

      const workspaceId =
        options.includeWorkspaceScope !== false ? options.workspaceIdResolver?.(input) : undefined;
      if (workspaceId) {
        queries.push({
          scope: { kind: 'workspace', workspaceId },
          limit,
          tags,
          order: 'newest',
        });
      }

      const entries = await retrieveAcrossScopes(options.store, queries, limit);
      return entries.map((entry) => mapMemoryEntryToCandidate(entry));
    },
  };
}

async function retrieveAcrossScopes(
  store: MemoryStore,
  queries: MemoryQuery[],
  limit: number,
): Promise<MemoryEntry[]> {
  const entries = await Promise.all(queries.map((query) => store.retrieve(query)));
  const deduped = new Map<string, MemoryEntry>();

  for (const batch of entries) {
    for (const entry of batch) {
      if (!deduped.has(entry.id)) {
        deduped.set(entry.id, entry);
      }
    }
  }

  return [...deduped.values()]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, limit);
}

function mapMemoryEntryToCandidate(entry: MemoryEntry): TurnMemoryCandidate {
  return {
    id: entry.id,
    text: entry.content,
    scope: mapScopeKind(entry.scope),
    source: typeof entry.metadata.source === 'string' ? entry.metadata.source : 'memory-store',
    freshness: mapFreshness(entry.updatedAt),
    metadata: {
      tags: entry.tags,
      scope: entry.scope,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...entry.metadata,
    },
  };
}

function mapScopeKind(scope: MemoryScope): TurnMemoryCandidate['scope'] {
  return scope.kind;
}

function mapFreshness(updatedAt: string): TurnMemoryCandidate['freshness'] {
  const ageMs = Date.now() - Date.parse(updatedAt);
  const dayMs = 24 * 60 * 60 * 1000;

  if (ageMs <= dayMs) return 'current';
  if (ageMs <= dayMs * 7) return 'recent';
  return 'stale';
}
