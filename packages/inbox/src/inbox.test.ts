import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInboxStore } from './inbox.js';
import {
  InboxInvalidStatusTransitionError,
  InboxItemNotFoundError,
  InboxRelayNativeSourceError,
} from './types.js';
import type {
  InboxAdapterQuery,
  InboxItem,
  InboxItemKind,
  InboxStore,
  InboxStoreAdapter,
  InboxStoreConfig,
} from './types.js';

const FIXED_NOW = new Date('2026-04-15T10:00:00.000Z');

class InMemoryInboxStoreAdapter implements InboxStoreAdapter {
  private readonly items = new Map<string, InboxItem>();

  async insert(item: InboxItem): Promise<InboxItem> {
    const stored = structuredClone(item);
    this.items.set(stored.id, stored);
    return structuredClone(stored);
  }

  async fetchById(itemId: string): Promise<InboxItem | null> {
    const item = this.items.get(itemId);
    return item ? structuredClone(item) : null;
  }

  async fetchMany(query: InboxAdapterQuery): Promise<InboxItem[]> {
    const rows = [...this.items.values()]
      .filter((item) => item.assistantId === query.assistantId)
      .filter((item) => !query.statuses || query.statuses.includes(item.status))
      .filter((item) => !query.kinds || query.kinds.includes(item.kind))
      .filter((item) => !query.since || Date.parse(item.receivedAt) >= Date.parse(query.since))
      .filter(
        (item) => !item.expiresAt || Date.parse(item.expiresAt) >= Date.parse(query.excludeExpiredBefore),
      )
      .sort((left, right) => {
        const factor = query.order === 'newest' ? -1 : 1;
        const createdDelta = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
        if (createdDelta !== 0) {
          return createdDelta * factor;
        }

        return left.id.localeCompare(right.id) * factor;
      })
      .slice(0, query.limit)
      .map((item) => structuredClone(item));

    return rows;
  }

  async update(itemId: string, patch: Partial<InboxItem>): Promise<InboxItem> {
    const current = this.items.get(itemId);
    if (!current) {
      throw new InboxItemNotFoundError(itemId);
    }

    const next = { ...current, ...structuredClone(patch) };
    this.items.set(itemId, next);
    return structuredClone(next);
  }
}

function makeStore(overrides?: Partial<InboxStoreConfig>): InboxStore {
  return createInboxStore({
    adapter: new InMemoryInboxStoreAdapter(),
    ...overrides,
  });
}

