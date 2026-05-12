import { describe, expect, it, vi } from 'vitest';
import { createSessionStore, ctxFilesToRuntimeSessionStoreAdapterOptions, RuntimeSessionStoreAdapter } from '../../sessions/src/index.js';
import { createProactiveEngine } from './proactive.js';
import { ContextSchedulerBinding, fromContext } from './runtime-interop.js';
import { ProactiveError } from './types.js';

describe('fromContext', () => {
  it('builds a stable assistant session descriptor from flat ids', () => {
    expect(
      fromContext({
        workspaceId: 'ws-alpha',
        agentId: 'sage',
      }),
    ).toEqual({
      id: 'ws-alpha:sage',
      userId: 'agent:ws-alpha:sage',
      workspaceId: 'ws-alpha',
      surfaceId: 'proactive-runtime:ws-alpha:sage',
      initialSurfaceId: 'proactive-runtime:ws-alpha:sage',
      metadata: {
        agentId: 'sage',
        workspaceId: 'ws-alpha',
        sessionKey: 'ws-alpha:sage',
        source: 'proactive-runtime',
      },
    });
  });

  it('reads nested runtime ids', () => {
    expect(
      fromContext({
        workspace: { id: 'ws-beta' },
        agent: { id: 'night-cto' },
      }),
    ).toMatchObject({
      id: 'ws-beta:night-cto',
      userId: 'agent:ws-beta:night-cto',
      workspaceId: 'ws-beta',
      metadata: {
        agentId: 'night-cto',
        workspaceId: 'ws-beta',
      },
    });
  });

  it('accepts string aliases for nested runtime handles', () => {
    expect(
      fromContext({
        workspace: 'ws-delta',
        agent: 'sage',
      }),
    ).toMatchObject({
      id: 'ws-delta:sage',
      userId: 'agent:ws-delta:sage',
      metadata: {
        sessionKey: 'ws-delta:sage',
      },
    });
  });

  it('falls back to nested ids when flat ids are blank', () => {
    expect(
      fromContext({
        workspaceId: '   ',
        workspace: { id: 'ws-zeta' },
        agentId: '',
        agent: { id: 'sage' },
      }),
    ).toMatchObject({
      id: 'ws-zeta:sage',
      userId: 'agent:ws-zeta:sage',
      workspaceId: 'ws-zeta',
      metadata: {
        agentId: 'sage',
        workspaceId: 'ws-zeta',
      },
    });
  });

  it('trims ids before deriving the session key', () => {
    expect(
      fromContext({
        workspaceId: '  ws-epsilon  ',
        agentId: '  sage  ',
      }),
    ).toMatchObject({
      id: 'ws-epsilon:sage',
      userId: 'agent:ws-epsilon:sage',
      workspaceId: 'ws-epsilon',
      metadata: {
        agentId: 'sage',
        sessionKey: 'ws-epsilon:sage',
      },
    });
  });

  it('throws when workspace identity is missing', () => {
    expect(() =>
      fromContext({
        agentId: 'sage',
      }),
    ).toThrow(ProactiveError);
  });

  it('throws when agent identity is missing', () => {
    expect(() =>
      fromContext({
        workspaceId: 'ws-gamma',
      }),
    ).toThrow(ProactiveError);
  });
});

