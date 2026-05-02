import { describe, expect, it } from 'vitest';

import { createSpecialistBridge, resolveSpecialistTransports } from './bridge.js';
import type {
  DelegationRequest,
  DelegationTransport,
  SpecialistFindings,
} from './shared/findings.js';

type GitHubRequest = DelegationRequest;

class FakeDelegationTransport implements DelegationTransport {
  readonly calls: GitHubRequest[] = [];

  constructor(
    private readonly handler: <TRequest extends GitHubRequest>(
      request: TRequest,
    ) => Promise<SpecialistFindings>,
  ) {}

  delegate<TRequest extends GitHubRequest>(request: TRequest): Promise<SpecialistFindings> {
    this.calls.push(request);
    return this.handler(request);
  }
}

function createFindings(overrides: Partial<SpecialistFindings> = {}): SpecialistFindings {
  return {
    requestId: 'req-1',
    capability: 'github.investigate',
    status: 'complete',
    summary: 'ok',
    findings: [],
    ...overrides,
  };
}

describe('createSpecialistBridge', () => {
  it('investigate forwards owner/repo/number to github transport', async () => {
    const transport = new FakeDelegationTransport(async (request) =>
      createFindings({
        requestId: request.requestId,
        capability: request.capability,
      }),
    );
    const bridge = createSpecialistBridge({ transports: { github: transport } });

    await bridge.investigate({ owner: 'AgentWorkforce', repo: 'sage', number: 173 });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      requestId: expect.any(String),
      capability: 'github.investigate',
      params: {
        capability: 'github.investigate',
        query: 'AgentWorkforce/sage#173',
        pr: {
          owner: 'AgentWorkforce',
          repo: 'sage',
          number: 173,
        },
      },
      timeoutMs: 30_000,
    });
  });

  it('enumerate with filters propagates filters', async () => {
    const transport = new FakeDelegationTransport(async (request) =>
      createFindings({
        requestId: request.requestId,
        capability: request.capability,
      }),
    );
    const bridge = createSpecialistBridge({ transports: { github: transport } });
    const filters = { repo: 'a/b' } as unknown as Parameters<typeof bridge.enumerate>[1];

    await bridge.enumerate('foo', filters);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toEqual({
      requestId: expect.any(String),
      capability: 'github.enumerate',
      params: {
        capability: 'github.enumerate',
        query: 'foo',
        filters: { repo: 'a/b' },
      },
      timeoutMs: 30_000,
    });
  });

  it('missing transport returns failed status, never throws', async () => {
    const events: Array<{ event: string; capability?: string; reason?: string }> = [];
    const bridge = createSpecialistBridge({
      transports: {},
      onEvent: (event) => {
        events.push({
          event: event.event,
          capability: event.capability,
          reason: event.reason,
        });
      },
    });

    const result = await bridge.investigate({ owner: 'AgentWorkforce', repo: 'sage', number: 173 });

    expect(result).toEqual({
      requestId: expect.any(String),
      capability: 'github.investigate',
      status: 'failed',
      summary: 'transport_unavailable',
      findings: [],
      confidence: 0,
    });
    expect(events).toEqual([
      {
        event: 'specialist_unavailable',
        capability: 'github.investigate',
        reason: 'transport_unavailable',
      },
    ]);
  });

  it('transport throws → wrapped as failed', async () => {
    const events: Array<{ event: string; capability?: string; reason?: string }> = [];
    const transport = new FakeDelegationTransport(async () => {
      throw new Error('boom');
    });
    const bridge = createSpecialistBridge({
      transports: { github: transport },
      onEvent: (event) => {
        events.push({
          event: event.event,
          capability: event.capability,
          reason: event.reason,
        });
      },
    });

    const result = await bridge.investigate({ owner: 'AgentWorkforce', repo: 'sage', number: 173 });

    expect(result).toEqual({
      requestId: expect.any(String),
      capability: 'github.investigate',
      status: 'failed',
      summary: 'boom',
      findings: [],
      confidence: 0,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: 'specialist_failed',
      capability: 'github.investigate',
      reason: 'boom',
    });
  });

  it('timeout enforced - returns failed before transport resolves', async () => {
    const events: Array<{ event: string; capability?: string; reason?: string }> = [];
    const transport = new FakeDelegationTransport(
      async () => await new Promise<SpecialistFindings>(() => undefined),
    );
    const bridge = createSpecialistBridge({
      transports: { github: transport },
      onEvent: (event) => {
        events.push({
          event: event.event,
          capability: event.capability,
          reason: event.reason,
        });
      },
    });
    const startedAt = Date.now();

    const result = await bridge.investigate(
      { owner: 'AgentWorkforce', repo: 'sage', number: 173 },
      { timeoutMs: 50 },
    );

    const elapsedMs = Date.now() - startedAt;

    expect(result).toEqual({
      requestId: expect.any(String),
      capability: 'github.investigate',
      status: 'failed',
      summary: 'Delegation timed out',
      findings: [],
      confidence: 0,
    });
    expect(elapsedMs).toBeGreaterThanOrEqual(40);
    expect(elapsedMs).toBeLessThan(150);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: 'specialist_timeout',
      capability: 'github.investigate',
      reason: 'Delegation timed out',
    });
  });
});

describe('resolveSpecialistTransports', () => {
  it('resolveSpecialistTransports drops nulls', () => {
    const github = new FakeDelegationTransport(async (request) =>
      createFindings({
        requestId: request.requestId,
        capability: request.capability,
      }),
    );

    const result = resolveSpecialistTransports({
      resolveGithub: () => github,
      resolveLinear: () => null,
    });

    expect(result).toEqual({ github });
    expect(Object.keys(result)).toEqual(['github']);
  });
});
