import type { ProactiveSignal } from '@agent-assistant/proactive';

type GithubProactiveSignal = Pick<
  ProactiveSignal,
  'kind' | 'workspaceId' | 'subjectId' | 'payload'
>;

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readSubjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function classifyGithubProactiveSignal(
  eventName: string,
  payload: unknown,
  workspaceId: string,
): GithubProactiveSignal | null {
  if (eventName !== 'pull_request' && eventName !== 'pull_request_review') {
    return null;
  }

  const root = readObject(payload);
  if (!root) {
    return null;
  }

  const action = readString(root.action);
  const pullRequest = readObject(root.pull_request);
  if (!pullRequest) {
    return null;
  }

  const subjectId = readSubjectId(pullRequest.number);
  if (!subjectId) {
    return null;
  }

  const repository = readObject(root.repository);
  const repo = repository ? readString(repository.full_name) : undefined;

  if (eventName === 'pull_request') {
    if (action !== 'closed') {
      return null;
    }

    return {
      kind: 'github.pr_closed',
      workspaceId,
      subjectId,
      payload: {
        ...(repo ? { repo } : {}),
        ...(readBoolean(pullRequest.merged) !== undefined ? { merged: readBoolean(pullRequest.merged) } : {}),
        ...(readString(pullRequest.html_url) ? { url: readString(pullRequest.html_url) } : {}),
      },
    };
  }

  if (action !== 'submitted') {
    return null;
  }

  const review = readObject(root.review);
  if (!review) {
    return null;
  }

  const reviewer = readObject(review.user);

  return {
    kind: 'github.pr_review_submitted',
    workspaceId,
    subjectId,
    payload: {
      ...(repo ? { repo } : {}),
      ...(readString(review.state) ? { state: readString(review.state) } : {}),
      ...(reviewer && readString(reviewer.login) ? { reviewer: readString(reviewer.login) } : {}),
      ...(readString(review.html_url) ? { url: readString(review.html_url) } : {}),
    },
  };
}
