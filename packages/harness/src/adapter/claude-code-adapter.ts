import type {
  ExecutionAdapter,
  ExecutionCapabilities,
  ExecutionRequest,
} from './types.js';
import {
  LocalCommandExecutionAdapter,
  type LocalCommandSpawnFn,
  type ParsedLocalCommandOutput,
} from './local-command-adapter.js';

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

export interface ClaudeCodeAdapterConfig {
  cliBinary?: string;
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  spawnProcess?: LocalCommandSpawnFn;
  now?: () => number;
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

function parseStructuredRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function parseClaudeOutput(raw: string): ParsedLocalCommandOutput | null {
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

export class ClaudeCodeExecutionAdapter implements ExecutionAdapter {
  readonly backendId = 'claude-code';

  private readonly adapter: LocalCommandExecutionAdapter;

  constructor(config: ClaudeCodeAdapterConfig = {}) {
    this.adapter = new LocalCommandExecutionAdapter({
      backendId: this.backendId,
      command: config.cliBinary ?? 'claude',
      buildArgs,
      parseOutput: parseClaudeOutput,
      capabilities: CLAUDE_CODE_CAPABILITIES,
      timeoutMs: config.timeoutMs,
      cwd: config.cwd,
      env: config.env,
      spawnProcess: config.spawnProcess,
      now: config.now,
      commandLabel: 'Claude Code CLI',
      traceDegradedFromNegotiation: false,
      isNonZeroExitRetryable: ({ code }) => code !== 2,
    });
  }

  describeCapabilities(): ExecutionCapabilities {
    return this.adapter.describeCapabilities();
  }

  negotiate(request: ExecutionRequest) {
    return this.adapter.negotiate(request);
  }

  execute(request: ExecutionRequest) {
    return this.adapter.execute(request);
  }
}

export function createClaudeCodeAdapter(
  config: ClaudeCodeAdapterConfig = {},
): ExecutionAdapter {
  return new ClaudeCodeExecutionAdapter(config);
}
