import { describe, expect, it, vi } from 'vitest';

import { createHarness } from './harness.js';
import type { HarnessModelAdapter, HarnessStreamEvent, HarnessTurnInput } from './types.js';

function turnInput(): HarnessTurnInput {
  return {
    assistantId: 'a',
    turnId: 't',
    message: { id: 'm', text: 'hi', receivedAt: '2026-05-04T00:00:00.000Z' },
    instructions: { systemPrompt: 'be helpful' },
  };
}

function batchModel(text: string): HarnessModelAdapter {
  return {
    async nextStep() {
      return { type: 'final_answer', text };
    },
  };
}

function streamingModel(chunks: string[]): HarnessModelAdapter {
  return {
    async nextStep() {
      return { type: 'final_answer', text: chunks.join('') };
    },
    async streamStep(_input, onDelta) {
      for (const chunk of chunks) onDelta(chunk);
      return { type: 'final_answer', text: chunks.join('') };
    },
  };
}

async function collect(iterable: AsyncIterable<HarnessStreamEvent>): Promise<HarnessStreamEvent[]> {
  const events: HarnessStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('runTurnStreaming', () => {
  it('emits a single text_delta with the full output when the model has no streamStep', async () => {
    const runtime = createHarness({ model: batchModel('hello world') });
    expect(runtime.runTurnStreaming).toBeDefined();
    const events = await collect(runtime.runTurnStreaming!(turnInput()));
    const textDeltas = events.filter((event) => event.type === 'text_delta');
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0]).toMatchObject({ text: 'hello world', outputType: 'final_answer' });
    const turnFinished = events.filter((event) => event.type === 'turn_finished');
    expect(turnFinished).toHaveLength(1);
    expect(turnFinished[0]).toMatchObject({
      type: 'turn_finished',
      result: { outcome: 'completed', stopReason: 'answer_finalized' },
    });
  });

  it('emits per-chunk text_delta events when the model exposes streamStep', async () => {
    const runtime = createHarness({ model: streamingModel(['He', 'llo']) });
    const events = await collect(runtime.runTurnStreaming!(turnInput()));
    const textDeltas = events.filter((event) => event.type === 'text_delta');
    expect(textDeltas.map((event) => (event as { text: string }).text)).toEqual(['He', 'llo']);
    // No duplicate end-of-step text_delta with outputType when streamingHandled.
    expect(textDeltas.every((event) => (event as { outputType?: string }).outputType === undefined)).toBe(true);
  });

  it('streams trace events to config.trace AND stream events to the iterable in parallel (co-existence)', async () => {
    const traceEvents: string[] = [];
    const trace = { emit: vi.fn(async (event: { type: string }) => { traceEvents.push(event.type); }) };
    const runtime = createHarness({ model: batchModel('done'), trace });
    const events = await collect(runtime.runTurnStreaming!(turnInput()));
    expect(events.some((event) => event.type === 'turn_finished')).toBe(true);
    // Trace got the standard turn_started → model_step_started → … sequence.
    expect(traceEvents).toContain('turn_started');
    expect(traceEvents).toContain('model_step_finished');
    expect(traceEvents).toContain('turn_finished');
  });
});