function makeWriteInput(kind: InboxItemKind = 'imported_chat') {
  return {
    assistantId: 'assistant-1',
    kind,
    source: {
      sourceId: 'notion-export',
      trustLevel: 'trusted' as const,
    },
    content: `${kind} content`,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  let nextId = 0;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `uuid-${++nextId}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createInboxStore', () => {
  it('write() creates an item with generated id, pending status, and timestamps', async () => {
    const store = makeStore();

    const item = await store.write({
      ...makeWriteInput(),
      title: 'Imported thread',
      tags: ['alpha', 'alpha', 'beta'],
      metadata: { review: true },
    });

    expect(item.id).toBe('uuid-1');
    expect(item.status).toBe('pending');
    expect(item.receivedAt).toBe(FIXED_NOW.toISOString());
    expect(item.updatedAt).toBe(FIXED_NOW.toISOString());
    expect(item.tags).toEqual(['alpha', 'beta']);
    expect(item.metadata).toEqual({ review: true });
  });

  it('write() rejects a relay-native source that matches the assistant identity', async () => {
    const store = makeStore();

    await expect(
      store.write({
        ...makeWriteInput(),
        source: {
          sourceId: 'assistant-1',
          trustLevel: 'verified',
        },
      }),
    ).rejects.toBeInstanceOf(InboxRelayNativeSourceError);
  });

  it('get() returns the written item by id', async () => {
    const store = makeStore();
    const item = await store.write(makeWriteInput());

    await expect(store.get(item.id)).resolves.toEqual(item);
  });

  it('get() returns null for unknown id', async () => {
    const store = makeStore();

    await expect(store.get('missing')).resolves.toBeNull();
  });

  it('list() returns items filtered by assistantId', async () => {
    const store = makeStore();
    await store.write(makeWriteInput('imported_chat'));
    await store.write(makeWriteInput('trusted_memo'));
    await store.write({
      ...makeWriteInput('other'),
      assistantId: 'assistant-2',
    });

    const items = await store.list({ assistantId: 'assistant-1', order: 'oldest' });

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.assistantId === 'assistant-1')).toBe(true);
  });

  it('list() filters by status', async () => {
    const store = makeStore();
    const pending = await store.write(makeWriteInput('imported_chat'));
    const acknowledged = await store.write(makeWriteInput('trusted_memo'));
    await store.acknowledge(acknowledged.id);

    const items = await store.list({ assistantId: 'assistant-1', status: 'acknowledged' });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(acknowledged.id);
    expect(items[0]?.id).not.toBe(pending.id);
  });

  it('list() filters by kind', async () => {
    const store = makeStore();
    await store.write(makeWriteInput('imported_chat'));
    await store.write(makeWriteInput('trusted_memo'));

    const items = await store.list({ assistantId: 'assistant-1', kind: 'trusted_memo' });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('trusted_memo');
  });

  it('list() excludes expired items', async () => {
    const store = makeStore();
    await store.write({
      ...makeWriteInput(),
      expiresAt: '2026-04-15T09:59:59.000Z',
    });
    await store.write({
      ...makeWriteInput('trusted_memo'),
      expiresAt: '2026-04-15T10:30:00.000Z',
    });

    const items = await store.list({ assistantId: 'assistant-1' });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('trusted_memo');
  });

  it('list() respects limit and order', async () => {
    const store = makeStore();
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('id-1')
      .mockReturnValueOnce('id-2')
      .mockReturnValueOnce('id-3');

    await store.write(makeWriteInput('imported_chat'));
    vi.setSystemTime(new Date('2026-04-15T10:00:10.000Z'));
    await store.write(makeWriteInput('trusted_memo'));
    vi.setSystemTime(new Date('2026-04-15T10:00:20.000Z'));
    await store.write(makeWriteInput('other'));

    const items = await store.list({ assistantId: 'assistant-1', limit: 2, order: 'newest' });

    expect(items.map((item) => item.id)).toEqual(['id-3', 'id-2']);
  });

  it('acknowledge() transitions pending to acknowledged', async () => {
    const store = makeStore();
    const item = await store.write(makeWriteInput());
    vi.setSystemTime(new Date('2026-04-15T10:05:00.000Z'));

    const acknowledged = await store.acknowledge(item.id);

    expect(acknowledged.status).toBe('acknowledged');
    expect(acknowledged.updatedAt).toBe('2026-04-15T10:05:00.000Z');
  });

  it('acknowledge() rejects non-pending items', async () => {
    const store = makeStore();
    const item = await store.write(makeWriteInput());
    await store.acknowledge(item.id);

    await expect(store.acknowledge(item.id)).rejects.toBeInstanceOf(InboxInvalidStatusTransitionError);
  });

  it('dismiss() transitions pending to dismissed', async () => {
    const store = makeStore();
    const item = await store.write(makeWriteInput());

    const dismissed = await store.dismiss(item.id);

    expect(dismissed.status).toBe('dismissed');
  });

  it('dismiss() transitions acknowledged to dismissed', async () => {
    const store = makeStore();
    const item = await store.write(makeWriteInput());
    await store.acknowledge(item.id);

    const dismissed = await store.dismiss(item.id);

    expect(dismissed.status).toBe('dismissed');
  });

  it('dismiss() rejects already dismissed items', async () => {
    const store = makeStore();
    const item = await store.write(makeWriteInput());
    await store.dismiss(item.id);

    await expect(store.dismiss(item.id)).rejects.toBeInstanceOf(InboxInvalidStatusTransitionError);
  });

  it('updateStatus() rejects invalid transitions', async () => {
    const store = makeStore();
    const item = await store.write(makeWriteInput());
    await store.dismiss(item.id);

    await expect(store.updateStatus(item.id, 'pending')).rejects.toBeInstanceOf(
      InboxInvalidStatusTransitionError,
    );
  });
});
