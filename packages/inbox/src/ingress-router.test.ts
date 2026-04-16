import { describe, expect, it, vi } from 'vitest';

import { createIngressRouter } from './ingress-router.js';
import type {
  IngressEnvelope,
  IngressHandler,
  IngressResolutionResult,
} from './ingress-types.js';

function makeEnvelope(overrides?: Partial<IngressEnvelope>): IngressEnvelope {
  return {
    provider: 'github',
    eventType: 'issue.created',
    connectionId: 'conn-1',
    providerConfigKey: 'github-prod',
    payload: { issueId: 42 },
    rawMeta: { deliveryId: 'delivery-1' },
    receivedAt: '2026-04-16T10:00:00.000Z',
    ...overrides,
  };
}

function makeResolution(
  overrides?: Partial<IngressResolutionResult & { resolved: true }>,
): IngressResolutionResult & { resolved: true } {
  return {
    resolved: true,
    workspaceId: 'workspace-1',
    assistantId: 'assistant-1',
    resolvedVia: 'installation-id',
    metadata: { installationId: 123 },
    ...overrides,
  };
}

function makeHandler(overrides?: Partial<IngressHandler>): IngressHandler {
  return {
    provider: 'github',
    handle: vi.fn().mockResolvedValue({
      handled: true,
      outcome: 'written',
      inboxItemId: 'item-1',
    }),
    ...overrides,
  };
}

describe('createIngressRouter', () => {
  it('returns skipped when no handlers are registered', async () => {
    const router = createIngressRouter();

    await expect(
      router.route({
        envelope: makeEnvelope(),
        resolution: makeResolution(),
      }),
    ).resolves.toEqual({
      handled: false,
      outcome: 'skipped',
    });
  });

  it('dispatches to a matching handler by provider', async () => {
    const router = createIngressRouter();
    const handler = makeHandler();
    const envelope = makeEnvelope();
    const resolution = makeResolution();
    router.register(handler);

    const result = await router.route({ envelope, resolution });

    expect(handler.handle).toHaveBeenCalledWith({ envelope, resolution });
    expect(result).toEqual({
      handled: true,
      outcome: 'written',
      inboxItemId: 'item-1',
    });
  });

  it('dispatches to a matching handler by provider and event type', async () => {
    const router = createIngressRouter();
    const handler = makeHandler({ eventTypes: ['issue.created'] });
    router.register(handler);

    const result = await router.route({
      envelope: makeEnvelope({ eventType: 'issue.created' }),
      resolution: makeResolution(),
    });

    expect(handler.handle).toHaveBeenCalledOnce();
    expect(result.handled).toBe(true);
  });

  it('returns skipped when provider matches but event type does not', async () => {
    const router = createIngressRouter();
    const handler = makeHandler({ eventTypes: ['issue.closed'] });
    router.register(handler);

    const result = await router.route({
      envelope: makeEnvelope({ eventType: 'issue.created' }),
      resolution: makeResolution(),
    });

    expect(handler.handle).not.toHaveBeenCalled();
    expect(result).toEqual({
      handled: false,
      outcome: 'skipped',
    });
  });

  it('uses the first registered matching handler when multiple handlers match', async () => {
    const router = createIngressRouter();
    const first = makeHandler({
      handle: vi.fn().mockResolvedValue({
        handled: true,
        outcome: 'written',
        inboxItemId: 'item-first',
      }),
    });
    const second = makeHandler({
      handle: vi.fn().mockResolvedValue({
        handled: true,
        outcome: 'written',
        inboxItemId: 'item-second',
      }),
    });
    router.register(first);
    router.register(second);

    const result = await router.route({
      envelope: makeEnvelope(),
      resolution: makeResolution(),
    });

    expect(first.handle).toHaveBeenCalledOnce();
    expect(second.handle).not.toHaveBeenCalled();
    expect(result.inboxItemId).toBe('item-first');
  });

  it('passes handler metrics through unchanged', async () => {
    const router = createIngressRouter();
    const handler = makeHandler({
      handle: vi.fn().mockResolvedValue({
        handled: true,
        outcome: 'partial',
        metrics: {
          itemsWritten: 1,
          itemsSkipped: 2,
          errorCount: 3,
          durationMs: 4,
        },
      }),
    });
    router.register(handler);

    await expect(
      router.route({
        envelope: makeEnvelope(),
        resolution: makeResolution(),
      }),
    ).resolves.toEqual({
      handled: true,
      outcome: 'partial',
      metrics: {
        itemsWritten: 1,
        itemsSkipped: 2,
        errorCount: 3,
        durationMs: 4,
      },
    });
  });

  it('converts thrown handler errors into deterministic error results', async () => {
    const router = createIngressRouter();
    const handler = makeHandler({
      handle: vi.fn().mockRejectedValue(new Error('handler exploded')),
    });
    router.register(handler);

    await expect(
      router.route({
        envelope: makeEnvelope(),
        resolution: makeResolution(),
      }),
    ).resolves.toEqual({
      handled: false,
      outcome: 'error',
      reason: 'handler exploded',
    });
  });

  it('routes envelopes with null connection ids without error', async () => {
    const router = createIngressRouter();
    const handler = makeHandler();
    const envelope = makeEnvelope({ connectionId: null });
    router.register(handler);

    const result = await router.route({
      envelope,
      resolution: makeResolution(),
    });

    expect(handler.handle).toHaveBeenCalledWith({
      envelope,
      resolution: makeResolution(),
    });
    expect(result.handled).toBe(true);
  });
});
