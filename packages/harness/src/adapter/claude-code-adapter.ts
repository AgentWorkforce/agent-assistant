import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

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

const CLAUDE_CODE_CAPABILITIES: ExecutionCapabilities = {
  toolUse: 'native-iterative',
  structuredToolCalls: true,
  continuationSupport: 'none',
  approvalInterrupts: 'none',
  traceDepth: 'minimal',
  attachments: false,
  maxContextStrategy: 'large',
  notes: ['Bounded local CLI invocation only', 'No cloud routing or continuation resume ownership'],
};

interface ChildLike extends EventEmitter {
  stdout?: EventEmitter & { setEncoding?(encoding: BufferEncoding): void };
  stderr?: EventEmitter & { setEncoding?(encoding: BufferEncoding): void };
  kill?(signal?: NodeJS.Signals | number): boolean;
}

export interface ClaudeCodeAdapterConfig {
  cliBinary?: string;
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  spawnProcess?: (
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env: NodeJS.ProcessEnv;
      stdio: 'pipe';
    },
  ) => ChildLike;
  now?: () => number;
}

interface ParsedClaudeOutput {
  text?: string;
  structured?: Record<string, unknown>;
  toolCalls?: unknown[];
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function buildPrompt(request: ExecutionRequest): string {
  const sections: string[] = [];

  if (request.instructions.developerPrompt?.trim()) {
    sections.push(`Developer instructions:\n${request.instructions.developerPrompt}`);
  }

  const blocks = request.context?.blocks ?? [];
  if (blocks.length > 0) {
    const renderedBlocks = blocks
      .map((block) => `- [${block.label}] ${block.text}`)
      .join('\n');
    sections.push(`Context:\n${renderedBlocks}`);
  }

  if (request.context?.structured && Object.keys(request.context.structured).length > 0) {
    sections.push(`Structured context:\n${JSON.stringify(request.context.structured, null, 2)}`);
  }

  sections.push(`User message:\n${request.message.text}`);

  return sections.join('\n\n');
}

function buildArgs(request: ExecutionRequest): string[] {
  const args = ['--print', '--output-format', 'json', '--system-prompt', request.instructions.systemPrompt];

  const toolNames = (request.tools ?? []).map((tool) => tool.name.trim()).filter(Boolean);
  if (toolNames.length > 0) {
    args.push('--allowedTools', toolNames.join(','));
  }

  args.push(buildPrompt(request));

  return args;
}

function buildTrace(
  startedAt: number,
  completedAt: number,
  toolCallCount: number,
  events?: ExecutionTraceEvent[],
): ExecutionTrace {
  return {
    summary: {
      startedAt: toIso(startedAt),
      completedAt: toIso(completedAt),
      stepCount: 1,
      toolCallCount,
      degraded: false,
    },
    ...(events && events.length > 0 ? { events } : {}),
  };
}

function parseStructuredRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function parseClaudeOutput(raw: string): ParsedClaudeOutput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const text =
    typeof record.text === 'string'
      ? record.text
      : typeof record.result === 'string'
        ? record.result
        : typeof record.output_text === 'string'
          ? record.output_text
          : undefined;

  const structured =
    parseStructuredRecord(record.structured) ??
    parseStructuredRecord(record.result) ??
    parseStructuredRecord(record.output);

  const toolCalls = Array.isArray(record.toolCalls)
    ? record.toolCalls
    : Array.isArray(record.tool_calls)
      ? record.tool_calls
      : undefined;

  if (text === undefined && structured === undefined && toolCalls === undefined) {
    return null;
  }

