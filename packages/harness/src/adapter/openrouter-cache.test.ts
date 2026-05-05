import { describe, expect, it } from 'vitest';

import { buildOpenRouterCacheHeaders } from './openrouter-cache.js';

describe('buildOpenRouterCacheHeaders', () => {
  it('returns no headers when response caching is not configured', () => {
    expect(buildOpenRouterCacheHeaders(undefined)).toEqual({});
    expect(buildOpenRouterCacheHeaders(false)).toEqual({});
  });

  it('maps boolean true to the OpenRouter cache opt-in header', () => {
    expect(buildOpenRouterCacheHeaders(true)).toEqual({
      'X-OpenRouter-Cache': 'true',
    });
  });

  it('maps ttl and clear options to OpenRouter cache headers', () => {
    expect(buildOpenRouterCacheHeaders({ ttlSeconds: 60, clear: true })).toEqual({
      'X-OpenRouter-Cache': 'true',
      'X-OpenRouter-Cache-TTL': '60',
      'X-OpenRouter-Cache-Clear': 'true',
    });
  });

  it('allows cache clear without enabling cache for the request', () => {
    expect(buildOpenRouterCacheHeaders({ enabled: false, clear: true })).toEqual({
      'X-OpenRouter-Cache-Clear': 'true',
    });
  });

  it('rejects TTLs outside OpenRouter bounds', () => {
    expect(() => buildOpenRouterCacheHeaders({ ttlSeconds: 0 })).toThrow(/ttlSeconds/);
    expect(() => buildOpenRouterCacheHeaders({ ttlSeconds: 86_401 })).toThrow(/ttlSeconds/);
    expect(() => buildOpenRouterCacheHeaders({ ttlSeconds: 1.5 })).toThrow(/ttlSeconds/);
  });
});
