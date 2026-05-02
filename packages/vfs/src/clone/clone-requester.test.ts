import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloneRequester } from './clone-requester.js';

const baseUrl = 'https://cloud.example.test';
const bearerToken = 'token-1';
const payload = {
  workspaceId: 'w1',
  owner: 'o',
  repo: 'r',
  ref: 'refs/heads/main',
  connectionId: 'c1',
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  });
}

function createRecordingFetch(
  responseFactory:
    | Response
    | ((input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>),
) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });

    if (typeof responseFactory === 'function') {
      return await responseFactory(input, init);
    }

    return responseFactory;
  });

  return {
    calls,
    fetch: fetch as unknown as typeof globalThis.fetch,
  };
}

function createJobStore(seed?: Record<string, { jobId: string; requestedAt: string }>) {
  const data = new Map<string, { jobId: string; requestedAt: string }>(
    Object.entries(seed ?? {}),
  );

  return {
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async put(key: string, value: { jobId: string; requestedAt: string }) {
      data.set(key, value);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CloneRequester', () => {
  it('sends 5-field payload', async () => {
    const { calls, fetch } = createRecordingFetch(jsonResponse({ jobId: 'j1' }));
    const requester = new CloneRequester({
      baseUrl,
      bearerToken,
      fetch,
    });

    const result = await requester.requestIfNeeded(payload);

    expect(result).toEqual({ submitted: true, jobId: 'j1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(`${baseUrl}/api/v1/github/clone/request`);
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(payload);
  });

  it('cooldown gates duplicate submit within window', async () => {
    const { fetch } = createRecordingFetch(jsonResponse({ jobId: 'j1' }));
    const requester = new CloneRequester({
      baseUrl,
      bearerToken,
      cooldownMs: 60_000,
      fetch,
    });

    const first = await requester.requestIfNeeded(payload);
    const second = await requester.requestIfNeeded(payload);

    expect(first).toEqual({ submitted: true, jobId: 'j1' });
    expect(second).toEqual({
      submitted: false,
      cooldownReason: 'in_cooldown',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('4xx response is non-throwing', async () => {
    const { fetch } = createRecordingFetch(
      jsonResponse({ reason: 'bad request' }, { status: 400 }),
    );
    const requester = new CloneRequester({
      baseUrl,
      bearerToken,
      fetch,
    });

    await expect(requester.requestIfNeeded(payload)).resolves.toMatchObject({
      submitted: false,
      error: {
        status: 400,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fetch override is honored', async () => {
    const globalFetch = vi.fn(async () => jsonResponse({ jobId: 'global' }));
    const customFetch = vi.fn(async () => jsonResponse({ jobId: 'j1' }));
    vi.stubGlobal('fetch', globalFetch);

    const requester = new CloneRequester({
      baseUrl,
      bearerToken,
      fetch: customFetch as unknown as typeof globalThis.fetch,
    });

    const result = await requester.requestIfNeeded(payload);

    expect(result).toEqual({ submitted: true, jobId: 'j1' });
    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('default fetch resolves at call time (Worker compat)', async () => {
    // Codex P1: storing a bare globalThis.fetch reference in the constructor
    // throws "Illegal invocation" in Cloudflare Workers. The lambda fallback
    // (input, init) => globalThis.fetch(input, init) defers binding to call
    // time. Verify by mutating globalThis.fetch AFTER construction.
    const requester = new CloneRequester({ baseUrl, bearerToken });

    const lateFetch = vi.fn(async () => jsonResponse({ jobId: 'late' }));
    vi.stubGlobal('fetch', lateFetch);

    const result = await requester.requestIfNeeded(payload);

    expect(result).toEqual({ submitted: true, jobId: 'late' });
    expect(lateFetch).toHaveBeenCalledTimes(1);
  });

  it('jobStore persists jobId on success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));

    const jobStore = createJobStore();
    const { fetch } = createRecordingFetch(jsonResponse({ jobId: 'j1' }));
    const requester = new CloneRequester({
      baseUrl,
      bearerToken,
      fetch,
      jobStore,
    });

    const result = await requester.requestIfNeeded(payload);

    expect(result).toEqual({ submitted: true, jobId: 'j1' });
    await expect(jobStore.get('w1:o/r')).resolves.toEqual({
      jobId: 'j1',
      requestedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('lookupJobId reads from jobStore', async () => {
    const jobStore = createJobStore({
      'w1:o/r': {
        jobId: 'j1',
        requestedAt: '2026-01-02T03:04:05.000Z',
      },
    });
    const { fetch } = createRecordingFetch(jsonResponse({ jobId: 'network' }));
    const requester = new CloneRequester({
      baseUrl,
      bearerToken,
      fetch,
      jobStore,
    });

    const jobId = await requester.lookupJobId('w1', 'o', 'r');

    expect(jobId).toBe('j1');
    expect(fetch).not.toHaveBeenCalled();
  });
});
