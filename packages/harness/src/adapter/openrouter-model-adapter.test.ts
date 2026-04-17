import { describe, it, expect, vi } from 'vitest';
import { OpenRouterModelAdapter } from './openrouter-model-adapter.js';
import type { HarnessModelInput, HarnessToolDefinition } from '../types.js';

function makeInput(overrides: Partial<HarnessModelInput> = {}): HarnessModelInput {
  return {
    assistantId: 'a1',
    turnId: 't1',
    message: { id: 'm1', text: 'Hello', receivedAt: '2024-01-01T00:00:00Z' },
    instructions: { systemPrompt: 'You are helpful.' },
    transcript: [],
    availableTools: [],
    iteration: 0,
    toolCallCount: 0,
    elapsedMs: 0,
    ...overrides,
  };
}

function makeOkResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('OpenRouterModelAdapter', () => {
  it('case 1: returns final_answer when response has no tool_calls', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse({
        choices: [{ message: { content: 'Hi there!', tool_calls: undefined } }],
      }),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    const result = await adapter.nextStep(makeInput());

    expect(result.type).toBe('final_answer');
    if (result.type === 'final_answer') {
      expect(result.text).toBe('Hi there!');
    }
  });

  it('case 2: returns tool_request with id, name, parsed input when response has tool_calls', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: { name: 'search', arguments: '{"query":"test"}' },
                },
              ],
            },
          },
        ],
      }),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    const result = await adapter.nextStep(makeInput());

    expect(result.type).toBe('tool_request');
    if (result.type === 'tool_request') {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].id).toBe('call_abc');
      expect(result.calls[0].name).toBe('search');
      expect(result.calls[0].input).toEqual({ query: 'test' });
    }
  });

  it('case 3: forwards availableTools as OpenAI tool descriptors in request body', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse({
        choices: [{ message: { content: 'done' } }],
      }),
    );
    const tools: HarnessToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get current weather',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ];
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    await adapter.nextStep(makeInput({ availableTools: tools }));

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    });
    expect(body.tool_choice).toBe('auto');
  });

  it('case 4: maps system + developerPrompt + transcript to messages array correctly', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse({
        choices: [{ message: { content: 'ok' } }],
      }),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    await adapter.nextStep(
      makeInput({
        instructions: {
          systemPrompt: 'You are a bot.',
          developerPrompt: 'Be concise.',
        },
        transcript: [
          { type: 'assistant_step', iteration: 0, outputType: 'final_answer', text: 'Hello!' },
        ],
        message: { id: 'm1', text: 'Follow-up question', receivedAt: '2024-01-01T00:00:00Z' },
      }),
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const messages: Array<{ role: string; content: string }> = body.messages;

    expect(messages[0]).toMatchObject({ role: 'system', content: 'You are a bot.' });
    expect(messages[1]).toMatchObject({ role: 'system', content: 'Be concise.' });
    expect(messages[2]).toMatchObject({ role: 'assistant', content: 'Hello!' });
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'user',
      content: 'Follow-up question',
    });
  });

  it('case 5: HTTP error returns { type:"invalid", reason } with API error message', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse(
        { error: { message: 'Invalid model specified', code: 'invalid_model' } },
        400,
      ),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    const result = await adapter.nextStep(makeInput());

    expect(result.type).toBe('invalid');
    if (result.type === 'invalid') {
      expect(result.reason).toBe('Invalid model specified');
    }
  });

  it('case 6: timeout via never-resolving fetchImpl returns { type:"invalid", reason:"timeout" }', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    const adapter = new OpenRouterModelAdapter({
      apiKey: 'test-key',
      fetchImpl,
      timeoutMs: 50,
    });
    const result = await adapter.nextStep(makeInput());

    expect(result.type).toBe('invalid');
    if (result.type === 'invalid') {
      expect(result.reason).toBe('timeout');
    }
  }, 3000);

  it('case 7: maps usage from body.usage (prompt_tokens, completion_tokens, total_tokens)', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse({
        choices: [{ message: { content: 'done' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    const result = await adapter.nextStep(makeInput());

    expect(result.type).toBe('final_answer');
    if (result.type === 'final_answer') {
      expect(result.usage).toBeDefined();
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(20);
    }
  });

  it('case 8: missing apiKey returns { type:"invalid", reason includes "API key" }', async () => {
    const fetchImpl = vi.fn();
    const adapter = new OpenRouterModelAdapter({ fetchImpl });
    const result = await adapter.nextStep(makeInput());

    expect(result.type).toBe('invalid');
    if (result.type === 'invalid') {
      expect(result.reason.toLowerCase()).toContain('api key');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('case 9: malformed tool_call arguments returns { type:"invalid", reason includes "JSON" }', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_bad',
                  type: 'function',
                  function: { name: 'broken_tool', arguments: 'NOT_VALID_JSON' },
                },
              ],
            },
          },
        ],
      }),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    const result = await adapter.nextStep(makeInput());

    expect(result.type).toBe('invalid');
    if (result.type === 'invalid') {
      expect(result.reason.toUpperCase()).toContain('JSON');
    }
  });
});
