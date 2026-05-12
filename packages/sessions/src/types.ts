export interface Session {
  id: string;
  userId: string;
  workspaceId?: string;
  state: SessionState;
  createdAt: string;
  lastActivityAt: string;
  stateChangedAt?: string;
  attachedSurfaces: string[];
  metadata: Record<string, unknown>;
}

export type SessionState = 'created' | 'active' | 'suspended' | 'expired';

export interface SessionStore {
  create(input: CreateSessionInput): Promise<Session>;
  get(sessionId: string): Promise<Session | null>;
  find(query: SessionQuery): Promise<Session[]>;
  touch(sessionId: string): Promise<Session>;
  attachSurface(sessionId: string, surfaceId: string): Promise<Session>;
  detachSurface(sessionId: string, surfaceId: string): Promise<Session>;
  expire(sessionId: string): Promise<Session>;
  sweepStale(ttlMs: number): Promise<Session[]>;
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<Session>;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  workspaceId?: string;
  initialSurfaceId?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionQuery {
  userId?: string;
  workspaceId?: string;
  state?: SessionState | SessionState[];
  surfaceId?: string;
  activeAfter?: string;
  limit?: number;
}

export interface SessionStoreAdapter {
  insert(session: Session): Promise<void>;
  fetchById(sessionId: string): Promise<Session | null>;
  fetchMany(query: SessionQuery): Promise<Session[]>;
  update(sessionId: string, patch: Partial<Session>): Promise<Session>;
  delete(sessionId: string): Promise<void>;
}

export interface RuntimeSessionStoreAdapterOptions {
  read(path: string): Promise<string | null>;
  write(path: string, body: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  insert?(path: string, body: string): Promise<void>;
  onCorruptRecord?(record: { path: string; body: string; error: unknown }): void | Promise<void>;
  prefix?: string;
}

export interface RuntimeCtxFileRecord {
  path: string;
  body?: string | null;
  content?: string | null;
}

export interface RuntimeCtxFiles {
  read(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | RuntimeCtxFileRecord | null>;
  write(
    path: string,
    body: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  delete(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  list(
    glob: string,
    options?: { signal?: AbortSignal },
  ): Promise<Array<string | { path: string }>>;
}

export interface CtxFilesToRuntimeSessionStoreAdapterOptions {
  signal?: AbortSignal;
  prefix?: string;
}

export interface AffinityResolver {
  resolve(userId: string, surfaceId?: string): Promise<Session | null>;
}

export interface SessionStoreConfig {
  adapter: SessionStoreAdapter;
  defaultTtlMs?: number;
}

export interface SessionResolvableMessage {
  userId: string;
  workspaceId?: string;
  surfaceId: string;
}

export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionConflictError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session already exists: ${sessionId}`);
    this.name = 'SessionConflictError';
  }
}

export class SessionStateError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly currentState: SessionState,
    public readonly attemptedTransition: string,
  ) {
    super(
      `Invalid transition '${attemptedTransition}' from state '${currentState}' for session ${sessionId}`,
    );
    this.name = 'SessionStateError';
  }
}
