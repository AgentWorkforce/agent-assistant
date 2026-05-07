import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSubagentToolRegistry,
  filterParentContextForSubagent,
  SUBAGENT_EXCLUDED_PARENT_KEYS,
  type CreateSubagentToolRegistryOptions,
  type HarnessSubagent,
  type HarnessTurnContext,
} from './subagent-registry.js';
import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolExecutionContext,
  HarnessToolResult,
} from './types.js';

const AVAILABILITY_INPUT: HarnessToolAvailabilityInput = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
  userId: 'user-1',
};

const EXECUTION_CONTEXT: HarnessTurnContext = {
  assistantId: 'assistant-1',
  turnId: 'turn-1',
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
  userId: 'user-1',
  threadId: 'thread-1',
  iteration: 0,
  toolCallIndex: 0,
  messages: [{ role: 'user', content: 'draft this' }],
  todos: [{ id: 'todo-1', text: 'draft' }],
  structuredResponse: { mode: 'json' },
  skillsMetadata: { source: 'test' },
  memoryContents: ['remembered'],
};

function makeSubagent(overrides: Partial<HarnessSubagent> = {}): HarnessSubagent {
  return {
    name: 'doc-drafter',
    description: 'Drafts documentation artifacts.',
    toolAllowlist: ['memory_recall'],
    systemPrompt: 'You write docs.',
    ...overrides,
  };
}

function makeTaskCall(
  input: Record<string, unknown>,
  name = 'task',
): HarnessToolCall {
  return {
    id: `${name}-call-1`,
    name,
    input,
  };
}

function parseTaskResult(result: HarnessToolResult): Record<string, unknown> {
  expect(result.toolName).toBe('task');
  expect(result.status).toBe('success');
  expect(result.output).toEqual(expect.any(String));
  return JSON.parse(result.output ?? 'null') as Record<string, unknown>;
}

