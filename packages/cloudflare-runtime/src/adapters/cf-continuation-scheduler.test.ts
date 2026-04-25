import type { Queue } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';

import { CfContinuationScheduler } from './cf-continuation-scheduler.js';
import type { TurnQueueMessage } from '../types.js';

describe('CfContinuationScheduler', () => {
  it('uses DO alarms when storage is provided', async () => {
    let alarmAt: number | Date | undefined;
    const scheduler = new CfContinuationScheduler({
      storage: {
        async setAlarm(value) {
          alarmAt = value;
        },
      },
    });

    await expect(
      scheduler.scheduleWake({ continuationId: 'cont-1', wakeAtMs: 1_000 }),
    ).resolves.toEqual({ wakeUpId: 'wake:cont-1:1000' });
    expect(alarmAt).toBe(1_000);
  });

  it('sends delayed resume messages when queue scheduling is used', async () => {
    const sent: { message: TurnQueueMessage; options?: unknown }[] = [];
    const queue = {
      async send(message: TurnQueueMessage, options?: unknown) {
        sent.push({ message, options });
      },
    } as Queue<TurnQueueMessage>;

    const scheduler = new CfContinuationScheduler({ queue, now: () => 500 });
    await scheduler.scheduleWake({ continuationId: 'cont-1', wakeAtMs: 2_500 });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.message.type).toBe('resume');
    expect(sent[0]?.options).toEqual({ delaySeconds: 2 });
  });
});
