import { describe, expect, it, vi } from 'vitest';
import type { VfsEntry, VfsProvider } from '@agent-assistant/vfs';
import { listOpenPullRequestsFromVfs } from './queries.js';

function makeProvider(files: Record<string, unknown>): VfsProvider {
  const entries: VfsEntry[] = Object.keys(files).map((path) => ({
    path,
    type: 'file',
    provider: 'github',
    revision: `rev:${path}`,
  }));

  return {
    list: vi.fn(async () => entries),
    read: vi.fn(async (path: string) => {
      const value = files[path];
      return value === undefined ? null : { path, content: JSON.stringify(value) };
    }),
    search: vi.fn(async () => []),
  };
}

describe('listOpenPullRequestsFromVfs', () => {
  it('lists open pull request metadata and preserves source paths', async () => {
    const provider = makeProvider({
      '/github/repos/AgentWorkforce/cloud/pulls/10/metadata.json': {
        number: 10,
        title: 'Fix specialist issuer',
        state: 'open',
        user: { login: 'alice' },
        updated_at: '2026-04-24T14:00:00Z',
        html_url: 'https://github.com/AgentWorkforce/cloud/pull/10',
      },
      '/github/repos/AgentWorkforce/cloud/pulls/11/metadata.json': {
        number: 11,
        title: 'Closed work',
        state: 'closed',
      },
    });

    const prs = await listOpenPullRequestsFromVfs(provider, {
      owner: 'AgentWorkforce',
      repo: 'cloud',
    });

    expect(provider.list).toHaveBeenCalledWith('/github/repos/AgentWorkforce/cloud/pulls', {
      depth: 2,
      limit: 100,
    });
    expect(prs).toEqual([
      expect.objectContaining({
        number: 10,
        title: 'Fix specialist issuer',
        state: 'open',
        author: 'alice',
        sourcePath: '/github/repos/AgentWorkforce/cloud/pulls/10/metadata.json',
      }),
    ]);
  });

  it('returns the newest open PRs by updatedAt when more than limit are present', async () => {
    const files: Record<string, unknown> = {};
    // Create 5 open PRs with ascending PR numbers (which sorts first in path order)
    // but DESCENDING dates so PR #1 is newest. Limit=3 must return [1,2,3] not [3,4,5].
    for (let i = 1; i <= 5; i += 1) {
      const day = String(25 - i).padStart(2, '0');
      files[`/github/repos/AgentWorkforce/cloud/pulls/${i}/metadata.json`] = {
        number: i,
        title: `PR ${i}`,
        state: 'open',
        updated_at: `2026-04-${day}T12:00:00Z`,
      };
    }
    const provider = makeProvider(files);

    const prs = await listOpenPullRequestsFromVfs(
      provider,
      { owner: 'AgentWorkforce', repo: 'cloud' },
      { limit: 3 },
    );

    expect(prs.map((pr) => pr.number)).toEqual([1, 2, 3]);
  });

  it('sorts open pull requests by updated timestamp descending', async () => {
    const provider = makeProvider({
      '/github/repos/AgentWorkforce/cloud/pulls/10/metadata.json': {
        number: 10,
        title: 'Older',
        state: 'open',
        updated_at: '2026-04-23T14:00:00Z',
      },
      '/github/repos/AgentWorkforce/cloud/pulls/12/metadata.json': {
        number: 12,
        title: 'Newer',
        state: 'open',
        updated_at: '2026-04-24T14:00:00Z',
      },
    });

    const prs = await listOpenPullRequestsFromVfs(provider, {
      owner: 'AgentWorkforce',
      repo: 'cloud',
    });

    expect(prs.map((pr) => pr.number)).toEqual([12, 10]);
  });
});
