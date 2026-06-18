import type { Session, SessionQuery, SessionStoreAdapter } from '@agent-assistant/sessions';

// ─── Minimal Firestore interface types ────────────────────────────────────────
// Accepts real @google-cloud/firestore objects without importing the package.

export interface FirestoreDocSnapshot<T = unknown> {
  readonly exists: boolean;
  readonly id: string;
  data(): T | undefined;
}

export interface FirestoreQuerySnapshot<T = unknown> {
  readonly docs: ReadonlyArray<FirestoreDocSnapshot<T>>;
}

export interface FirestoreDocRef<T = unknown> {
  get(): Promise<FirestoreDocSnapshot<T>>;
  set(data: T): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
  create(data: T): Promise<unknown>;
}

export interface FirestoreQuery<T = unknown> {
  where(field: string, op: '==' | 'in' | 'array-contains', value: unknown): FirestoreQuery<T>;
  limit(n: number): FirestoreQuery<T>;
  get(): Promise<FirestoreQuerySnapshot<T>>;
}

export interface FirestoreCollectionLike<T = unknown> extends FirestoreQuery<T> {
  doc(id: string): FirestoreDocRef<T>;
}

export interface GcpFirestoreSessionStoreAdapterOptions {
  collection: FirestoreCollectionLike<Session>;
}

export class GcpFirestoreSessionStoreAdapter implements SessionStoreAdapter {
  private readonly col: FirestoreCollectionLike<Session>;

  constructor(options: GcpFirestoreSessionStoreAdapterOptions) {
    this.col = options.collection;
  }

  async insert(session: Session): Promise<void> {
    try {
      await this.col.doc(session.id).create(session);
    } catch (err) {
      if (isAlreadyExistsError(err)) {
        const conflict = new Error(`Session already exists: ${session.id}`) as Error & {
          name: string;
          sessionId: string;
        };
        conflict.name = 'SessionConflictError';
        conflict.sessionId = session.id;
        throw conflict;
      }
      throw err;
    }
  }

  async fetchById(sessionId: string): Promise<Session | null> {
    const snap = await this.col.doc(sessionId).get();
    return snap.exists ? (snap.data() as Session) : null;
  }

  async fetchMany(query: SessionQuery): Promise<Session[]> {
    // Anchor on the most selective indexed field then filter the rest in memory.
    // Firestore compound-index requirements mean we avoid stacking arbitrary
    // where() chains without knowing which indexes the consumer has created.
    let q: FirestoreQuery<Session> = this.col;

    if (query.userId) {
      q = q.where('userId', '==', query.userId);
    } else if (query.workspaceId) {
      q = q.where('workspaceId', '==', query.workspaceId);
    } else if (query.state && !Array.isArray(query.state)) {
      q = q.where('state', '==', query.state);
    }

    const snap = await q.get();
    let sessions = snap.docs.map((d) => d.data() as Session);
    sessions = this.applyFilters(sessions, query);
    if (query.limit != null) sessions = sessions.slice(0, query.limit);
    return sessions;
  }

  async update(sessionId: string, patch: Partial<Session>): Promise<Session> {
    const ref = this.col.doc(sessionId);
    const snap = await ref.get();
    if (!snap.exists) throw notFoundError(sessionId);
    await ref.update(patch as Record<string, unknown>);
    const updated = await ref.get();
    return updated.data() as Session;
  }

  async delete(sessionId: string): Promise<void> {
    await this.col.doc(sessionId).delete();
  }

  private applyFilters(sessions: Session[], query: SessionQuery): Session[] {
    return sessions.filter((s) => {
      if (query.userId && s.userId !== query.userId) return false;
      if (query.workspaceId && s.workspaceId !== query.workspaceId) return false;
      if (query.state) {
        const states = Array.isArray(query.state) ? query.state : [query.state];
        if (!states.includes(s.state)) return false;
      }
      if (query.surfaceId && !s.attachedSurfaces.includes(query.surfaceId)) return false;
      if (query.activeAfter && s.lastActivityAt <= query.activeAfter) return false;
      return true;
    });
  }
}

function notFoundError(sessionId: string): Error & { name: string; sessionId: string } {
  const err = new Error(`Session not found: ${sessionId}`) as Error & {
    name: string;
    sessionId: string;
  };
  err.name = 'SessionNotFoundError';
  err.sessionId = sessionId;
  return err;
}

function isAlreadyExistsError(err: unknown): boolean {
  if (err instanceof Error) {
    // @google-cloud/firestore throws gRPC status codes
    const code = (err as { code?: number }).code;
    return code === 6; // ALREADY_EXISTS
  }
  return false;
}
