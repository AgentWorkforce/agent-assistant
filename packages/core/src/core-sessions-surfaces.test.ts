import { describe, expect, it, vi } from 'vitest';

import {
  createSessionStore,
  defaultAffinityResolver,
  InMemorySessionStoreAdapter,
  resolveSession,
} from '../../sessions/src/index.js';
import type { SessionStore } from '../../sessions/src/types.js';
import { createSurfaceRegistry } from '../../surfaces/src/index.js';
import type {
  SurfaceAdapter,
  SurfaceCapabilities,
  SurfaceConnection,
  SurfacePayload,
} from '../../surfaces/src/types.js';
import { createAssistant } from './index.js';
import type { AssistantDefinition, InboundMessage } from './types.js';

type MockAdapter = SurfaceAdapter & {
  readonly sent: SurfacePayload[];
  triggerConnect(): void;
  triggerDisconnect(): void;
};

const defaultCapabilities: SurfaceCapabilities = {
  markdown: true,
  richBlocks: false,
  attachments: false,
  streaming: false,
  maxResponseLength: 1024,
};

function createMockAdapter(): MockAdapter {
  const sent: SurfacePayload[] = [];
  const connectHandlers = new Set<() => void>();
  const disconnectHandlers = new Set<() => void>();

  return {
    sent,
    async send(payload) {
      sent.push(payload);
    },
    onConnect(callback) {
      connectHandlers.add(callback);
    },
    onDisconnect(callback) {
      disconnectHandlers.add(callback);
    },
    triggerConnect() {
      for (const callback of connectHandlers) {
        callback();
      }
    },
    triggerDisconnect() {
      for (const callback of disconnectHandlers) {
        callback();
      }
    },
  };
}

function registerSurface(
  registry: ReturnType<typeof createSurfaceRegistry>,
  surfaceId: string,
): MockAdapter {
  const adapter = createMockAdapter();
  const connection: SurfaceConnection = {
    id: surfaceId,
    type: 'web',
    state: 'active',
    capabilities: defaultCapabilities,
    adapter,
  };

  registry.register(connection);
  return adapter;
}

function createStore(): SessionStore {
  return createSessionStore({
    adapter: new InMemorySessionStoreAdapter(),
    defaultTtlMs: 60_000,
  });
}

function createDefinition(
  capabilities: AssistantDefinition['capabilities'],
  constraints?: AssistantDefinition['constraints'],
): AssistantDefinition {
  return {
    id: 'assistant-1',
    name: 'Assistant',
    capabilities,
    constraints,
  };
}

