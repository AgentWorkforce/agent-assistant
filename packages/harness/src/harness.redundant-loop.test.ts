import { describe, expect, it, vi } from 'vitest';

import { createHarness, type HarnessModelOutput, type HarnessToolResult } from './index.js';

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

function createClock(times: number[]) {
  let index = 0;
  return {
    now: () => times[Math.min(index++, times.length - 1)] ?? 0,
    nowIso: () => new Date(times[Math.min(index, times.length - 1)] ?? 0).toISOString(),
  };
}

function createToolRequest(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): HarnessModelOutput {
  return {
    type: 'tool_request',
    calls: [{ id, name, input }],
  };
}

function createHarnessForResults(results: HarnessToolResult[], finalAnswer = 'Done') {
  const toolNames = [...new Set(results.map((result) => result.toolName))];
  const steps: HarnessModelOutput[] = results.map((result) =>
    createToolRequest(result.callId, result.toolName, { query: `input-for-${result.callId}` }),
  );
  steps.push({ type: 'final_answer', text: finalAnswer });

  let resultIndex = 0;

  return createHarness({
    model: {
      nextStep: vi.fn(async () => steps.shift() as HarnessModelOutput),
    },
    tools: {
      listAvailable: async () => toolNames.map((name) => ({ name, description: `${name} tool` })),
      execute: async () => results[resultIndex++] as HarnessToolResult,
    },
    clock: createClock(Array.from({ length: 32 }, (_, index) => index)),
  });
}

describe('createHarness redundant tool loop detection', () => {
  it('fails with redundant_tool_loop after 3 identical outputs from the same tool', async () => {
    const harness = createHarnessForResults([
      { callId: 'call-1', toolName: 'lookup', status: 'success', output: 'same-result' },
      { callId: 'call-2', toolName: 'lookup', status: 'success', output: 'same-result' },
      { callId: 'call-3', toolName: 'lookup', status: 'success', output: 'same-result' },
    ]);

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('failed');
    expect(result.stopReason).toBe('redundant_tool_loop');
  });

  it('does not fire when the same tool returns different outputs', async () => {
    const harness = createHarnessForResults([
      { callId: 'call-1', toolName: 'lookup', status: 'success', output: 'result-a' },
      { callId: 'call-2', toolName: 'lookup', status: 'success', output: 'result-b' },
      { callId: 'call-3', toolName: 'lookup', status: 'success', output: 'result-c' },
    ]);

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
    expect(result.assistantMessage?.text).toBe('Done');
  });

  it('does not fire when identical outputs come from different tools', async () => {
    const harness = createHarnessForResults([
      { callId: 'call-1', toolName: 'lookup', status: 'success', output: 'shared' },
      { callId: 'call-2', toolName: 'lookup', status: 'success', output: 'shared' },
      { callId: 'call-3', toolName: 'search', status: 'success', output: 'shared' },
      { callId: 'call-4', toolName: 'search', status: 'success', output: 'shared' },
    ]);

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
  });

  it('does not fire when a different output breaks the repeated run', async () => {
    const harness = createHarnessForResults([
      { callId: 'call-1', toolName: 'lookup', status: 'success', output: 'X' },
      { callId: 'call-2', toolName: 'lookup', status: 'success', output: 'X' },
      { callId: 'call-3', toolName: 'lookup', status: 'success', output: 'Y' },
      { callId: 'call-4', toolName: 'lookup', status: 'success', output: 'X' },
      { callId: 'call-5', toolName: 'lookup', status: 'success', output: 'X' },
    ]);

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
  });

  it('fires even when identical outputs came from different inputs', async () => {
    const steps: HarnessModelOutput[] = [
      createToolRequest('call-1', 'lookup', { query: 'alpha' }),
      createToolRequest('call-2', 'lookup', { query: 'beta' }),
      createToolRequest('call-3', 'lookup', { query: 'gamma' }),
      { type: 'final_answer', text: 'Done' },
    ];
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        callId: 'call-1',
        toolName: 'lookup',
        status: 'success',
        output: 'same-result',
      } satisfies HarnessToolResult)
      .mockResolvedValueOnce({
        callId: 'call-2',
        toolName: 'lookup',
        status: 'success',
        output: 'same-result',
      } satisfies HarnessToolResult)
      .mockResolvedValueOnce({
        callId: 'call-3',
        toolName: 'lookup',
        status: 'success',
        output: 'same-result',
      } satisfies HarnessToolResult);

    const harness = createHarness({
      model: {
        nextStep: vi.fn(async () => steps.shift() as HarnessModelOutput),
      },
      tools: {
        listAvailable: async () => [{ name: 'lookup', description: 'lookup tool' }],
        execute,
      },
      clock: createClock(Array.from({ length: 16 }, (_, index) => index)),
    });

    const result = await harness.runTurn(createInput());

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ input: { query: 'alpha' } }),
      expect.anything(),
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ input: { query: 'beta' } }),
      expect.anything(),
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ input: { query: 'gamma' } }),
      expect.anything(),
    );
    expect(result.outcome).toBe('failed');
    expect(result.stopReason).toBe('redundant_tool_loop');
  });

  it('ignores tool errors when counting a later 3-success redundant loop', async () => {
    const harness = createHarnessForResults([
      {
        callId: 'call-1',
        toolName: 'lookup',
        status: 'error',
        error: { code: 'temporary', message: 'retry me', retryable: true },
      },
      { callId: 'call-2', toolName: 'lookup', status: 'success', output: 'same-result' },
      { callId: 'call-3', toolName: 'lookup', status: 'success', output: 'same-result' },
      { callId: 'call-4', toolName: 'lookup', status: 'success', output: 'same-result' },
    ]);

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('failed');
    expect(result.stopReason).toBe('redundant_tool_loop');
  });

  it('treats an error between successes as breaking consecutiveness', async () => {
    const harness = createHarnessForResults([
      { callId: 'call-1', toolName: 'lookup', status: 'success', output: 'same-result' },
      {
        callId: 'call-2',
        toolName: 'lookup',
        status: 'error',
        error: { code: 'temporary', message: 'retry me', retryable: true },
      },
      { callId: 'call-3', toolName: 'lookup', status: 'success', output: 'same-result' },
      { callId: 'call-4', toolName: 'lookup', status: 'success', output: 'same-result' },
    ]);

    const result = await harness.runTurn(createInput());

    expect(result.outcome).toBe('completed');
    expect(result.stopReason).toBe('answer_finalized');
  });
});
