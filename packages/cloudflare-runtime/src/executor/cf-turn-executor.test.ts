import type { ExecutionContext } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';

import { handleCfQueue, type CfQueueBatch } from './cf-turn-executor.js';
import type { TurnQueueMessage } from '../types.js';

function makeCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: undefined,
  };
}

function makeMessage(): TurnQueueMessage {
  return {
    type: 'webhook',
    provider: 'slack',
    descriptor: { channel: 'C123', text: 'hello' },
    receivedAt: '2026-04-24T00:00:00.000Z',
  };
}

describe('handleCfQueue', () => {
  it('awaits promises registered with waitUntil before acking', async () => {
    const events: string[] = [];
    let acked = false;
    const batch: CfQueueBatch<TurnQueueMessage> = {
      messages: [{ body: makeMessage(), ack: () => { acked = true; } }],
    };

    await handleCfQueue(batch, {}, makeCtx(), {
      runTurn(_message, _env, ctx) {
        ctx.waitUntil(Promise.resolve().then(() => events.push('waitUntil')));
        events.push('runTurn');
      },
    });

    expect(events).toEqual(['runTurn', 'waitUntil']);
    expect(acked).toBe(true);
  });

  it('propagates waitUntil rejections so the queue retries', async () => {
    let retried = false;
    const batch: CfQueueBatch<TurnQueueMessage> = {
      messages: [{ body: makeMessage(), retry: () => { retried = true; } }],
    };

    await expect(
      handleCfQueue(batch, {}, makeCtx(), {
        runTurn(_message, _env, ctx) {
          ctx.waitUntil(Promise.reject(new Error('failed async turn work')));
        },
      }),
    ).rejects.toThrow('failed async turn work');

    expect(retried).toBe(true);
  });
});
