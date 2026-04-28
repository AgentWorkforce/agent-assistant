import {
  MemoryEntryNotFoundError,
  measureMemoryOp,
  renderTurnMemoryContext,
  retrieveTurnMemoryContext,
} from '@agent-assistant/memory';
import type {
  MemoryEntry,
  MemoryScope,
  MemoryStore,
  WriteMemoryInput,
} from '@agent-assistant/memory';
import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolExecutionContext,
  HarnessToolRegistry,
  HarnessToolResult,
} from '../types.js';

export interface MemoryToolRegistryOptions {
  store: MemoryStore | null;
  resolveScopeContext: (input: HarnessToolExecutionContext) => {
    workspaceId?: string;
    userId?: string;
    sessionId?: string;
  };
}

type MemoryToolScope = 'session' | 'user' | 'workspace';
type MemoryRecallScope = MemoryToolScope | 'any';

interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

interface ValidationFailure {
  ok: false;
  message: string;
}

type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

const MAX_CONTENT_CHARS = 2000;
const MAX_QUERY_CHARS = 500;
const MAX_ENTRY_ID_CHARS = 200;
const MAX_TAGS = 10;
const DEFAULT_RECALL_LIMIT = 5;
const MAX_RECALL_LIMIT = 20;
const MAX_EXPIRES_IN_DAYS = 365;

const MEMORY_SCOPES = ['session', 'user', 'workspace'] as const;
const MEMORY_RECALL_SCOPES = [...MEMORY_SCOPES, 'any'] as const;

export const MEMORY_REMEMBER_TOOL_NAME = 'memory_remember';
export const MEMORY_RECALL_TOOL_NAME = 'memory_recall';
export const MEMORY_FORGET_TOOL_NAME = 'memory_forget';
export const MEMORY_TOOL_NAMES = [
  MEMORY_REMEMBER_TOOL_NAME,
  MEMORY_RECALL_TOOL_NAME,
  MEMORY_FORGET_TOOL_NAME,
] as const;

const MEMORY_REMEMBER_TOOL: HarnessToolDefinition = {
  name: MEMORY_REMEMBER_TOOL_NAME,
  description:
    "Save a durable fact to memory. Use when the user shares a preference, project context, ownership info, deadline, or any fact you should recall in future turns. Pick the narrowest scope that's still useful: 'session' for thread-only context, 'user' for per-person facts, 'workspace' for org-wide context shared by everyone in this Slack workspace.",
  inputSchema: {
    type: 'object',
    required: ['content', 'scope'],
    properties: {
      content: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_CHARS },
      scope: { type: 'string', enum: MEMORY_SCOPES },
      tags: {
        type: 'array',
        maxItems: MAX_TAGS,
        items: { type: 'string' },
      },
      expiresInDays: { type: 'number', minimum: 1, maximum: MAX_EXPIRES_IN_DAYS },
    },
  },
};

const MEMORY_RECALL_TOOL: HarnessToolDefinition = {
  name: MEMORY_RECALL_TOOL_NAME,
  description:
    'Search memory for relevant facts. Use when the user asks about prior context, when you need to verify a preference before acting, or before answering questions where you suspect prior context exists. Returns up to limit entries ranked by recency and (when supported) semantic relevance.',
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: MAX_QUERY_CHARS },
      scope: { type: 'string', enum: MEMORY_RECALL_SCOPES },
      limit: { type: 'number', minimum: 1, maximum: MAX_RECALL_LIMIT },
    },
  },
};

const MEMORY_FORGET_TOOL: HarnessToolDefinition = {
  name: MEMORY_FORGET_TOOL_NAME,
  description:
    'Delete a specific memory entry by id. Use when the user explicitly asks you to forget something, or when you discover a stored fact is wrong / superseded. Pass the id from a memory_recall result.',
  inputSchema: {
    type: 'object',
    required: ['entryId'],
    properties: {
      entryId: { type: 'string', minLength: 1, maxLength: MAX_ENTRY_ID_CHARS },
    },
  },
};

