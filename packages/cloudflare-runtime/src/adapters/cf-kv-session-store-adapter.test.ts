import { describe, expect, it } from 'vitest';
import type { Session } from '@agent-assistant/sessions';
import { CfKvSessionStoreAdapter } from './cf-kv-session-store-adapter.js';

function makeKv(): { store: Map<string, string>; ns: Parameters<typeof CfKvSessionStoreAdapter>[0]['kv'] } {
  const store = new Map<string, string>();
  const ns = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
  } as unknown as Parameters<typeof CfKvSessionStoreAdapter>[0]['kv'];
  return { store, ns };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    userId: 'user-1',
    state: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    lastActivityAt: '2026-01-01T00:00:00Z',
    attachedSurfaces: [],
    metadata: {},
    ...overrides,
  };
}

describe('CfKvSessionStoreAdapter', () => {
  it('inserts and fetches a session', async () => {
    const { ns } = makeKv();
    const adapter = new CfKvSessionStoreAdapter({ kv: ns });
    await adapter.insert(session());
    const fetched = await adapter.fetchById('sess-1');
    expect(fetched?.id).toBe('sess-1');
  });

  it('throws SessionConflictError on duplicate insert', async () => {
    const { ns } = makeKv();
    const adapter = new CfKvSessionStoreAdapter({ kv: ns });
    await adapter.insert(session());
    await expect(adapter.insert(session())).rejects.toMatchObject({ name: 'SessionConflictError' });
  });

  it('returns null for missing session', async () => {
    const { ns } = makeKv();
    const adapter = new CfKvSessionStoreAdapter({ kv: ns });
    expect(await adapter.fetchById('nope')).toBeNull();
  });

  it('updates a session', async () => {
    const { ns } = makeKv();
    const adapter = new CfKvSessionStoreAdapter({ kv: ns });
    await adapter.insert(session());
    const updated = await adapter.update('sess-1', { state: 'suspended' });
    expect(updated.state).toBe('suspended');
    expect((await adapter.fetchById('sess-1'))?.state).toBe('suspended');
  });

  it('throws SessionNotFoundError when updating missing session', async () => {
    const { ns } = makeKv();
    const adapter = new CfKvSessionStoreAdapter({ kv: ns });
    await expect(adapter.update('nope', { state: 'expired' })).rejects.toMatchObject({
      name: 'SessionNotFoundError',
    });
  });

  it('deletes a session', async () => {
    const { ns } = makeKv();
    const adapter = new CfKvSessionStoreAdapter({ kv: ns });
    await adapter.insert(session());
    await adapter.delete('sess-1');
    expect(await adapter.fetchById('sess-1')).toBeNull();
  });

  it('fetches many by userId', async () => {
    const { ns } = makeKv();
    const adapter = new CfKvSessionStoreAdapter({ kv: ns });
    await adapter.insert(session({ id: 'a', userId: 'u1' }));
    await adapter.insert(session({ id: 'b', userId: 'u2' }));
    const results = await adapter.fetchMany({ userId: 'u1' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
  });

  it('filters fetchMany by state', async () => {
    const { ns } = makeKv();
    const adapter = new CfKvSessionStoreAdapter({ kv: ns });
    await adapter.insert(session({ id: 'a', userId: 'u1', state: 'active' }));
    await adapter.insert(session({ id: 'b', userId: 'u1', state: 'suspended' }));
    const results = await adapter.fetchMany({ userId: 'u1', state: 'active' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
  });

  it('applies limit to fetchMany', async () => {
    const { ns } = makeKv();
    const adapter = new CfKvSessionStoreAdapter({ kv: ns });
    await adapter.insert(session({ id: 'a', userId: 'u1' }));
    await adapter.insert(session({ id: 'b', userId: 'u1' }));
    const results = await adapter.fetchMany({ userId: 'u1', limit: 1 });
    expect(results).toHaveLength(1);
  });

  it('respects key prefix to isolate namespaces', async () => {
    const { ns } = makeKv();
    const a = new CfKvSessionStoreAdapter({ kv: ns, prefix: 'tenant-a:' });
    const b = new CfKvSessionStoreAdapter({ kv: ns, prefix: 'tenant-b:' });
    await a.insert(session({ id: 'shared-id', userId: 'u' }));
    expect(await b.fetchById('shared-id')).toBeNull();
    expect(await a.fetchById('shared-id')).not.toBeNull();
  });
});
