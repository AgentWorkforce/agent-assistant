import type { DurableObjectState, ExecutionContext } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';

import { TurnExecutorDO } from './turn-executor-do.js';
import type { TurnQueueMessage } from '../types.js';

const state = {} as DurableObjectState;

function makeMessage(receivedAt: string): TurnQueueMessage {
  return {
    type: 'webhook',
    provider: 'slack',
    descriptor: { channel: 'C123', text: 'hello' },
    receivedAt,
  };
}

describe('TurnExecutorDO', () => {
  it('serializes turn execution and awaits waitUntil work', async () => {
    const events: string[] = [];

    class TestDO extends TurnExecutorDO {
      protected override async runTurn(message: TurnQueueMessage, ctx: ExecutionContext) {
        events.push(`start:${message.type === 'webhook' ? message.receivedAt : 'other'}`);
        ctx.waitUntil(
          Promise.resolve().then(() => {
            events.push(`wait:${message.type === 'webhook' ? message.receivedAt : 'other'}`);
          }),
        );
      }
    }

    const durableObject = new TestDO(state, {});

    await Promise.all([
      durableObject.runSerialized(makeMessage('1')),
      durableObject.runSerialized(makeMessage('2')),
    ]);

    expect(events).toEqual(['start:1', 'wait:1', 'start:2', 'wait:2']);
  });
});
