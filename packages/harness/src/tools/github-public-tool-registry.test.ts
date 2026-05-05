import { describe, expect, it, vi } from 'vitest';

import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolExecutionContext,
} from '../types.js';
import {
  GitHubPublicFetchError,
  type GitHubPublicFetcher,
} from './github-public-fetcher.js';
import {
  createPublicGitHubToolRegistry,
  PUBLIC_REPO_LIST_TREE_TOOL_NAME,
  PUBLIC_REPO_METADATA_TOOL_NAME,
  PUBLIC_REPO_READ_FILE_TOOL_NAME,
  PUBLIC_REPO_RECENT_COMMITS_TOOL_NAME,
  PUBLIC_REPO_SEARCH_CODE_TOOL_NAME,
  publicRepoAlternativesFor,
} from './github-public-tool-registry.js';

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

function makeCall(name: string, input: Record<string, unknown> = {}): HarnessToolCall {
  return {
    id: 'call-1',
    name,
    input,
  };
}

function makeFetcher(overrides: Partial<GitHubPublicFetcher>): GitHubPublicFetcher {
  return {
    canSearchCode: () => false,
    fetchMetadata: vi.fn(),
    listTree: vi.fn(),
    readFile: vi.fn(),
    recentCommits: vi.fn(),
    searchCode: vi.fn(),
    ...overrides,
  } as unknown as GitHubPublicFetcher;
}

describe('createPublicGitHubToolRegistry', () => {
  it('lists bounded public repo tools and hides code search without a token', async () => {
    const registry = createPublicGitHubToolRegistry({
      owner: 'acme',
      repo: 'widgets',
      fetcher: makeFetcher({ canSearchCode: () => false }),
    });

    const tools = await registry.listAvailable(AVAILABILITY_INPUT);

    expect(tools.map((tool) => tool.name)).toEqual([
      PUBLIC_REPO_METADATA_TOOL_NAME,
      PUBLIC_REPO_LIST_TREE_TOOL_NAME,
      PUBLIC_REPO_READ_FILE_TOOL_NAME,
      PUBLIC_REPO_RECENT_COMMITS_TOOL_NAME,
    ]);
  });

  it('includes code search when the fetcher can search code', async () => {
    const registry = createPublicGitHubToolRegistry({
      owner: 'acme',
      repo: 'widgets',
      fetcher: makeFetcher({ canSearchCode: () => true }),
    });

    const tools = await registry.listAvailable(AVAILABILITY_INPUT);

    expect(tools.map((tool) => tool.name)).toContain(PUBLIC_REPO_SEARCH_CODE_TOOL_NAME);
  });

  it('executes metadata against the bound owner and repo', async () => {
    const fetchMetadata = vi.fn().mockResolvedValue({
      owner: 'acme',
      repo: 'widgets',
      readmeExcerpt: '# Widgets',
    });
    const registry = createPublicGitHubToolRegistry({
      owner: ' acme ',
      repo: ' widgets ',
      fetcher: makeFetcher({ fetchMetadata }),
    });

    const result = await registry.execute(
      makeCall(PUBLIC_REPO_METADATA_TOOL_NAME),
      EXECUTION_CONTEXT,
    );

    expect(fetchMetadata).toHaveBeenCalledWith('acme', 'widgets');
    expect(result.status).toBe('success');
    expect(result.structuredOutput).toEqual({
      result: {
        owner: 'acme',
        repo: 'widgets',
        readmeExcerpt: '# Widgets',
      },
    });
  });

  it('validates and executes focused file reads', async () => {
    const readFile = vi.fn().mockResolvedValue({
      path: 'src/index.ts',
      content: 'line two',
      truncated: false,
    });
    const registry = createPublicGitHubToolRegistry({
      owner: 'acme',
      repo: 'widgets',
      fetcher: makeFetcher({ readFile }),
    });

    const result = await registry.execute(
      makeCall(PUBLIC_REPO_READ_FILE_TOOL_NAME, {
        path: 'src/index.ts',
        ref: 'main',
        lineRange: { start: 2, end: 2 },
      }),
      EXECUTION_CONTEXT,
    );

    expect(readFile).toHaveBeenCalledWith('acme', 'widgets', 'src/index.ts', {
      path: 'src/index.ts',
      ref: 'main',
      lineRange: { start: 2, end: 2 },
    });
    expect(result.status).toBe('success');
  });

  it('maps fetch rate limits to retryable tool errors', async () => {
    const registry = createPublicGitHubToolRegistry({
      owner: 'acme',
      repo: 'widgets',
      fetcher: makeFetcher({
        listTree: vi.fn().mockRejectedValue(
          new GitHubPublicFetchError('rate limit', {
            code: 'rate_limited',
            status: 403,
          }),
        ),
      }),
    });

    const result = await registry.execute(
      makeCall(PUBLIC_REPO_LIST_TREE_TOOL_NAME, { path: 'src' }),
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

  it('returns idempotency alternatives for public repo navigation tools', () => {
    expect(publicRepoAlternativesFor(makeCall(PUBLIC_REPO_READ_FILE_TOOL_NAME))).toEqual([
      expect.stringContaining('already read this public repo file'),
    ]);
    expect(publicRepoAlternativesFor(makeCall('workspace_read'))).toEqual([]);
  });
});
