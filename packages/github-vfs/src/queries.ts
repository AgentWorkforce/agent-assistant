import type { VfsProvider } from '@agent-assistant/vfs';
import { githubPullsRoot, isGithubPullMetadataEntry } from './paths.js';

const DEFAULT_PR_LIMIT = 50;
const MAX_PR_LIMIT = 100;

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  state: string;
  sourcePath: string;
  author?: string;
  updatedAt?: string;
  url?: string;
  draft?: boolean;
}

export interface ListOpenPullRequestsOptions {
  limit?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readIdentity(value: unknown): string | undefined {
  const direct = readString(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;
  return readString(value.login) ?? readString(value.name) ?? readString(value.id);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_PR_LIMIT;
  }
  return Math.min(MAX_PR_LIMIT, Math.floor(limit));
}

function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareUpdatedDescending(
  left: GitHubPullRequestSummary,
  right: GitHubPullRequestSummary,
): number {
  const leftTime = timestamp(left.updatedAt);
  const rightTime = timestamp(right.updatedAt);
  if (rightTime !== leftTime) return rightTime - leftTime;
  return right.number - left.number;
}

function normalizePullRequest(
  path: string,
  metadata: Record<string, unknown>,
): GitHubPullRequestSummary | null {
  const number = readNumber(metadata.number);
  const title = readString(metadata.title);
  const state = readString(metadata.state);
  if (number === undefined || !title || !state || state.toLowerCase() !== 'open') {
    return null;
  }

  const author = readIdentity(metadata.author) ?? readIdentity(metadata.user);
  const updatedAt = readString(metadata.updatedAt) ?? readString(metadata.updated_at);
  const url = readString(metadata.html_url) ?? readString(metadata.url);
  const draft = readBoolean(metadata.draft);

  return {
    number,
    title,
    state,
    sourcePath: path,
    ...(author ? { author } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(url ? { url } : {}),
    ...(draft !== undefined ? { draft } : {}),
  };
}

export async function listOpenPullRequestsFromVfs(
  provider: VfsProvider,
  ref: GitHubRepoRef,
  options: ListOpenPullRequestsOptions = {},
): Promise<GitHubPullRequestSummary[]> {
  const limit = clampLimit(options.limit);
  const root = githubPullsRoot(ref.owner, ref.repo);
  const entries = await provider.list(root, {
    depth: 2,
    limit: Math.max(limit * 2, limit),
  });
  const paths = entries
    .filter(isGithubPullMetadataEntry)
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));

  const prs: GitHubPullRequestSummary[] = [];
  for (const path of paths) {
    const result = await provider.read(path);
    if (!result) continue;
    const metadata = parseJsonRecord(result.content);
    if (!metadata) continue;
    const pr = normalizePullRequest(path, metadata);
    if (pr) prs.push(pr);
  }

  return prs.sort(compareUpdatedDescending).slice(0, limit);
}