describe('ContextSchedulerBinding', () => {
  it('uses ctx.scheduler when present', async () => {
    const requestWakeUp = vi.fn().mockResolvedValue({ bindingId: 'binding-123' });
    const cancelWakeUp = vi.fn().mockResolvedValue(undefined);
    const binding = new ContextSchedulerBinding({
      scheduler: {
        requestWakeUp,
        cancelWakeUp,
      },
    });

    await expect(
      binding.requestWakeUp(new Date('2026-05-12T12:00:00.000Z'), {
        sessionId: 'ws-alpha:sage',
        scheduledAt: '2026-05-12T12:00:00.000Z',
      }),
    ).resolves.toBe('binding-123');

    await binding.cancelWakeUp('binding-123');

    expect(requestWakeUp).toHaveBeenCalledTimes(1);
    expect(cancelWakeUp).toHaveBeenCalledWith('binding-123');
  });

  it('falls back to scheduleWakeUp and cancelWakeUp functions', async () => {
    const scheduleWakeUp = vi.fn().mockResolvedValue('binding-456');
    const cancelWakeUp = vi.fn().mockResolvedValue(undefined);
    const binding = new ContextSchedulerBinding({
      scheduleWakeUp,
      cancelWakeUp,
    });

    await expect(
      binding.requestWakeUp(new Date('2026-05-12T13:00:00.000Z'), {
        sessionId: 'ws-beta:night-cto',
        ruleId: 'rule-1',
        scheduledAt: '2026-05-12T13:00:00.000Z',
      }),
    ).resolves.toBe('binding-456');

    await binding.cancelWakeUp('binding-456');

    expect(scheduleWakeUp).toHaveBeenCalledTimes(1);
    expect(cancelWakeUp).toHaveBeenCalledWith('binding-456');
  });

  it('throws when scheduling support is unavailable', async () => {
    const binding = new ContextSchedulerBinding({});

    await expect(
      binding.requestWakeUp(new Date('2026-05-12T14:00:00.000Z'), {
        sessionId: 'ws-gamma:sage',
        scheduledAt: '2026-05-12T14:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      name: 'ProactiveError',
      code: 'RUNTIME_SCHEDULER_UNAVAILABLE',
    });
  });

  it('throws when cancel support is unavailable', async () => {
    const binding = new ContextSchedulerBinding({
      scheduleWakeUp: vi.fn().mockResolvedValue('binding-789'),
    });

    await expect(binding.cancelWakeUp('binding-789')).rejects.toMatchObject({
      name: 'ProactiveError',
      code: 'RUNTIME_SCHEDULER_UNAVAILABLE',
    });
  });
});

describe('runtime interop chain', () => {
  it('bridges fromContext through durable sessions into follow-up scheduling', async () => {
    const files = new Map<string, string>();
    const ctx = {
      workspace: 'support',
      agentId: 'sage',
      signal: new AbortController().signal,
      files: {
        read: async (path: string) =>
          files.has(path) ? { path, body: files.get(path) ?? null } : null,
        write: async (path: string, body: string) => {
          files.set(path, body);
        },
        delete: async (path: string) => {
          files.delete(path);
        },
        list: async (glob: string) => {
          const prefix = glob.replace(/\/\*\*$/, '');
          return [...files.keys()]
            .filter((path) => path.startsWith(prefix))
            .map((path) => ({ path }));
        },
      },
      scheduler: {
        requestWakeUp: vi.fn().mockResolvedValue({ bindingId: 'binding-chain-1' }),
        cancelWakeUp: vi.fn().mockResolvedValue(undefined),
      },
    };

    const sessions = createSessionStore({
      adapter: new RuntimeSessionStoreAdapter(
        ctxFilesToRuntimeSessionStoreAdapterOptions(ctx.files, {
          signal: ctx.signal,
        }),
      ),
    });
    const engine = createProactiveEngine({
      schedulerBinding: new ContextSchedulerBinding(ctx),
    });
    engine.registerFollowUpRule({
      id: 'idle-follow-up',
      condition: () => true,
      messageTemplate: 'Checking back in.',
      routingHint: 'cheap',
    });

    const runtimeSession = fromContext(ctx);
    const created = await sessions.create({
      id: runtimeSession.id,
      userId: runtimeSession.userId,
      workspaceId: runtimeSession.workspaceId,
      initialSurfaceId: runtimeSession.initialSurfaceId,
      metadata: runtimeSession.metadata,
    });
    const reloaded = await sessions.get(runtimeSession.id);
    const scheduledAt = new Date(
      new Date(created.lastActivityAt).getTime() + 5 * 60 * 1000,
    ).toISOString();
    const decisions = await engine.evaluateFollowUp({
      sessionId: created.id,
      scheduledAt,
      lastActivityAt: created.lastActivityAt,
    });
    expect(reloaded?.id).toBe('support:sage');
    expect(reloaded?.metadata).toMatchObject({
      source: 'proactive-runtime',
      sessionKey: 'support:sage',
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      ruleId: 'idle-follow-up',
      action: 'fire',
    });

    const scheduledBindingId = await new ContextSchedulerBinding(ctx).requestWakeUp(
      new Date(scheduledAt),
      {
        sessionId: created.id,
        ruleId: 'idle-follow-up',
        scheduledAt,
      },
    );
    expect(scheduledBindingId).toBe('binding-chain-1');
    expect(ctx.scheduler.requestWakeUp).toHaveBeenCalledTimes(1);
  });
});
