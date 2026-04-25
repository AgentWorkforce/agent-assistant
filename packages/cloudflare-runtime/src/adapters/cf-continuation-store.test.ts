import type {
  ContinuationRecord,
  ContinuationResumeTrigger,
} from '@agent-assistant/continuation';
import { describe, expect, it } from 'vitest';

import {
  CfContinuationStore,
  continuationTriggerIndexKey,
  resumeTriggerIndexKey,
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

function makeKv(): {
  kv: { get: (k: string) => Promise<string | null>; put: (k: string, v: string) => Promise<void>; delete: (k: string) => Promise<void> };
  entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  const kv = {
    async get(k: string) { return entries.get(k) ?? null; },
    async put(k: string, v: string) { entries.set(k, v); },
    async delete(k: string) { entries.delete(k); },
  };
  return { kv, entries };
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

  it('removes the prior trigger index when waitFor changes on update', async () => {
    const { kv, entries } = makeKv();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new CfContinuationStore({ storage: makeStorage(), triggerIndex: kv as any });
    const record = makeRecord('1');

    await store.put(record);
    expect(entries.get('trigger:external_result:op-1')).toBe('1');

    // Update the record's waitFor to a different operationId — emulates a
    // continuation re-pending on a new external operation.
    const updated: ContinuationRecord = {
      ...record,
      waitFor: { type: 'external_result', operationId: 'op-2' },
    };
    await store.put(updated);

    // Old key gone, new key written. findByTrigger on the OLD key resolves to null.
    expect(entries.has('trigger:external_result:op-1')).toBe(false);
    expect(entries.get('trigger:external_result:op-2')).toBe('1');

    const stale: ContinuationResumeTrigger = {
      type: 'external_result',
      operationId: 'op-1',
      resolvedAt: 'now',
    };
    expect(await store.findByTrigger(stale)).toBeNull();

    const fresh: ContinuationResumeTrigger = {
      type: 'external_result',
      operationId: 'op-2',
      resolvedAt: 'now',
    };
    expect((await store.findByTrigger(fresh))?.id).toBe('1');
  });
});

describe('trigger index key symmetry', () => {
  it('approval_resolution: create-side and resume-side keys match', () => {
    const record = makeRecord('1');
    record.waitFor = { type: 'approval_resolution', approvalId: 'A1' };
    const trigger: ContinuationResumeTrigger = {
      type: 'approval_resolution',
      approvalId: 'A1',
      decision: 'approved',
      resolvedAt: 'now',
    };
    expect(continuationTriggerIndexKey(record)).toBe('trigger:approval_resolution:A1');
    expect(resumeTriggerIndexKey(trigger)).toBe('trigger:approval_resolution:A1');
  });

  it('external_result: create-side and resume-side keys match', () => {
    const record = makeRecord('1');
    record.waitFor = { type: 'external_result', operationId: 'OP1' };
    const trigger: ContinuationResumeTrigger = {
      type: 'external_result',
      operationId: 'OP1',
      resolvedAt: 'now',
    };
    expect(continuationTriggerIndexKey(record)).toBe('trigger:external_result:OP1');
    expect(resumeTriggerIndexKey(trigger)).toBe('trigger:external_result:OP1');
  });

  it('scheduled_wake: only emits a key when wakeUpId is set on both sides', () => {
    const recWithId = makeRecord('1');
    recWithId.waitFor = { type: 'scheduled_wake', wakeUpId: 'W1' };
    const recNoId = makeRecord('2');
    recNoId.waitFor = { type: 'scheduled_wake' };

    const trigWithId: ContinuationResumeTrigger = {
      type: 'scheduled_wake',
      wakeUpId: 'W1',
      firedAt: 'now',
    };
    const trigNoId: ContinuationResumeTrigger = {
      type: 'scheduled_wake',
      firedAt: 'now',
    };

    expect(continuationTriggerIndexKey(recWithId)).toBe('trigger:scheduled_wake:W1');
    expect(resumeTriggerIndexKey(trigWithId)).toBe('trigger:scheduled_wake:W1');
    expect(continuationTriggerIndexKey(recNoId)).toBeUndefined();
    expect(resumeTriggerIndexKey(trigNoId)).toBeUndefined();
  });

  it('user_reply: refuses to synthesize a key from message.id (asymmetric upstream)', () => {
    // Upstream waitFor side has correlationKey, resume side has message.id —
    // they don't overlap, so the cf-runtime returns undefined on both sides
    // rather than synthesize a fake key that would never match.
    const recWithCorr = makeRecord('1');
    recWithCorr.waitFor = { type: 'user_reply', correlationKey: 'channel:thread' };
    const recNoCorr = makeRecord('2');
    recNoCorr.waitFor = { type: 'user_reply' };

    const trigger: ContinuationResumeTrigger = {
      type: 'user_reply',
      message: { id: 'msg-1', role: 'user', content: [] } as never,
      receivedAt: 'now',
    };

    expect(continuationTriggerIndexKey(recWithCorr)).toBe('trigger:user_reply:channel:thread');
    expect(continuationTriggerIndexKey(recNoCorr)).toBeUndefined();
    // resume side never emits — there's no symmetric correlation field.
    expect(resumeTriggerIndexKey(trigger)).toBeUndefined();
  });

  it('findByTrigger returns null for user_reply triggers (no symmetric key)', async () => {
    const { kv } = makeKv();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new CfContinuationStore({ storage: makeStorage(), triggerIndex: kv as any });
    const record = makeRecord('1');
    record.waitFor = { type: 'user_reply', correlationKey: 'channel:thread' };
    await store.put(record);

    const trigger: ContinuationResumeTrigger = {
      type: 'user_reply',
      message: { id: 'msg-1', role: 'user', content: [] } as never,
      receivedAt: 'now',
    };
    expect(await store.findByTrigger(trigger)).toBeNull();
  });
});
