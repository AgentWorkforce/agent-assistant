import type {
  HarnessToolCall,
  HarnessToolExecutionContext,
  HarnessToolRegistry,
  HarnessToolResult,
} from './types.js';

export interface IdempotencyGuardOptions {
  /**
   * Hook the consumer uses to suggest "given this duplicate call, what
   * should the model try instead?" Returned strings are bulleted into
   * the error message. Default: returns a generic single-line tip.
   */
  alternativesFor?: (call: HarnessToolCall) => string[];

  /** LRU cap on retained turns. Default 50. */
  maxTurns?: number;
}

interface CachedCallRecord {
  iteration: number;
  outputChars: number;
  firstCalledAt: number;
  /**
   * Number of duplicate hits observed for this signature in the current
   * turn. Starts at 0 at cache-set time; incremented every time the
   * guard short-circuits on a subsequent identical call. Drives the
   * three-tier escalation (soft teaching → directive + inlined output →
   * fail-fast error).
   */
  duplicateCount: number;
  /**
   * A truncated copy of the prior successful output body, used by the
   * tier-2 directive message so the model gets the data inlined into
   * the new tool result instead of just being told to "use the prior
   * output." Capped at PRIOR_OUTPUT_CACHE_CAP at cache-set time so the
   * per-turn cache stays bounded.
   */
  priorOutput: string;
}

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_ALTERNATIVE =
  'Drill into a specific result from the previous output (cite a path or id) instead of re-searching.';

/** Hard cap on stored prior output (bytes of UTF-16). 4KB per entry. */
const PRIOR_OUTPUT_CACHE_CAP = 4096;
/** How much of the prior output we inline into the tier-2 directive. */
const DIRECTIVE_INLINE_CAP = 1200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableStringify(item));
  }

  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeForStableStringify(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value));
}

function getTurnId(context: HarnessToolExecutionContext): string | undefined {
  if (typeof context.turnId === 'string' && context.turnId.length > 0) {
    return context.turnId;
  }

  const metadata = (context as HarnessToolExecutionContext & {
    metadata?: Record<string, unknown>;
  }).metadata;
  return typeof metadata?.turnId === 'string' && metadata.turnId.length > 0
    ? metadata.turnId
    : undefined;
}

function normalizeMaxTurns(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) {
    return DEFAULT_MAX_TURNS;
  }
  return Math.floor(value);
}

function buildAlternatives(
  call: HarnessToolCall,
  options: IdempotencyGuardOptions | undefined,
): string[] {
  const alternatives = options?.alternativesFor?.(call)
    ?.map((item) => item.trim())
    .filter((item) => item.length > 0);

  return alternatives && alternatives.length > 0
    ? alternatives
    : [DEFAULT_ALTERNATIVE];
}

function truncate(value: string, cap: number): string {
  if (value.length <= cap) {
    return value;
  }
  return `${value.slice(0, cap)}…[truncated]`;
}

/**
 * Tier 1 (first duplicate). Gentle teaching message — the original 0.8.5
 * behavior. Returns a successful tool result so the harness keeps the
 * turn alive and the model gets a chance to read the alternatives.
 */
function softDuplicateResult(
  call: HarnessToolCall,
  previous: CachedCallRecord,
  options: IdempotencyGuardOptions | undefined,
): HarnessToolResult {
  const message = [
    `The ${call.name} tool was already called this turn at iteration ${previous.iteration} with the same input (${previous.outputChars} chars of output). Repeating the same call won't return new information. Try one of:`,
    ...buildAlternatives(call, options).map((item) => `- ${item}`),
  ].join('\n');

  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output: message,
    metadata: {
      idempotencyGuard: {
        blocked: true,
        code: 'redundant_call_blocked',
        tier: 1,
        duplicateCount: previous.duplicateCount,
        previousIteration: previous.iteration,
        previousOutputChars: previous.outputChars,
      },
    },
  };
}

/**
 * Tier 2 (second duplicate). Directive message with the prior output
 * inlined directly into the new tool result. The model has the data
 * right there — no excuse to re-call.
 */
function directiveDuplicateResult(
  call: HarnessToolCall,
  previous: CachedCallRecord,
  options: IdempotencyGuardOptions | undefined,
): HarnessToolResult {
  const inlined = truncate(previous.priorOutput, DIRECTIVE_INLINE_CAP);
  const alternatives = buildAlternatives(call, options).map((item) => `- ${item}`);

  const message = [
    `STOP. You already called ${call.name} with these exact arguments TWICE this turn (iteration ${previous.iteration} and again since). The data is below — use it instead of calling again.`,
    '',
    '--- DATA FROM PRIOR CALL ---',
    inlined,
    '--- END DATA ---',
    '',
    `Do NOT call ${call.name} with these arguments a fourth time. Either:`,
    ...alternatives,
    '',
    'If none apply, summarize what you have for the user and stop.',
  ].join('\n');

  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output: message,
    metadata: {
      idempotencyGuard: {
        blocked: true,
        code: 'redundant_call_blocked',
        tier: 2,
        duplicateCount: previous.duplicateCount,
        previousIteration: previous.iteration,
        previousOutputChars: previous.outputChars,
      },
    },
  };
}