const MEMORY_TOOLS = [
  MEMORY_REMEMBER_TOOL,
  MEMORY_RECALL_TOOL,
  MEMORY_FORGET_TOOL,
] satisfies HarnessToolDefinition[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMemoryToolScope(value: unknown): value is MemoryToolScope {
  return (
    typeof value === 'string' &&
    (MEMORY_SCOPES as readonly string[]).includes(value)
  );
}

function isMemoryRecallScope(value: unknown): value is MemoryRecallScope {
  return (
    typeof value === 'string' &&
    (MEMORY_RECALL_SCOPES as readonly string[]).includes(value)
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function successResult(
  call: HarnessToolCall,
  output: string,
  structuredOutput?: Record<string, unknown>,
): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output,
    ...(structuredOutput ? { structuredOutput } : {}),
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

function memoryUnavailableResult(call: HarnessToolCall): HarnessToolResult {
  return errorResult(
    call,
    'memory_unavailable',
    'Memory store not configured',
    false,
  );
}

function unknownToolResult(call: HarnessToolCall): HarnessToolResult {
  return errorResult(call, 'unknown_tool', `Unknown tool: ${call.name}`, false);
}

function invalidInputResult(call: HarnessToolCall, message: string): HarnessToolResult {
  return errorResult(call, 'invalid_input', message, false);
}

function thrownErrorResult(call: HarnessToolCall, error: unknown): HarnessToolResult {
  return errorResult(call, 'tool_error', toErrorMessage(error), true);
}

function notFoundResult(call: HarnessToolCall, message: string): HarnessToolResult {
  return errorResult(call, 'not_found', message, false);
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
  fallback: number | undefined,
  min: number,
  max: number,
): ValidationResult<number | undefined> {
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

function readOptionalTags(
  input: Record<string, unknown>,
  key: string,
): ValidationResult<string[] | undefined> {
  const value = input[key];
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value)) {
    return { ok: false, message: `input.${key} must be an array of strings` };
  }
  if (value.length > MAX_TAGS) {
    return { ok: false, message: `input.${key} must contain at most ${MAX_TAGS} items` };
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length < 1) {
      return { ok: false, message: `input.${key} must be an array of non-empty strings` };
    }
  }
  return { ok: true, value: [...value] };
}

function validateRememberInput(
  input: unknown,
): ValidationResult<{
  content: string;
  scope: MemoryToolScope;
  tags?: string[];
  expiresInDays?: number;
}> {
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }

  const content = readRequiredString(input, 'content');
  if (!content.ok) {
    return content;
  }
  if (content.value.length > MAX_CONTENT_CHARS) {
    return {
      ok: false,
      message: `input.content must be between 1 and ${MAX_CONTENT_CHARS} characters`,
    };
  }

  if (!isMemoryToolScope(input.scope)) {
    return {
      ok: false,
      message: 'input.scope must be one of: session, user, workspace',
    };
  }

  const tags = readOptionalTags(input, 'tags');
  if (!tags.ok) {
    return tags;
  }

  const expiresInDays = readOptionalInteger(
    input,
    'expiresInDays',
    undefined,
    1,
    MAX_EXPIRES_IN_DAYS,
  );
  if (!expiresInDays.ok) {
    return expiresInDays;
  }

  return {
    ok: true,
    value: {
      content: content.value,
      scope: input.scope,
      ...(tags.value ? { tags: tags.value } : {}),
      ...(expiresInDays.value !== undefined ? { expiresInDays: expiresInDays.value } : {}),
    },
  };
}

