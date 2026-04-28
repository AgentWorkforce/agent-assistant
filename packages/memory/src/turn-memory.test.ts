import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMemoryStore,
  InMemoryMemoryStoreAdapter,
} from './memory.js';
import {
  createRelayBackedMemoryStore,
  promoteLatestSessionMemory,
  renderTurnMemoryContext,
  retrieveTurnMemoryContext,
  SESSION_LOAD_LIMIT,
  USER_LOAD_LIMIT,
  WORKSPACE_LOAD_LIMIT,
} from './turn-memory.js';
import type { MemoryEntry, MemoryQuery, MemoryStore } from './types.js';

function makeStore(): MemoryStore {
  return createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
}

function fixedEntry(
  scope: MemoryEntry['scope'],
  overrides: Partial<MemoryEntry> = {},
): MemoryEntry {
  return {
    id: overrides.id ?? 'entry-1',
    scope,
    content: overrides.content ?? 'memory',
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? '2026-04-27T12:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-27T12:00:00.000Z',
    metadata: overrides.metadata ?? {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('turn memory helpers', () => {
  it('creates a relay-backed memory store with a close handle', async () => {
    const handle = await createRelayBackedMemoryStore({ config: { type: 'inmemory' } });

    const entry = await handle.store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'hello',
    });

    expect(entry.id).toBeTruthy();
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('retrieves turn memory in session, user, then workspace order by default', async () => {
    const store = makeStore();

    await store.write({
      scope: { kind: 'workspace', workspaceId: 'w1' },
      content: 'workspace convention',
    });
    await store.write({
      scope: { kind: 'user', userId: 'u1' },
      content: 'user preference',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'current thread',
    });

    const context = await retrieveTurnMemoryContext({
      store,
      sessionId: 's1',
      userId: 'u1',
      workspaceId: 'w1',
    });

    expect(context.entries.map((entry) => entry.content)).toEqual([
      'current thread',
      'user preference',
      'workspace convention',
    ]);
    expect(context.byScope.session?.map((entry) => entry.content)).toEqual(['current thread']);
    expect(context.byScope.user?.map((entry) => entry.content)).toEqual(['user preference']);
    expect(context.byScope.workspace?.map((entry) => entry.content)).toEqual([
      'workspace convention',
    ]);
  });

  it('honors tags, per-scope limits, and global limits', async () => {
    const store = makeStore();
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date('2026-04-27T12:00:00.000Z'));
      await store.write({
        scope: { kind: 'session', sessionId: 's1' },
        content: 'session skip',
        tags: ['other'],
      });
      vi.setSystemTime(new Date('2026-04-27T12:00:02.000Z'));
      await store.write({
        scope: { kind: 'user', userId: 'u1' },
        content: 'user keep',
        tags: ['turn'],
      });
      vi.setSystemTime(new Date('2026-04-27T12:00:03.000Z'));
      await store.write({
        scope: { kind: 'workspace', workspaceId: 'w1' },
        content: 'workspace keep',
        tags: ['turn'],
      });
      vi.setSystemTime(new Date('2026-04-27T12:00:04.000Z'));
      await store.write({
        scope: { kind: 'session', sessionId: 's1' },
        content: 'session keep',
        tags: ['turn'],
      });

      const context = await retrieveTurnMemoryContext({
        store,
        sessionId: 's1',
        userId: 'u1',
        workspaceId: 'w1',
        tags: ['turn'],
        perScopeLimit: 1,
        limit: 2,
      });

      expect(context.entries.map((entry) => entry.content)).toEqual(['session keep', 'user keep']);
      expect(context.entries).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports per-scope limit overrides and query passthrough', async () => {
    const entry = fixedEntry({ kind: 'session', sessionId: 's1' });
    const retrieve = vi.fn(async (query: MemoryQuery) => [entry]);
    const store = stubStore(entry, retrieve);

    await retrieveTurnMemoryContext({
      store,
      sessionId: 's1',
      userId: 'u1',
      workspaceId: 'w1',
      query: 'project alpha',
      perScopeLimits: {
        session: 2,
        user: 3,
        workspace: 1,
      },
    });

    expect(retrieve).toHaveBeenCalledTimes(3);
    const queries = retrieve.mock.calls.map(([query]) => query);
    expect(queries.map((query) => query.limit)).toEqual([2, 3, 1]);
    expect(queries.map((query) => query.query)).toEqual([
      'project alpha',
      'project alpha',
      'project alpha',
    ]);
  });

  it('uses scope-specific default load limits', async () => {
    const entry = fixedEntry({ kind: 'session', sessionId: 's1' });
    const retrieve = vi.fn(async (query: MemoryQuery) => [entry]);
    const store = stubStore(entry, retrieve);

    await retrieveTurnMemoryContext({
      store,
      sessionId: 's1',
      userId: 'u1',
      workspaceId: 'w1',
    });

    const queries = retrieve.mock.calls.map(([query]) => query);
    expect(queries.map((query) => query.limit)).toEqual([
      SESSION_LOAD_LIMIT,
      USER_LOAD_LIMIT,
      WORKSPACE_LOAD_LIMIT,
    ]);
  });

  it('supports custom scope order', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'workspace', workspaceId: 'w1' },
      content: 'workspace first',
    });
    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'session second',
    });

    const context = await retrieveTurnMemoryContext({
      store,
      sessionId: 's1',
      workspaceId: 'w1',
      scopeOrder: ['workspace', 'session'],
    });

    expect(context.entries.map((entry) => entry.content)).toEqual([
      'workspace first',
      'session second',
    ]);
  });

  it('renders session, user, then workspace lines in the expected format', () => {
    const context = {
      entries: [
        fixedEntry(
          { kind: 'session', sessionId: 's1' },
          { id: 'session-1', content: 'current thread', createdAt: '2026-04-27T11:59:00.000Z' },
        ),
        fixedEntry(
          { kind: 'user', userId: 'u1' },
          { id: 'user-1', content: 'user preference', createdAt: '2026-04-27T10:00:00.000Z' },
        ),
        fixedEntry(
          { kind: 'workspace', workspaceId: 'w1' },
          { id: 'workspace-1', content: 'workspace convention', createdAt: '2026-04-20T12:00:00.000Z' },
        ),
      ],
      byScope: {
        session: [
          fixedEntry(
            { kind: 'session', sessionId: 's1' },
            { id: 'session-1', content: 'current thread', createdAt: '2026-04-27T11:59:00.000Z' },
          ),
        ],
        user: [
          fixedEntry(
            { kind: 'user', userId: 'u1' },
            { id: 'user-1', content: 'user preference', createdAt: '2026-04-27T10:00:00.000Z' },
          ),
        ],
        workspace: [
          fixedEntry(
            { kind: 'workspace', workspaceId: 'w1' },
            {
              id: 'workspace-1',
              content: 'workspace convention',
              createdAt: '2026-04-20T12:00:00.000Z',
            },
          ),
        ],
      },
    };

    expect(renderTurnMemoryContext(context, { now: new Date('2026-04-27T12:00:00.000Z') })).toBe(
      '[thread, 1 minute ago] current thread\n[user, 2 hours ago] user preference\n[workspace, 1 week ago] workspace convention',
    );
  });

  it('respects scope label overrides when rendering turn memory context', () => {
    const context = {
      entries: [
        fixedEntry(
          { kind: 'user', userId: 'u1' },
          { id: 'user-1', content: 'user preference', createdAt: '2026-04-27T10:00:00.000Z' },
        ),
      ],
      byScope: {
        user: [
          fixedEntry(
            { kind: 'user', userId: 'u1' },
            { id: 'user-1', content: 'user preference', createdAt: '2026-04-27T10:00:00.000Z' },
          ),
        ],
      },
    };

    expect(
      renderTurnMemoryContext(context, {
        now: new Date('2026-04-27T12:00:00.000Z'),
        scopeLabels: { user: 'profile' },
      }),
    ).toBe('[profile, 2 hours ago] user preference');
  });

  it('returns an empty string for empty turn memory context', () => {
    expect(renderTurnMemoryContext({ entries: [], byScope: {} })).toBe('');
  });

  it('promotes the latest session memory to user scope', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'older',
    });
    const latest = await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'latest',
      tags: ['promotable'],
    });

    const promoted = await promoteLatestSessionMemory({
      store,
      sessionId: 's1',
      userId: 'u1',
      tags: ['promotable'],
    });

    expect(promoted?.content).toBe('latest');
    expect(promoted?.promotedFromId).toBe(latest.id);
    expect(promoted?.scope).toEqual({ kind: 'user', userId: 'u1' });
    expect(promoted?.metadata.createdInSessionId).toBe('s1');
  });

  it('returns null when no session memory can be promoted', async () => {
    const store = makeStore();

    await expect(
      promoteLatestSessionMemory({
        store,
        sessionId: 'missing',
        userId: 'u1',
      }),
    ).resolves.toBeNull();
  });

  it('requires a target scope or userId for latest-session promotion', async () => {
    const store = makeStore();
    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'promote me',
    });

    await expect(
      promoteLatestSessionMemory({
        store,
        sessionId: 's1',
      }),
    ).rejects.toThrow(/targetScope or userId/);
  });

  it('emits memory operation logs for relay-backed store calls', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const handle = await createRelayBackedMemoryStore({ config: { type: 'inmemory' } });

    const stored = await handle.store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'hello',
    });
    await handle.store.retrieve({
      scope: { kind: 'session', sessionId: 's1' },
      limit: 1,
    });
    await handle.store.promote({
      sourceEntryId: stored.id,
      targetScope: { kind: 'user', userId: 'u1' },
    });
    await handle.close();

    const events = infoSpy.mock.calls.map(([payload]) => JSON.parse(String(payload)));

    expect(events.map((event) => event.op)).toEqual(['init', 'save', 'load', 'promote', 'close']);
    expect(events.every((event) => event.event === 'memory_op')).toBe(true);
    expect(events.every((event) => event.status === 'ok')).toBe(true);
  });
});

function stubStore(
  entry: MemoryEntry,
  retrieveImpl: (query: MemoryQuery) => Promise<MemoryEntry[]>,
): MemoryStore {
  return {
    async write() {
      return entry;
    },
    async retrieve(query) {
      return retrieveImpl(query);
    },
    async get() {
      return entry;
    },
    async update() {
      return entry;
    },
    async delete() {
      return undefined;
    },
    async deleteByScope() {
      return 0;
    },
    async promote() {
      return entry;
    },
    async compact() {
      return entry;
    },
  };
}
