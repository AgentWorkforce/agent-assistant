import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureCloneFresh,
  type EnsureCloneFreshOptions,
} from './ensure-clone-fresh.js';
import type { CloneAdvisory, CloneJobStatus, CloneSentinel } from './types.js';

const NOW = new Date('2026-05-02T12:00:00.000Z');
const WORKSPACE_ID = 'w1';
const OWNER = 'octocat';
const REPO = 'hello-world';

type StatusReaderStub = {
  statusForRepo: ReturnType<typeof vi.fn>;
};

type SentinelReaderStub = {
  read: ReturnType<typeof vi.fn>;
};

type CloneRequesterStub = {
  requestIfNeeded: ReturnType<typeof vi.fn>;
};

type ConnectionIdResolverStub = ReturnType<typeof vi.fn>;

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function createStatusReader(status: CloneJobStatus | null): StatusReaderStub {
  return {
    statusForRepo: vi.fn(async () => status),
  };
}

function createSentinelReader(
  sentinel: CloneSentinel | null,
): SentinelReaderStub {
  return {
    read: vi.fn(async () =>
      sentinel === null ? null : { content: JSON.stringify(sentinel) },
    ),
  };
}

function createCloneRequester(): CloneRequesterStub {
  return {
    requestIfNeeded: vi.fn(async () => ({ submitted: true, jobId: 'job-req-1' })),
  };
}

function createConnectionIdResolver(
  connectionId: string | null = 'c1',
): ConnectionIdResolverStub {
  return vi.fn(async () => connectionId);
}

function createOptions(args?: {
  status?: CloneJobStatus | null;
  sentinel?: CloneSentinel | null;
  connectionId?: string | null;
  defaultRef?: string;
}) {
  const statusReader = createStatusReader(args?.status ?? null);
  const sentinelReader = createSentinelReader(args?.sentinel ?? null);
  const cloneRequester = createCloneRequester();
  const connectionIdResolver = createConnectionIdResolver(args?.connectionId);

  const options: EnsureCloneFreshOptions = {
    statusReader:
      statusReader as unknown as EnsureCloneFreshOptions['statusReader'],
    sentinelReader:
      sentinelReader as unknown as EnsureCloneFreshOptions['sentinelReader'],
    cloneRequester:
      cloneRequester as unknown as EnsureCloneFreshOptions['cloneRequester'],
    connectionIdResolver,
    ...(args?.defaultRef ? { defaultRef: args.defaultRef } : {}),
  };

  return {
    options,
    statusReader,
    sentinelReader,
    cloneRequester,
    connectionIdResolver,
  };
}

