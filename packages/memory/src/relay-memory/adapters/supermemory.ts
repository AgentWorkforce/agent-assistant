/**
 * Vendored from @agent-relay/memory 7.1.1 (AgentWorkforce/proactive, packages/memory/src).
 * That package can no longer be released and still depends on the deleted
 * @agent-relay/hooks, which pulls @agent-relay/sdk 7 and zod 3 into every consumer.
 * Only the adapter layer this package uses lives here.
 */

/**
 * Supermemory.ai Memory Adapter
 *
 * Integration with supermemory.ai for semantic memory storage and retrieval.
 * Provides AI-optimized search with embedding-based similarity.
 *
 * @see https://supermemory.ai/docs
 */

import type {
  MemoryAdapter,
  MemoryEntry,
  MemorySearchQuery,
  AddMemoryOptions,
  MemoryResult,
} from '../types.js';

/**
 * Options for the Supermemory adapter
 */
export interface SupermemoryAdapterOptions {
  /** API key for supermemory.ai (required) */
  apiKey: string;
  /** API endpoint (default: https://api.supermemory.ai) */
  endpoint?: string;
  /** Container/namespace for memories (optional) */
  container?: string;
  /** Default agent ID */
  defaultAgentId?: string;
  /** Default project ID */
  defaultProjectId?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Supermemory API response types
 */
interface SupermemoryDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

interface SupermemorySearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

interface SupermemoryListResponse {
  documents: SupermemoryDocument[];
  hasMore?: boolean;
  cursor?: string;
}

/**
 * Supermemory.ai adapter for semantic memory storage
 */
export class SupermemoryAdapter implements MemoryAdapter {
  readonly type = 'supermemory';

  private apiKey: string;
  private endpoint: string;
  private container?: string;
  private defaultAgentId?: string;
  private defaultProjectId?: string;
  private timeout: number;
  private initialized = false;

  constructor(options: SupermemoryAdapterOptions) {
    if (!options.apiKey) {
      throw new Error('SupermemoryAdapter requires an API key');
    }

    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? 'https://api.supermemory.ai';
    this.container = options.container;
    this.defaultAgentId = options.defaultAgentId;
    this.defaultProjectId = options.defaultProjectId;
    this.timeout = options.timeout ?? 30000;
  }

  async init(): Promise<void> {
    // Verify API key by making a simple request
    try {
      const response = await this.fetch('/v3/documents/list', {
        method: 'POST',
        body: JSON.stringify({ limit: 1 }),
      });

      if (!response.ok && response.status !== 404) {
        const error = await response.text();
        throw new Error(`Supermemory API error: ${error}`);
      }

      this.initialized = true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('fetch')) {
        throw new Error(`Failed to connect to Supermemory API: ${error.message}`);
      }
      throw error;
    }
  }

