import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GitHubPublicFetcher,
  GitHubPublicFetchError,
} from './github-public-fetcher.js';

const BASE_URL = 'https://api.github.com/repos/acme/widgets';

function headersObject(headers?: HeadersInit): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...headersObject(init.headers),
    },
  });
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: headersObject(init.headers),
  });
}

function packageJsonContent(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function makeHappyPathResponses(
  overrides: Partial<Record<string, Response>> = {},
): Record<string, Response> {
  return {
    [BASE_URL]: jsonResponse({
      description: 'Public widgets',
      stargazers_count: 42,
      open_issues_count: 7,
      default_branch: 'main',
      html_url: 'https://github.com/acme/widgets',
      license: { spdx_id: 'MIT' },
    }),
    [`${BASE_URL}/readme`]: textResponse('# Widgets\nA public widgets repo.'),
    [`${BASE_URL}/contents/package.json`]: jsonResponse({
      content: packageJsonContent(
        JSON.stringify({
          name: '@acme/widgets',
          version: '1.2.3',
          scripts: {
            test: 'vitest run',
          },
        }),
      ),
    }),
    [`${BASE_URL}/contents/`]: jsonResponse([
      { path: 'package.json', type: 'file' },
      { path: 'src', type: 'dir' },
    ]),
    [`${BASE_URL}/commits?per_page=5`]: jsonResponse([
      {
        sha: 'abcdef1234567890',
        commit: {
          message: 'Initial release',
          author: { date: '2026-04-28T00:00:00Z' },
        },
      },
      {
        sha: 'fedcba0987654321',
        commit: {
          message: 'Fix widget issue',
          author: { date: '2026-04-27T00:00:00Z' },
        },
      },
    ]),
    ...overrides,
  };
}

function makeFetchMock(
  responses: Record<string, Response>,
): typeof globalThis.fetch & ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const response = responses[url];
    if (!response) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    return response;
  }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GitHubPublicFetcher', () => {
  it('populates all review fields on the happy path', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock(makeHappyPathResponses()),
    });

    const review = await fetcher.fetchReview('acme', 'widgets');

    expect(review).toEqual({
      owner: 'acme',
      repo: 'widgets',
      description: 'Public widgets',
      license: 'MIT',
      stargazersCount: 42,
      openIssuesCount: 7,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/acme/widgets',
      readme: '# Widgets\nA public widgets repo.',
      packageJson: {
        name: '@acme/widgets',
        version: '1.2.3',
        scripts: {
          test: 'vitest run',
        },
      },
      topLevel: [
        { path: 'package.json', type: 'file' },
        { path: 'src', type: 'dir' },
      ],
      recentCommits: [
        {
          sha: 'abcdef1234567890',
          message: 'Initial release',
          authorDate: '2026-04-28T00:00:00Z',
        },
        {
          sha: 'fedcba0987654321',
          message: 'Fix widget issue',
          authorDate: '2026-04-27T00:00:00Z',
        },
      ],
    });
  });

  it('throws not_found when the repo metadata endpoint returns 404', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock({
        [BASE_URL]: textResponse('not found', { status: 404 }),
      }),
    });

    await expect(fetcher.fetchReview('acme', 'widgets')).rejects.toMatchObject({
      name: 'GitHubPublicFetchError',
      code: 'not_found',
      status: 404,
    } satisfies Partial<GitHubPublicFetchError>);
  });

  it('throws rate_limited when the repo metadata endpoint returns a GitHub rate limit response', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock({
        [BASE_URL]: textResponse('rate limit', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        }),
      }),
    });

    await expect(fetcher.fetchReview('acme', 'widgets')).rejects.toMatchObject({
      name: 'GitHubPublicFetchError',
      code: 'rate_limited',
      status: 403,
    } satisfies Partial<GitHubPublicFetchError>);
  });

  it('rejects invalid owner input before calling fetch', async () => {
    const fetchMock = makeFetchMock(makeHappyPathResponses());
    const fetcher = new GitHubPublicFetcher({ fetchImpl: fetchMock });

    await expect(fetcher.fetchReview('foo/bar', 'widgets')).rejects.toMatchObject({
      name: 'GitHubPublicFetchError',
      code: 'invalid_request',
    } satisfies Partial<GitHubPublicFetchError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits readme when the README endpoint returns 404', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock(
        makeHappyPathResponses({
          [`${BASE_URL}/readme`]: textResponse('not found', { status: 404 }),
        }),
      ),
    });

    const review = await fetcher.fetchReview('acme', 'widgets');

    expect(review.readme).toBeUndefined();
    expect(review.packageJson).toBeDefined();
  });

  it('omits packageJson when package.json content is malformed', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock(
        makeHappyPathResponses({
          [`${BASE_URL}/contents/package.json`]: jsonResponse({
            content: packageJsonContent('{invalid json'),
          }),
        }),
      ),
    });

    const review = await fetcher.fetchReview('acme', 'widgets');

    expect(review.packageJson).toBeUndefined();
    expect(review.topLevel).toEqual([
      { path: 'package.json', type: 'file' },
      { path: 'src', type: 'dir' },
    ]);
  });

  it('omits topLevel when the contents endpoint returns a single file payload', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock(
        makeHappyPathResponses({
          [`${BASE_URL}/contents/`]: jsonResponse({
            path: 'package.json',
            type: 'file',
          }),
        }),
      ),
    });

    const review = await fetcher.fetchReview('acme', 'widgets');

    expect(review.topLevel).toBeUndefined();
    expect(review.recentCommits).toBeDefined();
  });

  it('truncates README content when it exceeds readmeMaxChars', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock(
        makeHappyPathResponses({
          [`${BASE_URL}/readme`]: textResponse('0123456789abcdef'),
        }),
      ),
      readmeMaxChars: 8,
    });

    const review = await fetcher.fetchReview('acme', 'widgets');

    expect(review.readme).toBe('01234567\n[truncated]');
    expect(review.readme?.endsWith('[truncated]')).toBe(true);
  });

  it('respects the commitsCount option when requesting recent commits', async () => {
    const fetchMock = makeFetchMock({
      ...makeHappyPathResponses(),
      [`${BASE_URL}/commits?per_page=2`]: jsonResponse([
        {
          sha: '1111111111111111',
          commit: {
            message: 'Commit one',
            author: { date: '2026-04-26T00:00:00Z' },
          },
        },
        {
          sha: '2222222222222222',
          commit: {
            message: 'Commit two',
            author: { date: '2026-04-25T00:00:00Z' },
          },
        },
      ]),
    });
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: fetchMock,
      commitsCount: 2,
    });

    const review = await fetcher.fetchReview('acme', 'widgets');

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/commits?per_page=2`,
      expect.any(Object),
    );
    expect(review.recentCommits).toEqual([
      {
        sha: '1111111111111111',
        message: 'Commit one',
        authorDate: '2026-04-26T00:00:00Z',
      },
      {
        sha: '2222222222222222',
        message: 'Commit two',
        authorDate: '2026-04-25T00:00:00Z',
      },
    ]);
  });

  it('uses globalThis.fetch by default when no fetchImpl is provided', async () => {
    const fetchMock = makeFetchMock(makeHappyPathResponses());
    vi.stubGlobal('fetch', fetchMock);
    const fetcher = new GitHubPublicFetcher();

    const review = await fetcher.fetchReview('acme', 'widgets');

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(review.owner).toBe('acme');
    expect(review.repo).toBe('widgets');
  });

  it('lists public repo trees with optional ref and truncates large directories', async () => {
    const entries = Array.from({ length: 102 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      type: 'file',
      size: index,
      sha: `sha-${index}`,
    }));
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock({
        [`${BASE_URL}/contents/src?ref=main`]: jsonResponse(entries),
      }),
    });

    const tree = await fetcher.listTree('acme', 'widgets', { path: 'src', ref: 'main' });

    expect(tree).toHaveLength(100);
    expect(tree[0]).toEqual({
      path: 'src/file-0.ts',
      type: 'file',
      size: 0,
      sha: 'sha-0',
    });
    expect(tree.at(-1)).toEqual({
      path: '...',
      type: 'truncated',
      omittedCount: 3,
    });
  });

  it('reads a public repo file and supports focused line ranges', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock({
        [`${BASE_URL}/contents/src/index.ts?ref=main`]: jsonResponse({
          type: 'file',
          path: 'src/index.ts',
          sha: 'file-sha',
          size: 33,
          content: packageJsonContent('line one\nline two\nline three'),
        }),
      }),
    });

    const result = await fetcher.readFile('acme', 'widgets', 'src/index.ts', {
      ref: 'main',
      lineRange: { start: 2, end: 3 },
    });

    expect(result).toEqual({
      path: 'src/index.ts',
      content: 'line two\nline three',
      sha: 'file-sha',
      size: 33,
      truncated: false,
    });
  });

  it('fetches recent commits scoped to a path', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock({
        [`${BASE_URL}/commits?per_page=3&path=src%2Findex.ts`]: jsonResponse([
          {
            sha: 'abc123',
            commit: {
              message: 'Touch entrypoint',
              author: {
                name: 'A. Developer',
                date: '2026-05-01T00:00:00Z',
              },
            },
          },
        ]),
      }),
    });

    await expect(
      fetcher.recentCommits('acme', 'widgets', { path: 'src/index.ts', limit: 3 }),
    ).resolves.toEqual([
      {
        sha: 'abc123',
        message: 'Touch entrypoint',
        authorName: 'A. Developer',
        authorDate: '2026-05-01T00:00:00Z',
      },
    ]);
  });

  it('searches code only when a public token is configured', async () => {
    const expectedUrl = new URL('https://api.github.com/search/code');
    expectedUrl.searchParams.set('q', 'createHarness repo:acme/widgets path:src');
    expectedUrl.searchParams.set('per_page', '30');
    const fetchMock = makeFetchMock({
      [expectedUrl.toString()]: jsonResponse({
        items: [
          {
            path: 'src/index.ts',
            text_matches: [{ fragment: 'export function createHarness() {}' }],
          },
        ],
      }),
    });
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: fetchMock,
      publicToken: 'ghp_test',
    });

    expect(fetcher.canSearchCode()).toBe(true);
    await expect(
      fetcher.searchCode('acme', 'widgets', 'createHarness', { path: 'src' }),
    ).resolves.toEqual([
      {
        path: 'src/index.ts',
        lineMatches: [{ lineNumber: 1, text: 'export function createHarness() {}' }],
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expectedUrl.toString(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test',
        }),
      }),
    );
  });

  it('rejects code search when no public token is configured', async () => {
    const fetcher = new GitHubPublicFetcher({
      fetchImpl: makeFetchMock({}),
    });

    expect(fetcher.canSearchCode()).toBe(false);
    await expect(fetcher.searchCode('acme', 'widgets', 'foo')).rejects.toMatchObject({
      name: 'GitHubPublicFetchError',
      code: 'invalid_request',
    } satisfies Partial<GitHubPublicFetchError>);
  });
});
