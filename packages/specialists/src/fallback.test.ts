import { describe, expect, it } from 'vitest';

import type { SpecialistBridge } from './bridge.js';
import { runSpecialistFallback } from './fallback.js';
import type { SpecialistFindings } from './shared/findings.js';

type InvestigateRef = Parameters<SpecialistBridge['investigate']>[0];
type GitHubFilters = Parameters<SpecialistBridge['enumerate']>[1];
type LinearFilters = Parameters<SpecialistBridge['linearEnumerate']>[1];
type CallOptions = { timeoutMs?: number } | undefined;

class RecordingBridge implements SpecialistBridge {
  readonly investigateCalls: Array<{ ref: InvestigateRef; opts: CallOptions }> = [];
  readonly enumerateCalls: Array<{ query: string; filters: GitHubFilters; opts: CallOptions }> = [];
  readonly linearEnumerateCalls: Array<{ query: string; filters: LinearFilters; opts: CallOptions }> = [];

  constructor(
    private readonly responses: {
      investigate?: SpecialistFindings;
      enumerate?: SpecialistFindings;
      linearEnumerate?: SpecialistFindings;
    } = {},
  ) {}

  async investigate(ref: InvestigateRef, opts?: CallOptions): Promise<SpecialistFindings> {
    this.investigateCalls.push({ ref, opts });
    return this.responses.investigate ?? createFindings();
  }

  async enumerate(
    query: string,
    filters?: GitHubFilters,
    opts?: CallOptions,
  ): Promise<SpecialistFindings> {
    this.enumerateCalls.push({ query, filters, opts });
    return this.responses.enumerate ?? createFindings();
  }

  async linearEnumerate(
    query: string,
    filters?: LinearFilters,
    opts?: CallOptions,
  ): Promise<SpecialistFindings> {
    this.linearEnumerateCalls.push({ query, filters, opts });
    return this.responses.linearEnumerate ?? createFindings();
  }
}

function createFindings(
  overrides: Partial<SpecialistFindings> = {},
): SpecialistFindings {
  return {
    requestId: 'req-fallback',
    capability: 'github.enumerate',
    status: 'complete',
    summary: 'ok',
    findings: [],
    ...overrides,
  };
}

describe('runSpecialistFallback', () => {
  it('routes PR refs to github_investigate', async () => {
    const bridge = new RecordingBridge();

    const result = await runSpecialistFallback(
      { message: 'please look at AgentWorkforce/sage#173' },
      { bridge },
    );

    expect(result.route).toBe('github_investigate');
    expect(bridge.investigateCalls).toEqual([
      {
        ref: { owner: 'AgentWorkforce', repo: 'sage', number: 173 },
        opts: undefined,
      },
    ]);
    expect(bridge.enumerateCalls).toEqual([]);
    expect(bridge.linearEnumerateCalls).toEqual([]);
  });

  it('routes github keyword plus owner/repo to github_enumerate', async () => {
    const bridge = new RecordingBridge();
    const message = 'is relayfile synced in the AgentWorkforce/cloud repo?';

    const result = await runSpecialistFallback({ message }, { bridge });

    expect(result.route).toBe('github_enumerate');
    expect(bridge.enumerateCalls).toEqual([
      {
        query: message,
        filters: { repo: ['AgentWorkforce/cloud'] },
        opts: undefined,
      },
    ]);
    expect(bridge.investigateCalls).toEqual([]);
    expect(bridge.linearEnumerateCalls).toEqual([]);
  });

  it('routes Linear ticket patterns to linear_enumerate', async () => {
    const bridge = new RecordingBridge();
    const message = 'ENG-456 status?';

    const result = await runSpecialistFallback({ message }, { bridge });

    expect(result.route).toBe('linear_enumerate');
    expect(bridge.linearEnumerateCalls).toEqual([
      {
        query: message,
        filters: undefined,
        opts: undefined,
      },
    ]);
    expect(bridge.investigateCalls).toEqual([]);
    expect(bridge.enumerateCalls).toEqual([]);
  });

  it('returns none with a truthful failure reason for plain questions', async () => {
    const bridge = new RecordingBridge();

    const result = await runSpecialistFallback(
      { message: "what's the latest?" },
      { bridge },
    );

    expect(result).toEqual({
      route: 'none',
      truthfulFailureReason: 'no_routable_keywords',
    });
    expect(bridge.investigateCalls).toEqual([]);
    expect(bridge.enumerateCalls).toEqual([]);
    expect(bridge.linearEnumerateCalls).toEqual([]);
  });

  it('prefers github_investigate over enumerate when a numbered ref is present', async () => {
    const bridge = new RecordingBridge();

    const result = await runSpecialistFallback(
      { message: 'show me the diff for AgentWorkforce/cloud#397' },
      { bridge },
    );

    expect(result.route).toBe('github_investigate');
    expect(bridge.investigateCalls).toEqual([
      {
        ref: { owner: 'AgentWorkforce', repo: 'cloud', number: 397 },
        opts: undefined,
      },
    ]);
    expect(bridge.enumerateCalls).toEqual([]);
  });

  it('surfaces specialist failures with truthfulFailureReason and preserves findings', async () => {
    const failedFindings = createFindings({
      status: 'failed',
      summary: 'transport_unavailable',
    });
    const bridge = new RecordingBridge({ investigate: failedFindings });

    const result = await runSpecialistFallback(
      { message: 'please look at AgentWorkforce/sage#173' },
      { bridge },
    );

    expect(result.route).toBe('github_investigate');
    expect(result.truthfulFailureReason).toBe('specialist_failed');
    expect(result.findings).toBe(failedFindings);
  });

  it('rejects path-shaped owner/repo matches from file paths', async () => {
    const bridge = new RecordingBridge();

    const result = await runSpecialistFallback(
      { message: 'what is happening in src/foo/bar.ts?' },
      { bridge },
    );

    expect(result).toEqual({
      route: 'none',
      truthfulFailureReason: 'no_routable_keywords',
    });
    expect(bridge.investigateCalls).toEqual([]);
    expect(bridge.enumerateCalls).toEqual([]);
    expect(bridge.linearEnumerateCalls).toEqual([]);
  });
});
