import { ProactiveError, type SchedulerBinding, type WakeUpContext } from './types.js';

const RUNTIME_INTEROP_SOURCE = 'proactive-runtime';

function readId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value && typeof value === 'object' && 'id' in value) {
    return readId((value as { id?: unknown }).id);
  }

  return null;
}

export interface RuntimeInteropContext {
  workspaceId?: string | null;
  workspace?: string | { id?: string | null } | null;
  agentId?: string | null;
  agent?: string | { id?: string | null } | null;
}

export interface RuntimeInteropSession {
  id: string;
  userId: string;
  workspaceId: string;
  surfaceId: string;
  initialSurfaceId: string;
  metadata: {
    agentId: string;
    workspaceId: string;
    sessionKey: string;
    source: typeof RUNTIME_INTEROP_SOURCE;
  };
}

type ScheduleWakeUpResult = string | { bindingId: string };

type RuntimeWakeScheduler = {
  requestWakeUp(at: Date, context: WakeUpContext): Promise<ScheduleWakeUpResult>;
  cancelWakeUp(bindingId: string): Promise<void>;
};

export interface RuntimeScheduleContext {
  scheduleWakeUp?: (at: Date, context: WakeUpContext) => Promise<ScheduleWakeUpResult>;
  cancelWakeUp?: (bindingId: string) => Promise<void>;
  scheduler?: RuntimeWakeScheduler | null;
}

export class ContextSchedulerBinding implements SchedulerBinding {
  readonly #ctx: RuntimeScheduleContext;

  constructor(ctx: RuntimeScheduleContext) {
    this.#ctx = ctx;
  }

  async requestWakeUp(at: Date, context: WakeUpContext): Promise<string> {
    const scheduler = this.#ctx.scheduler;
    const result = scheduler
      ? await scheduler.requestWakeUp(at, context)
      : await this.#ctx.scheduleWakeUp?.(at, context);

    if (!result) {
      throw new ProactiveError(
        'Runtime context does not provide scheduleWakeUp support',
        'RUNTIME_SCHEDULER_UNAVAILABLE',
      );
    }

    return typeof result === 'string' ? result : result.bindingId;
  }

  async cancelWakeUp(bindingId: string): Promise<void> {
    const scheduler = this.#ctx.scheduler;
    if (scheduler) {
      await scheduler.cancelWakeUp(bindingId);
      return;
    }

    const cancelWakeUp = this.#ctx.cancelWakeUp;
    if (!cancelWakeUp) {
      throw new ProactiveError(
        'Runtime context does not provide cancelWakeUp support',
        'RUNTIME_SCHEDULER_UNAVAILABLE',
      );
    }

    await cancelWakeUp(bindingId);
  }
}

export { ContextSchedulerBinding as RuntimeSchedulerBinding };

/**
 * Construct a stable agent-assistant session descriptor from a hosted runtime
 * context. The mapping is intentionally structural so cloud runtimes can pass
 * plain objects without importing any OSS session types.
 */
export function fromContext(ctx: RuntimeInteropContext): RuntimeInteropSession {
  const workspaceId = readId(ctx.workspaceId ?? ctx.workspace);
  if (!workspaceId) {
    throw new ProactiveError(
      'fromContext requires ctx.workspaceId or ctx.workspace.id',
      'RUNTIME_INTEROP_CONTEXT_INVALID',
    );
  }

  const agentId = readId(ctx.agentId ?? ctx.agent);
  if (!agentId) {
    throw new ProactiveError(
      'fromContext requires ctx.agentId or ctx.agent.id',
      'RUNTIME_INTEROP_CONTEXT_INVALID',
    );
  }

  const sessionKey = `${workspaceId}:${agentId}`;
  const surfaceId = `${RUNTIME_INTEROP_SOURCE}:${sessionKey}`;

  return {
    id: sessionKey,
    userId: `agent:${sessionKey}`,
    workspaceId,
    surfaceId,
    initialSurfaceId: surfaceId,
    metadata: {
      agentId,
      workspaceId,
      sessionKey,
      source: RUNTIME_INTEROP_SOURCE,
    },
  };
}
