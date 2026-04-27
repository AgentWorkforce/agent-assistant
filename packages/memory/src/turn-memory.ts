import { createMemoryAdapter } from '@agent-relay/memory';
import type {
  MemoryAdapter as RelayMemoryAdapter,
  MemoryConfig as RelayMemoryConfig,
} from '@agent-relay/memory';

import {
  createMemoryStore,
  RelayMemoryStoreAdapter,
} from './memory.js';
import type {
  MemoryEntry,
  MemoryQuery,
  MemoryScope,
  MemoryStore,
  PromoteMemoryInput,
} from './types.js';

export interface RelayBackedMemoryStore {
  store: MemoryStore;
  relayAdapter: RelayMemoryAdapter;
  close(): Promise<void>;
}

export interface CreateRelayBackedMemoryStoreOptions {
  config?: RelayMemoryConfig;
  relayAdapter?: RelayMemoryAdapter;
}

export type TurnMemoryScopeKind = Extract<MemoryScope['kind'], 'session' | 'user' | 'workspace'>;

export interface RetrieveTurnMemoryContextInput {
  store: MemoryStore;
  sessionId?: string;
  userId?: string;
  workspaceId?: string;
  tags?: string[];
  since?: string;
  limit?: number;
  perScopeLimit?: number;
  order?: MemoryQuery['order'];
  scopeOrder?: TurnMemoryScopeKind[];
}

export interface TurnMemoryContext {
  entries: MemoryEntry[];
  byScope: Partial<Record<TurnMemoryScopeKind, MemoryEntry[]>>;
}

export interface PromoteLatestSessionMemoryInput {
  store: MemoryStore;
  sessionId: string;
  targetScope?: MemoryScope;
  userId?: string;
  tags?: string[];
  since?: string;
  deleteOriginal?: boolean;
  content?: string;
  promotedTags?: string[];
}

const DEFAULT_SCOPE_ORDER: TurnMemoryScopeKind[] = ['session', 'user', 'workspace'];
const DEFAULT_TURN_MEMORY_LIMIT = 20;

export async function createRelayBackedMemoryStore(
  options: CreateRelayBackedMemoryStoreOptions,
): Promise<RelayBackedMemoryStore> {
  const relayAdapter =
    options.relayAdapter ?? await createMemoryAdapter(options.config ?? { type: 'inmemory' });
  const store = createMemoryStore({
    adapter: new RelayMemoryStoreAdapter(relayAdapter),
  });

  return {
    store,
    relayAdapter,
    async close(): Promise<void> {
      await relayAdapter.close?.();
    },
  };
}

export async function retrieveTurnMemoryContext(
  input: RetrieveTurnMemoryContextInput,
): Promise<TurnMemoryContext> {
  const scopeOrder = input.scopeOrder ?? DEFAULT_SCOPE_ORDER;
  const perScopeLimit = normalizeLimit(input.perScopeLimit ?? input.limit);
  const globalLimit = normalizeLimit(input.limit);
  const byScope: Partial<Record<TurnMemoryScopeKind, MemoryEntry[]>> = {};
  const deduped = new Map<string, MemoryEntry>();

  for (const scopeKind of scopeOrder) {
    const scope = resolveTurnScope(scopeKind, input);
    if (!scope) {
      continue;
    }

    const entries = await input.store.retrieve({
      scope,
      tags: input.tags,
      since: input.since,
      limit: perScopeLimit,
      order: input.order ?? 'newest',
      includeNarrower: false,
    });

    byScope[scopeKind] = entries;

    for (const entry of entries) {
      if (!deduped.has(entry.id)) {
        deduped.set(entry.id, entry);
      }
    }
  }

  return {
    entries: [...deduped.values()].slice(0, globalLimit),
    byScope,
  };
}

export async function promoteLatestSessionMemory(
  input: PromoteLatestSessionMemoryInput,
): Promise<MemoryEntry | null> {
  const [source] = await input.store.retrieve({
    scope: { kind: 'session', sessionId: input.sessionId },
    tags: input.tags,
    since: input.since,
    limit: 1,
    order: 'newest',
  });

  if (!source) {
    return null;
  }

  const targetScope =
    input.targetScope ?? (input.userId ? { kind: 'user', userId: input.userId } : undefined);
  if (!targetScope) {
    throw new Error('promoteLatestSessionMemory requires targetScope or userId.');
  }

  const promotion: PromoteMemoryInput = {
    sourceEntryId: source.id,
    targetScope,
    deleteOriginal: input.deleteOriginal,
    content: input.content,
    tags: input.promotedTags,
  };

  return input.store.promote(promotion);
}

function resolveTurnScope(
  scopeKind: TurnMemoryScopeKind,
  input: RetrieveTurnMemoryContextInput,
): MemoryScope | null {
  switch (scopeKind) {
    case 'session':
      return input.sessionId ? { kind: 'session', sessionId: input.sessionId } : null;
    case 'user':
      return input.userId ? { kind: 'user', userId: input.userId } : null;
    case 'workspace':
      return input.workspaceId ? { kind: 'workspace', workspaceId: input.workspaceId } : null;
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || limit < 1) {
    return DEFAULT_TURN_MEMORY_LIMIT;
  }

  return Math.floor(limit);
}
