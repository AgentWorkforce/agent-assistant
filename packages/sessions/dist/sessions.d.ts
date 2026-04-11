import type { AffinityResolver, Session, SessionQuery, SessionResolvableMessage, SessionStore, SessionStoreAdapter, SessionStoreConfig } from './types.js';
export declare function createSessionStore(config: SessionStoreConfig): SessionStore;
export declare class InMemorySessionStoreAdapter implements SessionStoreAdapter {
    private readonly sessions;
    insert(session: Session): Promise<void>;
    fetchById(sessionId: string): Promise<Session | null>;
    fetchMany(query: SessionQuery): Promise<Session[]>;
    update(sessionId: string, patch: Partial<Session>): Promise<Session>;
    delete(sessionId: string): Promise<void>;
}
export declare function resolveSession(message: SessionResolvableMessage, store: SessionStore, resolver: AffinityResolver): Promise<Session>;
export declare function defaultAffinityResolver(store: SessionStore): AffinityResolver;
