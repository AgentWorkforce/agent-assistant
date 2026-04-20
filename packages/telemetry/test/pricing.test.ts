import { describe, expect, it, vi } from 'vitest';

import {
  FROZEN_PRICING_TABLE,
  lookupPricing,
  refreshPricingTable,
} from '../src/pricing.js';

describe('refreshPricingTable', () => {
  it('parses an injected OpenRouter /models response into numeric pricing entries', async () => {
    const fixture = {
      data: [
        {
          id: 'provider/model-a',
          pricing: {
            prompt: '0.00000125',
            completion: '0.0000045',
            input_cache_read: '0.00000025',
          },
        },
        {
          id: 'provider/model-b',
          pricing: {
            prompt: 0.000002,
            completion: 0.000006,
          },
        },
      ],
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => fixture,
    })) as unknown as typeof fetch;

    const table = await refreshPricingTable({
      endpoint: 'https://example.test/models',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/models');
    expect(table['provider/model-a']).toMatchObject({
      modelId: 'provider/model-a',
      promptUsdPerToken: 0.00000125,
      completionUsdPerToken: 0.0000045,
      cachedReadUsdPerToken: 0.00000025,
      source: 'openrouter',
    });
    expect(table['provider/model-b']).toMatchObject({
      modelId: 'provider/model-b',
      promptUsdPerToken: 0.000002,
      completionUsdPerToken: 0.000006,
      source: 'openrouter',
    });
    expect(table['provider/model-b']?.cachedReadUsdPerToken).toBeUndefined();
    expect(typeof table['provider/model-a']?.fetchedAt).toBe('string');
  });
});

describe('lookupPricing', () => {
  it('returns the matching entry and undefined on miss', () => {
    const entry = FROZEN_PRICING_TABLE['openai/gpt-4.1'];

    expect(lookupPricing(FROZEN_PRICING_TABLE, 'openai/gpt-4.1')).toBe(entry);
    expect(lookupPricing(FROZEN_PRICING_TABLE, 'missing/model')).toBeUndefined();
  });
});

describe('FROZEN_PRICING_TABLE', () => {
  it('contains the five known models with exact manual prices', () => {
    expect(FROZEN_PRICING_TABLE).toEqual({
      'anthropic/claude-sonnet-4.6': {
        modelId: 'anthropic/claude-sonnet-4.6',
        promptUsdPerToken: 0.000003,
        completionUsdPerToken: 0.000015,
        cachedReadUsdPerToken: 0.0000003,
        source: 'manual',
        fetchedAt: '2026-04-20T00:00:00.000Z',
      },
      'anthropic/claude-haiku-4.5': {
        modelId: 'anthropic/claude-haiku-4.5',
        promptUsdPerToken: 0.000001,
        completionUsdPerToken: 0.000005,
        cachedReadUsdPerToken: 0.0000001,
        source: 'manual',
        fetchedAt: '2026-04-20T00:00:00.000Z',
      },
      'openai/gpt-4.1': {
        modelId: 'openai/gpt-4.1',
        promptUsdPerToken: 0.000002,
        completionUsdPerToken: 0.000008,
        cachedReadUsdPerToken: 0.0000005,
        source: 'manual',
        fetchedAt: '2026-04-20T00:00:00.000Z',
      },
      'openai/gpt-4.1-mini': {
        modelId: 'openai/gpt-4.1-mini',
        promptUsdPerToken: 0.0000004,
        completionUsdPerToken: 0.0000016,
        cachedReadUsdPerToken: 0.0000001,
        source: 'manual',
        fetchedAt: '2026-04-20T00:00:00.000Z',
      },
      'openai/gpt-4.1-nano': {
        modelId: 'openai/gpt-4.1-nano',
        promptUsdPerToken: 0.0000001,
        completionUsdPerToken: 0.0000004,
        cachedReadUsdPerToken: 0.000000025,
        source: 'manual',
        fetchedAt: '2026-04-20T00:00:00.000Z',
      },
    });
  });
});
