import {
  InboxInvalidStatusTransitionError,
  InboxItemNotFoundError,
  InboxRelayNativeSourceError,
} from './types.js';
import type {
  InboxAdapterQuery,
  InboxItem,
  InboxItemStatus,
  InboxListQuery,
  InboxStore,
  InboxStoreConfig,
  InboxWriteInput,
} from './types.js';

const DEFAULT_LIST_LIMIT = 20;

const VALID_STATUS_TRANSITIONS: Readonly<Record<InboxItemStatus, readonly InboxItemStatus[]>> = {
  pending: ['acknowledged', 'projected', 'dismissed', 'expired'],
  acknowledged: ['projected', 'dismissed', 'expired'],
  projected: [],
  dismissed: [],
  expired: [],
};

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function createItemId(): string {
  return globalThis.crypto.randomUUID();
}

function normalizeLimit(limit?: number): number {
  if (!limit || limit < 1) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.floor(limit);
}

function toArray<T>(value?: T | T[]): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? [...value] : [value];
}

function assertNoRelayNativeSource(input: InboxWriteInput): void {
  if (input.source.sourceId === input.assistantId) {
    throw new InboxRelayNativeSourceError(input.assistantId, input.source.sourceId);
  }
}

async function requireItem(store: InboxStoreConfig['adapter'], itemId: string): Promise<InboxItem> {
  const item = await store.fetchById(itemId);
  if (!item) {
    throw new InboxItemNotFoundError(itemId);
  }

  return item;
}

function assertValidTransition(item: InboxItem, nextStatus: InboxItemStatus): void {
  if (!VALID_STATUS_TRANSITIONS[item.status].includes(nextStatus)) {
    throw new InboxInvalidStatusTransitionError(item.id, item.status, nextStatus);
  }
}

function buildAdapterQuery(query: InboxListQuery): InboxAdapterQuery {
  return {
    assistantId: query.assistantId,
    statuses: toArray(query.status),
    kinds: toArray(query.kind),
    since: query.since,
    excludeExpiredBefore: nowIso(),
    limit: normalizeLimit(query.limit),
    order: query.order ?? 'newest',
  };
}

export function createInboxStore(config: InboxStoreConfig): InboxStore {
  const { adapter } = config;

  return {
    async write(input) {
      assertNoRelayNativeSource(input);

      const timestamp = nowIso();
      const item: InboxItem = {
        id: createItemId(),
        assistantId: input.assistantId,
        kind: input.kind,
        status: 'pending',
        source: cloneValue(input.source),
        content: input.content,
        structured: input.structured ? cloneValue(input.structured) : undefined,
        title: input.title,
        tags: input.tags ? [...new Set(input.tags)] : undefined,
        scope: input.scope ? cloneValue(input.scope) : undefined,
        receivedAt: timestamp,
        expiresAt: input.expiresAt,
        updatedAt: timestamp,
        metadata: input.metadata ? cloneValue(input.metadata) : undefined,
      };

      return adapter.insert(item);
    },

    get(itemId) {
      return adapter.fetchById(itemId);
    },

    list(query) {
      return adapter.fetchMany(buildAdapterQuery(query));
    },

    async acknowledge(itemId) {
      return this.updateStatus(itemId, 'acknowledged');
    },

    async dismiss(itemId) {
      const item = await requireItem(adapter, itemId);
      if (item.status !== 'pending' && item.status !== 'acknowledged') {
        throw new InboxInvalidStatusTransitionError(item.id, item.status, 'dismissed');
      }

      return adapter.update(itemId, {
        status: 'dismissed',
        updatedAt: nowIso(),
      });
    },

    async updateStatus(itemId, status) {
      const item = await requireItem(adapter, itemId);
      assertValidTransition(item, status);

      return adapter.update(itemId, {
        status,
        updatedAt: nowIso(),
      });
    },
  };
}
