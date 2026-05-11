import { describe, expect, it } from 'vitest';
import { fromContext } from './runtime-interop.js';
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
