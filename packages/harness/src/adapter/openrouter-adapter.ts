import {
  EXECUTION_CONTRACT_SCHEMA_VERSION,
  type ExecutionAdapter,
  type ExecutionCapabilities,
  type ExecutionNegotiation,
  type ExecutionNegotiationReason,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutionStreamEvent,
  type ExecutionTrace,
  type ExecutionTraceEvent,
} from './types.js';

const OPENROUTER_CAPABILITIES: ExecutionCapabilities = {
  schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
  toolUse: 'none',
  structuredToolCalls: false,
  continuationSupport: 'none',
  approvalInterrupts: 'none',
  traceDepth: 'minimal',
  attachments: false,
  streaming: 'native',
  maxContextStrategy: 'large',
  notes: ['Direct hosted API adapter', 'Bounded no-tool proof slice (text-only)'],
};

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterRequestBody {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface OpenRouterResponseBody {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    code?: string | number;
  };
}

export interface OpenRouterAdapterConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function buildTrace(
  startedAt: number,
  completedAt: number,
  degraded: boolean,
  events?: ExecutionTraceEvent[],
): ExecutionTrace {
  return {
    summary: {
      startedAt: toIso(startedAt),
      completedAt: toIso(completedAt),
      stepCount: 1,
      toolCallCount: 0,
      degraded,
    },
    ...(events && events.length > 0 ? { events } : {}),
  };
}

function requiredUnsupported(
  code: ExecutionNegotiationReason['code'],
  message: string,
): ExecutionNegotiationReason {
  return { code, message, severity: 'blocking' };
}

function preferredDegradation(
  code: ExecutionNegotiationReason['code'],
  message: string,
): ExecutionNegotiationReason {
  return { code, message, severity: 'warning' };
}

function buildUserPrompt(request: ExecutionRequest): string {
  const sections: string[] = [];

  if (request.instructions.developerPrompt?.trim()) {
    sections.push(`Developer instructions:\n${request.instructions.developerPrompt}`);
  }

  const blocks = request.context?.blocks ?? [];
  if (blocks.length > 0) {
    sections.push(
      `Context:\n${blocks.map((block) => `- [${block.label}] ${block.text}`).join('\n')}`,
    );
  }

  if (request.context?.structured && Object.keys(request.context.structured).length > 0) {
    sections.push(`Structured context:\n${JSON.stringify(request.context.structured, null, 2)}`);
  }

  sections.push(`User message:\n${request.message.text}`);

  return sections.join('\n\n');
}

function buildRequestBody(request: ExecutionRequest, model: string): OpenRouterRequestBody {
  return {
    model,
    messages: [
      {
        role: 'system',
        content: request.instructions.systemPrompt,
      },
      {
        role: 'user',
        content: buildUserPrompt(request),
      },
    ],
  };
}

function parseResponseText(body: OpenRouterResponseBody): string | undefined {
  return body.choices?.[0]?.message?.content?.trim() || undefined;
}

function negotiateRequest(request: ExecutionRequest): ExecutionNegotiation {
  const reasons: ExecutionNegotiationReason[] = [];
  const requirements = request.requirements;

  if ((request.tools?.length ?? 0) > 0) {
    reasons.push(
      requiredUnsupported(
        'tool_use_unsupported',
        'OpenRouter proof adapter does not support tool-bearing requests in this slice.',
      ),
    );
  }

  if (requirements?.toolUse === 'required') {
    reasons.push(requiredUnsupported('tool_use_unsupported', 'Backend does not support tool use.'));
  }

  if (requirements?.structuredToolCalls === 'required') {
    reasons.push(
      requiredUnsupported(
        'structured_tool_calls_unsupported',
        'Structured tool calls are required but unsupported by this adapter.',
      ),
    );
  }

  if (requirements?.continuationSupport === 'required') {
    reasons.push(
      requiredUnsupported(
        'continuation_unsupported',
        'Structured continuation support is unavailable in this OpenRouter proof slice.',
      ),
    );
  } else if (requirements?.continuationSupport === 'preferred') {
    reasons.push(
      preferredDegradation(
        'continuation_unsupported',
        'Continuation support is preferred but unavailable in this OpenRouter proof slice.',
      ),
    );
  }

  if (requirements?.approvalInterrupts === 'required') {
    reasons.push(
      requiredUnsupported(
        'approval_interrupt_unsupported',
        'Approval interrupts are required but unsupported by this adapter.',
      ),
    );
  } else if (requirements?.approvalInterrupts === 'preferred') {
    reasons.push(
      preferredDegradation(
        'approval_interrupt_unsupported',
        'Approval interrupts are preferred but unavailable in this OpenRouter proof slice.',
      ),
    );
  }

  if ((request.message.attachments?.length ?? 0) > 0 || requirements?.attachments === 'required') {
    reasons.push(
      requiredUnsupported(
        'attachments_unsupported',
        'Attachments are unsupported by this OpenRouter proof adapter.',
      ),
    );
  }

  if (requirements?.traceDepth === 'standard' || requirements?.traceDepth === 'detailed') {
    reasons.push(
      preferredDegradation(
        'trace_depth_reduced',
        'Only minimal execution trace facts are available in this OpenRouter proof slice.',
      ),
    );
  }

  if (requirements?.streaming === 'required' && (OPENROUTER_CAPABILITIES.streaming ?? 'none') === 'none') {
    reasons.push(
      requiredUnsupported(
        'other',
        'Streaming is required but unavailable in this OpenRouter proof slice.',
      ),
    );
  } else if (requirements?.streaming === 'preferred' && (OPENROUTER_CAPABILITIES.streaming ?? 'none') === 'none') {
    reasons.push(
      preferredDegradation(
        'other',
        'Streaming is preferred but unavailable in this OpenRouter proof slice.',
      ),
    );
  }

  const supported = !reasons.some((reason) => reason.severity === 'blocking');
  const degraded = reasons.some((reason) => reason.severity !== 'blocking');

  return {
    supported,
    degraded,
    reasons,
    effectiveCapabilities: OPENROUTER_CAPABILITIES,
  };
}

