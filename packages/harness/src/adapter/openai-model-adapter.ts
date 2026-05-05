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
  readSseFrames,
  readString,
  safeParseJson,
  type ProviderFetch,
} from './provider-error-mapping.js';

export interface OpenAIModelAdapterConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  fetchImpl?: ProviderFetch;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  responseFormat?: Record<string, unknown>;
}

const DEFAULT_MODEL = 'gpt-5-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1/chat/completions';

function invalid(
  kind: NonNullable<HarnessInvalidOutput['kind']>,
  reason: string,
  extra: Partial<HarnessInvalidOutput> = {},
): HarnessInvalidOutput {
  return { type: 'invalid', kind, reason, ...extra };
}

function mapTool(tool: HarnessToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object' },
    },
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

function buildBody(
  input: HarnessModelInput,
  config: Pick<OpenAIModelAdapterConfig, 'maxTokens' | 'responseFormat'>,
  model: string,
): Record<string, unknown> {
  const messages = [
    { role: 'system', content: input.instructions.systemPrompt },
    ...(input.instructions.developerPrompt?.trim()
      ? [{ role: 'developer', content: input.instructions.developerPrompt }]
      : []),
    ...(transcriptText(input) ? [{ role: 'assistant', content: transcriptText(input) }] : []),
    { role: 'user', content: input.message.text },
  ];
  return {
    model,
    messages,
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    ...(config.responseFormat ? { response_format: config.responseFormat } : {}),
    ...(input.availableTools.length > 0 ? { tools: input.availableTools.map(mapTool), tool_choice: 'auto' } : {}),
  };
}

function parseToolCalls(value: unknown): HarnessToolCall[] | HarnessInvalidOutput {
  if (!Array.isArray(value)) return [];
  const calls: HarnessToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.function)) continue;
    const id = readString(item.id);
    const name = readString(item.function.name);
    const input = parseToolArguments(item.function.arguments);
    if (!id || !name || input === null) {
      return invalid('schema_mismatch', 'OpenAI tool call was malformed', {
        code: 'invalid_request',
        raw: item,
      });
    }
    calls.push({ id, name, input });
  }
  return calls;
}

function outputFromBody(body: Record<string, unknown>, model: string): HarnessModelOutput {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : undefined;
  const message = isRecord(first?.message) ? first.message : undefined;
  if (!message) {
    return invalid('missing_message', 'OpenAI response did not include a message choice', {
      code: 'unknown',
      raw: body,
      metadata: { modelId: model },
    });
  }

  const refusal = readString(message.refusal);
  if (refusal) return { type: 'refusal', reason: refusal, metadata: { modelId: model, id: body.id } };

  const calls = parseToolCalls(message.tool_calls);
  if (!Array.isArray(calls)) return calls;
  if (calls.length > 0) return { type: 'tool_request', calls, metadata: { modelId: model, id: body.id } };

  const text = readString(message.content);
  if (text) return { type: 'final_answer', text, metadata: { modelId: model, id: body.id } };

  return invalid('empty_response', 'OpenAI response did not include usable assistant content', {
    code: 'unknown',
    raw: body,
    metadata: { modelId: model },
  });
}

export class OpenAIModelAdapter implements HarnessModelAdapter {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly fetchImpl: ProviderFetch;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly maxTokens?: number;
  private readonly responseFormat?: Record<string, unknown>;

  constructor(config: OpenAIModelAdapterConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.fetchImpl = config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.maxTokens = config.maxTokens;
    this.responseFormat = config.responseFormat;
  }

