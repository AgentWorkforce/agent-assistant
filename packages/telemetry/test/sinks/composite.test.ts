import { describe, expect, it, vi } from 'vitest';

import { CompositeTelemetrySink } from '../../src/sinks/composite.js';
import type { TelemetryEvent, TelemetrySink } from '../../src/sinks/types.js';

function createEvent(): TelemetryEvent {
  return {
    eventId: 'event-1',
    eventKind: 'turn.finished',
    timestamp: '2026-04-20T12:34:56.000Z',
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    input: { message: 'Help me' },
    output: {
      kind: 'final_answer',
      text: 'Done',
      stopReason: 'answer_finalized',
    },
    transcript: [],
    usage: {
      totalInputTokens: 10,
      totalOutputTokens: 5,
      modelCalls: 1,
      toolCalls: 0,
    },
    cost: {
      usd: 0.000095,
      missingPricing: false,
      perModel: [
        {
          model: 'openai/gpt-4.1',
          inputTokens: 10,
          outputTokens: 5,
          usd: 0.000095,
          missingPricing: false,
        },
      ],
    },
  };
}

describe('CompositeTelemetrySink', () => {
  it('fans out emit to all children with the same event', async () => {
    const event = createEvent();
    const first: TelemetrySink = { emit: vi.fn() };
    const second: TelemetrySink = { emit: vi.fn(async () => undefined) };
    const sink = new CompositeTelemetrySink([first, second]);

    await sink.emit(event);

    expect(first.emit).toHaveBeenCalledWith(event);
    expect(second.emit).toHaveBeenCalledWith(event);
  });

  it('logs a warning when a child throws and still emits to the others', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const event = createEvent();
    const error = new Error('sink failed');
    const first: TelemetrySink = { emit: vi.fn() };
    const failing: TelemetrySink = {
      emit: vi.fn(() => {
        throw error;
      }),
    };
    const third: TelemetrySink = { emit: vi.fn(async () => undefined) };
    const sink = new CompositeTelemetrySink([first, failing, third]);

    try {
      await sink.emit(event);

      expect(first.emit).toHaveBeenCalledWith(event);
      expect(failing.emit).toHaveBeenCalledWith(event);
      expect(third.emit).toHaveBeenCalledWith(event);
      expect(warnSpy).toHaveBeenCalledWith('[telemetry/composite]', 1, error);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
