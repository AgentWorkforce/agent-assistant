import { describe, expect, it, vi } from 'vitest';

import { readCloneSentinel, type VfsReader } from './sentinel.js';

const workspaceId = 'workspace-1';
const owner = 'octocat';
const repo = 'hello-world';
const cloneSentinelPath = `/github/repos/${owner}/${repo}/.relayfile/clone.json`;
const legacySentinelPath = `/github/repos/${owner}/${repo}/meta.json`;

function createReader(
  readImpl: (path: string) => Promise<{ content: string } | null>,
): VfsReader & { read: ReturnType<typeof vi.fn> } {
  return {
    read: vi.fn(readImpl),
  };
}

describe('readCloneSentinel', () => {
  it('.relayfile/clone.json takes priority', async () => {
    const content = JSON.stringify({
      jobId: 'job-123',
      headSha: 'abc123',
      defaultBranch: 'main',
      clonedAt: '2026-05-02T10:00:00.000Z',
      filesWritten: 42,
      cloneSource: 'github',
    });
    const reader = createReader(async (path) => {
      if (path === cloneSentinelPath) {
        return { content };
      }

      return {
        content: JSON.stringify({
          headSha: 'legacy-sha',
          clonedAt: '2026-05-01T00:00:00.000Z',
        }),
      };
    });

    const sentinel = await readCloneSentinel(workspaceId, owner, repo, { reader });

    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(reader.read).toHaveBeenCalledWith(cloneSentinelPath);
    expect(sentinel).toEqual({
      jobId: 'job-123',
      headSha: 'abc123',
      defaultBranch: 'main',
      clonedAt: '2026-05-02T10:00:00.000Z',
      filesWritten: 42,
      cloneSource: 'github',
    });
  });

  it('falls back to meta.json', async () => {
    const reader = createReader(async (path) => {
      if (path === cloneSentinelPath) {
        return null;
      }

      if (path === legacySentinelPath) {
        return {
          content: JSON.stringify({
            jobId: 'from-legacy-file',
            headSha: 'def456',
            clonedAt: '2026-05-01T08:30:00.000Z',
          }),
        };
      }

      return null;
    });

    const sentinel = await readCloneSentinel(workspaceId, owner, repo, { reader });

    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(reader.read).toHaveBeenNthCalledWith(1, cloneSentinelPath);
    expect(reader.read).toHaveBeenNthCalledWith(2, legacySentinelPath);
    expect(sentinel?.jobId).toBe('legacy');
  });

  it('skipLegacy=true skips fallback', async () => {
    const reader = createReader(async (path) => {
      if (path === cloneSentinelPath) {
        return null;
      }

      if (path === legacySentinelPath) {
        return {
          content: JSON.stringify({
            headSha: 'def456',
            clonedAt: '2026-05-01T08:30:00.000Z',
          }),
        };
      }

      return null;
    });

    const sentinel = await readCloneSentinel(workspaceId, owner, repo, {
      reader,
      skipLegacy: true,
    });

    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(reader.read).toHaveBeenCalledWith(cloneSentinelPath);
    expect(sentinel).toBeNull();
  });

  it('parse error → null', async () => {
    const reader = createReader(async (path) => {
      if (path === cloneSentinelPath) {
        return { content: '{"badJson":' };
      }

      return null;
    });

    const sentinel = await readCloneSentinel(workspaceId, owner, repo, { reader });

    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(reader.read).toHaveBeenCalledWith(cloneSentinelPath);
    expect(sentinel).toBeNull();
  });

  it('missing required fields → null', async () => {
    const reader = createReader(async (path) => {
      if (path === cloneSentinelPath) {
        return { content: '{}' };
      }

      return null;
    });

    const sentinel = await readCloneSentinel(workspaceId, owner, repo, { reader });

    expect(sentinel).toBeNull();
  });
});
