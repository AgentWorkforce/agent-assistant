import { describe, expect, it } from 'vitest';

import { classifyGithubProactiveSignal } from './github-signal-source.js';

const workspaceId = 'workspace-1';

function pullRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'closed',
    repository: {
      full_name: 'org/r',
    },
    pull_request: {
      number: 42,
      merged: true,
      html_url: 'https://github.com/org/r/pull/42',
    },
    ...overrides,
  };
}

function pullRequestReviewPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'submitted',
    repository: {
      full_name: 'org/r',
    },
    pull_request: {
      number: 42,
      html_url: 'https://github.com/org/r/pull/42',
    },
    review: {
      state: 'approved',
      html_url: 'https://github.com/org/r/pull/42#pullrequestreview-1',
      user: {
        login: 'u1',
      },
    },
    ...overrides,
  };
}

describe('classifyGithubProactiveSignal', () => {
  it('classifies merged pull request closures', () => {
    expect(classifyGithubProactiveSignal('pull_request', pullRequestPayload(), workspaceId)).toEqual({
      kind: 'github.pr_closed',
      workspaceId,
      subjectId: '42',
      payload: {
        repo: 'org/r',
        merged: true,
        url: 'https://github.com/org/r/pull/42',
      },
    });
  });

  it('classifies unmerged pull request closures', () => {
    expect(
      classifyGithubProactiveSignal(
        'pull_request',
        pullRequestPayload({
          pull_request: {
            number: 42,
            merged: false,
            html_url: 'https://github.com/org/r/pull/42',
          },
        }),
        workspaceId,
      ),
    ).toEqual({
      kind: 'github.pr_closed',
      workspaceId,
      subjectId: '42',
      payload: {
        repo: 'org/r',
        merged: false,
        url: 'https://github.com/org/r/pull/42',
      },
    });
  });

  it('ignores pull request events with unsupported actions', () => {
    expect(
      classifyGithubProactiveSignal(
        'pull_request',
        pullRequestPayload({ action: 'opened' }),
        workspaceId,
      ),
    ).toBeNull();
  });

  it('classifies submitted pull request reviews', () => {
    expect(
      classifyGithubProactiveSignal('pull_request_review', pullRequestReviewPayload(), workspaceId),
    ).toEqual({
      kind: 'github.pr_review_submitted',
      workspaceId,
      subjectId: '42',
      payload: {
        repo: 'org/r',
        state: 'approved',
        reviewer: 'u1',
        url: 'https://github.com/org/r/pull/42#pullrequestreview-1',
      },
    });
  });

  it('ignores pull request review events with unsupported actions', () => {
    expect(
      classifyGithubProactiveSignal(
        'pull_request_review',
        pullRequestReviewPayload({ action: 'edited' }),
        workspaceId,
      ),
    ).toBeNull();
  });

  it('ignores unknown GitHub event names', () => {
    expect(classifyGithubProactiveSignal('push', pullRequestPayload(), workspaceId)).toBeNull();
  });

  it('ignores payloads without pull_request', () => {
    expect(
      classifyGithubProactiveSignal(
        'pull_request',
        {
          action: 'closed',
          repository: {
            full_name: 'org/r',
          },
        },
        workspaceId,
      ),
    ).toBeNull();
  });

  it('ignores non-object payloads', () => {
    expect(classifyGithubProactiveSignal('pull_request', null, workspaceId)).toBeNull();
    expect(classifyGithubProactiveSignal('pull_request', 'payload', workspaceId)).toBeNull();
  });

  it('omits repo when repository.full_name is missing', () => {
    const signal = classifyGithubProactiveSignal(
      'pull_request',
      pullRequestPayload({
        repository: {},
      }),
      workspaceId,
    );

    expect(signal).toEqual({
      kind: 'github.pr_closed',
      workspaceId,
      subjectId: '42',
      payload: {
        merged: true,
        url: 'https://github.com/org/r/pull/42',
      },
    });
    expect(signal?.payload).not.toHaveProperty('repo');
  });
});
