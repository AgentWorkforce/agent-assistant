import { describe, expect, it, vi } from 'vitest';

import {
  AssistantDefinitionError,
  OutboundEventError,
  createAssistant,
} from './index.js';
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
    sessionId: 'session-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    text: 'hello',
    raw: { source: 'test' },
    receivedAt: '2026-04-11T00:00:00.000Z',
    capability: 'reply',
    ...overrides,
  };
}

function createStubAdapters() {
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

  const outbound: RelayOutboundAdapter = {
    async send(event) {
      sent.push(event);
    },
    async fanout(event, surfaceIds) {
      fanouts.push({ event, surfaceIds });
    },
  };

  return {
    inbound,
    outbound,
    sent,
    fanouts,
    handlers,
  };
}

describe('createAssistant', () => {
  it('returns a runtime for a valid definition', () => {
    const adapters = createStubAdapters();
    const runtime = createAssistant(
      {
        id: 'assistant-1',
        name: 'Assistant',
        capabilities: {
          reply: () => undefined,
        },
      },
      adapters,
    );

    expect(runtime.definition.id).toBe('assistant-1');
    expect(runtime.status().registeredCapabilities).toEqual(['reply']);
  });

  it('throws for a missing id', () => {
    const adapters = createStubAdapters();

    expect(() =>
      createAssistant(
        {
          id: '',
          name: 'Assistant',
          capabilities: {
            reply: () => undefined,
          },
        },
        adapters,
      ),
    ).toThrowError(AssistantDefinitionError);
  });

  it('throws for empty capabilities', () => {
    const adapters = createStubAdapters();

    expect(() =>
      createAssistant(
        {
          id: 'assistant-1',
          name: 'Assistant',
          capabilities: {},
        },
        adapters,
      ),
    ).toThrowError(AssistantDefinitionError);
  });

  it('throws for non-function capability values', () => {
    const adapters = createStubAdapters();

    expect(() =>
      createAssistant(
        {
          id: 'assistant-1',
          name: 'Assistant',
          capabilities: {
            reply: 'not-a-function' as unknown as never,
          },
        },
        adapters,
      ),
    ).toThrowError(AssistantDefinitionError);
  });
});

