export interface GitHubPublicReview {
  owner: string;
  repo: string;
  description?: string;
  license?: string;
  stargazersCount?: number;
  openIssuesCount?: number;
  defaultBranch?: string;
  htmlUrl?: string;
  readme?: string;
  packageJson?: unknown;
  topLevel?: Array<{ path: string; type: 'file' | 'dir' }>;
  recentCommits?: GitHubPublicRecentCommit[];
}

export interface GitHubPublicMetadata {
  owner: string;
  repo: string;
  description?: string;
  license?: string;
  stargazersCount?: number;
  openIssuesCount?: number;
  defaultBranch?: string;
  htmlUrl?: string;
  readmeExcerpt?: string;
  packageJson?: unknown;
}

export type GitHubPublicTreeEntry =
  | {
      path: string;
      type: 'file' | 'dir';
      size?: number;
      sha?: string;
    }
  | {
      path: '...';
      type: 'truncated';
      omittedCount: number;
    };

export interface GitHubPublicReadFileOptions {
  ref?: string;
  lineRange?: {
    start: number;
    end: number;
  };
}

export interface GitHubPublicReadFileResult {
  path: string;
  content: string;
  sha?: string;
  size?: number;
  truncated: boolean;
}

export interface GitHubPublicRecentCommit {
  sha: string;
  message: string;
  authorName?: string;
  authorDate?: string;
}

export interface GitHubPublicSearchCodeResult {
  path: string;
  lineMatches: Array<{
    lineNumber: number;
    text: string;
  }>;
}

export type GitHubPublicFetchErrorCode =
  | 'not_found'
  | 'rate_limited'
  | 'invalid_request'
  | 'transport'
  | 'unknown';

export class GitHubPublicFetchError extends Error {
  readonly status?: number;
  readonly code: GitHubPublicFetchErrorCode;
  readonly bodyExcerpt?: string;

  constructor(
    message: string,
    options: {
      code: GitHubPublicFetchErrorCode;
      status?: number;
      bodyExcerpt?: string;
    },
  ) {
    super(message);
    this.name = 'GitHubPublicFetchError';
    this.code = options.code;
    this.status = options.status;
    this.bodyExcerpt = options.bodyExcerpt;
  }
}

export interface GitHubPublicFetcherOptions {
  fetchImpl?: typeof globalThis.fetch;
  userAgent?: string;
  readmeMaxChars?: number;
  commitsCount?: number;
  timeoutMs?: number;
  publicToken?: string;
  githubToken?: string | null;
}

const DEFAULT_USER_AGENT = 'agent-assistant-harness';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_README_MAX_CHARS = 16_384;
const README_EXCERPT_CHARS = 4 * 1024;
const DEFAULT_COMMITS_COUNT = 5;
const MAX_COMMITS_COUNT = 20;
const MAX_TREE_ENTRIES = 100;
const MAX_FILE_BYTES = 100 * 1024;
const MAX_SEARCH_RESULTS = 30;
const README_TRUNCATION_MARKER = '\n[truncated]';
const GITHUB_JSON_ACCEPT = 'application/vnd.github+json';
const GITHUB_RAW_ACCEPT = 'application/vnd.github.raw';
const GITHUB_TEXT_MATCH_ACCEPT = 'application/vnd.github.text-match+json';
const GITHUB_API_BASE_URL = 'https://api.github.com';
const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;
const NON_OK_BODY_EXCERPT_CHARS = 500;

interface GitHubRepoResponse {
  description?: unknown;
  stargazers_count?: unknown;
  open_issues_count?: unknown;
  default_branch?: unknown;
  html_url?: unknown;
  license?: {
    spdx_id?: unknown;
  } | null;
}

interface GitHubContentResponse {
  content?: unknown;
}

interface GitHubTopLevelEntryResponse {
  path?: unknown;
  type?: unknown;
  size?: unknown;
  sha?: unknown;
}

