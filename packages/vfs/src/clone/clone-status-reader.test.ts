import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloneStatusReader } from './clone-status-reader.js';

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
    ...init,
  });
}

function createReader(options?: {
  cacheTtlMs?: number;
  fetch?: typeof globalThis.fetch;
  onEvent?: (event: {
    event: string;
    state?: string;
    ms?: number;
    reason?: string;
  }) => void;
}) {
  return new CloneStatusReader({
    baseUrl: 'https://clone.example.test',
    bearerToken: 'test-token',
    cacheTtlMs: options?.cacheTtlMs,
    fetch: options?.fetch,
    onEvent: options?.onEvent,
  });
}

describe('CloneStatusReader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('statusForRepo hits /by-repo with query params', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ state: 'no_jobs' }));
    const reader = createReader({ fetch: fetchMock as typeof globalThis.fetch });

    await reader.statusForRepo('workspace-123', 'openai', 'sage');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain(
      '/api/v1/github/clone/status/by-repo?workspaceId=workspace-123&owner=openai&repo=sage',
    );
    expect(init).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer test-token',
      }),
    });
  });

  it('state=succeeded returns CloneJobStatus', async () => {
    const payload = {
      jobId: 'job-123',
      state: 'succeeded',
      completedAt: '2026-05-02T10:00:00.000Z',
      headSha: 'abc123def456',
    };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    const reader = createReader({ fetch: fetchMock as typeof globalThis.fetch });

    const result = await reader.statusForRepo('workspace-123', 'openai', 'sage');

    expect(result).toEqual(payload);
  });

  it('state=no_jobs returns null', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ state: 'no_jobs' }));
    const reader = createReader({ fetch: fetchMock as typeof globalThis.fetch });

    const result = await reader.statusForRepo('workspace-123', 'openai', 'sage');

    expect(result).toBeNull();
  });

  it('cache TTL avoids second network call', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00.000Z'));

    const payload = {
      jobId: 'job-123',
      state: 'running',
      startedAt: '2026-05-02T11:59:00.000Z',
    };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    const reader = createReader({
      cacheTtlMs: 1_000,
      fetch: fetchMock as typeof globalThis.fetch,
    });

    await reader.statusForRepo('workspace-123', 'openai', 'sage');
    await reader.statusForRepo('workspace-123', 'openai', 'sage');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_001);

    await reader.statusForRepo('workspace-123', 'openai', 'sage');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidate evicts from cache', async () => {
    const payload = {
      jobId: 'job-123',
      state: 'queued',
      queuedAt: '2026-05-02T11:58:00.000Z',
    };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    const reader = createReader({
      cacheTtlMs: 30_000,
      fetch: fetchMock as typeof globalThis.fetch,
    });

    await reader.statusForRepo('workspace-123', 'openai', 'sage');
    reader.invalidate('workspace-123', 'openai', 'sage');
    await reader.statusForRepo('workspace-123', 'openai', 'sage');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('404 returns null and is cached briefly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00.000Z'));

    const fetchMock = vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' }));
    const reader = createReader({
      cacheTtlMs: 1_000,
      fetch: fetchMock as typeof globalThis.fetch,
    });

    await expect(reader.statusForRepo('workspace-123', 'openai', 'sage')).resolves.toBeNull();
    await expect(reader.statusForRepo('workspace-123', 'openai', 'sage')).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('errors return null and emit clone_status_error event', async () => {
    const events: Array<{
      event: string;
      state?: string;
      ms?: number;
      reason?: string;
    }> = [];
    const fetchMock = vi.fn(async () => {
      throw new Error('network unavailable');
    });
    const reader = createReader({
      fetch: fetchMock as typeof globalThis.fetch,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const result = await reader.statusForRepo('workspace-123', 'openai', 'sage');

    expect(result).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'clone_status_error',
      reason: 'network unavailable',
    });
  });
});
