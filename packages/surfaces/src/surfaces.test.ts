import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SurfaceConflictError,
  SurfaceDeliveryError,
  SurfaceNotFoundError,
  createSurfaceRegistry,
} from './index.js';
import type {
  NormalizedInboundMessage,
  SurfaceAdapter,
  SurfaceCapabilities,
  SurfaceConnection,
  SurfaceOutboundEvent,
  SurfacePayload,
  SurfaceRegistry,
} from './types.js';

type MockAdapter = SurfaceAdapter & {
  sent: SurfacePayload[];
  triggerConnect(): void;
  triggerDisconnect(): void;
};

type MockConnection = SurfaceConnection & {
  adapter: MockAdapter;
};

type CoreInboundAdapter = {
  onMessage(handler: (message: NormalizedInboundMessage) => void): void;
  offMessage(handler: (message: NormalizedInboundMessage) => void): void;
};

type CoreOutboundAdapter = {
  send(event: SurfaceOutboundEvent): Promise<void>;
};

const _inboundContractCheck: CoreInboundAdapter = createSurfaceRegistry();
const _outboundContractCheck: CoreOutboundAdapter = createSurfaceRegistry();
void _inboundContractCheck;
void _outboundContractCheck;

const defaultCapabilities: SurfaceCapabilities = {
  markdown: true,
  richBlocks: false,
  attachments: false,
  streaming: false,
  maxResponseLength: 0,
};

