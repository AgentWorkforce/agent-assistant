import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSessionStore,
  defaultAffinityResolver,
  InMemorySessionStoreAdapter,
  resolveSession,
} from './index.js';
import {
  SessionConflictError,
  SessionNotFoundError,
  SessionStateError,
} from './index.js';
import type { SessionStore } from './types.js';

type SessionSubsystemGet = {
  get(
    sessionId: string,
  ):
    | { attachedSurfaces?: string[] }
    | null
    | undefined
    | Promise<{ attachedSurfaces?: string[] } | null | undefined>;
};

const _contractCheck: SessionSubsystemGet = {} as SessionStore;
void _contractCheck;

function createStore() {
  const adapter = new InMemorySessionStoreAdapter();
  const store = createSessionStore({
    adapter,
    defaultTtlMs: 60_000,
  });

  return { adapter, store };
}

describe('session creation', () => {
  it('creates a session with required fields and defaults', async () => {
    const { store } = createStore();

    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
    });

    expect(session).toMatchObject({
      id: 'session-1',
      userId: 'user-1',
      state: 'created',
      attachedSurfaces: [],
      metadata: {},
    });
    expect(session.createdAt).toBe(session.lastActivityAt);
  });

  it('attaches the initial surface during creation', async () => {
    const { store } = createStore();

    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });

    expect(session.attachedSurfaces).toEqual(['surface-a']);
  });

  it('stores seed metadata during creation', async () => {
    const { store } = createStore();

    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
      metadata: { plan: 'pro' },
    });

    expect(session.metadata).toEqual({ plan: 'pro' });
  });

  it('throws when creating a duplicate session id', async () => {
    const { store } = createStore();
    await store.create({
      id: 'session-1',
      userId: 'user-1',
    });

    await expect(
      store.create({
        id: 'session-1',
        userId: 'user-2',
      }),
    ).rejects.toThrowError(SessionConflictError);
  });
});

describe('session retrieval', () => {
  it('gets a session by id', async () => {
    const { store } = createStore();
    await store.create({
      id: 'session-1',
      userId: 'user-1',
    });

    await expect(store.get('session-1')).resolves.toMatchObject({
      id: 'session-1',
      userId: 'user-1',
    });
  });

  it('returns null for an unknown session id', async () => {
    const { store } = createStore();

    await expect(store.get('missing')).resolves.toBeNull();
  });

  it('finds sessions filtered by userId, state, and limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const { store } = createStore();

    await store.create({ id: 'session-1', userId: 'user-1' });
    vi.setSystemTime(new Date('2026-04-11T00:01:00.000Z'));
    await store.touch('session-1');

    vi.setSystemTime(new Date('2026-04-11T00:02:00.000Z'));
    await store.create({ id: 'session-2', userId: 'user-1' });
    vi.setSystemTime(new Date('2026-04-11T00:03:00.000Z'));
    await store.touch('session-2');

    await store.create({ id: 'session-3', userId: 'user-2' });

    const sessions = await store.find({
      userId: 'user-1',
      state: 'active',
      limit: 1,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.userId).toBe('user-1');
    expect(sessions[0]?.state).toBe('active');
    vi.useRealTimers();
  });
});

describe('lifecycle transitions', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('touch transitions created sessions to active and updates timestamps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const { store } = createStore();
    await store.create({ id: 'session-1', userId: 'user-1' });

    vi.setSystemTime(new Date('2026-04-11T00:05:00.000Z'));
    const session = await store.touch('session-1');

    expect(session.state).toBe('active');
    expect(session.lastActivityAt).toBe('2026-04-11T00:05:00.000Z');
    expect(session.stateChangedAt).toBe('2026-04-11T00:05:00.000Z');
  });

  it('touch on active sessions updates lastActivityAt only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const { store } = createStore();
    await store.create({ id: 'session-1', userId: 'user-1' });
    vi.setSystemTime(new Date('2026-04-11T00:01:00.000Z'));
    const activated = await store.touch('session-1');

    vi.setSystemTime(new Date('2026-04-11T00:02:00.000Z'));
    const touched = await store.touch('session-1');

    expect(touched.state).toBe('active');
    expect(touched.lastActivityAt).toBe('2026-04-11T00:02:00.000Z');
    expect(touched.stateChangedAt).toBe(activated.stateChangedAt);
  });

  it('touch transitions suspended sessions back to active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const { adapter, store } = createStore();
    await store.create({ id: 'session-1', userId: 'user-1' });
    await adapter.update('session-1', {
      state: 'suspended',
      stateChangedAt: '2026-04-11T00:01:00.000Z',
    });

    vi.setSystemTime(new Date('2026-04-11T00:02:00.000Z'));
    const session = await store.touch('session-1');

    expect(session.state).toBe('active');
    expect(session.lastActivityAt).toBe('2026-04-11T00:02:00.000Z');
    expect(session.stateChangedAt).toBe('2026-04-11T00:02:00.000Z');
  });

  it('touch on expired sessions throws a SessionStateError', async () => {
    const { adapter, store } = createStore();
    await store.create({ id: 'session-1', userId: 'user-1' });
    await adapter.update('session-1', { state: 'expired' });

    await expect(store.touch('session-1')).rejects.toThrowError(SessionStateError);
  });

  it('expire transitions active sessions to expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const { store } = createStore();
    await store.create({ id: 'session-1', userId: 'user-1' });
    await store.touch('session-1');

    vi.setSystemTime(new Date('2026-04-11T00:03:00.000Z'));
    const session = await store.expire('session-1');

    expect(session.state).toBe('expired');
    expect(session.stateChangedAt).toBe('2026-04-11T00:03:00.000Z');
  });

  it('expire is idempotent for already-expired sessions', async () => {
    const { store } = createStore();
    await store.create({ id: 'session-1', userId: 'user-1' });

    const expired = await store.expire('session-1');
    const repeated = await store.expire('session-1');

    expect(repeated).toEqual(expired);
  });
});

