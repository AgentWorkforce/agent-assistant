import { InMemoryAdapter } from '@agent-relay/memory';
import type {
  AddMemoryOptions,
  MemoryAdapter as RelayMemoryAdapter,
  MemoryEntry as RelayMemoryEntry,
} from '@agent-relay/memory';

import {
  CompactionError,
  InvalidScopePromotionError,
  MemoryEntryNotFoundError,
} from './types.js';
import type {
  CompactMemoryInput,
  MemoryAdapterQuery,
  MemoryEntry,
  MemoryQuery,
  MemoryScope,
  MemoryStore,
  MemoryStoreAdapter,
  MemoryStoreConfig,
  PromoteMemoryInput,
  UpdateMemoryPatch,
  WriteMemoryInput,
} from './types.js';

const DEFAULT_RETRIEVE_LIMIT = 20;
const MAX_RELAY_FETCH_LIMIT = 200;
const INTERNAL_SCOPE_KIND = '_scopeKind';
const INTERNAL_UPDATED_AT = '_updatedAt';
const EXPIRES_AT_KEY = 'expiresAt';
const PROMOTED_FROM_ID_KEY = 'promotedFromId';
const COMPACTED_FROM_IDS_KEY = 'compactedFromIds';
const USER_ID_KEY = 'userId';
const ORG_ID_KEY = 'orgId';
const OBJECT_ID_KEY = 'objectId';
const OBJECT_TYPE_KEY = 'objectType';

type RelayListOptions = {
  limit?: number;
  agentId?: string;
  projectId?: string;
};

type RelayAdapterWithList = RelayMemoryAdapter & {
  list: (options?: RelayListOptions) => Promise<RelayMemoryEntry[]>;
  update: (
    id: string,
    content: string,
    options?: Partial<AddMemoryOptions>,
  ) => Promise<{ success: boolean; id?: string; error?: string }>;
};

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTags(tags?: string[]): string[] {
  if (!tags || tags.length === 0) {
    return [];
  }

  return [...new Set(tags)];
}

function normalizeLimit(limit?: number): number {
  if (!limit || limit < 1) {
    return DEFAULT_RETRIEVE_LIMIT;
  }

  return Math.floor(limit);
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case 'session':
      return left.sessionId === (right as { sessionId: string }).sessionId;
    case 'user':
      return left.userId === (right as { userId: string }).userId;
    case 'workspace':
      return left.workspaceId === (right as { workspaceId: string }).workspaceId;
    case 'org':
      return left.orgId === (right as { orgId: string }).orgId;
    case 'object':
      return (
        left.objectId === (right as { objectId: string }).objectId &&
        left.objectType === (right as { objectType: string }).objectType
      );
  }
}

function toTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isExpired(entry: MemoryEntry, referenceIso: string): boolean {
  const expiresAt = toTimestamp(entry.expiresAt);
  const reference = toTimestamp(referenceIso);

  if (expiresAt === null || reference === null) {
    return false;
  }

  return expiresAt < reference;
}

function hasAllTags(entry: MemoryEntry, tags?: string[]): boolean {
  if (!tags || tags.length === 0) {
    return true;
  }

  return tags.every((tag) => entry.tags.includes(tag));
}

function compareEntries(left: MemoryEntry, right: MemoryEntry, order: 'newest' | 'oldest'): number {
  const factor = order === 'newest' ? -1 : 1;
  const createdDelta = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (createdDelta !== 0) {
    return createdDelta * factor;
  }

  return left.id.localeCompare(right.id) * factor;
}

function ensureRelayAdapter(adapter: RelayMemoryAdapter): RelayAdapterWithList {
  if (typeof adapter.list !== 'function' || typeof adapter.update !== 'function') {
    throw new Error('Relay memory adapter must implement list() and update() for v1 assistant memory.');
  }

  return adapter as RelayAdapterWithList;
}

