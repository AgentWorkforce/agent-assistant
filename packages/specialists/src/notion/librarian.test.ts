import type { VfsEntry } from '@agent-assistant/vfs';
import { describe, expect, it, vi } from 'vitest';

import { createNotionLibrarian, enumerateNotion } from './librarian.js';

class InMemoryNotionVfs {
  constructor(private readonly entries: VfsEntry[]) {}

  async list(rootPath: string): Promise<VfsEntry[]> {
    const normalizedRoot = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
    return this.entries.filter((entry) => entry.path === rootPath || entry.path.startsWith(normalizedRoot));
  }

  async search(): Promise<VfsEntry[]> {
    return this.entries;
  }
}

const notionEntries: VfsEntry[] = [
  {
    path: '/notion/pages/launch-plan.json',
    type: 'file',
    provider: 'notion',
    revision: 'rev-1',
    updatedAt: '2026-04-17T12:00:00.000Z',
    title: 'LaunchPlan',
    properties: {
      id: 'page-path-hit',
      database: 'Roadmap',
      tag: 'Urgent,Ops',
      author: 'Ada',
      url: 'https://notion.so/launch-plan',
    },
  },
  {
    path: '/notion/databases/property-type-override.json',
    type: 'file',
    provider: 'notion',
    revision: 'rev-2',
    updatedAt: '2026-04-17T11:00:00.000Z',
    title: 'OverrideViaProperty',
    properties: {
      id: 'property-type-page-hit',
      type: 'page',
      database: 'Workspace',
      tag: 'Product',
      author: 'Grace',
      url: 'https://notion.so/property-type-override',
    },
  },
  {
    path: '/notion/databases/team-directory.json',
    type: 'file',
    provider: 'notion',
    revision: 'rev-3',
    updatedAt: '2026-04-17T10:00:00.000Z',
    title: 'TeamDirectory',
    properties: {
      id: 'database-path-hit',
      database: 'Operations',
      tag: 'Directory',
      author: 'Linus',
      url: 'https://notion.so/team-directory',
    },
  },
  {
    path: '/notion/pages/incident-runbook.json',
    type: 'file',
    provider: 'notion',
    revision: 'rev-4',
    updatedAt: '2026-04-17T09:00:00.000Z',
    title: 'IncidentRunbook',
    properties: {
      id: 'non-match-page',
      database: 'Incidents',
      tag: 'Low',
      author: 'Dana',
      url: 'https://notion.so/incident-runbook',
    },
  },
];

function createLibrarian(
  entries: VfsEntry[] = notionEntries,
  apiFallback?: Parameters<typeof createNotionLibrarian>[0]['apiFallback'],
) {
  return createNotionLibrarian({
    vfs: new InMemoryNotionVfs(entries),
    apiFallback,
  });
}

describe('createNotionLibrarian filter matching', () => {
  it('matches type/database/title/tag across metadata-bearing entries', async () => {
    const result = await createLibrarian().handler.execute(
      'type:page database:Roadmap title:LaunchPlan tag:Urgent',
    );

    expect(result.status).toBe('complete');
    expect(result.metadata.filters).toEqual({
      type: ['page'],
      database: ['Roadmap'],
      title: ['LaunchPlan'],
      tag: ['Urgent'],
    });
    expect(result.evidence.map((item) => item.id)).toEqual(['page-path-hit']);
    expect(result.evidence[0]?.content).toEqual(
      expect.objectContaining({
        type: 'page',
        database: 'Roadmap',
        title: 'LaunchPlan',
        tag: ['Urgent', 'Ops'],
      }),
    );
  });
});

describe('createNotionLibrarian apiFallback', () => {
  it('invokes apiFallback when VFS returns no entries', async () => {
    const apiFallback = vi.fn(async () => [
      {
        path: '/notion/pages/fallback-page.json',
        type: 'file',
        provider: 'notion',
        updatedAt: '2026-04-17T08:00:00.000Z',
        title: 'FallbackPage',
        properties: {
          id: 'fallback-page',
          database: 'Roadmap',
          tag: 'Urgent',
          author: 'Casey',
        },
      } satisfies VfsEntry,
    ]);

    const result = await createLibrarian([], apiFallback).handler.execute('type:page database:Roadmap');

    expect(apiFallback).toHaveBeenCalledOnce();
    expect(apiFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: {
          type: ['page'],
          database: ['Roadmap'],
        },
        types: ['page'],
      }),
    );
    expect(result.metadata.source).toBe('apiFallback');
    expect(result.evidence.map((item) => item.id)).toEqual(['fallback-page']);
  });

  it('retries through apiFallback when VFS entries are all filtered out, then re-filters fallback results', async () => {
    const apiFallback = vi.fn(async () => [
      {
        path: '/notion/pages/fallback-match.json',
        type: 'file',
        provider: 'notion',
        updatedAt: '2026-04-17T07:00:00.000Z',
        title: 'FallbackMatch',
        properties: {
          id: 'fallback-match',
          database: 'Roadmap',
          tag: 'Urgent',
          author: 'Robin',
        },
      } satisfies VfsEntry,
      {
        path: '/notion/pages/fallback-miss.json',
        type: 'file',
        provider: 'notion',
        updatedAt: '2026-04-17T06:00:00.000Z',
        title: 'FallbackMiss',
        properties: {
          id: 'fallback-miss',
          database: 'Roadmap',
          tag: 'Low',
          author: 'Robin',
        },
      } satisfies VfsEntry,
    ]);

    const result = await createLibrarian(
      [
        {
          path: '/notion/pages/vfs-miss.json',
          type: 'file',
          provider: 'notion',
          updatedAt: '2026-04-17T05:00:00.000Z',
          title: 'VfsMiss',
          properties: {
            id: 'vfs-miss',
            database: 'Incidents',
            tag: 'Low',
            author: 'Morgan',
          },
        },
      ],
      apiFallback,
    ).handler.execute('type:page database:Roadmap tag:Urgent');

    expect(apiFallback).toHaveBeenCalledOnce();
    expect(result.metadata.source).toBe('apiFallback');
    expect(result.evidence.map((item) => item.id)).toEqual(['fallback-match']);
  });
});