describe('ensureCloneFresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('state=running returns clone_in_progress advisory', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { options, sentinelReader, cloneRequester, connectionIdResolver } =
      createOptions({
        status: {
          state: 'running',
          jobId: 'job-123',
          startedAt: '2026-05-02T11:45:00.000Z',
        },
      });

    const advisory = await ensureCloneFresh(
      WORKSPACE_ID,
      OWNER,
      REPO,
      options,
    );

    expect(advisory).toEqual<CloneAdvisory>({
      notice: 'clone_in_progress',
      cloneState: 'running',
      cloneJobId: 'job-123',
      cloneStartedAt: '2026-05-02T11:45:00.000Z',
    });
    expect(sentinelReader.read).not.toHaveBeenCalled();
    expect(cloneRequester.requestIfNeeded).not.toHaveBeenCalled();
    expect(connectionIdResolver).not.toHaveBeenCalled();
  });

  it('state=succeeded fresh returns null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { options, sentinelReader, cloneRequester, connectionIdResolver } =
      createOptions({
        status: {
          state: 'succeeded',
          jobId: 'job-123',
          completedAt: isoDaysAgo(5),
          headSha: 'abc123',
        },
      });

    const advisory = await ensureCloneFresh(
      WORKSPACE_ID,
      OWNER,
      REPO,
      options,
    );

    expect(advisory).toBeNull();
    expect(sentinelReader.read).not.toHaveBeenCalled();
    expect(cloneRequester.requestIfNeeded).not.toHaveBeenCalled();
    expect(connectionIdResolver).not.toHaveBeenCalled();
  });

  it('state=succeeded stale triggers fresh request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { options, cloneRequester, connectionIdResolver } = createOptions({
      status: {
        state: 'succeeded',
        jobId: 'job-123',
        completedAt: isoDaysAgo(31),
        headSha: 'stale123',
      },
      sentinel: null,
      connectionId: 'c1',
    });

    const advisory = await ensureCloneFresh(
      WORKSPACE_ID,
      OWNER,
      REPO,
      options,
    );

    expect(connectionIdResolver).toHaveBeenCalledWith(WORKSPACE_ID, OWNER, REPO);
    expect(cloneRequester.requestIfNeeded).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      owner: OWNER,
      repo: REPO,
      ref: 'refs/heads/main',
      connectionId: 'c1',
    });
    expect(advisory).toEqual({
      notice: 'clone_requested',
      cloneState: 'queued',
      cloneJobId: 'job-req-1',
    });
  });

  it('state=failed surfaces clone_failed', async () => {
    const { options, sentinelReader, cloneRequester, connectionIdResolver } =
      createOptions({
        status: {
          state: 'failed',
          jobId: 'job-oom',
          errorMessage: 'OOM',
        },
      });

    const advisory = await ensureCloneFresh(
      WORKSPACE_ID,
      OWNER,
      REPO,
      options,
    );

    expect(advisory).toEqual({
      notice: 'clone_failed',
      cloneState: 'failed',
      cloneJobId: 'job-oom',
      reason: 'OOM',
    });
    expect(sentinelReader.read).not.toHaveBeenCalled();
    expect(cloneRequester.requestIfNeeded).not.toHaveBeenCalled();
    expect(connectionIdResolver).not.toHaveBeenCalled();
  });

  it('status outage falls through to sentinel', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { options, cloneRequester, connectionIdResolver } = createOptions({
      status: null,
      sentinel: {
        jobId: 'job-sentinel',
        headSha: 'head123',
        defaultBranch: 'main',
        clonedAt: isoDaysAgo(1),
        filesWritten: 42,
        cloneSource: 'github',
      },
    });

    const advisory = await ensureCloneFresh(
      WORKSPACE_ID,
      OWNER,
      REPO,
      options,
    );

    expect(advisory).toBeNull();
    expect(cloneRequester.requestIfNeeded).not.toHaveBeenCalled();
    expect(connectionIdResolver).not.toHaveBeenCalled();
  });

  it('no status, no sentinel → request fired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { options, cloneRequester, connectionIdResolver } = createOptions({
      status: null,
      sentinel: null,
      connectionId: 'c1',
    });

    const advisory = await ensureCloneFresh(
      WORKSPACE_ID,
      OWNER,
      REPO,
      options,
    );

    expect(connectionIdResolver).toHaveBeenCalledWith(WORKSPACE_ID, OWNER, REPO);
    expect(cloneRequester.requestIfNeeded).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      owner: OWNER,
      repo: REPO,
      ref: 'refs/heads/main',
      connectionId: 'c1',
    });
    expect(advisory).toEqual({
      notice: 'clone_requested',
      cloneState: 'queued',
      cloneJobId: 'job-req-1',
    });
  });

  it('unresolvable connectionId returns clone_failed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { options, cloneRequester, connectionIdResolver } = createOptions({
      status: null,
      sentinel: null,
      connectionId: null,
    });

    const advisory = await ensureCloneFresh(
      WORKSPACE_ID,
      OWNER,
      REPO,
      options,
    );

    expect(connectionIdResolver).toHaveBeenCalledWith(WORKSPACE_ID, OWNER, REPO);
    expect(cloneRequester.requestIfNeeded).not.toHaveBeenCalled();
    expect(advisory).toEqual({
      notice: 'clone_failed',
      cloneState: 'unknown',
      reason: 'connection_unresolved',
    });
  });

  it('spec §5a — listing-shape independence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { options, sentinelReader, cloneRequester, connectionIdResolver } =
      createOptions({
        status: {
          state: 'succeeded',
          jobId: 'job-123',
          completedAt: isoDaysAgo(2),
          headSha: 'fresh123',
        },
        sentinel: null,
      });

    const advisory = await ensureCloneFresh(
      WORKSPACE_ID,
      OWNER,
      REPO,
      options,
    );

    // Ensures the heuristic-replacement contract: listing entries no longer drive the decision.
    expect(advisory).toBeNull();
    expect(sentinelReader.read).not.toHaveBeenCalled();
    expect(cloneRequester.requestIfNeeded).not.toHaveBeenCalled();
    expect(connectionIdResolver).not.toHaveBeenCalled();
  });

  it('request 4xx returns clone_failed (not clone_requested)', async () => {
    // Codex P1: avoid masking real failures behind clone_requested.
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { options, cloneRequester } = createOptions({
      status: null,
      sentinel: null,
      connectionId: 'c1',
    });
    cloneRequester.requestIfNeeded.mockResolvedValueOnce({
      submitted: false,
      error: { status: 400 },
    });

    const advisory = await ensureCloneFresh(WORKSPACE_ID, OWNER, REPO, options);

    expect(advisory).toEqual({
      notice: 'clone_failed',
      cloneState: 'unknown',
      reason: 'request_failed_status_400',
    });
  });

  it('request throws → clone_failed with thrown message', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { options, cloneRequester } = createOptions({
      status: null,
      sentinel: null,
      connectionId: 'c1',
    });
    cloneRequester.requestIfNeeded.mockRejectedValueOnce(new Error('boom'));

    const advisory = await ensureCloneFresh(WORKSPACE_ID, OWNER, REPO, options);

    expect(advisory).toEqual({
      notice: 'clone_failed',
      cloneState: 'unknown',
      reason: 'boom',
    });
  });
});
