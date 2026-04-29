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
}

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_ALTERNATIVE =
  'Drill into a specific result from the previous output (cite a path or id) instead of re-searching.';

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

function duplicateResult(
  call: HarnessToolCall,
  previous: CachedCallRecord,
  options: IdempotencyGuardOptions | undefined,
): HarnessToolResult {
  const message = [
    `The ${call.name} tool was already called this turn at iteration ${previous.iteration} with the same input (${previous.outputChars} chars of output). Repeating the same call won't return new information. Try one of:`,
    ...buildAlternatives(call, options).map((item) => `- ${item}`),
  ].join('\n');

  // Return a successful tool result, not an error. The whole point of
  // surfacing alternatives is for the model to read them and pick a
  // different tool — but the harness classifies any tool error with
  // `retryable !== true` as `tool_error_unrecoverable` and terminates
  // the turn, which means the model never sees this message. By
  // delivering the teaching message as the tool's `output` we keep the
  // turn alive so the model can adapt.
  return {
    callId: call.id,
    toolName: call.name,
    status: 'success',
    output: message,
    metadata: {
      idempotencyGuard: {
        blocked: true,
        code: 'redundant_call_blocked',
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
        return duplicateResult(call, previous, options);
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
        turnCache.set(signature, {
          iteration,
          outputChars: result.output?.length ?? 0,
          firstCalledAt: Date.now(),
        });
        nextIterations.set(turnId, iteration + 1);
      }
      return result;
    },
  };
}
