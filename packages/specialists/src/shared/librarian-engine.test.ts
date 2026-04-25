import type { VfsEntry } from '@agent-assistant/vfs';
import { describe, expect, it, vi } from 'vitest';

import {
  createLibrarian,
  type LibrarianAdapter,
  type LibrarianVfs,
} from './librarian-engine.js';

type TestEntityType = 'pr' | 'issue';

const testAdapter: LibrarianAdapter<TestEntityType> = {
  capability: 'test.enumerate',
  entityTypes: ['pr', 'issue'],
  filterKeys: ['state', 'type'],
  listRoots(types) {
    return types.length > 0 ? types.map((type) => `/root/${type}`) : ['/root'];
  },
  inferFilters(_text, filters) {
    return filters;
  },
  valuesForFilter(entry, key) {
    const properties = entry.properties ?? {};
    if (key === 'type') {
      const type = inferEntityType(entry);
      return [properties.type, type === 'unknown' ? undefined : type].filter(isString);
    }

    return [properties.state].filter(isString);
  },
  inferEntityType,
  toEvidence(entry, type) {
    const properties = entry.properties ?? {};
    return {
      id: properties.id ?? entry.path,
      kind: 'test_hit',
      content: {
        path: entry.path,
        state: properties.state,
        type,
      },
    };
  },
  searchProvider: 'test',
  searchTerm(type) {
    return type;
  },
};

function inferEntityType(entry: VfsEntry): TestEntityType | 'unknown' {
  const propertyType = entry.properties?.type;
  if (propertyType === 'pr' || propertyType === 'issue') return propertyType;
  if (entry.path.includes('/pr/')) return 'pr';
  if (entry.path.includes('/issue/')) return 'issue';
  return 'unknown';
}

function entry(id: string, properties: Record<string, string> = {}): VfsEntry {
  const type = properties.type ?? 'pr';
  return {
    path: `/root/${type}/${id}`,
    type: 'file',
    provider: 'test',
    updatedAt: '2026-04-17T12:00:00.000Z',
    properties: {
      id,
      ...properties,
    },
  };
}

function evidenceIds(result: Awaited<ReturnType<ReturnType<typeof createTestLibrarian>['handler']['execute']>>) {
  return result.evidence.map((item) => item.id);
}