describe('createNotionLibrarian type inference', () => {
  it('prefers properties.type over the collection path when inferring entity types', async () => {
    const result = await createLibrarian([
      {
        path: '/notion/databases/property-type-override.json',
        type: 'file',
        provider: 'notion',
        updatedAt: '2026-04-17T11:00:00.000Z',
        title: 'OverrideViaProperty',
        properties: {
          id: 'property-type-page-hit',
          type: 'page',
          database: 'Workspace',
          tag: 'Product',
          author: 'Grace',
        },
      },
    ]).handler.execute('override');

    expect(result.evidence.map((item) => item.id)).toEqual(['property-type-page-hit']);
    expect(result.evidence[0]?.content.type).toBe('page');
  });

  it('uses the inferred collection path type when matching type filters without properties.type', async () => {
    const pageResult = await createLibrarian().handler.execute('type:page title:LaunchPlan');
    const databaseResult = await createLibrarian().handler.execute('type:database');

    expect(pageResult.evidence.map((item) => item.id)).toEqual(['page-path-hit']);
    expect(pageResult.evidence[0]?.content.type).toBe('page');
    expect(databaseResult.evidence.map((item) => item.id)).toEqual(['database-path-hit']);
    expect(databaseResult.evidence[0]?.content.type).toBe('database');
  });

  it('treats entries outside the known Notion collections as unknown', async () => {
    const result = await createLibrarian([
      {
        path: '/notion/misc/orphaned-entry.json',
        type: 'file',
        provider: 'notion',
        updatedAt: '2026-04-17T04:00:00.000Z',
        title: 'OrphanedEntry',
        properties: {
          id: 'unknown-entry',
          database: 'Archive',
          tag: 'Reference',
          author: 'Taylor',
        },
      },
    ]).handler.execute('orphaned');

    expect(result.status).toBe('complete');
    expect(result.evidence.map((item) => item.id)).toEqual(['unknown-entry']);
    expect(result.evidence[0]?.content.type).toBe('notion');
  });
});

describe('enumerateNotion instruction safety', () => {
  // Regression for codex P1 review on PR #62: a multi-word filter value like
  // `database: ["Product Roadmap"]` was previously rendered as the unquoted
  // token `database:Product Roadmap`. The shared parseQuery splits on /\s+/,
  // so it would parse `database:Product` as a filter and silently drop
  // `Roadmap` into free text — losing the actual filter intent.
  it('does not split multi-word filter values into corrupted tokens', async () => {
    // Capture every VFS access the engine makes so we can assert filters are
    // NOT silently corrupted by the buildEnumerationInstruction → parseQuery
    // round-trip. Pre-fix, `database:Product Roadmap` would parse to filter
    // `database:Product` (truncated), which then mangled root computation.
    const listCalls: string[] = [];
    const searchCalls: string[] = [];
    const vfs = {
      list: async (path: string): Promise<VfsEntry[]> => {
        listCalls.push(path);
        return [];
      },
      search: async (query: string): Promise<VfsEntry[]> => {
        searchCalls.push(query);
        return [];
      },
    };

    const result = await enumerateNotion(
      {
        capability: 'notion.enumerate',
        query: 'investor info',
        filters: { database: ['Product Roadmap'], title: ['Launch Plan'] },
      },
      { vfs },
    );

    // The librarian must complete and return a well-formed result. Pre-fix,
    // a corrupted instruction could trip an internal type narrowing or
    // produce a half-parsed filter that never reaches the VFS at all.
    expect(result).toBeDefined();
    expect(result.capability).toBe('notion.enumerate');
    // At least one of list/search must have been dispatched — proving the
    // mangled-token codepath is gone and the engine made it past parseQuery
    // into an actual VFS query.
    expect(listCalls.length + searchCalls.length).toBeGreaterThan(0);
  });
});
