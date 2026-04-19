import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTieredRunner } from './tiered-runner.js';
import type { Router, SingleShotAdapter } from './types.js';
import type { HarnessRuntime, HarnessTurnInput, HarnessResult } from '../types.js';

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

function makeTurnInput(overrides?: Partial<HarnessTurnInput>): HarnessTurnInput {
  return {
    assistantId: 'asst-1',
    turnId: 'turn-1',
    message: {
      id: 'msg-1',
      text: 'hello',
      receivedAt: '2026-04-18T00:00:00Z',
    },
    instructions: { systemPrompt: 'You are a helpful assistant.' },
    ...overrides,
  };
}

function makeHarnessResult(
  outcome: HarnessResult['outcome'],
  text?: string,
): HarnessResult {
  return {
    outcome,
    stopReason: outcome === 'completed' ? 'answer_finalized' : 'runtime_error',
    turnId: 'turn-1',
    assistantMessage: text !== undefined ? { text } : undefined,
    traceSummary: {
      iterationCount: 1,
      toolCallCount: 0,
      hadContinuation: false,
      finalEventType: outcome === 'completed' ? 'final_answer' : 'runtime_error',
    },
    usage: { modelCalls: 1, toolCalls: 0 },
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeRouter(): Router {
  return { route: vi.fn() };
}

function makeFast(): SingleShotAdapter {
  return { generate: vi.fn() };
}

function makeHarness(): HarnessRuntime {
  return { runTurn: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTieredRunner', () => {
  let router: Router;
  let fast: SingleShotAdapter;
  let harness: HarnessRuntime;

  beforeEach(() => {
    router = makeRouter();
    fast = makeFast();
    harness = makeHarness();
  });

  it('fast tier → calls fast.generate, returns tier:"fast"', async () => {
    vi.mocked(router.route).mockResolvedValue({
      tier: 'fast',
      reason: 'no tools needed',
    });
    vi.mocked(fast.generate).mockResolvedValue({
      text: 'hello back',
      usage: { inputTokens: 5, outputTokens: 2 },
    });

    const runner = createTieredRunner({ router, fast, harness });
    const result = await runner.runTurn(makeTurnInput());

    expect(harness.runTurn).not.toHaveBeenCalled();
    expect(result.tier).toBe('fast');
    if (result.tier !== 'fast') return;
    expect(result.text).toBe('hello back');
    expect(result.routingDecision.reason).toBe('no tools needed');
  });

  it('harness tier → calls harness.runTurn, returns tier:"harness" with text extracted', async () => {
    vi.mocked(router.route).mockResolvedValue({ tier: 'harness' });
    const harnessResult = makeHarnessResult('completed', 'tool-driven answer');
    vi.mocked(harness.runTurn).mockResolvedValue(harnessResult);

    const runner = createTieredRunner({ router, fast, harness });
    const result = await runner.runTurn(makeTurnInput());

    expect(fast.generate).not.toHaveBeenCalled();
    expect(result.tier).toBe('harness');
    if (result.tier !== 'harness') return;
    expect(result.text).toBe('tool-driven answer');
    expect(result.harnessResult).toBe(harnessResult);
  });

  it('harness tier with non-completed outcome → text is undefined but result still surfaces', async () => {
    vi.mocked(router.route).mockResolvedValue({ tier: 'harness' });
    const failedResult = makeHarnessResult('failed');
    vi.mocked(harness.runTurn).mockResolvedValue(failedResult);

    const runner = createTieredRunner({ router, fast, harness });
    const result = await runner.runTurn(makeTurnInput());

    expect(result.tier).toBe('harness');
    if (result.tier !== 'harness') return;
    expect(result.text).toBeUndefined();
    expect(result.harnessResult).toBe(failedResult);
  });

  it('reject tier → returns tier:"rejected" with rejectMessage', async () => {
    vi.mocked(router.route).mockResolvedValue({
      tier: 'reject',
      reason: 'out of scope',
    });

    const runner = createTieredRunner({ router, fast, harness });
    const result = await runner.runTurn(makeTurnInput());

    expect(fast.generate).not.toHaveBeenCalled();
    expect(harness.runTurn).not.toHaveBeenCalled();
    expect(result.tier).toBe('rejected');
    if (result.tier !== 'rejected') return;
    expect(result.text).toBe("I can't help with that request.");
    expect(result.routingDecision.reason).toBe('out of scope');
  });

  it('custom rejectMessage is respected', async () => {
    vi.mocked(router.route).mockResolvedValue({ tier: 'reject' });

    const runner = createTieredRunner({
      router,
      fast,
      harness,
      rejectMessage: 'Sorry, no.',
    });
    const result = await runner.runTurn(makeTurnInput());

    expect(result.tier).toBe('rejected');
    if (result.tier !== 'rejected') return;
    expect(result.text).toBe('Sorry, no.');
  });

  it('router error propagates', async () => {
    vi.mocked(router.route).mockRejectedValue(new Error('router boom'));

    const runner = createTieredRunner({ router, fast, harness });
    await expect(runner.runTurn(makeTurnInput())).rejects.toThrow('router boom');
  });

  it('fast adapter error propagates', async () => {
    vi.mocked(router.route).mockResolvedValue({ tier: 'fast' });
    vi.mocked(fast.generate).mockRejectedValue(new Error('fast boom'));

    const runner = createTieredRunner({ router, fast, harness });
    await expect(runner.runTurn(makeTurnInput())).rejects.toThrow('fast boom');
  });

  it('harness error propagates', async () => {
    vi.mocked(router.route).mockResolvedValue({ tier: 'harness' });
    vi.mocked(harness.runTurn).mockRejectedValue(new Error('harness boom'));

    const runner = createTieredRunner({ router, fast, harness });
    await expect(runner.runTurn(makeTurnInput())).rejects.toThrow('harness boom');
  });

  it('router input is built from HarnessTurnInput correctly', async () => {
    vi.mocked(router.route).mockResolvedValue({ tier: 'reject' });

    const context = {
      blocks: [{ id: 'b1', label: 'ctx', content: 'some context' }],
    };
    const input = makeTurnInput({ context });

    const runner = createTieredRunner({ router, fast, harness });
    await runner.runTurn(input);

    expect(router.route).toHaveBeenCalledOnce();
    const routerInput = vi.mocked(router.route).mock.calls[0][0];
    expect(routerInput.message).toBe(input.message);
    expect(routerInput.context).toBe(input.context);
  });
});