interface GitHubCommitResponse {
  sha?: unknown;
  commit?: {
    message?: unknown;
    author?: {
      name?: unknown;
      date?: unknown;
    } | null;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function decodeBase64Utf8(value: string): string {
  const normalized = value.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(normalized, 'base64').toString('utf8');
  }

  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function sliceLineRange(
  content: string,
  lineRange: GitHubPublicReadFileOptions['lineRange'],
): string {
  if (!lineRange) {
    return content;
  }

  const start = Math.max(1, Math.trunc(lineRange.start));
  const end = Math.max(start, Math.trunc(lineRange.end));
  return content.split(/\r?\n/).slice(start - 1, end).join('\n');
}

function truncateContent(content: string): { content: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength <= MAX_FILE_BYTES) {
    return { content, truncated: false };
  }

  return {
    content: new TextDecoder().decode(bytes.slice(0, MAX_FILE_BYTES)),
    truncated: true,
  };
}

function truncateReadme(readme: string, maxChars: number): string {
  if (readme.length <= maxChars) {
    return readme;
  }
  return `${readme.slice(0, maxChars)}${README_TRUNCATION_MARKER}`;
}

function toTransportMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function buildContentsUrl(
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): string {
  const normalizedPath = encodePathSegments(path.trim());
  const suffix = normalizedPath ? `/${normalizedPath}` : '';
  const url = new URL(
    `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${suffix}`,
  );
  if (ref?.trim()) {
    url.searchParams.set('ref', ref.trim());
  }
  return url.toString();
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_COMMITS_COUNT);
}

export class GitHubPublicFetcher {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly userAgent: string;
  private readonly readmeMaxChars: number;
  private readonly commitsCount: number;
  private readonly timeoutMs: number;
  private readonly publicToken?: string;

  constructor(options: GitHubPublicFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.userAgent =
      typeof options.userAgent === 'string' && options.userAgent.trim().length > 0
        ? options.userAgent
        : DEFAULT_USER_AGENT;
    this.readmeMaxChars = normalizePositiveInteger(
      options.readmeMaxChars,
      DEFAULT_README_MAX_CHARS,
    );
    this.commitsCount = Math.min(
      MAX_COMMITS_COUNT,
      normalizePositiveInteger(options.commitsCount, DEFAULT_COMMITS_COUNT),
    );
    this.timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.publicToken =
      options.publicToken?.trim() || options.githubToken?.trim() || undefined;
  }

  canSearchCode(): boolean {
    return this.publicToken !== undefined;
  }

