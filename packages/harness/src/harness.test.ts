import { describe, expect, it, vi } from 'vitest';

import {
  createHarness,
  createToolEvidenceClarificationHook,
  HarnessConfigError,
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
      text: 'help me',
      receivedAt: '2026-04-13T12:00:00.000Z',
    },
    instructions: {
      systemPrompt: 'You are helpful.',
    },
  };
}

function createInputWithoutWorkspaceId() {
  const { workspaceId: _workspaceId, ...input } = createInput();
  return input;
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

  it('still completes when workspaceId is omitted from the turn input', async () => {
    const trace: HarnessTraceEvent[] = [];
    const harness = createHarness({
      model: {
        nextStep: async () => ({ type: 'final_answer', text: 'Done', usage: { inputTokens: 10, outputTokens: 5, costUnits: 2, latencyMs: 40 } }),
      },
      trace: { emit: (event) => trace.push(event) },
      clock: createClock([0, 5, 10, 15, 20]),
    });

    const result = await harness.runTurn(createInputWithoutWorkspaceId());

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
    expect(result.assistantMessage?.text).toBe('Done');
    expect(trace.map((event) => event.type)).toEqual([
      'turn_started',
      'model_step_started',
      'model_step_finished',
      'turn_finished',
    ]);
    expect(trace.every((event) => event.workspaceId === undefined)).toBe(true);
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

  it('passes workspaceId to approval adapters', async () => {
    const prepareRequest = vi.fn(async ({ request }) => ({
      request,
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

    await harness.runTurn(createInput());

    expect(prepareRequest).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
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

  it('asks for clarification when tool evidence shows empty results', async () => {
    const trace: HarnessTraceEvent[] = [];
    const steps: HarnessModelOutput[] = [
      { type: 'tool_request', calls: [{ id: 'call-1', name: 'search', input: { query: 'repo' } }] },
      { type: 'final_answer', text: 'should not be reached' },
    ];

    const harness = createHarness({
      model: { nextStep: vi.fn(async () => steps.shift() as HarnessModelOutput) },
      tools: {
        listAvailable: async () => [{ name: 'search', description: 'Search' }],
        execute: async () => ({
          callId: 'call-1',
          toolName: 'search',
          status: 'success',
          structuredOutput: { results: [] },
        }),
      },
      hooks: { clarifyOnToolResult: createToolEvidenceClarificationHook() },
      trace: { emit: (event) => trace.push(event) },
      clock: createClock([0, 1, 2, 3, 4, 5]),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('needs_clarification');
    expect(result.stopReason).toBe('clarification_required');
    expect(result.assistantMessage?.text).toContain('current search query');
    expect(result.continuation?.type).toBe('clarification');
    expect(result.continuation?.state.toolEvidence).toMatchObject({
      callId: 'call-1',
      toolName: 'search',
      reason: 'empty_results',
    });
    expect(result.usage.modelCalls).toBe(1);
    expect(trace.map((event) => event.type)).toContain('clarification_requested');
  });

  it('asks for clarification when tool evidence shows ambiguous identifiers', async () => {
    const harness = createHarness({
      model: {
        nextStep: async () => ({
          type: 'tool_request',
          calls: [{ id: 'call-1', name: 'issueLookup', input: { id: '123' } }],
        }),
      },
      tools: {
        listAvailable: async () => [{ name: 'issueLookup', description: 'Issue lookup' }],
        execute: async () => ({
          callId: 'call-1',
          toolName: 'issueLookup',
          status: 'success',
          structuredOutput: { ambiguous: true, candidates: [{ id: 'A-123' }, { id: 'B-123' }] },
        }),
      },
      hooks: { clarifyOnToolResult: createToolEvidenceClarificationHook() },
      clock: createClock([0, 1, 2, 3, 4]),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('needs_clarification');
    expect(result.assistantMessage?.text).toContain('Which exact identifier');
    expect(result.metadata?.clarification).toMatchObject({
      toolName: 'issueLookup',
      reason: 'ambiguous_identifier',
    });
  });

  it('asks for clarification instead of failing on transient provider tool errors', async () => {
    const onToolError = vi.fn();
    const harness = createHarness({
      model: {
        nextStep: async () => ({
          type: 'tool_request',
          calls: [{ id: 'call-1', name: 'providerSearch', input: { query: 'roadmap' } }],
        }),
      },
      tools: {
        listAvailable: async () => [{ name: 'providerSearch', description: 'Provider search' }],
        execute: async () => ({
          callId: 'call-1',
          toolName: 'providerSearch',
          status: 'error',
          error: { code: 'provider_timeout', message: 'provider timed out' },
        }),
      },
      hooks: {
        clarifyOnToolResult: createToolEvidenceClarificationHook(),
        onToolError,
      },
      clock: createClock([0, 1, 2, 3, 4]),
    });

    const result = await harness.runTurn(createInput());

    expect(onToolError).toHaveBeenCalledOnce();
    expect(result.outcome).toBe('needs_clarification');
    expect(result.stopReason).toBe('clarification_required');
    expect(result.assistantMessage?.text).toContain('transient provider error');
  });

  it('does not crash when a tool error omits error.code', async () => {
    const harness = createHarness({
      model: {
        nextStep: async () => ({
          type: 'tool_request',
          calls: [{ id: 'call-1', name: 'providerSearch', input: { query: 'roadmap' } }],
        }),
      },
      tools: {
        listAvailable: async () => [{ name: 'providerSearch', description: 'Provider search' }],
        execute: async () => ({
          callId: 'call-1',
          toolName: 'providerSearch',
          status: 'error',
          error: { code: undefined as unknown as string, message: 'provider timed out' },
        }),
      },
      hooks: { clarifyOnToolResult: createToolEvidenceClarificationHook() },
      clock: createClock([0, 1, 2, 3, 4]),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('failed');
    expect(result.stopReason).toBe('tool_error_unrecoverable');
  });

  it('does not ask for clarification on successful tools with blank output and no empty-result evidence', async () => {
    const steps: HarnessModelOutput[] = [
      { type: 'tool_request', calls: [{ id: 'call-1', name: 'lookup', input: {} }] },
      { type: 'final_answer', text: 'Completed without clarification' },
    ];

    const harness = createHarness({
      model: { nextStep: async () => steps.shift() as HarnessModelOutput },
      tools: {
        listAvailable: async () => [{ name: 'lookup', description: 'Lookup' }],
        execute: async () => ({
          callId: 'call-1',
          toolName: 'lookup',
          status: 'success',
          output: '   ',
        }),
      },
      hooks: { clarifyOnToolResult: createToolEvidenceClarificationHook() },
      clock: createClock([0, 1, 2, 3, 4, 5]),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
    expect(result.assistantMessage?.text).toBe('Completed without clarification');
  });

  it('prefers limit enforcement over clarification when the tool call budget is exhausted', async () => {
    const harness = createHarness({
      model: {
        nextStep: async () => ({
          type: 'tool_request',
          calls: [{ id: 'call-1', name: 'search', input: { query: 'repo' } }],
        }),
      },
      tools: {
        listAvailable: async () => [{ name: 'search', description: 'Search' }],
        execute: async () => ({
          callId: 'call-1',
          toolName: 'search',
          status: 'success',
          structuredOutput: { results: [] },
        }),
      },
      hooks: { clarifyOnToolResult: createToolEvidenceClarificationHook() },
      limits: { maxToolCalls: 1 },
      clock: createClock([0, 1, 2, 3, 4]),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('deferred');
    expect(result.stopReason).toBe('max_tool_calls_reached');
  });

  it('ignores malformed clarification hook payloads', async () => {
    const steps: HarnessModelOutput[] = [
      { type: 'tool_request', calls: [{ id: 'call-1', name: 'lookup', input: {} }] },
      { type: 'final_answer', text: 'Completed without clarification' },
    ];

    const harness = createHarness({
      model: { nextStep: async () => steps.shift() as HarnessModelOutput },
      tools: {
        listAvailable: async () => [{ name: 'lookup', description: 'Lookup' }],
        execute: async () => ({
          callId: 'call-1',
          toolName: 'lookup',
          status: 'success',
          structuredOutput: { results: [] },
        }),
      },
      hooks: {
        clarifyOnToolResult: async () => ({ question: 42 as unknown as string, reason: 'custom' }),
      },
      clock: createClock([0, 1, 2, 3, 4, 5]),
    });

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
    expect(result.assistantMessage?.text).toBe('Completed without clarification');
  });

  it('retries once after invalid model output then succeeds', async () => {
    const onInvalidModelOutput = vi.fn();
    const steps: HarnessModelOutput[] = [
      {
        type: 'invalid',
        kind: 'schema_mismatch',
        reason: 'bad schema',
        raw: { foo: 'bar' },
        httpStatus: 422,
      },
      { type: 'final_answer', text: 'Recovered' },
    ];

    const harness = createHarness({
      model: { nextStep: async () => steps.shift() as HarnessModelOutput },
      hooks: { onInvalidModelOutput },
      clock: createClock([0, 1, 2, 3, 4, 5]),
    });

    const result = await harness.runTurn(createInput());
    expect(onInvalidModelOutput).toHaveBeenCalledOnce();
    expect(onInvalidModelOutput.mock.calls[0][0]).toMatchObject({
      type: 'invalid',
      kind: 'schema_mismatch',
      reason: 'bad schema',
      httpStatus: 422,
    });
    expect(result.outcome).toBe('completed');
    expect(result.traceSummary.iterationCount).toBe(2);
  });

  it('passes workspaceId through model, tool, hook, and trace inputs', async () => {
    const trace: HarnessTraceEvent[] = [];
    const listAvailable = vi.fn(async () => [{ name: 'lookup', description: 'Lookup' }]);
    const execute = vi.fn(async (call) => ({
      callId: call.id,
      toolName: call.name,
      status: 'success' as const,
      output: 'ok',
    }));
    const onTurnFinished = vi.fn();
    const steps: HarnessModelOutput[] = [
      { type: 'tool_request', calls: [{ id: 'call-1', name: 'lookup', input: {} }] },
      { type: 'final_answer', text: 'Done' },
    ];
    const nextStep = vi.fn(async (input) => steps.shift() ?? ({ type: 'final_answer', text: 'Done' } as const));

    const harness = createHarness({
      model: { nextStep },
      tools: { listAvailable, execute },
      hooks: { onTurnFinished },
      trace: { emit: (event) => trace.push(event) },
      clock: createClock([0, 1, 2, 3, 4, 5, 6]),
    });

    await harness.runTurn(createInput());
    const [, state] = onTurnFinished.mock.calls[0];

    expect(listAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
    expect(nextStep).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
    expect(state.workspaceId).toBe('workspace-1');
    expect(trace.every((event) => event.workspaceId === 'workspace-1')).toBe(true);
  });

  it('succeeds with workspaceId="ws-123" and exposes it through observable hook state', async () => {
    const onTurnFinished = vi.fn();
    const nextStep = vi.fn(async () => ({ type: 'final_answer' as const, text: 'Done' }));
    const harness = createHarness({
      model: { nextStep },
      hooks: { onTurnFinished },
      clock: createClock([0, 1, 2, 3]),
    });

    const result = await harness.runTurn({
      ...createInput(),
      workspaceId: 'ws-123',
    });
    const [, state] = onTurnFinished.mock.calls[0];

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
    expect(nextStep).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-123' }),
    );
    expect(state.workspaceId).toBe('ws-123');
  });

  it('preserves the exact no-tools transcript when workspaceId is omitted', async () => {
    const onTurnFinished = vi.fn();
    const harness = createHarness({
      model: {
        nextStep: async () => ({ type: 'final_answer', text: 'Done' }),
      },
      hooks: { onTurnFinished },
      clock: createClock([0, 1, 2, 3]),
    });

    const result = await harness.runTurn(createInputWithoutWorkspaceId());
    const [, state] = onTurnFinished.mock.calls[0];

    expect(result.outcome).toBe('completed');
    expect(state.transcript).toEqual([
      {
        type: 'assistant_step',
        iteration: 1,
        outputType: 'final_answer',
        text: 'Done',
        metadata: undefined,
      },
    ]);
  });

  it('fails after exceeding invalid model output limit', async () => {
    const harness = createHarness({
      model: { nextStep: async () => ({ type: 'invalid', kind: 'empty_response', reason: 'still bad' }) },
      limits: { maxConsecutiveInvalidModelOutputs: 2 },
      clock: createClock([0, 1, 2, 3, 4, 5, 6]),
    });

    const result = await harness.runTurn(createInput());
    expect(result.outcome).toBe('failed');
    expect(result.stopReason).toBe('model_invalid_response');
    expect(result.metadata?.reason).toBe('still bad');
    expect(result.metadata?.kind).toBe('empty_response');
  });

  describe('onTurnFinished hook', () => {
    it('fires once with completed result usage after a final answer', async () => {
      const nextStep = vi.fn(async () => ({ type: 'final_answer' as const, text: 'Done' }));
      const onTurnFinished = vi.fn();

      const harness = createHarness({
        model: { nextStep },
        hooks: { onTurnFinished },
        clock: createClock([0, 1, 2, 3]),
      });

      const result = await harness.runTurn(createInput());
      const [hookResult] = onTurnFinished.mock.calls[0];

      expect(result.outcome).toBe('completed');
      expect(onTurnFinished).toHaveBeenCalledOnce();
      expect(hookResult.outcome).toBe('completed');
      expect(hookResult.usage.modelCalls).toBe(nextStep.mock.calls.length);
    });

    it('fires once with failed result after invalid model output', async () => {
      const onTurnFinished = vi.fn();

      const harness = createHarness({
        model: { nextStep: async () => ({ type: 'invalid', reason: 'still bad' }) },
        limits: { maxConsecutiveInvalidModelOutputs: 1 },
        hooks: { onTurnFinished },
        clock: createClock([0, 1, 2, 3]),
      });

      const result = await harness.runTurn(createInput());
      const [hookResult] = onTurnFinished.mock.calls[0];

      expect(result.outcome).toBe('failed');
      expect(result.stopReason).toBe('model_invalid_response');
      expect(onTurnFinished).toHaveBeenCalledOnce();
      expect(hookResult.outcome).toBe('failed');
    });

    it('passes the full execution state (input, transcript, modelCalls) to the hook', async () => {
      const onTurnFinished = vi.fn();

      const harness = createHarness({
        model: {
          nextStep: async () => ({
            type: 'final_answer',
            text: 'Done',
            metadata: { modelId: 'anthropic/claude-sonnet-4-6' },
            usage: { inputTokens: 12, outputTokens: 6 },
          }),
        },
        hooks: { onTurnFinished },
        clock: createClock([0, 1, 2, 3]),
      });

      await harness.runTurn(createInput());
      const [, state] = onTurnFinished.mock.calls[0];

      expect(state.input?.message?.text).toBe('help me');
      expect(state.input?.instructions?.systemPrompt).toBe('You are helpful.');
      expect(state.transcript).toHaveLength(1);
      expect(state.transcript?.[0]).toMatchObject({
        type: 'assistant_step',
        outputType: 'final_answer',
      });
      expect(state.modelCalls).toEqual([
        {
          iteration: 1,
          outputType: 'final_answer',
          modelId: 'anthropic/claude-sonnet-4-6',
          usage: { inputTokens: 12, outputTokens: 6 },
        },
      ]);
      expect(state.workspaceId).toBe('workspace-1');
      expect(state.userId).toBe('user-1');
      expect(state.threadId).toBe('thread-1');
    });

    it('does not propagate errors thrown by the hook', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const onTurnFinished = vi.fn(() => {
        throw new Error('hook exploded');
      });

      const harness = createHarness({
        model: { nextStep: async () => ({ type: 'final_answer', text: 'Done' }) },
        hooks: { onTurnFinished },
        clock: createClock([0, 1, 2, 3]),
      });

      try {
        const result = await harness.runTurn(createInput());

        expect(result.outcome).toBe('completed');
        expect(result.stopReason).toBe('answer_finalized');
        expect(onTurnFinished).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledOnce();
      } finally {
        errorSpy.mockRestore();
      }
    });
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
