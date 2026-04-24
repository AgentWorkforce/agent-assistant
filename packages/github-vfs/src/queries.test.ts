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
