import { describe, expect, it, vi } from 'vitest';

import { AnthropicModelAdapter } from './anthropic-model-adapter.js';
import { GeminiModelAdapter } from './gemini-model-adapter.js';
import { OpenAIModelAdapter } from './openai-model-adapter.js';
import type { HarnessModelInput, HarnessModelOutput } from '../types.js';

function input(): HarnessModelInput {
  return {
    assistantId: 'a',
    turnId: 't',
    message: { id: 'm', text: 'hi', receivedAt: '2026-05-04T00:00:00.000Z' },
    instructions: { systemPrompt: 'be helpful' },
    transcript: [],
    availableTools: [],
    iteration: 1,
    toolCallCount: 0,
    elapsedMs: 0,
  };
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('Anthropic streamStep', () => {
  it('emits per-event text deltas and resolves with assembled final_answer', async () => {
    const fetchImpl = vi.fn(
      async () =>
        sseResponse([
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]) as Response,
    );
    const adapter = new AnthropicModelAdapter({ apiKey: 'k', fetchImpl });
    const deltas: string[] = [];
    const result = await adapter.streamStep!(input(), (delta) => deltas.push(delta));
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result).toMatchObject({ type: 'final_answer', text: 'Hello' });
  });

  it('aggregates streamed tool_use into a tool_request output', async () => {
    const fetchImpl = vi.fn(
      async () =>
        sseResponse([
          'data: {"type":"message_start","message":{"id":"msg_2"}}\n\n',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"lookup"}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"hi\\""}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"}"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ]) as Response,
    );
    const adapter = new AnthropicModelAdapter({ apiKey: 'k', fetchImpl });
    const result = await adapter.streamStep!(input(), () => {});
    expect(result).toMatchObject({
      type: 'tool_request',
      calls: [{ id: 'tu_1', name: 'lookup', input: { q: 'hi' } }],
    });
  });

  it('uses call-time globalThis.fetch (workers-fetch rule)', async () => {
    const stubFetch = vi.fn(
      async () =>
        sseResponse([
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"global"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
        ]) as Response,
    );
    vi.stubGlobal('fetch', stubFetch);
    try {
      const adapter = new AnthropicModelAdapter({ apiKey: 'k' });
      const deltas: string[] = [];
      const result = await adapter.streamStep!(input(), (delta) => deltas.push(delta));
      expect(stubFetch).toHaveBeenCalledOnce();
      expect((result as Extract<HarnessModelOutput, { type: 'final_answer' }>).text).toBe('global');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('OpenAI streamStep', () => {
  it('emits text deltas across choices[0].delta.content chunks', async () => {
    const fetchImpl = vi.fn(
      async () =>
        sseResponse([
          'data: {"id":"o1","choices":[{"delta":{"content":"He"}}]}\n\n',
          'data: {"id":"o1","choices":[{"delta":{"content":"llo"}}]}\n\n',
          'data: [DONE]\n\n',
        ]) as Response,
    );
    const adapter = new OpenAIModelAdapter({ apiKey: 'k', fetchImpl });
    const deltas: string[] = [];
    const result = await adapter.streamStep!(input(), (delta) => deltas.push(delta));
    expect(deltas).toEqual(['He', 'llo']);
    expect(result).toMatchObject({ type: 'final_answer', text: 'Hello' });
  });

  it('aggregates streamed tool_calls (function arguments split across chunks)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","function":{"name":"lookup","arguments":"{\\"q\\":"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"hi\\"}"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ]) as Response,
    );
    const adapter = new OpenAIModelAdapter({ apiKey: 'k', fetchImpl });
    const result = await adapter.streamStep!(input(), () => {});
    expect(result).toMatchObject({
      type: 'tool_request',
      calls: [{ id: 'tc1', name: 'lookup', input: { q: 'hi' } }],
    });
  });
});

describe('Gemini streamStep', () => {
  it('emits text deltas across candidate parts', async () => {
    const fetchImpl = vi.fn(
      async () =>
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"He"}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"llo"}]}}]}\n\n',
          'data: {"candidates":[{"finishReason":"STOP"}]}\n\n',
        ]) as Response,
    );
    const adapter = new GeminiModelAdapter({ apiKey: 'k', fetchImpl });
    const deltas: string[] = [];
    const result = await adapter.streamStep!(input(), (delta) => deltas.push(delta));
    expect(deltas).toEqual(['He', 'llo']);
    expect(result).toMatchObject({ type: 'final_answer', text: 'Hello' });
  });

  it('returns refusal when finishReason is SAFETY', async () => {
    const fetchImpl = vi.fn(
      async () =>
        sseResponse([
          'data: {"candidates":[{"finishReason":"SAFETY","safetyRatings":[]}]}\n\n',
        ]) as Response,
    );
    const adapter = new GeminiModelAdapter({ apiKey: 'k', fetchImpl });
    const result = await adapter.streamStep!(input(), () => {});
    expect(result).toMatchObject({ type: 'refusal', reason: 'Gemini blocked the response: SAFETY' });
  });
});