  async fetchMetadata(owner: string, repo: string): Promise<GitHubPublicMetadata> {
    this.validateRepoSegment(owner, 'owner');
    this.validateRepoSegment(repo, 'repo');

    const baseUrl = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}`;
    const repoMetadata = await this.fetchRequiredJson<GitHubRepoResponse>(baseUrl);
    const readme = await this.fetchOptionalReadme(`${baseUrl}/readme`);
    const packageJson = await this.fetchOptionalPackageJson(`${baseUrl}/contents/package.json`);

    return {
      owner,
      repo,
      ...(optionalString(repoMetadata.description)
        ? { description: optionalString(repoMetadata.description) }
        : {}),
      ...(optionalNumber(repoMetadata.stargazers_count) !== undefined
        ? { stargazersCount: optionalNumber(repoMetadata.stargazers_count) }
        : {}),
      ...(optionalNumber(repoMetadata.open_issues_count) !== undefined
        ? { openIssuesCount: optionalNumber(repoMetadata.open_issues_count) }
        : {}),
      ...(optionalString(repoMetadata.default_branch)
        ? { defaultBranch: optionalString(repoMetadata.default_branch) }
        : {}),
      ...(optionalString(repoMetadata.html_url)
        ? { htmlUrl: optionalString(repoMetadata.html_url) }
        : {}),
      ...(optionalString(repoMetadata.license?.spdx_id)
        ? { license: optionalString(repoMetadata.license?.spdx_id) }
        : {}),
      ...(readme ? { readmeExcerpt: readme.slice(0, README_EXCERPT_CHARS) } : {}),
      ...(packageJson !== undefined ? { packageJson } : {}),
    };
  }

  async listTree(
    owner: string,
    repo: string,
    options: { path?: string; ref?: string } = {},
  ): Promise<GitHubPublicTreeEntry[]> {
    this.validateRepoSegment(owner, 'owner');
    this.validateRepoSegment(repo, 'repo');

    const payload = await this.fetchRequiredJson<unknown>(
      buildContentsUrl(owner, repo, options.path ?? '', options.ref),
    );
    if (!Array.isArray(payload)) {
      throw new GitHubPublicFetchError(
        `GitHub path is not a directory: ${owner}/${repo}/${options.path ?? ''}`,
        { code: 'invalid_request' },
      );
    }

    const entries: GitHubPublicTreeEntry[] = [];
    for (const entry of payload) {
      if (!isRecord(entry)) {
        continue;
      }

      const path = optionalString((entry as GitHubTopLevelEntryResponse).path);
      const type = (entry as GitHubTopLevelEntryResponse).type;
      if (!path || (type !== 'file' && type !== 'dir')) {
        continue;
      }

      entries.push({
        path,
        type,
        ...(optionalNumber((entry as GitHubTopLevelEntryResponse).size) !== undefined
          ? { size: optionalNumber((entry as GitHubTopLevelEntryResponse).size) }
          : {}),
        ...(optionalString((entry as GitHubTopLevelEntryResponse).sha)
          ? { sha: optionalString((entry as GitHubTopLevelEntryResponse).sha) }
          : {}),
      });
    }

    if (entries.length <= MAX_TREE_ENTRIES) {
      return entries;
    }

    return [
      ...entries.slice(0, MAX_TREE_ENTRIES - 1),
      {
        path: '...',
        type: 'truncated',
        omittedCount: entries.length - (MAX_TREE_ENTRIES - 1),
      },
    ];
  }

  async readFile(
    owner: string,
    repo: string,
    path: string,
    options: GitHubPublicReadFileOptions = {},
  ): Promise<GitHubPublicReadFileResult> {
    this.validateRepoSegment(owner, 'owner');
    this.validateRepoSegment(repo, 'repo');
    if (!path.trim()) {
      throw new GitHubPublicFetchError('GitHub public readFile requires path', {
        code: 'invalid_request',
      });
    }

    const payload = await this.fetchRequiredJson<unknown>(
      buildContentsUrl(owner, repo, path, options.ref),
    );
    if (!isRecord(payload) || payload.type !== 'file' || typeof payload.content !== 'string') {
      throw new GitHubPublicFetchError(
        `GitHub path is not a readable file: ${owner}/${repo}/${path}`,
        { code: 'invalid_request' },
      );
    }

    const decoded = decodeBase64Utf8(payload.content);
    const ranged = sliceLineRange(decoded, options.lineRange);
    const truncated = options.lineRange ? { content: ranged, truncated: false } : truncateContent(ranged);

    return {
      path: optionalString(payload.path) ?? path,
      content: truncated.content,
      ...(optionalString(payload.sha) ? { sha: optionalString(payload.sha) } : {}),
      ...(optionalNumber(payload.size) !== undefined ? { size: optionalNumber(payload.size) } : {}),
      truncated: truncated.truncated,
    };
  }

  async recentCommits(
    owner: string,
    repo: string,
    options: { path?: string; limit?: number } = {},
  ): Promise<GitHubPublicRecentCommit[]> {
    this.validateRepoSegment(owner, 'owner');
    this.validateRepoSegment(repo, 'repo');

    const url = new URL(`${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/commits`);
    url.searchParams.set('per_page', String(normalizeLimit(options.limit, this.commitsCount)));
    if (options.path?.trim()) {
      url.searchParams.set('path', options.path.trim());
    }

    return (await this.fetchOptionalRecentCommits(url.toString())) ?? [];
  }

  async searchCode(
    owner: string,
    repo: string,
    query: string,
    options: { path?: string } = {},
  ): Promise<GitHubPublicSearchCodeResult[]> {
    this.validateRepoSegment(owner, 'owner');
    this.validateRepoSegment(repo, 'repo');
    if (!this.publicToken) {
      throw new GitHubPublicFetchError(
        'GitHub public code search requires publicToken or githubToken',
        { code: 'invalid_request' },
      );
    }
    if (!query.trim()) {
      throw new GitHubPublicFetchError('GitHub public searchCode requires query', {
        code: 'invalid_request',
      });
    }

    const qualifiedQuery = [
      query.trim(),
      `repo:${owner}/${repo}`,
      options.path?.trim() ? `path:${options.path.trim()}` : '',
    ].filter(Boolean).join(' ');
    const url = new URL(`${GITHUB_API_BASE_URL}/search/code`);
    url.searchParams.set('q', qualifiedQuery);
    url.searchParams.set('per_page', String(MAX_SEARCH_RESULTS));

    const payload = await this.fetchRequiredJson<unknown>(url.toString(), GITHUB_TEXT_MATCH_ACCEPT);
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      return [];
    }

    return payload.items.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const path = optionalString(item.path);
      if (!path) {
        return [];
      }

      const lineMatches: GitHubPublicSearchCodeResult['lineMatches'] = [];
      const textMatches = Array.isArray(item.text_matches) ? item.text_matches : [];
      for (const textMatch of textMatches) {
        if (!isRecord(textMatch) || typeof textMatch.fragment !== 'string') {
          continue;
        }
        const lines = textMatch.fragment.split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          if (line.trim()) {
            lineMatches.push({ lineNumber: index + 1, text: line });
          }
        }
      }

      return [{ path, lineMatches }];
    });
  }

  async fetchReview(owner: string, repo: string): Promise<GitHubPublicReview> {
    this.validateRepoSegment(owner, 'owner');
    this.validateRepoSegment(repo, 'repo');

    const baseUrl = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}`;
    const repoMetadata = await this.fetchRequiredJson<GitHubRepoResponse>(baseUrl);

    const review: GitHubPublicReview = {
      owner,
      repo,
      ...(optionalString(repoMetadata.description)
        ? { description: optionalString(repoMetadata.description) }
        : {}),
      ...(optionalNumber(repoMetadata.stargazers_count) !== undefined
        ? { stargazersCount: optionalNumber(repoMetadata.stargazers_count) }
        : {}),
      ...(optionalNumber(repoMetadata.open_issues_count) !== undefined
        ? { openIssuesCount: optionalNumber(repoMetadata.open_issues_count) }
        : {}),
      ...(optionalString(repoMetadata.default_branch)
        ? { defaultBranch: optionalString(repoMetadata.default_branch) }
        : {}),
      ...(optionalString(repoMetadata.html_url)
        ? { htmlUrl: optionalString(repoMetadata.html_url) }
        : {}),
      ...(optionalString(repoMetadata.license?.spdx_id)
        ? { license: optionalString(repoMetadata.license?.spdx_id) }
        : {}),
    };

    const readme = await this.fetchOptionalReadme(`${baseUrl}/readme`);
    if (readme !== undefined) {
      review.readme = readme;
    }

    const packageJson = await this.fetchOptionalPackageJson(`${baseUrl}/contents/package.json`);
    if (packageJson !== undefined) {
      review.packageJson = packageJson;
    }

    const topLevel = await this.fetchOptionalTopLevel(`${baseUrl}/contents/`);
    if (topLevel !== undefined) {
      review.topLevel = topLevel;
    }

    const recentCommits = await this.recentCommits(owner, repo);
    if (recentCommits !== undefined) {
      review.recentCommits = recentCommits;
    }

    return review;
  }

