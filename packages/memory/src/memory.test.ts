import { describe, expect, it } from 'vitest';

import {
  createMemoryStore,
  InMemoryMemoryStoreAdapter,
  RelayMemoryStoreAdapter,
} from './memory.js';
import {
  CompactionError,
  InvalidScopePromotionError,
} from './types.js';
import type { MemoryStoreAdapter } from './types.js';

function futureIso(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function pastIso(hours = 24): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

describe('memory package v1 workflows', () => {
  it('writes and reads session memories', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });

    const entry = await store.write({
      scope: { kind: 'session', sessionId: 'sess-1' },
      content: 'User prefers terse replies.',
      tags: ['preference'],
      metadata: { source: 'intake' },
    });

    expect(entry.id).toBeTruthy();
    expect(entry.scope).toEqual({ kind: 'session', sessionId: 'sess-1' });

    const loaded = await store.get(entry.id);
    expect(loaded?.content).toBe('User prefers terse replies.');
    expect(loaded?.metadata.source).toBe('intake');
  });

  it('round-trips all supported scope kinds', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
    const scopes = [
      { kind: 'user', userId: 'user-1' } as const,
      { kind: 'workspace', workspaceId: 'ws-1' } as const,
      { kind: 'org', orgId: 'org-1' } as const,
      { kind: 'object', objectId: 'ticket-1', objectType: 'ticket' } as const,
    ];

    const ids: string[] = [];
    for (const scope of scopes) {
      const entry = await store.write({
        scope,
        content: `entry:${scope.kind}`,
      });
      ids.push(entry.id);
    }

    const loaded = await Promise.all(ids.map((id) => store.get(id)));
    expect(loaded.map((entry) => entry?.scope)).toEqual(scopes);
  });

  it('filters retrieval by tags, since, order, and limit', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
    const scope = { kind: 'workspace', workspaceId: 'ws-1' } as const;

    await store.write({
      scope,
      content: 'older preference',
      tags: ['preference'],
    });
    await store.write({
      scope,
      content: 'recent preference',
      tags: ['preference', 'formatting'],
    });
    await store.write({
      scope,
      content: 'recent fact',
      tags: ['fact'],
    });

    const recentOnly = await store.retrieve({
      scope,
      tags: ['preference'],
      since: pastIso(1),
      order: 'oldest',
      limit: 1,
    });

    expect(recentOnly).toHaveLength(1);
    expect(recentOnly[0]?.tags).toContain('preference');
  });

  it('excludes expired entries from get and retrieve', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
    const scope = { kind: 'session', sessionId: 'sess-1' } as const;

    const expired = await store.write({
      scope,
      content: 'stale',
      expiresAt: pastIso(1),
    });

    await store.write({
      scope,
      content: 'fresh',
      expiresAt: futureIso(1),
    });

    expect(await store.get(expired.id)).toBeNull();

    const entries = await store.retrieve({ scope });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.content).toBe('fresh');
  });

  it('includes narrower session scope for user queries only with explicit session context', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });

    await store.write({
      scope: { kind: 'user', userId: 'user-1' },
      content: 'durable preference',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 'sess-1' },
      content: 'ephemeral detail',
    });

    const withoutContext = await store.retrieve({
      scope: { kind: 'user', userId: 'user-1' },
      includeNarrower: true,
    });
    expect(withoutContext.map((entry) => entry.content)).toEqual(['durable preference']);

    const withContext = await store.retrieve({
      scope: { kind: 'user', userId: 'user-1' },
      includeNarrower: true,
      context: { sessionId: 'sess-1' },
    });
    expect(withContext.map((entry) => entry.content).sort()).toEqual([
      'durable preference',
      'ephemeral detail',
    ]);
  });

  it('promotes session memories to user scope and preserves provenance', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
    const source = await store.write({
      scope: { kind: 'session', sessionId: 'sess-1' },
      content: 'User likes markdown tables.',
      metadata: { agentId: 'assistant-1', source: 'conversation' },
    });

    const promoted = await store.promote({
      sourceEntryId: source.id,
      targetScope: { kind: 'user', userId: 'user-1' },
      deleteOriginal: true,
    });

    expect(promoted.scope).toEqual({ kind: 'user', userId: 'user-1' });
    expect(promoted.promotedFromId).toBe(source.id);
    expect(promoted.metadata.agentId).toBe('assistant-1');
    expect(promoted.metadata.createdInSessionId).toBe('sess-1');
    expect(await store.get(source.id)).toBeNull();
  });

  it('rejects downward promotions', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
    const source = await store.write({
      scope: { kind: 'org', orgId: 'org-1' },
      content: 'global note',
    });

    await expect(
      store.promote({
        sourceEntryId: source.id,
        targetScope: { kind: 'user', userId: 'user-1' },
      }),
    ).rejects.toBeInstanceOf(InvalidScopePromotionError);
  });

  it('compacts same-scope memories and can delete the sources', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
    const scope = { kind: 'user', userId: 'user-1' } as const;
    const first = await store.write({
      scope,
      content: 'Prefers keyboard shortcuts.',
      tags: ['preference'],
      metadata: { source: 'turn-1' },
    });
    const second = await store.write({
      scope,
      content: 'Uses Vim motions.',
      tags: ['preference', 'editor'],
    });

    const compacted = await store.compact({
      sourceEntryIds: [first.id, second.id],
      targetScope: scope,
      deleteSourceEntries: true,
      tags: ['summary'],
      metadata: { source: 'compactor' },
      compactionCallback: (entries) => entries.map((entry) => entry.content).join(' '),
    });

    expect(compacted.compactedFromIds).toEqual([first.id, second.id]);
    expect(compacted.tags).toEqual(['summary']);
    expect(compacted.metadata.source).toBe('compactor');
    expect(await store.get(first.id)).toBeNull();
    expect(await store.get(second.id)).toBeNull();
  });

  it('wraps compaction callback failures', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
    const scope = { kind: 'user', userId: 'user-1' } as const;
    const entry = await store.write({
      scope,
      content: 'Something to summarize.',
    });

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

  it('rejects cross-scope compaction', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
    const sessionEntry = await store.write({
      scope: { kind: 'session', sessionId: 'sess-1' },
      content: 'session detail',
    });
    const userEntry = await store.write({
      scope: { kind: 'user', userId: 'user-1' },
      content: 'user detail',
    });

    await expect(
      store.compact({
        sourceEntryIds: [sessionEntry.id, userEntry.id],
        targetScope: { kind: 'user', userId: 'user-1' },
        compactionCallback: () => 'summary',
      }),
    ).rejects.toBeInstanceOf(CompactionError);
  });

  it('updates content, metadata, and clears expiry', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
    const entry = await store.write({
      scope: { kind: 'object', objectId: 'doc-1', objectType: 'document' },
      content: 'Initial note',
      expiresAt: futureIso(1),
      metadata: { source: 'import' },
    });

    const updated = await store.update(entry.id, {
      content: 'Updated note',
      tags: ['context'],
      expiresAt: null,
      metadata: { confidence: 0.8 },
    });

    expect(updated.content).toBe('Updated note');
    expect(updated.tags).toEqual(['context']);
    expect(updated.expiresAt).toBeUndefined();
    expect(updated.metadata.source).toBe('import');
    expect(updated.metadata.confidence).toBe(0.8);
  });

  it('deletes all entries in a specific scope', async () => {
    const store = createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });

    await store.write({
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
      content: 'workspace note 1',
    });
    await store.write({
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
      content: 'workspace note 2',
    });
    await store.write({
      scope: { kind: 'workspace', workspaceId: 'ws-2' },
      content: 'other workspace',
    });

    const deleted = await store.deleteByScope({ kind: 'workspace', workspaceId: 'ws-1' });
    expect(deleted).toBe(2);

    const remaining = await store.retrieve({
      scope: { kind: 'workspace', workspaceId: 'ws-2' },
    });
    expect(remaining).toHaveLength(1);
  });

  it('supports disabling inclusion rules', async () => {
    const store = createMemoryStore({
      adapter: new InMemoryMemoryStoreAdapter(),
      applyInclusionRules: false,
    });

    await store.write({
      scope: { kind: 'user', userId: 'user-1' },
      content: 'durable preference',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 'sess-1' },
      content: 'ephemeral detail',
    });

    const entries = await store.retrieve({
      scope: { kind: 'user', userId: 'user-1' },
      includeNarrower: true,
      context: { sessionId: 'sess-1' },
    });

    expect(entries.map((entry) => entry.content)).toEqual(['durable preference']);
  });
});

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
