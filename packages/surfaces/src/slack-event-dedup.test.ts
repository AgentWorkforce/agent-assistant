import { describe, it, expect } from 'vitest';

import {
  SlackEventDedupGate,
  getSlackDeduplicationKey,
  type SlackEventDedupStore,
} from './slack-event-dedup.js';

function createFakeStore() {
  const entries = new Map<string, { ttl: number; markedAt: number }>();
  const store: SlackEventDedupStore = {
    async hasBeenProcessed(key) {
      return entries.has(key);
    },
    async markProcessed(key, ttlSeconds) {
      entries.set(key, { ttl: ttlSeconds, markedAt: Date.now() });
    },
  };
  return { store, entries };
}

describe('getSlackDeduplicationKey', () => {
  it('prefers event_id over ts', () => {
    expect(getSlackDeduplicationKey({ eventId: 'Ev123', ts: '1700000000.000100' })).toBe('Ev123');
  });

  it('falls back to ts when event_id is missing', () => {
    expect(getSlackDeduplicationKey({ ts: '1700000000.000100' })).toBe('1700000000.000100');
  });

  it('returns undefined when both are missing', () => {
    expect(getSlackDeduplicationKey({})).toBeUndefined();
  });

  it('treats empty strings as missing', () => {
    expect(getSlackDeduplicationKey({ eventId: '', ts: '' })).toBeUndefined();
    expect(getSlackDeduplicationKey({ eventId: '', ts: '123' })).toBe('123');
  });
});

describe('SlackEventDedupGate.claim', () => {
  it('lets a first-time event proceed and marks it in the store', async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackEventDedupGate({ store });

    const decision = await gate.claim({ eventId: 'Ev123' });

    expect(decision.proceed).toBe(true);
    expect(decision.key).toBe('Ev123');
    expect(entries.has('Ev123')).toBe(true);
    expect(entries.get('Ev123')?.ttl).toBe(SlackEventDedupGate.DEFAULT_TTL_SECONDS);
  });

  it('blocks a repeated delivery of the same event_id', async () => {
    const { store } = createFakeStore();
    const gate = new SlackEventDedupGate({ store });

    await gate.claim({ eventId: 'Ev123' });
    const second = await gate.claim({ eventId: 'Ev123' });

    expect(second.proceed).toBe(false);
    expect(second.reason).toBe('duplicate-event');
    expect(second.key).toBe('Ev123');
  });

  it('does not block when only ts is available and two different events share no ts', async () => {
    const { store } = createFakeStore();
    const gate = new SlackEventDedupGate({ store });

    const a = await gate.claim({ ts: '1700000000.000100' });
    const b = await gate.claim({ ts: '1700000000.000200' });

    expect(a.proceed).toBe(true);
    expect(b.proceed).toBe(true);
  });

  it('proceeds without a key when neither event_id nor ts is present', async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackEventDedupGate({ store });

    const decision = await gate.claim({});

    expect(decision.proceed).toBe(true);
    expect(decision.reason).toBe('no-dedup-key');
    expect(decision.key).toBeUndefined();
    expect(entries.size).toBe(0);
  });

  it('honors a caller-supplied ttl', async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackEventDedupGate({ store, ttlSeconds: 120 });

    await gate.claim({ eventId: 'Ev999' });

    expect(entries.get('Ev999')?.ttl).toBe(120);
  });
});