/**
 * Tier 3+ (third+ duplicate). Fail-fast. Returns a non-retryable error
 * that the harness's existing classifier maps to
 * `tool_error_unrecoverable`, terminating the turn instead of letting
 * the model grind through more identical no-ops.
 */
function abortDuplicateResult(
  call: HarnessToolCall,
  previous: CachedCallRecord,
): HarnessToolResult {
  return {
    callId: call.id,
    toolName: call.name,
    status: 'error',
    error: {
      code: 'redundant_call_loop_aborted',
      message: `Aborting turn: ${call.name} was called ${previous.duplicateCount + 1} times this turn with identical arguments after two escalating warnings. Original output (${previous.outputChars} chars) is in the transcript at iteration ${previous.iteration}.`,
      retryable: false,
    },
    metadata: {
      idempotencyGuard: {
        blocked: true,
        code: 'redundant_call_loop_aborted',
        tier: 3,
        duplicateCount: previous.duplicateCount,
        previousIteration: previous.iteration,
        previousOutputChars: previous.outputChars,
      },
    },
  };
}

function touchTurnCache(
  turnCaches: Map<string, Map<string, CachedCallRecord>>,
  turnId: string,
): Map<string, CachedCallRecord> {
  const existing = turnCaches.get(turnId);
  if (existing) {
    turnCaches.delete(turnId);
    turnCaches.set(turnId, existing);
    return existing;
  }

  const created = new Map<string, CachedCallRecord>();
  turnCaches.set(turnId, created);
  return created;
}

function evictOldestTurnIfNeeded(
  turnCaches: Map<string, Map<string, CachedCallRecord>>,
  nextIterations: Map<string, number>,
  maxTurns: number,
): void {
  while (turnCaches.size > maxTurns) {
    const oldestTurnId = turnCaches.keys().next().value;
    if (oldestTurnId === undefined) {
      return;
    }
    turnCaches.delete(oldestTurnId);
    nextIterations.delete(oldestTurnId);
  }
}

export function createIdempotencyGuard(
  inner: HarnessToolRegistry,
  options?: IdempotencyGuardOptions,
): HarnessToolRegistry {
  const maxTurns = normalizeMaxTurns(options?.maxTurns);
  const turnCaches = new Map<string, Map<string, CachedCallRecord>>();
  const nextIterations = new Map<string, number>();

  return {
    listAvailable(input) {
      return inner.listAvailable(input);
    },

    async execute(call, context) {
      const turnId = getTurnId(context);
      if (!turnId) {
        return inner.execute(call, context);
      }

      const signature = `${call.name}::${stableStringify(call.input ?? {})}`;
      const turnCache = touchTurnCache(turnCaches, turnId);
      evictOldestTurnIfNeeded(turnCaches, nextIterations, maxTurns);

      const previous = turnCache.get(signature);
      if (previous) {
        previous.duplicateCount += 1;
        // Tier ladder. duplicateCount==1 is the first duplicate (the second
        // identical call overall). We escalate every subsequent duplicate
        // until tier 3, which fails fast.
        if (previous.duplicateCount === 1) {
          return softDuplicateResult(call, previous, options);
        }
        if (previous.duplicateCount === 2) {
          return directiveDuplicateResult(call, previous, options);
        }
        return abortDuplicateResult(call, previous);
      }

      const result = await inner.execute(call, context);
      // Only cache successful results. Caching errors would let a retryable
      // failure mask a subsequent retry as a "duplicate call" success — see
      // executeToolWithRetry: it re-invokes the same (name, input), and a
      // cache hit here returns status:'success' so the retry loop exits
      // without ever re-running the inner tool. Skipping the cache on
      // non-success keeps the retry path live.
      if (result.status === 'success') {
        const iteration = nextIterations.get(turnId) ?? 1;
        const output = result.output ?? '';
        turnCache.set(signature, {
          iteration,
          outputChars: output.length,
          firstCalledAt: Date.now(),
          duplicateCount: 0,
          priorOutput: truncate(output, PRIOR_OUTPUT_CACHE_CAP),
        });
        nextIterations.set(turnId, iteration + 1);
      }
      return result;
    },
  };
}
