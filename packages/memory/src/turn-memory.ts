import { createMemoryAdapter } from '@agent-relay/memory';
import type {
  MemoryAdapter as RelayMemoryAdapter,
  MemoryConfig as RelayMemoryConfig,
} from '@agent-relay/memory';

import {
  createMemoryStore,
  RelayMemoryStoreAdapter,
} from './memory.js';
import { formatRelativeAge } from './relative-age.js';
import { measureMemoryOp } from './observability.js';
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
type TurnMemoryScopeLabels = Partial<Record<TurnMemoryScopeKind, string>>;

export interface RetrieveTurnMemoryContextInput {
  store: MemoryStore;
  sessionId?: string;
  userId?: string;
  workspaceId?: string;
  tags?: string[];
  since?: string;
  query?: string;
  limit?: number;
  perScopeLimit?: number;
  perScopeLimits?: Partial<Record<TurnMemoryScopeKind, number>>;
  order?: MemoryQuery['order'];
  scopeOrder?: TurnMemoryScopeKind[];
}

export interface TurnMemoryContext {
  entries: MemoryEntry[];
  byScope: Partial<Record<TurnMemoryScopeKind, MemoryEntry[]>>;
}

export interface RenderTurnMemoryContextOptions {
  now?: Date;
  scopeLabels?: TurnMemoryScopeLabels;
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
export const SESSION_LOAD_LIMIT = 6;
export const USER_LOAD_LIMIT = 8;
export const WORKSPACE_LOAD_LIMIT = 4;
const DEFAULT_SCOPE_LABELS: Record<TurnMemoryScopeKind, string> = {
  session: 'thread',
  user: 'user',
  workspace: 'workspace',
};

export async function createRelayBackedMemoryStore(
  options: CreateRelayBackedMemoryStoreOptions,
): Promise<RelayBackedMemoryStore> {
  const relayAdapter = await measureMemoryOp(
    { op: 'init' },
    async () =>
      options.relayAdapter ?? await createMemoryAdapter(options.config ?? { type: 'inmemory' }),
  );
  const store = createMemoryStore({
    adapter: new RelayMemoryStoreAdapter(relayAdapter),
  });
  const observedStore = observeMemoryStore(store);

  return {
    store: observedStore,
    relayAdapter,
    async close(): Promise<void> {
      await measureMemoryOp({ op: 'close' }, async () => {
        await relayAdapter.close?.();
      });
    },
  };
}

export async function retrieveTurnMemoryContext(
  input: RetrieveTurnMemoryContextInput,
): Promise<TurnMemoryContext> {
  const scopeOrder = input.scopeOrder ?? DEFAULT_SCOPE_ORDER;
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
      query: input.query,
      limit: resolvePerScopeLimit(scopeKind, input),
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

export function renderTurnMemoryContext(
  context: TurnMemoryContext,
  options: RenderTurnMemoryContextOptions = {},
): string {
  if (context.entries.length === 0) {
    return '';
  }

  const now = options.now ?? new Date();
  const scopeLabels = {
    ...DEFAULT_SCOPE_LABELS,
    ...options.scopeLabels,
  };
  const allowedIds = new Set(context.entries.map((entry) => entry.id));
  const lines: string[] = [];

  for (const scopeKind of DEFAULT_SCOPE_ORDER) {
    for (const entry of context.byScope[scopeKind] ?? []) {
      if (!allowedIds.has(entry.id) || entry.content.trim().length === 0) {
        continue;
      }

      lines.push(
        `[${scopeLabels[scopeKind]}, ${formatRelativeAge(entry, now)}] ${entry.content}`,
      );
    }
  }

  return lines.join('\n');
}

export async function promoteLatestSessionMemory(
  input: PromoteLatestSessionMemoryInput,
): Promise<MemoryEntry | null> {
  const sessionScope: MemoryScope = { kind: 'session', sessionId: input.sessionId };
  const [source] = await input.store.retrieve({
    scope: sessionScope,
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

function resolvePerScopeLimit(
  scopeKind: TurnMemoryScopeKind,
  input: RetrieveTurnMemoryContextInput,
): number {
  const explicitLimit = input.perScopeLimits?.[scopeKind] ?? input.perScopeLimit ?? input.limit;
  if (explicitLimit) {
    return normalizeLimit(explicitLimit);
  }

  switch (scopeKind) {
    case 'session':
      return SESSION_LOAD_LIMIT;
    case 'user':
      return USER_LOAD_LIMIT;
    case 'workspace':
      return WORKSPACE_LOAD_LIMIT;
  }
}

function scopeEventMeta(scope: MemoryScope): Pick<
  MemoryQuery,
  never
> &
  Partial<{
    scope: 'session' | 'user' | 'workspace';
    sessionId: string;
    userId: string;
    workspaceId: string;
  }> {
  switch (scope.kind) {
    case 'session':
      return { scope: 'session', sessionId: scope.sessionId };
    case 'user':
      return { scope: 'user', userId: scope.userId };
    case 'workspace':
      return { scope: 'workspace', workspaceId: scope.workspaceId };
    default:
      return {};
  }
}

function observeMemoryStore(store: MemoryStore): MemoryStore {
  return {
    ...store,
    async write(input) {
      return measureMemoryOp(
        {
          op: 'save',
          ...scopeEventMeta(input.scope),
          contentChars: input.content.length,
          entryCount: 1,
        },
        async () => store.write(input),
      );
    },
    async retrieve(query) {
      return measureMemoryOp(
        {
          op: 'load',
          ...scopeEventMeta(query.scope),
        },
        async () => store.retrieve(query),
      );
    },
    async promote(input) {
      return measureMemoryOp(
        {
          op: 'promote',
          ...scopeEventMeta(input.targetScope),
          contentChars: input.content?.length,
          entryCount: 1,
        },
        async () => store.promote(input),
      );
    },
    async compact(input) {
      return measureMemoryOp(
        {
          op: 'compact',
          ...scopeEventMeta(input.targetScope),
          entryCount: input.sourceEntryIds.length,
        },
        async () => store.compact(input),
      );
    },
    async delete(entryId) {
      return measureMemoryOp({ op: 'forget', entryCount: 1 }, async () => {
        await store.delete(entryId);
      });
    },
    async deleteByScope(scope) {
      return measureMemoryOp(
        {
          op: 'forget',
          ...scopeEventMeta(scope),
        },
        async () => store.deleteByScope(scope),
      );
    },
  };
}
