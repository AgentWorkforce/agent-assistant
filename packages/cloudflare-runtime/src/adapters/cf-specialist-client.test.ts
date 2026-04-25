import type { Queue } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';

import { CfSpecialistClient } from './cf-specialist-client.js';
import type { TurnQueueMessage } from '../types.js';

describe('CfSpecialistClient', () => {
  it('enqueues specialist calls and results', async () => {
    const sent: TurnQueueMessage[] = [];
    const client = new CfSpecialistClient({
      async send(message: TurnQueueMessage) {
        sent.push(message);
      },
    } as Queue<TurnQueueMessage>);
    const trigger = {
      type: 'external_result',
      operationId: 'specialist_result:turn-1',
      resolvedAt: '2026-04-24T00:00:00.000Z',
    } as const;

    await client.callSpecialist({
      turnId: 'turn-1',
      capability: 'github',
      input: { query: 'status' },
      callbackTrigger: trigger,
    });
    await client.publishResult({ callbackTrigger: trigger, result: { ok: true } });

    expect(sent.map((message) => message.type)).toEqual(['specialist_call', 'specialist_result']);
  });
});
