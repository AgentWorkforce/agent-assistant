import type { KVNamespace } from '@cloudflare/workers-types';
import type { Session, SessionConflictError, SessionNotFoundError, SessionQuery, SessionStoreAdapter } from '@agent-assistant/sessions';

const SESSION_KEY_PREFIX = 'session:';
const USER_INDEX_PREFIX = 'user:';
const WORKSPACE_INDEX_PREFIX = 'workspace:';

export interface CfKvSessionStoreAdapterOptions {
  kv: KVNamespace;
  /** Key prefix for all entries. Useful when the namespace is shared. Default: ''. */
  prefix?: string;
}

export class CfKvSessionStoreAdapter implements SessionStoreAdapter {
  private readonly kv: KVNamespace;
  private readonly prefix: string;

  constructor(options: CfKvSessionStoreAdapterOptions) {
    this.kv = options.kv;
    this.prefix = options.prefix ?? '';
  }

  async insert(session: Session): Promise<void> {
    const existing = await this.kv.get(this.sessionKey(session.id));
    if (existing !== null) {
      // Throw without importing the error class — same message shape the store expects.
      const err = new Error(`Session already exists: ${session.id}`) as Error & { name: string; sessionId: string };
      err.name = 'SessionConflictError';
      err.sessionId = session.id;
      throw err;
    }

    await Promise.all([
      this.kv.put(this.sessionKey(session.id), JSON.stringify(session)),
      this.addToIndex(this.userIndexKey(session.userId), session.id),
      session.workspaceId
        ? this.addToIndex(this.workspaceIndexKey(session.workspaceId), session.id)
        : Promise.resolve(),
    ]);
  }

  async fetchById(sessionId: string): Promise<Session | null> {
    const raw = await this.kv.get(this.sessionKey(sessionId));
    if (raw === null) return null;
    return JSON.parse(raw) as Session;
  }

  async fetchMany(query: SessionQuery): Promise<Session[]> {
    let sessions: Session[];

    if (query.userId) {
      sessions = await this.loadFromIndex(this.userIndexKey(query.userId));
    } else if (query.workspaceId) {
      sessions = await this.loadFromIndex(this.workspaceIndexKey(query.workspaceId));
    } else {
      sessions = await this.scanAll();
    }

    sessions = this.applyFilters(sessions, query);

    if (query.limit != null) {
      sessions = sessions.slice(0, query.limit);
    }

    return sessions;
  }

  async update(sessionId: string, patch: Partial<Session>): Promise<Session> {
    const existing = await this.fetchById(sessionId);
    if (!existing) {
      const err = new Error(`Session not found: ${sessionId}`) as Error & { name: string; sessionId: string };
      err.name = 'SessionNotFoundError';
      err.sessionId = sessionId;
      throw err;
    }

    const updated: Session = { ...existing, ...patch };

    const writes: Promise<void>[] = [
      this.kv.put(this.sessionKey(sessionId), JSON.stringify(updated)),
    ];

    if (patch.userId && patch.userId !== existing.userId) {
      writes.push(
        this.removeFromIndex(this.userIndexKey(existing.userId), sessionId),
        this.addToIndex(this.userIndexKey(patch.userId), sessionId),
      );
    }

    if ('workspaceId' in patch) {
      if (existing.workspaceId && patch.workspaceId !== existing.workspaceId) {
        writes.push(this.removeFromIndex(this.workspaceIndexKey(existing.workspaceId), sessionId));
      }
      if (patch.workspaceId) {
        writes.push(this.addToIndex(this.workspaceIndexKey(patch.workspaceId), sessionId));
      }
    }

    await Promise.all(writes);
    return updated;
  }

  async delete(sessionId: string): Promise<void> {
    const session = await this.fetchById(sessionId);
    if (!session) return;

    await Promise.all([
      this.kv.delete(this.sessionKey(sessionId)),
      this.removeFromIndex(this.userIndexKey(session.userId), sessionId),
      session.workspaceId
        ? this.removeFromIndex(this.workspaceIndexKey(session.workspaceId), sessionId)
        : Promise.resolve(),
    ]);
  }

  // ─── Index helpers ──────────────────────────────────────────────────────────

  private async loadFromIndex(indexKey: string): Promise<Session[]> {
    const raw = await this.kv.get(indexKey);
    if (!raw) return [];
    const ids = JSON.parse(raw) as string[];
    const sessions = await Promise.all(ids.map((id) => this.fetchById(id)));
    return sessions.filter((s): s is Session => s !== null);
  }

  private async addToIndex(indexKey: string, sessionId: string): Promise<void> {
    const raw = await this.kv.get(indexKey);
    const ids: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!ids.includes(sessionId)) {
      ids.push(sessionId);
      await this.kv.put(indexKey, JSON.stringify(ids));
    }
  }

  private async removeFromIndex(indexKey: string, sessionId: string): Promise<void> {
    const raw = await this.kv.get(indexKey);
    if (!raw) return;
    const ids = (JSON.parse(raw) as string[]).filter((id) => id !== sessionId);
    if (ids.length === 0) {
      await this.kv.delete(indexKey);
    } else {
      await this.kv.put(indexKey, JSON.stringify(ids));
    }
  }

  private async scanAll(): Promise<Session[]> {
    const listed = await this.kv.list({ prefix: `${this.prefix}${SESSION_KEY_PREFIX}` });
    const sessions = await Promise.all(
      listed.keys.map((key) => this.kv.get(key.name).then((raw) => (raw ? (JSON.parse(raw) as Session) : null))),
    );
    return sessions.filter((s): s is Session => s !== null);
  }

  private applyFilters(sessions: Session[], query: SessionQuery): Session[] {
    return sessions.filter((s) => {
      if (query.workspaceId && s.workspaceId !== query.workspaceId) return false;
      if (query.userId && s.userId !== query.userId) return false;
      if (query.state) {
        const states = Array.isArray(query.state) ? query.state : [query.state];
        if (!states.includes(s.state)) return false;
      }
      if (query.surfaceId && !s.attachedSurfaces.includes(query.surfaceId)) return false;
      if (query.activeAfter && s.lastActivityAt <= query.activeAfter) return false;
      return true;
    });
  }

  // ─── Key builders ───────────────────────────────────────────────────────────

  private sessionKey(id: string): string {
    return `${this.prefix}${SESSION_KEY_PREFIX}${id}`;
  }

  private userIndexKey(userId: string): string {
    return `${this.prefix}${USER_INDEX_PREFIX}${userId}:sessions`;
  }

  private workspaceIndexKey(workspaceId: string): string {
    return `${this.prefix}${WORKSPACE_INDEX_PREFIX}${workspaceId}:sessions`;
  }
}
