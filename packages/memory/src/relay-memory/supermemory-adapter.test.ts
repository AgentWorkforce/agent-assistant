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
    const adapter = await createMemoryAdapter({ type: 'inmemory' });
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

  it('clear({ before }) on a container deletes only older memories, never the whole container', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        calls.push(`${init?.method} ${path}`);
        if (path === '/v3/documents/list') {
          return jsonResponse({
            documents: [
              { id: 'old', content: 'old', createdAt: '2026-01-01T00:00:00Z' },
              { id: 'new', content: 'new', createdAt: '2026-06-01T00:00:00Z' },
            ],
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
          return body.cursor === 'page-2'
            ? jsonResponse({ documents: [{ id: 'doc-2', content: 'b' }], hasMore: false })
            : jsonResponse({ documents: [{ id: 'doc-1', content: 'a' }], hasMore: true, cursor: 'page-2' });
        }
        const id = path.split('/').pop()!;
        deleted.push(id);
        return id === 'doc-2' ? jsonResponse({ error: 'locked' }, 409) : jsonResponse({ deleted: true });
      }),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key' });
    const result = await adapter.clear({ agentId: 'agent-1' });

    expect(listBodies.map((body) => body.cursor)).toEqual([undefined, 'page-2']);
    expect(deleted).toEqual(['doc-1', 'doc-2']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('doc-2');
  });
});
