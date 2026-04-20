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

  it('case 10: missing response message returns invalid with explicit reason', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse({ choices: [{}] }),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    const result = await adapter.nextStep(makeInput());

    expect(result.type).toBe('invalid');
    if (result.type === 'invalid') {
      expect(result.reason).toContain('did not include a message choice');
    }
  });

  it('case 11: empty assistant content returns invalid with explicit reason', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse({
        choices: [{ message: { content: '   ' } }],
      }),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    const result = await adapter.nextStep(makeInput());

    expect(result.type).toBe('invalid');
    if (result.type === 'invalid') {
      expect(result.reason).toContain('usable assistant content');
    }
  });
});

describe('OpenRouterModelAdapter context request mapping', () => {
  it('includes every context block label and body text in a system message', async () => {
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
          developerPrompt: 'Use the supplied context.',
        },
        context: {
          blocks: [
            { id: 'b1', label: 'customer-profile', content: 'Customer prefers concise replies.' },
            { id: 'b2', label: 'recent-ticket', content: 'The last ticket mentioned Slack sync.' },
          ],
        },
        message: { id: 'm1', text: 'What should I do next?', receivedAt: '2024-01-01T00:00:00Z' },
      }),
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const messages: Array<{ role: string; content: string }> = body.messages;
    const developerPromptIndex = messages.findIndex(
      (message) => message.role === 'system' && message.content === 'Use the supplied context.',
    );
    const contextMessageIndex = messages.findIndex(
      (message) => message.role === 'system' && message.content.includes('Conversation context:'),
    );
    const userMessageIndex = messages.findIndex(
      (message) => message.role === 'user' && message.content === 'What should I do next?',
    );

    expect(contextMessageIndex).toBeGreaterThan(developerPromptIndex);
    expect(contextMessageIndex).toBeLessThan(userMessageIndex);
    expect(messages[contextMessageIndex].content).toContain('customer-profile');
    expect(messages[contextMessageIndex].content).toContain('Customer prefers concise replies.');
    expect(messages[contextMessageIndex].content).toContain('recent-ticket');
    expect(messages[contextMessageIndex].content).toContain('The last ticket mentioned Slack sync.');
  });

  it('does not add a context system message when input.context is undefined', async () => {
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
      }),
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const messages: Array<{ role: string; content: string }> = body.messages;
    const systemMessages = messages.filter((message) => message.role === 'system');

    expect(systemMessages).toHaveLength(2);
    expect(systemMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'You are a bot.' }),
        expect.objectContaining({ content: 'Be concise.' }),
      ]),
    );
    expect(systemMessages.some((message) => message.content.includes('Conversation context:'))).toBe(
      false,
    );
    expect(systemMessages.some((message) => message.content.includes('Structured context:'))).toBe(
      false,
    );
  });

  it('includes serialized structured context JSON in a system message', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeOkResponse({
        choices: [{ message: { content: 'ok' } }],
      }),
    );
    const structured = {
      customer: { tier: 'enterprise', region: 'us-east' },
      flags: ['slack-sync', 'priority'],
    };
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });
    await adapter.nextStep(
      makeInput({
        context: {
          blocks: [],
          structured,
        },
      }),
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const messages: Array<{ role: string; content: string }> = body.messages;
    const structuredMessage = messages.find(
      (message) => message.role === 'system' && message.content.includes('Structured context:'),
    );

    expect(structuredMessage).toBeDefined();
    expect(structuredMessage?.content).toContain(JSON.stringify(structured, null, 2));
  });
});