  async nextStep(input: HarnessModelInput): Promise<HarnessModelOutput> {
    if (!this.apiKey) {
      return invalid('provider_error', 'OpenAI API key is not configured.', { code: 'auth_failed', metadata: { modelId: this.model } });
    }

    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          ...this.defaultHeaders,
        },
        body: JSON.stringify(buildBody(input, {
          maxTokens: this.maxTokens,
          responseFormat: this.responseFormat,
        }, this.model)),
        signal: input.signal,
      });
      const { text, json } = await readJsonResponse(response);
      if (!response.ok) {
        const error = isRecord(json?.error) ? json.error : undefined;
        const message = readString(error?.message) ?? text;
        return invalid(isTransientProviderStatus(response.status) ? 'transient' : 'provider_error', message, {
          code: classifyProviderError(response.status, message),
          httpStatus: response.status,
          raw: json,
          metadata: { modelId: this.model },
        });
      }
      return json ? outputFromBody(json, this.model) : invalid('provider_error', 'OpenAI response body was not valid JSON', { code: 'unknown' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown OpenAI error';
      return invalid('transient', message, { code: classifyProviderError(undefined, message), metadata: { modelId: this.model } });
    }
  }

  /**
   * Native streaming via OpenAI Chat Completions SSE (`stream: true`).
   * Emits text deltas through `onDelta` and resolves with the final
   * assembled {@link HarnessModelOutput}. Tool calls are accumulated by
   * function index and surfaced as a `tool_request` after the stream ends.
   */
  async streamStep(
    input: HarnessModelInput,
    onDelta: (delta: string) => void,
  ): Promise<HarnessModelOutput> {
    if (!this.apiKey) {
      return invalid('provider_error', 'OpenAI API key is not configured.', { code: 'auth_failed', metadata: { modelId: this.model } });
    }

    let response: Response | undefined;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...this.defaultHeaders,
        },
        body: JSON.stringify({
          ...buildBody(input, { maxTokens: this.maxTokens, responseFormat: this.responseFormat }, this.model),
          stream: true,
        }),
        signal: input.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return invalid(isTransientProviderStatus(response.status) ? 'transient' : 'provider_error', text || `OpenAI stream failed (${response.status})`, {
          code: classifyProviderError(response.status, text),
          httpStatus: response.status,
          metadata: { modelId: this.model },
        });
      }
      if (!response.body) {
        return invalid('empty_response', 'OpenAI streaming response had no body', { code: 'unknown', metadata: { modelId: this.model } });
      }

      let accumulatedText = '';
      let refusal: string | undefined;
      let id: string | undefined;
      const toolCalls = new Map<number, { id?: string; name?: string; argsJson: string }>();

      for await (const frame of readSseFrames(response.body)) {
        if (frame === '[DONE]') break;
        const json = safeParseJson(frame);
        if (!isRecord(json)) continue;
        if (!id) id = readString(json.id);
        const choices = Array.isArray(json.choices) ? json.choices : [];
        const choice = isRecord(choices[0]) ? choices[0] : undefined;
        if (!choice) continue;
        const delta = isRecord(choice.delta) ? choice.delta : undefined;
        if (!delta) continue;
        const content = readString(delta.content);
        if (content) {
          accumulatedText += content;
          onDelta(content);
        }
        const refusalChunk = readString(delta.refusal);
        if (refusalChunk) {
          refusal = (refusal ?? '') + refusalChunk;
        }
        const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
        for (const call of calls) {
          if (!isRecord(call)) continue;
          const index = typeof call.index === 'number' ? call.index : 0;
          const slot = toolCalls.get(index) ?? { argsJson: '' };
          if (!slot.id) slot.id = readString(call.id);
          if (isRecord(call.function)) {
            const fnName = readString(call.function.name);
            if (fnName) slot.name = fnName;
            const argChunk = readString(call.function.arguments);
            if (argChunk !== undefined) slot.argsJson += argChunk;
          }
          toolCalls.set(index, slot);
        }
      }

      if (toolCalls.size > 0) {
        const calls = [...toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, slot]) => {
            if (!slot.id || !slot.name) return null;
            const parsed = parseToolArguments(slot.argsJson || '{}');
            if (parsed === null) return null;
            return { id: slot.id, name: slot.name, input: parsed };
          });
        if (calls.some((call) => call === null)) {
          return invalid('schema_mismatch', 'OpenAI streamed tool call was malformed', {
            code: 'invalid_request',
            metadata: { modelId: this.model },
          });
        }
        return { type: 'tool_request', calls: calls as HarnessToolCall[], metadata: { modelId: this.model, id } };
      }

      if (refusal) {
        return { type: 'refusal', reason: refusal, metadata: { modelId: this.model, id } };
      }
      if (accumulatedText) {
        return { type: 'final_answer', text: accumulatedText, metadata: { modelId: this.model, id } };
      }
      return invalid('empty_response', 'OpenAI stream completed without content', { code: 'unknown', metadata: { modelId: this.model } });
    } catch (error) {
      if (response?.body && !response.bodyUsed) {
        await response.body.cancel().catch(() => {});
      }
      const message = error instanceof Error ? error.message : 'Unknown OpenAI streaming error';
      return invalid('transient', message, { code: classifyProviderError(undefined, message), metadata: { modelId: this.model } });
    }
  }
}

export function createOpenAIModelAdapter(config?: OpenAIModelAdapterConfig): HarnessModelAdapter {
  return new OpenAIModelAdapter(config);
}
