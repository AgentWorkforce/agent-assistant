import { afterEach, describe, expect, it, vi } from 'vitest';

import * as memoryModule from '@agent-assistant/memory';
import { MemoryEntryNotFoundError } from '@agent-assistant/memory';
import type { MemoryEntry, MemoryStore } from '@agent-assistant/memory';

import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolExecutionContext,
  HarnessToolResult,
} from '../types.js';
import { createMemoryToolRegistry } from './memory-tool-registry.js';

const AVAILABILITY_INPUT: HarnessToolAvailabilityInput = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
  workspaceId: 'ws1',
  sessionId: 's1',
  userId: 'u1',
};

const EXECUTION_CONTEXT: HarnessToolExecutionContext = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
  workspaceId: 'ws1',
  sessionId: 's1',
  userId: 'u1',
  threadId: 'thread-1',
  iteration: 0,
  toolCallIndex: 0,
};

function makeEntry(
  id: string,
  scope: MemoryEntry['scope'],
  content: string,
  overrides: Partial<MemoryEntry> = {},
): MemoryEntry {
  return {
    id,
    scope,
    content,
    tags: [],
    createdAt: '2026-04-27T12:00:00.000Z',
    updatedAt: '2026-04-27T12:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function makeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    write: vi.fn(),
    retrieve: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByScope: vi.fn(),
    promote: vi.fn(),
    compact: vi.fn(),
    ...overrides,
  } as MemoryStore;
}

function makeCall(name: string, input: Record<string, unknown>): HarnessToolCall {
  return {
    id: `${name}-call-1`,
    name,
    input,
  };
}

function createRegistry(
  store: MemoryStore | null,
  scopeContext: { workspaceId?: string; userId?: string; sessionId?: string } = {
    workspaceId: 'ws1',
    userId: 'u1',
    sessionId: 's1',
  },
) {
  return createMemoryToolRegistry({
    store,
    resolveScopeContext: () => scopeContext,
  });
}

function parseJsonOutput(result: HarnessToolResult): Record<string, unknown> {
  expect(result.output).toEqual(expect.any(String));
  return JSON.parse(result.output ?? 'null') as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createMemoryToolRegistry listAvailable', () => {
  it('returns all three tools when the store is provided', async () => {
    const registry = createRegistry(makeStore());

    const tools = await registry.listAvailable(AVAILABILITY_INPUT);

    expect(tools.map((tool) => tool.name)).toEqual([
      'memory_remember',
      'memory_recall',
      'memory_forget',
    ]);
  });

  it('returns [] when the store is null', async () => {
    const registry = createRegistry(null);

    const tools = await registry.listAvailable(AVAILABILITY_INPUT);

    expect(tools).toEqual([]);
  });

  it('filters to allowedToolNames when set', async () => {
    const registry = createRegistry(makeStore());

    const tools = await registry.listAvailable({
      ...AVAILABILITY_INPUT,
      allowedToolNames: ['memory_recall'],
    });

    expect(tools.map((tool) => tool.name)).toEqual(['memory_recall']);
  });
});

