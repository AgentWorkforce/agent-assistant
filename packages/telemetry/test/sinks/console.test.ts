import { describe, expect, it, vi } from 'vitest';

import { ConsoleTelemetrySink } from '../../src/sinks/console.js';
import type { TelemetryEvent } from '../../src/sinks/types.js';

function createEvent(): TelemetryEvent {
  return {
    eventId: 'event-1',
    eventKind: 'turn.finished',
    timestamp: '2026-04-20T12:34:56.000Z',
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    threadId: 'thread-1',
    userId: 'user-1',
    input: { message: 'Help me', systemPrompt: 'Be useful.' },
    output: {
      kind: 'final_answer',
      text: 'Done',
      stopReason: 'answer_finalized',
    },
    transcript: [
      {
        type: 'assistant_step',
        iteration: 1,
        outputType: 'final_answer',
        text: 'Done',
      },
    ],
    usage: {
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalCostUnits: 2,
      totalLatencyMs: 40,
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
    metadata: { outcome: 'completed' },
  };
}

describe('ConsoleTelemetrySink', () => {
  it('writes a single JSON line starting with [telemetry]', () => {
    const logger = vi.fn();
    const event = createEvent();
    const sink = new ConsoleTelemetrySink({ logger });

    sink.emit(event);

    expect(logger).toHaveBeenCalledOnce();
    const [line] = logger.mock.calls[0] ?? [];
    expect(line).toMatch(/^\[telemetry\] /);
    expect(JSON.parse(line.replace(/^\[telemetry\] /, ''))).toEqual(event);
  });

  it("omits transcript detail at level 'summary'", () => {
    const logger = vi.fn();
    const sink = new ConsoleTelemetrySink({ level: 'summary', logger });

    sink.emit(createEvent());

    const [line] = logger.mock.calls[0] ?? [];
    const payload = JSON.parse(line.replace(/^\[telemetry\] /, '')) as TelemetryEvent & {
      transcript: string;
    };
    expect(payload.transcript).toBe('[omitted]');
  });
});
