import type { VfsEntry, VfsProvider, VfsReadResult, VfsSearchResult } from '@agent-assistant/vfs';
import { describe, expect, it } from 'vitest';

import { createLinearLibrarian } from './librarian.js';

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
    return this.entries;
  }
}

const issues: VfsEntry[] = [
  {
    path: '/linear/issues/ENG-101.json',
    type: 'file',
    provider: 'linear',
    revision: 'rev-1',
    updatedAt: '2026-04-17T12:00:00.000Z',
    title: 'Harden token refresh',
    properties: {
      id: 'linear-issue-1',
      type: 'issue',
      identifier: 'ENG-101',
      state: 'open',
      team: 'ENG',
      teamKey: 'ENG',
      url: 'https://linear.app/acme/issue/ENG-101/harden-token-refresh',
    },
  },
  {
    path: '/linear/issues/OPS-202.json',
    type: 'file',
    provider: 'linear',
    revision: 'rev-2',
    updatedAt: '2026-04-17T11:00:00.000Z',
    title: 'Rotate incident webhook secret',
    properties: {
      id: 'linear-issue-2',
      type: 'issue',
      identifier: 'OPS-202',
      state: 'open',
      team: 'OPS',
      teamKey: 'OPS',
      url: 'https://linear.app/acme/issue/OPS-202/rotate-incident-webhook-secret',
    },
  },
  {
    path: '/linear/issues/ENG-303.json',
    type: 'file',
    provider: 'linear',
    revision: 'rev-3',
    updatedAt: '2026-04-17T10:00:00.000Z',
    title: 'Archive legacy OAuth client',
    properties: {
      id: 'linear-issue-3',
      type: 'issue',
      identifier: 'ENG-303',
      state: 'done',
      team: 'ENG',
      teamKey: 'ENG',
      url: 'https://linear.app/acme/issue/ENG-303/archive-legacy-oauth-client',
    },
  },
];

function createLibrarian() {
  return createLinearLibrarian({
    vfs: new InMemoryVfsProvider(issues),
  });
}

function evidenceIdsFor(instruction: string): Promise<string[]> {
  return createLibrarian()
    .handler.execute(instruction)
    .then((result) => result.evidence.map((item) => item.id));
}

describe('createLinearLibrarian filter matching', () => {
  it('matches open issues against only state:open issue entries', async () => {
    await expect(evidenceIdsFor('open issues')).resolves.toEqual(['linear-issue-1', 'linear-issue-2']);
  });

  it('scopes state:open team:ENG to that Linear team', async () => {
    const result = await createLibrarian().handler.execute('state:open team:ENG');

    expect(result.status).toBe('complete');
    expect(result.metadata.filters).toMatchObject({
      state: ['open'],
      team: ['ENG'],
    });
    expect(result.evidence.map((item) => item.id)).toEqual(['linear-issue-1']);
    expect(result.evidence.map((item) => item.content.team)).toEqual(['ENG']);
  });

  it('returns failed status and empty evidence when no Linear issues match', async () => {
    const result = await createLibrarian().handler.execute('state:open team:DESIGN');

    expect(result.status).toBe('failed');
    expect(result.evidence).toEqual([]);
    expect(result.metadata.resultCount).toBe(0);
  });
});
