import { CloneRequester, type CloneRequestResult } from './clone-requester.js'
import { CloneStatusReader } from './clone-status-reader.js'
import { readCloneSentinel, type VfsReader } from './sentinel.js'
import type { CloneAdvisory } from './types.js'

const DEFAULT_STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_REF = 'refs/heads/main'

export interface EnsureCloneFreshOptions {
  statusReader: CloneStatusReader
  sentinelReader: VfsReader
  cloneRequester: CloneRequester
  /** Default 30 days. */
  staleThresholdMs?: number
  /** Default ref for new requests. */
  defaultRef?: string
  /** Default connectionId for new requests. */
  connectionIdResolver: (
    workspaceId: string,
    owner: string,
    repo: string,
  ) => Promise<string | null>
}

function resolveStaleThresholdMs(value?: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }

  return DEFAULT_STALE_THRESHOLD_MS
}

function isWithinThreshold(timestamp: string | undefined, thresholdMs: number): boolean {
  if (!timestamp) {
    return false
  }

  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) {
    return false
  }

  return Date.now() - parsed <= thresholdMs
}

export async function ensureCloneFresh(
  workspaceId: string,
  owner: string,
  repo: string,
  opts: EnsureCloneFreshOptions,
): Promise<CloneAdvisory | null> {
  const staleThresholdMs = resolveStaleThresholdMs(opts.staleThresholdMs)
  const status = await opts.statusReader.statusForRepo(workspaceId, owner, repo)

  if (status?.state === 'queued' || status?.state === 'running') {
    return {
      notice: 'clone_in_progress',
      cloneState: status.state,
      cloneJobId: status.jobId,
      cloneStartedAt: status.startedAt,
    }
  }

  if (
    status?.state === 'succeeded' &&
    isWithinThreshold(status.completedAt, staleThresholdMs)
  ) {
    return null
  }

  if (status?.state === 'failed') {
    return {
      notice: 'clone_failed',
      cloneState: 'failed',
      cloneJobId: status.jobId,
      reason: status.errorMessage,
    }
  }

  const sentinel = await readCloneSentinel(workspaceId, owner, repo, {
    reader: opts.sentinelReader,
  })
  if (sentinel && isWithinThreshold(sentinel.clonedAt, staleThresholdMs)) {
    return null
  }

  const connectionId = await opts.connectionIdResolver(workspaceId, owner, repo)
  if (connectionId === null) {
    return {
      notice: 'clone_failed',
      cloneState: 'unknown',
      reason: 'connection_unresolved',
    }
  }

  // Await the enqueue so the advisory reflects the actual outcome. A
  // fire-and-forget here would return clone_requested even when the request
  // 4xx'd / 5xx'd / threw — masking real failures from callers.
  let requestResult: CloneRequestResult
  try {
    requestResult = await opts.cloneRequester.requestIfNeeded({
      workspaceId,
      owner,
      repo,
      ref: opts.defaultRef ?? DEFAULT_REF,
      connectionId,
    })
  } catch (error) {
    return {
      notice: 'clone_failed',
      cloneState: 'unknown',
      reason: error instanceof Error ? error.message : 'request_threw',
    }
  }

  if (requestResult.error) {
    return {
      notice: 'clone_failed',
      cloneState: 'unknown',
      reason: `request_failed_status_${requestResult.error.status}`,
    }
  }

  // submitted=true OR cooldownReason='in_cooldown' both mean the request is
  // either freshly queued or already in flight from a recent submit — both
  // are accurately described by clone_requested.
  return {
    notice: 'clone_requested',
    cloneState: 'queued',
    cloneJobId: requestResult.jobId,
  }
}
