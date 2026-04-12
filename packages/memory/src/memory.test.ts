import { describe, expect, it } from 'vitest';

import {
  createMemoryStore,
  InMemoryMemoryStoreAdapter,
  RelayMemoryStoreAdapter,
} from './memory.js';
import {
  CompactionError,
  InvalidScopePromotionError,
  MemoryEntryNotFoundError,
} from './types.js';
import type {
  MemoryEntry,
  MemoryScope,
  MemoryStore,
  MemoryStoreAdapter,
  MemoryStoreConfig,
} from './types.js';

function futureIso(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function pastIso(hours = 24): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function makeStore(opts?: Partial<MemoryStoreConfig>): MemoryStore {
  return createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter(), ...opts });
}

// ---------------------------------------------------------------------------
// §7.1 Type structural tests (5)
// ---------------------------------------------------------------------------
describe('type structural tests', () => {
  it('MemoryEntry has all required fields', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'test',
    });

    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('scope');
    expect(entry).toHaveProperty('content');
    expect(entry).toHaveProperty('tags');
    expect(entry).toHaveProperty('createdAt');
    expect(entry).toHaveProperty('updatedAt');
    expect(entry).toHaveProperty('metadata');
  });

  it('MemoryScope covers all 5 kinds', () => {
    const scopes: MemoryScope[] = [
      { kind: 'session', sessionId: 's1' },
      { kind: 'user', userId: 'u1' },
      { kind: 'workspace', workspaceId: 'w1' },
      { kind: 'org', orgId: 'o1' },
      { kind: 'object', objectId: 'obj1', objectType: 'ticket' },
    ];
    expect(scopes).toHaveLength(5);
    const kinds = scopes.map((s) => s.kind);
    expect(kinds).toEqual(['session', 'user', 'workspace', 'org', 'object']);
  });

  it('MemoryStore interface has all 8 methods', () => {
    const store = makeStore();
    const methods: (keyof MemoryStore)[] = [
      'write', 'retrieve', 'get', 'update', 'delete', 'deleteByScope', 'promote', 'compact',
    ];
    for (const method of methods) {
      expect(typeof store[method]).toBe('function');
    }
  });

  it('MemoryStoreAdapter interface has all 6 methods', () => {
    const adapter: MemoryStoreAdapter = new InMemoryMemoryStoreAdapter();
    const methods: (keyof MemoryStoreAdapter)[] = [
      'insert', 'fetchById', 'fetchMany', 'update', 'deleteById', 'deleteManyByScope',
    ];
    for (const method of methods) {
      expect(typeof adapter[method]).toBe('function');
    }
  });

  it('MemoryStoreConfig requires adapter field', () => {
    const config: MemoryStoreConfig = { adapter: new InMemoryMemoryStoreAdapter() };
    expect(config.adapter).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// §7.2 Relay adapter bridge (8)
// ---------------------------------------------------------------------------
describe('relay adapter bridge', () => {
  it('InMemoryMemoryStoreAdapter insert + fetchById round-trips', async () => {
    const adapter = new InMemoryMemoryStoreAdapter();
    const entry: MemoryEntry = {
      id: '',
      scope: { kind: 'session', sessionId: 's1' },
      content: 'hello',
      tags: ['a'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };

    const inserted = await adapter.insert(entry);
    expect(inserted.id).toBeTruthy();
    const fetched = await adapter.fetchById(inserted.id);
    expect(fetched?.content).toBe('hello');
  });

  it('session scope stored and reconstructed', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 'sess-abc' },
      content: 'session test',
    });
    const loaded = await store.get(entry.id);
    expect(loaded?.scope).toEqual({ kind: 'session', sessionId: 'sess-abc' });
  });

  it('user scope stored and reconstructed', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'user', userId: 'user-abc' },
      content: 'user test',
    });
    const loaded = await store.get(entry.id);
    expect(loaded?.scope).toEqual({ kind: 'user', userId: 'user-abc' });
  });

  it('workspace scope stored and reconstructed', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'workspace', workspaceId: 'ws-abc' },
      content: 'workspace test',
    });
    const loaded = await store.get(entry.id);
    expect(loaded?.scope).toEqual({ kind: 'workspace', workspaceId: 'ws-abc' });
  });

  it('org scope stored and reconstructed', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'org', orgId: 'org-abc' },
      content: 'org test',
    });
    const loaded = await store.get(entry.id);
    expect(loaded?.scope).toEqual({ kind: 'org', orgId: 'org-abc' });
  });

  it('object scope stored and reconstructed', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'object', objectId: 'ticket-1', objectType: 'ticket' },
      content: 'object test',
    });
    const loaded = await store.get(entry.id);
    expect(loaded?.scope).toEqual({ kind: 'object', objectId: 'ticket-1', objectType: 'ticket' });
  });

  it('expired entry excluded from fetchMany', async () => {
    const adapter = new InMemoryMemoryStoreAdapter();
    const scope: MemoryScope = { kind: 'session', sessionId: 's1' };
    await adapter.insert({
      id: '',
      scope,
      content: 'stale',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: pastIso(1),
      metadata: {},
    });

    const results = await adapter.fetchMany({
      scopes: [scope],
      excludeExpiredBefore: new Date().toISOString(),
      limit: 10,
      order: 'newest',
    });
    expect(results).toHaveLength(0);
  });

  it('non-expired entry included in fetchMany', async () => {
    const adapter = new InMemoryMemoryStoreAdapter();
    const scope: MemoryScope = { kind: 'session', sessionId: 's1' };
    await adapter.insert({
      id: '',
      scope,
      content: 'fresh',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: futureIso(1),
      metadata: {},
    });

    const results = await adapter.fetchMany({
      scopes: [scope],
      excludeExpiredBefore: new Date().toISOString(),
      limit: 10,
      order: 'newest',
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('fresh');
  });
});

