import { describe, expect, it } from 'vitest';
import { CfShellVfsProvider, type CloudflareShellLike } from './cf-shell-vfs-provider.js';

function makeShell(files: Record<string, string>): CloudflareShellLike {
  return {
    async read(path) {
      return files[path] ?? null;
    },
    async write(path, content) {
      files[path] = content;
    },
    async delete(path) {
      delete files[path];
    },
    async list(prefix) {
      return Object.keys(files).filter((p) => p.startsWith(prefix));
    },
    async grep(pattern, options) {
      const regex = new RegExp(pattern);
      const searchPath = options?.path ?? '';
      const matches: Array<{ path: string; content: string; lineNumber?: number }> = [];
      for (const [p, content] of Object.entries(files)) {
        if (searchPath && !p.startsWith(searchPath)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push({ path: p, content: lines[i], lineNumber: i + 1 });
            if (options?.maxResults && matches.length >= options.maxResults) return matches;
          }
        }
      }
      return matches;
    },
  };
}

describe('CfShellVfsProvider', () => {
  it('reads a file', async () => {
    const provider = new CfShellVfsProvider({
      shell: makeShell({ 'src/index.ts': 'export {}' }),
    });
    const result = await provider.read('src/index.ts');
    expect(result).not.toBeNull();
    expect(result?.content).toBe('export {}');
    expect(result?.provider).toBe('cf-shell');
  });

  it('returns null for missing file', async () => {
    const provider = new CfShellVfsProvider({ shell: makeShell({}) });
    expect(await provider.read('missing.ts')).toBeNull();
  });

  it('lists files under a path', async () => {
    const provider = new CfShellVfsProvider({
      shell: makeShell({ 'src/a.ts': '', 'src/b.ts': '', 'tests/c.ts': '' }),
    });
    const entries = await provider.list('src');
    expect(entries.map((e) => e.path)).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']));
    expect(entries.find((e) => e.path === 'tests/c.ts')).toBeUndefined();
  });

  it('respects list limit', async () => {
    const provider = new CfShellVfsProvider({
      shell: makeShell({ 'a.ts': '', 'b.ts': '', 'c.ts': '' }),
    });
    const entries = await provider.list('', { limit: 2 });
    expect(entries).toHaveLength(2);
  });

  it('searches with grep', async () => {
    const provider = new CfShellVfsProvider({
      shell: makeShell({ 'a.ts': 'hello world\nfoo bar', 'b.ts': 'hello there' }),
    });
    const results = await provider.search('hello');
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.provider === 'cf-shell')).toBe(true);
  });

  it('applies prefix to all operations', async () => {
    const files: Record<string, string> = { 'ws1/src/index.ts': 'content' };
    const provider = new CfShellVfsProvider({
      shell: makeShell(files),
      prefix: 'ws1',
    });
    const result = await provider.read('src/index.ts');
    expect(result?.content).toBe('content');
    expect(result?.path).toBe('src/index.ts');
  });

  it('stat returns entry for existing file, null for missing', async () => {
    const provider = new CfShellVfsProvider({
      shell: makeShell({ 'README.md': '# hi' }),
    });
    expect(await provider.stat('README.md')).not.toBeNull();
    expect(await provider.stat('MISSING.md')).toBeNull();
  });
});