function createRegistry(
  subagents: readonly HarnessSubagent[],
  runSubagent: CreateSubagentToolRegistryOptions['runSubagent'],
  defaultMaxIterations?: number,
) {
  return createSubagentToolRegistry({
    subagents,
    runSubagent,
    defaultMaxIterations,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('filterParentContextForSubagent', () => {
  it('strips excluded keys', () => {
    const abortController = new AbortController();
    const parent: HarnessTurnContext = {
      ...EXECUTION_CONTEXT,
      workspaceId: 'workspace-2',
      sessionId: 'session-2',
      abortSignal: abortController.signal,
    };

    const filtered = filterParentContextForSubagent(parent);

    for (const key of SUBAGENT_EXCLUDED_PARENT_KEYS) {
      expect(filtered).not.toHaveProperty(key);
    }

    expect(filtered.workspaceId).toBe(parent.workspaceId);
    expect(filtered.sessionId).toBe(parent.sessionId);
    expect(filtered.abortSignal).toBe(parent.abortSignal);
  });

  it('is non-throwing for partial parents', () => {
    expect(
      filterParentContextForSubagent({} as HarnessTurnContext),
    ).toEqual({});
    expect(
      filterParentContextForSubagent({ workspaceId: 'w' } as HarnessTurnContext),
    ).toEqual({ workspaceId: 'w' });
  });
});

describe('createSubagentToolRegistry', () => {
  it('task tool runs runSubagent and returns ok:true with output', async () => {
    const subagent = makeSubagent();
    const runSubagent = vi.fn().mockResolvedValue({
      output: 'drafted',
      iterations: 3,
    });
    const registry = createRegistry([subagent], runSubagent);

    const result = await registry.execute(
      makeTaskCall({
        description: 'draft',
        subagent_type: 'doc-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(runSubagent).toHaveBeenCalledTimes(1);
    expect(runSubagent).toHaveBeenCalledWith({
      subagent: {
        ...subagent,
        maxIterations: 8,
      },
      description: 'draft',
      parentContext: {
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        userId: 'user-1',
        threadId: 'thread-1',
        iteration: 0,
        toolCallIndex: 0,
      },
      taskInput: {
        description: 'draft',
        subagent_type: 'doc-drafter',
      },
      signal: undefined,
      parentTraceId: undefined,
    });
    expect(parseTaskResult(result)).toEqual({
      ok: true,
      output: 'drafted',
      iterations: 3,
      subagent: 'doc-drafter',
    });
    expect(result.structuredOutput).toEqual({
      ok: true,
      output: 'drafted',
      iterations: 3,
      subagent: 'doc-drafter',
    });
  });

  it('task tool returns ok:false unknown_subagent for missing name', async () => {
    const runSubagent = vi.fn().mockResolvedValue({
      output: 'unused',
      iterations: 1,
    });
    const registry = createRegistry([makeSubagent()], runSubagent);

    const result = await registry.execute(
      makeTaskCall({
        description: 'draft',
        subagent_type: 'nope',
      }),
      EXECUTION_CONTEXT,
    );

    expect(runSubagent).not.toHaveBeenCalled();
    expect(parseTaskResult(result)).toEqual({
      ok: false,
      error: {
        code: 'unknown_subagent',
        message: 'Unknown subagent: nope',
      },
      iterations: 0,
      subagent: 'nope',
    });
  });

  it("task tool maps thrown Error('max_iterations') to code: 'max_iterations'", async () => {
    const runSubagent = vi.fn().mockRejectedValue(new Error('max_iterations reached'));
    const registry = createRegistry([makeSubagent()], runSubagent);

    const result = await registry.execute(
      makeTaskCall({
        description: 'draft',
        subagent_type: 'doc-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(parseTaskResult(result)).toMatchObject({
      ok: false,
      error: {
        code: 'max_iterations',
        message: 'max_iterations reached',
      },
      subagent: 'doc-drafter',
    });
  });

  it("task tool maps generic thrown Error to code: 'subagent_error'", async () => {
    const runSubagent = vi.fn().mockRejectedValue(new Error('boom'));
    const registry = createRegistry([makeSubagent()], runSubagent);

    const result = await registry.execute(
      makeTaskCall({
        description: 'draft',
        subagent_type: 'doc-drafter',
      }),
      EXECUTION_CONTEXT as HarnessToolExecutionContext,
    );

    expect(parseTaskResult(result)).toMatchObject({
      ok: false,
      error: {
        code: 'subagent_error',
        message: 'boom',
      },
      subagent: 'doc-drafter',
    });
  });

  it("task tool maps non-Error throw to code: 'subagent_error' with stringified message", async () => {
    const runSubagent = vi.fn().mockRejectedValue('string-throw');
    const registry = createRegistry([makeSubagent()], runSubagent);

    const result = await registry.execute(
      makeTaskCall({
        description: 'draft',
        subagent_type: 'doc-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(parseTaskResult(result)).toMatchObject({
      ok: false,
      error: {
        code: 'subagent_error',
        message: 'string-throw',
      },
      subagent: 'doc-drafter',
    });
  });

  it("task tool maps AbortError to code: 'aborted'", async () => {
    const abortError = new Error('stop now');
    abortError.name = 'AbortError';

    const runSubagent = vi.fn().mockRejectedValue(abortError);
    const registry = createRegistry([makeSubagent()], runSubagent);

    const result = await registry.execute(
      makeTaskCall({
        description: 'draft',
        subagent_type: 'doc-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(parseTaskResult(result)).toMatchObject({
      ok: false,
      error: {
        code: 'aborted',
        message: 'stop now',
      },
      subagent: 'doc-drafter',
    });
  });

  it('parallel fan-out runs subagents concurrently', async () => {
    const events: string[] = [];
    const runSubagent = vi.fn(async ({ subagent }: { subagent: HarnessSubagent }) => {
      events.push(`start:${subagent.name}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      events.push(`finish:${subagent.name}`);
      return {
        output: `${subagent.name}-done`,
        iterations: 1,
      };
    });
    const registry = createRegistry(
      [
        makeSubagent(),
        makeSubagent({
          name: 'researcher',
          description: 'Researches supporting material.',
        }),
      ],
      runSubagent,
    );

    const startedAt = performance.now();
    const [firstResult, secondResult] = await Promise.all([
      registry.execute(
        makeTaskCall({
          description: 'draft',
          subagent_type: 'doc-drafter',
        }),
        EXECUTION_CONTEXT,
      ),
      registry.execute(
        makeTaskCall({
          description: 'research',
          subagent_type: 'researcher',
        }),
        EXECUTION_CONTEXT,
      ),
    ]);
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(90);
    expect(events[0]).toMatch(/^start:/);
    expect(events[1]).toMatch(/^start:/);
    expect(events).toEqual([
      'start:doc-drafter',
      'start:researcher',
      'finish:doc-drafter',
      'finish:researcher',
    ]);
    expect(parseTaskResult(firstResult)).toMatchObject({
      ok: true,
      subagent: 'doc-drafter',
    });
    expect(parseTaskResult(secondResult)).toMatchObject({
      ok: true,
      subagent: 'researcher',
    });
  });

  it('empty subagents[] yields a registry with no task tool', async () => {
    const registry = createRegistry([], vi.fn());

    const tools = await registry.listAvailable(AVAILABILITY_INPUT);

    expect(tools).toEqual([]);
  });

  it('HarnessSubagent maxIterations override is observable', async () => {
    const subagent = makeSubagent({ maxIterations: 3 });
    const runSubagent = vi.fn(async ({ subagent: receivedSubagent }) => {
      expect(receivedSubagent.maxIterations).toBe(3);
      return {
        output: 'drafted',
        iterations: 1,
      };
    });
    const registry = createRegistry([subagent], runSubagent);

    const result = await registry.execute(
      makeTaskCall({
        description: 'draft',
        subagent_type: 'doc-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(parseTaskResult(result)).toMatchObject({
      ok: true,
      output: 'drafted',
      iterations: 1,
      subagent: 'doc-drafter',
    });
  });
});
