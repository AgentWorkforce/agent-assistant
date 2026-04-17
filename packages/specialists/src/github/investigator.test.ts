import type { VfsEntry, VfsProvider, VfsReadResult, VfsSearchResult } from '@agent-assistant/vfs';
import { describe, expect, it } from 'vitest';

import {
  investigatePullRequest,
  type GitHubApiFallback,
  type GitHubApiPullRequest,
  type PrInvestigationRequest,
} from './investigator.js';

type VfsFile = {
  content: string;
  provider?: string;
  revision?: string;
};

class InMemoryVfsProvider implements VfsProvider {
  readonly reads: string[] = [];

  constructor(private readonly files: Record<string, VfsFile>) {}

  async read(filePath: string): Promise<VfsReadResult | null> {
    this.reads.push(filePath);
    const file = this.files[filePath];
    if (!file) {
      return null;
    }

    return {
      path: filePath,
      content: file.content,
      provider: file.provider ?? 'github',
      revision: file.revision ?? 'rev-vfs',
    };
  }

  async list(): Promise<VfsEntry[]> {
    return [];
  }

  async search(): Promise<VfsSearchResult[]> {
    return [];
  }
}

class InlineGitHubApiFallback implements GitHubApiFallback {
  readonly calls: Array<{ owner: string; repo: string; number: number }> = [];

  constructor(private readonly pullRequest: GitHubApiPullRequest | null) {}

  async readPRDiff(owner: string, repo: string, number: number): Promise<GitHubApiPullRequest | null> {
    this.calls.push({ owner, repo, number });
    return this.pullRequest;
  }
}

function createRequest(): PrInvestigationRequest {
  return {
    requestId: 'req-investigator',
    repo: { owner: 'foo', repo: 'bar' },
    pr: { number: 47 },
    allowDurableEvidence: true,
  };
}

const metadataPath = '/github/repos/foo/bar/pulls/47/meta.json';
const diffPath = '/github/repos/foo/bar/pulls/47/diff.patch';
const producedAt = '2026-04-17T00:00:00.000Z';