function scopeToRelayAddOptions(entry: MemoryEntry): AddMemoryOptions {
  const metadata: Record<string, unknown> = {
    ...cloneValue(entry.metadata),
    [INTERNAL_SCOPE_KIND]: entry.scope.kind,
    [INTERNAL_UPDATED_AT]: entry.updatedAt,
  };

  if (entry.expiresAt) {
    metadata[EXPIRES_AT_KEY] = entry.expiresAt;
  } else {
    metadata[EXPIRES_AT_KEY] = undefined;
  }

  if (entry.promotedFromId) {
    metadata[PROMOTED_FROM_ID_KEY] = entry.promotedFromId;
  }

  if (entry.compactedFromIds && entry.compactedFromIds.length > 0) {
    metadata[COMPACTED_FROM_IDS_KEY] = cloneValue(entry.compactedFromIds);
  }

  const options: AddMemoryOptions = {
    tags: normalizeTags(entry.tags),
    metadata,
  };

  const source = entry.metadata.source;
  if (typeof source === 'string') {
    options.source = source;
  }

  const agentId = entry.metadata.agentId;
  if (typeof agentId === 'string') {
    options.agentId = agentId;
  }

  switch (entry.scope.kind) {
    case 'session':
      options.sessionId = entry.scope.sessionId;
      break;
    case 'user':
      metadata[USER_ID_KEY] = entry.scope.userId;
      break;
    case 'workspace':
      options.projectId = entry.scope.workspaceId;
      break;
    case 'org':
      metadata[ORG_ID_KEY] = entry.scope.orgId;
      break;
    case 'object':
      metadata[OBJECT_ID_KEY] = entry.scope.objectId;
      metadata[OBJECT_TYPE_KEY] = entry.scope.objectType;
      break;
  }

  return options;
}

function relayEntryToScope(entry: RelayMemoryEntry): MemoryScope | null {
  const metadata = entry.metadata ?? {};
  const scopeKind = metadata[INTERNAL_SCOPE_KIND];

  if (scopeKind === 'session' && entry.sessionId) {
    return { kind: 'session', sessionId: entry.sessionId };
  }

  if (scopeKind === 'user' && typeof metadata[USER_ID_KEY] === 'string') {
    return { kind: 'user', userId: metadata[USER_ID_KEY] };
  }

  if (scopeKind === 'workspace' && entry.projectId) {
    return { kind: 'workspace', workspaceId: entry.projectId };
  }

  if (scopeKind === 'org' && typeof metadata[ORG_ID_KEY] === 'string') {
    return { kind: 'org', orgId: metadata[ORG_ID_KEY] };
  }

  if (
    scopeKind === 'object' &&
    typeof metadata[OBJECT_ID_KEY] === 'string' &&
    typeof metadata[OBJECT_TYPE_KEY] === 'string'
  ) {
    return {
      kind: 'object',
      objectId: metadata[OBJECT_ID_KEY],
      objectType: metadata[OBJECT_TYPE_KEY],
    };
  }

  if (entry.sessionId) {
    return { kind: 'session', sessionId: entry.sessionId };
  }

  if (typeof metadata[OBJECT_ID_KEY] === 'string' && typeof metadata[OBJECT_TYPE_KEY] === 'string') {
    return {
      kind: 'object',
      objectId: metadata[OBJECT_ID_KEY],
      objectType: metadata[OBJECT_TYPE_KEY],
    };
  }

  if (typeof metadata[USER_ID_KEY] === 'string') {
    return { kind: 'user', userId: metadata[USER_ID_KEY] };
  }

  if (entry.projectId) {
    return { kind: 'workspace', workspaceId: entry.projectId };
  }

  if (typeof metadata[ORG_ID_KEY] === 'string') {
    return { kind: 'org', orgId: metadata[ORG_ID_KEY] };
  }

  return null;
}

function relayEntryToAssistantEntry(entry: RelayMemoryEntry): MemoryEntry | null {
  const scope = relayEntryToScope(entry);
  if (!scope) {
    return null;
  }

  const rawMetadata = cloneValue(entry.metadata ?? {});
  const updatedAt =
    typeof rawMetadata[INTERNAL_UPDATED_AT] === 'string'
      ? rawMetadata[INTERNAL_UPDATED_AT]
      : new Date(entry.createdAt).toISOString();
  const expiresAt =
    typeof rawMetadata[EXPIRES_AT_KEY] === 'string' ? rawMetadata[EXPIRES_AT_KEY] : undefined;
  const promotedFromId =
    typeof rawMetadata[PROMOTED_FROM_ID_KEY] === 'string'
      ? rawMetadata[PROMOTED_FROM_ID_KEY]
      : undefined;
  const compactedFromIds = Array.isArray(rawMetadata[COMPACTED_FROM_IDS_KEY])
    ? rawMetadata[COMPACTED_FROM_IDS_KEY].filter(
        (value): value is string => typeof value === 'string',
      )
    : undefined;

  delete rawMetadata[INTERNAL_SCOPE_KIND];
  delete rawMetadata[INTERNAL_UPDATED_AT];

  return {
    id: entry.id,
    scope,
    content: entry.content,
    tags: normalizeTags(entry.tags),
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt,
    expiresAt,
    promotedFromId,
    compactedFromIds,
    metadata: rawMetadata,
  };
}