function createTestLibrarian(vfs: LibrarianVfs, apiFallback?: Parameters<typeof createLibrarian<TestEntityType>>[1]['apiFallback']) {
  return createLibrarian(testAdapter, {
    vfs,
    apiFallback,
  });
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

describe('createLibrarian VFS enumeration flow', () => {
  it('uses metadata-bearing enumerate for filtered requests when available', async () => {
    const list = vi.fn(async () => [entry('list-hit', { state: 'open', type: 'pr' })]);
    const enumerate = vi.fn(async () => [entry('enumerate-hit', { state: 'open', type: 'pr' })]);
    const librarian = createTestLibrarian({ list, enumerate });

    const result = await librarian.handler.execute('type:pr state:open');

    expect(enumerate).toHaveBeenCalledWith({
      roots: ['/root/pr'],
      filters: { type: ['pr'], state: ['open'] },
      limit: 1_000,
    });
    expect(list).not.toHaveBeenCalled();
    expect(result.metadata.source).toBe('vfs-enumerate');
    expect(evidenceIds(result)).toEqual(['enumerate-hit']);
  });

  it('does not use enumerate for unfiltered requests', async () => {
    const enumerate = vi.fn(async () => [entry('enumerate-hit')]);
    const search = vi.fn(async () => [entry('search-hit')]);
    const librarian = createTestLibrarian({ enumerate, search });

    const result = await librarian.handler.execute('plain text');

    expect(enumerate).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith('plain text', { provider: 'test', limit: 1_000 });
    expect(result.metadata.source).toBe('vfs-search');
    expect(evidenceIds(result)).toEqual(['search-hit']);
  });

  it('falls back to list when enumerate is unavailable', async () => {
    const list = vi.fn(async () => [entry('list-hit', { state: 'open', type: 'pr' })]);
    const librarian = createTestLibrarian({ list });

    const result = await librarian.handler.execute('type:pr state:open');

    expect(list).toHaveBeenCalledWith('/root/pr', { depth: 5, limit: 1_000 });
    expect(result.metadata.source).toBe('vfs-list');
    expect(evidenceIds(result)).toEqual(['list-hit']);
  });

  it('retries apiFallback when filtered VFS entries are all removed by post-filtering', async () => {
    const closedEntries = Array.from({ length: 100 }, (_value, index) =>
      entry(String(index), { state: 'closed', type: 'pr' }),
    );
    const list = vi.fn(async () => closedEntries);
    const apiFallback = vi.fn(async () =>
      Array.from({ length: 5 }, (_value, index) =>
        entry(`fallback-${index}`, { state: 'open', type: 'pr' }),
      ),
    );
    const librarian = createTestLibrarian({ list }, apiFallback);

    const result = await librarian.handler.execute('type:pr state:open');

    expect(apiFallback).toHaveBeenCalledOnce();
    expect(result.metadata.source).toBe('apiFallback');
    expect(evidenceIds(result)).toEqual([
      'fallback-0',
      'fallback-1',
      'fallback-2',
      'fallback-3',
      'fallback-4',
    ]);
  });

  it('does not retry apiFallback for unfiltered VFS results', async () => {
    const search = vi.fn(async () => [entry('unknown-hit', {})]);
    const apiFallback = vi.fn(async () => [entry('fallback-hit')]);
    const librarian = createTestLibrarian({ search }, apiFallback);

    const result = await librarian.handler.execute('plain text');

    expect(apiFallback).not.toHaveBeenCalled();
    expect(result.metadata.source).toBe('vfs-search');
    expect(evidenceIds(result)).toEqual(['unknown-hit']);
  });

  it('still uses apiFallback when the VFS path returns no entries', async () => {
    const list = vi.fn(async () => []);
    const apiFallback = vi.fn(async () => [entry('fallback-hit', { state: 'open', type: 'pr' })]);
    const librarian = createTestLibrarian({ list }, apiFallback);

    const result = await librarian.handler.execute('type:pr state:open');

    expect(apiFallback).toHaveBeenCalledOnce();
    expect(result.metadata.source).toBe('apiFallback');
    expect(evidenceIds(result)).toEqual(['fallback-hit']);
  });

  it('captures enumerate errors and continues to apiFallback', async () => {
    const enumerate = vi.fn(async () => {
      throw new Error('indexed enumeration unavailable');
    });
    const apiFallback = vi.fn(async () => [entry('fallback-hit', { state: 'open', type: 'pr' })]);
    const librarian = createTestLibrarian({ enumerate }, apiFallback);

    const result = await librarian.handler.execute('type:pr state:open');

    expect(apiFallback).toHaveBeenCalledOnce();
    expect(result.status).toBe('partial');
    expect(result.metadata.source).toBe('mixed');
    expect(result.metadata.errors).toEqual(['indexed enumeration unavailable']);
    expect(evidenceIds(result)).toEqual(['fallback-hit']);
  });

  // Regression for codex P1 review on PR #61 — when the query has no
  // explicit/inferred `type` filter, `requestedTypes()` returns []. The
  // previous code passed that empty array straight into
  // `adapter.listRoots(types, filters)`. For adapters whose listRoots is
  // `types.map(...)` (every current adapter), the result was `roots: []`,
  // and the property-bearing backend was queried with no roots → zero results.
  it('expands empty types to adapter.entityTypes when computing enumerate roots', async () => {
    const enumerate = vi.fn(async () => [entry('pr-hit', { state: 'open', type: 'pr' })]);
    const librarian = createTestLibrarian({ enumerate });

    // `state:open` is a non-type filter, so `hasFilters` is true but
    // `types` is []. Without the `effectiveTypes = adapter.entityTypes`
    // expansion, `roots` would be [] and enumerate would never see the data.
    await librarian.handler.execute('state:open');

    expect(enumerate).toHaveBeenCalledOnce();
    const callArg = enumerate.mock.calls[0]?.[0] as { roots: string[] };
    expect(callArg.roots).toEqual(['/root/pr', '/root/issue']);
  });

  // Regression for codex P2 review on PR #61 — enumerated entries used to
  // be accepted directly via `entries.map(entry => ({entry, enumerationType: inferEntityType(entry)}))`,
  // bypassing `toEnumerationEntry`'s type-constraint enforcement. For
  // adapters where `type` is not in `filterKeys`, `matchesRequestedFilters`
  // would not catch wrong-type entries, so an enumerate backend returning
  // mixed kinds could leak the wrong type past a `type:`-scoped query.
  it('rejects enumerate results whose inferred type is not in the requested types', async () => {
    const enumerate = vi.fn(async () => [
      entry('pr-hit', { state: 'open', type: 'pr' }),
      entry('issue-hit', { state: 'open', type: 'issue' }),
    ]);
    const librarian = createTestLibrarian({ enumerate });

    const result = await librarian.handler.execute('type:pr state:open');

    expect(enumerate).toHaveBeenCalledOnce();
    // Only the 'pr' entry survives — the 'issue' entry is dropped by
    // toEnumerationEntry because it's not in the requested types.
    expect(evidenceIds(result)).toEqual(['pr-hit']);
  });

  // Regression for devin P1 review on PR #61 — when the zero-entry gate
  // already invoked apiFallback and got back entries that all failed the
  // post-filter, the post-filter-empty safety net would call apiFallback
  // AGAIN with identical params. Track `apiFallbackAttempted` and skip the
  // second call.
  it('does not call apiFallback twice when the zero-entry gate already tried it', async () => {
    // VFS returns nothing → first fallback fires.
    const enumerate = vi.fn(async () => []);
    // apiFallback returns an entry that does NOT match the filter (state=closed
    // when query asks for state=open), so post-filter empties the result.
    const apiFallback = vi.fn(async () => [entry('mismatch', { state: 'closed', type: 'pr' })]);
    const librarian = createTestLibrarian({ enumerate }, apiFallback);

    const result = await librarian.handler.execute('type:pr state:open');

    // Critical: exactly ONE call. The post-filter-empty safety net must
    // not re-invoke apiFallback with identical parameters.
    expect(apiFallback).toHaveBeenCalledOnce();
    expect(evidenceIds(result)).toEqual([]);
    expect(result.status).toBe('failed');
  });
});
