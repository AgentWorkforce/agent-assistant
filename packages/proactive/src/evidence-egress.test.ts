import { describe, expect, it, vi } from 'vitest';

import { postWithEvidence } from './evidence-egress.js';
import type { ClaimEvidence, ProactiveEgress } from './evidence-egress.js';

type PostedCall = {
  channel: string;
  text: string;
  threadTs?: string;
};

class FakeProactiveEgress implements ProactiveEgress {
  readonly calls: PostedCall[] = [];

  constructor(private readonly error?: Error) {}

  async postMessageChunked(
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<unknown> {
    this.calls.push({ channel, text, threadTs });

    if (this.error) {
      throw this.error;
    }

    return { ok: true };
  }
}

function makeEvidence(): ClaimEvidence[] {
  return [{ id: 'spec-req-1', kind: 'github_investigate' }];
}

describe('postWithEvidence', () => {
  it('plain text post — no markers, no evidence required', async () => {
    const egress = new FakeProactiveEgress();

    const result = await postWithEvidence(
      {
        channel: 'team-updates',
        text: 'hi team, standup in 5',
        evidence: [],
      },
      { egress },
    );

    expect(result.posted).toBe(true);
    expect(egress.calls).toHaveLength(1);
    expect(egress.calls[0]).toEqual({
      channel: 'team-updates',
      text: 'hi team, standup in 5',
      threadTs: undefined,
    });
  });

  it('PR ref + empty evidence — BLOCKED', async () => {
    const egress = new FakeProactiveEgress();
    const onEvent = vi.fn();

    const result = await postWithEvidence(
      {
        channel: 'team-updates',
        text: 'PR AgentWorkforce/sage#173 looks ready',
        evidence: [],
      },
      { egress, onEvent },
    );

    expect(result.posted).toBe(false);
    expect(result.blockedReason).toBe('no_evidence');
    expect(result.detectedMarkers).toContain('pr_ref');
    expect(egress.calls).toHaveLength(0);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'proactive_post_blocked_no_evidence',
        channel: 'team-updates',
      }),
    );
  });

  it('PR ref + non-empty evidence — POSTED', async () => {
    const egress = new FakeProactiveEgress();

    const result = await postWithEvidence(
      {
        channel: 'team-updates',
        text: 'PR AgentWorkforce/sage#173 looks ready',
        evidence: makeEvidence(),
      },
      { egress },
    );

    expect(result.posted).toBe(true);
    expect(egress.calls).toHaveLength(1);
  });

  it('SHA reference + empty evidence — BLOCKED', async () => {
    const egress = new FakeProactiveEgress();

    const result = await postWithEvidence(
      {
        channel: 'team-updates',
        text: 'b5c1e2f reverts commit aaa',
        evidence: [],
      },
      { egress },
    );

    expect(result.posted).toBe(false);
    expect(result.blockedReason).toBe('no_evidence');
    expect(egress.calls).toHaveLength(0);
  });

  it('Linear ticket + empty evidence — BLOCKED', async () => {
    const egress = new FakeProactiveEgress();

    const result = await postWithEvidence(
      {
        channel: 'team-updates',
        text: 'ENG-456 needs your input',
        evidence: [],
      },
      { egress },
    );

    expect(result.posted).toBe(false);
    expect(result.blockedReason).toBe('no_evidence');
    expect(egress.calls).toHaveLength(0);
  });

  it("is-synced negation + empty evidence — BLOCKED", async () => {
    const egress = new FakeProactiveEgress();

    const result = await postWithEvidence(
      {
        channel: 'team-updates',
        text: "relayfile isn't synced in this workspace",
        evidence: [],
      },
      { egress },
    );

    expect(result.posted).toBe(false);
    expect(result.blockedReason).toBe('no_evidence');
    expect(egress.calls).toHaveLength(0);
  });

  it('merged-at phrasing + empty evidence — BLOCKED', async () => {
    const egress = new FakeProactiveEgress();

    const result = await postWithEvidence(
      {
        channel: 'team-updates',
        text: 'The PR was merged at 14:32',
        evidence: [],
      },
      { egress },
    );

    expect(result.posted).toBe(false);
    expect(result.blockedReason).toBe('no_evidence');
    expect(egress.calls).toHaveLength(0);
  });

  it('github.com URL + empty evidence — BLOCKED', async () => {
    const egress = new FakeProactiveEgress();

    const result = await postWithEvidence(
      {
        channel: 'team-updates',
        text: 'see https://github.com/AgentWorkforce/sage/pull/173',
        evidence: [],
      },
      { egress },
    );

    expect(result.posted).toBe(false);
    expect(result.blockedReason).toBe('no_evidence');
    expect(egress.calls).toHaveLength(0);
  });

  it('bypassEvidenceCheck=true bypasses — POSTED with markers but no evidence', async () => {
    const egress = new FakeProactiveEgress();

    const result = await postWithEvidence(
      {
        channel: 'team-updates',
        text: 'PR AgentWorkforce/sage#173 looks ready',
        evidence: [],
      },
      { egress, bypassEvidenceCheck: true },
    );

    expect(result.posted).toBe(true);
    expect(result.detectedMarkers?.length ?? 0).toBeGreaterThan(0);
    expect(egress.calls).toHaveLength(1);
  });

  it('egress throws → blocked with egress_failed, no rethrow', async () => {
    const egress = new FakeProactiveEgress(new Error('egress unavailable'));

    await expect(
      postWithEvidence(
        {
          channel: 'team-updates',
          text: 'hi team, standup in 5',
          evidence: [],
        },
        { egress },
      ),
    ).resolves.toMatchObject({
      posted: false,
      blockedReason: 'egress_failed',
    });
  });
});
