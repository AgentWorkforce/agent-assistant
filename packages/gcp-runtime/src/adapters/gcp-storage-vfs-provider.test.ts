import { describe, expect, it } from 'vitest';
import { GcpStorageVfsProvider, type GcsBucketLike, type GcsFileLike } from './gcp-storage-vfs-provider.js';

function makeBucket(files: Record<string, string>): GcsBucketLike {
  function makeFile(name: string): GcsFileLike {
    return {
      name,
      async exists() { return [name in files]; },
      async download() { return [Buffer.from(files[name] ?? '')]; },
      async save(content) { files[name] = typeof content === 'string' ? content : content.toString(); },
      async delete() { delete files[name]; },
    };
  }

  return {
    file(path) { return makeFile(path); },
    async getFiles(opts) {
      const prefix = opts?.prefix ?? '';
      const max = opts?.maxResults ?? Infinity;
      const matching = Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .slice(0, max)
        .map(makeFile);
      return [matching];
    },
  };
}

describe('GcpStorageVfsProvider', () => {
  it('reads an existing file', async () => {
    const provider = new GcpStorageVfsProvider({
      bucket: makeBucket({ 'src/index.ts': 'export {}' }),
    });
    const result = await provider.read('src/index.ts');
    expect(result?.content).toBe('export {}');
    expect(result?.provider).toBe('gcp-storage');
  });

  it('returns null for missing file', async () => {
    const provider = new GcpStorageVfsProvider({ bucket: makeBucket({}) });
    expect(await provider.read('missing.ts')).toBeNull();
  });

  it('lists files under a path', async () => {
    const provider = new GcpStorageVfsProvider({
      bucket: makeBucket({ 'src/a.ts': '', 'src/b.ts': '', 'tests/c.ts': '' }),
    });
    const entries = await provider.list('src');
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
    expect(paths).not.toContain('tests/c.ts');
  });

  it('stat returns entry for existing file', async () => {
    const provider = new GcpStorageVfsProvider({
      bucket: makeBucket({ 'README.md': '# hello' }),
    });
    expect(await provider.stat('README.md')).toMatchObject({ path: 'README.md', type: 'file' });
  });

  it('stat returns null for missing file', async () => {
    const provider = new GcpStorageVfsProvider({ bucket: makeBucket({}) });
    expect(await provider.stat('nope.md')).toBeNull();
  });

  it('search finds matching lines', async () => {
    const provider = new GcpStorageVfsProvider({
      bucket: makeBucket({ 'a.ts': 'hello world\nfoo bar', 'b.ts': 'hello again' }),
    });
    const results = await provider.search('hello');
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.provider === 'gcp-storage')).toBe(true);
  });

  it('applies search limit', async () => {
    const provider = new GcpStorageVfsProvider({
      bucket: makeBucket({ 'a.ts': 'match', 'b.ts': 'match', 'c.ts': 'match' }),
    });
    const results = await provider.search('match', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('resolves paths relative to prefix', async () => {
    const provider = new GcpStorageVfsProvider({
      bucket: makeBucket({ 'ws1/src/index.ts': 'content' }),
      prefix: 'ws1',
    });
    const result = await provider.read('src/index.ts');
    expect(result?.content).toBe('content');
    expect(result?.path).toBe('src/index.ts');
  });
});
