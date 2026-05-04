import type {
  HarnessInvalidOutput,
  HarnessModelAdapter,
  HarnessModelInput,
  HarnessModelOutput,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessTranscriptItem,
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

function renderTranscriptItem(item: HarnessTranscriptItem): string {
  if (item.type === 'assistant_step') return item.text ?? `[${item.outputType}]`;
  if (item.type === 'tool_result')
    return `Tool ${item.result.toolName}: ${item.result.output ?? JSON.stringify(item.result.structuredOutput ?? {})}`;
  if (item.type === 'clarification_request') return `Clarification requested: ${item.question}`;
  return `Approval requested: ${item.request.summary}`;
}

const EPHEMERAL_CACHE: Record<string, unknown> = { type: 'ephemeral' };

function buildBody(
  input: HarnessModelInput,
  model: string,
  maxTokens: number,
  cacheTrailingTranscriptItems: number | undefined,
): Record<string, unknown> {
  const systemBlocks: Array<Record<string, unknown>> = [
    { type: 'text', text: input.instructions.systemPrompt },
  ];
  if (input.instructions.developerPrompt?.trim()) {
    systemBlocks.push({ type: 'text', text: input.instructions.developerPrompt });
  }
  // Always cache the system prompt — it's the most stable, heaviest repeated input.
  // Anthropic supports up to 4 cache breakpoints per request; the cache_control marker
  // anchors at the LAST block bearing it, caching everything up to and including that
  // block. Putting it on the trailing system block caches the full system surface.
  systemBlocks[systemBlocks.length - 1] = {
    ...systemBlocks[systemBlocks.length - 1],
    cache_control: EPHEMERAL_CACHE,
  };

  // Split transcript into a stable prefix (cached) and a trailing tail (fresh).
  // When cacheTrailingTranscriptItems is N and the transcript has > N items, the
  // first (length - N) items become a cacheable text block and the last N items
  // are concatenated into the live user message. When the value is 0 or undefined,
  // or when the transcript is too short, we don't add a transcript-prefix breakpoint.
  const transcript = input.transcript;
  const trailing =
    typeof cacheTrailingTranscriptItems === 'number' && cacheTrailingTranscriptItems > 0
      ? cacheTrailingTranscriptItems
      : 0;
  const splitAt = trailing > 0 && transcript.length > trailing ? transcript.length - trailing : -1;
  const cachedPrefixItems = splitAt > 0 ? transcript.slice(0, splitAt) : [];
  const livePriorItems = splitAt > 0 ? transcript.slice(splitAt) : transcript;

  const livePrior = livePriorItems.map(renderTranscriptItem).join('\n');
  const liveText = [livePrior, input.message.text].filter(Boolean).join('\n\nUser: ');

  const userContent: Array<Record<string, unknown>> = [];
  if (cachedPrefixItems.length > 0) {
    userContent.push({
      type: 'text',
      text: cachedPrefixItems.map(renderTranscriptItem).join('\n'),
      cache_control: EPHEMERAL_CACHE,
    });
  }
  userContent.push({ type: 'text', text: liveText });

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
  };

  if (input.availableTools.length > 0) {
    const tools = input.availableTools.map(mapTool);
    // Cache the tool definitions block — tools rarely change across turns and
    // are repeated input on every call.
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: EPHEMERAL_CACHE };
    body.tools = tools;
    body.tool_choice = { type: 'auto' };
  }

  return body;
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
  private readonly cacheTrailingTranscriptItems: number | undefined;

  constructor(config: AnthropicModelAdapterConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.fetchImpl = config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.cacheTrailingTranscriptItems = config.cacheTrailingTranscriptItems;
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
        body: JSON.stringify(
          buildBody(input, this.model, this.maxTokens, this.cacheTrailingTranscriptItems),
        ),
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

  /**
   * Native streaming via Anthropic Messages API SSE (`stream: true`). Emits
   * text deltas as they arrive and resolves with the final assembled
   * {@link HarnessModelOutput}. Tool-use mid-stream is materialized as a
   * post-stream `tool_request` output (deltas only carry text).
   */
  async streamStep(
    input: HarnessModelInput,
    onDelta: (delta: string) => void,
  ): Promise<HarnessModelOutput> {
    if (!this.apiKey) {
      return invalid('provider_error', 'Anthropic API key is not configured.', { code: 'auth_failed', metadata: { modelId: this.model } });
    }

    let response: Response | undefined;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...this.defaultHeaders,
        },
        body: JSON.stringify({
          ...buildBody(input, this.model, this.maxTokens, this.cacheTrailingTranscriptItems),
          stream: true,
        }),
        signal: input.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return invalid(isTransientProviderStatus(response.status) ? 'transient' : 'provider_error', text || `Anthropic stream failed (${response.status})`, {
          code: classifyProviderError(response.status, text),
          httpStatus: response.status,
          metadata: { modelId: this.model },
        });
      }
      if (!response.body) {
        return invalid('empty_response', 'Anthropic streaming response had no body', { code: 'unknown', metadata: { modelId: this.model } });
      }

      // Aggregate content blocks indexed by their content_block_start `index`.
      const textBlocks = new Map<number, string>();
      const toolBlocks = new Map<number, { id?: string; name?: string; argsJson: string }>();
      let stopReason: string | undefined;
      let messageId: string | undefined;

      for await (const frame of readSseFrames(response.body)) {
        const json = safeParseJson(frame);
        if (!isRecord(json)) continue;
        const eventType = readString(json.type);
        if (eventType === 'message_start') {
          const message = json.message;
          if (isRecord(message)) messageId = readString(message.id);
        } else if (eventType === 'content_block_start') {
          const index = typeof json.index === 'number' ? json.index : -1;
          const block = json.content_block;
          if (isRecord(block) && block.type === 'tool_use') {
            toolBlocks.set(index, {
              id: readString(block.id),
              name: readString(block.name),
              argsJson: '',
            });
          } else if (isRecord(block) && block.type === 'text') {
            textBlocks.set(index, readString(block.text) ?? '');
          }
        } else if (eventType === 'content_block_delta') {
          const index = typeof json.index === 'number' ? json.index : -1;
          const delta = json.delta;
          if (!isRecord(delta)) continue;
          if (delta.type === 'text_delta') {
            const piece = readString(delta.text);
            if (piece) {
              textBlocks.set(index, (textBlocks.get(index) ?? '') + piece);
              onDelta(piece);
            }
          } else if (delta.type === 'input_json_delta') {
            const partial = readString(delta.partial_json);
            if (partial !== undefined) {
              const block = toolBlocks.get(index);
              if (block) block.argsJson += partial;
            }
          }
        } else if (eventType === 'message_delta') {
          const delta = json.delta;
          if (isRecord(delta)) {
            stopReason = readString(delta.stop_reason) ?? stopReason;
          }
        } else if (eventType === 'message_stop') {
          // Final marker; nothing to do.
        } else if (eventType === 'error') {
          const errorBody = json.error;
          const message = isRecord(errorBody) ? readString(errorBody.message) : readString(errorBody);
          return invalid('provider_error', message ?? 'Anthropic stream error', { code: classifyProviderError(undefined, message), metadata: { modelId: this.model } });
        }
      }

      // Assemble final output from collected blocks.
      if (toolBlocks.size > 0) {
        const calls = [...toolBlocks.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, block]) => {
            if (!block.id || !block.name) return null;
            const parsed = parseToolArguments(block.argsJson || '{}');
            if (parsed === null) return null;
            return { id: block.id, name: block.name, input: parsed };
          });
        if (calls.some((call) => call === null)) {
          return invalid('schema_mismatch', 'Anthropic streamed tool_use block was malformed', { code: 'invalid_request', metadata: { modelId: this.model } });
        }
        return {
          type: 'tool_request',
          calls: calls as HarnessToolCall[],
          metadata: { modelId: this.model, id: messageId },
        };
      }

      const aggregated = [...textBlocks.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, text]) => text)
        .join('\n\n')
        .trim();

      if (stopReason === 'refusal') {
        return { type: 'refusal', reason: aggregated || 'Model refused the request', metadata: { modelId: this.model, id: messageId } };
      }
      if (aggregated) {
        return { type: 'final_answer', text: aggregated, metadata: { modelId: this.model, id: messageId } };
      }
      return invalid('empty_response', 'Anthropic stream completed without usable content', { code: 'unknown', metadata: { modelId: this.model } });
    } catch (error) {
      if (response?.body && !response.bodyUsed) {
        await response.body.cancel().catch(() => {});
      }
      const message = error instanceof Error ? error.message : 'Unknown Anthropic streaming error';
      return invalid('transient', message, { code: classifyProviderError(undefined, message), metadata: { modelId: this.model } });
    }
  }
}

export function createAnthropicModelAdapter(config?: AnthropicModelAdapterConfig): HarnessModelAdapter {
  return new AnthropicModelAdapter(config);
}
