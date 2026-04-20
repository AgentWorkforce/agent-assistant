import { describe, expect, it } from 'vitest';

import { computeCost } from '../src/cost.js';
import { FROZEN_PRICING_TABLE } from '../src/pricing.js';

describe('computeCost', () => {
  it('computes USD for a known model and reports pricing as present', () => {
    const cost = computeCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      'anthropic/claude-sonnet-4.6',
      FROZEN_PRICING_TABLE,
    );

    expect(cost).toEqual({
      usd: 18,
      missingPricing: false,
    });
  });

  it('returns zero USD and missingPricing for an unknown model', () => {
    const cost = computeCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      'unknown/model',
      FROZEN_PRICING_TABLE,
    );

    expect(cost).toEqual({
      usd: 0,
      missingPricing: true,
    });
  });

  it('returns zero USD for zero tokens', () => {
    const cost = computeCost(
      { inputTokens: 0, outputTokens: 0 },
      'openai/gpt-4.1',
      FROZEN_PRICING_TABLE,
    );

    expect(cost).toEqual({
      usd: 0,
      missingPricing: false,
    });
  });
});
