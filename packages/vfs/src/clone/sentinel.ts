import type { CloneSentinel } from './types.js';

export interface ReadSentinelOptions {
  /** A VfsProvider used to fetch the file. */
  reader: VfsReader;
  /** Default false — when true, don't fall back to meta.json. */
  skipLegacy?: boolean;
}

export interface VfsReader {
  read(path: string): Promise<{ content: string } | null>;
}

const buildCloneSentinelPath = (owner: string, repo: string): string =>
  `/github/repos/${owner}/${repo}/.relayfile/clone.json`;

const buildLegacySentinelPath = (owner: string, repo: string): string =>
  `/github/repos/${owner}/${repo}/meta.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function parseCloneSentinel(
  content: string,
  jobIdOverride?: string,
): CloneSentinel | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  if (typeof parsed.clonedAt !== 'string' || typeof parsed.headSha !== 'string') {
    return null;
  }

  return {
    jobId:
      jobIdOverride ??
      (typeof parsed.jobId === 'string' ? parsed.jobId : 'unknown'),
    headSha: parsed.headSha,
    defaultBranch:
      typeof parsed.defaultBranch === 'string' ? parsed.defaultBranch : '',
    clonedAt: parsed.clonedAt,
    filesWritten:
      typeof parsed.filesWritten === 'number' ? parsed.filesWritten : 0,
    cloneSource:
      typeof parsed.cloneSource === 'string' ? parsed.cloneSource : 'unknown',
  };
}

export async function readCloneSentinel(
  workspaceId: string,
  owner: string,
  repo: string,
  opts: ReadSentinelOptions,
): Promise<CloneSentinel | null> {
  void workspaceId;

  const primaryResult = await opts.reader.read(buildCloneSentinelPath(owner, repo));
  if (primaryResult !== null) {
    return parseCloneSentinel(primaryResult.content);
  }

  if (opts.skipLegacy) {
    return null;
  }

  const legacyResult = await opts.reader.read(buildLegacySentinelPath(owner, repo));
  if (legacyResult === null) {
    return null;
  }

  return parseCloneSentinel(legacyResult.content, 'legacy');
}
