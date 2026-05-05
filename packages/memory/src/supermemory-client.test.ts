import { describe, expect, it, vi } from 'vitest';

import { createSupermemoryClient } from './supermemory-client.js';

describe('createSupermemoryClient', () => {
  it('returns null when SUPERMEMORY_API_KEY is unset (no-op for local dev)', () => {
    expect(createSupermemoryClient({ env: {} })).toBeNull();
    expect(createSupermemoryClient({ env: { SUPERMEMORY_API_KEY: '' } })).toBeNull();
    expect(createSupermemoryClient({ env: { SUPERMEMORY_API_KEY: '   ' } })).toBeNull();
  });

  it('returns a configured Supermemory instance when the API key is present', () => {
    const client = createSupermemoryClient({
      env: { SUPERMEMORY_API_KEY: 'sm_test_key' },
    });
    expect(client).not.toBeNull();
    // Smoke check that the SDK was actually constructed with our wiring —
    // we don't depend on internal field names, just that the resource
    // facades are reachable.
    expect(typeof client?.documents.list).toBe('function');
  });

  it('honors a custom apiKeyEnvVar', () => {
    const client = createSupermemoryClient({
      env: { MY_APP_SUPERMEMORY_KEY: 'sm_test_key' },
      apiKeyEnvVar: 'MY_APP_SUPERMEMORY_KEY',
    });
    expect(client).not.toBeNull();
  });

  it('passes the configured fetch override through to the SDK', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ memories: [], pagination: { totalItems: 0 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = createSupermemoryClient({
      env: { SUPERMEMORY_API_KEY: 'sm_test_key' },
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });
    expect(client).not.toBeNull();

    await client!.documents.list({ limit: 1 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchSpy.mock.calls[0] as [URL | string];
    expect(String(calledUrl)).toMatch(/\/v3\/documents\/list$/);
  });

  it('uses the default endpoint when SUPERMEMORY_ENDPOINT is unset', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ memories: [] }), { status: 200 }),
    );
    const client = createSupermemoryClient({
      env: { SUPERMEMORY_API_KEY: 'sm_test_key' },
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });
    await client!.documents.list({ limit: 1 });
    const [calledUrl] = fetchSpy.mock.calls[0] as [URL | string];
    expect(String(calledUrl)).toMatch(/^https:\/\/api\.supermemory\.ai\//);
  });

  it('honors SUPERMEMORY_ENDPOINT override when present', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ memories: [] }), { status: 200 }),
    );
    const client = createSupermemoryClient({
      env: {
        SUPERMEMORY_API_KEY: 'sm_test_key',
        SUPERMEMORY_ENDPOINT: 'https://supermemory.test.example',
      },
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });
    await client!.documents.list({ limit: 1 });
    const [calledUrl] = fetchSpy.mock.calls[0] as [URL | string];
    expect(String(calledUrl)).toMatch(/^https:\/\/supermemory\.test\.example\//);
  });

  it('does not throw on hosts without globalThis.process (pure Workers / browsers)', () => {
    // Same Worker-safety contract as @agent-assistant/proactive's
    // readFailOpenFromEnv (PR #82 review). The no-arg / env-default path
    // must not hit `process` directly.
    const original = (globalThis as { process?: unknown }).process;
    try {
      delete (globalThis as { process?: unknown }).process;
      expect(() => createSupermemoryClient()).not.toThrow();
      expect(createSupermemoryClient()).toBeNull();
    } finally {
      if (original === undefined) {
        delete (globalThis as { process?: unknown }).process;
      } else {
        (globalThis as { process?: unknown }).process = original;
      }
    }
  });
});
