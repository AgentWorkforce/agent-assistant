import { ProactiveError } from './types.js';

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
