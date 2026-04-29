import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 2 — `createIdempotencyGuard(inner, options?)` registry wrapper.
 *
 * Why this lifts upstream:
 *   sage observed turns where the model called workspace_search 4× with
 *   identical input, interleaved with other tools to dodge the upstream
 *   max-tool-calls / redundant-loop detector (which counts CONSECUTIVE
 *   identical calls). The fix needs to be at the registry layer: any
 *   harness consumer benefits from blocking the 2nd identical
 *   (name + input) call within a turn.
 *
 *   Sage built `withRedundantCallGuard(inner)` locally. This sub lifts
 *   that into a generic, configurable factory exported from
 *   @agent-assistant/harness so future consumers don't reinvent it.
 *
 * Contract (`createIdempotencyGuard`):
 *   - Wraps a HarnessToolRegistry; returns a HarnessToolRegistry with the
 *     same shape (listAvailable passthrough, execute wrapped).
 *   - Tracks calls by (turnId, name + JSON.stringify(input)) signature.
 *     turnId comes from HarnessToolExecutionContext.
 *   - 1st call within a turn: passes through to inner.execute, records
 *     the result's outputChars + iteration in cache.
 *   - 2nd identical call within the same turn: returns a HarnessToolResult
 *     immediately (does NOT call inner.execute) with status='error',
 *     error.code='redundant_call_blocked', error.retryable=false, message
 *     naming the iteration of the 1st call + N drill-in alternatives the
 *     consumer configured.
 *   - LRU cap on number of turns retained (default 50) — eviction is
 *     oldest-first by access time.
 *   - Configurable: `{ alternativesFor?: (call) => string[]; maxTurns?: number }`.
 *     `alternativesFor` is the consumer hook for "given the duplicate call,
 *     what should the model try instead?" — defaults to a generic message.
 *
 * Backwards-compatible: NEW export. Existing harness behavior unchanged
 * unless the consumer opts in by wrapping their registry.
 *
 * Minor bump on @agent-assistant/harness.
 */

