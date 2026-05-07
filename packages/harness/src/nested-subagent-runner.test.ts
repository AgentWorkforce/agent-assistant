import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHarness } from './harness.js';
import {
  createNestedSubagentRunner,
  type CreateNestedHarnessInput,
} from './nested-subagent-runner.js';
import {
  createSubagentToolRegistry,
  SUBAGENT_EXCLUDED_PARENT_KEYS,
  type HarnessSubagent,
  type HarnessTurnContext,
  type RunSubagentInput,
} from './subagent-registry.js';
import type {
  HarnessResult,
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolResult,
  HarnessTurnInput,
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
  traceId: 'trace-parent',
  metadata: { traceId: 'trace-parent', requestId: 'req-1' },
  messages: [{ role: 'user', content: 'draft this' }],
  todos: [{ id: 'todo-1', text: 'draft' }],
  structuredResponse: { mode: 'json' },
  skillsMetadata: { source: 'test' },
  memoryContents: ['remembered'],
};

function makeSubagent(overrides: Partial<HarnessSubagent> = {}): HarnessSubagent {
  return {
    name: 'example-drafter',
    description: 'Drafts documentation artifacts.',
    toolAllowlist: ['memory_recall'],
    systemPrompt: 'You write docs.',
    maxIterations: 4,
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

function createTraceSummary(iterationCount = 1) {
  return {
    iterationCount,
    toolCallCount: 0,
    hadContinuation: false,
    finalEventType: 'turn_finished',
  };
}

function createHarnessResult(
  overrides: Partial<HarnessResult> = {},
): HarnessResult {
  return {
    outcome: 'completed',
    stopReason: 'answer_finalized',
    turnId: 'child-turn-1',
    sessionId: 'session-1',
    assistantMessage: { text: 'nested done' },
    traceSummary: createTraceSummary(1),
    usage: {
      modelCalls: 1,
      toolCalls: 0,
    },
    ...overrides,
  };
}

function createParentInput(): HarnessTurnInput {
  return {
    assistantId: 'assistant-1',
    turnId: 'parent-turn-1',
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    userId: 'user-1',
    threadId: 'thread-1',
    message: {
      id: 'msg-1',
      text: 'help me',
      receivedAt: '2026-05-07T00:00:00.000Z',
    },
    instructions: {
      systemPrompt: 'You are helpful.',
    },
    metadata: {
      traceId: 'trace-parent',
    },
  };
}

function createRegistry(subagents: readonly HarnessSubagent[], runSubagent: ReturnType<typeof createNestedSubagentRunner>) {
  return createSubagentToolRegistry({
    subagents,
    runSubagent,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createNestedSubagentRunner', () => {
  it('success_returns_flat_result', async () => {
    const seenCreateHarnessInputs: CreateNestedHarnessInput[] = [];
    const seenTurnInputs: HarnessTurnInput[] = [];
    const subagent = makeSubagent();
    const registry = createRegistry(
      [subagent],
      createNestedSubagentRunner({
        now: () => '2026-05-07T12:00:00.000Z',
        composeInstructions: ({ subagent: child, taskInput }) => ({
          systemPrompt: `${child.systemPrompt} :: ${taskInput.description}`,
        }),
        createHarness: (input) => {
          seenCreateHarnessInputs.push(input);
          return {
            runTurn: async (turnInput) => {
              seenTurnInputs.push(turnInput);
              return createHarnessResult({
                assistantMessage: { text: 'draft ready' },
                traceSummary: createTraceSummary(2),
              });
            },
          };
        },
      }),
    );

    const result = await registry.execute(
      makeTaskCall({
        description: 'Draft the release notes.',
        subagent_type: 'example-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(parseTaskResult(result)).toEqual({
      ok: true,
      output: 'draft ready',
      iterations: 2,
      subagent: 'example-drafter',
    });
    expect(seenCreateHarnessInputs).toHaveLength(1);
    expect(seenCreateHarnessInputs[0]?.parentTraceId).toBe('trace-parent');
    expect(seenCreateHarnessInputs[0]?.toolAllowlist).toEqual(new Set(['memory_recall']));
    for (const key of SUBAGENT_EXCLUDED_PARENT_KEYS) {
      expect(seenCreateHarnessInputs[0]?.filteredParentContext).not.toHaveProperty(key);
    }
    expect(seenTurnInputs[0]).toMatchObject({
      assistantId: 'assistant-1',
      turnId: 'turn-1.sa-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      userId: 'user-1',
      threadId: 'thread-1',
      allowedToolNames: ['memory_recall'],
      instructions: {
        systemPrompt: 'You write docs. :: Draft the release notes.',
      },
      metadata: {
        traceId: 'trace-parent',
        requestId: 'req-1',
        parentTraceId: 'trace-parent',
        childTraceId: 'trace-parent.sa-1',
        subagentName: 'example-drafter',
      },
      message: {
        id: 'turn-1.sa-1.msg-1',
        text: 'Draft the release notes.',
        receivedAt: '2026-05-07T12:00:00.000Z',
      },
    });
  });

  it('unknown_subagent_returns_ok_false', async () => {
    const createHarnessSpy = vi.fn();
    const registry = createRegistry(
      [makeSubagent()],
      createNestedSubagentRunner({
        composeInstructions: () => ({ systemPrompt: 'unused' }),
        createHarness: createHarnessSpy,
      }),
    );

    const result = await registry.execute(
      makeTaskCall({
        description: 'Draft the release notes.',
        subagent_type: 'missing',
      }),
      EXECUTION_CONTEXT,
    );

    expect(createHarnessSpy).not.toHaveBeenCalled();
    expect(parseTaskResult(result)).toEqual({
      ok: false,
      error: {
        code: 'unknown_subagent',
        message: 'Unknown subagent: missing',
      },
      iterations: 0,
      subagent: 'missing',
    });
  });

  it('subagent_failure_is_isolated', async () => {
    const runner = createNestedSubagentRunner({
      composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
      createHarness: () => ({
        runTurn: async () => {
          throw new Error('boom');
        },
      }),
    });
    const tools = createRegistry([makeSubagent()], runner);
    const parentHarness = createHarness({
      model: {
        nextStep: async (input) =>
          input.transcript.some((item) => item.type === 'tool_result')
            ? { type: 'final_answer', text: 'parent recovered' }
            : {
                type: 'tool_request',
                calls: [
                  {
                    id: 'task-1',
                    name: 'task',
                    input: {
                      description: 'Draft the release notes.',
                      subagent_type: 'example-drafter',
                    },
                  },
                ],
              },
      },
      tools,
    });

    const result = await parentHarness.runTurn(createParentInput());

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
    expect(result.assistantMessage?.text).toBe('parent recovered');
  });

  it('create_harness_failure_is_isolated', async () => {
    const registry = createRegistry(
      [makeSubagent()],
      createNestedSubagentRunner({
        composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
        createHarness: () => {
          throw new Error('runtime setup failed');
        },
      }),
    );

    const result = await registry.execute(
      makeTaskCall({
        description: 'Draft the release notes.',
        subagent_type: 'example-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(parseTaskResult(result)).toEqual({
      ok: false,
      error: {
        code: 'subagent_error',
        message: 'runtime setup failed',
      },
      iterations: 0,
      subagent: 'example-drafter',
    });
  });

  it('compose_instructions_failure_is_isolated', async () => {
    const registry = createRegistry(
      [makeSubagent()],
      createNestedSubagentRunner({
        composeInstructions: () => {
          throw new Error('instruction setup failed');
        },
        createHarness: () => ({
          runTurn: async () => createHarnessResult(),
        }),
      }),
    );

    const result = await registry.execute(
      makeTaskCall({
        description: 'Draft the release notes.',
        subagent_type: 'example-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(parseTaskResult(result)).toEqual({
      ok: false,
      error: {
        code: 'subagent_error',
        message: 'instruction setup failed',
      },
      iterations: 0,
      subagent: 'example-drafter',
    });
  });

  it('max_iterations_failure', async () => {
    const registry = createRegistry(
      [makeSubagent({ maxIterations: 3 })],
      createNestedSubagentRunner({
        composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
        createHarness: () => ({
          runTurn: async () =>
            createHarnessResult({
              outcome: 'deferred',
              stopReason: 'max_iterations_reached',
              continuation: {
                id: 'deferred-1',
                type: 'deferred',
                createdAt: '2026-05-07T00:00:00.000Z',
                turnId: 'child-turn-1',
                resumeToken: 'resume-1',
                state: {},
              },
              assistantMessage: undefined,
              traceSummary: createTraceSummary(3),
            }),
        }),
      }),
    );

    const result = await registry.execute(
      makeTaskCall({
        description: 'Draft the release notes.',
        subagent_type: 'example-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(parseTaskResult(result)).toEqual({
      ok: false,
      error: {
        code: 'max_iterations',
        message: 'Subagent reached its maximum iteration limit.',
      },
      iterations: 3,
      subagent: 'example-drafter',
    });
  });

  it('parent_cancellation_propagates', async () => {
    const abortController = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const registry = createRegistry(
      [makeSubagent()],
      createNestedSubagentRunner({
        composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
        createHarness: ({ signal }) => {
          receivedSignal = signal;
          return {
            runTurn: async () =>
              new Promise<HarnessResult>((resolve) => {
                if (signal?.aborted) {
                  resolve(
                    createHarnessResult({
                      outcome: 'failed',
                      stopReason: 'cancelled',
                      assistantMessage: undefined,
                    }),
                  );
                  return;
                }

                signal?.addEventListener(
                  'abort',
                  () => {
                    resolve(
                      createHarnessResult({
                        outcome: 'failed',
                        stopReason: 'cancelled',
                        assistantMessage: undefined,
                      }),
                    );
                  },
                  { once: true },
                );
              }),
          };
        },
      }),
    );

    const pending = registry.execute(
      makeTaskCall({
        description: 'Draft the release notes.',
        subagent_type: 'example-drafter',
      }),
      {
        ...EXECUTION_CONTEXT,
        signal: abortController.signal,
      },
    );
    abortController.abort();
    const result = await pending;

    expect(receivedSignal).toBe(abortController.signal);
    expect(parseTaskResult(result)).toEqual({
      ok: false,
      error: {
        code: 'aborted',
        message: 'Subagent run was cancelled.',
      },
      iterations: 1,
      subagent: 'example-drafter',
    });
  });

  it('tool_allowlist_enforced', async () => {
    const observedAvailableTools: string[][] = [];
    const registry = createRegistry(
      [makeSubagent({ toolAllowlist: ['memory_recall'] })],
      createNestedSubagentRunner({
        composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
        createHarness: () =>
          createHarness({
            model: {
              nextStep: async (input) => {
                observedAvailableTools.push(input.availableTools.map((tool) => tool.name));
                return { type: 'final_answer', text: 'done' };
              },
            },
            tools: {
              async listAvailable(input) {
                const allTools = [
                  { name: 'memory_recall', description: 'Allowed' },
                  { name: 'workspace_search', description: 'Forbidden' },
                ];
                if (!input.allowedToolNames) {
                  return allTools;
                }
                const allowed = new Set(input.allowedToolNames);
                return allTools.filter((tool) => allowed.has(tool.name));
              },
              async execute() {
                throw new Error('unused');
              },
            },
          }),
      }),
    );

    const result = await registry.execute(
      makeTaskCall({
        description: 'Draft the release notes.',
        subagent_type: 'example-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    expect(parseTaskResult(result)).toMatchObject({
      ok: true,
      output: 'done',
    });
    expect(observedAvailableTools).toEqual([['memory_recall']]);
  });

  it('parent_context_is_filtered', async () => {
    let seenInput: CreateNestedHarnessInput | undefined;
    const registry = createRegistry(
      [makeSubagent()],
      createNestedSubagentRunner({
        composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
        createHarness: (input) => {
          seenInput = input;
          return {
            runTurn: async () => createHarnessResult(),
          };
        },
      }),
    );

    await registry.execute(
      makeTaskCall({
        description: 'Draft the release notes.',
        subagent_type: 'example-drafter',
      }),
      EXECUTION_CONTEXT,
    );

    for (const key of SUBAGENT_EXCLUDED_PARENT_KEYS) {
      expect(seenInput?.parentContext).not.toHaveProperty(key);
    }
    for (const key of SUBAGENT_EXCLUDED_PARENT_KEYS) {
      expect(seenInput?.filteredParentContext).not.toHaveProperty(key);
    }
  });

  it('direct_runner_invocation_preserves_raw_parent_context_and_provides_filtered_copy', async () => {
    let seenInput: CreateNestedHarnessInput | undefined;
    const rawParentContext: HarnessTurnContext = {
      ...EXECUTION_CONTEXT,
      messages: [{ role: 'user', content: 'sensitive context' }],
      todos: [{ id: 'todo-sensitive', text: 'hide me' }],
    };
    const runner = createNestedSubagentRunner({
      composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
      createHarness: (input) => {
        seenInput = input;
        return {
          runTurn: async () => createHarnessResult(),
        };
      },
    });

    await runner({
      subagent: makeSubagent(),
      description: 'Draft the release notes.',
      parentContext: rawParentContext,
      taskInput: {
        description: 'Draft the release notes.',
        subagent_type: 'example-drafter',
      },
    } satisfies RunSubagentInput);

    expect(seenInput?.parentContext.messages).toEqual([
      { role: 'user', content: 'sensitive context' },
    ]);
    expect(seenInput?.parentContext.todos).toEqual([
      { id: 'todo-sensitive', text: 'hide me' },
    ]);
    for (const key of SUBAGENT_EXCLUDED_PARENT_KEYS) {
      expect(seenInput?.filteredParentContext).not.toHaveProperty(key);
    }
  });

  it('metadata_child_trace_id_precedes_metadata_parent_trace_id', async () => {
    const seenTurnInputs: HarnessTurnInput[] = [];
    const runner = createNestedSubagentRunner({
      composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
      createHarness: () => ({
        runTurn: async (turnInput) => {
          seenTurnInputs.push(turnInput);
          return createHarnessResult();
        },
      }),
    });

    await runner({
      subagent: makeSubagent(),
      description: 'Draft once.',
      parentContext: {
        ...EXECUTION_CONTEXT,
        traceId: undefined,
        parentTraceId: undefined,
        childTraceId: undefined,
        metadata: {
          parentTraceId: 'metadata-parent',
          childTraceId: 'metadata-child',
        },
      },
      taskInput: {
        description: 'Draft once.',
        subagent_type: 'example-drafter',
      },
    });

    expect(seenTurnInputs[0]?.metadata).toMatchObject({
      parentTraceId: 'metadata-child',
      childTraceId: 'metadata-child.sa-1',
    });
  });

  it('direct_child_trace_id_precedes_direct_parent_trace_id', async () => {
    const seenTurnInputs: HarnessTurnInput[] = [];
    const runner = createNestedSubagentRunner({
      composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
      createHarness: () => ({
        runTurn: async (turnInput) => {
          seenTurnInputs.push(turnInput);
          return createHarnessResult();
        },
      }),
    });

    await runner({
      subagent: makeSubagent(),
      description: 'Draft once.',
      parentContext: {
        ...EXECUTION_CONTEXT,
        traceId: undefined,
        parentTraceId: 'direct-parent',
        childTraceId: 'direct-child',
        metadata: {
          parentTraceId: 'metadata-parent',
          childTraceId: 'metadata-child',
        },
      },
      taskInput: {
        description: 'Draft once.',
        subagent_type: 'example-drafter',
      },
    });

    expect(seenTurnInputs[0]?.metadata).toMatchObject({
      parentTraceId: 'direct-child',
      childTraceId: 'direct-child.sa-1',
    });
  });

  it('workers_fetch_compatibility', async () => {
    vi.resetModules();
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const getter = vi.fn(() => {
      throw new Error('fetch should not be read at construction time');
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      get: getter,
    });

    try {
      const {
        createNestedSubagentRunner: importCreateNestedSubagentRunner,
      } = await import('./nested-subagent-runner.js');
      expect(() =>
        importCreateNestedSubagentRunner({
          composeInstructions: () => ({ systemPrompt: 'child' }),
          createHarness: () => ({
            runTurn: async () => createHarnessResult(),
          }),
        }),
      ).not.toThrow();
      expect(getter).not.toHaveBeenCalled();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'fetch', originalDescriptor);
      } else {
        delete (globalThis as { fetch?: unknown }).fetch;
      }
      vi.resetModules();
    }
  });

  it('child_ids_are_scoped_per_parent_turn', async () => {
    const seenTurnIds: string[] = [];
    const runner = createNestedSubagentRunner({
      composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
      createHarness: () => ({
        runTurn: async (turnInput) => {
          seenTurnIds.push(turnInput.turnId);
          return createHarnessResult();
        },
      }),
    });

    const firstParent: RunSubagentInput = {
      subagent: makeSubagent(),
      description: 'Draft once.',
      parentContext: {
        ...EXECUTION_CONTEXT,
        turnId: 'parent-turn-a',
        traceId: 'trace-a',
      },
      taskInput: {
        description: 'Draft once.',
        subagent_type: 'example-drafter',
      },
    };
    const secondParent: RunSubagentInput = {
      ...firstParent,
      description: 'Draft from another parent.',
      parentContext: {
        ...EXECUTION_CONTEXT,
        turnId: 'parent-turn-b',
        traceId: 'trace-b',
      },
      taskInput: {
        description: 'Draft from another parent.',
        subagent_type: 'example-drafter',
      },
    };

    await runner(firstParent);
    await runner({
      ...firstParent,
      description: 'Draft twice.',
      taskInput: {
        description: 'Draft twice.',
        subagent_type: 'example-drafter',
      },
    });
    await runner(secondParent);

    expect(seenTurnIds).toEqual([
      'parent-turn-a.sa-1',
      'parent-turn-a.sa-2',
      'parent-turn-b.sa-1',
    ]);
  });

  it('parallel_children_receive_distinct_ids_for_same_parent_turn', async () => {
    const seenTurnIds: string[] = [];
    const runner = createNestedSubagentRunner({
      composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
      createHarness: () => ({
        runTurn: async (turnInput) => {
          seenTurnIds.push(turnInput.turnId);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return createHarnessResult();
        },
      }),
    });
    const parentContext: HarnessTurnContext = {
      ...EXECUTION_CONTEXT,
      turnId: 'parent-turn-parallel',
      traceId: 'trace-parallel',
    };

    await Promise.all([
      runner({
        subagent: makeSubagent(),
        description: 'Draft first.',
        parentContext,
        taskInput: {
          description: 'Draft first.',
          subagent_type: 'example-drafter',
        },
      }),
      runner({
        subagent: makeSubagent(),
        description: 'Draft second.',
        parentContext,
        taskInput: {
          description: 'Draft second.',
          subagent_type: 'example-drafter',
        },
      }),
    ]);

    expect(new Set(seenTurnIds)).toEqual(
      new Set(['parent-turn-parallel.sa-1', 'parent-turn-parallel.sa-2']),
    );
  });

  it('parallel_task_batch', async () => {
    const events: string[] = [];
    const tools = createRegistry(
      [
        makeSubagent(),
        makeSubagent({
          name: 'researcher',
          description: 'Researches supporting material.',
        }),
      ],
      createNestedSubagentRunner({
        composeInstructions: ({ subagent }) => ({ systemPrompt: subagent.systemPrompt }),
        createHarness: ({ subagent }) => ({
          runTurn: async () => {
            events.push(`start:${subagent.name}`);
            await new Promise((resolve) => setTimeout(resolve, 50));
            events.push(`finish:${subagent.name}`);
            return createHarnessResult({
              assistantMessage: { text: `${subagent.name}-done` },
            });
          },
        }),
      }),
    );
    const parentHarness = createHarness({
      model: {
        nextStep: async (input) =>
          input.transcript.some((item) => item.type === 'tool_result')
            ? { type: 'final_answer', text: 'parent done' }
            : {
                type: 'tool_request',
                calls: [
                  {
                    id: 'task-1',
                    name: 'task',
                    input: {
                      description: 'Draft the release notes.',
                      subagent_type: 'example-drafter',
                    },
                  },
                  {
                    id: 'task-2',
                    name: 'task',
                    input: {
                      description: 'Find supporting material.',
                      subagent_type: 'researcher',
                    },
                  },
                ],
              },
      },
      tools,
    });

    const availableTools = await tools.listAvailable(AVAILABILITY_INPUT);
    expect(availableTools[0]?.executionMode).toBe('parallel');

    const startedAt = performance.now();
    const result = await parentHarness.runTurn(createParentInput());
    const elapsedMs = performance.now() - startedAt;

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
    expect(elapsedMs).toBeLessThan(200);
    expect(events).toEqual([
      'start:example-drafter',
      'start:researcher',
      'finish:example-drafter',
      'finish:researcher',
    ]);
  });
});
