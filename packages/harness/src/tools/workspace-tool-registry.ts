import type { VfsEntry, VfsProvider, VfsSearchResult } from '@agent-assistant/vfs';
import type {
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolRegistry,
  HarnessToolResult,
} from '../types.js';

export interface WorkspaceToolRegistryOptions {
  provider?: VfsProvider | null;
  defaultSearchLimit?: number;
  maxListDepth?: number;
}

type WorkspaceProvider = 'github' | 'slack' | 'notion' | 'linear';

interface WorkspaceSearchOutput {
  path: string;
  provider: string;
  score?: number;
  preview?: string;
}

interface WorkspaceReadJsonOutput {
  path: string;
  json: unknown;
}

interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

interface ValidationFailure {
  ok: false;
  message: string;
}

type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_MAX_LIST_DEPTH = 3;
const MAX_SEARCH_LIMIT = 100;
const MAX_LIST_LIMIT = 200;
const MAX_SCHEMA_LIST_DEPTH = 5;
const MAX_OUTPUT_BYTES = 50 * 1024;

const WORKSPACE_PROVIDERS = ['github', 'slack', 'notion', 'linear'] as const;

export const WORKSPACE_SEARCH_TOOL_NAME = 'workspace_search';
export const WORKSPACE_LIST_TOOL_NAME = 'workspace_list';
export const WORKSPACE_READ_TOOL_NAME = 'workspace_read';
export const WORKSPACE_READ_JSON_TOOL_NAME = 'workspace_read_json';
export const WORKSPACE_TOOL_NAMES = [
  WORKSPACE_SEARCH_TOOL_NAME,
  WORKSPACE_LIST_TOOL_NAME,
  WORKSPACE_READ_TOOL_NAME,
  WORKSPACE_READ_JSON_TOOL_NAME,
] as const;

const WORKSPACE_SEARCH_TOOL: HarnessToolDefinition = {
  name: WORKSPACE_SEARCH_TOOL_NAME,
  description:
    'Search the workspace VFS across all providers (github, slack, notion, linear). Use for enumeration and keyword queries.',
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1 },
      provider: { type: 'string', enum: WORKSPACE_PROVIDERS },
      limit: { type: 'number', minimum: 1, maximum: MAX_SEARCH_LIMIT },
    },
  },
};

const WORKSPACE_LIST_TOOL: HarnessToolDefinition = {
  name: WORKSPACE_LIST_TOOL_NAME,
  description:
    'List entries under a VFS path. Use to browse provider namespaces (e.g. /github, /linear/issues).',
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', minLength: 1 },
      depth: { type: 'number', minimum: 1, maximum: MAX_SCHEMA_LIST_DEPTH },
      limit: { type: 'number', minimum: 1, maximum: MAX_LIST_LIMIT },
    },
  },
};

const WORKSPACE_READ_TOOL: HarnessToolDefinition = {
  name: WORKSPACE_READ_TOOL_NAME,
  description: 'Read a single file from the VFS by full path.',
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', minLength: 1 },
    },
  },
};

const WORKSPACE_READ_JSON_TOOL: HarnessToolDefinition = {
  name: WORKSPACE_READ_JSON_TOOL_NAME,
  description:
    'Read one JSON file from the workspace VFS by full path and return parsed JSON with its source path. Use when factual claims need exact structured data and cite the returned path.',
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', minLength: 1 },
    },
  },
};