describe('investigatePullRequest VFS evidence', () => {
  it('returns pr-meta and pr-diff evidence when VFS metadata and diff are present', async () => {
    const vfs = new InMemoryVfsProvider({
      [metadataPath]: {
        revision: 'rev-meta',
        content: JSON.stringify({
          title: 'Tighten token checks',
          html_url: 'https://github.com/foo/bar/pull/47',
          state: 'open',
          body: 'Adds stricter token validation.',
          user: { login: 'security-lead' },
          base: { ref: 'main' },
          head: { ref: 'feature/token-checks' },
          labels: [{ name: 'security' }, { name: 'backend' }],
          reviewStatus: 'approved',
        }),
      },
      [diffPath]: {
        revision: 'rev-diff',
        content: [
          'diff --git a/src/auth.ts b/src/auth.ts',
          '--- a/src/auth.ts',
          '+++ b/src/auth.ts',
          '+validateTokenScope();',
          'diff --git a/src/auth.test.ts b/src/auth.test.ts',
          '--- a/src/auth.test.ts',
          '+++ b/src/auth.test.ts',
          '+expect(scopeCheck).toBe(true);',
        ].join('\n'),
      },
    });

    const findings = await investigatePullRequest(createRequest(), {
      vfs,
      now: () => Date.parse(producedAt),
    });

    expect(findings.status).toBe('complete');
    expect(findings.capability).toBe('pr_investigation');
    expect(findings.findings).toHaveLength(2);
    expect(findings.findings.map((finding) => finding.metadata?.id)).toEqual(['pr-meta', 'pr-diff']);
    expect(findings.metadata).toEqual(
      expect.objectContaining({
        durableEvidenceCount: 0,
        producedAt,
      }),
    );

    const [metadataEvidence, diffEvidence] = findings.findings;
    expect(metadataEvidence).toEqual(
      expect.objectContaining({
        title: 'PR #47 metadata',
        url: 'https://github.com/foo/bar/pull/47',
        metadata: expect.objectContaining({
          id: 'pr-meta',
          kind: 'pr_summary',
          confidence: 0.72,
          source: expect.objectContaining({
            provider: 'vfs',
            ref: '/github/repos/foo/bar/pulls/47',
            path: metadataPath,
            revision: 'rev-meta',
            asOf: producedAt,
          }),
          structured: expect.objectContaining({
            number: 47,
            title: 'Tighten token checks',
            state: 'open',
            author: 'security-lead',
            baseBranch: 'main',
            headBranch: 'feature/token-checks',
            labels: ['security', 'backend'],
            reviewStatus: 'approved',
            additions: 2,
            deletions: 0,
            url: 'https://github.com/foo/bar/pull/47',
          }),
        }),
      }),
    );

    expect(diffEvidence).toEqual(
      expect.objectContaining({
        title: 'PR #47 diff analysis',
        body: expect.stringContaining('src/auth.ts'),
        metadata: expect.objectContaining({
          id: 'pr-diff',
          kind: 'diff_analysis',
          confidence: 0.88,
          source: expect.objectContaining({
            provider: 'vfs',
            ref: '/github/repos/foo/bar/pulls/47',
            path: metadataPath,
            revision: 'rev-meta',
            asOf: producedAt,
          }),
          structured: expect.objectContaining({
            filesChanged: ['src/auth.ts', 'src/auth.test.ts'],
            changeCategories: ['feature', 'test'],
            riskAreas: expect.arrayContaining([
              expect.objectContaining({
                file: 'src/auth.ts',
                severity: 'high',
              }),
            ]),
          }),
        }),
      }),
    );
    expect(diffEvidence?.metadata).not.toHaveProperty('durableRef');
    expect(vfs.reads).toEqual(expect.arrayContaining([metadataPath, diffPath]));
  });

  it('uses inline GitHub fallback when VFS misses and preserves evidence shape', async () => {
    const vfs = new InMemoryVfsProvider({});
    const apiFallback = new InlineGitHubApiFallback({
      title: 'Load PR from fallback',
      body: 'Fallback metadata body.',
      state: 'open',
      url: 'https://github.com/foo/bar/pull/47',
      author: 'api-user',
      baseBranch: 'main',
      headBranch: 'feature/api-fallback',
      labels: ['fallback', 'security'],
      reviewStatus: 'pending',
      diff: [
        'diff --git a/src/fallback.ts b/src/fallback.ts',
        '--- a/src/fallback.ts',
        '+++ b/src/fallback.ts',
        '+export const loaded = true;',
      ].join('\n'),
    });

    const findings = await investigatePullRequest(createRequest(), {
      vfs,
      apiFallback,
      now: () => Date.parse(producedAt),
    });

    expect(apiFallback.calls).toEqual([{ owner: 'foo', repo: 'bar', number: 47 }]);
    expect(findings.status).toBe('complete');
    expect(findings.findings.map((finding) => finding.metadata?.id)).toEqual(['pr-meta', 'pr-diff']);

    const [metadataEvidence, diffEvidence] = findings.findings;
    expect(metadataEvidence?.metadata).toEqual(
      expect.objectContaining({
        id: 'pr-meta',
        kind: 'pr_summary',
        source: expect.objectContaining({
          provider: 'github_api',
          ref: '/github/repos/foo/bar/pulls/47',
          asOf: producedAt,
        }),
        structured: expect.objectContaining({
          number: 47,
          title: 'Load PR from fallback',
          author: 'api-user',
          labels: ['fallback', 'security'],
          reviewStatus: 'pending',
        }),
      }),
    );
    expect(diffEvidence?.metadata).toEqual(
      expect.objectContaining({
        id: 'pr-diff',
        kind: 'diff_analysis',
        source: expect.objectContaining({
          provider: 'github_api',
          ref: '/github/repos/foo/bar/pulls/47',
          asOf: producedAt,
        }),
        structured: expect.objectContaining({
          filesChanged: ['src/fallback.ts'],
          changeCategories: ['feature'],
        }),
      }),
    );
    expect(diffEvidence?.body).toContain('src/fallback.ts');
  });
});