describe('surface attachment', () => {
  it('attaches a surface to a session', async () => {
    const { store } = createStore();
    await store.create({ id: 'session-1', userId: 'user-1' });

    const session = await store.attachSurface('session-1', 'surface-a');

    expect(session.attachedSurfaces).toEqual(['surface-a']);
  });

  it('attachSurface is idempotent when the surface is already attached', async () => {
    const { store } = createStore();
    await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });

    const session = await store.attachSurface('session-1', 'surface-a');

    expect(session.attachedSurfaces).toEqual(['surface-a']);
  });

  it('detaches surfaces and is idempotent when the surface is absent', async () => {
    const { store } = createStore();
    await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });
    await store.attachSurface('session-1', 'surface-b');

    const detached = await store.detachSurface('session-1', 'surface-a');
    const repeated = await store.detachSurface('session-1', 'surface-a');

    expect(detached.attachedSurfaces).toEqual(['surface-b']);
    expect(repeated.attachedSurfaces).toEqual(['surface-b']);
  });
});

describe('sweep and metadata', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('sweepStale transitions stale active sessions to suspended', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const { store } = createStore();
    await store.create({ id: 'stale', userId: 'user-1' });
    await store.touch('stale');

    vi.setSystemTime(new Date('2026-04-11T00:02:00.000Z'));
    const transitioned = await store.sweepStale(60_000);

    expect(transitioned).toHaveLength(1);
    expect(transitioned[0]).toMatchObject({
      id: 'stale',
      state: 'suspended',
    });
  });

  it('sweepStale leaves fresh sessions active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const { store } = createStore();
    await store.create({ id: 'fresh', userId: 'user-1' });
    await store.touch('fresh');

    vi.setSystemTime(new Date('2026-04-11T00:00:30.000Z'));
    const transitioned = await store.sweepStale(60_000);
    const session = await store.get('fresh');

    expect(transitioned).toEqual([]);
    expect(session?.state).toBe('active');
  });

  it('updateMetadata merges new keys without replacing existing metadata', async () => {
    const { store } = createStore();
    await store.create({
      id: 'session-1',
      userId: 'user-1',
      metadata: { tier: 'pro', locale: 'en-US' },
    });

    const session = await store.updateMetadata('session-1', {
      locale: 'nb-NO',
      timezone: 'Europe/Oslo',
    });

    expect(session.metadata).toEqual({
      tier: 'pro',
      locale: 'nb-NO',
      timezone: 'Europe/Oslo',
    });
  });
});

describe('error cases', () => {
  it('touch throws SessionNotFoundError for unknown sessions', async () => {
    const { store } = createStore();

    await expect(store.touch('missing')).rejects.toThrowError(SessionNotFoundError);
  });

  it('attachSurface throws SessionNotFoundError for unknown sessions', async () => {
    const { store } = createStore();

    await expect(store.attachSurface('missing', 'surface-a')).rejects.toThrowError(
      SessionNotFoundError,
    );
  });

  it('updateMetadata throws SessionNotFoundError for unknown sessions', async () => {
    const { store } = createStore();

    await expect(store.updateMetadata('missing', { ok: true })).rejects.toThrowError(
      SessionNotFoundError,
    );
  });
});

describe('affinity and resolution', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('defaultAffinityResolver returns the most recent active session for a user', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const { store } = createStore();
    await store.create({ id: 'older', userId: 'user-1' });
    await store.touch('older');

    vi.setSystemTime(new Date('2026-04-11T00:02:00.000Z'));
    await store.create({ id: 'newer', userId: 'user-1' });
    await store.touch('newer');

    const resolver = defaultAffinityResolver(store);
    const session = await resolver.resolve('user-1');

    expect(session?.id).toBe('newer');
  });

  it('resolveSession creates a new session when affinity does not resolve one', async () => {
    const { store } = createStore();
    const resolver = {
      resolve: vi.fn(async () => null),
    };

    const session = await resolveSession(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        surfaceId: 'surface-a',
      },
      store,
      resolver,
    );

    expect(resolver.resolve).toHaveBeenCalledWith('user-1', 'surface-a');
    expect(session).toMatchObject({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      state: 'created',
      attachedSurfaces: ['surface-a'],
    });
  });

  it('resolveSession touches and returns the resolved session when affinity matches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const { store } = createStore();
    const existing = await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });

    const resolver = {
      resolve: vi.fn(async () => existing),
    };

    vi.setSystemTime(new Date('2026-04-11T00:01:00.000Z'));
    const session = await resolveSession(
      {
        userId: 'user-1',
        surfaceId: 'surface-a',
      },
      store,
      resolver,
    );

    expect(session.id).toBe('session-1');
    expect(session.state).toBe('active');
    expect(session.lastActivityAt).toBe('2026-04-11T00:01:00.000Z');
  });
});
