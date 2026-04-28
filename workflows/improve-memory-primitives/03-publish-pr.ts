import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 3 — Holistic review, commit, push, open PR.
 *
 * Does NOT publish to npm — that's the existing release workflow's job
 * once the PR merges. This sub just gets the change set into a single
 * reviewable PR with the cross-cutting message.
 */

async function runWorkflow() {
  const result = await workflow('improve-memory-primitives-03-pr')
    .description(
      'Final cross-package review of @agent-assistant/memory + @agent-assistant/harness changes, single commit, push, open PR.',
    )
    .pattern('dag')
    .channel('wf-aa-memory-03')
    .maxConcurrency(2)
    .timeout(1_800_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Senior reviewer with authority to send work back.',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer for any final review-driven fixes.',
      retries: 2,
    })

    .step('check-branch', {
      type: 'deterministic',
      command:
        'branch=$(git rev-parse --abbrev-ref HEAD); ' +
        'echo "Current branch: $branch"; ' +
        'if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then ' +
        '  echo "REFUSE: not on a feature branch — master executor should have created one"; exit 1; ' +
        'fi; ' +
        'git status --short',
      captureOutput: true,
      failOnError: true,
    })

    .step('show-diff-stat', {
      type: 'deterministic',
      dependsOn: ['check-branch'],
      command: 'git diff --stat HEAD; echo ---; git log --oneline origin/main..HEAD',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-review', {
      agent: 'lead',
      dependsOn: ['show-diff-stat'],
      task: `Review the full diff via: git diff HEAD

Required pass criteria:
1. @agent-assistant/memory exports: formatRelativeAge, renderTurnMemoryContext, SESSION/USER/WORKSPACE_LOAD_LIMIT, logMemoryOp, measureMemoryOp, hashMemoryContent, MemoryOpEvent, MemoryOpName.
2. @agent-assistant/harness exports: createMemoryToolRegistry, MEMORY_TOOL_NAMES, MEMORY_REMEMBER/RECALL/FORGET_TOOL_NAME, MemoryToolRegistryOptions.
3. Existing function signatures (retrieveTurnMemoryContext, promoteLatestSessionMemory, createRelayBackedMemoryStore) are backwards compatible — new args optional.
4. Both package.json bumps are minor (new exports = minor under semver). harness depends on the new memory minor.
5. measureMemoryOp NEVER swallows errors anywhere it's used.
6. memory_remember scope guards prevent accidental writes when the resolver returns no id for the chosen scope.
7. No leftover .skip / .only / console.log debug in tests or src.
8. Tests cover happy + edge + failure paths for every new helper.

If anything is wrong, fix directly. Then re-run:
  npx vitest run packages/memory/ packages/harness/
  cd packages/memory && npx tsc --noEmit
  cd packages/harness && npx tsc --noEmit`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })

    .step('post-review-tests', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/memory/ packages/harness/ 2>&1 | tail -30 && echo --- && ' +
        'cd packages/memory && npx tsc --noEmit 2>&1 | tail -10 && echo --- && ' +
        'cd ../harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .step('commit', {
      type: 'deterministic',
      dependsOn: ['post-review-tests'],
      command:
        'git add packages/memory/ packages/harness/ && ' +
        "git commit -m 'feat(memory,harness): scope-attributed render, structured logs, content-hash, memory tool registry' " +
        "           -m 'Adds the primitives any harness consumer needs to surface memory to its model. memory: formatRelativeAge, renderTurnMemoryContext, SESSION/USER/WORKSPACE_LOAD_LIMIT, logMemoryOp/measureMemoryOp, hashMemoryContent, query-aware retrieveTurnMemoryContext. harness: createMemoryToolRegistry exposing memory_remember/memory_recall/memory_forget tools wired to MemoryStore via resolveScopeContext. Fully backwards compatible; new args optional, existing signatures unchanged. Minor bumps on both packages.'",
      captureOutput: true,
      failOnError: true,
    })

    .step('push', {
      type: 'deterministic',
      dependsOn: ['commit'],
      command:
        'branch=$(git rev-parse --abbrev-ref HEAD) && git push -u origin "$branch"',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-pr-body', {
      type: 'deterministic',
      dependsOn: ['push'],
      // Single bash heredoc — pattern from sage workflow that proved robust
      // against shell quoting hell with backticks in body content.
      command: `mkdir -p tmp && cat > tmp/aa-memory-pr-body.md <<'PRBODY'
## Summary

Adds memory primitives that any \`@agent-assistant/harness\` consumer needs to surface memory to its model. Sage's existing memory layer reinvented several of these locally; consolidating upstream lets new consumers (and the next iteration of sage) build on a shared foundation.

## @agent-assistant/memory (minor bump)

- \`formatRelativeAge(entry, now?)\` — "just now" / "N minutes ago" / etc. Pluralization correct, accepts string ISO / Date / number.
- \`renderTurnMemoryContext(context, options?)\` — turns a \`TurnMemoryContext\` into scope+age attributed lines (\`[<scope>, <age>] <content>\`). Session first, then user, then workspace. Override-able scope labels.
- \`SESSION_LOAD_LIMIT\`, \`USER_LOAD_LIMIT\`, \`WORKSPACE_LOAD_LIMIT\` constants — stop callers from hand-tuning.
- \`retrieveTurnMemoryContext\` — accepts optional \`perScopeLimits\` override map and \`query\` (forwarded to \`MemoryStore.retrieve\`'s \`MemoryQuery.query\` so semantic backends can rank relevance).
- \`logMemoryOp(event)\` + \`measureMemoryOp(meta, fn)\` — single-line JSON \`event=memory_op\` console.info events for every save / load / promote / close / init / forget. measureMemoryOp re-throws originals; observability is additive, not control flow.
- \`hashMemoryContent(content)\` — SHA-256 base64url helper for content-hash dedup at the consumer.

## @agent-assistant/harness (minor bump)

- \`createMemoryToolRegistry({ store, resolveScopeContext })\` — analogous to \`createWorkspaceToolRegistry({ provider })\`. Exposes three tools the harness model can call deliberately:
  - \`memory_remember(content, scope, tags?, expiresInDays?)\`
  - \`memory_recall(query, scope?, limit?)\`
  - \`memory_forget(entryId)\`
- \`resolveScopeContext\` is the consumer's hook — sage will map workspaceId from its session, future consumers map differently.
- Scope guards reject \`memory_remember scope='user'\` when no userId is in the execution context (and equivalents for session/workspace).
- All ops wrapped in \`measureMemoryOp\` so the structured \`memory_op\` event lands without callers wiring it.

## Why this matters

Sage's harness model currently has zero agency over memory — the framework auto-summarizes every Slack turn into a 600-char blob and a regex decides whether to promote it to user scope. The model can't choose what to remember, can't recall a specific fact, can't forget something the user retracts. With these tools the model can do all three, and the existing passive auto-save remains as a fallback. Sage's adoption ships in a follow-up PR (\`workflows/improve-sage-memory/\` over in the sage repo).

## Test plan

- [x] \`npx vitest run packages/memory/ packages/harness/\` — green.
- [x] \`cd packages/memory && npx tsc --noEmit\` — clean.
- [x] \`cd packages/harness && npx tsc --noEmit\` — clean.
- [x] Backwards-compat: existing signatures unchanged; new args optional.
- [x] Failure-path tests: measureMemoryOp re-throws original errors; memory_forget returns \`not_found\` (not server error) when entry missing.

## Followups

- Sage adoption (separate PR in the sage repo) — wires \`createMemoryToolRegistry\` into \`SageHarnessRegistryDeps\`, swaps capabilities prompt, swaps \`thread-context\` layer to call \`renderTurnMemoryContext\`, and unifies the slack/client-api write paths.
- Consider a dedicated content-hash dedup helper in the store layer (today \`hashMemoryContent\` is only the building block).
- Compaction strategy across user-scope duplicates — defer until usage data arrives.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
wc -l tmp/aa-memory-pr-body.md`,
      captureOutput: true,
      failOnError: true,
    })

    .step('open-pr', {
      type: 'deterministic',
      dependsOn: ['write-pr-body'],
      command:
        'PR_URL=$(gh pr create --title "feat(memory,harness): scope-attributed render, structured logs, memory tool registry" --body-file tmp/aa-memory-pr-body.md) && echo "PR: $PR_URL"',
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
