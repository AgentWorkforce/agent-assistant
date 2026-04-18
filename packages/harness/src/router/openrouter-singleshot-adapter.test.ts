import { describe, expect, it, vi } from 'vitest';

import { OpenRouterSingleShotAdapter } from './openrouter-singleshot-adapter.js';
import type { SingleShotInput } from './types.js';

function makeFetchOk(content: string, usage?: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
      ...(usage ? { usage } : {}),
    }),
  });
}

function baseInput(overrides?: Partial<SingleShotInput>): SingleShotInput {
  return {
    message: { id: 'msg-1', text: 'hi', receivedAt: '2026-04-18T00:00:00.000Z' },
    instructions: { systemPrompt: 'You are helpful.' },
    ...overrides,
  };
}

describe('OpenRouterSingleShotAdapter', () => {
  it('returns text from choices[0].message.content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'hi there' } }] }),
    });

    const adapter = new OpenRouterSingleShotAdapter({ apiKey: 'key', fetchImpl });
    const result = await adapter.generate(baseInput());

    expect(result).toEqual({ text: 'hi there' });
  });

  it('request body has no tools field', async () => {
    const fetchImpl = makeFetchOk('ok');
    const adapter = new OpenRouterSingleShotAdapter({ apiKey: 'key', fetchImpl });

    await adapter.generate(baseInput());

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty('tools');
  });

  it('system prompt + threadHistory + user message map correctly', async () => {
    const fetchImpl = makeFetchOk('response');
    const adapter = new OpenRouterSingleShotAdapter({ apiKey: 'key', fetchImpl });

    const threadHistory = [
      { role: 'user' as const, content: 'first user message' },
      { role: 'assistant' as const, content: 'first assistant reply' },
    ];

    await adapter.generate(
      baseInput({
        instructions: { systemPrompt: 'SYS' },
        threadHistory,
        message: { id: 'msg-2', text: 'hi', receivedAt: '2026-04-18T00:00:00.000Z' },
      }),
    );

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const messages = body.messages as Array<{ role: string; content: string }>;

    expect(messages[0]).toMatchObject({ role: 'system', content: 'SYS' });
    expect(messages[1]).toMatchObject({ role: 'user', content: 'first user message' });
    expect(messages[2]).toMatchObject({ role: 'assistant', content: 'first assistant reply' });
    expect(messages[3]).toMatchObject({ role: 'user', content: 'hi' });
    expect(messages).toHaveLength(4);
  });

  it('developerPrompt produces a second system message', async () => {
    const fetchImpl = makeFetchOk('response');
    const adapter = new OpenRouterSingleShotAdapter({ apiKey: 'key', fetchImpl });

    await adapter.generate(
      baseInput({
        instructions: { systemPrompt: 'SYS', developerPrompt: 'DEV' },
      }),
    );

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const messages = body.messages as Array<{ role: string; content: string }>;

    expect(messages[1].role).toBe('system');
    expect(messages[1].content).toBe('DEV');
  });

  it('throws on HTTP error including status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'boom' } }),
    });

    const adapter = new OpenRouterSingleShotAdapter({ apiKey: 'key', fetchImpl });

    await expect(adapter.generate(baseInput())).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining('boom'),
      }),
    );

    await expect(adapter.generate(baseInput())).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining('500'),
      }),
    );
  });

  it('throws on timeout', async () => {
    const fetchImpl = vi.fn().mockReturnValue(new Promise(() => {}));
    const adapter = new OpenRouterSingleShotAdapter({
      apiKey: 'key',
      fetchImpl,
      timeoutMs: 50,
    });

    await expect(adapter.generate(baseInput())).rejects.toThrow(/timed out/i);
  });

  it('throws when apiKey missing', async () => {
    const adapter = new OpenRouterSingleShotAdapter({});

    await expect(adapter.generate(baseInput())).rejects.toThrow(/API key/i);
  });

  it('maps usage when present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const adapter = new OpenRouterSingleShotAdapter({ apiKey: 'key', fetchImpl });
    const result = await adapter.generate(baseInput());

    expect(result.usage).toBeDefined();
    expect(result.usage?.inputTokens).toBe(10);
    expect(result.usage?.outputTokens).toBe(5);
  });

  it('throws when message content missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: {} }] }),
    });

    const adapter = new OpenRouterSingleShotAdapter({ apiKey: 'key', fetchImpl });

    await expect(adapter.generate(baseInput())).rejects.toThrow(/content/i);
  });
});
