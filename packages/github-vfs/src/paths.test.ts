import { describe, expect, it } from 'vitest';
import {
  githubPullMetadataPath,
  githubPullsRoot,
  isGithubPullMetadataPath,
} from './paths.js';

describe('GitHub VFS paths', () => {
  it('builds encoded pull root and metadata paths', () => {
    expect(githubPullsRoot('Agent Workforce', 'cloud/tools')).toBe(
      '/github/repos/Agent%20Workforce/cloud%2Ftools/pulls',
    );
    expect(githubPullMetadataPath('AgentWorkforce', 'cloud', 117)).toBe(
      '/github/repos/AgentWorkforce/cloud/pulls/117/metadata.json',
    );
  });

  it('detects pull metadata paths', () => {
    expect(
      isGithubPullMetadataPath('/github/repos/AgentWorkforce/cloud/pulls/117/metadata.json'),
    ).toBe(true);
    expect(isGithubPullMetadataPath('/github/repos/AgentWorkforce/cloud/pulls/117/meta.json')).toBe(
      true,
    );
    expect(isGithubPullMetadataPath('/github/repos/AgentWorkforce/cloud/issues/117/metadata.json')).toBe(
      false,
    );
  });
});
