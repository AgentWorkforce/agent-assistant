import type { ContinuationSchedulerAdapter } from '@agent-assistant/continuation';

import type { CloudTasksClientLike, CloudTasksHttpRequest } from './gcp-cloud-tasks-scheduler-binding.js';

export interface GcpCloudTasksContinuationSchedulerOptions {
  client: CloudTasksClientLike;
  /** GCP project ID. */
  project: string;
  /** Cloud Tasks queue location (e.g. 'us-central1'). */
  location: string;
  /** Cloud Tasks queue name. */
  queue: string;
  /**
   * URL of the HTTP endpoint that handles continuation resume delivery.
   * Receives POST with JSON body: { continuationId: string, trigger: ContinuationResumeTrigger }.
   */
  handlerUrl: string;
  /** Optional OIDC service account email for authenticated push targets. */
  serviceAccountEmail?: string;
  now?: () => number;
}

/**
 * ContinuationSchedulerAdapter backed by Google Cloud Tasks.
 *
 * Each scheduled wake-up becomes a Cloud Tasks HTTP task. The consumer's
 * HTTP handler must parse the body and call continuationRuntime.resume().
 */
export class GcpCloudTasksContinuationScheduler implements ContinuationSchedulerAdapter {
  private readonly client: CloudTasksClientLike;
  private readonly project: string;
  private readonly location: string;
  private readonly queue: string;
  private readonly handlerUrl: string;
  private readonly serviceAccountEmail?: string;
  private readonly now: () => number;

  constructor(options: GcpCloudTasksContinuationSchedulerOptions) {
    this.client = options.client;
    this.project = options.project;
    this.location = options.location;
    this.queue = options.queue;
    this.handlerUrl = options.handlerUrl;
    this.serviceAccountEmail = options.serviceAccountEmail;
    this.now = options.now ?? Date.now;
  }

  async scheduleWake(input: {
    continuationId: string;
    wakeAtMs: number;
  }): Promise<{ wakeUpId: string }> {
    const parent = this.client.queuePath(this.project, this.location, this.queue);
    const wakeUpId = `wake-${sanitize(input.continuationId)}-${input.wakeAtMs}`;
    const taskName = `${parent}/tasks/${wakeUpId}`;

    const trigger = {
      type: 'scheduled_wake',
      wakeUpId,
      firedAt: new Date(input.wakeAtMs).toISOString(),
    };

    const body = Buffer.from(
      JSON.stringify({ continuationId: input.continuationId, trigger }),
    ).toString('base64');

    const httpRequest: CloudTasksHttpRequest = {
      url: this.handlerUrl,
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    };

    if (this.serviceAccountEmail) {
      (httpRequest as Record<string, unknown>)['oidcToken'] = {
        serviceAccountEmail: this.serviceAccountEmail,
        audience: this.handlerUrl,
      };
    }

    const delayMs = Math.max(0, input.wakeAtMs - this.now());

    await this.client.createTask({
      parent,
      task: {
        name: taskName,
        scheduleTime: { seconds: Math.floor((Date.now() + delayMs) / 1000) },
        httpRequest,
      },
    });

    return { wakeUpId };
  }

  async cancelWake(wakeUpId: string): Promise<void> {
    const parent = this.client.queuePath(this.project, this.location, this.queue);
    try {
      await this.client.deleteTask({ name: `${parent}/tasks/${wakeUpId}` });
    } catch {
      // Task already fired or not found — cancellation is a no-op.
    }
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}
