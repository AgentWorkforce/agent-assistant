import { describe, expect, it, vi } from 'vitest';
import type { VfsEntry, VfsProvider, VfsReadResult, VfsSearchResult } from '@agent-assistant/vfs';
import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolExecutionContext,
} from '../types.js';
import { createWorkspaceToolRegistry } from './workspace-tool-registry.js';

const AVAILABILITY_INPUT: HarnessToolAvailabilityInput = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
  sessionId: 'session-1',
  userId: 'user-1',
};

const EXECUTION_CONTEXT: HarnessToolExecutionContext = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
  sessionId: 'session-1',
  userId: 'user-1',
  threadId: 'thread-1',
  iteration: 0,
  toolCallIndex: 0,
};

function makeProvider(overrides: Partial<VfsProvider> = {}): VfsProvider {
  return {
    search: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeCall(name: string, input: Record<string, unknown>): HarnessToolCall {
  return {
    id: `${name}-call-1`,
    name,
    input,
  };
}

function readResult(path: string, content: string): VfsReadResult {
  return { path, content, provider: 'github' };
}

function parseOutputArray(result: { output?: string }): Array<Record<string, unknown>> {
  expect(result.output).toEqual(expect.any(String));
  return JSON.parse(result.output ?? 'null') as Array<Record<string, unknown>>;
}

describe('createWorkspaceToolRegistry listAvailable', () => {
  it('returns exactly the four workspace tools when the provider is configured', async () => {
    const provider = makeProvider();
    const registry = createWorkspaceToolRegistry({ provider });

    const tools = await registry.listAvailable(AVAILABILITY_INPUT);

    expect(tools).toHaveLength(4);
    expect(tools.map((tool) => tool.name)).toEqual([
      'workspace_search',
      'workspace_list',
      'workspace_read',
      'workspace_read_json',
    ]);
  });

  it('returns no workspace tools when the provider is unavailable', async () => {
    const registry = createWorkspaceToolRegistry({ provider: null });

    const tools = await registry.listAvailable(AVAILABILITY_INPUT);

    expect(tools).toEqual([]);
  });
});

describe('createWorkspaceToolRegistry execute workspace_search', () => {
  it('calls provider.search with query, provider, and limit then returns parseable JSON', async () => {
    const searchResults: VfsSearchResult[] = [
      {
        path: '/github/repos/acme/widgets/src/index.ts',
        type: 'file',
        provider: 'github',
        title: 'src/index.ts',
        snippet: 'export function widget() {}',
        revision: 'rev-1',
        properties: {
          score: '42',
        },
      },
    ];
    const provider = makeProvider({
      search: vi.fn().mockResolvedValue(searchResults),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_search', {
      query: 'widget',
      provider: 'github',
      limit: 7,
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(provider.search).toHaveBeenCalledWith('widget', {
      provider: 'github',
      limit: 7,
    });
    expect(result.status).toBe('success');
    const output = parseOutputArray(result);
    expect(output[0]).toMatchObject({
      path: searchResults[0]?.path,
      provider: searchResults[0]?.provider,
      score: 42,
    });
  });

  it("returns invalid_input when query is missing and doesn't call provider.search", async () => {
    const provider = makeProvider();
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_search', {
      provider: 'github',
      limit: 7,
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'invalid_input',
      retryable: false,
    });
    expect(provider.search).not.toHaveBeenCalled();
  });
});

describe('createWorkspaceToolRegistry execute workspace_list', () => {
  it('calls provider.list with path, depth, and limit then returns parseable JSON', async () => {
    const listEntries: VfsEntry[] = [
      {
        path: '/github/repos/acme/widgets/src',
        type: 'dir',
        provider: 'github',
        title: 'src',
        revision: 'rev-1',
      },
      {
        path: '/github/repos/acme/widgets/src/index.ts',
        type: 'file',
        provider: 'github',
        title: 'index.ts',
        revision: 'rev-2',
        size: 1234,
      },
    ];
    const provider = makeProvider({
      list: vi.fn().mockResolvedValue(listEntries),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_list', {
      path: '/github/repos/acme/widgets',
      depth: 2,
      limit: 25,
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(provider.list).toHaveBeenCalledWith('/github/repos/acme/widgets', {
      depth: 2,
      limit: 25,
    });
    expect(result.status).toBe('success');
    expect(parseOutputArray(result)).toEqual([
      expect.objectContaining({
        path: listEntries[0]?.path,
        provider: listEntries[0]?.provider,
      }),
      expect.objectContaining({
        path: listEntries[1]?.path,
        provider: listEntries[1]?.provider,
      }),
    ]);
  });
});

describe('createWorkspaceToolRegistry execute workspace_read', () => {
  it('returns file content when the path exists', async () => {
    const fileContent = 'const answer = 42;\n';
    const provider = makeProvider({
      read: vi
        .fn()
        .mockResolvedValue(readResult('/github/repos/acme/widgets/src/index.ts', fileContent)),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_read', {
      path: '/github/repos/acme/widgets/src/index.ts',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(provider.read).toHaveBeenCalledWith('/github/repos/acme/widgets/src/index.ts');
    expect(result.status).toBe('success');
    expect(result.output).toBe(fileContent);
  });

  it('returns retryable not_found when the provider returns null for the path', async () => {
    const provider = makeProvider({
      read: vi.fn().mockResolvedValue(null),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_read', {
      path: '/github/repos/acme/widgets/src/missing.ts',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(provider.read).toHaveBeenCalledWith('/github/repos/acme/widgets/src/missing.ts');
    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'not_found',
      retryable: true,
    });
  });

  it('truncates content larger than 50KB and emits a _truncated marker', async () => {
    const largeContent = 'x'.repeat(60 * 1024);
    const provider = makeProvider({
      read: vi
        .fn()
        .mockResolvedValue(readResult('/github/repos/acme/widgets/src/big.ts', largeContent)),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_read', {
      path: '/github/repos/acme/widgets/src/big.ts',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('success');
    expect(result.output).toEqual(expect.any(String));
    expect(new TextEncoder().encode(result.output ?? '').byteLength).toBeLessThanOrEqual(
      50 * 1024,
    );
    expect(result.output).not.toBe(largeContent);
    expect(result.output).toContain('"_truncated": true');
  });

  it('returns raw content unchanged when the file is well under the 50KB cap', async () => {
    const fileContent = 'tiny payload';
    const provider = makeProvider({
      read: vi
        .fn()
        .mockResolvedValue(readResult('/github/repos/acme/widgets/src/tiny.ts', fileContent)),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_read', {
      path: '/github/repos/acme/widgets/src/tiny.ts',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('success');
    expect(result.output).toBe(fileContent);
  });
});

describe('createWorkspaceToolRegistry execute workspace_read_json', () => {
  it('returns parsed JSON with the source path when the file exists', async () => {
    const provider = makeProvider({
      read: vi
        .fn()
        .mockResolvedValue(
          readResult('/github/repos/acme/widgets/pulls/1/metadata.json', '{"title":"Widget","state":"open"}'),
        ),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_read_json', {
      path: '/github/repos/acme/widgets/pulls/1/metadata.json',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(provider.read).toHaveBeenCalledWith('/github/repos/acme/widgets/pulls/1/metadata.json');
    expect(result.status).toBe('success');
    expect(JSON.parse(result.output ?? 'null')).toEqual({
      path: '/github/repos/acme/widgets/pulls/1/metadata.json',
      json: { title: 'Widget', state: 'open' },
    });
  });

  it('returns retryable not_found when the provider returns null for the path', async () => {
    const provider = makeProvider({
      read: vi.fn().mockResolvedValue(null),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_read_json', {
      path: '/github/repos/acme/widgets/pulls/999/metadata.json',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'not_found',
      retryable: true,
    });
  });

  it('returns invalid_json when the file content cannot be parsed', async () => {
    const provider = makeProvider({
      read: vi
        .fn()
        .mockResolvedValue(readResult('/github/repos/acme/widgets/pulls/1/metadata.json', '{')),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_read_json', {
      path: '/github/repos/acme/widgets/pulls/1/metadata.json',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'invalid_json',
      retryable: false,
    });
  });
});

describe('createWorkspaceToolRegistry execute disabled and unknown tools', () => {
  it.each([
    ['workspace_search', { query: 'widget' }],
    ['workspace_list', { path: '/github/repos/acme/widgets' }],
    ['workspace_read', { path: '/github/repos/acme/widgets/src/index.ts' }],
    ['workspace_read_json', { path: '/github/repos/acme/widgets/pulls/1/metadata.json' }],
  ])('returns workspace_unavailable for %s when the provider is unavailable', async (name, input) => {
    const registry = createWorkspaceToolRegistry({ provider: null });
    const call = makeCall(name, input);

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'workspace_unavailable',
      retryable: false,
    });
  });

  it('returns unknown_tool for an unrecognized tool name', async () => {
    const provider = makeProvider();
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_delete', {
      path: '/github/repos/acme/widgets/src/index.ts',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'unknown_tool',
      retryable: false,
    });
    expect(provider.read).not.toHaveBeenCalled();
  });
});

describe('createWorkspaceToolRegistry output truncation', () => {
  it('truncates output larger than 50KB and includes a _truncated marker', async () => {
    const largePreview = 'x'.repeat(2048);
    const searchResults: VfsSearchResult[] = Array.from({ length: 40 }, (_, index) => ({
      path: `/github/repos/acme/widgets/src/file-${index}.ts`,
      type: 'file',
      provider: 'github',
      snippet: largePreview,
      revision: `rev-${index}`,
    }));
    const provider = makeProvider({
      search: vi.fn().mockResolvedValue(searchResults),
    });
    const registry = createWorkspaceToolRegistry({ provider });
    const call = makeCall('workspace_search', {
      query: 'widget',
      provider: 'github',
      limit: 40,
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('success');
    expect(result.output).toEqual(expect.any(String));
    expect(new TextEncoder().encode(result.output ?? '').byteLength).toBeLessThanOrEqual(
      50 * 1024,
    );
    expect(result.output).toContain('"_truncated": true');
  });
});
