import type {
  HarnessModelAdapter,
  HarnessModelInput,
  HarnessModelOutput,
  HarnessInvalidOutput,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessTranscriptItem,
  HarnessToolResultStep,
  HarnessUsage,
} from '../types.js';

export interface OpenRouterModelAdapterConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  defaultTemperature?: number;
  transientRetryDelayMs?: number;
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 250;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

interface OpenRouterRequestBody {
  model: string;
  messages: ChatMessage[];
  tools?: OpenRouterTool[];
  tool_choice?: 'auto';
  temperature?: number;
}

interface OpenRouterResponseToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: unknown };
}

interface OpenRouterResponseBody {
  id?: string;
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
      refusal?: unknown;
    };
    finish_reason?: string;
  }>;
  output?: unknown;
  output_reasoning_summary?: unknown;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string | number };
}

interface CanonicalToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface CanonicalOpenRouterResponse {
  toolCalls: CanonicalToolCall[];
  content: string | null;
  reasoning: string | null;
  rawReasoningBlocks: unknown[];
  metadata: Record<string, unknown>;
  refusal?: string;
}

function mapToolDefinition(tool: HarnessToolDefinition): OpenRouterTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      ...(tool.inputSchema ? { parameters: tool.inputSchema } : {}),
    },
  };
}

function buildTranscriptMessages(transcript: HarnessTranscriptItem[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const items = Array.from(transcript);
  let i = 0;

  while (i < items.length) {
    const item = items[i] as HarnessTranscriptItem;

    if (item.type === 'assistant_step') {
      if (item.outputType === 'tool_request') {
        const toolResults: HarnessToolResultStep[] = [];
        let j = i + 1;
        while (j < items.length && (items[j] as HarnessTranscriptItem).type === 'tool_result') {
          toolResults.push(items[j] as HarnessToolResultStep);
          j++;
        }

        const toolCalls = toolResults.map((tr) => ({
          id: tr.result.callId,
          type: 'function' as const,
          function: { name: tr.result.toolName, arguments: '{}' },
        }));

        messages.push({
          role: 'assistant',
          content: item.text ?? null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });

        for (const tr of toolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: tr.result.callId,
            content: tr.result.output ?? tr.result.error?.message ?? '',
          });
        }

        i = j;
      } else {
        messages.push({ role: 'assistant', content: item.text ?? '' });
        i++;
      }
    } else if (item.type === 'tool_result') {
      // Already consumed by lookahead above; skip standalone occurrences.
      i++;
    } else if (item.type === 'clarification_request') {
      messages.push({ role: 'assistant', content: item.question });
      i++;
    } else if (item.type === 'approval_request') {
      messages.push({
        role: 'assistant',
        content: `Approval requested: ${item.request.summary}`,
      });
      i++;
    } else {
      i++;
    }
  }

  return messages;
}