async function runWorkflow() {
  const result = await workflow('improve-harness-primitives-02-idempotency')
    .description(
      'Add createIdempotencyGuard(inner, options?) — registry wrapper that blocks the 2nd identical (name + input) tool call within a turn with a structured error pointing at drill-in alternatives.',
    )
    .pattern('dag')
    .channel('wf-aa-harness-02')
    .maxConcurrency(2)
    .timeout(2_700_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Architect/reviewer for the registry-wrapping surface.',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer for the idempotency guard + tests.',
      retries: 2,
    })

    .step('read-types', {
      type: 'deterministic',
      command:
        'cat packages/harness/src/types.ts | head -260 && echo --- && ' +
        'cat packages/harness/src/index.ts',
      captureOutput: true,
    })

    .step('implement', {
      agent: 'impl',
      dependsOn: ['read-types'],
      task: `Create a NEW file packages/harness/src/idempotency-guard.ts.

Current types + index.ts:
{{steps.read-types.output}}

CONTRACT — exported surface:

\`\`\`ts
import type {
  HarnessToolRegistry,
  HarnessToolCall,
  HarnessToolResult,
  HarnessToolExecutionContext,
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

export function createIdempotencyGuard(
  inner: HarnessToolRegistry,
  options?: IdempotencyGuardOptions,
): HarnessToolRegistry;
\`\`\`

IMPLEMENTATION:

- Module-level (or closed-over) Map<turnId, Map<callSignature, { iteration: number; outputChars: number; firstCalledAt: number }>>.
- callSignature = \`\${call.name}::\${stableStringify(call.input ?? {})}\` where stableStringify sorts object keys recursively so { a: 1, b: 2 } and { b: 2, a: 1 } produce the same key.
- turnId comes from HarnessToolExecutionContext (check types.ts; if it's missing, fall back to context.metadata?.turnId; if still missing, skip caching for that call entirely — guarded behavior is graceful when the consumer isn't propagating turn id).
- LRU eviction: when Map.size > maxTurns, delete the oldest by insertion order (Map insertion order is stable in JS; refresh on read by delete+re-set).
- listAvailable: pure passthrough to inner.listAvailable.
- execute(call, context):
  - Compute signature.
  - Look up turn cache. If 2nd identical signature: return:
    \`\`\`ts
    {
      callId: call.callId,
      toolName: call.name,
      status: 'error',
      output: \`\`,
      error: {
        code: 'redundant_call_blocked',
        message: <see below>,
        retryable: false,
      },
    }
    \`\`\`
    Message format (one string, multi-line):
    \`The \${call.name} tool was already called this turn at iteration \${prev.iteration} with the same input (\${prev.outputChars} chars of output). Repeating the same call won't return new information. Try one of:\n  - <alt1>\n  - <alt2>\n  - <alt3>\`
    where alts come from \`options.alternativesFor?.(call)\`. If the hook returns empty/undefined, use a single default line: "Drill into a specific result from the previous output (cite a path or id) instead of re-searching."
  - Otherwise: call inner.execute(call, context). Record { iteration: incrementing per turn from 1, outputChars: result.output?.length ?? 0, firstCalledAt: Date.now() } and return the result unchanged.
- Iteration counter is per-turn (resets across turns).
- The guard MUST NOT swallow exceptions thrown by inner.execute — propagate.

Also export from packages/harness/src/index.ts:
- export { createIdempotencyGuard, type IdempotencyGuardOptions } from './idempotency-guard.js';

Bump packages/harness/package.json minor version (additive export = minor).

Edit ONLY:
- packages/harness/src/idempotency-guard.ts (new)
- packages/harness/src/index.ts (re-export)
- packages/harness/package.json (version bump)`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-impl', {
      type: 'deterministic',
      dependsOn: ['implement'],
      command:
        'test -f packages/harness/src/idempotency-guard.ts && ' +
        'grep -q "createIdempotencyGuard" packages/harness/src/idempotency-guard.ts && ' +
        'grep -q "createIdempotencyGuard" packages/harness/src/index.ts && ' +
        'grep -q "redundant_call_blocked" packages/harness/src/idempotency-guard.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-tests', {
      agent: 'impl',
      dependsOn: ['verify-impl'],
      task: `Add packages/harness/src/idempotency-guard.test.ts (vitest).

Required test cases:

1. First call passes through.
   - innerRegistry.execute = vi.fn() returning success result.
   - guard.execute(callA, ctx) → inner called once, result returned unchanged.

2. Second identical call within same turn is blocked.
   - guard.execute(callA, ctx) — succeeds.
   - guard.execute(callA, ctx) — returns status='error', error.code='redundant_call_blocked', retryable=false. inner.execute called only ONCE (not twice).

3. Different turn id → not blocked.
   - guard.execute(callA, ctxTurn1) — passthrough.
   - guard.execute(callA, ctxTurn2) — passthrough (inner called twice total).

4. Different input shape → not blocked.
   - call with input {q: 'a'} then {q: 'b'} → both pass through.

5. Stable stringify: input {a: 1, b: 2} and {b: 2, a: 1} are SAME signature (2nd blocked).

6. listAvailable is passthrough.
   - guard.listAvailable(input) → inner.listAvailable called with same input, return value forwarded.

7. alternativesFor hook is invoked and its output appears in the blocked error message.
   - alternativesFor: () => ['try X', 'try Y'] → message contains "try X" and "try Y".

8. Empty / missing alternativesFor → default fallback line appears in message.

9. LRU eviction: with maxTurns=2, after recording 3 distinct turns, the oldest turn's signatures are evicted (a repeat call from turn 1 now passes through instead of being blocked).

10. Inner exception propagates: inner.execute = vi.fn().mockRejectedValue(new Error('boom')). guard.execute(...) rejects with the same error. Cache should NOT record a successful entry for that call (so a retry isn't blocked).

11. Iteration counter: with multiple distinct calls then a duplicate, the blocked message reports the iteration the original was made at (iteration=1 for the first call's duplicate, iteration=2 for the second's duplicate).

Use vi.fn() for inner registry. Construct a minimal HarnessToolExecutionContext per the type — inspect packages/harness/src/types.ts to learn the shape and the turnId field path.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-tests', {
      type: 'deterministic',
      dependsOn: ['write-tests'],
      command:
        'test -f packages/harness/src/idempotency-guard.test.ts && ' +
        'grep -Eq "redundant_call_blocked|maxTurns|alternativesFor" packages/harness/src/idempotency-guard.test.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-tests', {
      type: 'deterministic',
      dependsOn: ['verify-tests'],
      command: 'npx vitest run packages/harness/src/idempotency-guard 2>&1 | tail -80',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-tests', {
      agent: 'impl',
      dependsOn: ['run-tests'],
      task: `Fix any failures from:
{{steps.run-tests.output}}
If green, no-op. Don't loosen assertions. Re-run: npx vitest run packages/harness/src/idempotency-guard`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-tests'],
      command: 'npx vitest run packages/harness/src/idempotency-guard 2>&1 | tail -40',
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck', {
      type: 'deterministic',
      dependsOn: ['run-tests-final'],
      command: 'cd packages/harness && npx tsc --noEmit 2>&1 | tail -30; echo EXIT=$?',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-typecheck', {
      agent: 'impl',
      dependsOn: ['typecheck'],
      task: `If errors, fix. If EXIT=0, no-op.
{{steps.typecheck.output}}
Re-run: cd packages/harness && npx tsc --noEmit`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('typecheck-final', {
      type: 'deterministic',
      dependsOn: ['fix-typecheck'],
      command: 'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-review', {
      agent: 'lead',
      dependsOn: ['typecheck-final'],
      task: `Review via: git diff packages/harness/

Verify:
1. createIdempotencyGuard is purely additive — no existing harness code path is changed.
2. Stable stringify handles nested objects and arrays (key sort applies recursively).
3. The guard does NOT swallow inner.execute exceptions. On throw, the cache is NOT updated (so retries after a transient throw are not blocked).
4. LRU eviction is correct — sketch out a 3-turn cycle with maxTurns=2 and confirm eviction order.
5. listAvailable is passthrough (not memoized — listAvailable can vary across calls in some consumers).
6. error.retryable is FALSE on the blocked path — retrying the exact same call is exactly the wrong thing to do.
7. Default alternativesFor fallback is helpful, not just "try something else".
8. Version bump is minor.

Edit files directly to fix. Re-run npx vitest run packages/harness/src/idempotency-guard + cd packages/harness && npx tsc --noEmit.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('post-review-final', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/harness/src/idempotency-guard 2>&1 | tail -20 && echo --- && ' +
        'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
  if (result.status === 'failed') process.exit(1);
}

runWorkflow().catch((error) => {
  console.error(error);
  process.exit(1);
});