  return { text, structured, toolCalls };
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

function negotiateRequest(request: ExecutionRequest): ExecutionNegotiation {
  const reasons: ExecutionNegotiationReason[] = [];
  const requirements = request.requirements;

  if ((request.tools?.length ?? 0) > 0 && requirements?.toolUse === 'forbidden') {
    reasons.push(requiredUnsupported('tool_use_unsupported', 'Request forbids tool use but tools were supplied.'));
  }

  if (requirements?.toolUse === 'required' && CLAUDE_CODE_CAPABILITIES.toolUse === 'none') {
    reasons.push(requiredUnsupported('tool_use_unsupported', 'Backend does not support tool use.'));
  }

  if (requirements?.structuredToolCalls === 'required' && !CLAUDE_CODE_CAPABILITIES.structuredToolCalls) {
    reasons.push(
      requiredUnsupported(
        'structured_tool_calls_unsupported',
        'Structured tool calls are required but unsupported.',
      ),
    );
  }

  if (requirements?.continuationSupport === 'required') {
    reasons.push(
      requiredUnsupported(
        'continuation_unsupported',
        'Claude Code CLI cannot resume structured continuations in this proof slice.',
      ),
    );
  } else if (requirements?.continuationSupport === 'preferred') {
    reasons.push(
      preferredDegradation(
        'continuation_unsupported',
        'Continuation support is preferred but not available in this proof slice.',
      ),
    );
  }

  if (requirements?.approvalInterrupts === 'required') {
    reasons.push(
      requiredUnsupported(
        'approval_interrupt_unsupported',
        'Approval interrupts are required but unsupported in non-interactive CLI execution.',
      ),
    );
  } else if (requirements?.approvalInterrupts === 'preferred') {
    reasons.push(
      preferredDegradation(
        'approval_interrupt_unsupported',
        'Approval interrupts are preferred but unavailable in this proof slice.',
      ),
    );
  }

  if ((request.message.attachments?.length ?? 0) > 0 || requirements?.attachments === 'required') {
    if (!CLAUDE_CODE_CAPABILITIES.attachments) {
      reasons.push(
        requiredUnsupported(
          'attachments_unsupported',
          'Attachments are required by the request but unsupported by this adapter path.',
        ),
      );
    }
  }

  if (requirements?.traceDepth === 'detailed') {
    reasons.push(
      preferredDegradation(
        'trace_depth_reduced',
        'Detailed trace depth was requested but only minimal CLI trace facts are available.',
      ),
    );
  } else if (requirements?.traceDepth === 'standard' && CLAUDE_CODE_CAPABILITIES.traceDepth === 'minimal') {
    reasons.push(
      preferredDegradation(
        'trace_depth_reduced',
        'Standard trace depth was requested but only minimal CLI trace facts are available.',
      ),
    );
  }

  const supported = !reasons.some((reason) => reason.severity === 'blocking');
  const degraded = reasons.some((reason) => reason.severity !== 'blocking');

  return {
    supported,
    degraded,
    reasons,
    effectiveCapabilities: CLAUDE_CODE_CAPABILITIES,
  };
}

export class ClaudeCodeExecutionAdapter implements ExecutionAdapter {
  readonly backendId = 'claude-code';

  private readonly cliBinary: string;
  private readonly timeoutMs: number;
  private readonly cwd?: string;
  private readonly env?: Record<string, string>;
  private readonly spawnProcess: NonNullable<ClaudeCodeAdapterConfig['spawnProcess']>;
  private readonly now: NonNullable<ClaudeCodeAdapterConfig['now']>;

  constructor(config: ClaudeCodeAdapterConfig = {}) {
    this.cliBinary = config.cliBinary ?? 'claude';
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.cwd = config.cwd;
    this.env = config.env;
    this.spawnProcess =
      config.spawnProcess ??
      ((command, args, options) =>
        spawn(command, args, {
          cwd: options.cwd,
          env: options.env,
          stdio: options.stdio,
        }) as ChildLike);
    this.now = config.now ?? Date.now;
  }

