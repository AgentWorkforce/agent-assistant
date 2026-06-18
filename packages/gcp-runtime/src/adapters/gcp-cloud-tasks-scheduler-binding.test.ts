import { describe, expect, it, vi } from 'vitest';
import type { WakeUpContext } from '@agent-assistant/proactive';
import {
  GcpCloudTasksSchedulerBinding,
  type CloudTasksClientLike,
} from './gcp-cloud-tasks-scheduler-binding.js';

function makeClient(): {
  tasks: Map<string, unknown>;
  client: CloudTasksClientLike;
} {
  const tasks = new Map<string, unknown>();
  const client: CloudTasksClientLike = {
    queuePath(project, location, queue) {
      return `projects/${project}/locations/${location}/queues/${queue}`;
    },
    async createTask(req) {
      const name = req.task.name ?? `${req.parent}/tasks/auto`;
      tasks.set(name, req.task);
      return [{ name }];
    },
    async deleteTask(req) {
      tasks.delete(req.name);
    },
  };
  return { tasks, client };
}

const baseContext: WakeUpContext = {
  sessionId: 'sess-1',
  scheduledAt: '2026-01-01T00:00:00Z',
};

const opts = {
  project: 'my-project',
  location: 'us-central1',
  queue: 'proactive-wakeups',
  handlerUrl: 'https://example.com/wakeup',
};

describe('GcpCloudTasksSchedulerBinding', () => {
  it('creates a task and returns its name', async () => {
    const { tasks, client } = makeClient();
    const scheduler = new GcpCloudTasksSchedulerBinding({ ...opts, client });

    const at = new Date('2026-06-01T12:00:00Z');
    const id = await scheduler.requestWakeUp(at, baseContext);

    expect(id).toBeTruthy();
    expect(tasks.size).toBe(1);
  });

  it('encodes wakeAt and context in task body', async () => {
    const { tasks, client } = makeClient();
    const scheduler = new GcpCloudTasksSchedulerBinding({ ...opts, client });

    const at = new Date('2026-06-01T12:00:00Z');
    await scheduler.requestWakeUp(at, { ...baseContext, ruleId: 'my-rule' });

    const task = [...tasks.values()][0] as { httpRequest: { body: string } };
    const body = JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString());
    expect(body.wakeAt).toBe(at.toISOString());
    expect(body.context.sessionId).toBe('sess-1');
    expect(body.context.ruleId).toBe('my-rule');
  });

  it('uses scheduleTime based on the requested at date', async () => {
    const { tasks, client } = makeClient();
    const scheduler = new GcpCloudTasksSchedulerBinding({ ...opts, client });

    const at = new Date('2030-01-01T00:00:00Z');
    await scheduler.requestWakeUp(at, baseContext);

    const task = [...tasks.values()][0] as { scheduleTime: { seconds: number } };
    expect(task.scheduleTime.seconds).toBe(Math.floor(at.getTime() / 1000));
  });

  it('deletes the task on cancelWakeUp', async () => {
    const { tasks, client } = makeClient();
    const scheduler = new GcpCloudTasksSchedulerBinding({ ...opts, client });

    const id = await scheduler.requestWakeUp(new Date(), baseContext);
    expect(tasks.size).toBe(1);
    await scheduler.cancelWakeUp(id);
    expect(tasks.size).toBe(0);
  });

  it('is a no-op when cancelling a non-existent task', async () => {
    const { client } = makeClient();
    const scheduler = new GcpCloudTasksSchedulerBinding({ ...opts, client });
    await expect(scheduler.cancelWakeUp('nonexistent-task-name')).resolves.toBeUndefined();
  });

  it('includes OIDC token when serviceAccountEmail is set', async () => {
    const { tasks, client } = makeClient();
    const scheduler = new GcpCloudTasksSchedulerBinding({
      ...opts,
      client,
      serviceAccountEmail: 'svc@project.iam.gserviceaccount.com',
    });

    await scheduler.requestWakeUp(new Date(), baseContext);
    const task = [...tasks.values()][0] as { httpRequest: { oidcToken?: unknown } };
    expect(task.httpRequest.oidcToken).toBeDefined();
  });
});
