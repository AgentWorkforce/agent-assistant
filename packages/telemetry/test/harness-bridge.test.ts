import { describe, expect, it, vi } from 'vitest';
import type {
  HarnessExecutionState,
  HarnessHooks,
  HarnessResult,
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

function createState(): HarnessExecutionState & {
  userId: string;
  threadId: string;
  input: {
    message: { text: string };
    instructions: { systemPrompt: string };
  };
  modelCalls: Array<{
    modelId: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
  }>;
} {
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
      message: { text: 'Help me' },
      instructions: { systemPrompt: 'Be useful.' },
    },
    modelCalls: [
      {
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
      perModel: [
        {
          model: 'anthropic/claude-sonnet-4.6',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          usd: 18,
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
});
