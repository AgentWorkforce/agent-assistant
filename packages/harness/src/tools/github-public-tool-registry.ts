import type {
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolRegistry,
  HarnessToolResult,
} from '../types.js';
import {
  GitHubPublicFetchError,
  GitHubPublicFetcher,
  type GitHubPublicFetcherOptions,
  type GitHubPublicReadFileOptions,
} from './github-public-fetcher.js';

export const PUBLIC_REPO_METADATA_TOOL_NAME = 'public_repo_metadata';
export const PUBLIC_REPO_LIST_TREE_TOOL_NAME = 'public_repo_list_tree';
export const PUBLIC_REPO_READ_FILE_TOOL_NAME = 'public_repo_read_file';
export const PUBLIC_REPO_RECENT_COMMITS_TOOL_NAME = 'public_repo_recent_commits';
export const PUBLIC_REPO_SEARCH_CODE_TOOL_NAME = 'public_repo_search_code';

const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
} satisfies Record<string, unknown>;

const PUBLIC_REPO_LIST_TREE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    ref: { type: 'string' },
  },
} satisfies Record<string, unknown>;

const PUBLIC_REPO_READ_FILE_INPUT_SCHEMA = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string', minLength: 1 },
    ref: { type: 'string' },
    lineRange: {
      type: 'object',
      required: ['start', 'end'],
      properties: {
        start: { type: 'number' },
        end: { type: 'number' },
      },
    },
  },
} satisfies Record<string, unknown>;

const PUBLIC_REPO_RECENT_COMMITS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    limit: { type: 'number' },
  },
} satisfies Record<string, unknown>;

const PUBLIC_REPO_SEARCH_CODE_INPUT_SCHEMA = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    path: { type: 'string' },
  },
} satisfies Record<string, unknown>;

const PUBLIC_REPO_METADATA_TOOL: HarnessToolDefinition = {
  name: PUBLIC_REPO_METADATA_TOOL_NAME,
  description:
    'Fetch public GitHub repository metadata, README excerpt, and package.json for the bound repo.',
  inputSchema: EMPTY_INPUT_SCHEMA,
};

const PUBLIC_REPO_LIST_TREE_TOOL: HarnessToolDefinition = {
  name: PUBLIC_REPO_LIST_TREE_TOOL_NAME,
  description:
    'List files and directories from the bound public GitHub repo. Pass path to drill into a subdirectory and ref to target a branch, tag, or SHA.',
  inputSchema: PUBLIC_REPO_LIST_TREE_INPUT_SCHEMA,
};

const PUBLIC_REPO_READ_FILE_TOOL: HarnessToolDefinition = {
  name: PUBLIC_REPO_READ_FILE_TOOL_NAME,
  description:
    'Read a UTF-8 file from the bound public GitHub repo. Use lineRange to read focused 1-indexed inclusive lines.',
  inputSchema: PUBLIC_REPO_READ_FILE_INPUT_SCHEMA,
};

const PUBLIC_REPO_RECENT_COMMITS_TOOL: HarnessToolDefinition = {
  name: PUBLIC_REPO_RECENT_COMMITS_TOOL_NAME,
  description:
    'Fetch recent commits from the bound public GitHub repo, optionally scoped to a path.',
  inputSchema: PUBLIC_REPO_RECENT_COMMITS_INPUT_SCHEMA,
};

const PUBLIC_REPO_SEARCH_CODE_TOOL: HarnessToolDefinition = {
  name: PUBLIC_REPO_SEARCH_CODE_TOOL_NAME,
  description:
    'Search code within the bound public GitHub repo. Available only when the public GitHub fetcher has an auth token.',
  inputSchema: PUBLIC_REPO_SEARCH_CODE_INPUT_SCHEMA,
};

export interface PublicGitHubToolRegistryOptions {
  fetcher?: GitHubPublicFetcher;
  fetcherOptions?: GitHubPublicFetcherOptions;
  owner: string;
  repo: string;
}

type ValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      message: string;
    };

type PublicRepoListTreeInput = {
  path?: string;
  ref?: string;
};

type PublicRepoReadFileInput = {
  path: string;
  ref?: string;
  lineRange?: GitHubPublicReadFileOptions['lineRange'];
};

type PublicRepoRecentCommitsInput = {
  path?: string;
  limit?: number;
};

