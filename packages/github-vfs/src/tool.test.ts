import { describe, expect, it, vi } from 'vitest';
import type { VfsEntry, VfsProvider } from '@agent-assistant/vfs';
import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolExecutionContext,
} from '@agent-assistant/harness';
import { createGithubVfsToolRegistry } from './tool.js';

const AVAILABILITY_INPUT: HarnessToolAvailabilityInput = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
};

const EXECUTION_CONTEXT: HarnessToolExecutionContext = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
  iteration: 0,
  toolCallIndex: 0,
};

function makeProvider(files: Record<string, unknown>): VfsProvider {
  const entries: VfsEntry[] = Object.keys(files).map((path) => ({
    path,
    type: 'file',
    provider: 'github',
    revision: `rev:${path}`,
  }));

  return {
    list: vi.fn(async () => entries),
    read: vi.fn(async (path: string) => {
      const value = files[path];
      return value === undefined ? null : { path, content: JSON.stringify(value) };
    }),
    search: vi.fn(async () => []),
  };
}

function makeCall(input: Record<string, unknown>): HarnessToolCall {
  return {
    id: 'call-1',
    name: 'workspace_github_list_open_prs',
    input,
  };
}

describe('createGithubVfsToolRegistry', () => {
  it('lists the GitHub VFS tool', async () => {
    const registry = createGithubVfsToolRegistry({ provider: makeProvider({}) });

    const tools = await registry.listAvailable(AVAILABILITY_INPUT);

    expect(tools.map((tool) => tool.name)).toEqual(['workspace_github_list_open_prs']);
  });

  it('lists open PR metadata from the GitHub VFS and includes source paths', async () => {
    const provider = makeProvider({
      '/github/repos/acme/widgets/pulls/1/metadata.json': {
        number: 1,
        title: 'Add direct VFS routing',
        state: 'open',
        updated_at: '2026-04-24T12:00:00Z',
      },
      '/github/repos/acme/widgets/pulls/2/metadata.json': {
        number: 2,
        title: 'Closed PR',
        state: 'closed',
        updated_at: '2026-04-23T12:00:00Z',
      },
    });
    const registry = createGithubVfsToolRegistry({ provider });
    const call = makeCall({
      owner: 'acme',
      repo: 'widgets',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(provider.list).toHaveBeenCalledWith('/github/repos/acme/widgets/pulls', {
      depth: 2,
      limit: 100,
    });
    expect(result.status).toBe('success');
    expect(JSON.parse(result.output ?? 'null')).toMatchObject({
      repo: 'acme/widgets',
      pulls: [
        {
          number: 1,
          title: 'Add direct VFS routing',
          state: 'open',
          sourcePath: '/github/repos/acme/widgets/pulls/1/metadata.json',
        },
      ],
    });
  });

  it('returns invalid_input for missing owner', async () => {
    const registry = createGithubVfsToolRegistry({ provider: makeProvider({}) });

    const result = await registry.execute(makeCall({ repo: 'widgets' }), EXECUTION_CONTEXT);

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'invalid_input',
      retryable: false,
    });
  });
});
