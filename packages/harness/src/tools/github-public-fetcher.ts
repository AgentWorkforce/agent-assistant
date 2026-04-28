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
  recentCommits?: Array<{ sha: string; message: string; authorDate: string }>;
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
}

const DEFAULT_USER_AGENT = 'agent-assistant-harness';
const DEFAULT_README_MAX_CHARS = 16_384;
const DEFAULT_COMMITS_COUNT = 5;
const MAX_COMMITS_COUNT = 20;
const README_TRUNCATION_MARKER = '\n[truncated]';
const GITHUB_JSON_ACCEPT = 'application/vnd.github+json';
const GITHUB_RAW_ACCEPT = 'application/vnd.github.raw';
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
}

interface GitHubCommitResponse {
  sha?: unknown;
  commit?: {
    message?: unknown;
    author?: {
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

function truncateReadme(readme: string, maxChars: number): string {
  if (readme.length <= maxChars) {
    return readme;
  }
  return `${readme.slice(0, maxChars)}${README_TRUNCATION_MARKER}`;
}

function toTransportMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export class GitHubPublicFetcher {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly userAgent: string;
  private readonly readmeMaxChars: number;
  private readonly commitsCount: number;

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
  }

  async fetchReview(owner: string, repo: string): Promise<GitHubPublicReview> {
    this.validateRepoSegment(owner, 'owner');
    this.validateRepoSegment(repo, 'repo');

    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
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

    const recentCommits = await this.fetchOptionalRecentCommits(
      `${baseUrl}/commits?per_page=${this.commitsCount}`,
    );
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

  private async fetchRequiredJson<T>(url: string): Promise<T> {
    const response = await this.fetchResponse(url, GITHUB_JSON_ACCEPT);
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
      return JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8')) as unknown;
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

  private async fetchOptionalRecentCommits(
    url: string,
  ): Promise<Array<{ sha: string; message: string; authorDate: string }> | undefined> {
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
      const authorDate = optionalString(commitEntry.commit?.author?.date);
      if (!sha || !message || !authorDate) {
        return [];
      }

      return [{ sha, message, authorDate }];
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
    try {
      return await this.fetchImpl(url, {
        headers: {
          Accept: accept,
          'User-Agent': this.userAgent,
        },
      });
    } catch (error) {
      throw new GitHubPublicFetchError(
        `Failed to fetch ${url}: ${toTransportMessage(error)}`,
        {
          code: 'transport',
        },
      );
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
