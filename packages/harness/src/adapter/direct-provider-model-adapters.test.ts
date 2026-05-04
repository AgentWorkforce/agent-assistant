import { describe, expect, it, vi } from 'vitest';

import { AnthropicModelAdapter } from './anthropic-model-adapter.js';
import { GeminiModelAdapter } from './gemini-model-adapter.js';
import { OpenAIModelAdapter } from './openai-model-adapter.js';
import type { HarnessModelAdapter, HarnessModelInput } from '../types.js';

type AdapterFactory = (fetchImpl?: typeof fetch) => HarnessModelAdapter;

function input(): HarnessModelInput {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    message: { id: 'msg-1', text: 'Hello', receivedAt: '2026-05-04T00:00:00.000Z' },
    instructions: { systemPrompt: 'Be useful.' },
    transcript: [],
    availableTools: [{ name: 'lookup', description: 'Lookup', inputSchema: { type: 'object' } }],
    iteration: 1,
    toolCallCount: 0,
    elapsedMs: 0,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function expectText(adapter: HarnessModelAdapter, text: string) {
  const result = await adapter.nextStep(input());
  expect(result).toMatchObject({ type: 'final_answer', text });
}

const providerCases: Array<{
  name: string;
  create: AdapterFactory;
  textBody: unknown;
}> = [
  {
    name: 'Anthropic',
    create: (fetchImpl) => new AnthropicModelAdapter({ apiKey: 'key', fetchImpl }),
    textBody: { content: [{ type: 'text', text: 'from global' }] },
  },
  {
    name: 'OpenAI',
    create: (fetchImpl) => new OpenAIModelAdapter({ apiKey: 'key', fetchImpl }),
    textBody: { choices: [{ message: { content: 'from global' } }] },
  },
  {
    name: 'Gemini',
    create: (fetchImpl) => new GeminiModelAdapter({ apiKey: 'key', fetchImpl }),
    textBody: { candidates: [{ content: { parts: [{ text: 'from global' }] } }] },
  },
];

describe('direct provider model adapters', () => {
  it('maps Anthropic text, tool use, refusal, and provider errors', async () => {
    await expectText(
      new AnthropicModelAdapter({
        apiKey: 'key',
        fetchImpl: vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: 'hello' }] })),
      }),
      'hello',
    );

    const toolAdapter = new AnthropicModelAdapter({
      apiKey: 'key',
      fetchImpl: vi.fn(async () =>
        jsonResponse({ content: [{ type: 'tool_use', id: 'tool-1', name: 'lookup', input: { q: 'x' } }] }),
      ),
    });
    await expect(toolAdapter.nextStep(input())).resolves.toMatchObject({
      type: 'tool_request',
      calls: [{ id: 'tool-1', name: 'lookup', input: { q: 'x' } }],
    });

    const refusalAdapter = new AnthropicModelAdapter({
      apiKey: 'key',
      fetchImpl: vi.fn(async () => jsonResponse({ stop_reason: 'refusal', content: [{ type: 'text', text: 'no' }] })),
    });
    await expect(refusalAdapter.nextStep(input())).resolves.toMatchObject({ type: 'refusal', reason: 'no' });

    const errorAdapter = new AnthropicModelAdapter({
      apiKey: 'key',
      fetchImpl: vi.fn(async () => jsonResponse({ error: { message: 'rate limit exceeded' } }, 429)),
    });
    await expect(errorAdapter.nextStep(input())).resolves.toMatchObject({
      type: 'invalid',
      kind: 'transient',
      code: 'rate_limited',
      httpStatus: 429,
    });
  });

  it('maps OpenAI text, tool use, refusal, and provider errors', async () => {
    await expectText(
      new OpenAIModelAdapter({
        apiKey: 'key',
        fetchImpl: vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'hello' } }] })),
      }),
      'hello',
    );

    const toolAdapter = new OpenAIModelAdapter({
      apiKey: 'key',
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          choices: [
            {
              message: {
                tool_calls: [
                  { id: 'tool-1', function: { name: 'lookup', arguments: '{"q":"x"}' } },
                ],
              },
            },
          ],
        }),
      ),
    });
    await expect(toolAdapter.nextStep(input())).resolves.toMatchObject({
      type: 'tool_request',
      calls: [{ id: 'tool-1', name: 'lookup', input: { q: 'x' } }],
    });

    const refusalAdapter = new OpenAIModelAdapter({
      apiKey: 'key',
      fetchImpl: vi.fn(async () => jsonResponse({ choices: [{ message: { refusal: 'no' } }] })),
    });
    await expect(refusalAdapter.nextStep(input())).resolves.toMatchObject({ type: 'refusal', reason: 'no' });

    const errorAdapter = new OpenAIModelAdapter({
      apiKey: 'key',
      fetchImpl: vi.fn(async () => jsonResponse({ error: { message: 'context length exceeded' } }, 400)),
    });
    await expect(errorAdapter.nextStep(input())).resolves.toMatchObject({
      type: 'invalid',
      kind: 'provider_error',
      code: 'context_length_exceeded',
    });
  });

  it('maps Gemini text, tool use, safety refusal, and provider errors', async () => {
    await expectText(
      new GeminiModelAdapter({
        apiKey: 'key',
        fetchImpl: vi.fn(async () =>
          jsonResponse({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] }),
        ),
      }),
      'hello',
    );

    const toolAdapter = new GeminiModelAdapter({
      apiKey: 'key',
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ functionCall: { name: 'lookup', args: { q: 'x' } } }] } }],
        }),
      ),
    });
    await expect(toolAdapter.nextStep(input())).resolves.toMatchObject({
      type: 'tool_request',
      calls: [{ id: 'gemini-1', name: 'lookup', input: { q: 'x' } }],
    });

    const refusalAdapter = new GeminiModelAdapter({
      apiKey: 'key',
      fetchImpl: vi.fn(async () => jsonResponse({ candidates: [{ finishReason: 'SAFETY' }] })),
    });
    await expect(refusalAdapter.nextStep(input())).resolves.toMatchObject({
      type: 'refusal',
      reason: 'Gemini blocked the response: SAFETY',
    });

    const errorAdapter = new GeminiModelAdapter({
      apiKey: 'key',
      fetchImpl: vi.fn(async () => jsonResponse({ error: { message: 'model not found' } }, 404)),
    });
    await expect(errorAdapter.nextStep(input())).resolves.toMatchObject({
      type: 'invalid',
      kind: 'provider_error',
      code: 'model_not_found',
    });
  });

  it.each(providerCases)('uses call-time globalThis.fetch and forwards AbortSignal for $name', async ({ create, textBody }) => {
    const abortController = new AbortController();
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(abortController.signal);
      return jsonResponse(textBody);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await create().nextStep({ ...input(), signal: abortController.signal });
      expect(result).toMatchObject({ type: 'final_answer', text: 'from global' });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(providerCases)('consumes $name response bodies on error paths', async ({ create }) => {
    const response = jsonResponse({ error: { message: 'invalid api key' } }, 401);
    const adapter = create(vi.fn(async () => response));

    const result = await adapter.nextStep(input());

    expect(result).toMatchObject({
      type: 'invalid',
      kind: 'provider_error',
      code: 'auth_failed',
      httpStatus: 401,
    });
    expect(response.bodyUsed).toBe(true);
  });

  it.each(providerCases)('returns timeout-class invalid output when $name fetch is aborted', async ({ create }) => {
    const adapter = create(vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }));

    const result = await adapter.nextStep(input());

    expect(result).toMatchObject({
      type: 'invalid',
      kind: 'transient',
      code: 'timeout',
    });
  });
});