  private validateRepoSegment(value: string, label: 'owner' | 'repo'): void {
    if (!REPO_SEGMENT_PATTERN.test(value)) {
      throw new GitHubPublicFetchError(
        `Invalid GitHub ${label}: must match ${REPO_SEGMENT_PATTERN}`,
        {
          code: 'invalid_request',
        },
      );
    }
  }

  private async fetchRequiredJson<T>(url: string, accept = GITHUB_JSON_ACCEPT): Promise<T> {
    const response = await this.fetchResponse(url, accept);
    if (!response.ok) {
      throw await this.createFetchError(response, url);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new GitHubPublicFetchError(
        `GitHub returned invalid JSON for ${url}: ${toTransportMessage(error)}`,
        {
          code: 'unknown',
          status: response.status,
        },
      );
    }
  }

  private async fetchOptionalReadme(url: string): Promise<string | undefined> {
    const readme = await this.fetchOptionalText(url, GITHUB_RAW_ACCEPT);
    return readme === undefined ? undefined : truncateReadme(readme, this.readmeMaxChars);
  }

  private async fetchOptionalPackageJson(url: string): Promise<unknown> {
    const payload = await this.fetchOptionalJson<GitHubContentResponse>(url);
    if (!payload || typeof payload.content !== 'string') {
      return undefined;
    }

    try {
      return JSON.parse(decodeBase64Utf8(payload.content)) as unknown;
    } catch {
      return undefined;
    }
  }

