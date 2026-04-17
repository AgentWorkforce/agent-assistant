import { describe, expect, it } from 'vitest';

import { runVfsCli } from './index.js';
import { normalizeVfsPath } from './output.js';
import type { VfsEntry, VfsProvider, VfsSearchOptions } from './types.js';

function createWritable() {
  let text = '';
  return {
    stream: {
      write(chunk: string) {
        text += chunk;
      },
    },
    get text() {
      return text;
    },
  };
}

function createProvider(): VfsProvider & {
  lastSearchOptions?: VfsSearchOptions;
  lastListOptions?: { path: string; options?: { depth?: number; limit?: number } };
} {
  const entries: VfsEntry[] = [
    {
      path: '/linear',
      type: 'dir',
      provider: 'linear',
      revision: 'rev-root',
    },
    {
      path: '/linear/issues/ABC-123/issue.json',
      type: 'file',
      provider: 'linear',
      title: 'ABC-123 Login bug',
      revision: 'rev-issue',
    },
    {
      path: '/linear/roadmaps/rm-1/roadmap.json',
      type: 'file',
      provider: 'linear',
      title: 'Q2 Roadmap',
      revision: 'rev-roadmap',
    },
  ];

  return {
    async list(path, options) {
      this.lastListOptions = { path, options };
      return entries.filter((entry) => entry.path === path || entry.path.startsWith(`${path.replace(/\/$/g, '')}/`));
    },
    async read(path) {
      if (path !== '/linear/issues/ABC-123/issue.json') {
        return null;
      }

      return {
        path,
        content: 'This issue contains the needle and extra context.',
        contentType: 'application/json',
        provider: 'linear',
        revision: 'rev-issue',
      };
    },
    async search(query, options) {
      this.lastSearchOptions = options;
      return entries
        .filter((entry) => entry.type === 'file' && entry.title?.toLowerCase().includes(query.toLowerCase()))
        .map((entry) => ({
          ...entry,
          snippet: `Matched ${query}`,
        }));
    },
    async stat(path) {
      return entries.find((entry) => entry.path === path) ?? null;
    },
  };
}

async function run(provider: VfsProvider, argv: string[]) {
  const stdout = createWritable();
  const stderr = createWritable();
  const code = await runVfsCli({
    name: 'test-vfs',
    provider,
    argv,
    stdout: stdout.stream,
    stderr: stderr.stream,
    maxContentChars: 20,
  });

  return { code, stdout: stdout.text, stderr: stderr.text };
}

describe('runVfsCli', () => {
  it('lists entries in text form', async () => {
    const result = await run(createProvider(), ['list', '/linear']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('/linear/issues/ABC-123/issue.json');
    expect(result.stdout).toContain('ABC-123 Login bug');
  });

  it('renders a tree', async () => {
    const result = await run(createProvider(), ['tree', '/linear', '--depth', '3']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('/linear');
    expect(result.stdout).toContain('- ABC-123 Login bug [file]');
  });

  it('reads and truncates content', async () => {
    const result = await run(createProvider(), ['read', '/linear/issues/ABC-123/issue.json']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Path: /linear/issues/ABC-123/issue.json');
    expect(result.stdout).toContain('This issue contains');
    expect(result.stdout).toContain('[truncated to 20 chars]');
  });

  it('prints search results and forwards provider and limit options', async () => {
    const provider = createProvider();
    const result = await run(provider, ['search', 'roadmap', '--provider', 'linear', '--limit', '2']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Q2 Roadmap');
    expect(provider.lastSearchOptions).toEqual({ provider: 'linear', limit: 2 });
  });

  it('supports json output', async () => {
    const result = await run(createProvider(), ['stat', '/linear/issues/ABC-123/issue.json', '--json']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      path: '/linear/issues/ABC-123/issue.json',
      type: 'file',
      provider: 'linear',
    });
  });

  it('uses parsed limit in stat fallback lookups', async () => {
    const provider = createProvider();
    delete provider.stat;

    const result = await run(provider, ['stat', '/linear/issues/ABC-123/issue.json', '--limit', '7']);

    expect(result.code).toBe(0);
    expect(provider.lastListOptions).toEqual({
      path: '/linear/issues/ABC-123',
      options: { depth: 1, limit: 7 },
    });
  });

  it('returns a usage error when a value-taking flag is missing its value', async () => {
    const result = await run(createProvider(), ['search', 'roadmap', '--provider']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--provider requires a value');
  });

  it('normalizes repeated path separators', () => {
    expect(normalizeVfsPath('/linear//issues///ABC-123/')).toBe('/linear/issues/ABC-123');
  });

  it('returns a usage error for unknown commands', async () => {
    const result = await run(createProvider(), ['unknown']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown command: unknown');
  });
});
