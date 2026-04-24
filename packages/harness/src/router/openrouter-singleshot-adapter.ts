import type { HarnessUsage } from '../types.js';
import type { SingleShotAdapter, SingleShotInput, SingleShotResult } from './types.js';

export interface OpenRouterSingleShotAdapterConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  defaultTemperature?: number;
}

const DEFAULT_MODEL = 'anthropic/claude-haiku-4-5';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 30_000;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterRequestBody {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}

interface OpenRouterResponseBody {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string | number };
}

function mapUsage(raw: OpenRouterResponseBody['usage']): HarnessUsage | undefined {
  if (!raw) return undefined;
  const usage: HarnessUsage = {};
  if (raw.prompt_tokens !== undefined) usage.inputTokens = raw.prompt_tokens;
  if (raw.completion_tokens !== undefined) usage.outputTokens = raw.completion_tokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

export class OpenRouterSingleShotAdapter implements SingleShotAdapter {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly defaultTemperature?: number;

  constructor(config: OpenRouterSingleShotAdapterConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    // See .claude/rules/workers-fetch.md — read `globalThis.fetch` at call
    // time, not module load, to survive Workers + nodejs_compat + esbuild.
    this.fetchImpl =
      config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultTemperature = config.defaultTemperature;
  }

  async generate(input: SingleShotInput): Promise<SingleShotResult> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is not configured.');
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: input.instructions.systemPrompt },
    ];

    if (input.instructions.developerPrompt?.trim()) {
      messages.push({ role: 'system', content: input.instructions.developerPrompt });
    }

    if (input.threadHistory) {
      for (const entry of input.threadHistory) {
        messages.push({ role: entry.role, content: entry.content });
      }
    }

    messages.push({ role: 'user', content: input.message.text });

    const requestBody: OpenRouterRequestBody = {
      model: this.model,
      messages,
      ...(this.defaultTemperature !== undefined ? { temperature: this.defaultTemperature } : {}),
    };

    const abortController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        abortController.abort();
        reject(new Error('OpenRouter single-shot request timed out'));
      }, this.timeoutMs);
    });

    try {
      const response = await Promise.race([
        this.fetchImpl(this.baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        }),
        timeoutPromise,
      ]);

      const body = (await response.json()) as OpenRouterResponseBody;

      if (!response.ok) {
        const detail = body.error?.message ? `${body.error.message} (HTTP ${response.status})` : `HTTP ${response.status}`;
        throw new Error(`OpenRouter request failed: ${detail}`);
      }

      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('OpenRouter response did not include assistant content');
      }

      const usage = mapUsage(body.usage);
      return { text: content, ...(usage ? { usage } : {}) };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('OpenRouter single-shot request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export function createOpenRouterSingleShotAdapter(
  config?: OpenRouterSingleShotAdapterConfig,
): SingleShotAdapter {
  return new OpenRouterSingleShotAdapter(config);
}