function createMockAdapter(options: {
  failWith?: Error;
  callOnConnectImmediately?: boolean;
} = {}): MockAdapter {
  const sent: SurfacePayload[] = [];
  const connectHandlers = new Set<() => void>();
  const disconnectHandlers = new Set<() => void>();

  return {
    sent,
    async send(payload) {
      if (options.failWith) {
        throw options.failWith;
      }

      sent.push(payload);
    },
    onConnect(callback) {
      connectHandlers.add(callback);
      if (options.callOnConnectImmediately) {
        callback();
      }
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

function createConnection(
  overrides: Partial<SurfaceConnection> = {},
): MockConnection {
  const adapter = createMockAdapter();

  return {
    id: 'surface-a',
    type: 'web',
    state: 'registered',
    capabilities: defaultCapabilities,
    adapter,
    ...overrides,
  } as MockConnection;
}

function createEvent(overrides: Partial<SurfaceOutboundEvent> = {}): SurfaceOutboundEvent {
  return {
    surfaceId: 'surface-a',
    sessionId: 'session-1',
    text: 'hello',
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('surface registration', () => {
  it('registers a surface and returns it from get', () => {
    const registry = createSurfaceRegistry();
    const connection = createConnection();

    registry.register(connection);

    expect(registry.get('surface-a')).toBe(connection);
  });

  it('throws when registering a duplicate surface id', () => {
    const registry = createSurfaceRegistry();
    registry.register(createConnection());

    expect(() => registry.register(createConnection())).toThrowError(SurfaceConflictError);
  });

  it('unregister removes a registered surface', () => {
    const registry = createSurfaceRegistry();
    registry.register(createConnection());

    registry.unregister('surface-a');

    expect(registry.get('surface-a')).toBeNull();
  });

  it('unregister is idempotent for unknown surfaces', () => {
    const registry = createSurfaceRegistry();

    expect(() => registry.unregister('missing')).not.toThrow();
  });

  it('lists surfaces and supports state and type filters', () => {
    const registry = createSurfaceRegistry();
    registry.register(createConnection());
    registry.register(
      createConnection({
        id: 'surface-b',
        type: 'slack',
        state: 'inactive',
      }),
    );

    expect(registry.list()).toHaveLength(2);
    expect(registry.list({ state: 'inactive' }).map((item) => item.id)).toEqual(['surface-b']);
    expect(registry.list({ type: 'web' }).map((item) => item.id)).toEqual(['surface-a']);
  });
});

describe('connection state management', () => {
  it('transitions a registered surface to active when the adapter connects', () => {
    const registry = createSurfaceRegistry();
    const connection = createConnection();
    registry.register(connection);

    connection.adapter.triggerConnect();

    expect(connection.state).toBe('active');
  });

  it('transitions a surface to inactive when the adapter disconnects', () => {
    const registry = createSurfaceRegistry();
    const connection = createConnection({ state: 'active' });
    registry.register(connection);

    connection.adapter.triggerDisconnect();

    expect(connection.state).toBe('inactive');
  });

  it('supports reconnecting back to active after a disconnect', () => {
    const registry = createSurfaceRegistry();
    const connection = createConnection({ state: 'active' });
    registry.register(connection);

    connection.adapter.triggerDisconnect();
    connection.adapter.triggerConnect();

    expect(connection.state).toBe('active');
  });
});

describe('inbound normalization', () => {
  it('normalizes complete raw payloads', () => {
    const registry = createSurfaceRegistry();
    const handler = vi.fn();
    registry.onMessage(handler);

    registry.receiveRaw('surface-a', {
      messageId: 'msg-1',
      sessionId: 'session-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      text: 'hello',
      timestamp: '2026-04-11T00:00:00.000Z',
      capability: 'reply',
    });

    expect(handler).toHaveBeenCalledWith({
      id: 'msg-1',
      surfaceId: 'surface-a',
      sessionId: 'session-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      text: 'hello',
      raw: expect.any(Object),
      receivedAt: '2026-04-11T00:00:00.000Z',
      capability: 'reply',
    });
  });

  it('drops inbound messages without a user id', () => {
    const registry = createSurfaceRegistry();
    const handler = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registry.onMessage(handler);

    registry.receiveRaw('surface-a', { text: 'hello' });

    expect(handler).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('uses an empty string when text is missing and logs a warning', () => {
    const registry = createSurfaceRegistry();
    const handler = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registry.onMessage(handler);

    registry.receiveRaw('surface-a', { userId: 'user-1' });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '',
      }),
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it('fills optional fields with generated fallbacks when missing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const registry = createSurfaceRegistry();
    const handler = vi.fn();
    registry.onMessage(handler);

    registry.receiveRaw('surface-a', { user: { id: 'user-1' } });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        receivedAt: '2026-04-11T00:00:00.000Z',
        capability: 'chat',
        sessionId: undefined,
        workspaceId: undefined,
      }),
    );
  });

  it('uses the custom normalization hook when configured', () => {
    const registry = createSurfaceRegistry({
      normalizationHook: (surfaceId, raw) => ({
        id: 'custom-1',
        surfaceId,
        userId: 'custom-user',
        text: 'normalized',
        raw,
        receivedAt: '2026-04-11T00:00:00.000Z',
        capability: 'custom',
      }),
    });
    const handler = vi.fn();
    registry.onMessage(handler);

    registry.receiveRaw('surface-a', { any: 'payload' });

    expect(handler).toHaveBeenCalledWith({
      id: 'custom-1',
      surfaceId: 'surface-a',
      userId: 'custom-user',
      text: 'normalized',
      raw: { any: 'payload' },
      receivedAt: '2026-04-11T00:00:00.000Z',
      capability: 'custom',
    });
  });

  it('dispatches normalized messages to all registered handlers', () => {
    const registry = createSurfaceRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.onMessage(first);
    registry.onMessage(second);

    registry.receiveRaw('surface-a', { userId: 'user-1', text: 'hello' });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('removes handlers via offMessage by reference', () => {
    const registry = createSurfaceRegistry();
    const handler = vi.fn();
    registry.onMessage(handler);
    registry.offMessage(handler);

    registry.receiveRaw('surface-a', { userId: 'user-1', text: 'hello' });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('outbound targeted send', () => {
  it('delivers an event to the targeted surface adapter', async () => {
    const registry = createSurfaceRegistry();
    const connection = createConnection();
    registry.register(connection);

    await registry.send(createEvent());

    expect(connection.adapter.sent).toEqual([
      {
        event: createEvent(),
        formatted: 'hello',
        surfaceCapabilities: defaultCapabilities,
      },
    ]);
  });

  it('applies the format hook when present', async () => {
    const registry = createSurfaceRegistry();
    const connection = createConnection({
      formatHook: (event, capabilities) => ({
        kind: 'rich',
        text: event.text,
        markdown: capabilities.markdown,
      }),
    });
    registry.register(connection);

    await registry.send(createEvent());

    expect(connection.adapter.sent[0]?.formatted).toEqual({
      kind: 'rich',
      text: 'hello',
      markdown: true,
    });
  });

  it('defaults formatted output to event text when no format hook exists', async () => {
    const registry = createSurfaceRegistry();
    const connection = createConnection();
    registry.register(connection);

    await registry.send(createEvent({ text: 'plain text' }));

    expect(connection.adapter.sent[0]?.formatted).toBe('plain text');
  });

  it('throws when sending to an unknown surface', async () => {
    const registry = createSurfaceRegistry();

    await expect(registry.send(createEvent())).rejects.toThrowError(SurfaceNotFoundError);
  });

  it('throws when sending without a surface id', async () => {
    const registry = createSurfaceRegistry();

    await expect(registry.send(createEvent({ surfaceId: undefined }))).rejects.toThrowError(
      SurfaceNotFoundError,
    );
  });
});

describe('outbound delivery errors', () => {
  it('wraps adapter failures in SurfaceDeliveryError', async () => {
    const registry = createSurfaceRegistry();
    const connection = createConnection({
      adapter: createMockAdapter({ failWith: new Error('boom') }),
    });
    registry.register(connection);

    await expect(registry.send(createEvent())).rejects.toThrowError(SurfaceDeliveryError);
  });

  it('preserves the original cause on SurfaceDeliveryError', async () => {
    const registry = createSurfaceRegistry();
    const cause = new Error('boom');
    const connection = createConnection({
      adapter: createMockAdapter({ failWith: cause }),
    });
    registry.register(connection);

    await expect(registry.send(createEvent())).rejects.toMatchObject({
      surfaceId: 'surface-a',
      cause,
    });
  });
});

describe('fanout', () => {
  it('delivers concurrently to all active attached surfaces', async () => {
    const registry = createSurfaceRegistry();
    const surfaceA = createConnection({ id: 'surface-a' });
    const surfaceB = createConnection({ id: 'surface-b' });
    registry.register(surfaceA);
    registry.register(surfaceB);

    const result = await registry.fanout(
      createEvent({ surfaceId: undefined, sessionId: 'session-1' }),
      ['surface-a', 'surface-b'],
    );

    expect(result).toEqual({
      total: 2,
      delivered: 2,
      outcomes: [
        { surfaceId: 'surface-a', status: 'delivered' },
        { surfaceId: 'surface-b', status: 'delivered' },
      ],
    });
    expect(surfaceA.adapter.sent).toHaveLength(1);
    expect(surfaceB.adapter.sent).toHaveLength(1);
  });

  it('skips inactive surfaces when skipInactive is true', async () => {
    const registry = createSurfaceRegistry();
    const active = createConnection({ id: 'surface-a', state: 'active' });
    const inactive = createConnection({ id: 'surface-b', state: 'inactive' });
    registry.register(active);
    registry.register(inactive);

    const result = await registry.fanout(createEvent({ surfaceId: undefined }), [
      'surface-a',
      'surface-b',
    ]);

    expect(result.outcomes).toEqual([
      { surfaceId: 'surface-a', status: 'delivered' },
      { surfaceId: 'surface-b', status: 'skipped' },
    ]);
  });

  it('reports failed surfaces and continues when onError is continue', async () => {
    const registry = createSurfaceRegistry();
    registry.register(createConnection({ id: 'surface-a' }));
    registry.register(
      createConnection({
        id: 'surface-b',
        adapter: createMockAdapter({ failWith: new Error('boom') }),
      }),
    );

    const result = await registry.fanout(createEvent({ surfaceId: undefined }), [
      'surface-a',
      'surface-b',
    ]);

    expect(result.total).toBe(2);
    expect(result.delivered).toBe(1);
    expect(result.outcomes[1]).toMatchObject({
      surfaceId: 'surface-b',
      status: 'failed',
    });
  });

  it('throws on the first delivery failure when onError is abort', async () => {
    const registry = createSurfaceRegistry();
    registry.register(
      createConnection({
        id: 'surface-a',
        adapter: createMockAdapter({ failWith: new Error('boom') }),
      }),
    );
    registry.register(createConnection({ id: 'surface-b' }));

    await expect(
      registry.fanout(createEvent({ surfaceId: undefined }), ['surface-a', 'surface-b'], {
        onError: 'abort',
      }),
    ).rejects.toThrowError(SurfaceDeliveryError);
  });

  it('supports default fanout policy configuration', async () => {
    const registry = createSurfaceRegistry({
      defaultFanoutPolicy: {
        skipInactive: false,
      },
    });
    registry.register(createConnection({ id: 'surface-a', state: 'inactive' }));

    const result = await registry.fanout(createEvent({ surfaceId: undefined }), ['surface-a']);

    expect(result.outcomes).toEqual([{ surfaceId: 'surface-a', status: 'delivered' }]);
  });

  it('marks missing surfaces as skipped during fanout', async () => {
    const registry = createSurfaceRegistry();

    const result = await registry.fanout(createEvent({ surfaceId: undefined }), ['missing']);

    expect(result).toEqual({
      total: 1,
      delivered: 0,
      outcomes: [{ surfaceId: 'missing', status: 'skipped' }],
    });
  });
});
