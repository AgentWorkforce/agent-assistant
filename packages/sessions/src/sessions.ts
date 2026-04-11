import {
  SessionConflictError,
  SessionNotFoundError,
  SessionStateError,
} from './types.js';
import type {
  AffinityResolver,
  CreateSessionInput,
  Session,
  SessionQuery,
  SessionResolvableMessage,
  SessionState,
  SessionStore,
  SessionStoreAdapter,
  SessionStoreConfig,
} from './types.js';

const DEFAULT_TTL_MS = 3_600_000;
const DEFAULT_FIND_LIMIT = 50;

function cloneSession<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeLimit(limit?: number): number {
  return limit ?? DEFAULT_FIND_LIMIT;
}

function normalizeStateFilter(
  state?: SessionState | SessionState[],
): SessionState[] | undefined {
  if (!state) {
    return undefined;
  }

  return Array.isArray(state) ? state : [state];
}

function sortByRecentActivity(sessions: Session[]): Session[] {
  return [...sessions].sort((left, right) => {
    return (
      Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt)
    );
  });
}

async function getRequiredSession(
  adapter: SessionStoreAdapter,
  sessionId: string,
): Promise<Session> {
  const session = await adapter.fetchById(sessionId);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  return session;
}

export function createSessionStore(config: SessionStoreConfig): SessionStore {
  const { adapter } = config;
  const defaultTtlMs = config.defaultTtlMs ?? DEFAULT_TTL_MS;

  return {
    async create(input: CreateSessionInput): Promise<Session> {
      const existing = await adapter.fetchById(input.id);
      if (existing) {
        throw new SessionConflictError(input.id);
      }

      const timestamp = nowIso();
      const session: Session = {
        id: input.id,
        userId: input.userId,
        workspaceId: input.workspaceId,
        state: 'created',
        createdAt: timestamp,
        lastActivityAt: timestamp,
        attachedSurfaces: input.initialSurfaceId ? [input.initialSurfaceId] : [],
        metadata: { ...(input.metadata ?? {}) },
      };

      await adapter.insert(session);
      return cloneSession(session);
    },

    async get(sessionId: string): Promise<Session | null> {
      return adapter.fetchById(sessionId);
    },

    async find(query: SessionQuery): Promise<Session[]> {
      return adapter.fetchMany({
        ...query,
        limit: normalizeLimit(query.limit),
      });
    },

    async touch(sessionId: string): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);
      if (session.state === 'expired') {
        throw new SessionStateError(sessionId, session.state, 'touch');
      }

      const timestamp = nowIso();
      const patch: Partial<Session> = {
        lastActivityAt: timestamp,
      };

      if (session.state === 'created' || session.state === 'suspended') {
        patch.state = 'active';
        patch.stateChangedAt = timestamp;
      }

      return adapter.update(sessionId, patch);
    },

    async attachSurface(sessionId: string, surfaceId: string): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);
      if (session.attachedSurfaces.includes(surfaceId)) {
        return session;
      }

      return adapter.update(sessionId, {
        attachedSurfaces: [...session.attachedSurfaces, surfaceId],
      });
    },

    async detachSurface(sessionId: string, surfaceId: string): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);
      if (!session.attachedSurfaces.includes(surfaceId)) {
        return session;
      }

      return adapter.update(sessionId, {
        attachedSurfaces: session.attachedSurfaces.filter((value) => value !== surfaceId),
      });
    },

    async expire(sessionId: string): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);
      if (session.state === 'expired') {
        return session;
      }

      return adapter.update(sessionId, {
        state: 'expired',
        stateChangedAt: nowIso(),
      });
    },

    async sweepStale(ttlMs: number): Promise<Session[]> {
      const effectiveTtlMs = ttlMs ?? defaultTtlMs;
      const cutoff = Date.now() - effectiveTtlMs;
      const activeSessions = await adapter.fetchMany({
        state: 'active',
        limit: Number.MAX_SAFE_INTEGER,
      });
      const staleSessions = activeSessions.filter((session) => {
        return Date.parse(session.lastActivityAt) < cutoff;
      });

      const transitioned: Session[] = [];
      for (const session of staleSessions) {
        transitioned.push(
          await adapter.update(session.id, {
            state: 'suspended',
            stateChangedAt: nowIso(),
          }),
        );
      }

      return transitioned;
    },

    async updateMetadata(
      sessionId: string,
      metadata: Record<string, unknown>,
    ): Promise<Session> {
      const session = await getRequiredSession(adapter, sessionId);

      return adapter.update(sessionId, {
        metadata: {
          ...session.metadata,
          ...metadata,
        },
      });
    },
  };
}

export class InMemorySessionStoreAdapter implements SessionStoreAdapter {
  private readonly sessions = new Map<string, Session>();

  async insert(session: Session): Promise<void> {
    if (this.sessions.has(session.id)) {
      throw new SessionConflictError(session.id);
    }

    this.sessions.set(session.id, cloneSession(session));
  }

  async fetchById(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    return session ? cloneSession(session) : null;
  }

  async fetchMany(query: SessionQuery): Promise<Session[]> {
    const states = normalizeStateFilter(query.state);
    const limit = normalizeLimit(query.limit);

    const matches = [...this.sessions.values()].filter((session) => {
      if (query.userId && session.userId !== query.userId) {
        return false;
      }

      if (query.workspaceId && session.workspaceId !== query.workspaceId) {
        return false;
      }

      if (states && !states.includes(session.state)) {
        return false;
      }

      if (query.surfaceId && !session.attachedSurfaces.includes(query.surfaceId)) {
        return false;
      }

      if (query.activeAfter && Date.parse(session.lastActivityAt) <= Date.parse(query.activeAfter)) {
        return false;
      }

      return true;
    });

    return matches.slice(0, limit).map((session) => cloneSession(session));
  }

  async update(sessionId: string, patch: Partial<Session>): Promise<Session> {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new SessionNotFoundError(sessionId);
    }

    const next = cloneSession({
      ...existing,
      ...patch,
    });
    this.sessions.set(sessionId, next);
    return cloneSession(next);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export async function resolveSession(
  message: SessionResolvableMessage,
  store: SessionStore,
  resolver: AffinityResolver,
): Promise<Session> {
  const existing = await resolver.resolve(message.userId, message.surfaceId);
  if (existing) {
    return store.touch(existing.id);
  }

  return store.create({
    id: globalThis.crypto.randomUUID(),
    userId: message.userId,
    workspaceId: message.workspaceId,
    initialSurfaceId: message.surfaceId,
  });
}

export function defaultAffinityResolver(store: SessionStore): AffinityResolver {
  return {
    async resolve(userId: string, surfaceId?: string): Promise<Session | null> {
      const sessions = sortByRecentActivity(
        await store.find({
          userId,
          state: ['active', 'suspended'],
          limit: DEFAULT_FIND_LIMIT,
        }),
      );

      if (surfaceId) {
        const attached = sessions.find((session) => session.attachedSurfaces.includes(surfaceId));
        if (attached) {
          return attached;
        }
      }

      return sessions[0] ?? null;
    },
  };
}
