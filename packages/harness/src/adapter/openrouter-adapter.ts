import type {
  ExecutionAdapter,
  ExecutionCapabilities,
  ExecutionNegotiation,
  ExecutionNegotiationReason,
  ExecutionRequest,
  ExecutionResult,
  ExecutionTrace,
  ExecutionTraceEvent,
} from './types.js';

const OPENROUTER_CAPABILITIES: ExecutionCapabilities = {
  toolUse: 'none',
  structuredToolCalls: false,
  continuationSupport: 'none',
  approvalInterrupts: 'none',
  traceDepth: 'minimal',
  attachments: false,
  maxContextStrategy: 'large',
  notes: ['Direct hosted API adapter', 'Bounded no-tool proof slice only'],
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
    this.fetchImpl = config.fetchImpl ?? fetch;
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
        backendId: this.backendId,
        status: 'failed',
        error: {
          code: 'backend_execution_error',
          message: 'OpenRouter API key is not configured.',
        },
        degradation: negotiation.degraded ? negotiation.reasons : undefined,
      };
    }

    const startedAt = this.now();
    const abortController = new AbortController();
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
      return {
        backendId: this.backendId,
        status: 'failed',
        error: {
          code: isAbort ? 'timeout' : 'backend_execution_error',
          message: isAbort
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
    }
  }
}

export function createOpenRouterAdapter(
  config: OpenRouterAdapterConfig = {},
): ExecutionAdapter {
  return new OpenRouterExecutionAdapter(config);
}
