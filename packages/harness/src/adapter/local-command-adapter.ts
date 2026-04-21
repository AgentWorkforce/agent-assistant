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

export interface LocalCommandChildProcess extends EventEmitter {
  stdout?: EventEmitter & { setEncoding?(encoding: BufferEncoding): void };
  stderr?: EventEmitter & { setEncoding?(encoding: BufferEncoding): void };
  kill?(signal?: NodeJS.Signals | number): boolean;
}

export type LocalCommandSpawnFn = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    stdio: 'pipe';
  },
) => LocalCommandChildProcess;

export interface ParsedLocalCommandOutput {
  text?: string;
  attachments?: NonNullable<ExecutionResult['output']>['attachments'];
  structured?: Record<string, unknown>;
  toolCalls?: unknown[];
  metadata?: Record<string, unknown>;
}

export interface LocalCommandAdapterConfig {
  backendId: string;
  command: string;
  buildArgs: (request: ExecutionRequest) => string[];
  parseOutput: (stdout: string) => ParsedLocalCommandOutput | null;
  capabilities: ExecutionCapabilities;
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  spawnProcess?: LocalCommandSpawnFn;
  now?: () => number;
  commandLabel?: string;
  traceDegradedFromNegotiation?: boolean;
  isNonZeroExitRetryable?: (exit: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }) => boolean;
}

