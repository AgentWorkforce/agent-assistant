import { describe, expect, it, vi } from 'vitest';

import { createIdempotencyGuard } from './idempotency-guard.js';
import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolExecutionContext,
  HarnessToolRegistry,
  HarnessToolResult,
} from './types.js';

function makeCall(
  id: string,
  input: Record<string, unknown> = { q: 'a' },
  name = 'workspace_search',
): HarnessToolCall {
  return { id, name, input };
}

function makeContext(
  turnId: string,
  overrides: Partial<HarnessToolExecutionContext> = {},
): HarnessToolExecutionContext {
  return {
    assistantId: 'assistant-1',
    turnId,
    iteration: 0,
    toolCallIndex: 0,
    ...overrides,
  };
}

function makeAvailabilityInput(
  overrides: Partial<HarnessToolAvailabilityInput> = {},
): HarnessToolAvailabilityInput {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    ...overrides,
  };
}

function makeResult(
  call: HarnessToolCall,
  overrides: Partial<HarnessToolResult> = {},
): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output: 'search-results',
    ...overrides,
  };
}

function makeInnerRegistry(args?: {
  executeImpl?: HarnessToolRegistry['execute'];
  tools?: HarnessToolDefinition[];
}) {
  const tools =
    args?.tools ??
    [
      {
        name: 'workspace_search',
        description: 'Search the workspace.',
      },
    ];
  const execute =
    args?.executeImpl ??
    vi.fn(async (call: HarnessToolCall) => makeResult(call, { output: `output-for-${call.id}` }));
  const listAvailable = vi.fn(async () => tools);

  return {
    listAvailable,
    execute: vi.fn(execute),
  } satisfies HarnessToolRegistry & {
    listAvailable: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
}

describe('createIdempotencyGuard', () => {
  it('passes the first call through unchanged', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const expected = makeResult(call, { output: 'first-pass' });
    const inner = makeInnerRegistry({
      executeImpl: vi.fn(async () => expected),
    });

    const guard = createIdempotencyGuard(inner);
    const result = await guard.execute(call, context);

    expect(result).toEqual(expected);
    expect(inner.execute).toHaveBeenCalledTimes(1);
    expect(inner.execute).toHaveBeenCalledWith(call, context);
  });

  it('blocks a second identical call within the same turn', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);

    const first = await guard.execute(call, context);
    const second = await guard.execute(call, context);

    expect(first.status).toBe('success');
    expect(second.status).toBe('error');
    expect(second.error?.code).toBe('redundant_call_blocked');
    expect(second.error?.retryable).toBe(false);
    expect(inner.execute).toHaveBeenCalledTimes(1);
  });

  it('does not block identical calls across different turn ids', async () => {
    const call = makeCall('call-1');
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);

    const first = await guard.execute(call, makeContext('turn-1'));
    const second = await guard.execute(call, makeContext('turn-2'));

    expect(first.status).toBe('success');
    expect(second.status).toBe('success');
    expect(inner.execute).toHaveBeenCalledTimes(2);
  });

  it('does not block calls with different inputs in the same turn', async () => {
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);
    const context = makeContext('turn-1');

    const first = await guard.execute(makeCall('call-1', { q: 'a' }), context);
    const second = await guard.execute(makeCall('call-2', { q: 'b' }), context);

    expect(first.status).toBe('success');
    expect(second.status).toBe('success');
    expect(inner.execute).toHaveBeenCalledTimes(2);
  });

  it('treats objects with different key order as the same signature', async () => {
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);
    const context = makeContext('turn-1');

    const first = await guard.execute(makeCall('call-1', { a: 1, b: 2 }), context);
    const second = await guard.execute(makeCall('call-2', { b: 2, a: 1 }), context);

    expect(first.status).toBe('success');
    expect(second.status).toBe('error');
    expect(second.error?.code).toBe('redundant_call_blocked');
    expect(inner.execute).toHaveBeenCalledTimes(1);
  });

  it('passes listAvailable through unchanged', async () => {
    const tools = [
      { name: 'workspace_search', description: 'Search the workspace.' },
      { name: 'memory_recall', description: 'Recall memory.' },
    ];
    const inner = makeInnerRegistry({ tools });
    const guard = createIdempotencyGuard(inner);
    const input = makeAvailabilityInput({ allowedToolNames: ['workspace_search'] });

    const result = await guard.listAvailable(input);

    expect(result).toEqual(tools);
    expect(inner.listAvailable).toHaveBeenCalledTimes(1);
    expect(inner.listAvailable).toHaveBeenCalledWith(input);
  });

  it('includes alternativesFor output in the blocked error message', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const inner = makeInnerRegistry();
    const alternativesFor = vi.fn(() => ['try X', 'try Y']);
    const guard = createIdempotencyGuard(inner, { alternativesFor });

    await guard.execute(call, context);
    const result = await guard.execute(call, context);

    expect(alternativesFor).toHaveBeenCalledTimes(1);
    expect(alternativesFor).toHaveBeenCalledWith(call);
    expect(result.error?.message).toContain('try X');
    expect(result.error?.message).toContain('try Y');
  });

  it('uses the default fallback line when alternativesFor is missing or empty', async () => {
    const defaultTip =
      'Drill into a specific result from the previous output (cite a path or id) instead of re-searching.';
    const call = makeCall('call-1');
    const context = makeContext('turn-1');

    const guardWithoutHook = createIdempotencyGuard(makeInnerRegistry());
    await guardWithoutHook.execute(call, context);
    const withoutHook = await guardWithoutHook.execute(call, context);

    const emptyHook = createIdempotencyGuard(makeInnerRegistry(), {
      alternativesFor: () => ['   ', ''],
    });
    await emptyHook.execute(call, context);
    const emptyAlternatives = await emptyHook.execute(call, context);

    expect(withoutHook.error?.message).toContain(defaultTip);
    expect(emptyAlternatives.error?.message).toContain(defaultTip);
  });

  it('evicts the oldest turn when maxTurns is exceeded', async () => {
    const call = makeCall('call-1');
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner, { maxTurns: 2 });

    await guard.execute(call, makeContext('turn-1'));
    await guard.execute(call, makeContext('turn-2'));
    await guard.execute(call, makeContext('turn-3'));
    const replayedTurnOne = await guard.execute(call, makeContext('turn-1'));

    expect(replayedTurnOne.status).toBe('success');
    expect(inner.execute).toHaveBeenCalledTimes(4);
  });

  it('propagates inner exceptions and does not cache a failed attempt', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const error = new Error('boom');
    const retryResult = makeResult(call, { output: 'retry-ok' });
    const execute = vi
      .fn<HarnessToolRegistry['execute']>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(retryResult);
    const inner = makeInnerRegistry({ executeImpl: execute });
    const guard = createIdempotencyGuard(inner);

    await expect(guard.execute(call, context)).rejects.toBe(error);
    const retry = await guard.execute(call, context);

    expect(retry).toEqual(retryResult);
    expect(inner.execute).toHaveBeenCalledTimes(2);
  });

  it('reports the original per-turn iteration number in duplicate errors', async () => {
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);
    const context = makeContext('turn-1');
    const firstCall = makeCall('call-1', { q: 'a' });
    const secondCall = makeCall('call-2', { q: 'b' });

    await guard.execute(firstCall, context);
    await guard.execute(secondCall, context);

    const duplicateFirst = await guard.execute(makeCall('call-3', { q: 'a' }), context);
    const duplicateSecond = await guard.execute(makeCall('call-4', { q: 'b' }), context);

    expect(duplicateFirst.error?.message).toContain('iteration 1');
    expect(duplicateSecond.error?.message).toContain('iteration 2');
  });
});
