export interface OpenRouterResponseCacheConfig {
  enabled?: boolean;
  ttlSeconds?: number;
  clear?: boolean;
}

export type OpenRouterResponseCacheOption = boolean | OpenRouterResponseCacheConfig;

const MIN_CACHE_TTL_SECONDS = 1;
const MAX_CACHE_TTL_SECONDS = 24 * 60 * 60;

export function buildOpenRouterCacheHeaders(
  cache: OpenRouterResponseCacheOption | undefined,
): Record<string, string> {
  if (cache === undefined || cache === false) {
    return {};
  }

  if (cache === true) {
    return { 'X-OpenRouter-Cache': 'true' };
  }

  const headers: Record<string, string> = {};
  const enabled = cache.enabled !== false;
  if (enabled) {
    headers['X-OpenRouter-Cache'] = 'true';
  }

  if (cache.ttlSeconds !== undefined) {
    if (
      !Number.isInteger(cache.ttlSeconds) ||
      cache.ttlSeconds < MIN_CACHE_TTL_SECONDS ||
      cache.ttlSeconds > MAX_CACHE_TTL_SECONDS
    ) {
      throw new RangeError(
        `OpenRouter response cache ttlSeconds must be an integer from ${MIN_CACHE_TTL_SECONDS} to ${MAX_CACHE_TTL_SECONDS}`,
      );
    }
    if (enabled) {
      headers['X-OpenRouter-Cache-TTL'] = String(cache.ttlSeconds);
    }
  }

  if (cache.clear) {
    headers['X-OpenRouter-Cache-Clear'] = 'true';
  }

  return headers;
}
