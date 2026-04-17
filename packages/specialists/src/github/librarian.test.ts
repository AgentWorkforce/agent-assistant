import type { VfsEntry, VfsProvider, VfsReadResult, VfsSearchResult } from '@agent-assistant/vfs';
import { describe, expect, it } from 'vitest';

import { createGitHubLibrarian } from './librarian.js';

class InMemoryVfsProvider implements VfsProvider {
  constructor(private readonly entries: VfsEntry[]) {}

  async list(rootPath: string): Promise<VfsEntry[]> {
    const normalizedRoot = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
    return this.entries.filter((entry) => entry.path === rootPath || entry.path.startsWith(normalizedRoot));
  }

  async read(): Promise<VfsReadResult | null> {
    return null;
  }

  async search(): Promise<VfsSearchResult[]> {
    return [];
  }
}

const pullRequests: VfsEntry[] = [
  {
    path: '/github/repos/foo/bar/pulls/1',
    type: 'file',
    provider: 'github',
    revision: 'rev-1',
    updatedAt: '2026-04-17T12:00:00.000Z',
    title: 'Patch token validation',
    properties: {
      id: 'foo-bar-pr-1',
      type: 'pr',
      repo: 'foo/bar',
      number: '1',
      state: 'open',
      label: 'security,backend',
      url: 'https://github.com/foo/bar/pull/1',
    },
  },
  {
    path: '/github/repos/baz/qux/pulls/2',
    type: 'file',
    provider: 'github',
    revision: 'rev-2',
    updatedAt: '2026-04-17T11:00:00.000Z',
    title: 'Fix retry logging',
    properties: {
      id: 'baz-qux-pr-2',
      type: 'pull_request',
      repo: 'baz/qux',
      number: '2',
      state: 'open',
      label: 'observability',
      url: 'https://github.com/baz/qux/pull/2',
    },
  },
  {
    path: '/github/repos/foo/bar/pulls/3',
    type: 'file',
    provider: 'github',
    revision: 'rev-3',
    updatedAt: '2026-04-17T10:00:00.000Z',
    title: 'Close stale dependency update',
    properties: {
      id: 'foo-bar-pr-3',
      type: 'pr',
      repo: 'foo/bar',
      number: '3',
      state: 'closed',
      label: 'dependencies',
      url: 'https://github.com/foo/bar/pull/3',
    },
  },
];

function createLibrarian() {
  return createGitHubLibrarian({
    vfs: new InMemoryVfsProvider(pullRequests),
  });
}

function evidenceIdsFor(instruction: string): Promise<string[]> {
  return createLibrarian()
    .handler.execute(instruction)
    .then((result) => result.evidence.map((item) => item.id));
}

describe('createGitHubLibrarian filter matching', () => {
  it('matches state:open against only open PR entries', async () => {
    await expect(evidenceIdsFor('state:open')).resolves.toEqual(['foo-bar-pr-1', 'baz-qux-pr-2']);
  });

  it('matches state:open label:security against the open security PR', async () => {
    const result = await createLibrarian().handler.execute('state:open label:security');

    expect(result.status).toBe('complete');
    expect(result.evidence.map((item) => item.id)).toEqual(['foo-bar-pr-1']);
    expect(result.evidence[0]?.content).toEqual(
      expect.objectContaining({
        type: 'pr',
        repo: 'foo/bar',
        state: 'open',
        labels: ['security', 'backend'],
        number: '1',
      }),
    );
  });

  it('scopes type:pr repo:foo/bar to that repository', async () => {
    const result = await createLibrarian().handler.execute('type:pr repo:foo/bar');

    expect(result.status).toBe('complete');
    expect(result.metadata.filters).toEqual({
      type: ['pr'],
      repo: ['foo/bar'],
    });
    expect(result.evidence.map((item) => item.id)).toEqual(['foo-bar-pr-1', 'foo-bar-pr-3']);
    expect(result.evidence.map((item) => item.content.repo)).toEqual(['foo/bar', 'foo/bar']);
  });
});
