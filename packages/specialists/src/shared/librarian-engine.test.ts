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
});
