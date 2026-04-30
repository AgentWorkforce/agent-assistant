import { z } from 'zod';

import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolExecutionContext,
  HarnessToolRegistry,
  HarnessToolResult,
} from './types.js';

/**
 * Subagent task tool — delegates work to isolated, allowlist-scoped
 * subagents that run in their own harness turn and return only a
 * synthesized text result.
 *
 * Ported from langchain-ai/deepagents (MIT)
 * libs/deepagents/deepagents/middleware/subagents.py:184-191
 * libs/deepagents/deepagents/middleware/subagents.py:194-206
 * libs/deepagents/deepagents/middleware/subagents.py:363-387
 *
 * Reimplemented from scratch in TS in the @agent-assistant/harness
 * idiom. Sourcing constraints documented in the porting workflow's
 * README — no references to leaked sources permitted in this file.
 */

export interface HarnessSubagent {
  /** Stable identifier the parent uses in subagent_type. */
  name: string;
  /** Human-readable description shown in the task tool's enum docs. */
  description: string;
  /**
   * Allowed tool names (whitelist) for this subagent. The subagent
   * sees ONLY these tools, not the parent's full registry.
   */
  toolAllowlist: readonly string[];
  /** System prompt fragment prepended to the subagent's persona. */
  systemPrompt: string;
  /** Maximum tool-iteration count for this subagent. Default 8. */
  maxIterations?: number;
}

export interface HarnessSubagentRegistry {
  list(): readonly HarnessSubagent[];
  get(name: string): HarnessSubagent | undefined;
}

export interface TaskToolInput {
  description: string;
  subagent_type: string;
}

export interface TaskToolResult {
  ok: boolean;
  /** Synthesized final output of the subagent (assistant text). */
  output?: string;
  /** Present when ok === false. */
  error?: { message: string; code?: string };
  /** For telemetry — number of tool iterations the subagent used. */
  iterations: number;
  /** For telemetry — the subagent that produced this result. */
  subagent: string;
}

/**
 * The current harness tool seam only passes a tool execution context into
 * registry.execute(). Keep this type structural so callers can pass richer
 * per-turn context objects later without widening this step's file scope.
 */
export type HarnessTurnContext = HarnessToolExecutionContext & Record<string, unknown>;

export interface CreateSubagentToolRegistryOptions {
  subagents: readonly HarnessSubagent[];
  runSubagent: (input: {
    subagent: HarnessSubagent;
    description: string;
    parentContext: HarnessTurnContext;
  }) => Promise<{ output: string; iterations: number }>;
  defaultMaxIterations?: number;
}

export const SUBAGENT_DEFAULT_MAX_ITERATIONS = 8;

export const SUBAGENT_EXCLUDED_PARENT_KEYS = [
  'messages',
  'todos',
  'structuredResponse',
  'skillsMetadata',
  'memoryContents',
] as const;

const TASK_TOOL_NAME = 'task';

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function errorResult(
  call: HarnessToolCall,
  code: string,
  message: string,
  retryable: boolean,
): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'error',
    error: {
      code,
      message,
      retryable,
    },
  };
}

function unknownToolResult(call: HarnessToolCall): HarnessToolResult {
  return errorResult(call, 'unknown_tool', `Unknown tool: ${call.name}`, false);
}

function invalidInputResult(call: HarnessToolCall, message: string): HarnessToolResult {
  return errorResult(call, 'invalid_input', message, false);
}

function successResult(
  call: HarnessToolCall,
  result: TaskToolResult,
): HarnessToolResult {
  const structuredOutput: Record<string, unknown> = {
    ok: result.ok,
    iterations: result.iterations,
    subagent: result.subagent,
    ...(result.output !== undefined ? { output: result.output } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };

  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output: formatJson(result),
    structuredOutput,
  };
}

