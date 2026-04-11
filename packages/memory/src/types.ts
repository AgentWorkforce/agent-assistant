export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  promotedFromId?: string;
  compactedFromIds?: string[];
  metadata: Record<string, unknown>;
}

export type MemoryScope =
  | { kind: 'session'; sessionId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'org'; orgId: string }
  | { kind: 'object'; objectId: string; objectType: string };

export interface MemoryStore {
  write(input: WriteMemoryInput): Promise<MemoryEntry>;
  retrieve(query: MemoryQuery): Promise<MemoryEntry[]>;
  get(entryId: string): Promise<MemoryEntry | null>;
  update(entryId: string, patch: UpdateMemoryPatch): Promise<MemoryEntry>;
  delete(entryId: string): Promise<void>;
  deleteByScope(scope: MemoryScope): Promise<number>;
  promote(input: PromoteMemoryInput): Promise<MemoryEntry>;
  compact(input: CompactMemoryInput): Promise<MemoryEntry>;
}

export interface WriteMemoryInput {
  scope: MemoryScope;
  content: string;
  tags?: string[];
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  scope: MemoryScope;
  includeNarrower?: boolean;
  tags?: string[];
  since?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
  context?: {
    sessionId?: string;
  };
}

export interface UpdateMemoryPatch {
  content?: string;
  tags?: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PromoteMemoryInput {
  sourceEntryId: string;
  targetScope: MemoryScope;
  deleteOriginal?: boolean;
  content?: string;
  tags?: string[];
}

export interface CompactMemoryInput {
  sourceEntryIds: string[];
  targetScope: MemoryScope;
  compactionCallback: CompactionCallback;
  deleteSourceEntries?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export type CompactionCallback = (entries: MemoryEntry[]) => Promise<string> | string;

export interface MemoryStoreAdapter {
  insert(entry: MemoryEntry): Promise<MemoryEntry>;
  fetchById(entryId: string): Promise<MemoryEntry | null>;
  fetchMany(query: MemoryAdapterQuery): Promise<MemoryEntry[]>;
  update(entryId: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry>;
  deleteById(entryId: string): Promise<void>;
  deleteManyByScope(scope: MemoryScope): Promise<number>;
}

export interface MemoryAdapterQuery {
  scopes: MemoryScope[];
  tags?: string[];
  since?: string;
  excludeExpiredBefore: string;
  limit: number;
  order: 'newest' | 'oldest';
}

export interface MemoryStoreConfig {
  adapter: MemoryStoreAdapter;
  applyInclusionRules?: boolean;
}

export class MemoryEntryNotFoundError extends Error {
  constructor(public readonly entryId: string) {
    super(`Memory entry not found: ${entryId}`);
    this.name = 'MemoryEntryNotFoundError';
  }
}

export class InvalidScopePromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScopePromotionError';
  }
}

export class CompactionError extends Error {
  constructor(
    public readonly sourceEntryIds: string[],
    cause: Error,
  ) {
    super(`Compaction failed for entries [${sourceEntryIds.join(', ')}]: ${cause.message}`);
    this.name = 'CompactionError';
    this.cause = cause;
  }
}
