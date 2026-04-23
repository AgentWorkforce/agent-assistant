import { describe, expect, it } from 'vitest';
import {
  clearSignal,
  DEFAULT_TTL_MS_BY_KIND,
  drainSignals,
  recordSignal,
} from './signal-inbox.js';
import type {
  ProactiveSignal,
  ProactiveSignalKind,
  SignalInboxStore,
} from './signal-inbox.js';

class InMemorySignalInboxStore implements SignalInboxStore {
  readonly signalsByWorkspace = new Map<string, Map<string, ProactiveSignal>>();

  async put(signal: ProactiveSignal): Promise<void> {
    let workspaceSignals = this.signalsByWorkspace.get(signal.workspaceId);
    if (!workspaceSignals) {
      workspaceSignals = new Map();
      this.signalsByWorkspace.set(signal.workspaceId, workspaceSignals);
    }

    workspaceSignals.set(signal.id, signal);
  }

  async list(workspaceId: string): Promise<ProactiveSignal[]> {
    return Array.from(this.signalsByWorkspace.get(workspaceId)?.values() ?? []);
  }

  async delete(workspaceId: string, signalId: string): Promise<void> {
    this.signalsByWorkspace.get(workspaceId)?.delete(signalId);
  }

  has(workspaceId: string, signalId: string): boolean {
    return this.signalsByWorkspace.get(workspaceId)?.has(signalId) ?? false;
  }
}

class ThrowingDeleteSignalInboxStore extends InMemorySignalInboxStore {
  async delete(): Promise<void> {
    throw new Error('delete failed');
  }
}

function makeSignal(overrides: Partial<ProactiveSignal>): ProactiveSignal {
  return {
    id: 'signal-1',
    kind: 'slack.presence',
    workspaceId: 'workspace-1',
    subjectId: 'subject-1',
    payload: {},
    receivedAt: 1_000,
    expiresAt: 2_000,
    ...overrides,
  };
}

