import type { SchedulerBinding, WakeUpContext } from '@agent-assistant/proactive';

// ─── Minimal Cloud Tasks interface ────────────────────────────────────────────
// Accepts a real @google-cloud/tasks CloudTasksClient without importing the package.

export interface CloudTasksHttpRequest {
  url: string;
  httpMethod: 'POST' | 'GET';
  headers?: Record<string, string>;
  /** Base64-encoded request body. */
  body?: string;
}

export interface CloudTasksTask {
  name?: string;
  scheduleTime?: { seconds: number };
  httpRequest: CloudTasksHttpRequest;
}

export interface CloudTasksClientLike {
  createTask(request: { parent: string; task: CloudTasksTask }): Promise<[{ name?: string | null }]>;
  deleteTask(request: { name: string }): Promise<unknown>;
  /**
   * Builds the full queue resource path.
   * On the real client: client.queuePath(project, location, queue)
   */
  queuePath(project: string, location: string, queue: string): string;
}

export interface GcpCloudTasksSchedulerBindingOptions {
  client: CloudTasksClientLike;
  /** GCP project ID. */
  project: string;
  /** Cloud Tasks queue location (e.g. 'us-central1'). */
  location: string;
  /** Cloud Tasks queue name. */
  queue: string;
  /**
   * URL of the HTTP endpoint that handles wake-up delivery.
   * Receives POST with JSON body: { wakeAt: string, context: WakeUpContext }.
   */
  handlerUrl: string;
  /** Optional OIDC token audience for authenticated push targets. */
  serviceAccountEmail?: string;
}

/**
 * SchedulerBinding for @agent-assistant/proactive backed by Google Cloud Tasks.
 *
 * Each requested wake-up becomes a Cloud Tasks HTTP task with a scheduled
 * delivery time. The task POSTs to `handlerUrl` with the wake-up context.
 * The consumer's HTTP handler is responsible for invoking the proactive engine.
 */
export class GcpCloudTasksSchedulerBinding implements SchedulerBinding {
  private readonly client: CloudTasksClientLike;
  private readonly project: string;
  private readonly location: string;
  private readonly queue: string;
  private readonly handlerUrl: string;
  private readonly serviceAccountEmail?: string;

  constructor(options: GcpCloudTasksSchedulerBindingOptions) {
    this.client = options.client;
    this.project = options.project;
    this.location = options.location;
    this.queue = options.queue;
    this.handlerUrl = options.handlerUrl;
    this.serviceAccountEmail = options.serviceAccountEmail;
  }

  async requestWakeUp(at: Date, context: WakeUpContext): Promise<string> {
    const parent = this.client.queuePath(this.project, this.location, this.queue);
    const taskId = buildTaskId(context, at);
    const taskName = `${parent}/tasks/${taskId}`;

    const body = Buffer.from(JSON.stringify({ wakeAt: at.toISOString(), context })).toString('base64');

    const httpRequest: CloudTasksHttpRequest = {
      url: this.handlerUrl,
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    };

    if (this.serviceAccountEmail) {
      (httpRequest as unknown as Record<string, unknown>)['oidcToken'] = {
        serviceAccountEmail: this.serviceAccountEmail,
        audience: this.handlerUrl,
      };
    }

    const [task] = await this.client.createTask({
      parent,
      task: {
        name: taskName,
        scheduleTime: { seconds: Math.floor(at.getTime() / 1000) },
        httpRequest,
      },
    });

    return task.name ?? taskName;
  }

  async cancelWakeUp(bindingId: string): Promise<void> {
    try {
      await this.client.deleteTask({ name: bindingId });
    } catch {
      // Task already fired or does not exist — cancellation is a no-op.
    }
  }
}

function buildTaskId(context: WakeUpContext, at: Date): string {
  const ruleSegment = context.ruleId ? `-${context.ruleId}` : '';
  // Cloud Tasks names: [a-zA-Z0-9_-] only; sanitize sessionId and ruleId
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `wakeup-${safe(context.sessionId)}${safe(ruleSegment)}-${at.getTime()}`;
}
