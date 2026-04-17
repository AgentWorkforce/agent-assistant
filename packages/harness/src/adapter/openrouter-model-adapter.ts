import type {
  HarnessModelAdapter,
  HarnessModelInput,
  HarnessModelOutput,
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
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 60_000;

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
  function: { name: string; arguments: string };
}

interface OpenRouterResponseBody {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenRouterResponseToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string | number };
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

export class OpenRouterModelAdapter implements HarnessModelAdapter {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly defaultTemperature?: number;

  constructor(config: OpenRouterModelAdapterConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultTemperature = config.defaultTemperature;
  }

  async nextStep(input: HarnessModelInput): Promise<HarnessModelOutput> {
    if (!this.apiKey) {
      return { type: 'invalid', reason: 'OpenRouter API key is not configured.' };
    }

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

      body = (await response.json()) as OpenRouterResponseBody;

      if (!response.ok) {
        return {
          type: 'invalid',
          reason: body.error?.message ?? `HTTP ${response.status}`,
          raw: body,
        };
      }

      const usage = mapUsage(body.usage);
      const message = body.choices?.[0]?.message;
      const rawToolCalls = message?.tool_calls;

      if (rawToolCalls && rawToolCalls.length > 0) {
        const calls: HarnessToolCall[] = [];
        for (const tc of rawToolCalls) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            return { type: 'invalid', reason: 'tool_call arguments are not valid JSON', raw: body };
          }
          calls.push({ id: tc.id, name: tc.function.name, input: parsed });
        }
        return { type: 'tool_request', calls, ...(usage ? { usage } : {}) };
      }

      const text = message?.content ?? '';
      return { type: 'final_answer', text, ...(usage ? { usage } : {}) };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { type: 'invalid', reason: 'timeout' };
      }
      return {
        type: 'invalid',
        reason: error instanceof Error ? error.message : 'Unknown error',
        raw: body,
      };
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
