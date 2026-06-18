import { describe, expect, it } from 'vitest';
import type { ContinuationRecord } from '@agent-assistant/continuation';
import { GcpFirestoreContinuationStore } from './gcp-firestore-continuation-store.js';
import type {
  FirestoreCollectionLike,
  FirestoreDocRef,
  FirestoreDocSnapshot,
  FirestoreQuery,
  FirestoreQuerySnapshot,
} from './gcp-firestore-session-store-adapter.js';

function makeCollection<T extends Record<string, unknown>>(): FirestoreCollectionLike<T> {
  const docs = new Map<string, T>();

  function snap(id: string): FirestoreDocSnapshot<T> {
    const data = docs.get(id);
    return { exists: data !== undefined, id, data: () => data };
  }

  function snapMany(items: T[]): FirestoreQuerySnapshot<T> {
    return { docs: items.map((d) => ({ exists: true, id: '', data: () => d })) };
  }

  function buildQuery(filters: Array<(d: T) => boolean>): FirestoreQuery<T> {
    let cap: number | undefined;
    const q: FirestoreQuery<T> = {
      where(field, _op, value) {
        return buildQuery([
          ...filters,
          (d) => {
            const keys = field.split('.');
            let v: unknown = d;
            for (const k of keys) v = (v as Record<string, unknown>)[k];
            return v === value;
          },
        ]);
      },
      limit(n) { cap = n; return q; },
      async get() {
        let r = [...docs.values()].filter((d) => filters.every((f) => f(d)));
        if (cap !== undefined) r = r.slice(0, cap);
        return snapMany(r);
      },
    };
    return q;
  }

  const col: FirestoreCollectionLike<T> = {
    doc(id: string): FirestoreDocRef<T> {
      return {
        get: async () => snap(id),
        set: async (data) => { docs.set(id, data); },
        update: async (patch) => { docs.set(id, { ...docs.get(id)!, ...patch } as T); },
        delete: async () => { docs.delete(id); },
        create: async (data) => { docs.set(id, data); },
      };
    },
    where(field, _op, value) {
      return buildQuery([(d) => {
        const keys = field.split('.');
        let v: unknown = d;
        for (const k of keys) v = (v as Record<string, unknown>)[k];
        return v === value;
      }]);
    },
    limit(n) { return buildQuery([]).limit(n); },
    async get() { return snapMany([...docs.values()]); },
  };

  return col;
}

function record(overrides: Partial<ContinuationRecord> = {}): ContinuationRecord {
  return {
    id: 'cont-1',
    assistantId: 'asst-1',
    sessionId: 'sess-1',
    origin: { turnId: 't1', outcome: 'awaiting_approval', stopReason: 'needs_approval', createdAt: '2026-01-01T00:00:00Z' },
    status: 'pending',
    waitFor: { type: 'approval_resolution', approvalId: 'appr-1' },
    continuation: {} as never,
    delivery: { status: 'pending_delivery' },
    bounds: { expiresAt: '2026-12-31T00:00:00Z', maxResumeAttempts: 3, resumeAttempts: 0 },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('GcpFirestoreContinuationStore', () => {
  it('puts and gets a record', async () => {
    const store = new GcpFirestoreContinuationStore({ collection: makeCollection() });
    await store.put(record());
    expect(await store.get('cont-1')).toMatchObject({ id: 'cont-1' });
  });

  it('returns null for missing record', async () => {
    const store = new GcpFirestoreContinuationStore({ collection: makeCollection() });
    expect(await store.get('nope')).toBeNull();
  });

  it('deletes a record', async () => {
    const store = new GcpFirestoreContinuationStore({ collection: makeCollection() });
    await store.put(record());
    await store.delete('cont-1');
    expect(await store.get('cont-1')).toBeNull();
  });

  it('listBySession returns records for the session', async () => {
    const store = new GcpFirestoreContinuationStore({ collection: makeCollection() });
    await store.put(record({ id: 'a', sessionId: 'sess-1' }));
    await store.put(record({ id: 'b', sessionId: 'sess-2' }));
    const results = await store.listBySession('sess-1');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('a');
  });

  it('findByTrigger resolves approval_resolution trigger', async () => {
    const store = new GcpFirestoreContinuationStore({ collection: makeCollection() });
    await store.put(record({ id: 'cont-appr', waitFor: { type: 'approval_resolution', approvalId: 'appr-xyz' } }));
    const found = await store.findByTrigger({ type: 'approval_resolution', approvalId: 'appr-xyz', decision: 'approved', resolvedAt: '' });
    expect(found?.id).toBe('cont-appr');
  });

  it('findByTrigger returns null for user_reply (no symmetric field)', async () => {
    const store = new GcpFirestoreContinuationStore({ collection: makeCollection() });
    const result = await store.findByTrigger({ type: 'user_reply', message: {} as never, receivedAt: '' });
    expect(result).toBeNull();
  });

  it('overwrites an existing record on put', async () => {
    const store = new GcpFirestoreContinuationStore({ collection: makeCollection() });
    await store.put(record({ status: 'pending' }));
    await store.put(record({ status: 'resuming' }));
    expect((await store.get('cont-1'))?.status).toBe('resuming');
  });
});
