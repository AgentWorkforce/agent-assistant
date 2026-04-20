import { describe, expect, it, vi } from 'vitest';

import { R2TelemetrySink, type MinimalR2Bucket } from '../../src/sinks/r2.js';
import type { TelemetryEvent } from '../../src/sinks/types.js';

function createEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
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
      perModel: [
        {
          model: 'openai/gpt-4.1',
          inputTokens: 10,
          outputTokens: 5,
          usd: 0.000095,
        },
      ],
    },
    ...overrides,
  };
}

function createBucket(): MinimalR2Bucket & { put: ReturnType<typeof vi.fn> } {
  return {
    put: vi.fn(async () => undefined),
  };
}

describe('R2TelemetrySink', () => {
  it("stores events using 'turns/YYYY/MM/DD/<turnId>.json' for a known timestamp", async () => {
    const bucket = createBucket();
    const event = createEvent();
    const sink = new R2TelemetrySink({ bucket });

    await sink.emit(event);

    expect(bucket.put).toHaveBeenCalledWith(
      'turns/2026/04/20/turn-1.json',
      JSON.stringify(event),
      { httpMetadata: { contentType: 'application/json' } },
    );
  });

  it('replaces slashes in turnId with underscores in the key', async () => {
    const bucket = createBucket();
    const event = createEvent({ turnId: 'thread/turn/1' });
    const sink = new R2TelemetrySink({ bucket });

    await sink.emit(event);

    expect(bucket.put).toHaveBeenCalledWith(
      'turns/2026/04/20/thread_turn_1.json',
      JSON.stringify(event),
      { httpMetadata: { contentType: 'application/json' } },
    );
  });

  it('uses a custom prefix', async () => {
    const bucket = createBucket();
    const event = createEvent();
    const sink = new R2TelemetrySink({ bucket, prefix: 'custom/prefix' });

    await sink.emit(event);

    expect(bucket.put).toHaveBeenCalledWith(
      'custom/prefix/2026/04/20/turn-1.json',
      JSON.stringify(event),
      { httpMetadata: { contentType: 'application/json' } },
    );
  });

  it("sets httpMetadata.contentType to 'application/json'", async () => {
    const bucket = createBucket();
    const event = createEvent();
    const sink = new R2TelemetrySink({ bucket });

    await sink.emit(event);

    const [, , options] = bucket.put.mock.calls[0] ?? [];
    expect(options?.httpMetadata?.contentType).toBe('application/json');
  });
});
