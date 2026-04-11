import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSessionStore,
  defaultAffinityResolver,
  InMemorySessionStoreAdapter,
  resolveSession,
} from '../../sessions/src/index.js';
import type { SessionStore } from '../../sessions/src/types.js';
import { OutboundEventError, createAssistant } from './index.js';
import type {
  AssistantDefinition,
  InboundMessage,
  OutboundEvent,
  RelayInboundAdapter,
  RelayOutboundAdapter,
} from './types.js';

function createMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    surfaceId: 'surface-a',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    text: 'hello',
    raw: { source: 'test' },
    receivedAt: '2026-04-11T00:00:00.000Z',
    capability: 'reply',
    ...overrides,
  };
}

function createStore(): SessionStore {
  return createSessionStore({
    adapter: new InMemorySessionStoreAdapter(),
    defaultTtlMs: 60_000,
  });
}

function createDefinition(): AssistantDefinition {
  return {
    id: 'assistant-1',
    name: 'Assistant',
    capabilities: {
      reply: () => undefined,
    },
  };
}

function createAdapters(withFanout = false): {
  inbound: RelayInboundAdapter;
  outbound: RelayOutboundAdapter;
  handlers: Set<(message: InboundMessage) => void>;
  sent: OutboundEvent[];
  fanouts: Array<{ event: OutboundEvent; surfaceIds: string[] }>;
} {
  const handlers = new Set<(message: InboundMessage) => void>();
  const sent: OutboundEvent[] = [];
  const fanouts: Array<{ event: OutboundEvent; surfaceIds: string[] }> = [];

  const inbound: RelayInboundAdapter = {
    onMessage(handler) {
      handlers.add(handler);
    },
    offMessage(handler) {
      handlers.delete(handler);
    },
  };

  const outbound: RelayOutboundAdapter = withFanout
    ? {
        async send(event) {
          sent.push(event);
        },
        async fanout(event, surfaceIds) {
          fanouts.push({ event, surfaceIds });
        },
      }
    : {
        async send(event) {
          sent.push(event);
        },
      };

  return { inbound, outbound, handlers, sent, fanouts };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('core + sessions integration (WF-4)', () => {
  it('registers the session store as a runtime subsystem', () => {
    const store = createStore();
    const adapters = createAdapters();
    const runtime = createAssistant(createDefinition(), adapters);

    runtime.register('sessions', store);

    expect(runtime.get<SessionStore>('sessions')).toBe(store);
    expect(runtime.status().registeredSubsystems).toContain('sessions');
  });

  it('resolves a new session on first message, attaches the surface, and touches it active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const store = createStore();
    const resolver = defaultAffinityResolver(store);

    const created = await resolveSession(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        surfaceId: 'surface-a',
      },
      store,
      resolver,
    );

    expect(created.state).toBe('created');
    expect(created.attachedSurfaces).toEqual(['surface-a']);

    vi.setSystemTime(new Date('2026-04-11T00:01:00.000Z'));
    const touched = await store.touch(created.id);

    expect(touched.state).toBe('active');
    expect(touched.lastActivityAt).toBe('2026-04-11T00:01:00.000Z');
  });

  it('resolves the existing session for subsequent messages from the same user and surface', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const store = createStore();
    const initial = await store.create({
      id: 'session-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      initialSurfaceId: 'surface-a',
    });
    await store.touch(initial.id);

    const session = await resolveSession(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        surfaceId: 'surface-a',
      },
      store,
      defaultAffinityResolver(store),
    );

    expect(session.id).toBe(initial.id);
  });

  it('emits to every surface attached to the session when fanout is unavailable', async () => {
    const store = createStore();
    const adapters = createAdapters();
    const runtime = createAssistant(createDefinition(), adapters).register('sessions', store);
    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });
    await store.attachSurface(session.id, 'surface-b');

    await runtime.emit({
      sessionId: session.id,
      text: 'hello',
    });

    expect(adapters.sent).toEqual([
      { sessionId: session.id, text: 'hello', surfaceId: 'surface-a' },
      { sessionId: session.id, text: 'hello', surfaceId: 'surface-b' },
    ]);
  });

  it('uses outbound fanout when the adapter exposes it', async () => {
    const store = createStore();
    const adapters = createAdapters(true);
    const runtime = createAssistant(createDefinition(), adapters).register('sessions', store);
    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });
    await store.attachSurface(session.id, 'surface-b');

    await runtime.emit({
      sessionId: session.id,
      text: 'hello',
    });

    expect(adapters.fanouts).toEqual([
      {
        event: { sessionId: session.id, text: 'hello' },
        surfaceIds: ['surface-a', 'surface-b'],
      },
    ]);
    expect(adapters.sent).toEqual([]);
  });

  it('throws when emit references a nonexistent session', async () => {
    const store = createStore();
    const adapters = createAdapters();
    const runtime = createAssistant(createDefinition(), adapters).register('sessions', store);

    await expect(runtime.emit({ sessionId: 'missing', text: 'hello' })).rejects.toThrow(
      "Session 'missing' could not be resolved for fanout",
    );
  });

  it('throws OutboundEventError when emit lacks both surfaceId and sessionId', async () => {
    const runtime = createAssistant(createDefinition(), createAdapters());

    await expect(runtime.emit({ text: 'hello' })).rejects.toThrowError(OutboundEventError);
  });

  it('updates lastActivityAt when the session is touched during dispatch integration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const store = createStore();
    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });
    const activeSession = await store.touch(session.id);
    const initialTimestamp = activeSession.lastActivityAt;
    const resolver = {
      resolve: vi.fn(async () => activeSession),
    };

    vi.setSystemTime(new Date('2026-04-11T00:02:00.000Z'));
    const resolved = await resolveSession(createMessage(), store, resolver);

    expect(resolver.resolve).toHaveBeenCalledWith('user-1', 'surface-a');
    expect(resolved.id).toBe(session.id);
    expect(resolved.lastActivityAt).toBe('2026-04-11T00:02:00.000Z');
    expect(resolved.lastActivityAt).not.toBe(initialTimestamp);
  });

  it('reflects surface attach and detach effects in runtime fanout targets', async () => {
    const store = createStore();
    const adapters = createAdapters();
    const runtime = createAssistant(createDefinition(), adapters).register('sessions', store);
    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });

    await store.attachSurface(session.id, 'surface-b');
    expect((await store.get(session.id))?.attachedSurfaces).toEqual(['surface-a', 'surface-b']);

    await store.detachSurface(session.id, 'surface-a');
    await runtime.emit({
      sessionId: session.id,
      text: 'hello',
    });

    expect((await store.get(session.id))?.attachedSurfaces).toEqual(['surface-b']);
    expect(adapters.sent).toEqual([
      { sessionId: session.id, text: 'hello', surfaceId: 'surface-b' },
    ]);
  });
});
