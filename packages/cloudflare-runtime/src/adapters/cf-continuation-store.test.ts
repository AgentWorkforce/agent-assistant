import type { ContinuationRecord } from '@agent-assistant/continuation';
import { describe, expect, it } from 'vitest';

import {
  CfContinuationStore,
  type DurableObjectStorageLike,
} from './cf-continuation-store.js';

function makeStorage(): DurableObjectStorageLike {
  const entries = new Map<string, unknown>();
  return {
    async get(key) {
      return entries.get(key);
    },
    async put(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      return entries.delete(key);
    },
    async list(options) {
      return new Map(
        [...entries.entries()].filter(([key]) => !options?.prefix || key.startsWith(options.prefix)),
      );
    },
  };
}

function makeRecord(id: string, sessionId = 'session-1'): ContinuationRecord {
  return {
    id,
    assistantId: 'sage',
    sessionId,
    origin: {
      turnId: `turn-${id}`,
      outcome: 'deferred',
      stopReason: 'runtime_error',
      createdAt: '2026-04-24T00:00:00.000Z',
    },
    status: 'pending',
    waitFor: { type: 'external_result', operationId: `op-${id}` },
    continuation: { token: id },
    delivery: { status: 'pending_delivery' },
    bounds: {
      expiresAt: '2026-04-25T00:00:00.000Z',
      maxResumeAttempts: 3,
      resumeAttempts: 0,
    },
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
  };
}

describe('CfContinuationStore', () => {
  it('stores, retrieves, lists, and deletes continuation records', async () => {
    const store = new CfContinuationStore({ storage: makeStorage() });
    const record = makeRecord('1');

    await store.put(record);

    expect(await store.get('1')).toEqual(record);
    expect(await store.listBySession?.('session-1')).toEqual([record]);

    await store.delete?.('1');

    expect(await store.get('1')).toBeNull();
    expect(await store.listBySession?.('session-1')).toEqual([]);
  });
});
