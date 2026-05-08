import { describe, expect, it, vi } from 'vitest';

import {
  createHarness,
  type HarnessModelOutput,
  type HarnessTraceEvent,
} from './index.js';

function createInput() {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    userId: 'user-1',
    threadId: 'thread-1',
    message: {
      id: 'msg-1',
      text: 'Investigate the repo.',
      receivedAt: '2026-05-07T12:00:00.000Z',
    },
    instructions: {
      systemPrompt: 'You are helpful.',
    },
  };
}

function createClock(times: number[]) {
  let index = 0;
  return {
    now: () => times[Math.min(index++, times.length - 1)] ?? 0,
    nowIso: () => new Date(times[Math.min(index, times.length - 1)] ?? 0).toISOString(),
  };
}

function toolRequest(
  id: string,
  name: string,
  input: Record<string, unknown>,
): HarnessModelOutput {
  return {
    type: 'tool_request',
    calls: [{ id, name, input }],
  };
}

describe('runtime policy integration', () => {
  it('caps repeated todo rewrites and still reaches final synthesis', async () => {
    const trace: HarnessTraceEvent[] = [];
    let writesExecuted = 0;
    const steps: HarnessModelOutput[] = Array.from({ length: 6 }, (_, index) =>
      toolRequest(`write-${index + 1}`, 'write_todos', {
        todos: [{ content: `step-${index + 1}`, status: 'pending' }],
      }),
    );
    steps.push({ type: 'final_answer', text: 'Used the surviving plan and completed the turn.' });

    const harness = createHarness({
      model: {
        nextStep: vi.fn(async () => steps.shift() as HarnessModelOutput),
      },
      tools: {
        listAvailable: async () => [{ name: 'write_todos', description: 'Write todos' }],
        execute: async (call) => {
          writesExecuted += 1;
          return {
            callId: call.id,
            toolName: call.name,
            status: 'success',
            output: JSON.stringify({ ok: true, rewrittenTo: call.input }),
          };
        },
      },
      runtimePolicy: {
        todoRewriteCap: {
          toolNames: ['write_todos'],
          max: 2,
        },
      },
      limits: { maxIterations: 8 },
      trace: { emit: (event) => trace.push(event) },
      clock: createClock(Array.from({ length: 64 }, (_, index) => index)),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(result.assistantMessage?.text).toContain('completed the turn');
    expect(writesExecuted).toBe(2);
    expect(
      trace.filter((event) => event.type === 'runtime_policy.todo_rewrite_blocked'),
    ).toHaveLength(4);
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: 'runtime_policy.synthesis_salvaged',
      }),
    );
  });

  it('caches duplicate tool calls without extra upstream reads or budget burn', async () => {
    const trace: HarnessTraceEvent[] = [];
    let upstreamReads = 0;
    const steps: HarnessModelOutput[] = [
      toolRequest('list-1', 'workspace_list', { path: '/github/repos/AgentWorkforce/relaycast', depth: 2 }),
      toolRequest('list-2', 'workspace_list', { depth: 2, path: '/github/repos/AgentWorkforce/relaycast' }),
      { type: 'final_answer', text: 'The repo has a package.json and src directory.' },
    ];

    const harness = createHarness({
      model: {
        nextStep: vi.fn(async () => steps.shift() as HarnessModelOutput),
      },
      tools: {
        listAvailable: async () => [{ name: 'workspace_list', description: 'List workspace' }],
        execute: async (call) => {
          upstreamReads += 1;
          return {
            callId: call.id,
            toolName: call.name,
            status: 'success',
            output: 'package.json\nsrc',
            structuredOutput: { candidates: [{ path: 'package.json' }, { path: 'src/index.ts' }] },
          };
        },
      },
      runtimePolicy: {
        toolResultCache: { enabled: true },
      },
      trace: { emit: (event) => trace.push(event) },
      clock: createClock(Array.from({ length: 32 }, (_, index) => index)),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(upstreamReads).toBe(1);
    expect(result.traceSummary.toolCallCount).toBe(1);
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: 'runtime_policy.cache_hit',
        toolName: 'workspace_list',
      }),
    );
  });

  it('reserves synthesis budget by blocking broad enumeration at the floor', async () => {
    const trace: HarnessTraceEvent[] = [];
    let broadReads = 0;
    const steps: HarnessModelOutput[] = [
      toolRequest('list-1', 'repo_list', { path: '/repo', depth: 1 }),
      toolRequest('list-2', 'repo_list', { path: '/repo/src', depth: 1 }),
      toolRequest('list-3', 'repo_list', { path: '/repo/docs', depth: 1 }),
      toolRequest('list-4', 'repo_list', { path: '/repo/examples', depth: 1 }),
      toolRequest('list-5', 'repo_list', { path: '/repo/tests', depth: 1 }),
      { type: 'final_answer', text: 'Summarized the architecture from the existing evidence.' },
    ];

    const harness = createHarness({
      model: {
        nextStep: vi.fn(async () => steps.shift() as HarnessModelOutput),
      },
      tools: {
        listAvailable: async () => [
          {
            name: 'repo_list',
            description: 'List repository contents',
            metadata: { runtimePolicyCategories: ['broad'] },
          },
        ],
        execute: async (call) => {
          broadReads += 1;
          return {
            callId: call.id,
            toolName: call.name,
            status: 'success',
            output: `listed ${String(call.input.path)}`,
          };
        },
      },
      limits: { maxToolCalls: 7 },
      runtimePolicy: {
        reserveFloor: {
          floor: 3,
          blockedCategories: ['broad'],
        },
      },
      trace: { emit: (event) => trace.push(event) },
      clock: createClock(Array.from({ length: 48 }, (_, index) => index)),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(broadReads).toBe(4);
    expect(result.traceSummary.toolCallCount).toBe(4);
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: 'runtime_policy.blocked',
        reason: 'reserve_floor_reached',
      }),
    );
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: 'runtime_policy.synthesis_salvaged',
      }),
    );
  });

  it('enforces drill-or-stop by blocking repeated listing until a concrete path is read', async () => {
    const trace: HarnessTraceEvent[] = [];
    const executed: string[] = [];
    const steps: HarnessModelOutput[] = [
      toolRequest('list-1', 'repo_list', { path: '/repo' }),
      toolRequest('list-2', 'repo_list', { path: '/repo' }),
      toolRequest('read-1', 'repo_read', { path: 'package.json' }),
      { type: 'final_answer', text: 'The repo root includes package.json, which defines the package entrypoints.' },
    ];

    const harness = createHarness({
      model: {
        nextStep: vi.fn(async () => steps.shift() as HarnessModelOutput),
      },
      tools: {
        listAvailable: async () => [
          {
            name: 'repo_list',
            description: 'List repository contents',
            metadata: { runtimePolicyCategories: ['broad'] },
          },
          {
            name: 'repo_read',
            description: 'Read repository file',
          },
        ],
        execute: async (call) => {
          executed.push(call.id);
          if (call.name === 'repo_list') {
            return {
              callId: call.id,
              toolName: call.name,
              status: 'success',
              output: 'package.json\nsrc/index.ts',
              structuredOutput: {
                candidates: [{ path: 'package.json' }, { path: 'src/index.ts' }],
              },
            };
          }
          return {
            callId: call.id,
            toolName: call.name,
            status: 'success',
            output: '{"name":"relaycast"}',
          };
        },
      },
      runtimePolicy: {
        drillOrStop: {
          candidateProducingTools: ['repo_list'],
          broadTools: ['repo_list'],
        },
      },
      trace: { emit: (event) => trace.push(event) },
      clock: createClock(Array.from({ length: 40 }, (_, index) => index)),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(executed).toEqual(['list-1', 'read-1']);
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: 'runtime_policy.blocked',
        reason: 'drill_or_stop_required',
      }),
    );
  });

  it('sanitizes final pseudo-tool output and emits sanitizer telemetry', async () => {
    const trace: HarnessTraceEvent[] = [];
    const harness = createHarness({
      model: {
        nextStep: async () => ({
          type: 'final_answer',
          text: 'Answer first.\n<function_calls><invoke name="workspace_list"><parameter name="path">/repo</parameter></invoke></function_calls>\nAnswer last.',
          metadata: { modelId: 'openrouter/test-model' },
        }),
      },
      runtimePolicy: {
        outputSanitizer: { enabled: true },
      },
      trace: { emit: (event) => trace.push(event) },
      clock: createClock([0, 1, 2, 3, 4, 5, 6]),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(result.assistantMessage?.text).toBe('Answer first.\n\nAnswer last.');
    expect(result.assistantMessage?.text).not.toMatch(
      /<(function_calls|invoke|parameter)\b/iu,
    );
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: 'runtime_policy.output_sanitized',
        reason: 'pseudo_tool_syntax_removed',
        metadata: expect.objectContaining({
          modelId: 'openrouter/test-model',
        }),
      }),
    );
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: 'runtime_policy.synthesis_salvaged',
      }),
    );
  });
});
