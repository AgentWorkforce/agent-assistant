import {
  SessionConflictError,
  SessionNotFoundError,
  SessionStateError,
} from './types.js';
import type {
  AffinityResolver,
  CtxFilesToRuntimeSessionStoreAdapterOptions,
  CreateSessionInput,
  RuntimeCtxFiles,
  RuntimeSessionStoreAdapterOptions,
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
const DEFAULT_RUNTIME_PREFIX = '/agent-assistant/sessions';

function cloneSession<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeLimit(limit?: number): number {
  return limit ?? DEFAULT_FIND_LIMIT;
}

function normalizeCtxReadResult(
  value: string | { body?: string | null; content?: string | null } | null,
): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (!value) {
    return null;
  }
  if (typeof value.body === 'string') {
    return value.body;
  }
  if (typeof value.content === 'string') {
    return value.content;
  }
  return null;
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

export class RuntimeSessionStoreAdapter implements SessionStoreAdapter {
  private readonly prefix: string;

  constructor(private readonly options: RuntimeSessionStoreAdapterOptions) {
    this.prefix = normalizePrefix(options.prefix);
  }

  async insert(session: Session): Promise<void> {
    try {
      if (this.options.insert) {
        await this.options.insert(this.pathFor(session.id), JSON.stringify(session));
        return;
      }

      const existing = await this.fetchById(session.id);
      if (existing) {
        throw new SessionConflictError(session.id);
      }
      await this.writeSession(session);
    } catch (error) {
      if (error instanceof SessionConflictError || isAlreadyExistsError(error)) {
        throw new SessionConflictError(session.id);
      }
      throw error;
    }
  }

  async fetchById(sessionId: string): Promise<Session | null> {
    return this.readSession(this.pathFor(sessionId));
  }

  async fetchMany(query: SessionQuery): Promise<Session[]> {
    const states = normalizeStateFilter(query.state);
    const limit = normalizeLimit(query.limit);
    const paths = await this.options.list(this.prefix);
    const sessions = await Promise.all(paths.map((path) => this.readSession(path)));
    const matches = sessions
      .filter((session): session is Session => Boolean(session))
      .filter((session) => {
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

    return sortByRecentActivity(matches).slice(0, limit).map((session) => cloneSession(session));
  }

  async update(sessionId: string, patch: Partial<Session>): Promise<Session> {
    const existing = await this.fetchById(sessionId);
    if (!existing) {
      throw new SessionNotFoundError(sessionId);
    }

    const next = cloneSession({
      ...existing,
      ...patch,
    });
    await this.writeSession(next);
    return cloneSession(next);
  }

  async delete(sessionId: string): Promise<void> {
    await this.options.delete(this.pathFor(sessionId));
  }

  private pathFor(sessionId: string): string {
    return `${this.prefix}/${encodeURIComponent(sessionId)}.json`;
  }

  private async readSession(path: string): Promise<Session | null> {
    const body = await this.options.read(path);
    if (!body) {
      return null;
    }

    try {
      const session = JSON.parse(body) as Session;
      return cloneSession(session);
    } catch (error) {
      await this.options.onCorruptRecord?.({ path, body, error });
      return null;
    }
  }

  private async writeSession(session: Session): Promise<void> {
    await this.options.write(this.pathFor(session.id), JSON.stringify(session));
  }
}

export function ctxFilesToRuntimeSessionStoreAdapterOptions(
  files: RuntimeCtxFiles,
  options: CtxFilesToRuntimeSessionStoreAdapterOptions = {},
): RuntimeSessionStoreAdapterOptions {
  const signal = options.signal;
  return {
    prefix: options.prefix,
    async read(path) {
      const result = await files.read(path, { signal });
      return normalizeCtxReadResult(result);
    },
    async write(path, body) {
      await files.write(path, body, { signal });
    },
    async delete(path) {
      await files.delete(path, { signal });
    },
    async list(prefix) {
      const entries = await files.list(`${prefix}/**`, { signal });
      return entries
        .map((entry) => (typeof entry === 'string' ? entry : entry.path))
        .filter((path): path is string => typeof path === 'string' && path.length > 0);
    },
  };
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

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeCode = 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (typeof maybeCode === 'string') {
    const normalized = maybeCode.toLowerCase();
    if (normalized === 'already_exists' || normalized === 'alreadyexists' || normalized === 'eexist') {
      return true;
    }
  }

  const maybeMessage = 'message' in error ? (error as { message?: unknown }).message : undefined;
  return typeof maybeMessage === 'string' && /already exists|eexist/i.test(maybeMessage);
}

function normalizePrefix(prefix: string | undefined): string {
  const trimmed = prefix?.trim();
  if (!trimmed) {
    return DEFAULT_RUNTIME_PREFIX;
  }
  return trimmed.replace(/\/+$/, '');
}
