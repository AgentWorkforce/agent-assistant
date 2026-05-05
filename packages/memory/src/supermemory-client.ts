/**
 * Single shared factory for the Supermemory TypeScript SDK.
 *
 * Extracted from sage's `src/integrations/supermemory-client.ts` (originally
 * sage PR #198) so every AA consumer that talks to Supermemory shares the
 * same endpoint, timeout, retry, and Worker-fetch wiring instead of
 * re-rolling their own copy. Sage previously had four call sites with
 * subtly different defaults; centralising the construction here removes
 * that drift class for all future consumers.
 *
 * Why this shape:
 *   - Returns `null` when no API key is available so callers can no-op
 *     cleanly during local development without wrapping every call site in
 *     a second env-presence check.
 *   - Defaults `timeout: 8s` to match the per-call cap that fixed the
 *     2026-05-04 SEARCH_ERROR outage in prod (sage PR #198). Supermemory
 *     normally responds in <1s; an 8s ceiling keeps any future wobble
 *     from saturating the Cloudflare 30s tenant budget.
 *   - Defaults `maxRetries: 2` (the SDK default) — surfaced explicitly so
 *     it's obvious from the call site that retries on 5xx/timeout/etc.
 *     are happening transparently. Without this, the original SEARCH_ERROR
 *     outage would have been masked by the retry layer entirely.
 *   - Pins `fetch` to a per-call `globalThis.fetch(...)` closure rather
 *     than a captured reference. The SDK already calls
 *     `fetch.call(undefined, url, init)` internally to dodge the
 *     Cloudflare Workers "Illegal invocation" foot-gun
 *     (sdk-ts/src/client.ts:594), but passing the explicit closure keeps
 *     `vi.stubGlobal("fetch", ...)` working in vitest — the SDK captures
 *     `fetch` at construction time, so a module-level stub set after
 *     construction would otherwise be invisible.
 *
 * Worker-safe: avoids `import { env } from "node:process"` and
 * `NodeJS.ProcessEnv` in the public surface, both of which would break
 * Cloudflare Worker consumers without `nodejs_compat`. Same pattern as
 * `@agent-assistant/proactive`'s `readFailOpenFromEnv` (PR #82 review).
 */

import Supermemory from 'supermemory';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_API_KEY_VAR = 'SUPERMEMORY_API_KEY';
const DEFAULT_ENDPOINT_VAR = 'SUPERMEMORY_ENDPOINT';

/**
 * Plain map of env var names to their values. Avoids `NodeJS.ProcessEnv` in
 * the public API so this package stays usable from non-Node runtimes
 * (Cloudflare Workers without `nodejs_compat`, browsers, Deno, etc.). Matches
 * the shape exported by `@agent-assistant/proactive`.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface CreateSupermemoryClientOptions {
  /** Override the SDK timeout per-instance. Defaults to 8000 ms. */
  timeoutMs?: number;
  /** Override the retry budget per-instance. Defaults to 2. */
  maxRetries?: number;
  /**
   * Env source for the API key + endpoint lookup. Defaults to
   * `globalThis.process?.env ?? {}` so Node, Workers-with-nodejs_compat,
   * and pure Workers (where `process` is undefined) all behave consistently.
   * Tests inject a plain object.
   */
  env?: EnvSource;
  /**
   * Override the env var name read for the API key. Useful for surfaces
   * that namespace their secrets (e.g. `MY_APP_SUPERMEMORY_API_KEY`).
   * Defaults to `SUPERMEMORY_API_KEY`.
   */
  apiKeyEnvVar?: string;
  /**
   * Override the env var name read for the endpoint. Defaults to
   * `SUPERMEMORY_ENDPOINT`. Unset value falls back to the SDK's default
   * endpoint (https://api.supermemory.ai).
   */
  endpointEnvVar?: string;
  /**
   * Override the fetch implementation. Defaults to a per-call closure over
   * `globalThis.fetch` so test stubs via `vi.stubGlobal('fetch', ...)`
   * remain visible after the SDK has captured its reference.
   */
  fetch?: typeof globalThis.fetch;
}

function defaultEnvSource(): EnvSource {
  const proc = (globalThis as { process?: { env?: EnvSource } }).process;
  return proc?.env ?? {};
}

function defaultFetch(): typeof globalThis.fetch {
  return ((input, init) => globalThis.fetch(input, init)) as typeof globalThis.fetch;
}

export function createSupermemoryClient(
  options: CreateSupermemoryClientOptions = {},
): Supermemory | null {
  const env = options.env ?? defaultEnvSource();
  const apiKey = env[options.apiKeyEnvVar ?? DEFAULT_API_KEY_VAR]?.trim();
  if (!apiKey) {
    return null;
  }

  const baseURL = env[options.endpointEnvVar ?? DEFAULT_ENDPOINT_VAR]?.trim() || undefined;
  return new Supermemory({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    fetch: options.fetch ?? defaultFetch(),
  });
}
