import type { CloneJobState, CloneJobStatus } from './types.js';

export interface CloneStatusReaderOptions {
  baseUrl: string;
  bearerToken: string;
  fetch?: typeof globalThis.fetch;
  /** In-memory cache TTL. Default 30_000 (30s). */
  cacheTtlMs?: number;
  onEvent?: (event: {
    event: string;
    state?: string;
    ms?: number;
    reason?: string;
  }) => void;
}

interface CacheEntry {
  expiresAt: number;
  value: CloneJobStatus | null;
}

interface PollResult {
  cacheable: boolean;
  value: CloneJobStatus | null;
}

interface ParsedCloneStatus {
  state?: string;
  valid: boolean;
  value: CloneJobStatus | null;
}

const DEFAULT_CACHE_TTL_MS = 30_000;
const CLONE_JOB_STATES: ReadonlySet<CloneJobState> = new Set([
  'queued',
  'running',
  'succeeded',
  'failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isCloneJobState(value: unknown): value is CloneJobState {
  return typeof value === 'string' && CLONE_JOB_STATES.has(value as CloneJobState);
}

function parseCloneJobStatus(payload: unknown): ParsedCloneStatus {
  if (payload === null) {
    return {
      valid: true,
      value: null,
    };
  }

  if (!isRecord(payload)) {
    return {
      valid: false,
      value: null,
    };
  }

  const state = optionalString(payload.state);
  if (state === 'no_jobs') {
    return {
      state,
      valid: true,
      value: null,
    };
  }

  const jobId = optionalString(payload.jobId);
  if (!jobId || !isCloneJobState(state)) {
    return {
      state,
      valid: false,
      value: null,
    };
  }

  return {
    state,
    valid: true,
    value: {
      jobId,
      state,
      ...(optionalString(payload.queuedAt) ? { queuedAt: optionalString(payload.queuedAt) } : {}),
      ...(optionalString(payload.startedAt)
        ? { startedAt: optionalString(payload.startedAt) }
        : {}),
      ...(optionalString(payload.completedAt)
        ? { completedAt: optionalString(payload.completedAt) }
        : {}),
      ...(optionalString(payload.headSha) ? { headSha: optionalString(payload.headSha) } : {}),
      ...(optionalString(payload.errorMessage)
        ? { errorMessage: optionalString(payload.errorMessage) }
        : {}),
      ...(optionalString(payload.cloneSource)
        ? { cloneSource: optionalString(payload.cloneSource) }
        : {}),
    },
  };
}

function toReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export class CloneStatusReader {
  private readonly baseUrl: string;
  private readonly bearerToken: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly cacheTtlMs: number;
  private readonly onEvent?: CloneStatusReaderOptions['onEvent'];
  private readonly repoCache = new Map<string, CacheEntry>();

  constructor(opts: CloneStatusReaderOptions) {
    this.baseUrl = opts.baseUrl;
    this.bearerToken = opts.bearerToken;
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.cacheTtlMs =
      typeof opts.cacheTtlMs === 'number' && Number.isFinite(opts.cacheTtlMs) && opts.cacheTtlMs >= 0
        ? opts.cacheTtlMs
        : DEFAULT_CACHE_TTL_MS;
    this.onEvent = opts.onEvent;
  }

  async statusForRepo(
    workspaceId: string,
    owner: string,
    repo: string,
  ): Promise<CloneJobStatus | null> {
    const cacheKey = this.repoCacheKey(workspaceId, owner, repo);
    const cached = this.repoCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    if (cached) {
      this.repoCache.delete(cacheKey);
    }

    const url = new URL('/api/v1/github/clone/status/by-repo', this.baseUrl);
    url.searchParams.set('workspaceId', workspaceId);
    url.searchParams.set('owner', owner);
    url.searchParams.set('repo', repo);

    const result = await this.poll(url);
    if (result.cacheable) {
      this.repoCache.set(cacheKey, {
        expiresAt: now + this.cacheTtlMs,
        value: result.value,
      });
    }

    return result.value;
  }

  async statusForJob(jobId: string): Promise<CloneJobStatus | null> {
    const url = new URL(
      `/api/v1/github/clone/status/${encodeURIComponent(jobId)}`,
      this.baseUrl,
    );

    return (await this.poll(url)).value;
  }

  invalidate(workspaceId: string, owner: string, repo: string): void {
    this.repoCache.delete(this.repoCacheKey(workspaceId, owner, repo));
  }

  private repoCacheKey(workspaceId: string, owner: string, repo: string): string {
    return `${workspaceId}:${owner}/${repo}`;
  }

  private async poll(url: URL): Promise<PollResult> {
    const startedAt = Date.now();

    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.bearerToken}`,
        },
        method: 'GET',
      });

      if (response.status === 404) {
        return {
          cacheable: true,
          value: null,
        };
      }

      if (!response.ok) {
        this.emit({
          event: 'clone_status_error',
          reason: `HTTP ${response.status} ${response.statusText}`.trim(),
        });
        return {
          cacheable: false,
          value: null,
        };
      }

      const parsed = parseCloneJobStatus(await response.json());
      if (!parsed.valid) {
        this.emit({
          event: 'clone_status_error',
          reason: 'Invalid clone status response payload',
        });
        return {
          cacheable: false,
          value: null,
        };
      }

      this.emit({
        event: 'clone_status_polled',
        ms: Date.now() - startedAt,
        state: parsed.state ?? parsed.value?.state,
      });

      return {
        cacheable: true,
        value: parsed.value,
      };
    } catch (error) {
      this.emit({
        event: 'clone_status_error',
        reason: toReason(error),
      });
      return {
        cacheable: false,
        value: null,
      };
    }
  }

  private emit(event: {
    event: string;
    state?: string;
    ms?: number;
    reason?: string;
  }): void {
    if (!this.onEvent) {
      return;
    }

    try {
      this.onEvent(event);
    } catch {
      // Intentionally swallow observer failures so reads never throw.
    }
  }
}
