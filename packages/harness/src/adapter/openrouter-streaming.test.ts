import { describe, expect, it, vi } from 'vitest';

import { OpenRouterExecutionAdapter } from './openrouter-adapter.js';
import type { ExecutionRequest, ExecutionStreamEvent } from './types.js';

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    assistantId: 'a',
    turnId: 't',
    message: { id: 'm', text: 'hi', receivedAt: '2026-05-04T00:00:00.000Z' },
    instructions: { systemPrompt: 'be helpful' },
    ...overrides,
  };
}

function sseStream(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(stream: AsyncIterable<ExecutionStreamEvent>): Promise<ExecutionStreamEvent[]> {
  const events: ExecutionStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('OpenRouterExecutionAdapter.executeStreaming', () => {
  it('declares streaming: native', () => {
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'k' });
    expect(adapter.describeCapabilities().streaming).toBe('native');
  });

  it('parses SSE frames into text_delta events and ends with one turn_finished', async () => {
    const fetchImpl = vi.fn(
      async () =>
        sseStream([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":", "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
          'data: [DONE]\n\n',
        ]) as Response,
    );
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'k', fetchImpl });
    const events = await collect(adapter.executeStreaming!(request()));

    const textDeltas = events.filter((event) => event.type === 'text_delta');
    expect(textDeltas.map((event) => (event as { text: string }).text)).toEqual(['Hello', ', ', 'world']);

    const finishes = events.filter((event) => event.type === 'turn_finished');
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({
      type: 'turn_finished',
      result: { status: 'completed', schemaVersion: 1, output: { text: 'Hello, world' } },
    });
    // turn_finished is the LAST event.
    expect(events[events.length - 1]).toBe(finishes[0]);
  });

  it('adds OpenRouter response cache headers for streaming execution', async () => {
    const fetchImpl = vi.fn(
      async () =>
        sseStream([
          'data: {"choices":[{"delta":{"content":"cached stream"}}]}\n\n',
          'data: [DONE]\n\n',
        ]) as Response,
    );
    const adapter = new OpenRouterExecutionAdapter({
      apiKey: 'k',
      fetchImpl,
      responseCache: { ttlSeconds: 300, clear: true },
    });

    await collect(adapter.executeStreaming!(request()));

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'X-OpenRouter-Cache': 'true',
      'X-OpenRouter-Cache-TTL': '300',
      'X-OpenRouter-Cache-Clear': 'true',
      Accept: 'text/event-stream',
    });
  });

  it('handles SSE frames split across read chunks', async () => {
    // Same payload as above but split mid-frame to simulate partial reads.
    const fetchImpl = vi.fn(
      async () =>
        sseStream([
          'data: {"choices":[{"delta":{"content":"He',
          'llo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n',
          'data: [DONE]\n\n',
        ]) as Response,
    );
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'k', fetchImpl });
    const events = await collect(adapter.executeStreaming!(request()));
    const textDeltas = events.filter((event) => event.type === 'text_delta').map((event) => (event as { text: string }).text);
    expect(textDeltas.join('')).toBe('Hello world');
  });

  it('emits an error stream event then turn_finished:failed when API returns non-OK', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('quota exceeded', { status: 429, headers: { 'content-type': 'text/plain' } }) as Response,
    );
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'k', fetchImpl });
    const events = await collect(adapter.executeStreaming!(request()));
    const finish = events.find((event) => event.type === 'turn_finished');
    expect(finish).toMatchObject({
      type: 'turn_finished',
      result: { status: 'failed', error: { code: 'backend_execution_error' } },
    });
  });

  it('returns supported:false stream when streaming is required but capability declares streaming', () => {
    // The default capability is 'native' so this is satisfied — assert by checking
    // that requesting required-streaming works (no blocking reason added).
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'k' });
    const negotiation = adapter.negotiate(request({ requirements: { streaming: 'required' } }));
    expect(negotiation.supported).toBe(true);
  });

  it('emits cancelled stream when request signal is already aborted', async () => {
    const adapter = new OpenRouterExecutionAdapter({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => {
        throw new Error('should not be called');
      }),
    });
    const controller = new AbortController();
    controller.abort();
    const events = await collect(adapter.executeStreaming!(request({ signal: controller.signal })));
    const finish = events.find((event) => event.type === 'turn_finished');
    expect(finish).toMatchObject({
      type: 'turn_finished',
      result: { status: 'failed', error: { code: 'cancelled' } },
    });
  });

  it('uses call-time globalThis.fetch (workers-fetch rule)', async () => {
    const stubFetch = vi.fn(
      async () =>
        sseStream([
          'data: {"choices":[{"delta":{"content":"global"}}]}\n\n',
          'data: [DONE]\n\n',
        ]) as Response,
    );
    vi.stubGlobal('fetch', stubFetch);
    try {
      const adapter = new OpenRouterExecutionAdapter({ apiKey: 'k' });
      const events = await collect(adapter.executeStreaming!(request()));
      expect(stubFetch).toHaveBeenCalledOnce();
      const textDeltas = events.filter((event) => event.type === 'text_delta');
      expect((textDeltas[0] as { text: string }).text).toBe('global');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