describe('createMemoryToolRegistry execute memory_remember', () => {
  it('writes a session-scoped memory entry and returns id, scope, and expiresAt JSON', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00.000Z'));

    const storedEntry = makeEntry(
      'mem-1',
      { kind: 'session', sessionId: 's1' },
      'Remember this for the current thread.',
      { expiresAt: '2026-05-04T12:00:00.000Z' },
    );
    const store = makeStore({
      write: vi.fn().mockResolvedValue(storedEntry),
    });
    const registry = createRegistry(store, {
      userId: 'u1',
      workspaceId: 'ws1',
      sessionId: 's1',
    });
    const call = makeCall('memory_remember', {
      content: 'Remember this for the current thread.',
      scope: 'session',
      tags: ['project', 'handoff'],
      expiresInDays: 7,
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(store.write).toHaveBeenCalledWith({
      scope: { kind: 'session', sessionId: 's1' },
      content: 'Remember this for the current thread.',
      tags: ['project', 'handoff'],
      expiresAt: '2026-05-04T12:00:00.000Z',
    });
    expect(result.status).toBe('success');
    expect(parseJsonOutput(result)).toEqual({
      id: 'mem-1',
      scope: { kind: 'session', sessionId: 's1' },
      expiresAt: '2026-05-04T12:00:00.000Z',
    });
  });

  it.each([
    [
      'user',
      { workspaceId: 'ws1', sessionId: 's1' },
      "memory_remember scope='user' requires user identity in execution context",
    ],
    [
      'session',
      { workspaceId: 'ws1', userId: 'u1' },
      "memory_remember scope='session' requires session identity in execution context",
    ],
    [
      'workspace',
      { userId: 'u1', sessionId: 's1' },
      "memory_remember scope='workspace' requires workspace identity in execution context",
    ],
  ])(
    'returns invalid_input when scope=%s cannot be resolved from execution context',
    async (scope, scopeContext, message) => {
      const store = makeStore();
      const registry = createRegistry(store, scopeContext);
      const call = makeCall('memory_remember', {
        content: 'Scoped fact',
        scope,
      });

      const result = await registry.execute(call, EXECUTION_CONTEXT);

      expect(result.status).toBe('error');
      expect(result.error).toMatchObject({
        code: 'invalid_input',
        message,
        retryable: false,
      });
      expect(store.write).not.toHaveBeenCalled();
    },
  );

  it('returns invalid_input when content exceeds 2000 characters', async () => {
    const store = makeStore();
    const registry = createRegistry(store);
    const call = makeCall('memory_remember', {
      content: 'x'.repeat(2001),
      scope: 'session',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'invalid_input',
      message: 'input.content must be between 1 and 2000 characters',
      retryable: false,
    });
    expect(store.write).not.toHaveBeenCalled();
  });

  it('returns invalid_input when scope is missing', async () => {
    const store = makeStore();
    const registry = createRegistry(store);
    const call = makeCall('memory_remember', {
      content: 'Scoped fact',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'invalid_input',
      message: 'input.scope must be one of: session, user, workspace',
      retryable: false,
    });
    expect(store.write).not.toHaveBeenCalled();
  });
});

describe('createMemoryToolRegistry execute memory_recall', () => {
  it('calls retrieveTurnMemoryContext when scope is omitted and renders the turn-memory context', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00.000Z'));

    const sessionEntry = makeEntry(
      'mem-session',
      { kind: 'session', sessionId: 's1' },
      'Remembered for this thread.',
    );
    const userEntry = makeEntry(
      'mem-user',
      { kind: 'user', userId: 'u1' },
      'Remembered for this user.',
    );
    const contextResult = {
      entries: [sessionEntry, userEntry],
      byScope: {
        session: [sessionEntry],
        user: [userEntry],
      },
    };
    const retrieveSpy = vi
      .spyOn(memoryModule, 'retrieveTurnMemoryContext')
      .mockResolvedValue(contextResult);
    const store = makeStore();
    const registry = createRegistry(store);
    const call = makeCall('memory_recall', {
      query: 'remembered',
      limit: 3,
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(retrieveSpy).toHaveBeenCalledWith({
      store,
      sessionId: 's1',
      userId: 'u1',
      workspaceId: 'ws1',
      query: 'remembered',
      limit: 3,
      perScopeLimit: 3,
      order: 'newest',
    });
    expect(result.status).toBe('success');
    expect(result.output).toBe(memoryModule.renderTurnMemoryContext(contextResult));
  });

  it('calls store.retrieve directly when a concrete scope is provided', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00.000Z'));

    const userEntry = makeEntry(
      'mem-user',
      { kind: 'user', userId: 'u1' },
      'Remembered for this user.',
    );
    const store = makeStore({
      retrieve: vi.fn().mockResolvedValue([userEntry]),
    });
    const registry = createRegistry(store);
    const call = makeCall('memory_recall', {
      query: 'user memory',
      scope: 'user',
      limit: 2,
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(store.retrieve).toHaveBeenCalledWith({
      scope: { kind: 'user', userId: 'u1' },
      query: 'user memory',
      limit: 2,
      order: 'newest',
    });
    expect(result.status).toBe('success');
    expect(result.output).toBe('[user, just now] Remembered for this user.');
  });

  it('returns status=success with an empty string output when no entries are found', async () => {
    const store = makeStore({
      retrieve: vi.fn().mockResolvedValue([]),
    });
    const registry = createRegistry(store);
    const call = makeCall('memory_recall', {
      query: 'missing',
      scope: 'user',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('success');
    expect(result.output).toBe('');
  });
});

describe('createMemoryToolRegistry execute memory_forget', () => {
  it("returns 'forgotten' on the happy path", async () => {
    const store = makeStore({
      delete: vi.fn().mockResolvedValue(undefined),
    });
    const registry = createRegistry(store);
    const call = makeCall('memory_forget', {
      entryId: 'mem-1',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(store.delete).toHaveBeenCalledWith('mem-1');
    expect(result).toMatchObject({
      status: 'success',
      output: 'forgotten',
    });
  });

  it('maps MemoryEntryNotFoundError to a not_found tool error', async () => {
    const store = makeStore({
      delete: vi.fn().mockRejectedValue(new MemoryEntryNotFoundError('mem-missing')),
    });
    const registry = createRegistry(store);
    const call = makeCall('memory_forget', {
      entryId: 'mem-missing',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'not_found',
      message: 'Memory entry not found: mem-missing',
      retryable: false,
    });
  });
});

describe('createMemoryToolRegistry observability', () => {
  it("logs one success event JSON line via console.info when a memory write succeeds", async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const store = makeStore({
      write: vi.fn().mockResolvedValue(
        makeEntry('mem-1', { kind: 'session', sessionId: 's1' }, 'Observable success.'),
      ),
    });
    const registry = createRegistry(store);
    const call = makeCall('memory_remember', {
      content: 'Observable success.',
      scope: 'session',
    });

    const result = await registry.execute(call, EXECUTION_CONTEXT);

    expect(result.status).toBe('success');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(infoSpy.mock.calls[0]?.[0]))).toMatchObject({
      event: 'memory_op',
      op: 'save',
      scope: 'session',
      sessionId: 's1',
      status: 'ok',
      entryCount: 1,
      contentChars: 'Observable success.'.length,
    });
  });

  it("rethrows store.write failures and logs a status='failed' memory_op event", async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const store = makeStore({
      write: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const registry = createRegistry(store);
    const call = makeCall('memory_remember', {
      content: 'This write fails.',
      scope: 'session',
    });

    await expect(registry.execute(call, EXECUTION_CONTEXT)).rejects.toThrow('boom');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(infoSpy.mock.calls[0]?.[0]))).toMatchObject({
      event: 'memory_op',
      op: 'save',
      scope: 'session',
      sessionId: 's1',
      status: 'failed',
      error: 'boom',
    });
  });
});
