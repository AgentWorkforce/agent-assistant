import { describe, expect, it, vi } from 'vitest';
import type { WakeUpContext } from '@agent-assistant/proactive';
import {
  CfWorkflowSchedulerBinding,
  type CloudflareWorkflowBindingLike,
  type WorkflowInstanceLike,
} from './cf-workflow-scheduler-binding.js';

function makeBinding(): {
  instances: Map<string, WorkflowInstanceLike>;
  binding: CloudflareWorkflowBindingLike;
} {
  const instances = new Map<string, WorkflowInstanceLike>();

  const binding: CloudflareWorkflowBindingLike = {
    async create(options) {
      const id = options.id ?? crypto.randomUUID();
      const instance: WorkflowInstanceLike = { id, terminate: vi.fn().mockResolvedValue(undefined) };
      instances.set(id, instance);
      return instance;
    },
    async get(id) {
      const instance = instances.get(id);
      if (!instance) throw new Error(`Not found: ${id}`);
      return instance;
    },
  };

  return { instances, binding };
}

const baseContext: WakeUpContext = {
  sessionId: 'sess-1',
  scheduledAt: '2026-01-01T00:00:00Z',
};

describe('CfWorkflowSchedulerBinding', () => {
  it('creates a workflow instance and returns its id', async () => {
    const { instances, binding } = makeBinding();
    const scheduler = new CfWorkflowSchedulerBinding({ binding });

    const at = new Date('2026-01-02T12:00:00Z');
    const id = await scheduler.requestWakeUp(at, baseContext);

    expect(id).toBeTruthy();
    expect(instances.has(id)).toBe(true);
  });

  it('encodes sessionId and ruleId in the instance id', async () => {
    const { binding } = makeBinding();
    const scheduler = new CfWorkflowSchedulerBinding({ binding });

    const ctx: WakeUpContext = { ...baseContext, ruleId: 'my-rule' };
    const id = await scheduler.requestWakeUp(new Date('2026-06-01T00:00:00Z'), ctx);

    expect(id).toContain('sess-1');
    expect(id).toContain('my-rule');
  });

  it('terminates the workflow instance on cancelWakeUp', async () => {
    const { instances, binding } = makeBinding();
    const scheduler = new CfWorkflowSchedulerBinding({ binding });

    const id = await scheduler.requestWakeUp(new Date(), baseContext);
    await scheduler.cancelWakeUp(id);

    expect(instances.get(id)?.terminate).toHaveBeenCalledOnce();
  });

  it('is a no-op when cancelling a non-existent bindingId', async () => {
    const { binding } = makeBinding();
    const scheduler = new CfWorkflowSchedulerBinding({ binding });

    // Should not throw even though the instance doesn't exist
    await expect(scheduler.cancelWakeUp('nonexistent-id')).resolves.toBeUndefined();
  });

  it('generates unique ids for different wakeUp times', async () => {
    const { binding } = makeBinding();
    const scheduler = new CfWorkflowSchedulerBinding({ binding });

    const id1 = await scheduler.requestWakeUp(new Date('2026-01-01T00:00:00Z'), baseContext);
    const id2 = await scheduler.requestWakeUp(new Date('2026-01-02T00:00:00Z'), baseContext);

    expect(id1).not.toBe(id2);
  });
});
