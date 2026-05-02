import type { CloneRequestPayload } from "./types.js";

const DEFAULT_COOLDOWN_MS = 300_000;
const CLEANUP_THRESHOLD = 1_000;
const CLONE_REQUEST_PATH = "/api/v1/github/clone/request";

interface ObservedCloneJob {
  jobId: string | null;
  requestedAt: number;
}

export interface CloneRequesterOptions {
  /** Authority for the clone-request endpoint (e.g. https://cloud...). */
  baseUrl: string;
  /** Bearer token. SageCloudApiToken or SpecialistCloudApiToken. */
  bearerToken: string;
  /** Optional fetch (defaults to globalThis.fetch). Per .claude/rules/workers-fetch.md. */
  fetch?: typeof globalThis.fetch;
  /** In-memory cooldown. Default 300_000 (5 min). */
  cooldownMs?: number;
  /** Optional persistence for { workspaceId:owner/repo -> { jobId, requestedAt } }. */
  jobStore?: CloneJobStore;
  /** Optional event sink. */
  onEvent?: (event: {
    event: string;
    jobId?: string;
    reason?: string;
    status?: number;
  }) => void;
}

export interface CloneJobStore {
  get(key: string): Promise<{ jobId: string; requestedAt: string } | null>;
  put(key: string, value: { jobId: string; requestedAt: string }): Promise<void>;
}

export interface CloneRequestResult {
  submitted: boolean;
  jobId?: string;
  cooldownReason?: "in_cooldown";
  error?: { status: number; body?: unknown };
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Clone requester configuration is missing ${field}`);
  }
  return normalized;
}

function createCacheKey(workspaceId: string, owner: string, repo: string): string {
  return `${workspaceId}:${owner}/${repo}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function parseRequestedAt(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function extractJobId(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const candidate = (body as { jobId?: unknown }).jobId;
  if (typeof candidate !== "string") {
    return null;
  }

  const normalized = candidate.trim();
  return normalized || null;
}

function extractReason(body: unknown): string | undefined {
  if (typeof body === "string") {
    const normalized = body.trim();
    return normalized || undefined;
  }

  if (!body || typeof body !== "object") {
    return undefined;
  }

  const reason = (body as { reason?: unknown }).reason;
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }

  const message = (body as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class CloneRequester {
  private readonly baseUrl: string;
  private readonly bearerToken: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly cooldownMs: number;
  private readonly jobStore?: CloneJobStore;
  private readonly onEvent?: CloneRequesterOptions["onEvent"];
  private readonly observedJobs = new Map<string, ObservedCloneJob>();

  constructor(opts: CloneRequesterOptions) {
    this.baseUrl = requireNonEmpty(opts.baseUrl, "baseUrl").replace(/\/+$/, "");
    this.bearerToken = requireNonEmpty(opts.bearerToken, "bearerToken");
    // Wrap globalThis.fetch in a lambda so each call resolves the binding at
    // invocation time. Storing a bare `globalThis.fetch` reference throws
    // "Illegal invocation" in Cloudflare Workers because the receiver context
    // is lost when called via a class field. Same pattern used in
    // clone-status-reader.ts and sentinel.ts.
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.jobStore = opts.jobStore;
    this.onEvent = opts.onEvent;
  }

  async requestIfNeeded(payload: CloneRequestPayload): Promise<CloneRequestResult> {
    const key = createCacheKey(payload.workspaceId, payload.owner, payload.repo);
    const now = Date.now();

    this.cleanupExpired(now);

    try {
      const existing = await this.getObservedJob(key);
      if (existing && now - existing.requestedAt < this.cooldownMs) {
        return { submitted: false, cooldownReason: "in_cooldown" };
      }

      this.observedJobs.set(key, {
        jobId: existing?.jobId ?? null,
        requestedAt: now,
      });
      this.cleanupExpired(now);

      const response = await this.fetchImpl(`${this.baseUrl}${CLONE_REQUEST_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await readResponseBody(response);
      if (!response.ok) {
        const reason =
          extractReason(body) ?? `Clone request failed with status ${response.status}`;
        this.emitEvent({
          event: "clone_request_failed",
          reason,
          status: response.status,
        });
        return {
          submitted: false,
          error: { status: response.status, body },
        };
      }

      const jobId = extractJobId(body);
      if (!jobId) {
        const reason = "Clone request response did not include a jobId";
        this.emitEvent({
          event: "clone_request_failed",
          reason,
          status: response.status,
        });
        return {
          submitted: false,
          error: { status: response.status, body },
        };
      }

      const requestedAt = new Date(now).toISOString();
      this.observedJobs.set(key, { jobId, requestedAt: now });
      await this.persistObservedJob(key, { jobId, requestedAt });
      this.emitEvent({ event: "clone_requested", jobId });
      return { submitted: true, jobId };
    } catch (error) {
      this.emitEvent({
        event: "clone_request_error",
        reason: toErrorMessage(error),
      });
      return { submitted: false, error: { status: 0 } };
    }
  }

  async lookupJobId(
    workspaceId: string,
    owner: string,
    repo: string,
  ): Promise<string | null> {
    const key = createCacheKey(workspaceId, owner, repo);
    const observed = this.observedJobs.get(key);
    if (observed?.jobId) {
      return observed.jobId;
    }

    const stored = await this.readStoredJob(key);
    if (!stored) {
      return null;
    }

    const requestedAt = parseRequestedAt(stored.requestedAt) ?? Date.now();
    this.observedJobs.set(key, { jobId: stored.jobId, requestedAt });
    this.cleanupExpired(Date.now());
    return stored.jobId;
  }

  private async getObservedJob(key: string): Promise<ObservedCloneJob | null> {
    const inMemory = this.observedJobs.get(key) ?? null;
    const stored = await this.readStoredJob(key);

    if (!stored) {
      return inMemory;
    }

    const fromStore: ObservedCloneJob = {
      jobId: stored.jobId,
      requestedAt: parseRequestedAt(stored.requestedAt) ?? 0,
    };

    if (!inMemory || fromStore.requestedAt >= inMemory.requestedAt) {
      this.observedJobs.set(key, fromStore);
      return fromStore;
    }

    return inMemory;
  }

  private async readStoredJob(
    key: string,
  ): Promise<{ jobId: string; requestedAt: string } | null> {
    if (!this.jobStore) {
      return null;
    }

    try {
      return await this.jobStore.get(key);
    } catch (error) {
      this.emitEvent({
        event: "clone_request_error",
        reason: `clone job store get failed: ${toErrorMessage(error)}`,
      });
      return null;
    }
  }

  private async persistObservedJob(
    key: string,
    value: { jobId: string; requestedAt: string },
  ): Promise<void> {
    if (!this.jobStore) {
      return;
    }

    try {
      await this.jobStore.put(key, value);
    } catch (error) {
      this.emitEvent({
        event: "clone_request_error",
        reason: `clone job store put failed: ${toErrorMessage(error)}`,
      });
    }
  }

  private cleanupExpired(now: number): void {
    if (this.observedJobs.size <= CLEANUP_THRESHOLD) {
      return;
    }

    for (const [key, observed] of this.observedJobs) {
      if (now - observed.requestedAt > this.cooldownMs) {
        this.observedJobs.delete(key);
      }
    }
  }

  private emitEvent(event: {
    event: string;
    jobId?: string;
    reason?: string;
    status?: number;
  }): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Event sinks are best-effort only; requestIfNeeded must never throw.
    }
  }
}
