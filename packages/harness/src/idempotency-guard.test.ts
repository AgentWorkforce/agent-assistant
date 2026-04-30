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

  it('blocks a second identical call within the same turn as a successful tool result', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);

    const first = await guard.execute(call, context);
    const second = await guard.execute(call, context);

    // The blocked duplicate is reported as a successful tool result so
    // the harness keeps the turn alive — otherwise a `retryable !==
    // true` tool error gets classified as `tool_error_unrecoverable`
    // and the model never sees the alternatives. Integration-test gap:
    // we don't run the full harness loop here; `harness.tool-retry.test.ts`
    // exercises the classifier path separately.
    expect(first.status).toBe('success');
    expect(second.status).toBe('success');
    expect(second.error).toBeUndefined();
    expect(second.output).toContain('was already called this turn at iteration 1');
    expect(second.output).toContain("Repeating the same call won't return new information");
    expect(second.metadata?.idempotencyGuard).toMatchObject({
      blocked: true,
      code: 'redundant_call_blocked',
      tier: 1,
      duplicateCount: 1,
      previousIteration: 1,
    });
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
    expect(second.status).toBe('success');
    expect(second.metadata?.idempotencyGuard).toMatchObject({ blocked: true });
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

  it('includes alternativesFor output in the blocked tool result body', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const inner = makeInnerRegistry();
    const alternativesFor = vi.fn(() => ['try X', 'try Y']);
    const guard = createIdempotencyGuard(inner, { alternativesFor });

    await guard.execute(call, context);
    const result = await guard.execute(call, context);

    expect(alternativesFor).toHaveBeenCalledTimes(1);
    expect(alternativesFor).toHaveBeenCalledWith(call);
    expect(result.status).toBe('success');
    expect(result.output).toContain('try X');
    expect(result.output).toContain('try Y');
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

    expect(withoutHook.output).toContain(defaultTip);
    expect(emptyAlternatives.output).toContain(defaultTip);
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

  it('does not cache a retryable error result, so retry attempts reach the inner tool', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const errorResult: HarnessToolResult = {
      callId: call.id,
      toolName: call.name,
      status: 'error',
      error: {
        code: 'transient',
        message: 'transient failure',
        retryable: true,
      },
    };
    const successResult = makeResult(call, { output: 'recovered-output' });
    const execute = vi
      .fn<HarnessToolRegistry['execute']>()
      .mockResolvedValueOnce(errorResult)
      .mockResolvedValueOnce(successResult);
    const inner = makeInnerRegistry({ executeImpl: execute });
    const guard = createIdempotencyGuard(inner);

    const first = await guard.execute(call, context);
    const second = await guard.execute(call, context);

    expect(first).toEqual(errorResult);
    // Without the success-only cache rule, the second call would hit the
    // guard's cache and return a fake "duplicate call" success — silently
    // exiting executeToolWithRetry without ever re-invoking the tool.
    expect(second).toEqual(successResult);
    expect(second.metadata?.idempotencyGuard).toBeUndefined();
    expect(inner.execute).toHaveBeenCalledTimes(2);
  });

  it('does not cache a non-retryable error result either', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const errorResult: HarnessToolResult = {
      callId: call.id,
      toolName: call.name,
      status: 'error',
      error: {
        code: 'permanent',
        message: 'permanent failure',
        retryable: false,
      },
    };
    const successResult = makeResult(call, { output: 'recovered-output' });
    const execute = vi
      .fn<HarnessToolRegistry['execute']>()
      .mockResolvedValueOnce(errorResult)
      .mockResolvedValueOnce(successResult);
    const inner = makeInnerRegistry({ executeImpl: execute });
    const guard = createIdempotencyGuard(inner);

    const first = await guard.execute(call, context);
    const second = await guard.execute(call, context);

    expect(first).toEqual(errorResult);
    expect(second).toEqual(successResult);
    expect(second.metadata?.idempotencyGuard).toBeUndefined();
    expect(inner.execute).toHaveBeenCalledTimes(2);
  });

  it('reports the original per-turn iteration number in duplicate results', async () => {
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);
    const context = makeContext('turn-1');
    const firstCall = makeCall('call-1', { q: 'a' });
    const secondCall = makeCall('call-2', { q: 'b' });

    await guard.execute(firstCall, context);
    await guard.execute(secondCall, context);

    const duplicateFirst = await guard.execute(makeCall('call-3', { q: 'a' }), context);
    const duplicateSecond = await guard.execute(makeCall('call-4', { q: 'b' }), context);

    expect(duplicateFirst.status).toBe('success');
    expect(duplicateSecond.status).toBe('success');
    expect(duplicateFirst.output).toContain('iteration 1');
    expect(duplicateSecond.output).toContain('iteration 2');
    expect(duplicateFirst.metadata?.idempotencyGuard).toMatchObject({
      blocked: true,
      previousIteration: 1,
    });
    expect(duplicateSecond.metadata?.idempotencyGuard).toMatchObject({
      blocked: true,
      previousIteration: 2,
    });
  });

  it('tier 2: second duplicate returns a directive that inlines the prior output', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const priorOutput = 'project-list:\n- relaycast (12 files)\n- agent-assistant (47 files)\n- sage (203 files)';
    const inner = makeInnerRegistry({
      executeImpl: vi.fn(async () => makeResult(call, { output: priorOutput })),
    });
    const guard = createIdempotencyGuard(inner, {
      alternativesFor: () => ['Read a specific file', 'Stop and answer the user'],
    });

    await guard.execute(call, context); // tier 0 — populates cache
    const tierOne = await guard.execute(call, context); // tier 1 — soft teaching
    const tierTwo = await guard.execute(call, context); // tier 2 — directive

    expect(tierOne.status).toBe('success');
    expect(tierOne.output).toContain("Repeating the same call won't return new information");

    expect(tierTwo.status).toBe('success');
    expect(tierTwo.error).toBeUndefined();
    expect(tierTwo.output).toContain('STOP.');
    expect(tierTwo.output).toContain('--- DATA FROM PRIOR CALL ---');
    expect(tierTwo.output).toContain('--- END DATA ---');
    expect(tierTwo.output).toContain('relaycast (12 files)');
    expect(tierTwo.output).toContain('Read a specific file');
    expect(tierTwo.metadata?.idempotencyGuard).toMatchObject({
      blocked: true,
      code: 'redundant_call_blocked',
      tier: 2,
      duplicateCount: 2,
      previousIteration: 1,
    });
    // Inner tool was only invoked the first time.
    expect(inner.execute).toHaveBeenCalledTimes(1);
  });

  it('tier 3: third duplicate returns a non-retryable error so the harness fails fast', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);

    await guard.execute(call, context); // tier 0
    await guard.execute(call, context); // tier 1
    await guard.execute(call, context); // tier 2
    const tierThree = await guard.execute(call, context); // tier 3 — abort

    expect(tierThree.status).toBe('error');
    expect(tierThree.error).toBeDefined();
    expect(tierThree.error?.code).toBe('redundant_call_loop_aborted');
    expect(tierThree.error?.retryable).toBe(false);
    expect(tierThree.metadata?.idempotencyGuard).toMatchObject({
      tier: 3,
      code: 'redundant_call_loop_aborted',
    });
    // Inner tool only invoked once across all four guard calls.
    expect(inner.execute).toHaveBeenCalledTimes(1);

    // A fifth identical call still aborts (tier stays at 3+).
    const tierFour = await guard.execute(call, context);
    expect(tierFour.status).toBe('error');
    expect(tierFour.error?.code).toBe('redundant_call_loop_aborted');
  });

  it('tier 2: truncates a large prior output to ~1200 chars in the directive body', async () => {
    const call = makeCall('call-1');
    const context = makeContext('turn-1');
    const bigOutput = 'X'.repeat(5000);
    const inner = makeInnerRegistry({
      executeImpl: vi.fn(async () => makeResult(call, { output: bigOutput })),
    });
    const guard = createIdempotencyGuard(inner);

    await guard.execute(call, context);
    await guard.execute(call, context);
    const tierTwo = await guard.execute(call, context);

    expect(tierTwo.status).toBe('success');
    expect(tierTwo.output).toBeDefined();
    expect(tierTwo.output).toContain('--- DATA FROM PRIOR CALL ---');
    expect(tierTwo.output).toContain('[truncated]');

    // The inlined data section should contain at most ~1200 chars of the
    // 'X' payload (plus the truncation marker), not the full 5000.
    const xCount = (tierTwo.output ?? '').match(/X/g)?.length ?? 0;
    expect(xCount).toBeLessThanOrEqual(1200);
    // Sanity: it should still contain a healthy chunk.
    expect(xCount).toBeGreaterThanOrEqual(1000);
  });

  it('different signatures escalate independently', async () => {
    const callA = makeCall('call-a', { q: 'a' });
    const callA2 = makeCall('call-a-2', { q: 'a' });
    const callB = makeCall('call-b', { q: 'b' });
    const context = makeContext('turn-1');
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);

    await guard.execute(callA, context); // A: tier 0
    const aDup = await guard.execute(callA2, context); // A: tier 1 (soft)
    const bFirst = await guard.execute(callB, context); // B: tier 0 (passes through)

    expect(aDup.metadata?.idempotencyGuard).toMatchObject({ tier: 1, duplicateCount: 1 });
    expect(bFirst.metadata?.idempotencyGuard).toBeUndefined();
    expect(bFirst.status).toBe('success');
    // A: 1 inner call. B: 1 inner call. Total: 2.
    expect(inner.execute).toHaveBeenCalledTimes(2);
  });

  it('per-turn isolation: duplicate count resets when turnId changes', async () => {
    const call = makeCall('call-1');
    const inner = makeInnerRegistry();
    const guard = createIdempotencyGuard(inner);

    // Turn 1: tier 0, 1, 2
    await guard.execute(call, makeContext('turn-1'));
    await guard.execute(call, makeContext('turn-1'));
    const turn1Tier2 = await guard.execute(call, makeContext('turn-1'));
    expect(turn1Tier2.metadata?.idempotencyGuard).toMatchObject({ tier: 2 });

    // Turn 2: should restart from tier 0 — first call passes through.
    const turn2First = await guard.execute(call, makeContext('turn-2'));
    expect(turn2First.metadata?.idempotencyGuard).toBeUndefined();
    expect(turn2First.status).toBe('success');

    // Turn 2: second call is tier 1, not tier 2.
    const turn2Second = await guard.execute(call, makeContext('turn-2'));
    expect(turn2Second.metadata?.idempotencyGuard).toMatchObject({ tier: 1, duplicateCount: 1 });
  });
});