describe('runtime lifecycle and dispatch', () => {
  function createDefinition(overrides: Partial<AssistantDefinition> = {}): AssistantDefinition {
    return {
      id: 'assistant-1',
      name: 'Assistant',
      capabilities: {
        reply: () => undefined,
      },
      ...overrides,
    };
  }

  it('supports start, stop, register, get, and status', async () => {
    const adapters = createStubAdapters();
    const onStart = vi.fn();
    const onStop = vi.fn();
    const runtime = createAssistant(
      createDefinition({
        hooks: {
          onStart,
          onStop,
        },
      }),
      adapters,
    );

    expect(runtime.status().ready).toBe(false);

    const chained = runtime.register('foo', { ok: true });
    expect(chained).toBe(runtime);
    expect(runtime.get<{ ok: boolean }>('foo')).toEqual({ ok: true });
    expect(() => runtime.get('missing')).toThrow("Subsystem 'missing' is not registered");

    await runtime.start();
    const startedStatus = runtime.status();

    expect(startedStatus.ready).toBe(true);
    expect(startedStatus.startedAt).toBeTruthy();
    expect(startedStatus.registeredSubsystems).toContain('foo');
    expect(startedStatus.registeredCapabilities).toEqual(['reply']);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(adapters.handlers.size).toBe(1);

    await runtime.start();
    expect(onStart).toHaveBeenCalledTimes(1);

    await runtime.stop();
    expect(runtime.status().ready).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(adapters.handlers.size).toBe(0);

    await runtime.stop();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('dispatches to the matching capability with the live runtime context', async () => {
    const adapters = createStubAdapters();
    const handler = vi.fn(async (message: InboundMessage, context) => {
      expect(message.text).toBe('hello');
      expect(context.runtime.status().ready).toBe(true);
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        text: `echo:${message.text}`,
      });
    });

    const runtime = createAssistant(
      createDefinition({
        capabilities: {
          reply: handler,
        },
      }),
      adapters,
    );

    await runtime.start();
    await runtime.dispatch(createMessage());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(adapters.sent).toEqual([
      {
        surfaceId: 'surface-a',
        text: 'echo:hello',
      },
    ]);
  });

  it('drops a message when onMessage returns false', async () => {
    const adapters = createStubAdapters();
    const handler = vi.fn();
    const runtime = createAssistant(
      createDefinition({
        capabilities: {
          reply: handler,
        },
        hooks: {
          onMessage: () => false,
        },
      }),
      adapters,
    );

    await runtime.start();
    await runtime.dispatch(createMessage());

    expect(handler).not.toHaveBeenCalled();
  });

  it('allows a message when onMessage returns true', async () => {
    const adapters = createStubAdapters();
    const handler = vi.fn();
    const runtime = createAssistant(
      createDefinition({
        capabilities: {
          reply: handler,
        },
        hooks: {
          onMessage: () => true,
        },
      }),
      adapters,
    );

    await runtime.start();
    await runtime.dispatch(createMessage());

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reports missing capabilities through onError without throwing', async () => {
    const adapters = createStubAdapters();
    const onError = vi.fn();
    const runtime = createAssistant(
      createDefinition({
        hooks: { onError },
      }),
      adapters,
    );

    await runtime.start();
    await runtime.dispatch(createMessage({ capability: 'missing' }));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[0]?.message).toContain("No capability registered for 'missing'");
  });

  it('reports handler errors through onError', async () => {
    const adapters = createStubAdapters();
    const failure = new Error('boom');
    const onError = vi.fn();
    const runtime = createAssistant(
      createDefinition({
        capabilities: {
          reply: () => {
            throw failure;
          },
        },
        hooks: { onError },
      }),
      adapters,
    );

    await runtime.start();
    await runtime.dispatch(createMessage());

    expect(onError).toHaveBeenCalledWith(failure, expect.objectContaining({ id: 'msg-1' }));
  });

  it('throws when dispatch is called after stop', async () => {
    const adapters = createStubAdapters();
    const runtime = createAssistant(createDefinition(), adapters);

    await runtime.start();
    await runtime.stop();

    await expect(runtime.dispatch(createMessage())).rejects.toThrow(
      'Assistant runtime must be started before dispatching messages',
    );
  });

  it('tracks in-flight handlers during execution', async () => {
    const adapters = createStubAdapters();
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observedInFlight = -1;

    const runtime = createAssistant(
      createDefinition({
        capabilities: {
          reply: async (_message, context) => {
            observedInFlight = context.runtime.status().inFlightHandlers;
            await blocked;
          },
        },
      }),
      adapters,
    );

    await runtime.start();
    const dispatchPromise = runtime.dispatch(createMessage());
    await vi.waitFor(() => {
      expect(observedInFlight).toBe(1);
    });
    release();
    await dispatchPromise;
  });

  it('times out handlers and reports the timeout through onError', async () => {
    const adapters = createStubAdapters();
    const onError = vi.fn();
    const runtime = createAssistant(
      createDefinition({
        capabilities: {
          reply: () => new Promise(() => undefined),
        },
        constraints: {
          handlerTimeoutMs: 20,
        },
        hooks: { onError },
      }),
      adapters,
    );

    await runtime.start();
    await runtime.dispatch(createMessage());

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]?.message).toContain("Capability 'reply' timed out");
  });

  it('emits fanout events through the session subsystem', async () => {
    const adapters = createStubAdapters();
    const runtime = createAssistant(createDefinition(), adapters);
    runtime.register('sessions', {
      getSession: async (sessionId: string) => ({
        id: sessionId,
        attachedSurfaces: ['surface-a', 'surface-b'],
      }),
    });

    await runtime.start();
    await runtime.emit({
      sessionId: 'session-1',
      text: 'broadcast',
    });

    expect(adapters.fanouts).toEqual([
      {
        event: {
          sessionId: 'session-1',
          text: 'broadcast',
        },
        surfaceIds: ['surface-a', 'surface-b'],
      },
    ]);
  });

  it('throws when emit has no routing target', async () => {
    const adapters = createStubAdapters();
    const runtime = createAssistant(createDefinition(), adapters);

    await runtime.start();

    await expect(
      runtime.emit({
        text: 'missing target',
      }),
    ).rejects.toThrowError(OutboundEventError);
  });

  it('wires inbound adapter messages into dispatch on start', async () => {
    const adapters = createStubAdapters();
    const handler = vi.fn();
    const runtime = createAssistant(
      createDefinition({
        capabilities: {
          reply: handler,
        },
      }),
      adapters,
    );

    await runtime.start();
    const inboundHandler = [...adapters.handlers][0];
    inboundHandler?.(createMessage());
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
