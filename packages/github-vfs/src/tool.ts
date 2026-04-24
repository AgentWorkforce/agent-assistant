import type { VfsProvider } from '@agent-assistant/vfs';
import type {
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolRegistry,
  HarnessToolResult,
} from '@agent-assistant/harness';
import { listOpenPullRequestsFromVfs } from './queries.js';

export const GITHUB_LIST_OPEN_PRS_TOOL_NAME = 'workspace_github_list_open_prs';

export interface GithubVfsToolRegistryOptions {
  provider: VfsProvider;
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

const GITHUB_LIST_OPEN_PRS_TOOL: HarnessToolDefinition = {
  name: GITHUB_LIST_OPEN_PRS_TOOL_NAME,
  description:
    'List open GitHub pull requests from synced RelayFile VFS metadata for an explicit owner/repo. Empty pulls means no matching open PR metadata was found; do not invent results.',
  inputSchema: {
    type: 'object',
    required: ['owner', 'repo'],
    properties: {
      owner: { type: 'string', minLength: 1 },
      repo: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function readRequiredString(
  input: Record<string, unknown>,
  key: string,
): ValidationResult<string> {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length < 1) {
    return { ok: false, message: `input.${key} must be a non-empty string` };
  }
  return { ok: true, value: value.trim() };
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

function validateListOpenPrsInput(input: unknown): ValidationResult<{
  owner: string;
  repo: string;
  limit: number;
}> {
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }

  const owner = readRequiredString(input, 'owner');
  if (!owner.ok) return owner;

  const repo = readRequiredString(input, 'repo');
  if (!repo.ok) return repo;

  const limit = readOptionalInteger(input, 'limit', 50, 1, 100);
  if (!limit.ok) return limit;

  return { ok: true, value: { owner: owner.value, repo: repo.value, limit: limit.value } };
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
    error: { code, message, retryable },
  };
}

function knownToolName(name: string): boolean {
  return name === GITHUB_LIST_OPEN_PRS_TOOL_NAME;
}

export function createGithubVfsToolRegistry(
  options: GithubVfsToolRegistryOptions,
): HarnessToolRegistry {
  return {
    async listAvailable(input) {
      if (!input.allowedToolNames || input.allowedToolNames.length === 0) {
        return [GITHUB_LIST_OPEN_PRS_TOOL];
      }
      return input.allowedToolNames.includes(GITHUB_LIST_OPEN_PRS_TOOL_NAME)
        ? [GITHUB_LIST_OPEN_PRS_TOOL]
        : [];
    },

    async execute(call) {
      if (!knownToolName(call.name)) {
        return errorResult(call, 'unknown_tool', `Unknown tool: ${call.name}`, false);
      }

      const validation = validateListOpenPrsInput(call.input);
      if (!validation.ok) {
        return errorResult(call, 'invalid_input', validation.message, false);
      }

      try {
        const pulls = await listOpenPullRequestsFromVfs(
          options.provider,
          { owner: validation.value.owner, repo: validation.value.repo },
          { limit: validation.value.limit },
        );
        return successResult(
          call,
          JSON.stringify(
            {
              repo: `${validation.value.owner}/${validation.value.repo}`,
              pulls,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return errorResult(call, 'tool_error', toErrorMessage(error), true);
      }
    },
  };
}