  describeCapabilities(): ExecutionCapabilities {
    return {
      ...CLAUDE_CODE_CAPABILITIES,
      ...(CLAUDE_CODE_CAPABILITIES.notes ? { notes: [...CLAUDE_CODE_CAPABILITIES.notes] } : {}),
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

    const startedAt = this.now();
    const args = buildArgs(request);
    const child = this.spawnProcess(this.cliBinary, args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    return await new Promise<ExecutionResult>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill?.('SIGTERM');
        const completedAt = this.now();
        resolve({
          backendId: this.backendId,
          status: 'failed',
          error: {
            code: 'timeout',
            message: `Claude Code CLI timed out after ${this.timeoutMs}ms.`,
            retryable: true,
          },
          trace: buildTrace(startedAt, completedAt, 0, [
            {
              type: 'failure',
              at: toIso(completedAt),
              data: { stderr, timeoutMs: this.timeoutMs },
            },
          ]),
          degradation: negotiation.degraded ? negotiation.reasons : undefined,
        });
      }, this.timeoutMs);

      const finalize = (result: ExecutionResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      child.once('error', (error) => {
        const completedAt = this.now();
        finalize({
          backendId: this.backendId,
          status: 'failed',
          error: {
            code: 'backend_execution_error',
            message: error instanceof Error ? error.message : 'Unknown Claude Code execution error.',
            retryable: true,
          },
          trace: buildTrace(startedAt, completedAt, 0, [
            {
              type: 'failure',
              at: toIso(completedAt),
              data: { stderr },
            },
          ]),
          degradation: negotiation.degraded ? negotiation.reasons : undefined,
        });
      });

      child.once('close', (code, signal) => {
        const completedAt = this.now();

        if (code !== 0) {
          finalize({
            backendId: this.backendId,
            status: 'failed',
            error: {
              code: 'backend_execution_error',
              message: `Claude Code CLI exited with code ${code ?? 'unknown'}${signal ? ` (signal ${signal})` : ''}.`,
              retryable: code !== 2,
              metadata: stderr ? { stderr } : undefined,
            },
            trace: buildTrace(startedAt, completedAt, 0, [
              {
                type: 'failure',
                at: toIso(completedAt),
                data: { code, signal, stderr },
              },
            ]),
            degradation: negotiation.degraded ? negotiation.reasons : undefined,
          });
          return;
        }

        const parsed = parseClaudeOutput(stdout.trim());
        if (!parsed) {
          finalize({
            backendId: this.backendId,
            status: 'failed',
            error: {
              code: 'invalid_backend_output',
              message: 'Claude Code CLI returned malformed JSON output.',
              metadata: { stdout, stderr },
            },
            trace: buildTrace(startedAt, completedAt, 0, [
              {
                type: 'failure',
                at: toIso(completedAt),
                data: { stdoutPreview: stdout.slice(0, 200), stderr },
              },
            ]),
            degradation: negotiation.degraded ? negotiation.reasons : undefined,
          });
          return;
        }

        const toolCallCount = parsed.toolCalls?.length ?? 0;
        finalize({
          backendId: this.backendId,
          status: 'completed',
          output: {
            ...(parsed.text !== undefined ? { text: parsed.text } : {}),
            ...(parsed.structured !== undefined
              ? {
                  structured: {
                    ...parsed.structured,
                    ...(parsed.toolCalls !== undefined ? { toolCalls: parsed.toolCalls } : {}),
                  },
                }
              : parsed.toolCalls !== undefined
                ? { structured: { toolCalls: parsed.toolCalls } }
                : {}),
          },
          trace: buildTrace(startedAt, completedAt, toolCallCount, [
            { type: 'model_started', at: toIso(startedAt) },
            {
              type: 'model_completed',
              at: toIso(completedAt),
              data: { toolCallCount },
            },
          ]),
          degradation: negotiation.degraded ? negotiation.reasons : undefined,
          metadata: stderr ? { stderr } : undefined,
        });
      });
    });
  }
}

export function createClaudeCodeAdapter(
  config: ClaudeCodeAdapterConfig = {},
): ExecutionAdapter {
  return new ClaudeCodeExecutionAdapter(config);
}
