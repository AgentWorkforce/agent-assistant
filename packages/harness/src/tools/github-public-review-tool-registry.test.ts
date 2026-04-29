import { describe, expect, it, vi } from 'vitest';

import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolExecutionContext,
} from '../types.js';
import {
  createGitHubPublicReviewToolRegistry,
  GITHUB_PUBLIC_REVIEW_TOOL_NAME,
} from './github-public-review-tool-registry.js';
import {
  GitHubPublicFetchError,
  type GitHubPublicReview,
} from './github-public-fetcher.js';

const AVAILABILITY_INPUT: HarnessToolAvailabilityInput = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
};

const EXECUTION_CONTEXT: HarnessToolExecutionContext = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
  iteration: 0,
  toolCallIndex: 0,
};

function makeCall(input: Record<string, unknown>): HarnessToolCall {
  return {
    id: 'call-1',
    name: GITHUB_PUBLIC_REVIEW_TOOL_NAME,
    input,
  };
}

function makeFetcher(fetchReview: ReturnType<typeof vi.fn>) {
  return {
    fetchReview,
  } as unknown as {
    fetchReview: typeof fetchReview;
  };
}

describe('createGitHubPublicReviewToolRegistry', () => {
  it('listAvailable returns the github_public_review tool', async () => {
    const registry = createGitHubPublicReviewToolRegistry();

    const tools = await registry.listAvailable(AVAILABILITY_INPUT);

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe(GITHUB_PUBLIC_REVIEW_TOOL_NAME);
  });

  it('returns success with structured output and a rendered heading on the happy path', async () => {
    const review: GitHubPublicReview = {
      owner: 'acme',
      repo: 'widgets',
      description: 'Public widgets',
      license: 'MIT',
      stargazersCount: 42,
      defaultBranch: 'main',
      readme: '# Widgets',
      packageJson: { name: '@acme/widgets' },
      topLevel: [{ path: 'src', type: 'dir' }],
      recentCommits: [
        {
          sha: 'abcdef1234567890',
          message: 'Initial release',
          authorDate: '2026-04-28T00:00:00Z',
        },
      ],
    };
    const fetchReview = vi.fn().mockResolvedValue(review);
    const registry = createGitHubPublicReviewToolRegistry({
      fetcher: makeFetcher(fetchReview) as never,
    });

    const result = await registry.execute(
      makeCall({ owner: 'acme', repo: 'widgets' }),
      EXECUTION_CONTEXT,
    );

    expect(fetchReview).toHaveBeenCalledWith('acme', 'widgets');
    expect(result.status).toBe('success');
    expect(result.structuredOutput).toEqual(review as unknown as Record<string, unknown>);
    expect(result.output).toContain('# acme/widgets');
  });

  it('maps not_found fetch errors to a non-retryable error result', async () => {
    const registry = createGitHubPublicReviewToolRegistry({
      fetcher: makeFetcher(
        vi.fn().mockRejectedValue(
          new GitHubPublicFetchError('missing repo', {
            code: 'not_found',
            status: 404,
          }),
        ),
      ) as never,
    });

    const result = await registry.execute(
      makeCall({ owner: 'acme', repo: 'widgets' }),
      EXECUTION_CONTEXT,
    );

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'not_found',
        retryable: false,
      },
    });
  });

  it('maps rate_limited fetch errors to a retryable error result', async () => {
    const registry = createGitHubPublicReviewToolRegistry({
      fetcher: makeFetcher(
        vi.fn().mockRejectedValue(
          new GitHubPublicFetchError('rate limited', {
            code: 'rate_limited',
            status: 403,
          }),
        ),
      ) as never,
    });

    const result = await registry.execute(
      makeCall({ owner: 'acme', repo: 'widgets' }),
      EXECUTION_CONTEXT,
    );

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'rate_limited',
        retryable: true,
      },
    });
  });

  it('returns invalid_request when owner is missing', async () => {
    const fetchReview = vi.fn();
    const registry = createGitHubPublicReviewToolRegistry({
      fetcher: makeFetcher(fetchReview) as never,
    });

    const result = await registry.execute(makeCall({ repo: 'widgets' }), EXECUTION_CONTEXT);

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'invalid_request',
        retryable: false,
      },
    });
    expect(fetchReview).not.toHaveBeenCalled();
  });

  it('forwards the injected fetcher and trimmed owner/repo values', async () => {
    const fetchReview = vi.fn().mockResolvedValue({
      owner: 'acme',
      repo: 'widgets',
    } satisfies GitHubPublicReview);
    const registry = createGitHubPublicReviewToolRegistry({
      fetcher: makeFetcher(fetchReview) as never,
    });

    await registry.execute(
      makeCall({ owner: '  acme  ', repo: '  widgets  ' }),
      EXECUTION_CONTEXT,
    );

    expect(fetchReview).toHaveBeenCalledTimes(1);
    expect(fetchReview).toHaveBeenCalledWith('acme', 'widgets');
  });
});
