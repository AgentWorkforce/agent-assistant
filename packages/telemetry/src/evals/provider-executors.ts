import {
  createOpenCodeCliRunner,
  type CliRunner,
} from '@agent-assistant/harness/worker-bridge';

import {
  createSkippedEvalError,
  type HumanEvalExecutor,
} from './human-runner-cli.js';
import type { HumanEvalActual, HumanEvalCase } from './human-suite.js';

export interface HumanEvalPromptOptions {
  productName?: string;
  systemPrompt?: string | ((testCase: HumanEvalCase) => string | undefined);
  instructions?: string | string[];
}

export interface OpenCodeHumanEvalExecutorOptions extends HumanEvalPromptOptions {
  command?: string;
  model?: string;
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requireProviderMode?: boolean;
  runner?: CliRunner;
}

export interface AgentRelayHumanEvalExecutorOptions extends HumanEvalPromptOptions {
  channelId?: string;
  workerName?: string;
  orchestratorName?: string;
  workspaceId?: string;
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  binaryPath?: string;
  spawnWorker?: {
    enabled?: boolean;
    name?: string;
    cli: string;
    task?: string;
    model?: string;
    cwd?: string;
    team?: string;
    includeWorkflowConventions?: boolean;
  };
  adapter?: HumanEvalExecutionAdapter;
  adapterFactory?: () => HumanEvalExecutionAdapter | Promise<HumanEvalExecutionAdapter>;
  requireProviderMode?: boolean;
}

interface HumanEvalExecutionAdapter {
  execute(request: HumanEvalExecutionRequest): Promise<HumanEvalExecutionResult>;
}

interface HumanEvalExecutionRequest {
  assistantId: string;
  turnId: string;
  threadId: string;
  userId?: string;
  message: {
    id: string;
    text: string;
    receivedAt: string;
  };
  instructions: {
    systemPrompt: string;
  };
  context?: {
    blocks: Array<{
      id: string;
      label: string;
      text: string;
      category?: string;
    }>;
    structured?: Record<string, unknown>;
  };
  requirements?: {
    toolUse?: 'forbidden' | 'allowed' | 'required';
    structuredToolCalls?: 'forbidden' | 'preferred' | 'required';
    traceDepth?: 'minimal' | 'standard' | 'detailed';
  };
  metadata?: Record<string, unknown>;
}

interface HumanEvalExecutionResult {
  backendId?: string;
  status?: string;
  output?: {
    text?: string;
    structured?: Record<string, unknown>;
  };
  error?: {
    code?: string;
    message?: string;
  };
  trace?: unknown;
  metadata?: Record<string, unknown>;
}

const DEFAULT_OPENCODE_TIMEOUT_MS = 120_000;
const DEFAULT_AGENT_RELAY_TIMEOUT_MS = 300_000;

export function createOpenCodeHumanEvalExecutor(
  options: OpenCodeHumanEvalExecutorOptions = {},
): HumanEvalExecutor {
  const requireProviderMode = options.requireProviderMode ?? true;
  const runner = options.runner ?? createOpenCodeCliRunner({ command: options.command });

  return async (testCase, context) => {
    if (requireProviderMode && !context.providerMode) {
      throw createSkippedEvalError('opencode executor skipped; rerun with --provider or HUMAN_EVAL_PROVIDER=1');
    }

    const startedAt = Date.now();
    const result = await runner.run({
      prompt: buildHumanEvalOneShotPrompt(testCase, options),
      timeoutMs: options.timeoutMs ?? DEFAULT_OPENCODE_TIMEOUT_MS,
      cwd: options.cwd ?? context.rootDir,
      env: options.env ?? process.env,
      model: options.model,
    });
    const durationMs = Date.now() - startedAt;

    if (result.status === 'completed') {
      return {
        ok: true,
        status: 'completed',
        content: result.text,
        toolCalls: [],
        ...(options.model ? { model: options.model } : {}),
        notes: `Ran OpenCode one-shot eval in ${durationMs}ms.`,
      } satisfies HumanEvalActual;
    }

    if (result.error.startsWith('Failed to spawn')) {
      throw createSkippedEvalError(result.error);
    }

    return {
      ok: false,
      status: 'failed',
      content: [result.error, result.stderr].filter(Boolean).join('\n'),
      toolCalls: [],
      ...(options.model ? { model: options.model } : {}),
      notes: `OpenCode one-shot eval failed in ${durationMs}ms.`,
    } satisfies HumanEvalActual;
  };
}

export function createAgentRelayHumanEvalExecutor(
  options: AgentRelayHumanEvalExecutorOptions = {},
): HumanEvalExecutor {
  const requireProviderMode = options.requireProviderMode ?? true;

  return async (testCase, context) => {
    if (requireProviderMode && !context.providerMode) {
      throw createSkippedEvalError('agent-relay executor skipped; rerun with --provider or HUMAN_EVAL_PROVIDER=1');
    }

    const adapter = await resolveAgentRelayAdapter(options, context.rootDir);
    const result = await adapter.execute(buildAgentRelayEvalRequest(testCase, options));
    return executionResultToHumanEvalActual(result);
  };
}

