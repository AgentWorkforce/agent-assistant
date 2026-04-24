import type { VfsEntry } from '@agent-assistant/vfs';

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function githubPullsRoot(owner: string, repo: string): string {
  return `/github/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/pulls`;
}

export function githubPullMetadataPath(
  owner: string,
  repo: string,
  number: number,
): string {
  return `${githubPullsRoot(owner, repo)}/${number}/metadata.json`;
}

export function isGithubPullMetadataPath(path: string): boolean {
  return /\/github\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/(?:meta|metadata)\.json$/i.test(
    path,
  );
}

export function isGithubPullMetadataEntry(entry: VfsEntry): boolean {
  return entry.type === 'file' && isGithubPullMetadataPath(entry.path);
}
