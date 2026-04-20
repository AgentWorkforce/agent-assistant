export interface ModelPricing {
  modelId: string;
  promptUsdPerToken: number;
  completionUsdPerToken: number;
  cachedReadUsdPerToken?: number;
  source: 'openrouter' | 'manual';
  fetchedAt: string;
}

export type PricingTable = Record<string, ModelPricing>;

type OpenRouterModel = {
  id: string;
  pricing: {
    prompt: string | number;
    completion: string | number;
    input_cache_read?: string | number | null;
  };
};

type OpenRouterModelsResponse = {
  data: OpenRouterModel[];
};

const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const FROZEN_FETCHED_AT = '2026-04-20T00:00:00.000Z';

export async function refreshPricingTable(
  options?: { fetchImpl?: typeof fetch; endpoint?: string },
): Promise<PricingTable> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const endpoint = options?.endpoint ?? OPENROUTER_MODELS_ENDPOINT;
  const response = await fetchImpl(endpoint);

  if (!response.ok) {
    throw new Error(
      `Failed to refresh pricing table from OpenRouter: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;
  const fetchedAt = new Date().toISOString();
  const table: PricingTable = {};

  for (const model of payload.data) {
    const pricing: ModelPricing = {
      modelId: model.id,
      promptUsdPerToken: parsePrice(model.pricing.prompt),
      completionUsdPerToken: parsePrice(model.pricing.completion),
      source: 'openrouter',
      fetchedAt,
    };
    const cachedReadUsdPerToken = parseOptionalPrice(model.pricing.input_cache_read);

    if (cachedReadUsdPerToken !== undefined) {
      pricing.cachedReadUsdPerToken = cachedReadUsdPerToken;
    }

    table[model.id] = pricing;
  }

  return table;
}

export function lookupPricing(
  table: PricingTable,
  modelId: string,
): ModelPricing | undefined {
  return table[modelId];
}

export const FROZEN_PRICING_TABLE: PricingTable = {
  'anthropic/claude-sonnet-4.6': {
    modelId: 'anthropic/claude-sonnet-4.6',
    promptUsdPerToken: 0.000003,
    completionUsdPerToken: 0.000015,
    cachedReadUsdPerToken: 0.0000003,
    source: 'manual',
    fetchedAt: FROZEN_FETCHED_AT,
  },
  'anthropic/claude-haiku-4.5': {
    modelId: 'anthropic/claude-haiku-4.5',
    promptUsdPerToken: 0.000001,
    completionUsdPerToken: 0.000005,
    cachedReadUsdPerToken: 0.0000001,
    source: 'manual',
    fetchedAt: FROZEN_FETCHED_AT,
  },
  'openai/gpt-4.1': {
    modelId: 'openai/gpt-4.1',
    promptUsdPerToken: 0.000002,
    completionUsdPerToken: 0.000008,
    cachedReadUsdPerToken: 0.0000005,
    source: 'manual',
    fetchedAt: FROZEN_FETCHED_AT,
  },
  'openai/gpt-4.1-mini': {
    modelId: 'openai/gpt-4.1-mini',
    promptUsdPerToken: 0.0000004,
    completionUsdPerToken: 0.0000016,
    cachedReadUsdPerToken: 0.0000001,
    source: 'manual',
    fetchedAt: FROZEN_FETCHED_AT,
  },
  'openai/gpt-4.1-nano': {
    modelId: 'openai/gpt-4.1-nano',
    promptUsdPerToken: 0.0000001,
    completionUsdPerToken: 0.0000004,
    cachedReadUsdPerToken: 0.000000025,
    source: 'manual',
    fetchedAt: FROZEN_FETCHED_AT,
  },
};

function parsePrice(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

function parseOptionalPrice(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  return parsePrice(value);
}