const TRACE_DEPTH_ORDER: Record<ExecutionCapabilities['traceDepth'], number> = {
  minimal: 0,
  standard: 1,
  detailed: 2,
};

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function cloneCapabilities(capabilities: ExecutionCapabilities): ExecutionCapabilities {
  return {
    ...capabilities,
    ...(capabilities.notes ? { notes: [...capabilities.notes] } : {}),
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

function isTraceDepthReduced(
  requested: NonNullable<ExecutionRequest['requirements']>['traceDepth'],
  available: ExecutionCapabilities['traceDepth'],
): boolean {
  if (!requested) {
    return false;
  }

  return TRACE_DEPTH_ORDER[requested] > TRACE_DEPTH_ORDER[available];
}

function negotiateRequest(
  request: ExecutionRequest,
  capabilities: ExecutionCapabilities,
): ExecutionNegotiation {
  const reasons: ExecutionNegotiationReason[] = [];
  const requirements = request.requirements;
  const hasTools = (request.tools?.length ?? 0) > 0;
  const hasAttachments = (request.message.attachments?.length ?? 0) > 0;

  if (hasTools && requirements?.toolUse === 'forbidden') {
    reasons.push(requiredUnsupported('tool_use_unsupported', 'Request forbids tool use but tools were supplied.'));
  }

  if ((hasTools || requirements?.toolUse === 'required') && capabilities.toolUse === 'none') {
    reasons.push(requiredUnsupported('tool_use_unsupported', 'Backend does not support tool use.'));
  }

  if (requirements?.structuredToolCalls === 'required' && !capabilities.structuredToolCalls) {
    reasons.push(
      requiredUnsupported(
        'structured_tool_calls_unsupported',
        'Structured tool calls are required but unsupported.',
      ),
    );
  } else if (requirements?.structuredToolCalls === 'preferred' && !capabilities.structuredToolCalls) {
    reasons.push(
      preferredDegradation(
        'structured_tool_calls_unsupported',
        'Structured tool calls are preferred but unsupported.',
      ),
    );
  }

  if (requirements?.continuationSupport === 'required' && capabilities.continuationSupport === 'none') {
    reasons.push(
      requiredUnsupported(
        'continuation_unsupported',
        'Structured continuation support is required but unavailable.',
      ),
    );
  } else if (requirements?.continuationSupport === 'preferred' && capabilities.continuationSupport === 'none') {
    reasons.push(
      preferredDegradation(
        'continuation_unsupported',
        'Continuation support is preferred but unavailable.',
      ),
    );
  }

  if (requirements?.approvalInterrupts === 'required' && capabilities.approvalInterrupts === 'none') {
    reasons.push(
      requiredUnsupported(
        'approval_interrupt_unsupported',
        'Approval interrupts are required but unsupported.',
      ),
    );
  } else if (requirements?.approvalInterrupts === 'preferred' && capabilities.approvalInterrupts === 'none') {
    reasons.push(
      preferredDegradation(
        'approval_interrupt_unsupported',
        'Approval interrupts are preferred but unavailable.',
      ),
    );
  }

  if ((hasAttachments || requirements?.attachments === 'required') && !capabilities.attachments) {
    reasons.push(
      requiredUnsupported(
        'attachments_unsupported',
        'Attachments are required by the request but unsupported by this adapter path.',
      ),
    );
  }

  if (isTraceDepthReduced(requirements?.traceDepth, capabilities.traceDepth)) {
    reasons.push(
      preferredDegradation(
        'trace_depth_reduced',
        `${requirements?.traceDepth ?? 'Requested'} trace depth was requested but only ${
          capabilities.traceDepth
        } trace facts are available.`,
      ),
    );
  }

  const supported = !reasons.some((reason) => reason.severity === 'blocking');
  const degraded = reasons.some((reason) => reason.severity !== 'blocking');

  return {
    supported,
    degraded,
    reasons,
    effectiveCapabilities: cloneCapabilities(capabilities),
  };
}

function buildTrace(
  startedAt: number,
  completedAt: number,
  toolCallCount: number,
  degraded: boolean,
  events?: ExecutionTraceEvent[],
): ExecutionTrace {
  return {
    summary: {
      startedAt: toIso(startedAt),
      completedAt: toIso(completedAt),
      stepCount: 1,
      toolCallCount,
      degraded,
    },
    ...(events && events.length > 0 ? { events } : {}),
  };
}

function buildOutput(parsed: ParsedLocalCommandOutput): NonNullable<ExecutionResult['output']> {
  return {
    ...(parsed.text !== undefined ? { text: parsed.text } : {}),
    ...(parsed.attachments !== undefined ? { attachments: parsed.attachments } : {}),
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
  };
}

export class LocalCommandExecutionAdapter implements ExecutionAdapter {
  readonly backendId: string;

  private readonly command: string;
  private readonly buildArgs: LocalCommandAdapterConfig['buildArgs'];
  private readonly parseOutput: LocalCommandAdapterConfig['parseOutput'];
  private readonly capabilities: ExecutionCapabilities;
  private readonly timeoutMs: number;
  private readonly cwd?: string;
  private readonly env?: Record<string, string>;
  private readonly spawnProcess: LocalCommandSpawnFn;
  private readonly now: NonNullable<LocalCommandAdapterConfig['now']>;
  private readonly commandLabel: string;
  private readonly traceDegradedFromNegotiation: boolean;
  private readonly isNonZeroExitRetryable: NonNullable<LocalCommandAdapterConfig['isNonZeroExitRetryable']>;

  constructor(config: LocalCommandAdapterConfig) {
    this.backendId = config.backendId;
    this.command = config.command;
    this.buildArgs = config.buildArgs;
    this.parseOutput = config.parseOutput;
    this.capabilities = cloneCapabilities(config.capabilities);
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
        }) as LocalCommandChildProcess);
    this.now = config.now ?? Date.now;
    this.commandLabel = config.commandLabel ?? `${config.backendId} command`;
    this.traceDegradedFromNegotiation = config.traceDegradedFromNegotiation ?? true;
    this.isNonZeroExitRetryable = config.isNonZeroExitRetryable ?? (() => true);
  }

  describeCapabilities(): ExecutionCapabilities {
    return cloneCapabilities(this.capabilities);
  }

  negotiate(request: ExecutionRequest): ExecutionNegotiation {
    return negotiateRequest(request, this.capabilities);
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
    const degraded = this.traceDegradedFromNegotiation ? negotiation.degraded : false;
    const child = this.spawnProcess(this.command, this.buildArgs(request), {
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
            message: `${this.commandLabel} timed out after ${this.timeoutMs}ms.`,
            retryable: true,
          },
          trace: buildTrace(startedAt, completedAt, 0, degraded, [
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
            message: error instanceof Error ? error.message : `Unknown ${this.commandLabel} execution error.`,
            retryable: true,
          },
          trace: buildTrace(startedAt, completedAt, 0, degraded, [
            {
              type: 'failure',
              at: toIso(completedAt),
              data: { stderr },
            },
          ]),
          degradation: negotiation.degraded ? negotiation.reasons : undefined,
        });
      });

      child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
        const completedAt = this.now();

        if (code !== 0) {
          finalize({
            backendId: this.backendId,
            status: 'failed',
            error: {
              code: 'backend_execution_error',
              message: `${this.commandLabel} exited with code ${code ?? 'unknown'}${
                signal ? ` (signal ${signal})` : ''
              }.`,
              retryable: this.isNonZeroExitRetryable({ code, signal }),
              metadata: stderr ? { stderr } : undefined,
            },
            trace: buildTrace(startedAt, completedAt, 0, degraded, [
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

        let parsed: ParsedLocalCommandOutput | null = null;
        try {
          parsed = this.parseOutput(stdout);
        } catch {
          parsed = null;
        }

        if (!parsed) {
          finalize({
            backendId: this.backendId,
            status: 'failed',
            error: {
              code: 'invalid_backend_output',
              message: `${this.commandLabel} returned malformed output.`,
              metadata: { stdout, stderr },
            },
            trace: buildTrace(startedAt, completedAt, 0, degraded, [
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
          output: buildOutput(parsed),
          trace: buildTrace(startedAt, completedAt, toolCallCount, degraded, [
            { type: 'model_started', at: toIso(startedAt) },
            {
              type: 'model_completed',
              at: toIso(completedAt),
              data: { toolCallCount },
            },
          ]),
          degradation: negotiation.degraded ? negotiation.reasons : undefined,
          metadata:
            stderr || parsed.metadata
              ? {
                  ...(stderr ? { stderr } : {}),
                  ...(parsed.metadata ?? {}),
                }
              : undefined,
        });
      });
    });
  }
}

export function createLocalCommandAdapter(
  config: LocalCommandAdapterConfig,
): ExecutionAdapter {
  return new LocalCommandExecutionAdapter(config);
}