async function loadRelayEntryWithoutExpiryCheck(
  adapter: RelayMemoryAdapter,
  entryId: string,
): Promise<MemoryEntry | null> {
  const relayEntry = await adapter.get(entryId);
  if (!relayEntry) {
    return null;
  }

  return relayEntryToAssistantEntry(relayEntry);
}

function expandScopes(query: MemoryQuery): MemoryScope[] {
  const scopes: MemoryScope[] = [query.scope];

  if (!query.includeNarrower || query.scope.kind !== 'user') {
    return scopes;
  }

  if (query.context?.sessionId) {
    scopes.push({ kind: 'session', sessionId: query.context.sessionId });
  }

  return scopes;
}

function listOptionsForScope(scope: MemoryScope, limit: number): RelayListOptions {
  if (scope.kind === 'workspace') {
    return { projectId: scope.workspaceId, limit };
  }

  return { limit };
}

function listKeyForOptions(options: RelayListOptions): string {
  return JSON.stringify({
    limit: options.limit ?? null,
    agentId: options.agentId ?? null,
    projectId: options.projectId ?? null,
  });
}

function promotionAllowed(source: MemoryScope['kind'], target: MemoryScope['kind']): boolean {
  const rules: Record<MemoryScope['kind'], MemoryScope['kind'][]> = {
    session: ['user', 'workspace', 'org', 'object'],
    user: ['workspace', 'org'],
    workspace: ['org'],
    org: [],
    object: ['user', 'workspace', 'org'],
  };

  return rules[source].includes(target);
}

function validatePromotion(source: MemoryScope, target: MemoryScope): void {
  if (!promotionAllowed(source.kind, target.kind)) {
    throw new InvalidScopePromotionError(
      `Cannot promote memory from ${source.kind} scope to ${target.kind} scope.`,
    );
  }
}

function mergeSourceMetadata(entries: MemoryEntry[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.metadata)) {
      if (!(key in merged)) {
        merged[key] = cloneValue(value);
      }
    }
  }

  return merged;
}

class BaseRelayMemoryStoreAdapter implements MemoryStoreAdapter {
  protected readonly adapter: RelayAdapterWithList;

  constructor(adapter: RelayMemoryAdapter) {
    this.adapter = ensureRelayAdapter(adapter);
  }

  async insert(entry: MemoryEntry): Promise<MemoryEntry> {
    const result = await this.adapter.add(entry.content, scopeToRelayAddOptions(entry));
    if (!result.success || !result.id) {
      throw new Error(result.error ?? 'Relay memory add() failed.');
    }

    const stored = await loadRelayEntryWithoutExpiryCheck(this.adapter, result.id);
    if (!stored) {
      throw new Error(`Relay memory add() succeeded but entry ${result.id} could not be loaded.`);
    }

    return stored;
  }

  async fetchById(entryId: string): Promise<MemoryEntry | null> {
    const relayEntry = await this.adapter.get(entryId);
    if (!relayEntry) {
      return null;
    }

    const entry = relayEntryToAssistantEntry(relayEntry);
    if (!entry || isExpired(entry, nowIso())) {
      return null;
    }

    return entry;
  }

  async fetchMany(query: MemoryAdapterQuery): Promise<MemoryEntry[]> {
    const relayLimit = Math.min(query.limit * 3, MAX_RELAY_FETCH_LIMIT);
    const candidates = await this.listCandidates(query.scopes, relayLimit);

    const results = candidates.filter((entry) => {
      if (!query.scopes.some((scope) => sameScope(scope, entry.scope))) {
        return false;
      }

      if (!hasAllTags(entry, query.tags)) {
        return false;
      }

      if (query.since && Date.parse(entry.createdAt) < Date.parse(query.since)) {
        return false;
      }

      if (isExpired(entry, query.excludeExpiredBefore)) {
        return false;
      }

      return true;
    });

    results.sort((left, right) => compareEntries(left, right, query.order));
    return results.slice(0, query.limit).map((entry) => cloneValue(entry));
  }

