import { z } from 'zod';

import type { HarnessTurnContext } from './subagent-registry.js';
import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolRegistry,
  HarnessToolResult,
} from './types.js';

/**
 * Scratchpad filesystem — in-memory, per-turn virtual fs the model
 * uses as a working surface (drafts, intermediate JSON, etc.). NOT
 * persisted to memory or the workspace VFS.
 *
 * Ported from langchain-ai/deepagents (MIT) — see
 * `libs/deepagents/deepagents/middleware/filesystem.py:234-287`
 * (FilesystemState, LsSchema, ReadFileSchema, WriteFileSchema,
 * EditFileSchema, GlobSchema, GrepSchema) and
 * `libs/deepagents/deepagents/middleware/filesystem.py:642-1275`
 * (FilesystemMiddleware).
 * Reimplemented from scratch in TS in the @agent-assistant/harness
 * idiom. Sourcing constraints documented in the porting workflow's
 * README.
 *
 * Tool names use a `scratch_*` prefix to avoid colliding with
 * existing `workspace_*` tools that read the persistent VFS.
 *
 * HarnessTurnContext is structural (`subagent-registry.ts:65-70`) and
 * HarnessToolExecutionContext currently has no declared scratch field
 * (`types.ts:236-245`), so this module stores state under
 * `ctx.scratch[SCRATCHPAD_SCRATCH_KEY]` when a scratch record is already
 * present and otherwise falls back to a per-context WeakMap.
 *
 * v1 intentionally omits glob / grep helpers because the persistent VFS
 * already exposes `workspace_search`; add scratch-local search later if a
 * concrete in-memory use case appears.
 */

export interface HarnessScratchFile {
  path: string;
  content: string;
}

export interface HarnessScratchpadState {
  files: Map<string, string>;
}

export interface CreateScratchpadToolRegistryOptions {
  getState: (ctx: HarnessTurnContext) => HarnessScratchpadState;
  /** Per-file byte cap. Default 64 KiB. */
  maxFileBytes?: number;
  /** Total scratchpad byte cap across all files. Default 256 KiB. */
  maxTotalBytes?: number;
}

export const SCRATCHPAD_DEFAULT_MAX_FILE_BYTES = 64 * 1024;
export const SCRATCHPAD_DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
export const SCRATCHPAD_SCRATCH_KEY = 'agent-assistant:scratchpad:v1';

const SCRATCH_LIST_TOOL_NAME = 'scratch_list';
const SCRATCH_READ_TOOL_NAME = 'scratch_read';
const SCRATCH_WRITE_TOOL_NAME = 'scratch_write';
const SCRATCH_EDIT_TOOL_NAME = 'scratch_edit';

const FALLBACK_SCRATCHPAD_STATE = new WeakMap<HarnessTurnContext, HarnessScratchpadState>();

const SCRATCH_LIST_INPUT_SCHEMA = z.object({
  prefix: z.string().optional(),
});

const SCRATCH_READ_INPUT_SCHEMA = z.object({
  path: z.string().min(1),
});

const SCRATCH_WRITE_INPUT_SCHEMA = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const SCRATCH_EDIT_INPUT_SCHEMA = z.object({
  path: z.string().min(1),
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional().default(false),
});

const SCRATCH_LIST_TOOL_DESCRIPTION =
  'List file paths currently stored in the in-memory scratchpad for this turn. Use to inspect drafts and intermediates before reading or editing them.';
const SCRATCH_READ_TOOL_DESCRIPTION =
  'Read one scratchpad file by path from the in-memory per-turn virtual filesystem.';
const SCRATCH_WRITE_TOOL_DESCRIPTION =
  'Create or overwrite one scratchpad file in the in-memory per-turn virtual filesystem.';
const SCRATCH_EDIT_TOOL_DESCRIPTION =
  'Edit one scratchpad file by exact string replacement. When replace_all is false, old_string must occur exactly once.';

type ScratchListResult = { ok: true; paths: string[] };
type ScratchReadResult = { ok: true; content: string } | { ok: false; error: string };
type ScratchWriteResult = { ok: true; path: string; bytes: number } | { ok: false; error: string };
type ScratchEditResult =
  | { ok: true; path: string; replacements: number; bytes: number }
  | { ok: false; error: string };

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

