import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemoryAdapter, InMemoryAdapter, SupermemoryAdapter } from './index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('vendored relay memory adapters', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults createMemoryAdapter to the in-memory adapter', async () => {
    const saved = process.env.AGENT_RELAY_MEMORY_TYPE;
    delete process.env.AGENT_RELAY_MEMORY_TYPE;
    try {
      const adapter = await createMemoryAdapter();
      expect(adapter).toBeInstanceOf(InMemoryAdapter);
    } finally {
      if (saved !== undefined) process.env.AGENT_RELAY_MEMORY_TYPE = saved;
    }
  });

  it('rejects unknown adapter types instead of silently using transient storage', async () => {
    await expect(createMemoryAdapter({ type: 'supermemroy' })).rejects.toThrow(
      'Unsupported memory adapter type: supermemroy',
    );
  });

  it('builds an adapter from explicit config when process is unavailable (Workers without nodejs_compat)', async () => {
    vi.stubGlobal('process', undefined);
    const adapter = await createMemoryAdapter({ type: 'inmemory' });
    vi.unstubAllGlobals();
    expect(adapter).toBeInstanceOf(InMemoryAdapter);
  });

  it('resolves fetch from globalThis at call time so stubs and Workers both work', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v3/documents/list')) return jsonResponse({ memories: [] });
      if (url.endsWith('/v3/documents')) return jsonResponse({ id: 'doc-1' });
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = await createMemoryAdapter({ type: 'supermemory', apiKey: 'test-key' });
    expect(adapter).toBeInstanceOf(SupermemoryAdapter);

    const result = await adapter.add('remember this', { agentId: 'agent-1' });

    expect(result).toEqual({ success: true, id: 'doc-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('consumes every response body, including ones callers never read', async () => {
    const responses: Response[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const response =
          init?.method === 'DELETE'
            ? jsonResponse({ deleted: true })
            : url.endsWith('/v3/documents/list')
              ? jsonResponse({ memories: [] })
              : jsonResponse({ error: 'not found' }, 404);
        responses.push(response);
        return response;
      }),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key' });
    await adapter.init();
    expect(await adapter.get('missing')).toBeNull();
    expect(await adapter.delete('doc-1')).toEqual({ success: true, id: 'doc-1' });

    expect(responses).toHaveLength(3);
    expect(responses.every((response) => response.bodyUsed)).toBe(true);
  });

  it('applies the timeout to reading the response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
          },
        });
        return new Response(body, { status: 200 });
      }),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key', timeout: 20 });
    await expect(adapter.list()).rejects.toThrow('aborted');
  });

  it('throws from list() instead of reporting an outage as an empty store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'boom' }, 500)),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key' });
    await expect(adapter.list({ agentId: 'agent-1' })).rejects.toThrow(/list failed \(500\)/);
  });

  it('list() speaks the documents/list contract: page/sort/order/includeContent in, memories out', async () => {
    const listBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        listBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({
          memories: [
            {
              id: 'doc-1',
              content: 'remember this',
              createdAt: '2026-01-01T00:00:00Z',
              metadata: { agentId: 'agent-1', projectId: 'project-1' },
            },
          ],
          pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
        });
      }),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key' });
    const entries = await adapter.list({ limit: 5, agentId: 'agent-1' });

    expect(listBodies).toEqual([
      {
        limit: 5,
        page: 1,
        sort: 'createdAt',
        order: 'desc',
        includeContent: true,
        filters: { AND: [{ key: 'agentId', value: 'agent-1' }] },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'doc-1',
      content: 'remember this',
      agentId: 'agent-1',
      projectId: 'project-1',
      createdAt: Date.parse('2026-01-01T00:00:00Z'),
    });
  });

  it('clear({ before }) on a container deletes only older memories, never the whole container', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        calls.push(`${init?.method} ${path}`);
        if (path === '/v3/documents/list') {
          return jsonResponse({
            memories: [
              { id: 'old', content: 'old', createdAt: '2026-01-01T00:00:00Z' },
              { id: 'new', content: 'new', createdAt: '2026-06-01T00:00:00Z' },
            ],
            pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
          });
        }
        return jsonResponse({ deleted: true });
      }),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key', container: 'team' });
    const result = await adapter.clear({ before: Date.parse('2026-03-01T00:00:00Z') });

    expect(result).toEqual({ success: true });
    expect(calls).toEqual(['POST /v3/documents/list', 'DELETE /v3/documents/old']);
  });

  it('clear() pages through every list page and reports failed deletes', async () => {
    const listBodies: Array<Record<string, unknown>> = [];
    const deleted: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === '/v3/documents/list') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          listBodies.push(body);
          const page = body.page as number;
          return jsonResponse({
            memories: [{ id: `doc-${page}`, content: String(page) }],
            pagination: { currentPage: page, totalPages: 2, totalItems: 2 },
          });
        }
        const id = path.split('/').pop()!;
        deleted.push(id);
        return id === 'doc-2' ? jsonResponse({ error: 'locked' }, 409) : jsonResponse({ deleted: true });
      }),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key' });
    const result = await adapter.clear({ agentId: 'agent-1' });

    expect(listBodies.map((body) => body.page)).toEqual([1, 2]);
    expect(deleted).toEqual(['doc-1', 'doc-2']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('doc-2');
  });

  it('get() returns null only for 404 and throws on other failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/missing')
          ? jsonResponse({ error: 'not found' }, 404)
          : jsonResponse({ error: 'unavailable' }, 503),
      ),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key' });
    await expect(adapter.get('missing')).resolves.toBeNull();
    await expect(adapter.get('doc-1')).rejects.toThrow(/get failed \(503\)/);
  });

  it('search() speaks the /v3/search contract and applies since/before', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          path: new URL(String(input)).pathname,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return jsonResponse({
          results: [
            { documentId: 'old', score: 0.9, createdAt: '2026-01-01T00:00:00Z', content: 'old', metadata: null },
            {
              documentId: 'mid',
              score: 0.8,
              createdAt: '2026-03-01T00:00:00Z',
              chunks: [{ content: 'part one' }, { content: 'part two' }],
              metadata: { agentId: 'agent-1' },
            },
            { documentId: 'new', score: 0.7, createdAt: '2026-06-01T00:00:00Z', content: 'new' },
          ],
          timing: 1,
          total: 3,
        });
      }),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key', container: 'team' });
    const entries = await adapter.search({
      query: 'notes',
      limit: 5,
      agentId: 'agent-1',
      since: Date.parse('2026-02-01T00:00:00Z'),
      before: Date.parse('2026-04-01T00:00:00Z'),
    });

    expect(requests).toEqual([
      {
        path: '/v3/search',
        body: {
          q: 'notes',
          limit: 5,
          documentThreshold: 0.5,
          includeFullDocs: true,
          filters: { AND: [{ key: 'agentId', value: 'agent-1' }] },
          containerTags: ['team'],
        },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'mid',
      content: 'part one\npart two',
      score: 0.8,
      agentId: 'agent-1',
      createdAt: Date.parse('2026-03-01T00:00:00Z'),
    });
  });
});