function validateRecallInput(
  input: unknown,
): ValidationResult<{
  query: string;
  scope?: MemoryRecallScope;
  limit: number;
}> {
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }

  const query = readRequiredString(input, 'query');
  if (!query.ok) {
    return query;
  }
  if (query.value.length > MAX_QUERY_CHARS) {
    return {
      ok: false,
      message: `input.query must be between 1 and ${MAX_QUERY_CHARS} characters`,
    };
  }

  if (input.scope !== undefined && !isMemoryRecallScope(input.scope)) {
    return {
      ok: false,
      message: 'input.scope must be one of: session, user, workspace, any',
    };
  }

  const limit = readOptionalInteger(
    input,
    'limit',
    DEFAULT_RECALL_LIMIT,
    1,
    MAX_RECALL_LIMIT,
  );
  if (!limit.ok || limit.value === undefined) {
    return limit.ok
      ? { ok: false, message: `input.limit must be an integer between 1 and ${MAX_RECALL_LIMIT}` }
      : limit;
  }

  return {
    ok: true,
    value: {
      query: query.value,
      ...(input.scope ? { scope: input.scope } : {}),
      limit: limit.value,
    },
  };
}

function validateForgetInput(input: unknown): ValidationResult<{ entryId: string }> {
  if (!isRecord(input)) {
    return { ok: false, message: 'input must be an object' };
  }

  const entryId = readRequiredString(input, 'entryId');
  if (!entryId.ok) {
    return entryId;
  }
  if (entryId.value.length > MAX_ENTRY_ID_CHARS) {
    return {
      ok: false,
      message: `input.entryId must be between 1 and ${MAX_ENTRY_ID_CHARS} characters`,
    };
  }

  return {
    ok: true,
    value: {
      entryId: entryId.value,
    },
  };
}

function scopeEventMeta(
  scope: MemoryScope,
): {
  scope: MemoryToolScope;
  sessionId?: string;
  userId?: string;
  workspaceId?: string;
} {
  switch (scope.kind) {
    case 'session':
      return { scope: 'session', sessionId: scope.sessionId };
    case 'user':
      return { scope: 'user', userId: scope.userId };
    case 'workspace':
      return { scope: 'workspace', workspaceId: scope.workspaceId };
    default:
      throw new Error(`Unsupported memory scope: ${(scope as MemoryScope).kind}`);
  }
}

function resolveScope(
  toolName: string,
  scope: MemoryToolScope,
  resolved: ReturnType<MemoryToolRegistryOptions['resolveScopeContext']>,
): ValidationResult<MemoryScope> {
  switch (scope) {
    case 'session':
      if (!resolved.sessionId) {
        return {
          ok: false,
          message: `${toolName} scope='session' requires session identity in execution context`,
        };
      }
      return { ok: true, value: { kind: 'session', sessionId: resolved.sessionId } };
    case 'user':
      if (!resolved.userId) {
        return {
          ok: false,
          message: `${toolName} scope='user' requires user identity in execution context`,
        };
      }
      return { ok: true, value: { kind: 'user', userId: resolved.userId } };
    case 'workspace':
      if (!resolved.workspaceId) {
        return {
          ok: false,
          message: `${toolName} scope='workspace' requires workspace identity in execution context`,
        };
      }
      return {
        ok: true,
        value: { kind: 'workspace', workspaceId: resolved.workspaceId },
      };
  }
}

function knownToolName(name: string): boolean {
  return MEMORY_TOOLS.some((tool) => tool.name === name);
}

function expiresAtFromDays(expiresInDays: number | undefined): string | undefined {
  if (expiresInDays === undefined) {
    return undefined;
  }

  return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
}

function renderScopedEntries(scope: MemoryToolScope, entries: MemoryEntry[]): string {
  return renderTurnMemoryContext({
    entries,
    byScope: {
      [scope]: entries,
    },
  });
}