  async add(content: string, options?: AddMemoryOptions): Promise<MemoryResult> {
    try {
      const metadata: Record<string, unknown> = {
        source: options?.source ?? 'agent-relay',
        agentId: options?.agentId ?? this.defaultAgentId,
        projectId: options?.projectId ?? this.defaultProjectId,
        sessionId: options?.sessionId,
        tags: options?.tags,
        ...options?.metadata,
      };

      // Remove undefined values
      Object.keys(metadata).forEach((key) => {
        if (metadata[key] === undefined) {
          delete metadata[key];
        }
      });

      const body: Record<string, unknown> = {
        content,
        metadata,
      };

      if (this.container) {
        body.containerTags = [this.container];
      }

      const response = await this.fetch('/v3/documents', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Failed to add memory: ${error}` };
      }

      const result = (await response.json()) as { id?: string; documentId?: string };
      return { success: true, id: result.id ?? result.documentId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async search(query: MemorySearchQuery): Promise<MemoryEntry[]> {
    try {
      const filterConditions: Array<{ key: string; value: unknown }> = [];

      if (query.agentId) {
        filterConditions.push({ key: 'agentId', value: query.agentId });
      }
      if (query.projectId) {
        filterConditions.push({ key: 'projectId', value: query.projectId });
      }
      if (query.tags && query.tags.length > 0) {
        filterConditions.push({ key: 'tags', value: query.tags });
      }

      const body: Record<string, unknown> = {
        query: query.query,
        limit: query.limit ?? 10,
        minScore: query.minScore ?? 0.5,
      };

      if (filterConditions.length > 0) {
        body.filters = { AND: filterConditions };
      }

      if (this.container) {
        body.containerTags = [this.container];
      }

      // Use v4 search for lower latency
      const response = await this.fetch('/v4/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        console.error('[supermemory] Search failed:', await response.text());
        return [];
      }

      const result = (await response.json()) as { results?: SupermemorySearchResult[] };
      const results = result.results ?? [];

      return results.map((doc) => this.documentToMemoryEntry(doc));
    } catch (error) {
      console.error('[supermemory] Search error:', error);
      return [];
    }
  }

  async get(id: string): Promise<MemoryEntry | null> {
    try {
      const response = await this.fetch(`/v3/documents/${encodeURIComponent(id)}`, {
        method: 'GET',
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        console.error('[supermemory] Get failed:', await response.text());
        return null;
      }

      const doc = (await response.json()) as SupermemoryDocument;
      return this.documentToMemoryEntry(doc);
    } catch (error) {
      console.error('[supermemory] Get error:', error);
      return null;
    }
  }

  async delete(id: string): Promise<MemoryResult> {
    try {
      const response = await this.fetch(`/v3/documents/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      if (!response.ok && response.status !== 404) {
        const error = await response.text();
        return { success: false, error: `Failed to delete: ${error}` };
      }

      return { success: true, id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async update(id: string, content: string, options?: Partial<AddMemoryOptions>): Promise<MemoryResult> {
    try {
      const body: Record<string, unknown> = { content };

      if (options) {
        const metadata: Record<string, unknown> = {};
        if (options.tags) metadata.tags = options.tags;
        if (options.metadata) Object.assign(metadata, options.metadata);
        if (Object.keys(metadata).length > 0) {
          body.metadata = metadata;
        }
      }

      const response = await this.fetch(`/v3/documents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Failed to update: ${error}` };
      }

      return { success: true, id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * List memories, newest first. Throws on transport, HTTP or parse failure so
   * callers cannot mistake an outage for an empty store.
   */
  async list(options?: { limit?: number; agentId?: string; projectId?: string }): Promise<MemoryEntry[]> {
    const page = await this.listPage(options);
    return page.entries;
  }

  private async listPage(options?: {
    limit?: number;
    agentId?: string;
    projectId?: string;
    cursor?: string;
  }): Promise<{ entries: MemoryEntry[]; hasMore: boolean; cursor?: string }> {
    const body: Record<string, unknown> = {
      limit: options?.limit ?? 50,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };

    const filterConditions: Array<{ key: string; value: unknown }> = [];
    if (options?.agentId) filterConditions.push({ key: 'agentId', value: options.agentId });
    if (options?.projectId) filterConditions.push({ key: 'projectId', value: options.projectId });

    if (filterConditions.length > 0) {
      body.filters = { AND: filterConditions };
    }

    if (this.container) {
      body.containerTags = [this.container];
    }

    if (options?.cursor) {
      body.cursor = options.cursor;
    }

    const response = await this.fetch('/v3/documents/list', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Supermemory list failed (${response.status}): ${await response.text()}`);
    }

    const result = (await response.json()) as SupermemoryListResponse;
    return {
      entries: (result.documents ?? []).map((doc) => this.documentToMemoryEntry(doc)),
      hasMore: result.hasMore === true && typeof result.cursor === 'string' && result.cursor !== '',
      cursor: result.cursor,
    };
  }

  async clear(options?: { agentId?: string; projectId?: string; before?: number }): Promise<MemoryResult> {
    try {
      // Bulk delete only filters by container tag, so it is safe only when the
      // caller asked to clear the whole container.
      if (!options?.agentId && !options?.projectId && options?.before === undefined && this.container) {
        const response = await this.fetch('/v3/documents/bulk', {
          method: 'DELETE',
          body: JSON.stringify({ containerTags: [this.container] }),
        });

        if (!response.ok) {
          return { success: false, error: await response.text() };
        }
        return { success: true };
      }

      // Enumerate every matching page before deleting so deletes cannot shift
      // the cursor under us.
      const toDelete: MemoryEntry[] = [];
      const seenIds = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      for (;;) {
        const page = await this.listPage({
          limit: 1000,
          agentId: options?.agentId,
          projectId: options?.projectId,
          cursor,
        });
        for (const memory of page.entries) {
          if (seenIds.has(memory.id)) continue;
          seenIds.add(memory.id);
          if (options?.before === undefined || memory.createdAt < options.before) {
            toDelete.push(memory);
          }
        }
        if (!page.hasMore || !page.cursor || seenCursors.has(page.cursor)) break;
        seenCursors.add(page.cursor);
        cursor = page.cursor;
      }

      const failures: string[] = [];
      for (const memory of toDelete) {
        const result = await this.delete(memory.id);
        if (!result.success) failures.push(`${memory.id}: ${result.error ?? 'unknown error'}`);
      }

      if (failures.length > 0) {
        return {
          success: false,
          error: `Failed to delete ${failures.length} of ${toDelete.length} memories: ${failures.join('; ')}`,
        };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async stats(): Promise<{
    totalCount: number;
    byAgent?: Record<string, number>;
    byProject?: Record<string, number>;
  }> {
    // Supermemory doesn't have a stats endpoint, so we approximate
    const memories = await this.list({ limit: 1000 });

    const byAgent: Record<string, number> = {};
    const byProject: Record<string, number> = {};

    for (const memory of memories) {
      if (memory.agentId) {
        byAgent[memory.agentId] = (byAgent[memory.agentId] ?? 0) + 1;
      }
      if (memory.projectId) {
        byProject[memory.projectId] = (byProject[memory.projectId] ?? 0) + 1;
      }
    }

    return {
      totalCount: memories.length,
      byAgent,
      byProject,
    };
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Make a fetch request to the Supermemory API.
   *
   * The body is read inside the timeout so a stalled body cannot hang the
   * caller, and so every response body is consumed (Cloudflare Workers caps
   * concurrent outbound requests and unread bodies hold their slot open).
   * Callers get a buffered Response they can read as usual.
   */
  private async fetch(path: string, options: RequestInit): Promise<Response> {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await globalThis.fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...options.headers,
        },
        signal: controller.signal,
      });
      const text = await response.text();

      return new Response(NULL_BODY_STATUSES.has(response.status) ? null : text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Convert a Supermemory document to a MemoryEntry
   */
  private documentToMemoryEntry(doc: SupermemoryDocument | SupermemorySearchResult): MemoryEntry {
    const metadata = doc.metadata ?? {};

    return {
      id: doc.id,
      content: doc.content,
      createdAt: (doc as SupermemoryDocument).createdAt
        ? new Date((doc as SupermemoryDocument).createdAt!).getTime()
        : Date.now(),
      tags: metadata.tags as string[] | undefined,
      source: metadata.source as string | undefined,
      agentId: metadata.agentId as string | undefined,
      projectId: metadata.projectId as string | undefined,
      sessionId: metadata.sessionId as string | undefined,
      score: (doc as SupermemorySearchResult).score,
      metadata,
    };
  }
}

/** Statuses whose Response must be constructed without a body. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