  private async fetchOptionalTopLevel(
    url: string,
  ): Promise<Array<{ path: string; type: 'file' | 'dir' }> | undefined> {
    const payload = await this.fetchOptionalJson<unknown>(url);
    if (!Array.isArray(payload)) {
      return undefined;
    }

    return payload.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      const path = optionalString((entry as GitHubTopLevelEntryResponse).path);
      const type = (entry as GitHubTopLevelEntryResponse).type;
      if (!path || (type !== 'file' && type !== 'dir')) {
        return [];
      }

      return [{ path, type }];
    });
  }

  private async fetchOptionalRecentCommits(url: string): Promise<GitHubPublicRecentCommit[] | undefined> {
    const payload = await this.fetchOptionalJson<unknown>(url);
    if (!Array.isArray(payload)) {
      return undefined;
    }

    return payload.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      const commitEntry = entry as GitHubCommitResponse;
      const sha = optionalString(commitEntry.sha);
      const message = optionalString(commitEntry.commit?.message);
      const authorName = optionalString(commitEntry.commit?.author?.name);
      const authorDate = optionalString(commitEntry.commit?.author?.date);
      if (!sha || !message) {
        return [];
      }

      return [
        {
          sha,
          message,
          ...(authorName ? { authorName } : {}),
          ...(authorDate ? { authorDate } : {}),
        },
      ];
    });
  }

  private async fetchOptionalJson<T>(url: string): Promise<T | undefined> {
    const response = await this.fetchOptionalResponse(url, GITHUB_JSON_ACCEPT);
    if (!response) {
      return undefined;
    }

    try {
      return (await response.json()) as T;
    } catch {
      return undefined;
    }
  }

  private async fetchOptionalText(url: string, accept: string): Promise<string | undefined> {
    const response = await this.fetchOptionalResponse(url, accept);
    if (!response) {
      return undefined;
    }

    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }

  private async fetchOptionalResponse(
    url: string,
    accept: string,
  ): Promise<Response | undefined> {
    try {
      const response = await this.fetchResponse(url, accept);
      if (!response.ok) {
        await this.consumeErrorBody(response);
        return undefined;
      }
      return response;
    } catch {
      return undefined;
    }
  }

  private async fetchResponse(url: string, accept: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: {
          Accept: accept,
          'User-Agent': this.userAgent,
          ...(this.publicToken ? { Authorization: `Bearer ${this.publicToken}` } : {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw new GitHubPublicFetchError(
        `Failed to fetch ${url}: ${toTransportMessage(error)}`,
        {
          code: 'transport',
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async createFetchError(
    response: Response,
    url: string,
  ): Promise<GitHubPublicFetchError> {
    const body = await this.consumeErrorBody(response);
    const code = this.errorCodeForResponse(response);
    const message =
      code === 'not_found'
        ? `GitHub repository not found: ${url}`
        : code === 'rate_limited'
          ? `GitHub API rate limit exceeded for ${url}`
          : `GitHub request failed for ${url} with status ${response.status}`;

    return new GitHubPublicFetchError(message, {
      code,
      status: response.status,
      ...(body.length > 0
        ? { bodyExcerpt: body.slice(0, NON_OK_BODY_EXCERPT_CHARS) }
        : {}),
    });
  }

  private errorCodeForResponse(response: Response): GitHubPublicFetchErrorCode {
    if (response.status === 404) {
      return 'not_found';
    }
    if (
      response.status === 403 &&
      response.headers.get('x-ratelimit-remaining') === '0'
    ) {
      return 'rate_limited';
    }
    return 'unknown';
  }

  private async consumeErrorBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      try {
        await response.body?.cancel();
      } catch {
        // Ignore cancellation failures after a body read failure.
      }
      return '';
    }
  }
}
