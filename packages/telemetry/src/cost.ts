import type { HarnessUsage } from '@agent-assistant/harness';
import type { PricingTable } from './pricing.js';

export interface CostResult {
  usd: number;
  missingPricing: boolean;
}

export function computeCost(
  usage: Pick<HarnessUsage, 'inputTokens' | 'outputTokens'>,
  modelId: string,
  table: PricingTable,
): CostResult {
  const pricing = table[modelId];

  if (pricing === undefined) {
    return { usd: 0, missingPricing: true };
  }

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  return {
    usd:
      inputTokens * pricing.promptUsdPerToken +
      outputTokens * pricing.completionUsdPerToken,
    missingPricing: false,
  };
}