function normalizeByteCap(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

function createEmptyScratchpadState(): HarnessScratchpadState {
  return {
    files: new Map<string, string>(),
  };
}

function isScratchpadState(value: unknown): value is HarnessScratchpadState {
  if (!isRecord(value) || !(value.files instanceof Map)) {
    return false;
  }

  for (const [path, content] of value.files.entries()) {
    if (typeof path !== 'string' || typeof content !== 'string') {
      return false;
    }
  }

  return true;
}

function buildToolDefinitions(): readonly HarnessToolDefinition[] {
  return [
    {
      name: SCRATCH_LIST_TOOL_NAME,
      description: SCRATCH_LIST_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          prefix: { type: 'string' },
        },
      },
    },
    {
      name: SCRATCH_READ_TOOL_NAME,
      description: SCRATCH_READ_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      name: SCRATCH_WRITE_TOOL_NAME,
      description: SCRATCH_WRITE_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', minLength: 1 },
          content: { type: 'string' },
        },
      },
    },
    {
      name: SCRATCH_EDIT_TOOL_NAME,
      description: SCRATCH_EDIT_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        required: ['path', 'old_string', 'new_string'],
        properties: {
          path: { type: 'string', minLength: 1 },
          old_string: { type: 'string', minLength: 1 },
          new_string: { type: 'string' },
          replace_all: {
            type: 'boolean',
            description:
              'If true, replace every occurrence of old_string. If false, old_string must occur exactly once.',
          },
        },
      },
    },
  ] as const;
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
  result: ScratchListResult | ScratchReadResult | ScratchWriteResult | ScratchEditResult,
): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output: formatJson(result),
    structuredOutput: result as Record<string, unknown>,
  };
}

function totalScratchpadBytes(files: ReadonlyMap<string, string>): number {
  let total = 0;
  for (const content of files.values()) {
    total += byteLength(content);
  }
  return total;
}

function totalBytesAfterWrite(
  files: ReadonlyMap<string, string>,
  path: string,
  nextContent: string,
): number {
  const currentContent = files.get(path);
  return (
    totalScratchpadBytes(files) -
    (currentContent === undefined ? 0 : byteLength(currentContent)) +
    byteLength(nextContent)
  );
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let startIndex = 0;

  while (true) {
    const index = content.indexOf(needle, startIndex);
    if (index === -1) {
      return count;
    }

    count += 1;
    startIndex = index + needle.length;
  }
}

function replaceOnce(content: string, oldString: string, newString: string): string {
  const index = content.indexOf(oldString);
  if (index === -1) {
    return content;
  }

  return content.slice(0, index) + newString + content.slice(index + oldString.length);
}

function replaceAllOccurrences(content: string, oldString: string, newString: string): string {
  return content.split(oldString).join(newString);
}

function fileTooLargeResult(bytes: number, maxFileBytes: number): { ok: false; error: string } {
  return {
    ok: false,
    error: `File too large: ${bytes} bytes; max ${maxFileBytes}.`,
  };
}

function scratchpadFullResult(totalBytes: number, maxTotalBytes: number): { ok: false; error: string } {
  return {
    ok: false,
    error: `Scratchpad full: ${totalBytes} bytes would exceed max ${maxTotalBytes}.`,
  };
}

export function getOrCreateScratchpadState(
  ctx: HarnessTurnContext,
): HarnessScratchpadState {
  const scratchValue = ctx.scratch;
  if (isRecord(scratchValue)) {
    const existing = scratchValue[SCRATCHPAD_SCRATCH_KEY];
    if (isScratchpadState(existing)) {
      return existing;
    }

    const created = createEmptyScratchpadState();
    scratchValue[SCRATCHPAD_SCRATCH_KEY] = created;
    return created;
  }

  const existing = FALLBACK_SCRATCHPAD_STATE.get(ctx);
  if (existing) {
    return existing;
  }

  const created = createEmptyScratchpadState();
  FALLBACK_SCRATCHPAD_STATE.set(ctx, created);
  return created;
}

