import type {
  HarnessRuntimePolicy,
  HarnessRuntimePolicyConfig,
  HarnessRuntimePolicyDecision,
  HarnessRuntimePolicyEvent,
  HarnessRuntimePolicyGuardDecision,
  HarnessRuntimePolicySanitizeResult,
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolResult,
} from '../types.js';
export type {
  HarnessRuntimePolicy,
  HarnessRuntimePolicyConfig,
  HarnessRuntimePolicyDecision,
  HarnessRuntimePolicyEvent,
  HarnessRuntimePolicyEventKind,
  HarnessRuntimePolicyGuard,
  HarnessRuntimePolicyGuardDecision,
  HarnessRuntimePolicyGuardInput,
  HarnessRuntimePolicySanitizeResult,
} from '../types.js';

interface CachedToolResult {
  result: HarnessToolResult;
}

interface TurnPolicyState {
  todoWrites: number;
  cache: Map<string, CachedToolResult>;
  pendingCandidates: string[];
  blockedCalls: number;
  cacheHits: number;
  todoRewriteBlocks: number;
  sanitizerHits: number;
}

const CODE_FENCE_RE = /```[^\n]*\n[\s\S]*?```/gu;
const PSEUDO_TOOL_TAG_RE = /<\/?(function_calls|invoke|parameter)\b[^>]*>/giu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeStable(item));
  }

  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeStable(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeStable(value));
}

function normalizePositiveInteger(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value < 0) {
    return 0;
  }
  return value;
}

function toolNamesSet(names: readonly string[] | undefined): Set<string> {
  return new Set((names ?? []).filter((name) => typeof name === 'string' && name.length > 0));
}

function categoriesFor(
  config: HarnessRuntimePolicyConfig['reserveFloor'],
  tool: HarnessToolDefinition | undefined,
  call: HarnessToolCall,
): string[] {
  const configured = config?.getCategories?.(tool, call);
  if (configured && configured.length > 0) {
    return [...configured];
  }

  const raw = tool?.metadata?.runtimePolicyCategories ?? tool?.metadata?.categories;
  if (typeof raw === 'string' && raw.length > 0) {
    return [raw];
  }
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return [];
}

function defaultExtractCandidates(result: HarnessToolResult): string[] {
  const structured = result.structuredOutput;
  if (!isRecord(structured)) {
    return [];
  }

  const rawCandidates =
    structured.candidates ??
    structured.paths ??
    structured.ids ??
    structured.items;

  if (!Array.isArray(rawCandidates)) {
    return [];
  }

  return rawCandidates
    .map((candidate) => {
      if (typeof candidate === 'string') {
        return candidate.trim();
      }
      if (isRecord(candidate)) {
        const id = candidate.id;
        if (typeof id === 'string' && id.trim().length > 0) return id.trim();
        const path = candidate.path;
        if (typeof path === 'string' && path.trim().length > 0) return path.trim();
      }
      return '';
    })
    .filter((candidate) => candidate.length > 0);
}

function defaultIsDrilldown(call: HarnessToolCall, pendingCandidates: readonly string[]): boolean {
  const serialized = stableStringify(call.input ?? {});
  return pendingCandidates.some((candidate) => candidate.length > 0 && serialized.includes(candidate));
}

function createTurnState(): TurnPolicyState {
  return {
    todoWrites: 0,
    cache: new Map(),
    pendingCandidates: [],
    blockedCalls: 0,
    cacheHits: 0,
    todoRewriteBlocks: 0,
    sanitizerHits: 0,
  };
}

function runtimePolicyMetadata(
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    runtimePolicy: {
      synthetic: true,
      ...extra,
    },
  };
}

function advisoryResult(
  call: HarnessToolCall,
  advisory: string,
  metadata: Record<string, unknown>,
  structuredOutput?: Record<string, unknown>,
): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output: advisory,
    structuredOutput,
    metadata: runtimePolicyMetadata(metadata),
  };
}

function cloneCachedResult(
  call: HarnessToolCall,
  cached: HarnessToolResult,
): HarnessToolResult {
  return {
    ...cached,
    callId: call.id,
    metadata: {
      ...(cached.metadata ?? {}),
      ...runtimePolicyMetadata({
        cacheHit: true,
        source: 'turn_cache',
      }),
    },
  };
}

