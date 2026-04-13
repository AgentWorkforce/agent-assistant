import { describe, expect, it, vi } from 'vitest';

import { createHarness, HarnessConfigError, type HarnessModelOutput, type HarnessTraceEvent } from './index.js';

function createInput() {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    sessionId: 'session-1',
    userId: 'user-1',
    threadId: 'thread-1',
    message: {
      id: 'msg-1',
      text: 'help me',
      receivedAt: '2026-04-13T12:00:00.000Z',
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

describe('createHarness', () => {
  it('rejects invalid config', () => {
    expect(() => createHarness({} as never)).toThrow(HarnessConfigError);
    expect(() =>
      createHarness({
        model: { nextStep: async () => ({ type: 'final_answer', text: 'ok' }) },
        limits: { maxIterations: 0 },
      }),
    ).toThrow('limits.maxIterations');
  });
});

describe('harness runtime', () => {
  it('completes with a final answer', async () => {
    const trace: HarnessTraceEvent[] = [];
    const harness = createHarness({
      model: {
        nextStep: async () => ({ type: 'final_answer', text: 'Done', usage: { inputTokens: 10, outputTokens: 5, costUnits: 2, latencyMs: 40 } }),
      },
      trace: { emit: (event) => trace.push(event) },
      clock: createClock([0, 5, 10, 15, 20]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
    expect(result.assistantMessage?.text).toBe('Done');
    expect(result.usage).toMatchObject({ totalInputTokens: 10, totalOutputTokens: 5, totalCostUnits: 2, totalLatencyMs: 40, modelCalls: 1, toolCalls: 0 });
    expect(trace.map((event) => event.type)).toEqual([
      'turn_started',
      'model_step_started',
      'model_step_finished',
      'turn_finished',
    ]);
  });

  it('handles iterative tool/model/tool loop sequentially', async () => {
    const executeOrder: string[] = [];
    const outputs: HarnessModelOutput[] = [
      {
        type: 'tool_request',
        calls: [
          { id: 'call-1', name: 'lookup', input: { q: 'a' } },
          { id: 'call-2', name: 'lookup', input: { q: 'b' } },
        ],
      },
      {
        type: 'final_answer',
        text: 'Combined answer',
      },
    ];

    const harness = createHarness({
      model: {
        nextStep: vi.fn(async (input) => {
          if (input.iteration === 2) {
            expect(input.transcript.filter((item) => item.type === 'tool_result')).toHaveLength(2);
          }
          return outputs.shift() as HarnessModelOutput;
        }),
      },
      tools: {
        listAvailable: async () => [{ name: 'lookup', description: 'Lookup' }],
        execute: async (call) => {
          executeOrder.push(call.id);
          return { callId: call.id, toolName: call.name, status: 'success', output: `result:${call.id}` };
        },
      },
      clock: createClock([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('completed');
    expect(result.usage.toolCalls).toBe(2);
    expect(executeOrder).toEqual(['call-1', 'call-2']);
    expect(result.traceSummary.iterationCount).toBe(2);
  });

  it('returns clarification with continuation', async () => {
    const harness = createHarness({
      model: {
        nextStep: async () => ({ type: 'clarification', question: 'Which workspace?' }),
      },
      clock: createClock([0, 1, 2, 3, 4]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('needs_clarification');
    expect(result.stopReason).toBe('clarification_required');
    expect(result.assistantMessage?.text).toBe('Which workspace?');
    expect(result.continuation?.type).toBe('clarification');
    expect(result.continuation?.state.question).toBe('Which workspace?');
  });

  it('uses approval adapter as a seam, not policy owner', async () => {
    const prepareRequest = vi.fn(async ({ request }) => ({
      request: { ...request, metadata: { prepared: true } },
      continuation: {
        id: 'approval-cont',
        type: 'approval' as const,
        createdAt: '2026-04-13T00:00:00.000Z',
        turnId: 'turn-1',
        sessionId: 'session-1',
        resumeToken: 'resume-1',
        state: { requestId: request.id },
      },
    }));

    const harness = createHarness({
      model: {
        nextStep: async () => ({
          type: 'approval_request',
          request: { id: 'approve-1', kind: 'external_action', summary: 'Send email' },
        }),
      },
      approvals: { prepareRequest },
      clock: createClock([0, 1, 2, 3]),
    });

    const result = await harness.runTurn(createInput());
    expect(prepareRequest).toHaveBeenCalledOnce();
    expect(result.outcome).toBe('awaiting_approval');
    expect(result.stopReason).toBe('approval_required');
    expect(result.continuation?.id).toBe('approval-cont');
  });

  it('fails when a requested tool is unavailable', async () => {
    const harness = createHarness({
      model: {
        nextStep: async () => ({
          type: 'tool_request',
          calls: [{ id: 'call-1', name: 'missing', input: {} }],
        }),
      },
      tools: {
        listAvailable: async () => [{ name: 'lookup', description: 'Lookup' }],
        execute: async () => ({ callId: 'call-1', toolName: 'lookup', status: 'success' }),
      },
      clock: createClock([0, 1, 2, 3]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('failed');
    expect(result.stopReason).toBe('tool_unavailable');
  });

  it('continues after retryable tool error and lets the model recover', async () => {
    const onToolError = vi.fn();
    const steps: HarnessModelOutput[] = [
      { type: 'tool_request', calls: [{ id: 'call-1', name: 'lookup', input: {} }] },
      { type: 'final_answer', text: 'Recovered after tool error' },
    ];

    const harness = createHarness({
      model: { nextStep: async () => steps.shift() as HarnessModelOutput },
      tools: {
        listAvailable: async () => [{ name: 'lookup', description: 'Lookup' }],
        execute: async () => ({
          callId: 'call-1',
          toolName: 'lookup',
          status: 'error',
          error: { code: 'temporary', message: 'retry me', retryable: true },
        }),
      },
      hooks: { onToolError },
      clock: createClock([0, 1, 2, 3, 4, 5]),
    });

    const result = await harness.runTurn(createInput());
    expect(onToolError).toHaveBeenCalledOnce();
    expect(result.outcome).toBe('completed');
    expect(result.assistantMessage?.text).toContain('Recovered');
  });

  it('fails on unrecoverable tool error', async () => {
    const harness = createHarness({
      model: { nextStep: async () => ({ type: 'tool_request', calls: [{ id: 'call-1', name: 'lookup', input: {} }] }) },
      tools: {
        listAvailable: async () => [{ name: 'lookup', description: 'Lookup' }],
        execute: async () => ({
          callId: 'call-1',
          toolName: 'lookup',
          status: 'error',
          error: { code: 'fatal', message: 'nope' },
        }),
      },
      clock: createClock([0, 1, 2, 3]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('failed');
    expect(result.stopReason).toBe('tool_error_unrecoverable');
  });

  it('retries once after invalid model output then succeeds', async () => {
    const onInvalidModelOutput = vi.fn();
    const steps: HarnessModelOutput[] = [
      { type: 'invalid', reason: 'bad schema', raw: { foo: 'bar' } },
      { type: 'final_answer', text: 'Recovered' },
    ];

    const harness = createHarness({
      model: { nextStep: async () => steps.shift() as HarnessModelOutput },
      hooks: { onInvalidModelOutput },
      clock: createClock([0, 1, 2, 3, 4, 5]),
    });

    const result = await harness.runTurn(createInput());
    expect(onInvalidModelOutput).toHaveBeenCalledOnce();
    expect(result.outcome).toBe('completed');
    expect(result.traceSummary.iterationCount).toBe(2);
  });

  it('fails after exceeding invalid model output limit', async () => {
    const harness = createHarness({
      model: { nextStep: async () => ({ type: 'invalid', reason: 'still bad' }) },
      limits: { maxConsecutiveInvalidModelOutputs: 2 },
      clock: createClock([0, 1, 2, 3, 4, 5, 6]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('failed');
    expect(result.stopReason).toBe('model_invalid_response');
  });

  it('defers when max iterations is reached', async () => {
    const harness = createHarness({
      model: { nextStep: async () => ({ type: 'invalid', reason: 'keep going' }) },
      limits: { maxIterations: 1, maxConsecutiveInvalidModelOutputs: 5 },
      clock: createClock([0, 1, 2, 3, 4, 5]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('deferred');
    expect(result.stopReason).toBe('max_iterations_reached');
    expect(result.continuation?.type).toBe('deferred');
  });

  it('defers when budget is reached', async () => {
    const harness = createHarness({
      model: {
        nextStep: async () => ({
          type: 'final_answer',
          text: 'expensive',
          usage: { costUnits: 5 },
        }),
      },
      limits: { budgetLimit: 4 },
      clock: createClock([0, 1, 2, 3]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
  });

  it('defers before next model call when budget has been exhausted by prior work', async () => {
    const steps: HarnessModelOutput[] = [
      {
        type: 'tool_request',
        calls: [{ id: 'call-1', name: 'lookup', input: {} }],
        usage: { costUnits: 3 },
      },
      {
        type: 'final_answer',
        text: 'should never reach',
      },
    ];

    const harness = createHarness({
      model: { nextStep: async () => steps.shift() as HarnessModelOutput },
      tools: {
        listAvailable: async () => [{ name: 'lookup', description: 'Lookup' }],
        execute: async () => ({ callId: 'call-1', toolName: 'lookup', status: 'success', usage: { costUnits: 2 } }),
      },
      limits: { budgetLimit: 4 },
      clock: createClock([0, 1, 2, 3, 4, 5]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('deferred');
    expect(result.stopReason).toBe('budget_reached');
  });

  it('surfaces runtime adapter exceptions truthfully', async () => {
    const harness = createHarness({
      model: { nextStep: async () => { throw new Error('adapter exploded'); } },
      clock: createClock([0, 1, 2]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('failed');
    expect(result.stopReason).toBe('runtime_error');
    expect(result.metadata?.errorMessage).toBe('adapter exploded');
  });
});