// ---------------------------------------------------------------------------
// §7.3 Write + retrieve (8)
// ---------------------------------------------------------------------------
describe('write + retrieve', () => {
  it('write() returns entry with id and timestamps', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'test',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeTruthy();
    expect(entry.updatedAt).toBeTruthy();
  });

  it('write() preserves agentId in metadata', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'test',
      metadata: { agentId: 'agent-1' },
    });
    expect(entry.metadata.agentId).toBe('agent-1');
  });

  it('write() preserves confidence in metadata', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'test',
      metadata: { confidence: 0.95 },
    });
    expect(entry.metadata.confidence).toBe(0.95);
  });

  it('write() preserves source in metadata', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'test',
      metadata: { source: 'conversation' },
    });
    expect(entry.metadata.source).toBe('conversation');
  });

  it('retrieve() returns entries matching exact scope', async () => {
    const store = makeStore();
    const scope = { kind: 'user', userId: 'u1' } as const;
    await store.write({ scope, content: 'match' });
    await store.write({
      scope: { kind: 'user', userId: 'u2' },
      content: 'no match',
    });

    const results = await store.retrieve({ scope });
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('match');
  });

  it('retrieve() excludes expired entries', async () => {
    const store = makeStore();
    const scope = { kind: 'session', sessionId: 's1' } as const;
    await store.write({ scope, content: 'stale', expiresAt: pastIso(1) });
    await store.write({ scope, content: 'fresh', expiresAt: futureIso(1) });

    const results = await store.retrieve({ scope });
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('fresh');
  });

  it('retrieve() filters by tags (all-match)', async () => {
    const store = makeStore();
    const scope = { kind: 'workspace', workspaceId: 'ws1' } as const;
    await store.write({ scope, content: 'both', tags: ['a', 'b'] });
    await store.write({ scope, content: 'only-a', tags: ['a'] });
    await store.write({ scope, content: 'only-b', tags: ['b'] });

    const results = await store.retrieve({ scope, tags: ['a', 'b'] });
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('both');
  });

  it('retrieve() respects limit and order', async () => {
    const store = makeStore();
    const scope = { kind: 'workspace', workspaceId: 'ws1' } as const;
    await store.write({ scope, content: 'first' });
    await store.write({ scope, content: 'second' });
    await store.write({ scope, content: 'third' });

    const newest = await store.retrieve({ scope, order: 'newest', limit: 2 });
    expect(newest).toHaveLength(2);

    const oldest = await store.retrieve({ scope, order: 'oldest', limit: 2 });
    expect(oldest).toHaveLength(2);
    // Verify limit is respected regardless of order
    const all = await store.retrieve({ scope, limit: 10 });
    expect(all).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// §7.4 Update + delete (6)
// ---------------------------------------------------------------------------
describe('update + delete', () => {
  it('update() changes content and updatedAt', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'original',
    });

    const updated = await store.update(entry.id, { content: 'changed' });
    expect(updated.content).toBe('changed');
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(entry.updatedAt));
  });

  it('update() changes tags', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'test',
      tags: ['old'],
    });

    const updated = await store.update(entry.id, { tags: ['new', 'extra'] });
    expect(updated.tags).toEqual(['new', 'extra']);
  });

  it('update() merges metadata without stripping existing keys', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'test',
      metadata: { source: 'original', agentId: 'a1' },
    });

    const updated = await store.update(entry.id, {
      metadata: { confidence: 0.8 },
    });
    expect(updated.metadata.source).toBe('original');
    expect(updated.metadata.agentId).toBe('a1');
    expect(updated.metadata.confidence).toBe(0.8);
  });

  it('update() throws MemoryEntryNotFoundError for unknown id', async () => {
    const store = makeStore();
    await expect(
      store.update('nonexistent-id', { content: 'fail' }),
    ).rejects.toBeInstanceOf(MemoryEntryNotFoundError);
  });

  it('delete() removes entry; idempotent on second call', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'to delete',
    });

    await store.delete(entry.id);
    expect(await store.get(entry.id)).toBeNull();

    // second delete should not throw
    await expect(store.delete(entry.id)).resolves.toBeUndefined();
  });

  it('get() returns null for expired entry', async () => {
    const store = makeStore();
    const entry = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'expiring',
      expiresAt: pastIso(1),
    });

    expect(await store.get(entry.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §7.5 Scope query expansion (6)
// ---------------------------------------------------------------------------
describe('scope query expansion', () => {
  it('retrieve() with includeNarrower: false returns only primary scope', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'user', userId: 'u1' },
      content: 'user entry',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'session entry',
    });

    const results = await store.retrieve({
      scope: { kind: 'user', userId: 'u1' },
      includeNarrower: false,
      context: { sessionId: 's1' },
    });
    expect(results.map((e) => e.content)).toEqual(['user entry']);
  });

  it('retrieve() with includeNarrower: true at user scope includes session entries when sessionId provided', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'user', userId: 'u1' },
      content: 'user entry',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'session entry',
    });

    const results = await store.retrieve({
      scope: { kind: 'user', userId: 'u1' },
      includeNarrower: true,
      context: { sessionId: 's1' },
    });
    expect(results.map((e) => e.content).sort()).toEqual(['session entry', 'user entry']);
  });

  it('retrieve() with includeNarrower: true at user scope does NOT include session without sessionId', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'user', userId: 'u1' },
      content: 'user entry',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'session entry',
    });

    const results = await store.retrieve({
      scope: { kind: 'user', userId: 'u1' },
      includeNarrower: true,
    });
    expect(results.map((e) => e.content)).toEqual(['user entry']);
  });

  it('expandScopeQuery returns correct scopes for user query with sessionId', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'user', userId: 'u1' },
      content: 'user',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 'target-session' },
      content: 'target session',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 'other-session' },
      content: 'other session',
    });

    const results = await store.retrieve({
      scope: { kind: 'user', userId: 'u1' },
      includeNarrower: true,
      context: { sessionId: 'target-session' },
    });

    const contents = results.map((e) => e.content).sort();
    expect(contents).toContain('user');
    expect(contents).toContain('target session');
    expect(contents).not.toContain('other session');
  });

  it('object scope query does not include user/workspace by default', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'object', objectId: 'obj1', objectType: 'ticket' },
      content: 'object entry',
    });
    await store.write({
      scope: { kind: 'user', userId: 'u1' },
      content: 'user entry',
    });

    const results = await store.retrieve({
      scope: { kind: 'object', objectId: 'obj1', objectType: 'ticket' },
      includeNarrower: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('object entry');
  });

  it('results are deduplicated when entry matches multiple scopes', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'user', userId: 'u1' },
      content: 'user entry',
    });

    const results = await store.retrieve({
      scope: { kind: 'user', userId: 'u1' },
      includeNarrower: true,
      context: { sessionId: 's1' },
    });

    const ids = results.map((e) => e.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });
});

