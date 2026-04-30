import { z } from 'zod';

import type { HarnessTurnContext } from './subagent-registry.js';
import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolRegistry,
  HarnessToolResult,
} from './types.js';

/**
 * Planning tool — model-internal todo list backed by per-turn scratch
 * state. Surfaces partial completion to the user / operator for multi-step
 * drafts.
 *
 * Ported from langchain-ai/deepagents (MIT) — see write_todos /
 * TodoWrite in `libs/deepagents/deepagents/graph.py:227-232` and
 * TodoListMiddleware behavior in
 * `libs/deepagents/tests/unit_tests/test_todo_middleware.py:17-102`.
 * Reimplemented from scratch in TS in the @agent-assistant/harness idiom.
 * Sourcing constraints documented in the porting workflow's README.
 *
 * HarnessTurnContext is structural (`subagent-registry.ts:65-70`) and
 * HarnessToolExecutionContext currently has no declared scratch field
 * (`types.ts:236-245`), so this module stores state under
 * `ctx.scratch[PLANNING_SCRATCH_KEY]` when a scratch record is already
 * present and otherwise falls back to a per-context WeakMap.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface HarnessTodo {
  /** Stable identifier — auto-assigned if not supplied. */
  id: string;
  /** Short imperative sentence describing the todo. */
  content: string;
  status: TodoStatus;
  /** Monotonic sequence number for ordering / telemetry. */
  seq: number;
}

export interface HarnessPlanState {
  todos: HarnessTodo[];
  /** Next sequence number; bumps on each write. */
  nextSeq: number;
}

export interface CreatePlanningToolRegistryOptions {
  /**
   * Function returning the per-turn HarnessPlanState. Implementations
   * typically attach state to HarnessTurnContext.scratch under a
   * dedicated namespace key. The function is called once per tool
   * invocation; mutate the returned object in place.
   */
  getState: (ctx: HarnessTurnContext) => HarnessPlanState;
  /**
   * Optional limit on the number of todos. Defaults to 32; writes
   * past this cap fail with a structured error.
   */
  maxTodos?: number;
}

export const PLANNING_DEFAULT_MAX_TODOS = 32;
export const PLANNING_SCRATCH_KEY = 'agent-assistant:planning:v1';

const WRITE_TODOS_TOOL_NAME = 'write_todos';
const LIST_TODOS_TOOL_NAME = 'list_todos';
const COMPLETE_TODO_TOOL_NAME = 'complete_todo';

const TODO_STATUS_VALUES = ['pending', 'in_progress', 'completed'] as const;

const FALLBACK_PLAN_STATE = new WeakMap<HarnessTurnContext, HarnessPlanState>();

const LIST_TODOS_INPUT_SCHEMA = z.object({});
const COMPLETE_TODO_INPUT_SCHEMA = z.object({
  id: z.string().min(1),
});

const WRITE_TODOS_TOOL_DESCRIPTION =
  'Replace the current todo list with an updated plan for this turn. Use to track multi-step work, keeping at most one item in_progress.';
const LIST_TODOS_TOOL_DESCRIPTION =
  'Read the current todo list for this turn without modifying it.';
const COMPLETE_TODO_TOOL_DESCRIPTION =
  'Mark one todo completed by id. If a later pending todo exists and nothing else is already in_progress, the next pending todo is auto-promoted.';

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMaxTodos(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return PLANNING_DEFAULT_MAX_TODOS;
  }

  return Math.floor(value);
}

function createEmptyPlanState(): HarnessPlanState {
  return {
    todos: [],
    nextSeq: 1,
  };
}

function buildWriteTodosSchema(maxTodos: number) {
  return z.object({
    todos: z
      .array(
        z.object({
          id: z.string().min(1).optional(),
          content: z.string().min(1),
          status: z.enum(TODO_STATUS_VALUES).default('pending'),
        }),
      )
      .max(maxTodos),
  });
}

function buildToolDefinitions(maxTodos: number): readonly HarnessToolDefinition[] {
  return [
    {
      name: WRITE_TODOS_TOOL_NAME,
      description: WRITE_TODOS_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        required: ['todos'],
        properties: {
          todos: {
            type: 'array',
            maxItems: maxTodos,
            items: {
              type: 'object',
              required: ['content'],
              properties: {
                id: { type: 'string', minLength: 1 },
                content: { type: 'string', minLength: 1 },
                status: { type: 'string', enum: [...TODO_STATUS_VALUES] },
              },
            },
          },
        },
      },
    },
    {
      name: LIST_TODOS_TOOL_NAME,
      description: LIST_TODOS_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: COMPLETE_TODO_TOOL_NAME,
      description: COMPLETE_TODO_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1 },
        },
      },
    },
  ] as const;
}

function errorResult(
  call: HarnessToolCall,
  code: string,
  message: string,
  retryable: boolean,
): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'error',
    error: {
      code,
      message,
      retryable,
    },
  };
}

function unknownToolResult(call: HarnessToolCall): HarnessToolResult {
  return errorResult(call, 'unknown_tool', `Unknown tool: ${call.name}`, false);
}

function invalidInputResult(call: HarnessToolCall, message: string): HarnessToolResult {
  return errorResult(call, 'invalid_input', message, false);
}

function successResult(
  call: HarnessToolCall,
  result: { ok: true; todos: HarnessTodo[] } | { ok: false; error: string },
): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output: formatJson(result),
    structuredOutput: result as Record<string, unknown>,
  };
}