function normalizeMaxIterations(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

function buildSubagentRegistry(
  subagents: readonly HarnessSubagent[],
  defaultMaxIterations: number,
): HarnessSubagentRegistry {
  const byName = new Map<string, HarnessSubagent>();
  for (const subagent of subagents) {
    byName.set(subagent.name, {
      ...subagent,
      maxIterations: normalizeMaxIterations(subagent.maxIterations, defaultMaxIterations),
    });
  }

  return {
    list() {
      return [...byName.values()];
    },
    get(name: string) {
      return byName.get(name);
    },
  };
}

function buildTaskToolDescription(subagents: readonly HarnessSubagent[]): string {
  const availableSubagents = subagents
    .map((subagent) => `  - ${subagent.name}: ${subagent.description}`)
    .join('\n');

  return [
    'Delegate a sub-task to a specialized subagent. Pick a subagent by name.',
    'Multiple task calls can be issued in a single tool_request batch and will run in parallel.',
    '',
    'Available subagents:',
    availableSubagents,
  ].join('\n');
}

function buildTaskToolSchema(subagentNames: readonly string[]) {
  const enumValues = [...subagentNames] as [string, ...string[]];

  return z.object({
    description: z
      .string()
      .min(1)
      .describe(
        'Detailed brief for the subagent: full context, what to do, expected output format. Phrase as if to a fresh assistant.',
      ),
    subagent_type: z
      .enum(enumValues)
      .describe('Which subagent to invoke.'),
  });
}

function buildTaskToolDefinition(subagents: readonly HarnessSubagent[]): HarnessToolDefinition {
  const subagentNames = subagents.map((subagent) => subagent.name);

  return {
    name: TASK_TOOL_NAME,
    description: buildTaskToolDescription(subagents),
    inputSchema: {
      type: 'object',
      required: ['description', 'subagent_type'],
      properties: {
        description: {
          type: 'string',
          minLength: 1,
          description:
            'Detailed brief for the subagent: full context, what to do, expected output format. Phrase as if to a fresh assistant.',
        },
        subagent_type: {
          type: 'string',
          enum: subagentNames,
          description: 'Which subagent to invoke.',
        },
      },
    },
  };
}

function readIterations(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.floor(value);
}

function getThrownIterations(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  return (
    readIterations(record.iterations) ??
    readIterations(record.iterationCount) ??
    readIterations(record.maxIterations)
  );
}

function classifySubagentError(error: unknown): {
  code: string;
  message: string;
} {
  if (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return {
      code: 'aborted',
      message: toErrorMessage(error),
    };
  }

  const message = toErrorMessage(error);

  if (
    message.includes('max_iterations') ||
    message.includes('MaxIterationsReached')
  ) {
    return {
      code: 'max_iterations',
      message,
    };
  }

  if (
    (error as { code?: unknown } | null)?.code === 'invalid_output' ||
    message.includes('invalid_output')
  ) {
    return {
      code: 'invalid_output',
      message,
    };
  }

  return {
    code: 'subagent_threw',
    message,
  };
}

function unknownSubagentResult(
  call: HarnessToolCall,
  subagentName: string,
): HarnessToolResult {
  return successResult(call, {
    ok: false,
    error: {
      message: `Unknown subagent: ${subagentName}`,
      code: 'unknown_subagent',
    },
    iterations: 0,
    subagent: subagentName,
  });
}

export function filterParentContextForSubagent(
  parent: HarnessTurnContext,
): HarnessTurnContext {
  const filtered: HarnessTurnContext = { ...parent };
  for (const key of SUBAGENT_EXCLUDED_PARENT_KEYS) {
    delete filtered[key];
  }
  return filtered;
}

export function createSubagentToolRegistry(
  options: CreateSubagentToolRegistryOptions,
): HarnessToolRegistry {
  const defaultMaxIterations = normalizeMaxIterations(
    options.defaultMaxIterations,
    SUBAGENT_DEFAULT_MAX_ITERATIONS,
  );
  const subagentRegistry = buildSubagentRegistry(options.subagents, defaultMaxIterations);
  const subagents = subagentRegistry.list();

  if (subagents.length === 0) {
    // No registered subagents means the harness should not advertise a task tool.
    return {
      async listAvailable() {
        return [];
      },
      async execute(call) {
        return unknownToolResult(call);
      },
    };
  }

  const taskTool = buildTaskToolDefinition(subagents);
  const taskToolSchema = buildTaskToolSchema(subagents.map((subagent) => subagent.name));

  return {
    async listAvailable(input: HarnessToolAvailabilityInput) {
      if (!input.allowedToolNames || input.allowedToolNames.length === 0) {
        return [taskTool];
      }

      return input.allowedToolNames.includes(TASK_TOOL_NAME) ? [taskTool] : [];
    },

    async execute(call: HarnessToolCall, context: HarnessToolExecutionContext) {
      if (call.name !== TASK_TOOL_NAME) {
        return unknownToolResult(call);
      }

      const validation = taskToolSchema.safeParse(call.input);
      if (!validation.success) {
        return invalidInputResult(call, validation.error.issues[0]?.message ?? 'Invalid task input');
      }

      const input = validation.data;
      const subagent = subagentRegistry.get(input.subagent_type);
      if (!subagent) {
        return unknownSubagentResult(call, input.subagent_type);
      }

      const parentContext = filterParentContextForSubagent(context as HarnessTurnContext);

      try {
        const result = await options.runSubagent({
          subagent,
          description: input.description,
          parentContext,
        });

        return successResult(call, {
          ok: true,
          output: result.output,
          iterations: readIterations(result.iterations) ?? 0,
          subagent: subagent.name,
        });
      } catch (error) {
        const classified = classifySubagentError(error);
        const iterations =
          getThrownIterations(error) ??
          (classified.code === 'max_iterations'
            ? subagent.maxIterations ?? defaultMaxIterations
            : 0);

        return successResult(call, {
          ok: false,
          error: classified,
          iterations,
          subagent: subagent.name,
        });
      }
    },
  };
}
