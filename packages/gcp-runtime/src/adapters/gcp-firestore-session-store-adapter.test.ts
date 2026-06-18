import { describe, expect, it } from 'vitest';
import type { Session } from '@agent-assistant/sessions';
import {
  GcpFirestoreSessionStoreAdapter,
  type FirestoreCollectionLike,
  type FirestoreDocRef,
  type FirestoreDocSnapshot,
  type FirestoreQuery,
  type FirestoreQuerySnapshot,
} from './gcp-firestore-session-store-adapter.js';

function makeCollection(): FirestoreCollectionLike<Session> {
  const docs = new Map<string, Session>();

  function snap(id: string): FirestoreDocSnapshot<Session> {
    const data = docs.get(id);
    return { exists: data !== undefined, id, data: () => data };
  }

  function querySnap(items: Session[]): FirestoreQuerySnapshot<Session> {
    return { docs: items.map((s) => snap(s.id)) };
  }

  function buildQuery(filters: Array<(s: Session) => boolean>): FirestoreQuery<Session> {
    let limited: number | undefined;
    const q: FirestoreQuery<Session> = {
      where(field, _op, value) {
        return buildQuery([
          ...filters,
          (s) => {
            const keys = field.split('.');
            let val: unknown = s;
            for (const k of keys) val = (val as Record<string, unknown>)[k];
            return val === value;
          },
        ]);
      },
      limit(n) {
        limited = n;
        return q;
      },
      async get() {
        let result = [...docs.values()].filter((s) => filters.every((f) => f(s)));
        if (limited !== undefined) result = result.slice(0, limited);
        return querySnap(result);
      },
    };
    return q;
  }

  const col: FirestoreCollectionLike<Session> = {
    doc(id: string): FirestoreDocRef<Session> {
      return {
        get: async () => snap(id),
        set: async (data) => { docs.set(id, data); },
        update: async (patch) => { docs.set(id, { ...docs.get(id)!, ...patch }); },
        delete: async () => { docs.delete(id); },
        create: async (data) => {
          if (docs.has(id)) {
            const err = Object.assign(new Error('already exists'), { code: 6 });
            throw err;
          }
          docs.set(id, data);
        },
      };
    },
    where(field, op, value) { return buildQuery([(s) => {
      const keys = field.split('.');
      let val: unknown = s;
      for (const k of keys) val = (val as Record<string, unknown>)[k];
      return val === value;
    }]); },
    limit(n) { return buildQuery([]).limit(n); },
    async get() { return querySnap([...docs.values()]); },
  };

  return col;
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

describe('GcpFirestoreSessionStoreAdapter', () => {
  it('inserts and fetches a session', async () => {
    const adapter = new GcpFirestoreSessionStoreAdapter({ collection: makeCollection() });
    await adapter.insert(session());
    expect(await adapter.fetchById('sess-1')).toMatchObject({ id: 'sess-1' });
  });

  it('throws SessionConflictError on duplicate insert', async () => {
    const adapter = new GcpFirestoreSessionStoreAdapter({ collection: makeCollection() });
    await adapter.insert(session());
    await expect(adapter.insert(session())).rejects.toMatchObject({ name: 'SessionConflictError' });
  });

  it('returns null for missing session', async () => {
    const adapter = new GcpFirestoreSessionStoreAdapter({ collection: makeCollection() });
    expect(await adapter.fetchById('nope')).toBeNull();
  });

  it('updates a session', async () => {
    const adapter = new GcpFirestoreSessionStoreAdapter({ collection: makeCollection() });
    await adapter.insert(session());
    const updated = await adapter.update('sess-1', { state: 'suspended' });
    expect(updated.state).toBe('suspended');
    expect((await adapter.fetchById('sess-1'))?.state).toBe('suspended');
  });

  it('throws SessionNotFoundError when updating missing session', async () => {
    const adapter = new GcpFirestoreSessionStoreAdapter({ collection: makeCollection() });
    await expect(adapter.update('nope', { state: 'expired' })).rejects.toMatchObject({
      name: 'SessionNotFoundError',
    });
  });

  it('deletes a session', async () => {
    const adapter = new GcpFirestoreSessionStoreAdapter({ collection: makeCollection() });
    await adapter.insert(session());
    await adapter.delete('sess-1');
    expect(await adapter.fetchById('sess-1')).toBeNull();
  });

  it('fetchMany filters by userId', async () => {
    const adapter = new GcpFirestoreSessionStoreAdapter({ collection: makeCollection() });
    await adapter.insert(session({ id: 'a', userId: 'u1' }));
    await adapter.insert(session({ id: 'b', userId: 'u2' }));
    const results = await adapter.fetchMany({ userId: 'u1' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('a');
  });

  it('fetchMany filters by state', async () => {
    const adapter = new GcpFirestoreSessionStoreAdapter({ collection: makeCollection() });
    await adapter.insert(session({ id: 'a', userId: 'u1', state: 'active' }));
    await adapter.insert(session({ id: 'b', userId: 'u1', state: 'suspended' }));
    const results = await adapter.fetchMany({ userId: 'u1', state: 'active' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('a');
  });

  it('fetchMany applies limit', async () => {
    const adapter = new GcpFirestoreSessionStoreAdapter({ collection: makeCollection() });
    await adapter.insert(session({ id: 'a', userId: 'u1' }));
    await adapter.insert(session({ id: 'b', userId: 'u1' }));
    const results = await adapter.fetchMany({ userId: 'u1', limit: 1 });
    expect(results).toHaveLength(1);
  });
});
