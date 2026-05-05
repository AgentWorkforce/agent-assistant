import { describe, expect, it, vi } from 'vitest';

import { OpenRouterExecutionAdapter } from './openrouter-adapter.js';
import type { ExecutionRequest } from './types.js';

function baseRequest(): ExecutionRequest {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    threadId: 'thread-1',
    message: {
      id: 'msg-1',
      text: 'Summarize the current direction.',
      receivedAt: '2026-04-17T12:00:00.000Z',
    },
    instructions: {
      systemPrompt: 'You are Sage.',
      developerPrompt: 'Be direct.',
    },
    context: {
      blocks: [
        {
          id: 'ctx-1',
          label: 'Scope',
          text: 'Only direct OpenRouter proof is in scope.',
          category: 'workspace',
        },
      ],
    },
  };
}

describe('OpenRouterExecutionAdapter', () => {
  it('describes the expected bounded capabilities', () => {
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'test-key' });

    expect(adapter.describeCapabilities()).toMatchObject({
      toolUse: 'none',
      structuredToolCalls: false,
      continuationSupport: 'none',
      approvalInterrupts: 'none',
      traceDepth: 'minimal',
      attachments: false,
      streaming: 'native',
      maxContextStrategy: 'large',
    });
  });

  it('rejects tool-bearing requests during negotiation', () => {
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'test-key' });
    const negotiation = adapter.negotiate({
      ...baseRequest(),
      tools: [{ name: 'lookup_repo', description: 'Lookup repo metadata' }],
    });

    expect(negotiation.supported).toBe(false);
    expect(negotiation.reasons[0]?.code).toBe('tool_use_unsupported');
  });

  it('marks preferred trace depth as degraded', () => {
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'test-key' });
    const negotiation = adapter.negotiate({
      ...baseRequest(),
      requirements: { traceDepth: 'standard' },
    });

    expect(negotiation.supported).toBe(true);
    expect(negotiation.degraded).toBe(true);
    expect(negotiation.reasons[0]?.code).toBe('trace_depth_reduced');
  });

  it('accepts required and preferred streaming because the adapter declares native streaming', () => {
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'test-key' });

    const required = adapter.negotiate({
      ...baseRequest(),
      requirements: { streaming: 'required' },
    });
    const preferred = adapter.negotiate({
      ...baseRequest(),
      requirements: { streaming: 'preferred' },
    });

    expect(required.supported).toBe(true);
    expect(preferred.supported).toBe(true);
    expect(preferred.degraded).toBe(false);
  });

  it('returns cancelled when the execution request signal is already aborted', async () => {
    const abortController = new AbortController();
    abortController.abort();
    const adapter = new OpenRouterExecutionAdapter({
      apiKey: 'test-key',
      fetchImpl: async () => {
        throw new Error('fetch should not be called');
      },
    });

    const result = await adapter.execute({ ...baseRequest(), signal: abortController.signal });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('cancelled');
  });

  it('maps a completed hosted response without tools', async () => {
    const adapter = new OpenRouterExecutionAdapter({
      apiKey: 'test-key',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: 'resp_123',
            choices: [
              {
                message: { content: 'The direction is now explicit.' },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('completed');
    expect(result.output?.text).toBe('The direction is now explicit.');
    expect(result.backendId).toBe('openrouter-api');
    expect(result.trace?.summary.toolCallCount).toBe(0);
    expect(result.metadata).toEqual({ responseId: 'resp_123' });
  });

  it('adds OpenRouter response cache headers for non-streaming execution', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'The direction is cached.' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const adapter = new OpenRouterExecutionAdapter({
      apiKey: 'test-key',
      fetchImpl,
      responseCache: { ttlSeconds: 120 },
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('completed');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'X-OpenRouter-Cache': 'true',
      'X-OpenRouter-Cache-TTL': '120',
    });
  });

  it('enables OpenRouter response caching by default and allows opt-out', async () => {
    const defaultFetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'cached by default' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await new OpenRouterExecutionAdapter({
      apiKey: 'test-key',
      fetchImpl: defaultFetchImpl,
    }).execute(baseRequest());

    expect(defaultFetchImpl.mock.calls[0][1].headers).toMatchObject({
      'X-OpenRouter-Cache': 'true',
    });

    const optOutFetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'fresh' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await new OpenRouterExecutionAdapter({
      apiKey: 'test-key',
      fetchImpl: optOutFetchImpl,
      responseCache: false,
    }).execute(baseRequest());

    expect(optOutFetchImpl.mock.calls[0][1].headers).not.toHaveProperty('X-OpenRouter-Cache');
  });

  it('maps backend HTTP failure to failed result', async () => {
    const adapter = new OpenRouterExecutionAdapter({
      apiKey: 'test-key',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { message: 'Rate limit hit', code: 429 } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('backend_execution_error');
    expect(result.error?.metadata).toEqual({ status: 429, code: 429 });
  });

  it('maps missing assistant text to invalid_backend_output', async () => {
    const adapter = new OpenRouterExecutionAdapter({
      apiKey: 'test-key',
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: {} }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('invalid_backend_output');
  });

  it('returns unsupported for tool-bearing execution requests', async () => {
    const adapter = new OpenRouterExecutionAdapter({ apiKey: 'test-key' });

    const result = await adapter.execute({
      ...baseRequest(),
      tools: [{ name: 'lookup_repo', description: 'Lookup repo metadata' }],
    });

    expect(result.status).toBe('unsupported');
    expect(result.error?.code).toBe('unsupported_capability');
  });
});
