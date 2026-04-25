import type { ContinuationDeliveryInput } from '@agent-assistant/continuation';
import { describe, expect, it } from 'vitest';

import { CfDeliveryAdapter } from './cf-delivery-adapter.js';

function makeInput(kind: 'slack' | 'github' | 'a2a-callback'): ContinuationDeliveryInput {
  return {
    continuation: {
      id: 'cont-1',
      assistantId: 'sage',
      origin: {
        turnId: 'turn-1',
        outcome: 'deferred',
        stopReason: 'runtime_error',
        createdAt: '2026-04-24T00:00:00.000Z',
      },
      status: 'completed',
      waitFor: { type: 'external_result', operationId: 'op-1' },
      continuation: {},
      delivery: {
        status: 'pending_delivery',
        target: kind === 'slack'
          ? { kind, channel: 'C123' }
          : kind === 'github'
            ? { kind, repository: 'owner/repo', issueNumber: 1 }
            : { kind, url: 'https://example.test/callback' },
      },
      bounds: {
        expiresAt: '2026-04-25T00:00:00.000Z',
        maxResumeAttempts: 3,
        resumeAttempts: 0,
      },
      createdAt: '2026-04-24T00:00:00.000Z',
      updatedAt: '2026-04-24T00:00:00.000Z',
    },
    harnessResult: {
      outcome: 'completed',
      stopReason: 'answer_finalized',
      turnId: 'turn-2',
      traceSummary: {
        iterationCount: 1,
        toolCallCount: 0,
        hadContinuation: false,
        finalEventType: 'turn_finished',
      },
      usage: { modelCalls: 0, toolCalls: 0 },
    },
  };
}

describe('CfDeliveryAdapter', () => {
  it('dispatches by target kind', async () => {
    const seen: string[] = [];
    const adapter = new CfDeliveryAdapter({
      slack: () => { seen.push('slack'); },
      github: () => { seen.push('github'); },
      a2aCallback: () => { seen.push('a2a-callback'); },
    });

    await adapter.deliver(makeInput('slack'));
    await adapter.deliver(makeInput('github'));
    await adapter.deliver(makeInput('a2a-callback'));

    expect(seen).toEqual(['slack', 'github', 'a2a-callback']);
  });

  it('returns failure when the matching handler is not registered', async () => {
    const adapter = new CfDeliveryAdapter({});

    expect(await adapter.deliver(makeInput('slack'))).toEqual({
      delivered: false,
      failureReason: 'no_slack_handler',
    });
    expect(await adapter.deliver(makeInput('github'))).toEqual({
      delivered: false,
      failureReason: 'no_github_handler',
    });
    expect(await adapter.deliver(makeInput('a2a-callback'))).toEqual({
      delivered: false,
      failureReason: 'no_a2a_callback_handler',
    });
  });

  it('returns failure for unknown target kinds', async () => {
    const adapter = new CfDeliveryAdapter({
      slack: () => undefined,
    });
    const input = makeInput('slack');
    // Force the target into an unknown kind that still has a kind field —
    // simulates a future delivery target that the adapter doesn't yet understand.
    (input.continuation.delivery.target as { kind: string }).kind = 'unknown-future-channel';

    const result = await adapter.deliver(input);
    expect(result).toEqual({
      delivered: false,
      failureReason: 'unsupported_target_kind:unknown-future-channel',
    });
  });

  it('still surfaces handler exceptions as failure (not delivered:true)', async () => {
    const adapter = new CfDeliveryAdapter({
      slack: () => {
        throw new Error('upstream slack 500');
      },
    });

    const result = await adapter.deliver(makeInput('slack'));
    expect(result).toEqual({
      delivered: false,
      failureReason: 'upstream slack 500',
    });
  });
});
