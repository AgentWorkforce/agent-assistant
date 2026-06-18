import { describe, expect, it } from 'vitest';
import {
  GcpCloudTasksContinuationScheduler,
  type GcpCloudTasksContinuationSchedulerOptions,
} from './gcp-cloud-tasks-continuation-scheduler.js';
import type { CloudTasksClientLike } from './gcp-cloud-tasks-scheduler-binding.js';

function makeClient(): { tasks: Map<string, unknown>; client: CloudTasksClientLike } {
  const tasks = new Map<string, unknown>();
  const client: CloudTasksClientLike = {
    queuePath(p, l, q) { return `projects/${p}/locations/${l}/queues/${q}`; },
    async createTask(req) {
      const name = req.task.name ?? `${req.parent}/tasks/auto`;
      tasks.set(name, req.task);
      return [{ name }];
    },
    async deleteTask(req) { tasks.delete(req.name); },
  };
  return { tasks, client };
}

const baseOpts: Omit<GcpCloudTasksContinuationSchedulerOptions, 'client'> = {
  project: 'proj',
  location: 'us-central1',
  queue: 'continuations',
  handlerUrl: 'https://example.com/resume',
};

describe('GcpCloudTasksContinuationScheduler', () => {
  it('scheduleWake creates a task and returns a wakeUpId', async () => {
    const { tasks, client } = makeClient();
    const scheduler = new GcpCloudTasksContinuationScheduler({ ...baseOpts, client });

    const { wakeUpId } = await scheduler.scheduleWake({
      continuationId: 'cont-abc',
      wakeAtMs: Date.now() + 60_000,
    });

    expect(wakeUpId).toContain('cont-abc');
    expect(tasks.size).toBe(1);
  });

  it('task body contains continuationId and trigger', async () => {
    const { tasks, client } = makeClient();
    const scheduler = new GcpCloudTasksContinuationScheduler({ ...baseOpts, client });

    const { wakeUpId } = await scheduler.scheduleWake({ continuationId: 'cont-xyz', wakeAtMs: Date.now() + 5000 });

    const task = [...tasks.values()][0] as { httpRequest: { body: string } };
    const body = JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString());
    expect(body.continuationId).toBe('cont-xyz');
    expect(body.trigger.type).toBe('scheduled_wake');
    expect(body.trigger.wakeUpId).toBe(wakeUpId);
  });

  it('cancelWake deletes the task', async () => {
    const { tasks, client } = makeClient();
    const scheduler = new GcpCloudTasksContinuationScheduler({ ...baseOpts, client });

    const { wakeUpId } = await scheduler.scheduleWake({ continuationId: 'cont-1', wakeAtMs: Date.now() + 5000 });
    expect(tasks.size).toBe(1);
    await scheduler.cancelWake(wakeUpId);
    expect(tasks.size).toBe(0);
  });

  it('cancelWake is a no-op for unknown wakeUpId', async () => {
    const { client } = makeClient();
    const scheduler = new GcpCloudTasksContinuationScheduler({ ...baseOpts, client });
    await expect(scheduler.cancelWake('unknown-wake-id')).resolves.toBeUndefined();
  });

  it('wakeUpId is stable and unique per continuationId and wakeAtMs', async () => {
    const { client } = makeClient();
    const scheduler = new GcpCloudTasksContinuationScheduler({ ...baseOpts, client });

    const t = Date.now() + 10_000;
    const { wakeUpId: id1 } = await scheduler.scheduleWake({ continuationId: 'cont-a', wakeAtMs: t });
    const { wakeUpId: id2 } = await scheduler.scheduleWake({ continuationId: 'cont-b', wakeAtMs: t });
    expect(id1).not.toBe(id2);
  });
});