export function buildHumanEvalOneShotPrompt(
  testCase: HumanEvalCase,
  options: HumanEvalPromptOptions = {},
): string {
  const productName = options.productName ?? 'the product';
  const sections = [
    `You are evaluating ${productName} behavior by answering as the product assistant.`,
    'Answer the user request directly. Do not mention the eval harness or hidden rubric.',
  ];
  const instructions = Array.isArray(options.instructions)
    ? options.instructions.join(' ')
    : options.instructions;
  const systemPrompt = readSystemPrompt(testCase, options);
  const threadHistory = Array.isArray(testCase.input.threadHistory)
    ? testCase.input.threadHistory
    : undefined;

  if (instructions) {
    sections.push(instructions);
  }
  if (systemPrompt) {
    sections.push(`System context:\n${systemPrompt}`);
  }
  if (threadHistory && threadHistory.length > 0) {
    sections.push(`Thread history:\n${JSON.stringify(threadHistory, null, 2)}`);
  }
  sections.push(`User request:\n${String(testCase.input.message ?? '').trim()}`);
  return sections.join('\n\n');
}

function buildAgentRelayEvalRequest(
  testCase: HumanEvalCase,
  options: AgentRelayHumanEvalExecutorOptions,
): HumanEvalExecutionRequest {
  const threadId = readInputString(testCase, 'threadId') ?? testCase.id;
  const prompt = buildHumanEvalOneShotPrompt(testCase, options);
  return {
    assistantId: options.productName ?? 'human-eval',
    turnId: `eval-${testCase.id}`,
    threadId,
    userId: readInputString(testCase, 'userId') ?? 'eval-user',
    message: {
      id: testCase.id,
      text: String(testCase.input.message ?? ''),
      receivedAt: new Date().toISOString(),
    },
    instructions: {
      systemPrompt: prompt,
    },
    context: {
      blocks: [],
      structured: {
        evalCaseId: testCase.id,
        suite: testCase.suite,
        tags: testCase.tags ?? [],
      },
    },
    requirements: {
      toolUse: 'allowed',
      structuredToolCalls: 'preferred',
      traceDepth: 'standard',
    },
    metadata: {
      source: 'agent-assistant-human-eval',
      executor: 'agent-relay',
    },
  };
}

async function resolveAgentRelayAdapter(
  options: AgentRelayHumanEvalExecutorOptions,
  rootDir: string,
): Promise<HumanEvalExecutionAdapter> {
  if (options.adapter) return options.adapter;
  if (options.adapterFactory) return options.adapterFactory();

  const { createAgentRelayExecutionAdapter } = await import('@agent-assistant/harness/agent-relay');
  return createAgentRelayExecutionAdapter({
    channelId: options.channelId ?? 'agent-assistant-evals',
    workerName: options.workerName,
    orchestratorName: options.orchestratorName ?? 'agent-assistant-eval',
    workspaceId: options.workspaceId,
    timeoutMs: options.timeoutMs ?? DEFAULT_AGENT_RELAY_TIMEOUT_MS,
    cwd: options.cwd ?? rootDir,
    env: options.env,
    binaryPath: options.binaryPath,
    spawnWorker: options.spawnWorker,
    shutdownAfterExecute: true,
  }) as HumanEvalExecutionAdapter;
}

function executionResultToHumanEvalActual(result: HumanEvalExecutionResult): HumanEvalActual {
  const content = result.output?.text ?? result.error?.message ?? '';
  const structured = result.output?.structured ?? {};
  return {
    ok: result.status === 'completed',
    status: result.status,
    content,
    toolCalls: readToolCalls(structured),
    notes: result.error?.message
      ? `Agent Relay eval returned ${result.error.code ?? 'error'}: ${result.error.message}`
      : `Agent Relay eval completed via ${result.backendId ?? 'unknown backend'}.`,
    relay: result.metadata?.relay,
    trace: result.trace,
  };
}

function readToolCalls(structured: Record<string, unknown>): HumanEvalActual['toolCalls'] {
  const raw = structured.toolCalls ?? structured.tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((call): call is Record<string, unknown> => call !== null && typeof call === 'object')
    .map((call) => ({ ...call, name: String(call.name ?? '') }));
}

function readSystemPrompt(testCase: HumanEvalCase, options: HumanEvalPromptOptions): string | undefined {
  if (typeof options.systemPrompt === 'function') {
    return options.systemPrompt(testCase);
  }
  if (typeof options.systemPrompt === 'string' && options.systemPrompt.trim().length > 0) {
    return options.systemPrompt.trim();
  }
  return readInputString(testCase, 'systemPrompt');
}

function readInputString(testCase: HumanEvalCase, key: string): string | undefined {
  const value = testCase.input[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
