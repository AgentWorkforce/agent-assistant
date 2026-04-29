import { describe, expect, it, vi } from 'vitest';
import {
  classifyOpenRouterError,
  OpenRouterModelAdapter,
} from './openrouter-model-adapter.js';
import type { HarnessInvalidOutput, HarnessModelInput } from '../types.js';

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

function makeJsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function makeMalformedJsonResponse(status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
  } as Response);
}

function expectInvalid(result: Awaited<ReturnType<OpenRouterModelAdapter['nextStep']>>): HarnessInvalidOutput {
  expect(result.type).toBe('invalid');
  return result as HarnessInvalidOutput;
}

describe('OpenRouterModelAdapter error codes', () => {
  it('maps 402 credit errors to provider_error + credits_exhausted', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'You need more credits to continue.' } }, 402),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('provider_error');
    expect(result.code).toBe('credits_exhausted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps 429 responses to transient + rate_limited', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'Too many requests' } }, 429),
    );
    const adapter = new OpenRouterModelAdapter({
      apiKey: 'test-key',
      fetchImpl,
      transientRetryDelayMs: 0,
    });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('transient');
    expect(result.code).toBe('rate_limited');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps 408 responses to transient + timeout', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'Request timeout' } }, 408),
    );
    const adapter = new OpenRouterModelAdapter({
      apiKey: 'test-key',
      fetchImpl,
      transientRetryDelayMs: 0,
    });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('transient');
    expect(result.code).toBe('timeout');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps 401 responses to provider_error + auth_failed', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'Unauthorized' } }, 401),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('provider_error');
    expect(result.code).toBe('auth_failed');
  });

  it('maps 403 responses to provider_error + auth_failed', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'Forbidden' } }, 403),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('provider_error');
    expect(result.code).toBe('auth_failed');
  });

  it('maps 400 responses to provider_error + invalid_request', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'Invalid request payload' } }, 400),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('provider_error');
    expect(result.code).toBe('invalid_request');
  });

  it('maps 404 responses to provider_error + model_not_found', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'Model not found' } }, 404),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('provider_error');
    expect(result.code).toBe('model_not_found');
  });

  it('maps 500 responses to transient + unknown', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'Internal server error' } }, 500),
    );
    const adapter = new OpenRouterModelAdapter({
      apiKey: 'test-key',
      fetchImpl,
      transientRetryDelayMs: 0,
    });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('transient');
    expect(result.code).toBe('unknown');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('prefers context length error text over an otherwise unrelated status code', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'Context length exceeded for this model.' } }, 418),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.code).toBe('context_length_exceeded');
  });

  it('prefers insufficient-credit text over an otherwise unrelated status code', async () => {
    const fetchImpl = vi.fn().mockReturnValue(
      makeJsonResponse({ error: { message: 'Insufficient balance for this request.' } }, 418),
    );
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.code).toBe('credits_exhausted');
  });

  it('maps AbortError timeouts to transient + timeout', async () => {
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
      timeoutMs: 10,
      transientRetryDelayMs: 0,
    });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('transient');
    expect(result.code).toBe('timeout');
    expect(result.reason).toBe('timeout');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps thrown generic credit errors to transient + credits_exhausted', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('openrouter says you need more credits'));
    const adapter = new OpenRouterModelAdapter({
      apiKey: 'test-key',
      fetchImpl,
      transientRetryDelayMs: 0,
    });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('transient');
    expect(result.code).toBe('credits_exhausted');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps ok responses with malformed JSON to provider_error + unknown', async () => {
    const fetchImpl = vi.fn().mockReturnValue(makeMalformedJsonResponse());
    const adapter = new OpenRouterModelAdapter({ apiKey: 'test-key', fetchImpl });

    const result = expectInvalid(await adapter.nextStep(makeInput()));

    expect(result.kind).toBe('provider_error');
    expect(result.code).toBe('unknown');
    expect(result.reason).toContain('not valid JSON');
  });

  it('preserves the pre-existing kind split for 429 and 402 credit failures', async () => {
    const rateLimitedAdapter = new OpenRouterModelAdapter({
      apiKey: 'test-key',
      fetchImpl: vi.fn().mockReturnValue(
        makeJsonResponse({ error: { message: 'Too many requests' } }, 429),
      ),
      transientRetryDelayMs: 0,
    });
    const creditsAdapter = new OpenRouterModelAdapter({
      apiKey: 'test-key',
      fetchImpl: vi.fn().mockReturnValue(
        makeJsonResponse({ error: { message: 'Please add more credits.' } }, 402),
      ),
    });

    const rateLimited = expectInvalid(await rateLimitedAdapter.nextStep(makeInput()));
    const credits = expectInvalid(await creditsAdapter.nextStep(makeInput()));

    expect(rateLimited.kind).toBe('transient');
    expect(rateLimited.code).toBe('rate_limited');
    expect(credits.kind).toBe('provider_error');
    expect(credits.code).toBe('credits_exhausted');
  });

  it('classifies helper-level 429 errors as rate_limited', () => {
    expect(classifyOpenRouterError(429, 'too many requests')).toBe('rate_limited');
  });
});
