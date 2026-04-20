import { describe, expect, it } from 'vitest';

import { InMemoryTelemetrySink } from '../../src/sinks/memory.js';
import type { TelemetryEvent } from '../../src/sinks/types.js';

function createEvent(eventId: string): TelemetryEvent {
  return {
    eventId,
    eventKind: 'turn.finished',
    timestamp: '2026-04-20T12:34:56.000Z',
    assistantId: 'assistant-1',
    turnId: `turn-${eventId}`,
    input: { message: 'Help me' },
    output: {
      kind: 'final_answer',
      text: 'Done',
      stopReason: 'answer_finalized',
    },
    transcript: [],
    usage: {
      modelCalls: 1,
      toolCalls: 0,
    },
    cost: {
      usd: 0,
      missingPricing: false,
      perModel: [],
    },
  };
}

describe('InMemoryTelemetrySink', () => {
  it('appends events, returns the buffered events, and clears them', () => {
    const sink = new InMemoryTelemetrySink();
    const first = createEvent('event-1');
    const second = createEvent('event-2');

    sink.emit(first);
    sink.emit(second);

    expect(sink.events()).toEqual([first, second]);

    sink.clear();

    expect(sink.events()).toEqual([]);
  });
});