function nextTodoSeq(state: HarnessPlanState): number {
  const seq = state.nextSeq;
  state.nextSeq += 1;
  return seq;
}

function assignTodo(
  state: HarnessPlanState,
  todo: {
    id?: string;
    content: string;
    status: TodoStatus;
  },
): HarnessTodo {
  const seq = nextTodoSeq(state);
  return {
    id: todo.id ?? `todo-${seq}`,
    content: todo.content,
    status: todo.status,
    seq,
  };
}

function countInProgressTodos(
  todos: ReadonlyArray<{
    status: TodoStatus;
  }>,
): number {
  return todos.filter((todo) => todo.status === 'in_progress').length;
}

export function getOrCreatePlanState(ctx: HarnessTurnContext): HarnessPlanState {
  const scratchValue = ctx.scratch;
  if (isRecord(scratchValue)) {
    const existing = scratchValue[PLANNING_SCRATCH_KEY];
    if (isPlanState(existing)) {
      return existing;
    }

    const created = createEmptyPlanState();
    scratchValue[PLANNING_SCRATCH_KEY] = created;
    return created;
  }

  const existing = FALLBACK_PLAN_STATE.get(ctx);
  if (existing) {
    return existing;
  }

  const created = createEmptyPlanState();
  FALLBACK_PLAN_STATE.set(ctx, created);
  return created;
}

function isPlanState(value: unknown): value is HarnessPlanState {
  if (!isRecord(value) || !Array.isArray(value.todos) || typeof value.nextSeq !== 'number') {
    return false;
  }

  return value.todos.every((todo) => {
    if (!isRecord(todo)) {
      return false;
    }

    return (
      typeof todo.id === 'string' &&
      typeof todo.content === 'string' &&
      typeof todo.seq === 'number' &&
      TODO_STATUS_VALUES.includes(todo.status as TodoStatus)
    );
  });
}

export function createPlanningToolRegistry(
  options: CreatePlanningToolRegistryOptions,
): HarnessToolRegistry {
  const maxTodos = normalizeMaxTodos(options.maxTodos);
  const writeTodosSchema = buildWriteTodosSchema(maxTodos);
  const toolDefinitions = buildToolDefinitions(maxTodos);
  const knownToolNames = new Set(toolDefinitions.map((tool) => tool.name));

  return {
    async listAvailable(input: HarnessToolAvailabilityInput) {
      if (!input.allowedToolNames || input.allowedToolNames.length === 0) {
        return [...toolDefinitions];
      }

      const allowed = new Set(input.allowedToolNames);
      return toolDefinitions.filter((tool) => allowed.has(tool.name));
    },

    async execute(call, context) {
      if (!knownToolNames.has(call.name)) {
        return unknownToolResult(call);
      }

      if (call.name === WRITE_TODOS_TOOL_NAME) {
        const validation = writeTodosSchema.safeParse(call.input);
        if (!validation.success) {
          return invalidInputResult(
            call,
            validation.error.issues[0]?.message ?? 'Invalid write_todos input',
          );
        }

        if (countInProgressTodos(validation.data.todos) > 1) {
          return successResult(call, {
            ok: false,
            error: 'At most one todo can be in_progress at a time.',
          });
        }

        const state = options.getState(context as HarnessTurnContext);
        state.todos = validation.data.todos.map((todo) => assignTodo(state, todo));

        return successResult(call, {
          ok: true,
          todos: state.todos,
        });
      }

      if (call.name === LIST_TODOS_TOOL_NAME) {
        const validation = LIST_TODOS_INPUT_SCHEMA.safeParse(call.input);
        if (!validation.success) {
          return invalidInputResult(
            call,
            validation.error.issues[0]?.message ?? 'Invalid list_todos input',
          );
        }

        const state = options.getState(context as HarnessTurnContext);
        return successResult(call, {
          ok: true,
          todos: state.todos,
        });
      }

      const validation = COMPLETE_TODO_INPUT_SCHEMA.safeParse(call.input);
      if (!validation.success) {
        return invalidInputResult(
          call,
          validation.error.issues[0]?.message ?? 'Invalid complete_todo input',
        );
      }

      const state = options.getState(context as HarnessTurnContext);
      const todoIndex = state.todos.findIndex((todo) => todo.id === validation.data.id);
      if (todoIndex === -1) {
        return successResult(call, {
          ok: false,
          error: `Unknown todo id: ${validation.data.id}`,
        });
      }

      const updatedTodos = [...state.todos];
      const todo = updatedTodos[todoIndex]!;
      updatedTodos[todoIndex] = {
        ...todo,
        status: 'completed',
        seq: nextTodoSeq(state),
      };

      const hasOtherInProgress = updatedTodos.some((item) => item.status === 'in_progress');
      if (!hasOtherInProgress) {
        const promoteIndex = updatedTodos.findIndex(
          (item, index) => index > todoIndex && item.status === 'pending',
        );
        if (promoteIndex !== -1) {
          const promoteTodo = updatedTodos[promoteIndex]!;
          updatedTodos[promoteIndex] = {
            ...promoteTodo,
            status: 'in_progress',
            seq: nextTodoSeq(state),
          };
        }
      }

      state.todos = updatedTodos;

      return successResult(call, {
        ok: true,
        todos: state.todos,
      });
    },
  };
}
