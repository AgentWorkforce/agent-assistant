import { describe, expect, it } from 'vitest';

import {
  createMemoryStore,
  InMemoryMemoryStoreAdapter,
} from './memory.js';
import {
  createRelayBackedMemoryStore,
  promoteLatestSessionMemory,
  retrieveTurnMemoryContext,
} from './turn-memory.js';
import type { MemoryStore } from './types.js';

function makeStore(): MemoryStore {
  return createMemoryStore({ adapter: new InMemoryMemoryStoreAdapter() });
}

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
    expect(context.byScope.workspace?.map((entry) => entry.content)).toEqual(['workspace convention']);
  });

  it('honors tags, per-scope limits, and global limits', async () => {
    const store = makeStore();

    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'session keep',
      tags: ['turn'],
    });
    await store.write({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'session skip',
      tags: ['other'],
    });
    await store.write({
      scope: { kind: 'user', userId: 'u1' },
      content: 'user keep',
      tags: ['turn'],
    });
    await store.write({
      scope: { kind: 'workspace', workspaceId: 'w1' },
      content: 'workspace keep',
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
});
