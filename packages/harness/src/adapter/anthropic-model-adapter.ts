import type {
  HarnessInvalidOutput,
  HarnessModelAdapter,
  HarnessModelInput,
  HarnessModelOutput,
  HarnessToolCall,
  HarnessToolDefinition,
} from '../types.js';
import {
  classifyProviderError,
  isRecord,
  isTransientProviderStatus,
  parseToolArguments,
  readJsonResponse,
  readString,
  type ProviderFetch,
} from './provider-error-mapping.js';

export interface AnthropicModelAdapterConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  fetchImpl?: ProviderFetch;
  baseUrl?: string;
  cacheTrailingTranscriptItems?: number;
  defaultHeaders?: Record<string, string>;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MAX_TOKENS = 4096;

function invalid(
  kind: NonNullable<HarnessInvalidOutput['kind']>,
  reason: string,
  extra: Partial<HarnessInvalidOutput> = {},
): HarnessInvalidOutput {
  return { type: 'invalid', kind, reason, ...extra };
}

function mapTool(tool: HarnessToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema ?? { type: 'object' },
  };
}

function transcriptText(input: HarnessModelInput): string {
  return input.transcript
    .map((item) => {
      if (item.type === 'assistant_step') return item.text ?? `[${item.outputType}]`;
      if (item.type === 'tool_result') return `Tool ${item.result.toolName}: ${item.result.output ?? JSON.stringify(item.result.structuredOutput ?? {})}`;
      if (item.type === 'clarification_request') return `Clarification requested: ${item.question}`;
      return `Approval requested: ${item.request.summary}`;
    })
    .join('\n');
}

function buildBody(input: HarnessModelInput, model: string, maxTokens: number): Record<string, unknown> {
  const systemBlocks = [{ type: 'text', text: input.instructions.systemPrompt }];
  if (input.instructions.developerPrompt?.trim()) {
    systemBlocks.push({ type: 'text', text: input.instructions.developerPrompt });
  }

  const prior = transcriptText(input);
  const content = [prior, input.message.text].filter(Boolean).join('\n\nUser: ');
  return {
    model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: [{ role: 'user', content }],
    ...(input.availableTools.length > 0
      ? { tools: input.availableTools.map(mapTool), tool_choice: { type: 'auto' } }
      : {}),
  };
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (isRecord(part) && part.type === 'text' ? readString(part.text) : undefined))
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
    .trim();
}

function toolCallsFromContent(content: unknown): HarnessToolCall[] | HarnessInvalidOutput {
  if (!Array.isArray(content)) return [];
  const calls: HarnessToolCall[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== 'tool_use') continue;
    const id = readString(part.id);
    const name = readString(part.name);
    const input = parseToolArguments(part.input);
    if (!id || !name || input === null) {
      return invalid('schema_mismatch', 'Anthropic tool_use block was malformed', {
        code: 'invalid_request',
        raw: part,
      });
    }
    calls.push({ id, name, input });
  }
  return calls;
}

function outputFromBody(body: Record<string, unknown>, model: string): HarnessModelOutput {
  if (body.stop_reason === 'refusal') {
    return { type: 'refusal', reason: textFromContent(body.content) || 'Model refused the request', metadata: { modelId: model, raw: body } };
  }

  const calls = toolCallsFromContent(body.content);
  if (!Array.isArray(calls)) return calls;
  if (calls.length > 0) return { type: 'tool_request', calls, metadata: { modelId: model, id: body.id } };

  const text = textFromContent(body.content);
  if (text) return { type: 'final_answer', text, metadata: { modelId: model, id: body.id } };

  return invalid('empty_response', 'Anthropic response did not include usable content', {
    code: 'unknown',
    raw: body,
    metadata: { modelId: model },
  });
}

export class AnthropicModelAdapter implements HarnessModelAdapter {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly fetchImpl: ProviderFetch;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: AnthropicModelAdapterConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.fetchImpl = config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultHeaders = config.defaultHeaders ?? {};
  }

  async nextStep(input: HarnessModelInput): Promise<HarnessModelOutput> {
    if (!this.apiKey) {
      return invalid('provider_error', 'Anthropic API key is not configured.', { code: 'auth_failed', metadata: { modelId: this.model } });
    }

    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          ...this.defaultHeaders,
        },
        body: JSON.stringify(buildBody(input, this.model, this.maxTokens)),
        signal: input.signal,
      });
      const { text, json } = await readJsonResponse(response);
      if (!response.ok) {
        const message = readString(json?.error) ?? (isRecord(json?.error) ? readString(json.error.message) : undefined) ?? text;
        return invalid(isTransientProviderStatus(response.status) ? 'transient' : 'provider_error', message, {
          code: classifyProviderError(response.status, message),
          httpStatus: response.status,
          raw: json,
          metadata: { modelId: this.model },
        });
      }
      return json ? outputFromBody(json, this.model) : invalid('provider_error', 'Anthropic response body was not valid JSON', { code: 'unknown' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Anthropic error';
      return invalid('transient', message, { code: classifyProviderError(undefined, message), metadata: { modelId: this.model } });
    }
  }
}

export function createAnthropicModelAdapter(config?: AnthropicModelAdapterConfig): HarnessModelAdapter {
  return new AnthropicModelAdapter(config);
}
