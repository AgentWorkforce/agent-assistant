import { SessionConflictError, SessionNotFoundError, SessionStateError, } from './types.js';
const DEFAULT_TTL_MS = 3_600_000;
const DEFAULT_FIND_LIMIT = 50;
function cloneSession(value) {
    return structuredClone(value);
}
function nowIso() {
    return new Date().toISOString();
}
function normalizeLimit(limit) {
    return limit ?? DEFAULT_FIND_LIMIT;
}
function normalizeStateFilter(state) {
    if (!state) {
        return undefined;
    }
    return Array.isArray(state) ? state : [state];
}
function sortByRecentActivity(sessions) {
    return [...sessions].sort((left, right) => {
        return (Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt) ||
            Date.parse(right.createdAt) - Date.parse(left.createdAt));
    });
}
async function getRequiredSession(adapter, sessionId) {
    const session = await adapter.fetchById(sessionId);
    if (!session) {
        throw new SessionNotFoundError(sessionId);
    }
    return session;
}
export function createSessionStore(config) {
    const { adapter } = config;
    const defaultTtlMs = config.defaultTtlMs ?? DEFAULT_TTL_MS;
    return {
        async create(input) {
            const existing = await adapter.fetchById(input.id);
            if (existing) {
                throw new SessionConflictError(input.id);
            }
            const timestamp = nowIso();
            const session = {
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
        async get(sessionId) {
            return adapter.fetchById(sessionId);
        },
        async find(query) {
            return adapter.fetchMany({
                ...query,
                limit: normalizeLimit(query.limit),
            });
        },
        async touch(sessionId) {
            const session = await getRequiredSession(adapter, sessionId);
            if (session.state === 'expired') {
                throw new SessionStateError(sessionId, session.state, 'touch');
            }
            const timestamp = nowIso();
            const patch = {
                lastActivityAt: timestamp,
            };
            if (session.state === 'created' || session.state === 'suspended') {
                patch.state = 'active';
                patch.stateChangedAt = timestamp;
            }
            return adapter.update(sessionId, patch);
        },
        async attachSurface(sessionId, surfaceId) {
            const session = await getRequiredSession(adapter, sessionId);
            if (session.attachedSurfaces.includes(surfaceId)) {
                return session;
            }
            return adapter.update(sessionId, {
                attachedSurfaces: [...session.attachedSurfaces, surfaceId],
            });
        },
        async detachSurface(sessionId, surfaceId) {
            const session = await getRequiredSession(adapter, sessionId);
            if (!session.attachedSurfaces.includes(surfaceId)) {
                return session;
            }
            return adapter.update(sessionId, {
                attachedSurfaces: session.attachedSurfaces.filter((value) => value !== surfaceId),
            });
        },
        async expire(sessionId) {
            const session = await getRequiredSession(adapter, sessionId);
            if (session.state === 'expired') {
                return session;
            }
            return adapter.update(sessionId, {
                state: 'expired',
                stateChangedAt: nowIso(),
            });
        },
        async sweepStale(ttlMs) {
            const effectiveTtlMs = ttlMs ?? defaultTtlMs;
            const cutoff = Date.now() - effectiveTtlMs;
            const activeSessions = await adapter.fetchMany({
                state: 'active',
                limit: Number.MAX_SAFE_INTEGER,
            });
            const staleSessions = activeSessions.filter((session) => {
                return Date.parse(session.lastActivityAt) < cutoff;
            });
            const transitioned = [];
            for (const session of staleSessions) {
                transitioned.push(await adapter.update(session.id, {
                    state: 'suspended',
                    stateChangedAt: nowIso(),
                }));
            }
            return transitioned;
        },
        async updateMetadata(sessionId, metadata) {
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
export class InMemorySessionStoreAdapter {
    sessions = new Map();
    async insert(session) {
        if (this.sessions.has(session.id)) {
            throw new SessionConflictError(session.id);
        }
        this.sessions.set(session.id, cloneSession(session));
    }
    async fetchById(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? cloneSession(session) : null;
    }
    async fetchMany(query) {
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
    async update(sessionId, patch) {
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
    async delete(sessionId) {
        this.sessions.delete(sessionId);
    }
}
export async function resolveSession(message, store, resolver) {
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
export function defaultAffinityResolver(store) {
    return {
        async resolve(userId, surfaceId) {
            const sessions = sortByRecentActivity(await store.find({
                userId,
                state: ['active', 'suspended'],
                limit: DEFAULT_FIND_LIMIT,
            }));
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
