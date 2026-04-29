import type {
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolRegistry,
  HarnessToolResult,
} from '../types.js';
import {
  GitHubPublicFetcher,
  GitHubPublicFetchError,
  type GitHubPublicFetcherOptions,
  type GitHubPublicReview,
} from './github-public-fetcher.js';

export interface GitHubPublicReviewToolRegistryOptions {
  fetcher?: GitHubPublicFetcher;
  fetcherOptions?: GitHubPublicFetcherOptions;
}

interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

interface ValidationFailure {
  ok: false;
  message: string;
}

type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

type PackageJsonExcerpt = {
  name?: string;
  version?: string;
  scripts?: string[];
};

export const GITHUB_PUBLIC_REVIEW_TOOL_NAME = 'github_public_review';

const GITHUB_PUBLIC_REVIEW_TOOL: HarnessToolDefinition = {
  name: GITHUB_PUBLIC_REVIEW_TOOL_NAME,
  description:
    'Fetch public GitHub repository metadata, README, package.json, top-level paths, and recent commits for review and summarization.',
  inputSchema: {
    type: 'object',
    required: ['owner', 'repo'],
    properties: {
      owner: { type: 'string', minLength: 1 },
      repo: { type: 'string', minLength: 1 },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateInput(
  input: Record<string, unknown>,
): ValidationResult<{ owner: string; repo: string }> {
  const owner = input.owner;
  const repo = input.repo;

  if (typeof owner !== 'string' || owner.trim().length === 0) {
    return { ok: false, message: 'input.owner must be a non-empty string' };
  }

  if (typeof repo !== 'string' || repo.trim().length === 0) {
    return { ok: false, message: 'input.repo must be a non-empty string' };
  }

  return {
    ok: true,
    value: {
      owner: owner.trim(),
      repo: repo.trim(),
    },
  };
}

function errorResult(
  call: HarnessToolCall,
  code: string,
  message: string,
  retryable: boolean,
): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'error',
    error: {
      code,
      message,
      retryable,
    },
  };
}

function unknownToolResult(call: HarnessToolCall): HarnessToolResult {
  return errorResult(call, 'unknown_tool', `Unknown tool: ${call.name}`, false);
}

function invalidRequestResult(call: HarnessToolCall, message: string): HarnessToolResult {
  return errorResult(call, 'invalid_request', message, false);
}

function summarizeReadme(readme: string | undefined): string {
  if (!readme) {
    return '(none)';
  }

  const excerpt = readme.slice(0, 800).trim();
  return excerpt.length > 0 ? excerpt : '(none)';
}

function summarizePackageJson(packageJson: unknown): string {
  if (!isRecord(packageJson)) {
    return '(none)';
  }

  const excerpt: PackageJsonExcerpt = {};
  if (typeof packageJson.name === 'string' && packageJson.name.length > 0) {
    excerpt.name = packageJson.name;
  }
  if (typeof packageJson.version === 'string' && packageJson.version.length > 0) {
    excerpt.version = packageJson.version;
  }
  if (isRecord(packageJson.scripts)) {
    excerpt.scripts = Object.keys(packageJson.scripts);
  }

  const parts = [
    `name=${excerpt.name ?? '(unknown)'}`,
    `version=${excerpt.version ?? '(unknown)'}`,
    `scripts=${excerpt.scripts && excerpt.scripts.length > 0 ? excerpt.scripts.join(', ') : '(none)'}`,
  ];
  return parts.join(' | ');
}

function summarizeTopLevel(
  topLevel: GitHubPublicReview['topLevel'],
): string {
  if (!topLevel || topLevel.length === 0) {
    return '(none)';
  }
  return topLevel.map((entry) => entry.path).join(', ');
}

function summarizeCommits(
  commits: GitHubPublicReview['recentCommits'],
): string[] {
  if (!commits || commits.length === 0) {
    return ['(none)'];
  }

  return commits.map((commit) => {
    const sha = commit.sha.slice(0, 7);
    const date = commit.authorDate;
    const message = commit.message.replace(/\s+/g, ' ').slice(0, 80);
    return `${sha}  ${date}  ${message}`;
  });
}

function renderOutput(review: GitHubPublicReview): string {
  const lines = [
    `# ${review.owner}/${review.repo}`,
    `Description: ${review.description ?? '(none)'}`,
    `Stars: ${review.stargazersCount ?? '(unknown)'}`,
    `Default branch: ${review.defaultBranch ?? '(unknown)'}`,
    `License: ${review.license ?? '(none)'}`,
    '## README excerpt',
    summarizeReadme(review.readme),
    '## package.json excerpt',
    summarizePackageJson(review.packageJson),
    '## Top-level',
    summarizeTopLevel(review.topLevel),
    '## Recent commits',
    ...summarizeCommits(review.recentCommits),
  ];

  return lines.join('\n');
}

function toStructuredOutput(review: GitHubPublicReview): Record<string, unknown> {
  return review as unknown as Record<string, unknown>;
}

export function createGitHubPublicReviewToolRegistry(
  options: GitHubPublicReviewToolRegistryOptions = {},
): HarnessToolRegistry {
  const fetcher = options.fetcher ?? new GitHubPublicFetcher(options.fetcherOptions);

  return {
    async listAvailable() {
      return [GITHUB_PUBLIC_REVIEW_TOOL];
    },

    async execute(call) {
      if (call.name !== GITHUB_PUBLIC_REVIEW_TOOL_NAME) {
        return unknownToolResult(call);
      }

      const validation = validateInput(call.input);
      if (!validation.ok) {
        return invalidRequestResult(call, validation.message);
      }

      try {
        const review = await fetcher.fetchReview(validation.value.owner, validation.value.repo);
        return {
          callId: call.id,
          toolName: call.name,
          status: 'success',
          output: renderOutput(review),
          structuredOutput: toStructuredOutput(review),
        };
      } catch (error) {
        if (error instanceof GitHubPublicFetchError) {
          return errorResult(
            call,
            error.code,
            error.message,
            error.code === 'rate_limited',
          );
        }

        return errorResult(call, 'unknown', String(error), false);
      }
    },
  };
}