type PublicRepoSearchCodeInput = {
  query: string;
  path?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(
  input: Record<string, unknown>,
  key: string,
): ValidationResult<string> {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, message: `input.${key} must be a non-empty string` };
  }
  return { ok: true, value: value.trim() };
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string,
): ValidationResult<string | undefined> {
  const value = input[key];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return { ok: false, message: `input.${key} must be a string when provided` };
  }
  return { ok: true, value: value.trim() || undefined };
}

function readOptionalNumber(
  input: Record<string, unknown>,
  key: string,
): ValidationResult<number | undefined> {
  const value = input[key];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: `input.${key} must be a finite number when provided` };
  }
  return { ok: true, value };
}

function validateOptionalEmptyObject(input: unknown): ValidationResult<Record<string, never>> {
  if (input === undefined) {
    return { ok: true, value: {} };
  }
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }
  return { ok: true, value: {} };
}

function validateListTreeInput(input: unknown): ValidationResult<PublicRepoListTreeInput> {
  if (!isRecord(input ?? {})) {
    return { ok: false, message: 'input must be an object' };
  }

  const record = (input ?? {}) as Record<string, unknown>;
  const path = readOptionalString(record, 'path');
  if (!path.ok) {
    return path;
  }
  const ref = readOptionalString(record, 'ref');
  if (!ref.ok) {
    return ref;
  }

  return {
    ok: true,
    value: {
      ...(path.value !== undefined ? { path: path.value } : {}),
      ...(ref.value !== undefined ? { ref: ref.value } : {}),
    },
  };
}

function validateReadFileInput(input: unknown): ValidationResult<PublicRepoReadFileInput> {
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }

  const path = readRequiredString(input, 'path');
  if (!path.ok) {
    return path;
  }
  const ref = readOptionalString(input, 'ref');
  if (!ref.ok) {
    return ref;
  }

  let lineRange: GitHubPublicReadFileOptions['lineRange'];
  if (input.lineRange !== undefined) {
    if (!isRecord(input.lineRange)) {
      return { ok: false, message: 'input.lineRange must be an object when provided' };
    }
    const start = input.lineRange.start;
    const end = input.lineRange.end;
    if (typeof start !== 'number' || !Number.isInteger(start) || start < 1) {
      return { ok: false, message: 'input.lineRange.start must be an integer >= 1' };
    }
    if (typeof end !== 'number' || !Number.isInteger(end) || end < start) {
      return {
        ok: false,
        message: 'input.lineRange.end must be an integer >= input.lineRange.start',
      };
    }
    lineRange = { start, end };
  }

  return {
    ok: true,
    value: {
      path: path.value,
      ...(ref.value !== undefined ? { ref: ref.value } : {}),
      ...(lineRange ? { lineRange } : {}),
    },
  };
}

function validateRecentCommitsInput(input: unknown): ValidationResult<PublicRepoRecentCommitsInput> {
  if (!isRecord(input ?? {})) {
    return { ok: false, message: 'input must be an object' };
  }

  const record = (input ?? {}) as Record<string, unknown>;
  const path = readOptionalString(record, 'path');
  if (!path.ok) {
    return path;
  }
  const limit = readOptionalNumber(record, 'limit');
  if (!limit.ok) {
    return limit;
  }

  return {
    ok: true,
    value: {
      ...(path.value !== undefined ? { path: path.value } : {}),
      ...(limit.value !== undefined ? { limit: limit.value } : {}),
    },
  };
}

function validateSearchCodeInput(input: unknown): ValidationResult<PublicRepoSearchCodeInput> {
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }

  const query = readRequiredString(input, 'query');
  if (!query.ok) {
    return query;
  }
  const path = readOptionalString(input, 'path');
  if (!path.ok) {
    return path;
  }

  return {
    ok: true,
    value: {
      query: query.value,
      ...(path.value !== undefined ? { path: path.value } : {}),
    },
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

function unknownToolResult(call: HarnessToolCall): HarnessToolResult {
  return errorResult(call, 'unknown_tool', `Unknown tool: ${call.name}`, false);
}

function invalidInputResult(call: HarnessToolCall, message: string): HarnessToolResult {
  return errorResult(call, 'invalid_input', message, false);
}

function jsonSuccessResult(call: HarnessToolCall, structuredOutput: unknown): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output: JSON.stringify(structuredOutput, null, 2),
    structuredOutput: { result: structuredOutput },
  };
}