export class OpenRouterExecutionAdapter implements ExecutionAdapter {
  readonly backendId = 'openrouter-api';

  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: NonNullable<OpenRouterAdapterConfig['now']>;
  private readonly timeoutMs: number;

  constructor(config: OpenRouterAdapterConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'openai/gpt-5-mini';
    this.baseUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1/chat/completions';
    // See .claude/rules/workers-fetch.md — read `globalThis.fetch` at call
    // time, not module load, to survive Workers + nodejs_compat + esbuild.
    this.fetchImpl =
      config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.now = config.now ?? Date.now;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  describeCapabilities(): ExecutionCapabilities {
    return {
      ...OPENROUTER_CAPABILITIES,
      ...(OPENROUTER_CAPABILITIES.notes ? { notes: [...OPENROUTER_CAPABILITIES.notes] } : {}),
    };
  }

  negotiate(request: ExecutionRequest): ExecutionNegotiation {
    return negotiateRequest(request);
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const negotiation = this.negotiate(request);
    if (!negotiation.supported) {
      return {
        schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
        backendId: this.backendId,
        status: 'unsupported',
        error: {
          code: 'unsupported_capability',
          message: negotiation.reasons.map((reason) => reason.message).join(' '),
        },
        degradation: negotiation.reasons,
        trace: {
          summary: {
            degraded: false,
          },
        },
      };
    }

    if (!this.apiKey) {
      return {
        schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
        backendId: this.backendId,
        status: 'failed',
        error: {
          code: 'backend_execution_error',
          message: 'OpenRouter API key is not configured.',
        },
        degradation: negotiation.degraded ? negotiation.reasons : undefined,
      };
    }

    if (request.signal?.aborted) {
      return {
        schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
        backendId: this.backendId,
        status: 'failed',
        error: {
          code: 'cancelled',
          message: 'Execution request was cancelled before it started.',
          retryable: false,
        },
        degradation: negotiation.degraded ? negotiation.reasons : undefined,
      };
    }

    const startedAt = this.now();
    const abortController = new AbortController();
    const abortFromRequest = () => abortController.abort();
    if (request.signal?.aborted) {
      abortController.abort();
    } else {
      request.signal?.addEventListener('abort', abortFromRequest, { once: true });
    }
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildRequestBody(request, this.model)),
        signal: abortController.signal,
      });

      const body = (await response.json()) as OpenRouterResponseBody;
      const completedAt = this.now();

      if (!response.ok) {
        return {
          schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
        backendId: this.backendId,
          status: 'failed',
          error: {
            code: 'backend_execution_error',
            message: body.error?.message || `OpenRouter request failed with status ${response.status}.`,
            retryable: response.status >= 500,
            metadata: {
              status: response.status,
              code: body.error?.code,
            },
          },
          trace: buildTrace(startedAt, completedAt, negotiation.degraded, [
            {
              type: 'failure',
              at: toIso(completedAt),
              data: { status: response.status, error: body.error?.message },
            },
          ]),
          degradation: negotiation.degraded ? negotiation.reasons : undefined,
        };
      }

      const text = parseResponseText(body);
      if (!text) {
        return {
          schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
        backendId: this.backendId,
          status: 'failed',
          error: {
            code: 'invalid_backend_output',
            message: 'OpenRouter response did not contain assistant text.',
            metadata: { body },
          },
          trace: buildTrace(startedAt, completedAt, negotiation.degraded, [
            {
              type: 'failure',
              at: toIso(completedAt),
              data: { reason: 'missing_text' },
            },
          ]),
          degradation: negotiation.degraded ? negotiation.reasons : undefined,
        };
      }

      return {
        schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
        backendId: this.backendId,
        status: 'completed',
        output: { text },
        trace: buildTrace(startedAt, completedAt, negotiation.degraded, [
          { type: 'model_started', at: toIso(startedAt) },
          { type: 'model_completed', at: toIso(completedAt), data: { finishReason: body.choices?.[0]?.finish_reason } },
        ]),
        degradation: negotiation.degraded ? negotiation.reasons : undefined,
        metadata: body.id ? { responseId: body.id } : undefined,
      };
    } catch (error) {
      const completedAt = this.now();
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const isCancelled = isAbort && request.signal?.aborted;
      return {
        schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
        backendId: this.backendId,
        status: 'failed',
        error: {
          code: isCancelled ? 'cancelled' : isAbort ? 'timeout' : 'backend_execution_error',
          message: isCancelled
            ? 'Execution request was cancelled.'
            : isAbort
            ? `OpenRouter request timed out after ${this.timeoutMs}ms.`
            : error instanceof Error
              ? error.message
              : 'Unknown OpenRouter execution error.',
          retryable: true,
        },
        trace: buildTrace(startedAt, completedAt, negotiation.degraded, [
          {
            type: 'failure',
            at: toIso(completedAt),
            data: { timeoutMs: this.timeoutMs, error: error instanceof Error ? error.message : String(error) },
          },
        ]),
        degradation: negotiation.degraded ? negotiation.reasons : undefined,
      };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abortFromRequest);
    }
  }

  /**
   * Native SSE streaming. Calls the OpenRouter chat-completions endpoint
   * with `stream: true`, parses Server-Sent Events frames, and yields
   * `text_delta` events as content arrives. Closes with exactly one
   * `turn_finished` carrying an ExecutionResult that mirrors `execute()`
   * for the same request (modulo timing).
   *
   * Workers-fetch rule: uses `globalThis.fetch` at call time and consumes
   * (or cancels) the response body in every termination path.
   */
  executeStreaming(request: ExecutionRequest): AsyncIterable<ExecutionStreamEvent> {
    const negotiation = this.negotiate(request);
    const backendId = this.backendId;
    const startedAt = this.now();
    const baseUrl = this.baseUrl;
    const apiKey = this.apiKey;
    const model = this.model;
    const fetchImpl = this.fetchImpl;
    const timeoutMs = this.timeoutMs;
    const now = this.now;

    if (!negotiation.supported) {
      return makeUnsupportedStream(backendId, negotiation.reasons);
    }

    if (!apiKey) {
      return makeFailedStream(backendId, {
        code: 'backend_execution_error',
        message: 'OpenRouter API key is not configured.',
      });
    }

    const degraded = negotiation.degraded;
    const degradation = negotiation.degraded ? negotiation.reasons : undefined;

    return {
      async *[Symbol.asyncIterator]() {
        if (request.signal?.aborted) {
          yield* emitCancelledStream(backendId, startedAt, now);
          return;
        }

        const abortController = new AbortController();
        const abortFromRequest = () => abortController.abort();
        request.signal?.addEventListener('abort', abortFromRequest, { once: true });
        const timeout = setTimeout(() => abortController.abort(), timeoutMs);

        let response: Response | undefined;
        let aggregated = '';
        try {
          response = await fetchImpl(baseUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body: JSON.stringify({ ...buildRequestBody(request, model), stream: true }),
            signal: abortController.signal,
          });

          if (!response.ok) {
            const text = await response.text().catch(() => '');
            const completedAt = now();
            yield {
              type: 'turn_finished',
              result: {
                schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
                backendId,
                status: 'failed',
                error: {
                  code: 'backend_execution_error',
                  message: text || `OpenRouter request failed with status ${response.status}.`,
                  retryable: response.status >= 500,
                  metadata: { status: response.status },
                },
                trace: buildTrace(startedAt, completedAt, degraded, [
                  { type: 'failure', at: toIso(completedAt), data: { status: response.status } },
                ]),
                degradation,
              },
            };
            return;
          }

          if (!response.body) {
            const completedAt = now();
            yield {
              type: 'turn_finished',
              result: {
                schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
                backendId,
                status: 'failed',
                error: {
                  code: 'invalid_backend_output',
                  message: 'OpenRouter streaming response had no body.',
                },
                trace: buildTrace(startedAt, completedAt, degraded),
                degradation,
              },
            };
            return;
          }

          for await (const event of parseSseStream(response.body)) {
            if (event === '[DONE]') break;
            const json = safeParseJson(event);
            const delta = extractDeltaText(json);
            if (delta) {
              aggregated += delta;
              yield { type: 'text_delta', text: delta };
            }
          }

          const completedAt = now();
          yield {
            type: 'turn_finished',
            result: {
              schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
              backendId,
              status: 'completed',
              output: { text: aggregated },
              trace: buildTrace(startedAt, completedAt, degraded, [
                { type: 'model_started', at: toIso(startedAt) },
                { type: 'model_completed', at: toIso(completedAt) },
              ]),
              degradation,
            },
          };
        } catch (error) {
          // Cancel response body on error paths to avoid Workers stalled-response cap.
          if (response?.body) {
            await response.body.cancel().catch(() => {});
          }
          const completedAt = now();
          const isAbort = error instanceof Error && error.name === 'AbortError';
          const isCancelled = isAbort && request.signal?.aborted;
          yield {
            type: 'error',
            error: {
              code: isCancelled ? 'cancelled' : isAbort ? 'timeout' : 'backend_execution_error',
              message: error instanceof Error ? error.message : String(error),
              retryable: !isCancelled,
            },
          };
          yield {
            type: 'turn_finished',
            result: {
              schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
              backendId,
              status: 'failed',
              error: {
                code: isCancelled ? 'cancelled' : isAbort ? 'timeout' : 'backend_execution_error',
                message: error instanceof Error ? error.message : String(error),
                retryable: !isCancelled,
              },
              trace: buildTrace(startedAt, completedAt, degraded),
              degradation,
            },
          };
        } finally {
          clearTimeout(timeout);
          request.signal?.removeEventListener('abort', abortFromRequest);
        }
      },
    };
  }
}