export function createScratchpadToolRegistry(
  options: CreateScratchpadToolRegistryOptions,
): HarnessToolRegistry {
  const maxFileBytes = normalizeByteCap(options.maxFileBytes, SCRATCHPAD_DEFAULT_MAX_FILE_BYTES);
  const maxTotalBytes = normalizeByteCap(
    options.maxTotalBytes,
    SCRATCHPAD_DEFAULT_MAX_TOTAL_BYTES,
  );
  const toolDefinitions = buildToolDefinitions();
  const knownToolNames = new Set(toolDefinitions.map((tool) => tool.name));

  return {
    async listAvailable(input: HarnessToolAvailabilityInput) {
      if (!input.allowedToolNames || input.allowedToolNames.length === 0) {
        return [...toolDefinitions];
      }

      const allowed = new Set(input.allowedToolNames);
      return toolDefinitions.filter((tool) => allowed.has(tool.name));
    },

    async execute(call, context) {
      if (!knownToolNames.has(call.name)) {
        return unknownToolResult(call);
      }

      const state = options.getState(context as HarnessTurnContext);

      if (call.name === SCRATCH_LIST_TOOL_NAME) {
        const validation = SCRATCH_LIST_INPUT_SCHEMA.safeParse(call.input);
        if (!validation.success) {
          return invalidInputResult(
            call,
            validation.error.issues[0]?.message ?? 'Invalid scratch_list input',
          );
        }

        const prefix = validation.data.prefix;
        const paths = [...state.files.keys()]
          .filter((path) => (prefix === undefined ? true : path.startsWith(prefix)))
          .sort((left, right) => left.localeCompare(right));

        return successResult(call, {
          ok: true,
          paths,
        });
      }

      if (call.name === SCRATCH_READ_TOOL_NAME) {
        const validation = SCRATCH_READ_INPUT_SCHEMA.safeParse(call.input);
        if (!validation.success) {
          return invalidInputResult(
            call,
            validation.error.issues[0]?.message ?? 'Invalid scratch_read input',
          );
        }

        const content = state.files.get(validation.data.path);
        if (content === undefined) {
          return successResult(call, {
            ok: false,
            error: `Not found: ${validation.data.path}`,
          });
        }

        return successResult(call, {
          ok: true,
          content,
        });
      }

      if (call.name === SCRATCH_WRITE_TOOL_NAME) {
        const validation = SCRATCH_WRITE_INPUT_SCHEMA.safeParse(call.input);
        if (!validation.success) {
          return invalidInputResult(
            call,
            validation.error.issues[0]?.message ?? 'Invalid scratch_write input',
          );
        }

        const bytes = byteLength(validation.data.content);
        if (bytes > maxFileBytes) {
          return successResult(call, fileTooLargeResult(bytes, maxFileBytes));
        }

        const nextTotalBytes = totalBytesAfterWrite(
          state.files,
          validation.data.path,
          validation.data.content,
        );
        if (nextTotalBytes > maxTotalBytes) {
          return successResult(call, scratchpadFullResult(nextTotalBytes, maxTotalBytes));
        }

        state.files.set(validation.data.path, validation.data.content);
        return successResult(call, {
          ok: true,
          path: validation.data.path,
          bytes,
        });
      }

      const validation = SCRATCH_EDIT_INPUT_SCHEMA.safeParse(call.input);
      if (!validation.success) {
        return invalidInputResult(
          call,
          validation.error.issues[0]?.message ?? 'Invalid scratch_edit input',
        );
      }

      const currentContent = state.files.get(validation.data.path);
      if (currentContent === undefined) {
        return successResult(call, {
          ok: false,
          error: `Not found: ${validation.data.path}`,
        });
      }

      const replacements = countOccurrences(currentContent, validation.data.old_string);
      if (!validation.data.replace_all && replacements !== 1) {
        return successResult(call, {
          ok: false,
          error:
            `old_string must occur exactly once when replace_all=false (found ${replacements}).`,
        });
      }

      const nextContent = validation.data.replace_all
        ? replaceAllOccurrences(
            currentContent,
            validation.data.old_string,
            validation.data.new_string,
          )
        : replaceOnce(
            currentContent,
            validation.data.old_string,
            validation.data.new_string,
          );
      const bytes = byteLength(nextContent);
      if (bytes > maxFileBytes) {
        return successResult(call, fileTooLargeResult(bytes, maxFileBytes));
      }

      const nextTotalBytes = totalBytesAfterWrite(state.files, validation.data.path, nextContent);
      if (nextTotalBytes > maxTotalBytes) {
        return successResult(call, scratchpadFullResult(nextTotalBytes, maxTotalBytes));
      }

      state.files.set(validation.data.path, nextContent);
      return successResult(call, {
        ok: true,
        path: validation.data.path,
        replacements,
        bytes,
      });
    },
  };
}