export function createMemoryToolRegistry(
  options: MemoryToolRegistryOptions,
): HarnessToolRegistry {
  return {
    async listAvailable(input: HarnessToolAvailabilityInput) {
      if (!options.store) {
        return [];
      }

      if (!input.allowedToolNames || input.allowedToolNames.length === 0) {
        return [...MEMORY_TOOLS];
      }

      const allowedToolNames = new Set(input.allowedToolNames);
      return MEMORY_TOOLS.filter((tool) => allowedToolNames.has(tool.name));
    },

    async execute(call: HarnessToolCall, context: HarnessToolExecutionContext) {
      if (!knownToolName(call.name)) {
        return unknownToolResult(call);
      }

      const store = options.store;
      if (!store) {
        return memoryUnavailableResult(call);
      }

      const resolvedScopeContext = options.resolveScopeContext(context);

      try {
        if (call.name === MEMORY_REMEMBER_TOOL_NAME) {
          const validation = validateRememberInput(call.input);
          if (!validation.ok) {
            return invalidInputResult(call, validation.message);
          }

          const scope = resolveScope(call.name, validation.value.scope, resolvedScopeContext);
          if (!scope.ok) {
            return invalidInputResult(call, scope.message);
          }

          const expiresAt = expiresAtFromDays(validation.value.expiresInDays);
          const writeInput: WriteMemoryInput = {
            scope: scope.value,
            content: validation.value.content,
            ...(validation.value.tags ? { tags: validation.value.tags } : {}),
            ...(expiresAt ? { expiresAt } : {}),
          };

          const written = await measureMemoryOp(
            {
              op: 'save',
              ...scopeEventMeta(scope.value),
              contentChars: validation.value.content.length,
              entryCount: 1,
            },
            async () => store.write(writeInput),
          );

          return successResult(
            call,
            JSON.stringify({
              id: written.id,
              scope: written.scope,
              expiresAt: written.expiresAt ?? null,
            }),
            { entry: written },
          );
        }

        if (call.name === MEMORY_RECALL_TOOL_NAME) {
          const validation = validateRecallInput(call.input);
          if (!validation.ok) {
            return invalidInputResult(call, validation.message);
          }

          if (validation.value.scope === undefined || validation.value.scope === 'any') {
            const contextResult = await measureMemoryOp(
              {
                op: 'load',
                ...(resolvedScopeContext.sessionId
                  ? { sessionId: resolvedScopeContext.sessionId }
                  : {}),
                ...(resolvedScopeContext.userId ? { userId: resolvedScopeContext.userId } : {}),
                ...(resolvedScopeContext.workspaceId
                  ? { workspaceId: resolvedScopeContext.workspaceId }
                  : {}),
              },
              async () =>
                retrieveTurnMemoryContext({
                  store,
                  sessionId: resolvedScopeContext.sessionId,
                  userId: resolvedScopeContext.userId,
                  workspaceId: resolvedScopeContext.workspaceId,
                  query: validation.value.query,
                  limit: validation.value.limit,
                  perScopeLimit: validation.value.limit,
                  order: 'newest',
                }),
            );

            return successResult(
              call,
              renderTurnMemoryContext(contextResult),
              { entries: contextResult.entries },
            );
          }

          const scope = resolveScope(call.name, validation.value.scope, resolvedScopeContext);
          if (!scope.ok) {
            return invalidInputResult(call, scope.message);
          }

          const entries = await measureMemoryOp(
            {
              op: 'load',
              ...scopeEventMeta(scope.value),
            },
            async () =>
              store.retrieve({
                scope: scope.value,
                query: validation.value.query,
                limit: validation.value.limit,
                order: 'newest',
              }),
          );

          return successResult(
            call,
            renderScopedEntries(validation.value.scope, entries),
            { entries },
          );
        }

        const validation = validateForgetInput(call.input);
        if (!validation.ok) {
          return invalidInputResult(call, validation.message);
        }

        await measureMemoryOp(
          {
            op: 'forget',
            entryCount: 1,
          },
          async () => store.delete(validation.value.entryId),
        );

        return successResult(call, 'forgotten');
      } catch (error) {
        if (call.name === MEMORY_FORGET_TOOL_NAME && error instanceof MemoryEntryNotFoundError) {
          return notFoundResult(call, error.message);
        }
        return thrownErrorResult(call, error);
      }
    },
  };
}