  async update(entryId: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry> {
    const existingRelayEntry = await this.adapter.get(entryId);
    if (!existingRelayEntry) {
      throw new MemoryEntryNotFoundError(entryId);
    }

    const existing = relayEntryToAssistantEntry(existingRelayEntry);
    if (!existing) {
      throw new MemoryEntryNotFoundError(entryId);
    }

    const next: MemoryEntry = {
      ...existing,
      ...cloneValue(patch),
      scope: existing.scope,
      promotedFromId: patch.promotedFromId ?? existing.promotedFromId,
      compactedFromIds: patch.compactedFromIds ?? existing.compactedFromIds,
      tags: patch.tags ? normalizeTags(patch.tags) : existing.tags,
      metadata: {
        ...existing.metadata,
        ...(patch.metadata ?? {}),
      },
      updatedAt: patch.updatedAt ?? nowIso(),
    };

    next.expiresAt = Object.prototype.hasOwnProperty.call(patch, 'expiresAt')
      ? patch.expiresAt
      : existing.expiresAt;

    const result = await this.adapter.update(
      entryId,
      next.content,
      scopeToRelayAddOptions(next),
    );
    if (!result.success) {
      throw new Error(result.error ?? `Relay memory update() failed for ${entryId}.`);
    }

    const stored = await this.fetchById(entryId);
    if (!stored) {
      throw new MemoryEntryNotFoundError(entryId);
    }

    return stored;
  }

  async deleteById(entryId: string): Promise<void> {
    await this.adapter.delete(entryId);
  }

  async deleteManyByScope(scope: MemoryScope): Promise<number> {
    const entries = await this.listCandidates([scope], Number.MAX_SAFE_INTEGER);
    const toDelete = entries.filter((entry) => sameScope(entry.scope, scope));

    for (const entry of toDelete) {
      await this.adapter.delete(entry.id);
    }

    return toDelete.length;
  }

  protected async listCandidates(scopes: MemoryScope[], limit: number): Promise<MemoryEntry[]> {
    const calls = new Map<string, RelayListOptions>();
    for (const scope of scopes) {
      const options = listOptionsForScope(scope, limit);
      calls.set(listKeyForOptions(options), options);
    }

    const entries = new Map<string, MemoryEntry>();
    for (const options of calls.values()) {
      const relayEntries = await this.adapter.list(options);
      for (const relayEntry of relayEntries) {
        const entry = relayEntryToAssistantEntry(relayEntry);
        if (entry) {
          entries.set(entry.id, entry);
        }
      }
    }

    return [...entries.values()];
  }
}

export class RelayMemoryStoreAdapter extends BaseRelayMemoryStoreAdapter {
  constructor(adapter: RelayMemoryAdapter) {
    super(adapter);
  }
}

export class InMemoryMemoryStoreAdapter extends BaseRelayMemoryStoreAdapter {
  constructor() {
    super(new InMemoryAdapter());
  }
}

export function createMemoryStore(config: MemoryStoreConfig): MemoryStore {
  const adapter = config.adapter;
  const applyInclusionRules = config.applyInclusionRules ?? true;

  async function insertAssistantEntry(entry: MemoryEntry): Promise<MemoryEntry> {
    return adapter.insert(entry);
  }

  async function getRequiredEntry(entryId: string): Promise<MemoryEntry> {
    const entry = await adapter.fetchById(entryId);
    if (!entry) {
      throw new MemoryEntryNotFoundError(entryId);
    }

    return entry;
  }

  function createDraft(input: WriteMemoryInput & Pick<MemoryEntry, 'promotedFromId' | 'compactedFromIds'>): MemoryEntry {
    const timestamp = nowIso();
    return {
      id: '',
      scope: cloneValue(input.scope),
      content: input.content,
      tags: normalizeTags(input.tags),
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: input.expiresAt,
      promotedFromId: input.promotedFromId,
      compactedFromIds: input.compactedFromIds ? cloneValue(input.compactedFromIds) : undefined,
      metadata: cloneValue(input.metadata ?? {}),
    };
  }

  return {
    async write(input: WriteMemoryInput): Promise<MemoryEntry> {
      return insertAssistantEntry(
        createDraft({
          ...input,
          promotedFromId: undefined,
          compactedFromIds: undefined,
        }),
      );
    },

    async retrieve(query: MemoryQuery): Promise<MemoryEntry[]> {
      const limit = normalizeLimit(query.limit);
      const scopes = applyInclusionRules ? expandScopes(query) : [query.scope];

      return adapter.fetchMany({
        scopes,
        tags: query.tags,
        since: query.since,
        excludeExpiredBefore: nowIso(),
        limit,
        order: query.order ?? 'newest',
      });
    },

    async get(entryId: string): Promise<MemoryEntry | null> {
      return adapter.fetchById(entryId);
    },

    async update(entryId: string, patch: UpdateMemoryPatch): Promise<MemoryEntry> {
      const existing = await getRequiredEntry(entryId);

      return adapter.update(entryId, {
        content: patch.content ?? existing.content,
        tags: patch.tags ?? existing.tags,
        expiresAt: patch.expiresAt === null ? undefined : patch.expiresAt ?? existing.expiresAt,
        metadata: {
          ...existing.metadata,
          ...(patch.metadata ?? {}),
        },
      });
    },

    async delete(entryId: string): Promise<void> {
      await adapter.deleteById(entryId);
    },

    async deleteByScope(scope: MemoryScope): Promise<number> {
      return adapter.deleteManyByScope(scope);
    },

    async promote(input: PromoteMemoryInput): Promise<MemoryEntry> {
      const source = await getRequiredEntry(input.sourceEntryId);
      validatePromotion(source.scope, input.targetScope);

      const metadata: Record<string, unknown> = {
        ...cloneValue(source.metadata),
      };

      if (metadata.createdInSessionId === undefined && source.scope.kind === 'session') {
        metadata.createdInSessionId = source.scope.sessionId;
      }

      const promoted = await insertAssistantEntry(
        createDraft({
          scope: input.targetScope,
          content: input.content ?? source.content,
          tags: input.tags ?? source.tags,
          expiresAt: source.expiresAt,
          metadata,
          promotedFromId: source.id,
          compactedFromIds: source.compactedFromIds,
        }),
      );

      if (input.deleteOriginal) {
        await adapter.deleteById(source.id);
      }

      return promoted;
    },

    async compact(input: CompactMemoryInput): Promise<MemoryEntry> {
      if (input.sourceEntryIds.length === 0) {
        throw new CompactionError([], new Error('sourceEntryIds must be non-empty.'));
      }

      const sourceEntries = await Promise.all(input.sourceEntryIds.map((entryId) => getRequiredEntry(entryId)));
      const firstScope = sourceEntries[0]?.scope;

      if (!firstScope) {
        throw new CompactionError(input.sourceEntryIds, new Error('No source entries were loaded.'));
      }

      if (!sourceEntries.every((entry) => sameScope(entry.scope, firstScope))) {
        throw new CompactionError(
          input.sourceEntryIds,
          new Error('All source entries must share the same scope.'),
        );
      }

      if (!sameScope(firstScope, input.targetScope)) {
        throw new CompactionError(
          input.sourceEntryIds,
          new Error('Compaction targetScope must match the shared source scope.'),
        );
      }

      let compactedContent: string;
      try {
        compactedContent = await input.compactionCallback(sourceEntries.map((entry) => cloneValue(entry)));
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        throw new CompactionError(input.sourceEntryIds, cause);
      }

      const compacted = await insertAssistantEntry(
        createDraft({
          scope: input.targetScope,
          content: compactedContent,
          tags: input.tags ?? sourceEntries.flatMap((entry) => entry.tags),
          expiresAt: sourceEntries.find((entry) => entry.expiresAt)?.expiresAt,
          metadata: {
            ...mergeSourceMetadata(sourceEntries),
            ...(input.metadata ?? {}),
          },
          promotedFromId: undefined,
          compactedFromIds: sourceEntries.map((entry) => entry.id),
        }),
      );

      if (input.deleteSourceEntries) {
        for (const sourceEntry of sourceEntries) {
          await adapter.deleteById(sourceEntry.id);
        }
      }

      return compacted;
    },
  };
}