function publicGithubFetchErrorResult(
  call: HarnessToolCall,
  error: unknown,
): HarnessToolResult {
  if (error instanceof GitHubPublicFetchError) {
    return errorResult(
      call,
      error.code,
      error.message,
      error.code === 'rate_limited',
    );
  }

  return errorResult(
    call,
    'github_public_fetch_failed',
    error instanceof Error ? error.message : String(error),
    false,
  );
}

export function createPublicGitHubToolRegistry(
  options: PublicGitHubToolRegistryOptions,
): HarnessToolRegistry {
  const fetcher = options.fetcher ?? new GitHubPublicFetcher(options.fetcherOptions);
  const owner = options.owner.trim();
  const repo = options.repo.trim();

  return {
    async listAvailable() {
      return [
        PUBLIC_REPO_METADATA_TOOL,
        PUBLIC_REPO_LIST_TREE_TOOL,
        PUBLIC_REPO_READ_FILE_TOOL,
        PUBLIC_REPO_RECENT_COMMITS_TOOL,
        ...(fetcher.canSearchCode() ? [PUBLIC_REPO_SEARCH_CODE_TOOL] : []),
      ];
    },

    async execute(call) {
      try {
        switch (call.name) {
          case PUBLIC_REPO_METADATA_TOOL_NAME: {
            const validation = validateOptionalEmptyObject(call.input);
            if (!validation.ok) {
              return invalidInputResult(call, validation.message);
            }
            return jsonSuccessResult(call, await fetcher.fetchMetadata(owner, repo));
          }
          case PUBLIC_REPO_LIST_TREE_TOOL_NAME: {
            const validation = validateListTreeInput(call.input);
            if (!validation.ok) {
              return invalidInputResult(call, validation.message);
            }
            return jsonSuccessResult(call, await fetcher.listTree(owner, repo, validation.value));
          }
          case PUBLIC_REPO_READ_FILE_TOOL_NAME: {
            const validation = validateReadFileInput(call.input);
            if (!validation.ok) {
              return invalidInputResult(call, validation.message);
            }
            return jsonSuccessResult(
              call,
              await fetcher.readFile(owner, repo, validation.value.path, validation.value),
            );
          }
          case PUBLIC_REPO_RECENT_COMMITS_TOOL_NAME: {
            const validation = validateRecentCommitsInput(call.input);
            if (!validation.ok) {
              return invalidInputResult(call, validation.message);
            }
            return jsonSuccessResult(call, await fetcher.recentCommits(owner, repo, validation.value));
          }
          case PUBLIC_REPO_SEARCH_CODE_TOOL_NAME: {
            if (!fetcher.canSearchCode()) {
              return unknownToolResult(call);
            }
            const validation = validateSearchCodeInput(call.input);
            if (!validation.ok) {
              return invalidInputResult(call, validation.message);
            }
            return jsonSuccessResult(
              call,
              await fetcher.searchCode(owner, repo, validation.value.query, validation.value),
            );
          }
          default:
            return unknownToolResult(call);
        }
      } catch (error) {
        return publicGithubFetchErrorResult(call, error);
      }
    },
  };
}

export function publicRepoAlternativesFor(call: HarnessToolCall): string[] {
  switch (call.name) {
    case PUBLIC_REPO_LIST_TREE_TOOL_NAME:
      return [
        'STOP. You already listed this public repo path with these arguments. To go deeper, call public_repo_list_tree on a subdirectory or public_repo_read_file on a specific entry.',
      ];
    case PUBLIC_REPO_READ_FILE_TOOL_NAME:
      return [
        'STOP. You already read this public repo file with these arguments. The content is in the prior result. Use lineRange to focus, or read a different file.',
      ];
    case PUBLIC_REPO_METADATA_TOOL_NAME:
      return [
        'STOP. The public repo metadata was already fetched with these arguments. Use the prior result instead of re-fetching it.',
      ];
    case PUBLIC_REPO_RECENT_COMMITS_TOOL_NAME:
      return [
        'STOP. You already fetched recent commits with these arguments. Use the prior result, change the path, or ask for clarification.',
      ];
    case PUBLIC_REPO_SEARCH_CODE_TOOL_NAME:
      return [
        'STOP. You already searched public repo code with these arguments. Use the prior matches, narrow the query, or read a matched file.',
      ];
    default:
      return [];
  }
}
