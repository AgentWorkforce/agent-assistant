import { describe, expect, it } from 'vitest';

import type { DelegationRequest } from './findings.js';

function deserializeDelegationRequest(value: string): DelegationRequest {
  return JSON.parse(value) as DelegationRequest;
}

describe('DelegationRequest JSON transport', () => {
  it('deserializes cleanly without workspaceId while preserving shape', () => {
    const parsed = deserializeDelegationRequest(
      JSON.stringify({
        requestId: 'req-1',
        capability: 'github.enumerate',
        params: {
          capability: 'github.enumerate',
          query: 'label:bug',
          limit: 5,
        },
        timeoutMs: 1_000,
        metadata: { source: 'test' },
      }),
    );

    expect(parsed).toEqual({
      requestId: 'req-1',
      capability: 'github.enumerate',
      params: {
        capability: 'github.enumerate',
        query: 'label:bug',
        limit: 5,
      },
      timeoutMs: 1_000,
      metadata: { source: 'test' },
    });
    expect('workspaceId' in parsed).toBe(false);
  });

  it('round-trips with workspaceId="ws-123"', () => {
    const request = {
      requestId: 'req-2',
      workspaceId: 'ws-123',
      capability: 'github.investigate',
      params: {
        capability: 'github.investigate',
        query: 'Investigate PR findings',
        pr: {
          owner: 'acme',
          repo: 'widget',
          number: 42,
        },
      },
      timeoutMs: 2_000,
      metadata: { source: 'test' },
    } satisfies DelegationRequest;

    const roundTripped = deserializeDelegationRequest(JSON.stringify(request));

    expect(roundTripped).toEqual(request);
    expect(roundTripped.workspaceId).toBe('ws-123');
  });
});