describe('signal inbox', () => {
  it('recordSignal generates an id and sets receivedAt and expiresAt from the default TTL', async () => {
    const store = new InMemorySignalInboxStore();
    const now = 10_000;

    const signal = await recordSignal(store, {
      kind: 'slack.presence',
      workspaceId: 'workspace-1',
      subjectId: 'user-1',
      payload: { presence: 'active' },
      now,
    });

    expect(signal.id).toEqual(expect.any(String));
    expect(signal.id).not.toHaveLength(0);
    expect(signal.receivedAt).toBe(now);
    expect(signal.expiresAt).toBe(now + DEFAULT_TTL_MS_BY_KIND['slack.presence']);
    expect(await store.list('workspace-1')).toEqual([signal]);
  });

  it('recordSignal honors explicit input.now and input.ttlMs', async () => {
    const store = new InMemorySignalInboxStore();
    const now = 20_000;
    const ttlMs = 123_456;

    const signal = await recordSignal(store, {
      kind: 'github.pr_review_submitted',
      workspaceId: 'workspace-1',
      subjectId: 'pr-1',
      now,
      ttlMs,
    });

    expect(signal.receivedAt).toBe(now);
    expect(signal.expiresAt).toBe(now + ttlMs);
  });

  it('drainSignals returns all non-expired signals for the workspace', async () => {
    const store = new InMemorySignalInboxStore();
    const first = makeSignal({ id: 'active-1', workspaceId: 'workspace-1', expiresAt: 2_000 });
    const second = makeSignal({
      id: 'active-2',
      kind: 'github.pr_closed',
      workspaceId: 'workspace-1',
      expiresAt: 3_000,
    });
    const otherWorkspace = makeSignal({
      id: 'other-workspace',
      workspaceId: 'workspace-2',
      expiresAt: 4_000,
    });
    await store.put(first);
    await store.put(second);
    await store.put(otherWorkspace);

    await expect(drainSignals(store, 'workspace-1', { now: 1_500 })).resolves.toEqual([
      first,
      second,
    ]);
  });

  it('drainSignals filters by a single kind', async () => {
    const store = new InMemorySignalInboxStore();
    const presence = makeSignal({
      id: 'presence',
      kind: 'slack.presence',
      expiresAt: 2_000,
    });
    const status = makeSignal({ id: 'status', kind: 'slack.status', expiresAt: 2_000 });
    await store.put(presence);
    await store.put(status);

    await expect(
      drainSignals(store, 'workspace-1', { kind: 'slack.status', now: 1_500 }),
    ).resolves.toEqual([status]);
  });

  it('drainSignals filters by an array of kinds', async () => {
    const store = new InMemorySignalInboxStore();
    const presence = makeSignal({
      id: 'presence',
      kind: 'slack.presence',
      expiresAt: 2_000,
    });
    const status = makeSignal({ id: 'status', kind: 'slack.status', expiresAt: 2_000 });
    const prClosed = makeSignal({
      id: 'pr-closed',
      kind: 'github.pr_closed',
      expiresAt: 2_000,
    });
    await store.put(presence);
    await store.put(status);
    await store.put(prClosed);

    const kinds: ProactiveSignalKind[] = ['slack.presence', 'github.pr_closed'];
    await expect(drainSignals(store, 'workspace-1', { kind: kinds, now: 1_500 })).resolves.toEqual([
      presence,
      prClosed,
    ]);
  });

  it('drainSignals excludes expired signals at or before now', async () => {
    const store = new InMemorySignalInboxStore();
    const expiredBeforeNow = makeSignal({ id: 'expired-before-now', expiresAt: 999 });
    const expiredAtNow = makeSignal({ id: 'expired-at-now', expiresAt: 1_000 });
    const active = makeSignal({ id: 'active', expiresAt: 1_001 });
    await store.put(expiredBeforeNow);
    await store.put(expiredAtNow);
    await store.put(active);

    await expect(drainSignals(store, 'workspace-1', { now: 1_000 })).resolves.toEqual([active]);
  });

  it('drainSignals with autoDeleteExpired=true deletes expired signals from the store', async () => {
    const store = new InMemorySignalInboxStore();
    const expired = makeSignal({ id: 'expired', expiresAt: 1_000 });
    const active = makeSignal({ id: 'active', expiresAt: 1_001 });
    await store.put(expired);
    await store.put(active);

    await expect(drainSignals(store, 'workspace-1', { now: 1_000 })).resolves.toEqual([active]);
    expect(store.has('workspace-1', 'expired')).toBe(false);
    expect(store.has('workspace-1', 'active')).toBe(true);
  });

  it('drainSignals with autoDeleteExpired=false leaves expired signals in the store', async () => {
    const store = new InMemorySignalInboxStore();
    const expired = makeSignal({ id: 'expired', expiresAt: 1_000 });
    const active = makeSignal({ id: 'active', expiresAt: 1_001 });
    await store.put(expired);
    await store.put(active);

    await expect(
      drainSignals(store, 'workspace-1', { now: 1_000, autoDeleteExpired: false }),
    ).resolves.toEqual([active]);
    expect(store.has('workspace-1', 'expired')).toBe(true);
    expect(store.has('workspace-1', 'active')).toBe(true);
  });

  it('clearSignal deletes a signal by id', async () => {
    const store = new InMemorySignalInboxStore();
    const signal = makeSignal({ id: 'clear-me' });
    await store.put(signal);

    await clearSignal(store, 'workspace-1', signal.id);

    expect(store.has('workspace-1', signal.id)).toBe(false);
  });

  it('drainSignals swallows delete errors in the autoDeleteExpired path', async () => {
    const store = new ThrowingDeleteSignalInboxStore();
    const expired = makeSignal({ id: 'expired', expiresAt: 1_000 });
    const active = makeSignal({ id: 'active', expiresAt: 1_001 });
    await store.put(expired);
    await store.put(active);

    await expect(drainSignals(store, 'workspace-1', { now: 1_000 })).resolves.toEqual([active]);
  });
});