function renderContext(ctx: HarnessModelInput['context']): string | null {
  if (!ctx) {
    return null;
  }

  const sections: string[] = [];
  const blocks = ctx.blocks ?? [];

  if (blocks.length > 0) {
    const lines = blocks.map((block) => {
      const label = block.label ? `[${block.label}] ` : '';
      const body = block.content ?? '';
      return `- ${label}${body}`;
    });
    sections.push(`Conversation context:\n${lines.join('\n')}`);
  }

  if (ctx.structured && Object.keys(ctx.structured).length > 0) {
    sections.push(`Structured context:\n${JSON.stringify(ctx.structured, null, 2)}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}

function buildRequestBody(
  input: HarnessModelInput,
  model: string,
  temperature?: number,
): OpenRouterRequestBody {
  const messages: ChatMessage[] = [
    { role: 'system', content: input.instructions.systemPrompt },
  ];

  if (input.instructions.developerPrompt?.trim()) {
    messages.push({ role: 'system', content: input.instructions.developerPrompt });
  }

  const contextText = renderContext(input.context);
  if (contextText) {
    messages.push({ role: 'system', content: contextText });
  }

  messages.push(...buildTranscriptMessages(input.transcript));
  messages.push({ role: 'user', content: input.message.text });

  const tools =
    input.availableTools.length > 0
      ? input.availableTools.map(mapToolDefinition)
      : undefined;

  return {
    model,
    messages,
    ...(tools ? { tools, tool_choice: 'auto' } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };
}

function mapUsage(raw: OpenRouterResponseBody['usage']): HarnessUsage | undefined {
  if (!raw) return undefined;
  const usage: HarnessUsage = {};
  if (raw.prompt_tokens !== undefined) usage.inputTokens = raw.prompt_tokens;
  if (raw.completion_tokens !== undefined) usage.outputTokens = raw.completion_tokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitThinkingTags(text: string): { content: string; reasoning: string[] } {
  const reasoning: string[] = [];
  const content = text.replace(/<thinking>([\s\S]*?)<\/thinking>/gi, (_match, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed) reasoning.push(trimmed);
    return '';
  });
  return { content, reasoning };
}

function appendText(parts: string[], value: unknown): void {
  const text = readString(value);
  if (text) parts.push(text);
}

function collectReasoningValue(
  value: unknown,
  reasoningParts: string[],
  rawReasoningBlocks: unknown[],
): void {
  if (typeof value === 'string') {
    appendText(reasoningParts, value);
    rawReasoningBlocks.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReasoningValue(item, reasoningParts, rawReasoningBlocks);
    }
    return;
  }
  if (!isRecord(value)) return;

  rawReasoningBlocks.push(value);
  appendText(reasoningParts, value.text);
  appendText(reasoningParts, value.content);
  appendText(reasoningParts, value.reasoning);
  appendText(reasoningParts, value.reasoning_content);
  appendText(reasoningParts, value.thinking);
  appendText(reasoningParts, value.summary_text);
  if (Array.isArray(value.summary)) {
    collectReasoningValue(value.summary, reasoningParts, rawReasoningBlocks);
  }
}

function collectContentValue(
  value: unknown,
  contentParts: string[],
  reasoningParts: string[],
  rawReasoningBlocks: unknown[],
): void {
  if (typeof value === 'string') {
    const split = splitThinkingTags(value);
    appendText(contentParts, split.content);
    for (const part of split.reasoning) {
      appendText(reasoningParts, part);
      rawReasoningBlocks.push({ type: 'thinking_tag', text: part });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectContentValue(item, contentParts, reasoningParts, rawReasoningBlocks);
    }
    return;
  }

  if (!isRecord(value)) return;

  const type = readString(value.type)?.toLowerCase();
  if (
    type === 'reasoning' ||
    type === 'thinking' ||
    type === 'reasoning_content' ||
    type === 'output_reasoning_summary'
  ) {
    collectReasoningValue(value, reasoningParts, rawReasoningBlocks);
    return;
  }

  if (type === 'message' && value.content !== undefined) {
    collectContentValue(value.content, contentParts, reasoningParts, rawReasoningBlocks);
    return;
  }

  if (
    type === 'text' ||
    type === 'output_text' ||
    type === 'summary_text' ||
    type === undefined
  ) {
    appendText(contentParts, value.text);
    appendText(contentParts, value.content);
  }
}

function readCanonicalToolCallsFromChat(value: unknown): CanonicalToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: CanonicalToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.function)) continue;
    const id = readString(item.id);
    const name = readString(item.function.name);
    if (!id || !name) continue;
    calls.push({ id, name, arguments: item.function.arguments });
  }
  return calls;
}

function readCanonicalToolCallsFromOutput(value: unknown): CanonicalToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: CanonicalToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const type = readString(item.type)?.toLowerCase();
    if (type !== 'function_call' && type !== 'tool_call') continue;
    const id = readString(item.call_id) ?? readString(item.id);
    const name = readString(item.name) ?? (isRecord(item.function) ? readString(item.function.name) : undefined);
    const args = item.arguments ?? (isRecord(item.function) ? item.function.arguments : undefined);
    if (!id || !name) continue;
    calls.push({ id, name, arguments: args });
  }
  return calls;
}

function joinParts(parts: string[]): string | null {
  const text = parts.map((part) => part.trim()).filter(Boolean).join('\n\n').trim();
  return text.length > 0 ? text : null;
}

export function responseToCanonical(body: OpenRouterResponseBody): CanonicalOpenRouterResponse {
  const choice = body.choices?.[0];
  const message = choice?.message;
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const rawReasoningBlocks: unknown[] = [];

  if (message) {
    collectContentValue(message.content, contentParts, reasoningParts, rawReasoningBlocks);
    collectReasoningValue(message.reasoning, reasoningParts, rawReasoningBlocks);
    collectReasoningValue(message.reasoning_content, reasoningParts, rawReasoningBlocks);
  }

  collectContentValue(body.output, contentParts, reasoningParts, rawReasoningBlocks);
  collectReasoningValue(body.output_reasoning_summary, reasoningParts, rawReasoningBlocks);

  return {
    toolCalls: [
      ...readCanonicalToolCallsFromChat(message?.tool_calls),
      ...readCanonicalToolCallsFromOutput(body.output),
    ],
    content: joinParts(contentParts),
    reasoning: joinParts(reasoningParts),
    rawReasoningBlocks,
    metadata: {
      ...(body.id ? { responseId: body.id } : {}),
      ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
    },
    ...(readString(message?.refusal) ? { refusal: readString(message?.refusal) } : {}),
  };
}

function metadataForCanonical(
  modelId: string,
  canonical: CanonicalOpenRouterResponse,
): Record<string, unknown> {
  return {
    modelId,
    ...canonical.metadata,
    ...(canonical.reasoning ? { reasoning: canonical.reasoning } : {}),
    ...(canonical.rawReasoningBlocks.length > 0
      ? { rawReasoningBlocks: canonical.rawReasoningBlocks }
      : {}),
  };
}

function invalidOutput(
  kind: NonNullable<HarnessInvalidOutput['kind']>,
  reason: string,
  options: Omit<Partial<HarnessInvalidOutput>, 'type' | 'kind' | 'reason'> = {},
): HarnessInvalidOutput {
  return {
    type: 'invalid',
    kind,
    reason,
    ...options,
  };
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isTransientInvalid(output: HarnessModelOutput): output is HarnessInvalidOutput {
  return output.type === 'invalid' && output.kind === 'transient';
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseToolCallInput(args: unknown): Record<string, unknown> | null {
  if (args === undefined || args === null || args === '') return {};
  if (isRecord(args)) return args;
  if (typeof args !== 'string') return null;
  try {
    const parsed = JSON.parse(args) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readResponseJson(response: Response): Promise<OpenRouterResponseBody | undefined> {
  try {
    const parsed = (await response.json()) as unknown;
    return isRecord(parsed) ? parsed as OpenRouterResponseBody : undefined;
  } catch {
    return undefined;
  }
}

function classifyCanonicalResponse(
  body: OpenRouterResponseBody,
  canonical: CanonicalOpenRouterResponse,
  modelId: string,
): HarnessModelOutput {
  const usage = mapUsage(body.usage);
  const metadata = metadataForCanonical(modelId, canonical);

  if (canonical.refusal) {
    return invalidOutput('model_refused', canonical.refusal, {
      raw: body,
      metadata,
      ...(usage ? { usage } : {}),
    });
  }

  if (canonical.toolCalls.length > 0) {
    const calls: HarnessToolCall[] = [];
    for (const tc of canonical.toolCalls) {
      const parsed = parseToolCallInput(tc.arguments);
      if (!parsed) {
        return invalidOutput('schema_mismatch', 'tool_call arguments are not valid JSON object', {
          raw: body,
          metadata,
          ...(usage ? { usage } : {}),
        });
      }
      calls.push({ id: tc.id, name: tc.name, input: parsed });
    }
    return { type: 'tool_request', calls, metadata, ...(usage ? { usage } : {}) };
  }

  const text = normalizeText(canonical.content);
  if (text) {
    return { type: 'final_answer', text, metadata, ...(usage ? { usage } : {}) };
  }

  const hasMessageOrOutput = Boolean(body.choices?.[0]?.message || body.output !== undefined);
  return invalidOutput(
    hasMessageOrOutput ? 'empty_response' : 'missing_message',
    hasMessageOrOutput
      ? 'OpenRouter response did not include usable assistant content'
      : 'OpenRouter response did not include a message choice',
    {
      raw: body,
      metadata,
      ...(usage ? { usage } : {}),
    },
  );
}

export class OpenRouterModelAdapter implements HarnessModelAdapter {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly defaultTemperature?: number;
  private readonly transientRetryDelayMs: number;

  constructor(config: OpenRouterModelAdapterConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    // Default to a lambda that reads `globalThis.fetch` at CALL time, not
    // a bare `fetch` reference. Bare references can be detached from
    // globalThis under Cloudflare Workers + nodejs_compat + esbuild,
    // throwing "Illegal invocation" on first use. See
    // .claude/rules/workers-fetch.md for background.
    this.fetchImpl =
      config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultTemperature = config.defaultTemperature;
    this.transientRetryDelayMs = config.transientRetryDelayMs ?? DEFAULT_TRANSIENT_RETRY_DELAY_MS;
  }

  async nextStep(input: HarnessModelInput): Promise<HarnessModelOutput> {
    if (!this.apiKey) {
      return invalidOutput('provider_error', 'OpenRouter API key is not configured.');
    }

    let retriedAt: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const output = await this.requestOnce(input);
      if (!isTransientInvalid(output) || attempt === 1) {
        return retriedAt && isTransientInvalid(output)
          ? { ...output, retriedAt }
          : output;
      }
      retriedAt = new Date().toISOString();
      await delay(this.transientRetryDelayMs);
    }

    return invalidOutput('provider_error', 'OpenRouter adapter exhausted retry loop unexpectedly');
  }

  private async requestOnce(input: HarnessModelInput): Promise<HarnessModelOutput> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);
    let body: OpenRouterResponseBody | undefined;

    try {
      const requestBody = buildRequestBody(input, this.model, this.defaultTemperature);

      const response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      body = await readResponseJson(response);

      if (!response.ok) {
        const reason = body?.error?.message ?? `HTTP ${response.status}`;
        return invalidOutput(
          isTransientHttpStatus(response.status) ? 'transient' : 'provider_error',
          reason,
          {
            raw: body,
            httpStatus: response.status,
            metadata: { modelId: this.model },
          },
        );
      }

      if (!body) {
        return invalidOutput('provider_error', 'OpenRouter response body was not valid JSON');
      }

      return classifyCanonicalResponse(body, responseToCanonical(body), this.model);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return invalidOutput('transient', 'timeout', { metadata: { modelId: this.model } });
      }
      return invalidOutput(
        'transient',
        error instanceof Error ? error.message : 'Unknown error',
        {
          raw: body,
          metadata: { modelId: this.model },
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createOpenRouterModelAdapter(
  config?: OpenRouterModelAdapterConfig,
): HarnessModelAdapter {
  return new OpenRouterModelAdapter(config);
}
