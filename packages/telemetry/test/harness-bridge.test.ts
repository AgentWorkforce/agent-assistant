import { describe, expect, it, vi } from 'vitest';
import type {
  HarnessExecutionState,
  HarnessHooks,
  HarnessResult,
  HarnessModelCallRecord,
} from '@agent-assistant/harness';

import { createTelemetryHook } from '../src/harness-bridge.js';
import { FROZEN_PRICING_TABLE } from '../src/pricing.js';
import type { TelemetryEvent, TelemetrySink } from '../src/sinks/types.js';

function createResult(): HarnessResult {
  return {
    outcome: 'completed',
    stopReason: 'answer_finalized',
    turnId: 'turn-1',
    sessionId: 'session-1',
    assistantMessage: { text: 'Done' },
    traceSummary: {
      iterationCount: 1,
      toolCallCount: 0,
      hadContinuation: false,
      finalEventType: 'turn_finished',
    },
    usage: {
      totalInputTokens: 1_000_000,
      totalOutputTokens: 1_000_000,
      totalCostUnits: 2,
      totalLatencyMs: 40,
      modelCalls: 1,
      toolCalls: 0,
    },
  };
}

function createState(
  overrides: { modelCalls?: HarnessModelCallRecord[] } = {},
): HarnessExecutionState {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    sessionId: 'session-1',
    userId: 'user-1',
    threadId: 'thread-1',
    iteration: 1,
    toolCallCount: 0,
    elapsedMs: 40,
    input: {
      message: {
        id: 'msg-1',
        text: 'Help me',
        receivedAt: '2026-04-20T00:00:00.000Z',
      },
      instructions: { systemPrompt: 'Be useful.' },
    },
    transcript: [],
    modelCalls: overrides.modelCalls ?? [
      {
        iteration: 1,
        outputType: 'final_answer',
        modelId: 'anthropic/claude-sonnet-4.6',
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        },
      },
    ],
  };
}

describe('createTelemetryHook', () => {
  it('returns a function suitable for onTurnFinished', () => {
    const sink: TelemetrySink = { emit: vi.fn() };
    const hook: NonNullable<HarnessHooks['onTurnFinished']> = createTelemetryHook({
      sink,
    });

    expect(typeof hook).toBe('function');
  });

  it('emits a turn.finished event with usage and computed frozen-table cost', async () => {
    const emit = vi.fn();
    const sink: TelemetrySink = { emit };
    const hook = createTelemetryHook({
      sink,
      generateEventId: () => 'event-1',
    });

    await hook(createResult(), createState());

    expect(emit).toHaveBeenCalledOnce();
    const [event] = emit.mock.calls[0] as [TelemetryEvent];
    expect(event).toMatchObject({
      eventId: 'event-1',
      eventKind: 'turn.finished',
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      threadId: 'thread-1',
      userId: 'user-1',
      input: {
        message: 'Help me',
        systemPrompt: 'Be useful.',
      },
      output: {
        kind: 'final_answer',
        text: 'Done',
        stopReason: 'answer_finalized',
      },
      usage: createResult().usage,
      metadata: {
        outcome: 'completed',
      },
    });
    expect(event.cost).toEqual({
      usd: 18,
      missingPricing: false,
      perModel: [
        {
          model: 'anthropic/claude-sonnet-4.6',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          usd: 18,
          missingPricing: false,
        },
      ],
    });
  });

  it("swallows sink errors and logs them with console.warn", async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new Error('sink failed');
    const sink: TelemetrySink = {
      emit: vi.fn(() => {
        throw error;
      }),
    };
    const hook = createTelemetryHook({ sink });

    try {
      await expect(hook(createResult(), createState())).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        'Telemetry hook failed to emit turn.finished event',
        error,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('uses a custom generateEventId when provided', async () => {
    const emit = vi.fn();
    const sink: TelemetrySink = { emit };
    const hook = createTelemetryHook({
      sink,
      pricingTable: FROZEN_PRICING_TABLE,
      generateEventId: () => 'custom-event-id',
    });

    await hook(createResult(), createState());

    const [event] = emit.mock.calls[0] as [TelemetryEvent];
    expect(event.eventId).toBe('custom-event-id');
  });

  it.each([
    ['needs_clarification', 'clarification_required', 'clarification'],
    ['awaiting_approval', 'approval_required', 'approval'],
    ['deferred', 'max_iterations_reached', 'deferred'],
    ['failed', 'runtime_error', 'failed'],
  ] as const)(
    'maps outcome %s (stopReason %s) to output.kind=%s',
    async (outcome, stopReason, expectedKind) => {
      const emit = vi.fn();
      const sink: TelemetrySink = { emit };
      const hook = createTelemetryHook({ sink });
      const result: HarnessResult = {
        ...createResult(),
        outcome,
        stopReason,
      };

      await hook(result, createState());

      const [event] = emit.mock.calls[0] as [TelemetryEvent];
      expect(event.output.kind).toBe(expectedKind);
      expect(event.metadata?.outcome).toBe(outcome);
    },
  );

  it('prefers "refused" kind when stopReason is model_refused', async () => {
    const emit = vi.fn();
    const sink: TelemetrySink = { emit };
    const hook = createTelemetryHook({ sink });
    const result: HarnessResult = {
      ...createResult(),
      outcome: 'failed',
      stopReason: 'model_refused',
      assistantMessage: { text: 'cannot help' },
    };

    await hook(result, createState());

    const [event] = emit.mock.calls[0] as [TelemetryEvent];
    expect(event.output).toEqual({
      kind: 'refused',
      text: 'cannot help',
      stopReason: 'model_refused',
    });
  });

  it('flags missingPricing for models absent from the pricing table', async () => {
    const emit = vi.fn();
    const sink: TelemetrySink = { emit };
    const hook = createTelemetryHook({ sink });
    const state = createState({
      modelCalls: [
        {
          iteration: 1,
          outputType: 'final_answer',
          modelId: 'mystery/model-not-in-table',
          usage: { inputTokens: 100, outputTokens: 100 },
        },
      ],
    });

    await hook(createResult(), state);

    const [event] = emit.mock.calls[0] as [TelemetryEvent];
    expect(event.cost).toEqual({
      usd: 0,
      missingPricing: true,
      perModel: [
        {
          model: 'mystery/model-not-in-table',
          inputTokens: 100,
          outputTokens: 100,
          usd: 0,
          missingPricing: true,
        },
      ],
    });
  });
});