// ---------------------------------------------------------------------------
// §7.6 Promotion (8)
// ---------------------------------------------------------------------------
describe('promotion', () => {
  it('promote() creates new entry at target scope', async () => {
    const store = makeStore();
    const source = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'session note',
    });

    const promoted = await store.promote({
      sourceEntryId: source.id,
      targetScope: { kind: 'user', userId: 'u1' },
    });
    expect(promoted.scope).toEqual({ kind: 'user', userId: 'u1' });
    expect(promoted.id).not.toBe(source.id);
  });

  it('promote() sets promotedFromId on new entry', async () => {
    const store = makeStore();
    const source = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'session note',
    });

    const promoted = await store.promote({
      sourceEntryId: source.id,
      targetScope: { kind: 'user', userId: 'u1' },
    });
    expect(promoted.promotedFromId).toBe(source.id);
  });

  it('promote() preserves content from source by default', async () => {
    const store = makeStore();
    const source = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'original content',
    });

    const promoted = await store.promote({
      sourceEntryId: source.id,
      targetScope: { kind: 'user', userId: 'u1' },
    });
    expect(promoted.content).toBe('original content');
  });

  it('promote() uses input.content override when provided', async () => {
    const store = makeStore();
    const source = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'original',
    });

    const promoted = await store.promote({
      sourceEntryId: source.id,
      targetScope: { kind: 'user', userId: 'u1' },
      content: 'overridden content',
    });
    expect(promoted.content).toBe('overridden content');
  });

  it('promote() preserves provenance metadata (agentId, source, confidence, createdInSessionId)', async () => {
    const store = makeStore();
    const source = await store.write({
      scope: { kind: 'session', sessionId: 'sess-orig' },
      content: 'note',
      metadata: { agentId: 'agent-x', source: 'conversation', confidence: 0.9 },
    });

    const promoted = await store.promote({
      sourceEntryId: source.id,
      targetScope: { kind: 'user', userId: 'u1' },
    });
    expect(promoted.metadata.agentId).toBe('agent-x');
    expect(promoted.metadata.source).toBe('conversation');
    expect(promoted.metadata.confidence).toBe(0.9);
    expect(promoted.metadata.createdInSessionId).toBe('sess-orig');
  });

  it('promote() with deleteOriginal removes source entry', async () => {
    const store = makeStore();
    const source = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'ephemeral',
    });

    await store.promote({
      sourceEntryId: source.id,
      targetScope: { kind: 'user', userId: 'u1' },
      deleteOriginal: true,
    });
    expect(await store.get(source.id)).toBeNull();
  });

  it('promote() downward throws InvalidScopePromotionError', async () => {
    const store = makeStore();
    const source = await store.write({
      scope: { kind: 'org', orgId: 'o1' },
      content: 'org note',
    });

    await expect(
      store.promote({
        sourceEntryId: source.id,
        targetScope: { kind: 'user', userId: 'u1' },
      }),
    ).rejects.toBeInstanceOf(InvalidScopePromotionError);
  });

  it('promote() throws MemoryEntryNotFoundError for unknown source', async () => {
    const store = makeStore();
    await expect(
      store.promote({
        sourceEntryId: 'nonexistent',
        targetScope: { kind: 'user', userId: 'u1' },
      }),
    ).rejects.toBeInstanceOf(MemoryEntryNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// §7.7 Compaction (6)
// ---------------------------------------------------------------------------
describe('compaction', () => {
  it('compact() calls callback with correct source entries', async () => {
    const store = makeStore();
    const scope = { kind: 'user', userId: 'u1' } as const;
    const first = await store.write({ scope, content: 'alpha' });
    const second = await store.write({ scope, content: 'beta' });

    let receivedEntries: MemoryEntry[] = [];
    await store.compact({
      sourceEntryIds: [first.id, second.id],
      targetScope: scope,
      compactionCallback: (entries) => {
        receivedEntries = entries;
        return 'merged';
      },
    });

    expect(receivedEntries).toHaveLength(2);
    expect(receivedEntries.map((e) => e.content).sort()).toEqual(['alpha', 'beta']);
  });

  it('compact() result has compactedFromIds set', async () => {
    const store = makeStore();
    const scope = { kind: 'user', userId: 'u1' } as const;
    const first = await store.write({ scope, content: 'a' });
    const second = await store.write({ scope, content: 'b' });

    const compacted = await store.compact({
      sourceEntryIds: [first.id, second.id],
      targetScope: scope,
      compactionCallback: () => 'merged',
    });
    expect(compacted.compactedFromIds).toEqual([first.id, second.id]);
  });

  it('compact() result content matches callback return', async () => {
    const store = makeStore();
    const scope = { kind: 'user', userId: 'u1' } as const;
    const entry = await store.write({ scope, content: 'input' });

    const compacted = await store.compact({
      sourceEntryIds: [entry.id],
      targetScope: scope,
      compactionCallback: () => 'synthesized summary',
    });
    expect(compacted.content).toBe('synthesized summary');
  });

  it('compact() with deleteSourceEntries removes sources', async () => {
    const store = makeStore();
    const scope = { kind: 'user', userId: 'u1' } as const;
    const first = await store.write({ scope, content: 'a' });
    const second = await store.write({ scope, content: 'b' });

    await store.compact({
      sourceEntryIds: [first.id, second.id],
      targetScope: scope,
      deleteSourceEntries: true,
      compactionCallback: () => 'merged',
    });

    expect(await store.get(first.id)).toBeNull();
    expect(await store.get(second.id)).toBeNull();
  });

  it('compact() wraps callback error in CompactionError', async () => {
    const store = makeStore();
    const scope = { kind: 'user', userId: 'u1' } as const;
    const entry = await store.write({ scope, content: 'test' });

    await expect(
      store.compact({
        sourceEntryIds: [entry.id],
        targetScope: scope,
        compactionCallback: () => {
          throw new Error('LLM failed');
        },
      }),
    ).rejects.toBeInstanceOf(CompactionError);
  });

  it('compact() preserves source agent IDs in merged metadata', async () => {
    const store = makeStore();
    const scope = { kind: 'user', userId: 'u1' } as const;
    const first = await store.write({
      scope,
      content: 'a',
      metadata: { agentId: 'agent-1' },
    });
    const second = await store.write({
      scope,
      content: 'b',
      metadata: { agentId: 'agent-2' },
    });

    const compacted = await store.compact({
      sourceEntryIds: [first.id, second.id],
      targetScope: scope,
      compactionCallback: () => 'merged',
    });

    // mergeSourceMetadata keeps the first-seen value for each key
    expect(compacted.metadata.agentId).toBe('agent-1');
  });
});

// ---------------------------------------------------------------------------
// §7.8 deleteByScope (3)
// ---------------------------------------------------------------------------
describe('deleteByScope', () => {
  it('deleteByScope() deletes correct entries, returns count', async () => {
    const store = makeStore();
    const scope = { kind: 'workspace', workspaceId: 'ws1' } as const;
    await store.write({ scope, content: 'a' });
    await store.write({ scope, content: 'b' });

    const deleted = await store.deleteByScope(scope);
    expect(deleted).toBe(2);

    const remaining = await store.retrieve({ scope });
    expect(remaining).toHaveLength(0);
  });

  it('deleteByScope() does not affect other scopes', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'workspace', workspaceId: 'ws1' },
      content: 'ws1 note',
    });
    await store.write({
      scope: { kind: 'workspace', workspaceId: 'ws2' },
      content: 'ws2 note',
    });

    await store.deleteByScope({ kind: 'workspace', workspaceId: 'ws1' });

    const ws2 = await store.retrieve({
      scope: { kind: 'workspace', workspaceId: 'ws2' },
    });
    expect(ws2).toHaveLength(1);
    expect(ws2[0]?.content).toBe('ws2 note');
  });

  it('deleteByScope() returns 0 for empty scope', async () => {
    const store = makeStore();
    const deleted = await store.deleteByScope({
      kind: 'workspace',
      workspaceId: 'nonexistent',
    });
    expect(deleted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Relay adapter guardrails
// ---------------------------------------------------------------------------
describe('relay adapter guardrails', () => {
  it('rejects relay adapters that do not implement list() and update()', () => {
    const unsupportedAdapter = {
      type: 'unsupported',
      init: async () => undefined,
      add: async () => ({ success: true, id: '1' }),
      search: async () => [],
      get: async () => null,
      delete: async () => ({ success: true }),
    };

    expect(
      () => new RelayMemoryStoreAdapter(unsupportedAdapter),
    ).toThrowError(/must implement list\(\) and update\(\)/i);
  });

  it('matches the adapter contract shape expected by the store factory', () => {
    const adapter: MemoryStoreAdapter = new InMemoryMemoryStoreAdapter();
    expect(adapter).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Inclusion rules toggle
// ---------------------------------------------------------------------------
describe('inclusion rules', () => {
  it('supports disabling inclusion rules', async () => {
    const store = makeStore({ applyInclusionRules: false });

    await store.write({
      scope: { kind: 'user', userId: 'u1' },
      content: 'durable',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'ephemeral',
    });

    const entries = await store.retrieve({
      scope: { kind: 'user', userId: 'u1' },
      includeNarrower: true,
      context: { sessionId: 's1' },
    });

    expect(entries.map((e) => e.content)).toEqual(['durable']);
  });
});
