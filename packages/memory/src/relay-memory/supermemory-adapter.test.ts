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

  it('releases unread response bodies (404 get, successful delete)', async () => {
    const cancels: string[] = [];
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
        const body = response.body!;
        const cancel = body.cancel.bind(body);
        vi.spyOn(body, 'cancel').mockImplementation((reason) => {
          cancels.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
          return cancel(reason);
        });
        return response;
      }),
    );

    const adapter = new SupermemoryAdapter({ apiKey: 'test-key' });
    await adapter.init();
    expect(await adapter.get('missing')).toBeNull();
    expect(await adapter.delete('doc-1')).toEqual({ success: true, id: 'doc-1' });

    expect(cancels).toEqual([
      'POST /v3/documents/list',
      'GET /v3/documents/missing',
      'DELETE /v3/documents/doc-1',
    ]);
  });
});