function buildBlockedDecision(
  turnId: string,
  call: HarnessToolCall,
  reason: string,
  advisory: string,
  metadata: Record<string, unknown>,
  structuredOutput?: Record<string, unknown>,
): HarnessRuntimePolicyDecision {
  return {
    action: 'blocked',
    consumeToolCall: false,
    result: advisoryResult(call, advisory, { blocked: true, reason, ...metadata }, structuredOutput),
    events: [
      {
        kind: 'runtime_policy.blocked',
        turnId,
        toolName: call.name,
        reason,
        metadata,
      },
    ],
  };
}

function buildGuardDecision(
  turnId: string,
  call: HarnessToolCall,
  guardName: string,
  decision: HarnessRuntimePolicyGuardDecision,
): HarnessRuntimePolicyDecision {
  return buildBlockedDecision(
    turnId,
    call,
    decision.reason ?? guardName,
    decision.advisory,
    {
      guard: guardName,
      ...(decision.metadata ?? {}),
    },
    decision.structuredOutput,
  );
}

function buildCacheKey(
  normalize: ((toolName: string, input: unknown) => string) | undefined,
  toolName: string,
  input: unknown,
): string {
  const normalized = normalize?.(toolName, input) ?? stableStringify(input ?? {});
  return `${toolName}::${normalized}`;
}

function sanitizePseudoToolBlocks(text: string): {
  text: string;
  strippedTokenClasses: string[];
} {
  const stripped = new Set<string>();
  let sanitized = text;
  let changed = false;

  sanitized = sanitized.replace(CODE_FENCE_RE, (block) => {
    const inner = block.replace(/^```[^\n]*\n?/u, '').replace(/```$/u, '');
    PSEUDO_TOOL_TAG_RE.lastIndex = 0;
    if (!PSEUDO_TOOL_TAG_RE.test(inner)) {
      PSEUDO_TOOL_TAG_RE.lastIndex = 0;
      return block;
    }
    PSEUDO_TOOL_TAG_RE.lastIndex = 0;
    changed = true;
    stripped.add('pseudo_tool_fence');
    return '';
  });

  const withoutNestedBlocks = stripNestedPseudoToolBlocks(sanitized, stripped);
  changed = changed || withoutNestedBlocks !== sanitized;
  sanitized = withoutNestedBlocks;

  if (!changed) {
    return { text, strippedTokenClasses: [] };
  }

  const compacted = sanitized.replace(/\n{3,}/gu, '\n\n').trim();
  return {
    text: compacted.length > 0 ? compacted : 'I removed raw tool syntax from the draft. Summarize the evidence in plain language.',
    strippedTokenClasses: [...stripped],
  };
}

function stripNestedPseudoToolBlocks(text: string, stripped: Set<string>): string {
  let cursor = 0;
  let output = '';

  while (cursor < text.length) {
    PSEUDO_TOOL_TAG_RE.lastIndex = cursor;
    const match = PSEUDO_TOOL_TAG_RE.exec(text);
    if (!match) {
      output += text.slice(cursor);
      break;
    }

    const [rawTag, tokenClass] = match;
    const tagStart = match.index;
    const isClosingTag = rawTag.startsWith('</');

    if (isClosingTag) {
      output += text.slice(cursor, PSEUDO_TOOL_TAG_RE.lastIndex);
      cursor = PSEUDO_TOOL_TAG_RE.lastIndex;
      continue;
    }

    const blockEnd = findPseudoToolBlockEnd(text, PSEUDO_TOOL_TAG_RE.lastIndex, stripped);
    if (blockEnd === -1) {
      output += text.slice(cursor, PSEUDO_TOOL_TAG_RE.lastIndex);
      cursor = PSEUDO_TOOL_TAG_RE.lastIndex;
      continue;
    }

    stripped.add(String(tokenClass));
    output += text.slice(cursor, tagStart);
    cursor = blockEnd;
  }

  PSEUDO_TOOL_TAG_RE.lastIndex = 0;
  return output;
}

