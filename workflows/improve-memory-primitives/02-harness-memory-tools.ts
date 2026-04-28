import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 2 — @agent-assistant/harness memory tool registry.
 *
 * Adds createMemoryToolRegistry({ store }) — analogous to the existing
 * createWorkspaceToolRegistry({ provider }). Exposes three tools the
 * harness model can call deliberately:
 *   - memory_remember(content, scope?, tags?, expiresInDays?)
 *   - memory_recall(query, scope?, limit?)
 *   - memory_forget(entryId)
 *
 * Wires through to MemoryStore (the interface from @agent-assistant/memory).
 * Scope-aware: callers wire workspaceId/userId/sessionId through context.
 *
 * Bumps @agent-assistant/harness minor version. Existing tool registries
 * untouched.
 */

async function runWorkflow() {
  const result = await workflow('improve-memory-primitives-02-harness-tools')
    .description(
      'Add createMemoryToolRegistry to @agent-assistant/harness exposing memory_remember, memory_recall, memory_forget tools that any harness consumer can compose alongside workspace + bash tools.',
    )
    .pattern('dag')
    .channel('wf-aa-memory-02')
    .maxConcurrency(2)
    .timeout(2_700_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Architect/reviewer for the harness memory tool surface.',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer for the new memory tool registry + tests.',
      retries: 2,
    })

    .step('read-workspace-tool-registry', {
      type: 'deterministic',
      command:
        'cat packages/harness/src/tools/workspace-tool-registry.ts | head -200 && echo --- && ' +
        'cat packages/harness/src/tools/bash-tool-registry.ts | head -100',
      captureOutput: true,
    })
    .step('read-harness-types', {
      type: 'deterministic',
      command: 'cat packages/harness/src/types.ts | head -150',
      captureOutput: true,
    })
    .step('read-memory-store', {
      type: 'deterministic',
      command:
        'cat packages/memory/src/types.ts && echo --- && ' +
        'cat packages/memory/src/index.ts',
      captureOutput: true,
    })
    .step('read-harness-package-json', {
      type: 'deterministic',
      command: 'cat packages/harness/package.json',
      captureOutput: true,
    })

    // ── Implement ─────────────────────────────────────────────────
    .step('implement', {
      agent: 'impl',
      dependsOn: ['read-workspace-tool-registry', 'read-harness-types', 'read-memory-store', 'read-harness-package-json'],
      task: `Create packages/harness/src/tools/memory-tool-registry.ts modelled on workspace-tool-registry.ts.

Reference (mirror naming, exports, validation patterns):
{{steps.read-workspace-tool-registry.output}}

HarnessToolRegistry interface (don't deviate):
{{steps.read-harness-types.output}}

MemoryStore + scope types from @agent-assistant/memory:
{{steps.read-memory-store.output}}

CONTRACT:

1. Export const names:
   MEMORY_REMEMBER_TOOL_NAME = 'memory_remember'
   MEMORY_RECALL_TOOL_NAME   = 'memory_recall'
   MEMORY_FORGET_TOOL_NAME   = 'memory_forget'
   MEMORY_TOOL_NAMES = readonly tuple of the three.

2. Tool definitions (HarnessToolDefinition) with input schemas:

   memory_remember:
     description: "Save a durable fact to memory. Use when the user shares a preference, project context, ownership info, deadline, or any fact you should recall in future turns. Pick the narrowest scope that's still useful: 'session' for thread-only context, 'user' for per-person facts, 'workspace' for org-wide context shared by everyone in this Slack workspace."
     input: { content: string (1..2000 chars), scope: enum('session','user','workspace'), tags?: string[] (max 10), expiresInDays?: number (1..365) }

   memory_recall:
     description: "Search memory for relevant facts. Use when the user asks about prior context, when you need to verify a preference before acting, or before answering questions where you suspect prior context exists. Returns up to limit entries ranked by recency and (when supported) semantic relevance."
     input: { query: string (1..500 chars), scope?: enum('session','user','workspace','any'), limit?: number (1..20, default 5) }

   memory_forget:
     description: "Delete a specific memory entry by id. Use when the user explicitly asks you to forget something, or when you discover a stored fact is wrong / superseded. Pass the id from a memory_recall result."
     input: { entryId: string (1..200 chars) }

3. Export interface MemoryToolRegistryOptions:
     store: MemoryStore | null   // null disables the registry (listAvailable returns [])
     resolveScopeContext: (input: HarnessToolExecutionContext) => {
       workspaceId?: string;
       userId?: string;
       sessionId?: string;
     }
     // Resolves scope identifiers from the harness execution context. Lets
     // each consumer (sage / future) decide how userId/workspaceId/sessionId
     // map from their own session model.

4. Export createMemoryToolRegistry(options: MemoryToolRegistryOptions): HarnessToolRegistry

5. execute() per tool:

   memory_remember:
     - validate input (use the same isRecord / readRequiredString patterns as workspace-tool-registry)
     - resolve scope using options.resolveScopeContext(call.context)
     - if scope='user' and resolved.userId is missing → invalidInputResult ("memory_remember scope='user' requires user identity in execution context")
     - same guard for scope='session' (sessionId) and scope='workspace' (workspaceId)
     - build WriteMemoryInput with scope { kind: scope, ...id }, content, tags, expiresAt
     - call store.write; on success return { status: 'success', output: JSON.stringify({ id: written.id, scope, expiresAt }), structuredOutput: { entry: written } }
     - wrap in measureMemoryOp from @agent-assistant/memory so the structured log lands

   memory_recall:
     - validate
     - if scope='any' or omitted, call retrieveTurnMemoryContext (from @agent-assistant/memory) with the resolved context + query; output is the rendered text via renderTurnMemoryContext
     - if specific scope, call store.retrieve directly with that scope + query, render same shape
     - return { status: 'success', output: rendered, structuredOutput: { entries } }
     - wrap in measureMemoryOp

   memory_forget:
     - validate entryId
     - call store.delete(entryId) (Note: MemoryStore.delete already exists — verify in types.ts)
     - return { status: 'success', output: 'forgotten' }
     - if delete throws MemoryEntryNotFoundError → return { status: 'error', error: { code: 'not_found', message: ..., retryable: false } }
     - wrap in measureMemoryOp

6. listAvailable: same shape as workspace-tool-registry — return all 3 tools when options.store, [] when null. Honor input.allowedToolNames if non-empty.

7. Re-export from packages/harness/src/index.ts: createMemoryToolRegistry, MEMORY_TOOL_NAMES, MEMORY_REMEMBER_TOOL_NAME, MEMORY_RECALL_TOOL_NAME, MEMORY_FORGET_TOOL_NAME, MemoryToolRegistryOptions.

8. Bump packages/harness/package.json minor: e.g. 0.6.12 → 0.7.0. Add "@agent-assistant/memory" to dependencies (with the version bumped in Sub 1).

Only edit packages/harness/.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-impl', {
      type: 'deterministic',
      dependsOn: ['implement'],
      command:
        'test -f packages/harness/src/tools/memory-tool-registry.ts && ' +
        'grep -Eq "memory_remember|memory_recall|memory_forget" packages/harness/src/tools/memory-tool-registry.ts && ' +
        'grep -Eq "createMemoryToolRegistry" packages/harness/src/tools/memory-tool-registry.ts && ' +
        'grep -Eq "createMemoryToolRegistry" packages/harness/src/index.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    // ── Tests ─────────────────────────────────────────────────────
    .step('write-tests', {
      agent: 'impl',
      dependsOn: ['verify-impl'],
      task: `Create packages/harness/src/tools/memory-tool-registry.test.ts (vitest). Mirror conventions in workspace-tool-registry.test.ts.

Required cases:

A. listAvailable:
   - returns all three tools when store is provided
   - returns [] when store is null
   - filters to allowedToolNames when set

B. memory_remember happy path:
   - stub MemoryStore.write returning a synthesized MemoryEntry
   - resolveScopeContext returns { userId: 'u1', workspaceId: 'ws1', sessionId: 's1' }
   - scope='session', valid content
   - assert store.write called with scope { kind: 'session', sessionId: 's1' }, content matches, tags forwarded
   - assert output JSON parses to { id, scope, expiresAt? }

C. memory_remember scope guards:
   - scope='user' with no userId in context → invalid_input
   - scope='session' with no sessionId → invalid_input
   - scope='workspace' with no workspaceId → invalid_input
   - content > 2000 chars → invalid_input
   - missing scope → invalid_input

D. memory_recall:
   - scope omitted → calls retrieveTurnMemoryContext, output uses renderTurnMemoryContext shape
   - scope='user' → calls store.retrieve directly with scope + query
   - empty result → output is empty string but status='success'

E. memory_forget:
   - happy path returns 'forgotten'
   - MemoryEntryNotFoundError → status='error', code='not_found'

F. observability:
   - on success, console.info is called with one JSON line whose payload has event='memory_op'
   - on store.write throw, the error propagates AND a status='failed' event is logged

Use vi.spyOn(console, 'info') for the log assertions.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-tests', {
      type: 'deterministic',
      dependsOn: ['write-tests'],
      command:
        'test -f packages/harness/src/tools/memory-tool-registry.test.ts && ' +
        'grep -Eq "memory_remember|memory_recall|memory_forget|scope guards" packages/harness/src/tools/memory-tool-registry.test.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-tests', {
      type: 'deterministic',
      dependsOn: ['verify-tests'],
      command: 'npx vitest run packages/harness/ 2>&1 | tail -80',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-tests', {
      agent: 'impl',
      dependsOn: ['run-tests'],
      task: `Fix any failures.
{{steps.run-tests.output}}
If green, no-op. Re-run: npx vitest run packages/harness/`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-tests'],
      command: 'npx vitest run packages/harness/ 2>&1 | tail -40',
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
      task: `Review via: git diff packages/harness/src/tools/memory-tool-registry.ts packages/harness/src/index.ts packages/harness/package.json

Verify:
1. memory_remember scope guards reject ambiguous calls (no implicit fallback to workspace).
2. memory_recall renders identical shape to renderTurnMemoryContext from Sub 1 — same scope+age prefix.
3. memory_forget returns invalid-input not server-error when store doesn't support delete.
4. resolveScopeContext is the consumer's hook — no sage-specific knowledge baked in.
5. measureMemoryOp wrapping does not catch errors; observability is additive.
6. Version bump is minor (new tools = minor under semver).
7. The new file follows workspace-tool-registry.ts conventions — same isRecord, validate*, output shape, error code naming.

Edit files to fix. Re-run npx vitest run packages/harness/ + cd packages/harness && npx tsc --noEmit.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('post-review-final', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/harness/ 2>&1 | tail -30 && echo --- && ' +
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