function makeUnsupportedStream(
  backendId: string,
  reasons: ExecutionNegotiationReason[],
): AsyncIterable<ExecutionStreamEvent> {
  const message = reasons.map((reason) => reason.message).join(' ');
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'error', error: { code: 'unsupported_capability', message, retryable: false } };
      yield {
        type: 'turn_finished',
        result: {
          schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
          backendId,
          status: 'unsupported',
          error: { code: 'unsupported_capability', message },
          degradation: reasons,
          trace: { summary: { degraded: false } },
        },
      };
    },
  };
}

function makeFailedStream(
  backendId: string,
  err: { code: 'backend_execution_error'; message: string; retryable?: boolean },
): AsyncIterable<ExecutionStreamEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'error', error: { code: err.code, message: err.message, retryable: err.retryable } };
      yield {
        type: 'turn_finished',
        result: {
          schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
          backendId,
          status: 'failed',
          error: { code: err.code, message: err.message, retryable: err.retryable },
          trace: { summary: { degraded: false } },
        },
      };
    },
  };
}

async function* emitCancelledStream(
  backendId: string,
  startedAt: number,
  now: () => number,
): AsyncIterable<ExecutionStreamEvent> {
  const completedAt = now();
  yield {
    type: 'error',
    error: { code: 'cancelled', message: 'Execution request was cancelled before it started.', retryable: false },
  };
  yield {
    type: 'turn_finished',
    result: {
      schemaVersion: EXECUTION_CONTRACT_SCHEMA_VERSION,
      backendId,
      status: 'failed',
      error: { code: 'cancelled', message: 'Execution request was cancelled before it started.', retryable: false },
      trace: buildTrace(startedAt, completedAt, false),
    },
  };
}