function findPseudoToolBlockEnd(
  text: string,
  cursor: number,
  stripped: Set<string>,
): number {
  let depth = 1;

  while (cursor < text.length) {
    PSEUDO_TOOL_TAG_RE.lastIndex = cursor;
    const match = PSEUDO_TOOL_TAG_RE.exec(text);
    if (!match) {
      PSEUDO_TOOL_TAG_RE.lastIndex = 0;
      return -1;
    }

    const [rawTag, tokenClass] = match;
    stripped.add(String(tokenClass));
    depth += rawTag.startsWith('</') ? -1 : 1;
    cursor = PSEUDO_TOOL_TAG_RE.lastIndex;
    if (depth === 0) {
      PSEUDO_TOOL_TAG_RE.lastIndex = 0;
      return cursor;
    }
  }

  PSEUDO_TOOL_TAG_RE.lastIndex = 0;
  return -1;
}

export function createRuntimePolicy(
  config: HarnessRuntimePolicyConfig = {},
): HarnessRuntimePolicy {
  const todoToolNames = toolNamesSet(config.todoRewriteCap?.toolNames);
  const candidateToolNames = toolNamesSet(config.drillOrStop?.candidateProducingTools);
  const broadToolNames = toolNamesSet(config.drillOrStop?.broadTools);
  const blockedCategories = new Set(config.reserveFloor?.blockedCategories ?? []);
  const cacheEnabled = config.toolResultCache?.enabled === true;
  const todoMax = normalizePositiveInteger(config.todoRewriteCap?.max);
  const reserveFloor = normalizePositiveInteger(config.reserveFloor?.floor);
  const turns = new Map<string, TurnPolicyState>();

  function stateFor(turnId: string): TurnPolicyState {
    const existing = turns.get(turnId);
    if (existing) return existing;
    const created = createTurnState();
    turns.set(turnId, created);
    return created;
  }

  return {
    wrapTool(tool) {
      return tool;
    },

    beforeToolCall(input) {
      const state = stateFor(input.turnId);

      if (todoMax > 0 && todoToolNames.has(input.call.name)) {
        state.todoWrites += 1;
        if (state.todoWrites > todoMax) {
          state.blockedCalls += 1;
          state.todoRewriteBlocks += 1;
          return {
            action: 'blocked',
            consumeToolCall: false,
            result: advisoryResult(
              input.call,
              'Todo plan unchanged. Continue with the existing plan unless new evidence or a user redirect requires a rewrite.',
              {
                blocked: true,
                code: 'todo_rewrite_cap_reached',
                noop: true,
                writesAccepted: todoMax,
              },
              {
                ok: true,
                noop: true,
                reason: 'todo_rewrite_cap_reached',
              },
            ),
            events: [
              {
                kind: 'runtime_policy.todo_rewrite_blocked',
                turnId: input.turnId,
                toolName: input.call.name,
                reason: 'todo_rewrite_cap_reached',
                metadata: {
                  max: todoMax,
                  attemptedWrite: state.todoWrites,
                },
              },
            ],
          };
        }
      }

      const remainingToolCalls = Math.max(0, input.maxToolCalls - input.toolCallCount);
      for (const guard of config.customGuards ?? []) {
        const decision = guard.evaluate({
          turnId: input.turnId,
          call: input.call,
          tool: input.tool,
          toolCallCount: input.toolCallCount,
          maxToolCalls: input.maxToolCalls,
          remainingToolCalls,
        });
        if (decision) {
          state.blockedCalls += 1;
          return buildGuardDecision(input.turnId, input.call, guard.name, decision);
        }
      }

      const categories = categoriesFor(config.reserveFloor, input.tool, input.call);
      if (
        reserveFloor > 0 &&
        remainingToolCalls <= reserveFloor &&
        categories.some((category) => blockedCategories.has(category))
      ) {
        state.blockedCalls += 1;
        return buildBlockedDecision(
          input.turnId,
          input.call,
          'reserve_floor_reached',
          'The turn is at its reserved synthesis budget. Synthesize from existing evidence or ask one targeted clarifying question.',
          {
            floor: reserveFloor,
            remainingToolCalls,
            categories,
          },
          {
            ok: true,
            blocked: true,
            reason: 'reserve_floor_reached',
          },
        );
      }

      if (state.pendingCandidates.length > 0) {
        const isDrilldown =
          config.drillOrStop?.isDrilldown?.({
            call: input.call,
            tool: input.tool,
            pendingCandidates: state.pendingCandidates,
          }) ?? defaultIsDrilldown(input.call, state.pendingCandidates);

        if (isDrilldown) {
          state.pendingCandidates = [];
        } else if (broadToolNames.has(input.call.name)) {
          state.blockedCalls += 1;
          return buildBlockedDecision(
            input.turnId,
            input.call,
            'drill_or_stop_required',
            'Drill into one of the concrete candidates you already have, delegate a bounded follow-up with those candidates, or answer with the evidence already gathered.',
            {
              pendingCandidateCount: state.pendingCandidates.length,
            },
            {
              ok: true,
              blocked: true,
              reason: 'drill_or_stop_required',
            },
          );
        }
      }

      if (cacheEnabled) {
        const cacheKey = buildCacheKey(
          config.toolResultCache?.normalize,
          input.call.name,
          input.call.input,
        );
        const cached = state.cache.get(cacheKey);
        if (cached) {
          state.cacheHits += 1;
          return {
            action: 'cached',
            consumeToolCall: false,
            result: cloneCachedResult(input.call, cached.result),
            events: [
              {
                kind: 'runtime_policy.cache_hit',
                turnId: input.turnId,
                toolName: input.call.name,
                reason: 'duplicate_tool_call_cached',
                metadata: {
                  cached: true,
                },
              },
            ],
          };
        }
      }

      return {
        action: 'allow',
        consumeToolCall: true,
      };
    },

    afterToolResult(input) {
      const state = stateFor(input.turnId);
      const events: HarnessRuntimePolicyEvent[] = [];

      if (input.result.status !== 'success') {
        return events;
      }

      const runtimePolicyMeta = input.result.metadata?.runtimePolicy;
      if (isRecord(runtimePolicyMeta) && runtimePolicyMeta.synthetic === true) {
        return events;
      }

      if (cacheEnabled) {
        const cacheKey = buildCacheKey(
          config.toolResultCache?.normalize,
          input.call.name,
          input.call.input,
        );
        state.cache.set(cacheKey, {
          result: {
            ...input.result,
            metadata: { ...(input.result.metadata ?? {}) },
          },
        });
      }

      if (candidateToolNames.has(input.call.name)) {
        const candidates =
          config.drillOrStop?.extractCandidates?.({
            call: input.call,
            result: input.result,
            tool: input.tool,
          }) ?? defaultExtractCandidates(input.result);
        state.pendingCandidates = [...candidates];
      }

      return events;
    },

    sanitizeFinalOutput(input): HarnessRuntimePolicySanitizeResult {
      if (config.outputSanitizer?.enabled !== true) {
        return {
          text: input.text,
          sanitized: false,
          strippedTokenClasses: [],
          events: [],
        };
      }

      const state = stateFor(input.turnId);
      const sanitized = sanitizePseudoToolBlocks(input.text);
      if (sanitized.strippedTokenClasses.length === 0) {
        return {
          text: input.text,
          sanitized: false,
          strippedTokenClasses: [],
          events: [],
        };
      }

      state.sanitizerHits += 1;
      return {
        text: sanitized.text,
        sanitized: true,
        strippedTokenClasses: sanitized.strippedTokenClasses,
        events: [
          {
            kind: 'runtime_policy.output_sanitized',
            turnId: input.turnId,
            reason: 'pseudo_tool_syntax_removed',
            metadata: {
              modelId: input.modelId,
              strippedTokenClasses: sanitized.strippedTokenClasses,
            },
          },
        ],
      };
    },

    finalizeTurn(input) {
      const state = stateFor(input.turnId);
      if (
        !['completed', 'needs_clarification'].includes(input.outcome) ||
        state.blockedCalls + state.todoRewriteBlocks + state.sanitizerHits === 0
      ) {
        return [];
      }

      return [
        {
          kind: 'runtime_policy.synthesis_salvaged',
          turnId: input.turnId,
          reason: 'completed_after_runtime_policy_intervention',
          metadata: {
            outcome: input.outcome,
            stopReason: input.stopReason,
            blockedCalls: state.blockedCalls,
            todoRewriteBlocks: state.todoRewriteBlocks,
            cacheHits: state.cacheHits,
            sanitizerHits: state.sanitizerHits,
          },
        },
      ];
    },

    reset(turnId) {
      turns.delete(turnId);
    },
  };
}