const WORKSPACE_TOOLS = [
  WORKSPACE_SEARCH_TOOL,
  WORKSPACE_LIST_TOOL,
  WORKSPACE_READ_TOOL,
  WORKSPACE_READ_JSON_TOOL,
] satisfies HarnessToolDefinition[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkspaceProvider(value: unknown): value is WorkspaceProvider {
  return (
    typeof value === 'string' &&
    (WORKSPACE_PROVIDERS as readonly string[]).includes(value)
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function normalizeOption(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(max, Math.floor(value));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function stringifyOutput(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function stringifyArrayOutput(items: readonly unknown[]): string {
  const fullOutput = stringifyOutput(items);
  if (byteLength(fullOutput) <= MAX_OUTPUT_BYTES) {
    return fullOutput;
  }

  const truncatedItems = [...items];
  while (truncatedItems.length > 0) {
    const omitted = items.length - truncatedItems.length;
    const candidate = stringifyOutput([
      ...truncatedItems,
      {
        _truncated: true,
        omitted,
        message: 'Output exceeded 50KB; narrow the query or lower the limit.',
      },
    ]);

    if (byteLength(candidate) <= MAX_OUTPUT_BYTES) {
      return candidate;
    }

    truncatedItems.pop();
  }

  return stringifyOutput([
    {
      _truncated: true,
      omitted: items.length,
      message: 'Output exceeded 50KB; narrow the query or lower the limit.',
    },
  ]);
}

function stringifyObjectOutput(value: unknown): string {
  const fullOutput = stringifyOutput(value);
  if (byteLength(fullOutput) <= MAX_OUTPUT_BYTES) {
    return fullOutput;
  }
  return stringifyOutput({
    _truncated: true,
    message: 'Output exceeded 50KB; narrow the query or lower the limit.',
  });
}

function successResult(call: HarnessToolCall, output: string): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output,
  };
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

function workspaceUnavailableResult(call: HarnessToolCall): HarnessToolResult {
  return errorResult(
    call,
    'workspace_unavailable',
    'Workspace VFS not configured',
    false,
  );
}

function unknownToolResult(call: HarnessToolCall): HarnessToolResult {
  return errorResult(call, 'unknown_tool', `Unknown tool: ${call.name}`, false);
}

function invalidInputResult(call: HarnessToolCall, message: string): HarnessToolResult {
  return errorResult(call, 'invalid_input', message, false);
}

function notFoundResult(call: HarnessToolCall, path: string): HarnessToolResult {
  return errorResult(call, 'not_found', `Workspace file not found: ${path}`, false);
}

function thrownErrorResult(call: HarnessToolCall, error: unknown): HarnessToolResult {
  return errorResult(call, 'tool_error', toErrorMessage(error), true);
}

function readRequiredString(
  input: Record<string, unknown>,
  key: string,
): ValidationResult<string> {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length < 1) {
    return { ok: false, message: `input.${key} must be a non-empty string` };
  }
  return { ok: true, value };
}

function readOptionalInteger(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): ValidationResult<number> {
  const value = input[key];
  if (value === undefined) {
    return { ok: true, value: fallback };
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return {
      ok: false,
      message: `input.${key} must be an integer between ${min} and ${max}`,
    };
  }
  return { ok: true, value };
}

function validateSearchInput(
  input: unknown,
  defaultSearchLimit: number,
): ValidationResult<{
  query: string;
  provider?: WorkspaceProvider;
  limit: number;
}> {
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }

  const query = readRequiredString(input, 'query');
  if (!query.ok) {
    return query;
  }

  if (input.provider !== undefined && !isWorkspaceProvider(input.provider)) {
    return {
      ok: false,
      message: 'input.provider must be one of: github, slack, notion, linear',
    };
  }

  const limit = readOptionalInteger(
    input,
    'limit',
    defaultSearchLimit,
    1,
    MAX_SEARCH_LIMIT,
  );
  if (!limit.ok) {
    return limit;
  }

  return {
    ok: true,
    value: {
      query: query.value,
      ...(input.provider ? { provider: input.provider } : {}),
      limit: limit.value,
    },
  };
}

function validateListInput(
  input: unknown,
): ValidationResult<{
  path: string;
  depth: number;
  limit: number;
}> {
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }

  const path = readRequiredString(input, 'path');
  if (!path.ok) {
    return path;
  }

  const depth = readOptionalInteger(input, 'depth', 1, 1, MAX_SCHEMA_LIST_DEPTH);
  if (!depth.ok) {
    return depth;
  }

  const limit = readOptionalInteger(input, 'limit', DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  if (!limit.ok) {
    return limit;
  }

  return {
    ok: true,
    value: {
      path: path.value,
      depth: depth.value,
      limit: limit.value,
    },
  };
}

function validateReadInput(input: unknown): ValidationResult<{ path: string }> {
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }

  const path = readRequiredString(input, 'path');
  if (!path.ok) {
    return path;
  }

  return { ok: true, value: { path: path.value } };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readScore(result: VfsSearchResult): number | undefined {
  const rawScore = result.properties?.score;
  if (rawScore === undefined) {
    return undefined;
  }

  const score = Number(rawScore);
  return Number.isFinite(score) ? score : undefined;
}

function mapSearchResult(result: VfsSearchResult): WorkspaceSearchOutput {
  const score = readScore(result);
  const preview = result.snippet ?? result.title;
  return {
    path: result.path,
    provider: result.provider ?? 'unknown',
    ...(score !== undefined ? { score } : {}),
    ...(preview ? { preview } : {}),
  };
}

function listOutputEntry(entry: VfsEntry): Record<string, unknown> {
  return {
    path: entry.path,
    type: entry.type,
    ...(entry.provider ? { provider: entry.provider } : {}),
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.revision ? { revision: entry.revision } : {}),
    ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    ...(entry.size !== undefined ? { size: entry.size } : {}),
  };
}

function knownToolName(name: string): boolean {
  return WORKSPACE_TOOLS.some((tool) => tool.name === name);
}

export function createWorkspaceToolRegistry(
  options: WorkspaceToolRegistryOptions,
): HarnessToolRegistry {
  const defaultSearchLimit = normalizeOption(
    options.defaultSearchLimit,
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT,
  );
  const maxListDepth = normalizeOption(
    options.maxListDepth,
    DEFAULT_MAX_LIST_DEPTH,
    MAX_SCHEMA_LIST_DEPTH,
  );

  return {
    async listAvailable(input) {
      if (!options.provider) {
        return [];
      }

      if (!input.allowedToolNames || input.allowedToolNames.length === 0) {
        return [...WORKSPACE_TOOLS];
      }

      const allowedToolNames = new Set(input.allowedToolNames);
      return WORKSPACE_TOOLS.filter((tool) => allowedToolNames.has(tool.name));
    },

    async execute(call) {
      if (!knownToolName(call.name)) {
        return unknownToolResult(call);
      }

      const provider = options.provider;
      if (!provider) {
        return workspaceUnavailableResult(call);
      }

      try {
        if (call.name === WORKSPACE_SEARCH_TOOL_NAME) {
          const validation = validateSearchInput(call.input, defaultSearchLimit);
          if (!validation.ok) {
            return invalidInputResult(call, validation.message);
          }

          const results = await provider.search(validation.value.query, {
            ...(validation.value.provider ? { provider: validation.value.provider } : {}),
            limit: validation.value.limit,
          });
          return successResult(
            call,
            stringifyArrayOutput(results.map((result) => mapSearchResult(result))),
          );
        }

        if (call.name === WORKSPACE_LIST_TOOL_NAME) {
          const validation = validateListInput(call.input);
          if (!validation.ok) {
            return invalidInputResult(call, validation.message);
          }

          const entries = await provider.list(validation.value.path, {
            depth: Math.min(validation.value.depth, maxListDepth),
            limit: validation.value.limit,
          });
          return successResult(
            call,
            stringifyArrayOutput(entries.map((entry) => listOutputEntry(entry))),
          );
        }

        const validation = validateReadInput(call.input);
        if (!validation.ok) {
          return invalidInputResult(call, validation.message);
        }

        const result = await provider.read(validation.value.path);
        if (result === null) {
          return notFoundResult(call, validation.value.path);
        }

        if (call.name === WORKSPACE_READ_JSON_TOOL_NAME) {
          const parsed = parseJson(result.content);
          if (parsed === undefined) {
            return errorResult(
              call,
              'invalid_json',
              `Workspace file is not valid JSON: ${validation.value.path}`,
              false,
            );
          }
          const output: WorkspaceReadJsonOutput = {
            path: validation.value.path,
            json: parsed,
          };
          return successResult(call, stringifyObjectOutput(output));
        }

        return successResult(call, result.content);
      } catch (error) {
        return thrownErrorResult(call, error);
      }
    },
  };
}
