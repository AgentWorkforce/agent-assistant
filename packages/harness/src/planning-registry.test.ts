import { describe, expect, it } from 'vitest';

import {
  createPlanningToolRegistry,
  getOrCreatePlanState,
  PLANNING_SCRATCH_KEY,
  type HarnessTodo,
} from './planning-registry.js';
import type { HarnessTurnContext } from './subagent-registry.js';
import type { HarnessToolCall, HarnessToolResult } from './types.js';

function makeContext(overrides: Partial<HarnessTurnContext> = {}): HarnessTurnContext {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    userId: 'user-1',
    threadId: 'thread-1',
    iteration: 0,
    toolCallIndex: 0,
    scratch: {},
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

function createRegistry(maxTodos?: number) {
  return createPlanningToolRegistry({
    getState: getOrCreatePlanState,
    ...(maxTodos === undefined ? {} : { maxTodos }),
  });
}

function parseResult(result: HarnessToolResult): Record<string, unknown> {
  expect(result.status).toBe('success');
  expect(result.output).toEqual(expect.any(String));
  return JSON.parse(result.output ?? 'null') as Record<string, unknown>;
}

describe('createPlanningToolRegistry', () => {
  it('write_todos replaces state.todos and auto-assigns ids', async () => {
    const registry = createRegistry();
    const ctx = makeContext();

    await registry.execute(
      makeCall('write_todos', {
        todos: [{ content: 'Inspect bug' }, { content: 'Patch bug' }, { content: 'Verify fix' }],
      }),
      ctx,
    );

    const state = getOrCreatePlanState(ctx);
    expect(state.todos).toHaveLength(3);
    expect(state.todos.map((todo) => todo.content)).toEqual([
      'Inspect bug',
      'Patch bug',
      'Verify fix',
    ]);

    for (const todo of state.todos) {
      expect(todo.id).toEqual(expect.any(String));
      expect(todo.id.length).toBeGreaterThan(0);
      expect(todo.status).toBe('pending');
      expect(todo.seq).toEqual(expect.any(Number));
      expect(todo.seq).toBeGreaterThan(0);
    }

    await registry.execute(
      makeCall('write_todos', {
        todos: [{ content: 'Review code' }, { content: 'Ship patch' }],
      }),
      ctx,
    );

    expect(state.todos).toHaveLength(2);
    expect(state.todos.map((todo) => todo.content)).toEqual(['Review code', 'Ship patch']);
  });

  it('write_todos rejects > 1 in_progress and does NOT mutate state', async () => {
    const registry = createRegistry();
    const ctx = makeContext();
    const state = getOrCreatePlanState(ctx);
    const existingTodos: HarnessTodo[] = [
      { id: 't1', content: 'Already done', status: 'completed', seq: 1 },
    ];
    state.todos = existingTodos;
    state.nextSeq = 2;

    const result = await registry.execute(
      makeCall('write_todos', {
        todos: [
          { content: 'First active task', status: 'in_progress' },
          { content: 'Second active task', status: 'in_progress' },
        ],
      }),
      ctx,
    );

    expect(parseResult(result)).toEqual({
      ok: false,
      error: 'At most one todo can be in_progress at a time.',
    });
    expect(state.todos).toBe(existingTodos);
    expect(state.todos).toEqual(existingTodos);
    expect(state.nextSeq).toBe(2);
  });

  it('write_todos input schema enforces maxTodos', async () => {
    const registry = createRegistry(3);
    const ctx = makeContext();

    const result = await registry.execute(
      makeCall('write_todos', {
        todos: [
          { content: 'One' },
          { content: 'Two' },
          { content: 'Three' },
          { content: 'Four' },
        ],
      }),
      ctx,
    );

    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({
      code: 'invalid_input',
      retryable: false,
    });

    const state = getOrCreatePlanState(ctx);
    expect(state.todos).toEqual([]);
    expect(state.nextSeq).toBe(1);
  });

  it('list_todos returns current todos', async () => {
    const registry = createRegistry();
    const ctx = makeContext();
    const state = getOrCreatePlanState(ctx);
    state.todos = [
      { id: 't1', content: 'First task', status: 'pending', seq: 1 },
      { id: 't2', content: 'Second task', status: 'in_progress', seq: 2 },
    ];
    state.nextSeq = 3;

    const result = await registry.execute(makeCall('list_todos', {}), ctx);

    expect(parseResult(result)).toEqual({
      ok: true,
      todos: state.todos,
    });
  });

  it('complete_todo marks matching todo completed', async () => {
    const registry = createRegistry();
    const ctx = makeContext();
    const state = getOrCreatePlanState(ctx);
    state.todos = [
      { id: 't1', content: 'Prepare branch', status: 'pending', seq: 1 },
      { id: 't2', content: 'Implement change', status: 'in_progress', seq: 2 },
    ];
    state.nextSeq = 3;

    const result = await registry.execute(makeCall('complete_todo', { id: 't2' }), ctx);

    expect(parseResult(result)).toEqual({
      ok: true,
      todos: state.todos,
    });
    expect(state.todos[1]?.status).toBe('completed');
  });

  it('complete_todo auto-promotes next pending to in_progress', async () => {
    const registry = createRegistry();
    const ctx = makeContext();
    const state = getOrCreatePlanState(ctx);
    state.todos = [
      { id: 't1', content: 'Start draft', status: 'in_progress', seq: 1 },
      { id: 't2', content: 'Review draft', status: 'pending', seq: 2 },
      { id: 't3', content: 'Publish draft', status: 'pending', seq: 3 },
    ];
    state.nextSeq = 4;

    const result = await registry.execute(makeCall('complete_todo', { id: 't1' }), ctx);

    expect(parseResult(result)).toEqual({
      ok: true,
      todos: state.todos,
    });
    expect(state.todos.map((todo) => todo.status)).toEqual([
      'completed',
      'in_progress',
      'pending',
    ]);
  });

  it('complete_todo unknown id returns ok:false without mutation', async () => {
    const registry = createRegistry();
    const ctx = makeContext();
    const state = getOrCreatePlanState(ctx);
    const existingTodos: HarnessTodo[] = [
      { id: 't1', content: 'Unchanged task', status: 'pending', seq: 1 },
    ];
    state.todos = existingTodos;
    state.nextSeq = 2;

    const result = await registry.execute(makeCall('complete_todo', { id: 'nope' }), ctx);

    expect(parseResult(result)).toEqual({
      ok: false,
      error: 'Unknown todo id: nope',
    });
    expect(state.todos).toBe(existingTodos);
    expect(state.todos).toEqual(existingTodos);
    expect(state.nextSeq).toBe(2);
  });

  it('state persists across tool calls within the same ctx', async () => {
    const registry = createRegistry();
    const ctx = makeContext();

    const writeResult = parseResult(
      await registry.execute(
        makeCall('write_todos', {
          todos: [
            { content: 'Inspect logs', status: 'in_progress' },
            { content: 'Patch issue' },
          ],
        }),
        ctx,
      ),
    );

    const writtenTodos = writeResult.todos as HarnessTodo[];
    expect(writtenTodos).toHaveLength(2);

    const firstList = parseResult(await registry.execute(makeCall('list_todos', {}), ctx));
    expect(firstList).toEqual({
      ok: true,
      todos: writtenTodos,
    });

    const completeResult = parseResult(
      await registry.execute(makeCall('complete_todo', { id: writtenTodos[0]!.id }), ctx),
    );
    const completedTodos = completeResult.todos as HarnessTodo[];
    expect(completedTodos.map((todo) => todo.status)).toEqual(['completed', 'in_progress']);

    const secondList = parseResult(await registry.execute(makeCall('list_todos', {}), ctx));
    expect(secondList).toEqual({
      ok: true,
      todos: completedTodos,
    });
  });

  it('state is isolated between different ctx instances', async () => {
    const registry = createRegistry();
    const ctxA = makeContext({ turnId: 'turn-a' });
    const ctxB = makeContext({ turnId: 'turn-b' });

    await registry.execute(
      makeCall('write_todos', {
        todos: [{ content: 'Only in A' }],
      }),
      ctxA,
    );

    const resultB = await registry.execute(makeCall('list_todos', {}), ctxB);

    expect(parseResult(resultB)).toEqual({
      ok: true,
      todos: [],
    });
    expect(getOrCreatePlanState(ctxA).todos).toHaveLength(1);
    expect(getOrCreatePlanState(ctxB).todos).toEqual([]);
  });
});

describe('getOrCreatePlanState', () => {
  it('initializes with empty todos and seq=1 and returns the same object for the same ctx', () => {
    const ctx = makeContext();

    const first = getOrCreatePlanState(ctx);
    const second = getOrCreatePlanState(ctx);

    expect(first).toEqual({
      todos: [],
      nextSeq: 1,
    });
    expect(second).toBe(first);
    expect((ctx.scratch as Record<string, unknown>)[PLANNING_SCRATCH_KEY]).toBe(first);
  });
});
