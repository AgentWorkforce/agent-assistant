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

export interface GeminiModelAdapterConfig {
  apiKey?: string;
  model?: string;
  fetchImpl?: ProviderFetch;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

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
    parameters: tool.inputSchema ?? { type: 'object' },
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

function buildBody(input: HarnessModelInput): Record<string, unknown> {
  const context = [
    input.instructions.systemPrompt,
    input.instructions.developerPrompt,
    transcriptText(input),
    input.message.text,
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    contents: [{ role: 'user', parts: [{ text: context }] }],
    ...(input.availableTools.length > 0
      ? { tools: [{ functionDeclarations: input.availableTools.map(mapTool) }] }
      : {}),
  };
}

function firstCandidate(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  return isRecord(candidates[0]) ? candidates[0] : undefined;
}

function parseParts(parts: unknown): { text: string; calls: HarnessToolCall[] } | HarnessInvalidOutput {
  if (!Array.isArray(parts)) return { text: '', calls: [] };
  const text: string[] = [];
  const calls: HarnessToolCall[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    const partText = readString(part.text);
    if (partText) text.push(partText);
    if (isRecord(part.functionCall)) {
      const name = readString(part.functionCall.name);
      const input = parseToolArguments(part.functionCall.args);
      if (!name || input === null) {
        return invalid('schema_mismatch', 'Gemini functionCall part was malformed', {
          code: 'invalid_request',
          raw: part,
        });
      }
      calls.push({ id: `gemini-${calls.length + 1}`, name, input });
    }
  }
  return { text: text.join('\n\n').trim(), calls };
}

function outputFromBody(body: Record<string, unknown>, model: string): HarnessModelOutput {
  const candidate = firstCandidate(body);
  if (!candidate) {
    return invalid('missing_message', 'Gemini response did not include a candidate', {
      code: 'unknown',
      raw: body,
      metadata: { modelId: model },
    });
  }

  const finishReason = readString(candidate.finishReason);
  if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
    return {
      type: 'refusal',
      reason: `Gemini blocked the response: ${finishReason}`,
      metadata: { modelId: model, safetyRatings: candidate.safetyRatings },
    };
  }

  const content = isRecord(candidate.content) ? candidate.content : undefined;
  const parsed = parseParts(content?.parts);
  if ('type' in parsed) return parsed;
  if (parsed.calls.length > 0) return { type: 'tool_request', calls: parsed.calls, metadata: { modelId: model } };
  if (parsed.text) return { type: 'final_answer', text: parsed.text, metadata: { modelId: model } };

  return invalid('empty_response', 'Gemini response did not include usable content', {
    code: 'unknown',
    raw: body,
    metadata: { modelId: model },
  });
}

export class GeminiModelAdapter implements HarnessModelAdapter {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly fetchImpl: ProviderFetch;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: GeminiModelAdapterConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.fetchImpl = config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultHeaders = config.defaultHeaders ?? {};
  }

  async nextStep(input: HarnessModelInput): Promise<HarnessModelOutput> {
    if (!this.apiKey) {
      return invalid('provider_error', 'Gemini API key is not configured.', { code: 'auth_failed', metadata: { modelId: this.model } });
    }

    const url = `${this.baseUrl}/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.defaultHeaders },
        body: JSON.stringify(buildBody(input)),
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
      return json ? outputFromBody(json, this.model) : invalid('provider_error', 'Gemini response body was not valid JSON', { code: 'unknown' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Gemini error';
      return invalid('transient', message, { code: classifyProviderError(undefined, message), metadata: { modelId: this.model } });
    }
  }
}

export function createGeminiModelAdapter(config?: GeminiModelAdapterConfig): HarnessModelAdapter {
  return new GeminiModelAdapter(config);
}