describe('vendored InMemoryAdapter', () => {
  it('matches regex metacharacters in search text literally', async () => {
    const adapter = new InMemoryAdapter();
    await adapter.add('I write C++ and (some) Rust');

    const results = await adapter.search({ query: 'C++ (some)' });

    expect(results).toHaveLength(1);
  });

  it('does not share tags or metadata with callers', async () => {
    const adapter = new InMemoryAdapter();
    const tags = ['a'];
    const metadata: Record<string, unknown> = { k: 'v' };
    const { id } = await adapter.add('hello', { tags, metadata });

    tags.push('mutated');
    metadata.k = 'mutated';
    const fetched = await adapter.get(id!);
    fetched!.tags!.push('mutated-again');
    fetched!.metadata!.k = 'mutated-again';
    (await adapter.list())[0].tags!.push('mutated-via-list');

    expect(await adapter.get(id!)).toMatchObject({ tags: ['a'], metadata: { k: 'v' } });
  });

  it('counts ids that collide with Object.prototype keys in stats()', async () => {
    const adapter = new InMemoryAdapter();
    await adapter.add('one', { agentId: '__proto__', projectId: 'constructor' });
    await adapter.add('two', { agentId: '__proto__', projectId: 'constructor' });

    const stats = await adapter.stats();

    expect(stats.byAgent?.['__proto__']).toBe(2);
    expect(stats.byProject?.['constructor']).toBe(2);
  });

  it('returns nothing for a blank query', async () => {
    const adapter = new InMemoryAdapter();
    await adapter.add('anything at all');

    expect(await adapter.search({ query: '   ' })).toEqual([]);
  });

  it('treats before: 0 as a real cutoff in clear()', async () => {
    const adapter = new InMemoryAdapter();
    await adapter.add('keep me');

    await adapter.clear({ before: 0 });

    expect(await adapter.list()).toHaveLength(1);
  });
});
