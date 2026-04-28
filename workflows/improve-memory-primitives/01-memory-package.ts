import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 1 — @agent-assistant/memory primitives.
 *
 * Adds the building blocks that any memory consumer (sage today, others
 * later) needs but currently has to inline locally:
 *   - formatRelativeAge(entry): "just now" / "N minutes ago" / etc.
 *   - renderTurnMemoryContext(context, options): scope+age attributed text
 *     suitable for direct injection into a system prompt
 *   - SCOPE_LOAD_LIMITS named constants (SESSION/USER/WORKSPACE) so callers
 *     stop hand-tuning numbers
 *   - logMemoryOp({ op, scope, status, durationMs, ... }): structured
 *     console.info JSON event for observability — same shape across save /
 *     load / promote / close paths
 *   - hashMemoryContent(content): SHA-256 helper for content-hash dedup
 *   - retrieveTurnMemoryContext now accepts an optional `query` and
 *     forwards it to MemoryStore.retrieve so backends with semantic search
 *     can rank by relevance to the current turn
 *
 * Bumps @agent-assistant/memory minor version. Fully backwards-compatible:
 * existing helpers keep their current signatures, new args are optional.
 */

async function runWorkflow() {
  const result = await workflow('improve-memory-primitives-01-package')
    .description(
      'Add formatRelativeAge, renderTurnMemoryContext, scope load constants, logMemoryOp, hashMemoryContent, and query-aware retrieve to @agent-assistant/memory. Backwards compatible.',
    )
    .pattern('dag')
    .channel('wf-aa-memory-01')
    .maxConcurrency(2)
    .timeout(2_700_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Architect/reviewer for the memory package surface.',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer for the memory primitives + tests.',
      retries: 2,
    })

    .step('read-memory-pkg', {
      type: 'deterministic',
      command:
        'cat packages/memory/src/types.ts && echo --- && ' +
        'cat packages/memory/src/turn-memory.ts && echo --- && ' +
        'cat packages/memory/src/index.ts',
      captureOutput: true,
    })
    .step('read-memory-tests', {
      type: 'deterministic',
      command: 'cat packages/memory/src/turn-memory.test.ts | head -120',
      captureOutput: true,
    })
    .step('read-existing-pkg-version', {
      type: 'deterministic',
      command: 'grep "\\"version\\"" packages/memory/package.json | head -1',
      captureOutput: true,
    })

    // ── Implement primitives ──────────────────────────────────────
    .step('implement', {
      agent: 'impl',
      dependsOn: ['read-memory-pkg', 'read-memory-tests', 'read-existing-pkg-version'],
      task: `Edit packages/memory/src/turn-memory.ts (and create packages/memory/src/observability.ts if needed for log + hash helpers — keep small files focused).

Current memory package surface:
{{steps.read-memory-pkg.output}}

CONTRACT:

1. Export from a NEW file packages/memory/src/observability.ts:
   - export type MemoryOpName = 'load' | 'save' | 'promote' | 'compact' | 'close' | 'init' | 'forget'
   - export interface MemoryOpEvent { event: 'memory_op'; op: MemoryOpName; scope?: 'session' | 'user' | 'workspace'; workspaceId?: string; sessionId?: string; userId?: string; entryCount?: number; contentChars?: number; status: 'ok' | 'failed'; error?: string; durationMs: number; }
   - export function logMemoryOp(event: MemoryOpEvent): void  — single-line JSON.stringify console.info; safe for production
   - export async function measureMemoryOp<T>(meta: Omit<MemoryOpEvent, 'event' | 'status' | 'durationMs'>, fn: () => Promise<T>): Promise<T>
     wrap fn(); on success, log status='ok' with durationMs; on throw, log status='failed' with error message AND re-throw the original error.
   - export function hashMemoryContent(content: string): string  — SHA-256 base64url of content, 22 chars; pure (no IO).

2. Export from a NEW file packages/memory/src/relative-age.ts:
   - export function formatRelativeAge(entry: { createdAt?: string | Date | number }, now?: Date): string
     returns "just now" (<60s), "N minutes ago" (<60min), "N hours ago" (<24h), "N days ago" (<7d), "N weeks ago" (<5w), "N months ago" (<12mo), "N years ago" (>=12mo). Singular/plural correct ("1 minute ago" not "1 minutes ago"). Returns "unknown age" if createdAt missing/invalid.

3. Export from packages/memory/src/turn-memory.ts:
   - export const SESSION_LOAD_LIMIT = 6
   - export const USER_LOAD_LIMIT = 8
   - export const WORKSPACE_LOAD_LIMIT = 4
   - Modify retrieveTurnMemoryContext to accept perScopeLimits?: { session?: number; user?: number; workspace?: number } that, when provided, overrides perScopeLimit per scope. Existing perScopeLimit + limit args keep working unchanged.
   - Modify retrieveTurnMemoryContext to accept query?: string. When provided, pass it through into the per-scope store.retrieve call as MemoryQuery.query (the field already exists on MemoryQuery — see types.ts). Backends that ignore it stay correct.
   - export interface RenderTurnMemoryContextOptions { now?: Date; scopeLabels?: { session?: string; user?: string; workspace?: string } }
   - export function renderTurnMemoryContext(context: TurnMemoryContext, options?: RenderTurnMemoryContextOptions): string
     For each entry across all three scopes, emit one line:
       [<scopeLabel>, <relativeAge>] <entry.content>
     Scope label defaults: thread / user / workspace (override-able). Order: session entries first (most recent), then user, then workspace. Skip empty content. If context.entries is empty, return ''.

4. Wrap every internal store.retrieve / store.write / store.promote call inside retrieveTurnMemoryContext + promoteLatestSessionMemory + createRelayBackedMemoryStore in a measureMemoryOp(...) so the standard observability event lands without callers needing to wire it.

5. packages/memory/src/index.ts: re-export everything new (logMemoryOp, measureMemoryOp, hashMemoryContent, formatRelativeAge, SESSION_LOAD_LIMIT, USER_LOAD_LIMIT, WORKSPACE_LOAD_LIMIT, renderTurnMemoryContext, RenderTurnMemoryContextOptions, MemoryOpEvent, MemoryOpName).

6. Bump packages/memory/package.json version: minor bump from current to next minor (e.g. 0.3.10 → 0.4.0). Adding new exports is a minor under semver.

Only edit packages/memory/. Do NOT touch other packages.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-impl', {
      type: 'deterministic',
      dependsOn: ['implement'],
      command:
        'test -f packages/memory/src/observability.ts && ' +
        'test -f packages/memory/src/relative-age.ts && ' +
        'grep -Eq "logMemoryOp|measureMemoryOp|hashMemoryContent" packages/memory/src/observability.ts && ' +
        'grep -Eq "formatRelativeAge" packages/memory/src/relative-age.ts && ' +
        'grep -Eq "renderTurnMemoryContext|SESSION_LOAD_LIMIT|USER_LOAD_LIMIT|WORKSPACE_LOAD_LIMIT" packages/memory/src/turn-memory.ts && ' +
        'grep -Eq "renderTurnMemoryContext|formatRelativeAge|hashMemoryContent" packages/memory/src/index.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    // ── Tests ─────────────────────────────────────────────────────
    .step('write-tests', {
      agent: 'impl',
      dependsOn: ['verify-impl'],
      task: `Add tests:

1. packages/memory/src/relative-age.test.ts (vitest):
   - "just now" for entries <60s old
   - "1 minute ago" exactly at 60s; "59 minutes ago" at 59min; "1 hour ago" at 60min
   - Plural correctness: "2 hours ago", "1 day ago", "2 days ago", "1 week ago", "1 month ago", "1 year ago"
   - createdAt accepts string ISO, Date, number (epoch ms)
   - "unknown age" when createdAt is undefined or unparseable

2. packages/memory/src/observability.test.ts (vitest):
   - logMemoryOp emits ONE line of JSON.stringify via console.info
   - measureMemoryOp on success calls the inner fn, returns its value, logs status='ok' with durationMs >= 0
   - measureMemoryOp on throw still logs status='failed' with error message and re-throws the original error (assert via expect(...).rejects.toThrow)
   - hashMemoryContent returns 22 chars; same input → same output; different input → different output

3. Extend packages/memory/src/turn-memory.test.ts:
   - retrieveTurnMemoryContext respects perScopeLimits override
   - retrieveTurnMemoryContext forwards query argument to store.retrieve (use a vi.fn() store and assert query in the args)
   - renderTurnMemoryContext outputs lines in shape "[<scope>, <age>] <content>", session first, then user, then workspace
   - renderTurnMemoryContext respects scopeLabels override
   - renderTurnMemoryContext returns '' for empty TurnMemoryContext

Use vitest. Mirror existing test patterns in packages/memory/src/.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-tests', {
      type: 'deterministic',
      dependsOn: ['write-tests'],
      command:
        'test -f packages/memory/src/relative-age.test.ts && ' +
        'test -f packages/memory/src/observability.test.ts && ' +
        'grep -Eq "renderTurnMemoryContext|perScopeLimits|forwards query" packages/memory/src/turn-memory.test.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-tests', {
      type: 'deterministic',
      dependsOn: ['verify-tests'],
      command: 'npx vitest run packages/memory/ 2>&1 | tail -80',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-tests', {
      agent: 'impl',
      dependsOn: ['run-tests'],
      task: `Fix any failures from:
{{steps.run-tests.output}}
If green, no-op. Don't loosen assertions. Re-run: npx vitest run packages/memory/`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-tests'],
      command: 'npx vitest run packages/memory/ 2>&1 | tail -40',
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck', {
      type: 'deterministic',
      dependsOn: ['run-tests-final'],
      command: 'cd packages/memory && npx tsc --noEmit 2>&1 | tail -30; echo EXIT=$?',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-typecheck', {
      agent: 'impl',
      dependsOn: ['typecheck'],
      task: `If errors, fix. If EXIT=0, no-op.
{{steps.typecheck.output}}
Re-run: cd packages/memory && npx tsc --noEmit`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('typecheck-final', {
      type: 'deterministic',
      dependsOn: ['fix-typecheck'],
      command: 'cd packages/memory && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-review', {
      agent: 'lead',
      dependsOn: ['typecheck-final'],
      task: `Review via: git diff packages/memory/

Verify:
1. Existing exports / signatures unchanged. New args (perScopeLimits, query) are optional. retrieveTurnMemoryContext + promoteLatestSessionMemory still callable with the old signature.
2. measureMemoryOp NEVER swallows the original error. Re-throws are not wrapped.
3. logMemoryOp output is JSON.parseable (no template literals, no inline objects).
4. hashMemoryContent is deterministic across runs (no Date.now / Math.random in input).
5. renderTurnMemoryContext is dedup-free in this PR (dedup is a later concern). Don't introduce dedup here.
6. Version bump is minor not patch (new exports = minor under semver).

Edit files directly to fix. Re-run npx vitest run packages/memory/ + cd packages/memory && npx tsc --noEmit.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('post-review-final', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/memory/ 2>&1 | tail -30 && echo --- && ' +
        'cd packages/memory && npx tsc --noEmit 2>&1 | tail -10',
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
