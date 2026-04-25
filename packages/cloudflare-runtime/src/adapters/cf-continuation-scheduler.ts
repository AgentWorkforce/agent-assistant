import type { Queue } from '@cloudflare/workers-types';
import type { ContinuationSchedulerAdapter } from '@agent-assistant/continuation';

import type { TurnQueueMessage } from '../types.js';

export interface AlarmStorageLike {
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm?(): Promise<void>;
}

export interface CfContinuationSchedulerOptions {
  storage?: AlarmStorageLike;
  queue?: Queue<TurnQueueMessage>;
  now?: () => number;
}

export class CfContinuationScheduler implements ContinuationSchedulerAdapter {
  private readonly storage?: AlarmStorageLike;
  private readonly queue?: Queue<TurnQueueMessage>;
  private readonly now: () => number;

  constructor(options: CfContinuationSchedulerOptions) {
    this.storage = options.storage;
    this.queue = options.queue;
    this.now = options.now ?? Date.now;
  }

  async scheduleWake(input: {
    continuationId: string;
    wakeAtMs: number;
  }): Promise<{ wakeUpId: string }> {
    const wakeUpId = `wake:${input.continuationId}:${input.wakeAtMs}`;

    if (this.storage) {
      await this.storage.setAlarm(input.wakeAtMs);
      return { wakeUpId };
    }

    if (!this.queue) {
      throw new Error('CfContinuationScheduler requires storage or queue');
    }

    await this.queue.send(
      {
        type: 'resume',
        continuationId: input.continuationId,
        trigger: {
          type: 'scheduled_wake',
          wakeUpId,
          firedAt: new Date(input.wakeAtMs).toISOString(),
        },
      },
      { delaySeconds: Math.max(0, Math.ceil((input.wakeAtMs - this.now()) / 1000)) },
    );

    return { wakeUpId };
  }

  async cancelWake(): Promise<void> {
    await this.storage?.deleteAlarm?.();
  }
}
