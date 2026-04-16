import { describe, expect, it } from 'vitest';

import { projectEnvelopeToInboxInput } from './ingress-projection.js';
import type {
  IngressEnvelope,
  IngressResolutionResult,
} from './ingress-types.js';

function makeEnvelope(overrides?: Partial<IngressEnvelope>): IngressEnvelope {
  return {
    provider: 'slack',
    eventType: 'message.posted',
    connectionId: 'conn-42',
    providerConfigKey: 'slack-team-a',
    payload: {
      text: 'hello',
      channel: 'general',
    },
    rawMeta: { deliveryId: 'evt-1' },
    receivedAt: '2026-04-16T09:30:00.000Z',
    ...overrides,
  };
}

function makeResolution(
  overrides?: Partial<IngressResolutionResult & { resolved: true }>,
): IngressResolutionResult & { resolved: true } {
  return {
    resolved: true,
    workspaceId: 'workspace-9',
    assistantId: 'assistant-9',
    resolvedVia: 'team-id',
    metadata: { teamId: 'T123' },
    ...overrides,
  };
}

describe('projectEnvelopeToInboxInput', () => {
  it('projects an envelope with all fields into InboxWriteInput', () => {
    const envelope = makeEnvelope();
    const resolution = makeResolution();

    expect(
      projectEnvelopeToInboxInput({
        envelope,
        resolution,
        kind: 'trusted_memo',
        trustLevel: 'verified',
        title: 'Slack message',
        tags: ['slack', 'inbox'],
      }),
    ).toEqual({
      assistantId: 'assistant-9',
      kind: 'trusted_memo',
      source: {
        sourceId: 'slack',
        trustLevel: 'verified',
        producedAt: '2026-04-16T09:30:00.000Z',
      },
      content: JSON.stringify(envelope.payload),
      title: 'Slack message',
      tags: ['slack', 'inbox'],
      scope: {
        workspaceId: 'workspace-9',
      },
      metadata: {
        ingress: {
          provider: 'slack',
          eventType: 'message.posted',
          connectionId: 'conn-42',
          resolvedVia: 'team-id',
        },
      },
    });
  });

  it('uses resolution.assistantId when present', () => {
    const projected = projectEnvelopeToInboxInput({
      envelope: makeEnvelope(),
      resolution: makeResolution({ assistantId: 'assistant-override' }),
    });

    expect(projected.assistantId).toBe('assistant-override');
  });

  it('falls back to resolution.workspaceId when assistantId is absent', () => {
    const projected = projectEnvelopeToInboxInput({
      envelope: makeEnvelope(),
      resolution: makeResolution({ assistantId: undefined }),
    });

    expect(projected.assistantId).toBe('workspace-9');
  });

  it('defaults kind to other when not specified', () => {
    const projected = projectEnvelopeToInboxInput({
      envelope: makeEnvelope(),
      resolution: makeResolution(),
    });

    expect(projected.kind).toBe('other');
  });

  it('defaults trustLevel to trusted when not specified', () => {
    const projected = projectEnvelopeToInboxInput({
      envelope: makeEnvelope(),
      resolution: makeResolution(),
    });

    expect(projected.source.trustLevel).toBe('trusted');
  });

  it('preserves ingress metadata in the output metadata', () => {
    const projected = projectEnvelopeToInboxInput({
      envelope: makeEnvelope({
        provider: 'github',
        eventType: 'pull_request.opened',
        connectionId: null,
      }),
      resolution: makeResolution({ resolvedVia: 'installation-id' }),
    });

    expect(projected.metadata).toEqual({
      ingress: {
        provider: 'github',
        eventType: 'pull_request.opened',
        connectionId: null,
        resolvedVia: 'installation-id',
      },
    });
  });

  it('serializes the payload into the content string', () => {
    const projected = projectEnvelopeToInboxInput({
      envelope: makeEnvelope({ payload: { nested: ['a', 'b'], ok: true } }),
      resolution: makeResolution(),
    });

    expect(projected.content).toBe('{"nested":["a","b"],"ok":true}');
  });

  it('includes the resolved workspace id in scope', () => {
    const projected = projectEnvelopeToInboxInput({
      envelope: makeEnvelope(),
      resolution: makeResolution({ workspaceId: 'workspace-override' }),
    });

    expect(projected.scope).toEqual({
      workspaceId: 'workspace-override',
    });
  });
});