/**
 * Streams Server-Sent Events frames out of a ReadableStream. Each yielded
 * value is the raw `data:` payload for one event (without the `data: ` prefix).
 * Handles UTF-8 byte boundaries and chunk-split lines via a buffer + TextDecoder.
 */
async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n\n');
      while (newlineIndex !== -1) {
        const frame = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 2);
        const dataLine = frame
          .split('\n')
          .find((line) => line.startsWith('data:'));
        if (dataLine) {
          yield dataLine.slice(5).trimStart();
        }
        newlineIndex = buffer.indexOf('\n\n');
      }
    }
    // Flush any final partial frame.
    buffer += decoder.decode();
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data:')) {
      yield trimmed.slice(5).trim();
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignored — releaseLock can throw if already released.
    }
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractDeltaText(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!first || typeof first !== 'object') return undefined;
  const delta = (first as { delta?: unknown }).delta;
  if (delta && typeof delta === 'object') {
    const content = (delta as { content?: unknown }).content;
    if (typeof content === 'string' && content.length > 0) return content;
  }
  // Some providers send the full message in `message.content` on the final frame.
  const message = (first as { message?: unknown }).message;
  if (message && typeof message === 'object') {
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string' && content.length > 0) return content;
  }
  return undefined;
}

export function createOpenRouterAdapter(
  config: OpenRouterAdapterConfig = {},
): ExecutionAdapter {
  return new OpenRouterExecutionAdapter(config);
}
