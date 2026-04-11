import {
  SurfaceConflictError,
  SurfaceDeliveryError,
  SurfaceNotFoundError,
} from './types.js';
import type {
  FanoutOutcome,
  FanoutPolicy,
  FanoutResult,
  NormalizedInboundMessage,
  SurfaceConnection,
  SurfaceOutboundEvent,
  SurfaceRegistry,
  SurfaceRegistryConfig,
} from './types.js';

type CoreInboundAdapterShape = {
  onMessage(handler: (message: NormalizedInboundMessage) => void): void;
  offMessage(handler: (message: NormalizedInboundMessage) => void): void;
};

type CoreOutboundAdapterShape = {
  send(event: SurfaceOutboundEvent): Promise<void>;
  fanout?(event: SurfaceOutboundEvent, attachedSurfaceIds: string[]): Promise<void>;
};

export function createSurfaceRegistry(
  config: SurfaceRegistryConfig = {},
): SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape {
  const connections = new Map<string, SurfaceConnection>();
  const messageHandlers = new Set<(message: NormalizedInboundMessage) => void>();
  const defaultPolicy: Required<FanoutPolicy> = {
    onError: config.defaultFanoutPolicy?.onError ?? 'continue',
    skipInactive: config.defaultFanoutPolicy?.skipInactive ?? true,
  };

  const registry: SurfaceRegistry = {
    register(connection) {
      if (connections.has(connection.id)) {
        throw new SurfaceConflictError(connection.id);
      }

      connections.set(connection.id, connection);
      connection.adapter.onConnect(() => {
        connection.state = 'active';
      });
      connection.adapter.onDisconnect(() => {
        connection.state = 'inactive';
      });
    },

    unregister(surfaceId) {
      connections.delete(surfaceId);
    },

    get(surfaceId) {
      return connections.get(surfaceId) ?? null;
    },

    list(filter = {}) {
      return [...connections.values()].filter((connection) => {
        if (filter.state && connection.state !== filter.state) {
          return false;
        }

        if (filter.type && connection.type !== filter.type) {
          return false;
        }

        return true;
      });
    },

    async send(event) {
      const surfaceId = event.surfaceId ?? '';
      if (!surfaceId) {
        throw new SurfaceNotFoundError(surfaceId);
      }

      const connection = connections.get(surfaceId);
      if (!connection) {
        throw new SurfaceNotFoundError(surfaceId);
      }

      try {
        const formatted = connection.formatHook
          ? await connection.formatHook(event, connection.capabilities)
          : event.text;

        await connection.adapter.send({
          event,
          formatted,
          surfaceCapabilities: connection.capabilities,
        });
      } catch (error) {
        throw new SurfaceDeliveryError(surfaceId, toError(error));
      }
    },

    async fanout(event, attachedSurfaceIds, policy = {}) {
      const mergedPolicy: Required<FanoutPolicy> = {
        onError: policy.onError ?? defaultPolicy.onError,
        skipInactive: policy.skipInactive ?? defaultPolicy.skipInactive,
      };

      if (mergedPolicy.onError === 'abort') {
        const outcomes: FanoutOutcome[] = [];
        let delivered = 0;

        for (const surfaceId of attachedSurfaceIds) {
          const connection = connections.get(surfaceId);
          if (!connection) {
            outcomes.push({ surfaceId, status: 'skipped' });
            continue;
          }

          if (connection.state === 'inactive' && mergedPolicy.skipInactive) {
            outcomes.push({ surfaceId, status: 'skipped' });
            continue;
          }

          try {
            await registry.send({ ...event, surfaceId });
            outcomes.push({ surfaceId, status: 'delivered' });
            delivered += 1;
          } catch (error) {
            if (error instanceof SurfaceDeliveryError) {
              throw error;
            }

            throw new SurfaceDeliveryError(surfaceId, toError(error));
          }
        }

        return {
          total: attachedSurfaceIds.length,
          delivered,
          outcomes,
        };
      }

      const outcomes = await Promise.all(
        attachedSurfaceIds.map(async (surfaceId): Promise<FanoutOutcome> => {
          const connection = connections.get(surfaceId);
          if (!connection) {
            return { surfaceId, status: 'skipped' };
          }

          if (connection.state === 'inactive' && mergedPolicy.skipInactive) {
            return { surfaceId, status: 'skipped' };
          }

          try {
            await registry.send({ ...event, surfaceId });
            return { surfaceId, status: 'delivered' };
          } catch (error) {
            return {
              surfaceId,
              status: 'failed',
              error: error instanceof Error ? error : toError(error),
            };
          }
        }),
      );

      return {
        total: attachedSurfaceIds.length,
        delivered: outcomes.filter((outcome) => outcome.status === 'delivered').length,
        outcomes,
      };
    },

    receiveRaw(surfaceId, raw) {
      const normalized = config.normalizationHook
        ? config.normalizationHook(surfaceId, raw) ?? null
        : normalizeRawEvent(surfaceId, raw);

      if (!normalized) {
        return;
      }

      for (const handler of messageHandlers) {
        handler(normalized);
      }
    },

    onMessage(handler) {
      messageHandlers.add(handler);
    },

    offMessage(handler) {
      messageHandlers.delete(handler);
    },
  };

  return registry as SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape;
}

function normalizeRawEvent(
  surfaceId: string,
  raw: unknown,
): NormalizedInboundMessage | null {
  if (!surfaceId) {
    console.error('Dropping inbound message because surfaceId is missing');
    return null;
  }

  if (!isRecord(raw)) {
    console.error('Dropping inbound message because raw payload is not an object', {
      surfaceId,
    });
    return null;
  }

  const messageId = getString(raw.messageId) ?? getString(raw.id) ?? crypto.randomUUID();
  const sessionId = getString(raw.sessionId) ?? getNestedString(raw.session, 'id');
  const userId =
    getString(raw.userId) ??
    getNestedString(raw.user, 'id') ??
    (typeof raw.user === 'string' ? raw.user : undefined);
  const workspaceId = getString(raw.workspaceId) ?? getNestedString(raw.workspace, 'id');
  const text = getString(raw.text) ?? getString(raw.content) ?? getString(raw.body) ?? '';
  const receivedAt =
    getString(raw.timestamp) ?? getString(raw.receivedAt) ?? new Date().toISOString();
  const capability = getString(raw.capability) ?? getString(raw.type) ?? 'chat';

  if (!userId) {
    console.error('Dropping inbound message because userId is missing', {
      surfaceId,
      messageId,
    });
    return null;
  }

  if (text.length === 0) {
    console.warn('Inbound message text missing; using empty string', {
      surfaceId,
      messageId,
    });
  }

  return {
    id: messageId,
    surfaceId,
    sessionId,
    userId,
    workspaceId,
    text,
    raw,
    receivedAt,
    capability,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getNestedString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return getString(value[key]);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
