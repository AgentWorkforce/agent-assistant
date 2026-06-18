import type { SchedulerBinding, WakeUpContext } from '@agent-assistant/proactive';

export interface WorkflowInstanceLike {
  readonly id: string;
  terminate(): Promise<void>;
}

export interface CloudflareWorkflowBindingLike {
  create(options: { id?: string; params?: Record<string, unknown> }): Promise<WorkflowInstanceLike>;
  get(id: string): Promise<WorkflowInstanceLike>;
}

export interface CfWorkflowSchedulerBindingOptions {
  binding: CloudflareWorkflowBindingLike;
}

/**
 * SchedulerBinding for @agent-assistant/proactive backed by Cloudflare Workflows.
 *
 * Each wake-up becomes a Workflow instance. The Workflow itself must be
 * authored by the consumer — it receives { wakeAt, context } as params,
 * sleeps until wakeAt, then invokes the appropriate handler. This adapter
 * only manages instance lifecycle (create / terminate).
 */
export class CfWorkflowSchedulerBinding implements SchedulerBinding {
  private readonly binding: CloudflareWorkflowBindingLike;

  constructor(options: CfWorkflowSchedulerBindingOptions) {
    this.binding = options.binding;
  }

  async requestWakeUp(at: Date, context: WakeUpContext): Promise<string> {
    const instanceId = buildInstanceId(context, at);
    await this.binding.create({
      id: instanceId,
      params: { wakeAt: at.toISOString(), context },
    });
    return instanceId;
  }

  async cancelWakeUp(bindingId: string): Promise<void> {
    try {
      const instance = await this.binding.get(bindingId);
      await instance.terminate();
    } catch {
      // Already terminated, not found, or the Workflow completed before we cancelled.
      // All treated as no-op — the SchedulerBinding contract allows this.
    }
  }
}

function buildInstanceId(context: WakeUpContext, at: Date): string {
  const ruleSegment = context.ruleId ? `:${context.ruleId}` : '';
  return `wakeup:${context.sessionId}${ruleSegment}:${at.getTime()}`;
}