describe('core + sessions + surfaces integration (WF-6)', () => {
  it('uses the surface registry as both inbound and outbound runtime adapter', async () => {
    const registry = createSurfaceRegistry();
    const runtime = createAssistant(
      createDefinition({
        reply: () => undefined,
      }),
      {
        inbound: registry,
        outbound: registry,
      },
    );

    await runtime.start();

    expect(runtime.status().ready).toBe(true);

    await runtime.stop();
    expect(runtime.status().ready).toBe(false);
  });

  it('normalizes inbound messages, dispatches them, and allows the handler to emit across attached surfaces', async () => {
    const registry = createSurfaceRegistry();
    const store = createStore();
    const surfaceA = registerSurface(registry, 'surface-a');
    const surfaceB = registerSurface(registry, 'surface-b');
    const handled: InboundMessage[] = [];

    const runtime = createAssistant(
      createDefinition({
        reply: async (message, context) => {
          handled.push(message);
          const session =
            message.sessionId !== undefined
              ? await store.get(message.sessionId)
              : await resolveSession(message, store, defaultAffinityResolver(store));

          if (!session) {
            throw new Error('Expected session to exist before emit');
          }

          await store.attachSurface(session.id, message.surfaceId);
          await context.runtime.emit({
            sessionId: session.id,
            text: `echo:${message.text}`,
          });
        },
      }),
      {
        inbound: registry,
        outbound: registry,
      },
    ).register('sessions', store);

    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      initialSurfaceId: 'surface-a',
    });
    await store.attachSurface(session.id, 'surface-b');
    await runtime.start();

    registry.receiveRaw('surface-a', {
      messageId: 'msg-1',
      sessionId: session.id,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      text: 'hello',
      timestamp: '2026-04-11T00:00:00.000Z',
      capability: 'reply',
    });

    await vi.waitFor(() => {
      expect(handled).toHaveLength(1);
      expect(surfaceA.sent).toHaveLength(1);
      expect(surfaceB.sent).toHaveLength(1);
    });

    expect(handled[0]).toMatchObject({
      id: 'msg-1',
      surfaceId: 'surface-a',
      sessionId: 'session-1',
      userId: 'user-1',
      capability: 'reply',
    });
    expect(surfaceA.sent[0]?.event).toEqual({
      sessionId: 'session-1',
      text: 'echo:hello',
      surfaceId: 'surface-a',
    });
    expect(surfaceB.sent[0]?.event).toEqual({
      sessionId: 'session-1',
      text: 'echo:hello',
      surfaceId: 'surface-b',
    });

    await runtime.stop();
  });

  it('changes fanout targets when surfaces are attached or detached from the session', async () => {
    const registry = createSurfaceRegistry();
    const store = createStore();
    const surfaceA = registerSurface(registry, 'surface-a');
    const surfaceB = registerSurface(registry, 'surface-b');
    const runtime = createAssistant(
      createDefinition({
        reply: () => undefined,
      }),
      {
        inbound: registry,
        outbound: registry,
      },
    ).register('sessions', store);
    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });

    await runtime.emit({ sessionId: session.id, text: 'first' });
    await store.attachSurface(session.id, 'surface-b');
    await runtime.emit({ sessionId: session.id, text: 'second' });
    await store.detachSurface(session.id, 'surface-a');
    await runtime.emit({ sessionId: session.id, text: 'third' });

    expect(surfaceA.sent.map((payload) => payload.event.text)).toEqual(['first', 'second']);
    expect(surfaceB.sent.map((payload) => payload.event.text)).toEqual(['second', 'third']);
  });

  it('skips inactive surfaces during fanout with the default policy', async () => {
    const registry = createSurfaceRegistry();
    const store = createStore();
    const activeSurface = registerSurface(registry, 'surface-a');
    const inactiveSurface = registerSurface(registry, 'surface-b');
    const runtime = createAssistant(
      createDefinition({
        reply: () => undefined,
      }),
      {
        inbound: registry,
        outbound: registry,
      },
    ).register('sessions', store);
    const session = await store.create({
      id: 'session-1',
      userId: 'user-1',
      initialSurfaceId: 'surface-a',
    });
    await store.attachSurface(session.id, 'surface-b');

    inactiveSurface.triggerDisconnect();
    await runtime.emit({ sessionId: session.id, text: 'hello' });

    expect(activeSurface.sent).toHaveLength(1);
    expect(inactiveSurface.sent).toHaveLength(0);
  });

  it('drains in-flight handlers before stop resolves and enforces maxConcurrentHandlers', async () => {
    const registry = createSurfaceRegistry();
    const store = createStore();
    registerSurface(registry, 'surface-a');

    let activeHandlers = 0;
    let maxObservedHandlers = 0;
    const completions: Array<() => void> = [];

    const runtime = createAssistant(
      createDefinition(
        {
          reply: async () => {
            activeHandlers += 1;
            maxObservedHandlers = Math.max(maxObservedHandlers, activeHandlers);

            await new Promise<void>((resolve) => {
              completions.push(() => {
                activeHandlers -= 1;
                resolve();
              });
            });
          },
        },
        {
          maxConcurrentHandlers: 2,
        },
      ),
      {
        inbound: registry,
        outbound: registry,
      },
    ).register('sessions', store);

    await runtime.start();

    registry.receiveRaw('surface-a', {
      messageId: 'msg-1',
      userId: 'user-1',
      text: 'one',
      capability: 'reply',
    });
    registry.receiveRaw('surface-a', {
      messageId: 'msg-2',
      userId: 'user-2',
      text: 'two',
      capability: 'reply',
    });
    registry.receiveRaw('surface-a', {
      messageId: 'msg-3',
      userId: 'user-3',
      text: 'three',
      capability: 'reply',
    });
    registry.receiveRaw('surface-a', {
      messageId: 'msg-4',
      userId: 'user-4',
      text: 'four',
      capability: 'reply',
    });

    await vi.waitFor(() => {
      expect(completions).toHaveLength(2);
    });

    const stopPromise = runtime.stop();
    let stopped = false;
    void stopPromise.then(() => {
      stopped = true;
    });

    await vi.waitFor(() => {
      expect(stopped).toBe(false);
    });

    expect(maxObservedHandlers).toBe(2);

    completions.shift()?.();
    completions.shift()?.();

    await stopPromise;

    expect(runtime.status().ready).toBe(false);
    expect(runtime.status().inFlightHandlers).toBe(0);
  });

  it('drops raw messages that do not normalize to a userId', async () => {
    const registry = createSurfaceRegistry();
    registerSurface(registry, 'surface-a');
    const handler = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = createAssistant(
      createDefinition({
        reply: handler,
      }),
      {
        inbound: registry,
        outbound: registry,
      },
    );

    await runtime.start();
    registry.receiveRaw('surface-a', {
      messageId: 'msg-1',
      text: 'hello',
      capability: 'reply',
    });

    await vi.waitFor(() => {
      expect(handler).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    await runtime.stop();
  });
});
