import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 6 — Holistic review, commit, push, open PR.
 *
 * Does NOT publish to npm — that's the existing release workflow's job
 * once the PR merges. This sub gets the change set into a single
 * reviewable PR with the cross-cutting message.
 *
 * Per memory [Sage Slack→harness migration] commit lessons: do NOT
 * hardcode a path list. Use `git add -u` for modifications + explicit
 * NEW files only. The new files added by 01-05:
 *   - packages/harness/src/idempotency-guard.ts (+ test)
 *   - packages/harness/src/tools/github-public-fetcher.ts (+ test)
 *   - packages/harness/src/tools/github-public-review-tool-registry.ts (+ test)
 *   - packages/harness/src/tool-evidence-clarification.test.ts (if newly created)
 *   - packages/harness/src/adapter/openrouter-model-adapter.error-codes.test.ts
 */

async function runWorkflow() {
  const result = await workflow('improve-harness-primitives-06-publish-pr')
    .description(
      'Final cross-cutting lead review of @agent-assistant/harness primitives, single commit, push, open PR.',
    )
    .pattern('dag')
    .channel('wf-aa-harness-06')
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
      command: 'git diff --stat HEAD; echo ---; git log --oneline origin/main..HEAD || true',
      captureOutput: true,
      failOnError: true,
    })

    .step('full-test-suite', {
      type: 'deterministic',
      dependsOn: ['show-diff-stat'],
      command:
        'npx vitest run packages/harness/ 2>&1 | tail -50 && echo --- && ' +
        'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-review', {
      agent: 'lead',
      dependsOn: ['full-test-suite'],
      task: `Review the FULL diff via: git diff origin/main...HEAD -- packages/harness/

Required pass criteria for the consolidated change set:

1. excludeToolNames option:
   - ToolEvidenceClarificationOptions.excludeToolNames is OPTIONAL.
   - Excluded tool with empty result returns null. With explicit clarification metadata still surfaces.

2. createIdempotencyGuard:
   - listAvailable is passthrough.
   - 2nd identical call within a turn returns code='redundant_call_blocked', retryable=false.
   - Different turn id is NOT blocked.
   - inner.execute exceptions propagate (not swallowed); cache not poisoned by exceptions.
   - Stable stringify handles nested object key ordering.

3. GitHubPublicFetcher + createGitHubPublicReviewToolRegistry:
   - Uses globalThis.fetch (NOT a top-level fetch import). Grep: \`grep -n "import.*fetch" packages/harness/src/tools/github-public-fetcher.ts\` should not match.
   - Every Response body is consumed or cancelled.
   - 404 → code='not_found', 403+ratelimit → code='rate_limited'.
   - owner/repo regex validation BEFORE any fetch.
   - README truncation with stable marker.
   - retryable=true ONLY for rate_limited.

4. Three prompt fragments:
   - DRILL_IN_DISCIPLINE_CLAUSE, TOOL_INPUT_SHAPE_REMINDER_CLAUSE, EXTERNAL_REPO_STEER_CLAUSE exported.
   - TOOL_DISCIPLINE_CLAUSES is a 3-element readonly array.
   - HALLUCINATION_PREVENTION_CLAUSES untouched.

5. HarnessInvalidOutputCode:
   - Type added to types.ts and re-exported from index.ts.
   - Existing kind values unchanged.
   - OpenRouter adapter populates code at every invalidOutput call site.
   - Body-text classification (credits / context-length) runs before status fallback.

6. Cross-cutting:
   - All five primitives exported from packages/harness/src/index.ts.
   - One minor version bump on packages/harness/package.json (cumulative across all five — final version is one minor above the version on origin/main).
   - No drive-by edits to memory package, vfs package, or unrelated harness files.
   - No leftover console.log / .skip / .only.
   - Tests cover happy + edge + failure paths.

If anything is wrong, fix directly. Then re-run:
  npx vitest run packages/harness/
  cd packages/harness && npx tsc --noEmit`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })

    .step('post-review-tests', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/harness/ 2>&1 | tail -50 && echo --- && ' +
        'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .step('commit', {
      type: 'deterministic',
      dependsOn: ['post-review-tests'],
      // Idempotent: if a prior run already committed (resume scenario, or
      // a sub already committed its own work), staging produces nothing
      // and we skip the commit + log "already committed". Only fails when
      // there's truly nothing to ship — no staged changes AND no commits
      // ahead of origin/main.
      //
      // git add -u catches modifications. New files added via subshells so
      // `|| true` only catches the individual `git add` failure, not the
      // preceding `git add -u`. Per Devin review on PR #69: bash treats
      // `&& ... || true` as left-associative `(A && B) || true`, which
      // would silently swallow a failure of `git add -u` and produce an
      // incomplete commit missing all modifications.
      command: [
        'set -e',
        'mkdir -p tmp',
        // Write the commit message to a file so we don't have to fight
        // shell-quoting with single quotes inside the workflow string.
        "cat > tmp/aa-harness-commit-msg.txt <<'COMMITMSG'",
        'feat(harness): clarification exclude-tools, idempotency guard, github-public-review tool, tool-discipline prompt fragments, openrouter error codes',
        '',
        'Five primitives lifted from sage Slack-bot failure-mode fixes (sage PR #155). Each is general harness-runtime concern that any consumer benefits from. excludeToolNames on createToolEvidenceClarificationHook so read-only tools (memory_recall) skip the empty-result clarification path. createIdempotencyGuard registry wrapper blocks the 2nd identical (name + input) tool call within a turn with a structured redundant_call_blocked error pointing at consumer-supplied drill-in alternatives. GitHubPublicFetcher + createGitHubPublicReviewToolRegistry expose unauthenticated public-repo readme/package.json/top-level/recent-commits via a github_public_review tool — closes the cross-org external-repo review use case. Three new prompt fragments (DRILL_IN_DISCIPLINE_CLAUSE, TOOL_INPUT_SHAPE_REMINDER_CLAUSE, EXTERNAL_REPO_STEER_CLAUSE) plus a TOOL_DISCIPLINE_CLAUSES bundle co-located with HALLUCINATION_PREVENTION_CLAUSES. HarnessInvalidOutputCode adds a stable subcode (credits_exhausted / rate_limited / timeout / invalid_request / context_length_exceeded / model_not_found / auth_failed / unknown) populated by the OpenRouter adapter so consumers can switch on a machine-readable code instead of substring-matching reason. All additive; existing signatures and field shapes unchanged. Single minor bump on @agent-assistant/harness.',
        'COMMITMSG',
        // Stage modifications and any new files.
        'git add -u packages/harness/',
        '(git add packages/harness/src/idempotency-guard.ts packages/harness/src/idempotency-guard.test.ts || true)',
        '(git add packages/harness/src/tools/github-public-fetcher.ts packages/harness/src/tools/github-public-fetcher.test.ts || true)',
        '(git add packages/harness/src/tools/github-public-review-tool-registry.ts packages/harness/src/tools/github-public-review-tool-registry.test.ts || true)',
        '(git add packages/harness/src/tool-evidence-clarification.test.ts || true)',
        '(git add packages/harness/src/adapter/openrouter-model-adapter.error-codes.test.ts || true)',
        'git status --short',
        // Decide: commit, skip, or fail.
        'if git diff --cached --quiet; then',
        '  ahead=$(git rev-list --count origin/main..HEAD)',
        '  if [ "$ahead" -gt 0 ]; then',
        '    echo "[commit] nothing to stage; HEAD is $ahead commit(s) ahead of origin/main — assuming prior run already committed. Skipping commit."',
        '  else',
        '    echo "[commit] FATAL: nothing staged AND no commits ahead of origin/main. The workflow produced no changes — failing loudly."',
        '    exit 1',
        '  fi',
        'else',
        '  git commit -F tmp/aa-harness-commit-msg.txt',
        'fi',
      ].join('\n'),
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
      command: `mkdir -p tmp && cat > tmp/aa-harness-pr-body.md <<'PRBODY'
## Summary

Five primitives lifted upstream from sage's Slack-bot failure-mode fixes (sage PR #155). Each was a sage-side workaround for something general enough that any \`@agent-assistant/harness\` consumer would re-invent. Pulling them upstream lets sage drop its local copies in a follow-up adoption PR.

## Primitives

### 1. \`excludeToolNames\` on \`createToolEvidenceClarificationHook\`

Adds an opt-out list of tool names that should NEVER trigger the implicit empty-result / ambiguous / transient-error clarification path. Useful for read-only tools (\`memory_recall\`, \`workspace_list\`) where empty results are normal.

Explicit clarification hints on the tool result itself (\`result.metadata.clarification\`) are still respected — exclusion only suppresses the implicit classifier path.

### 2. \`createIdempotencyGuard(inner, options?)\`

Registry wrapper that blocks the 2nd identical \`(name + JSON.stringify(input))\` tool call within a turn. Returns a structured \`redundant_call_blocked\` error with consumer-configured drill-in alternatives. Catches the pattern where models interleave identical \`workspace_search\` calls between other tools to dodge consecutive-loop detectors.

\`\`\`ts
const wrapped = createIdempotencyGuard(myRegistry, {
  alternativesFor: (call) => [
    'Drill into the top result with workspace_read',
    'Refine the query with a path filter',
  ],
  maxTurns: 50,
});
\`\`\`

### 3. \`GitHubPublicFetcher\` + \`createGitHubPublicReviewToolRegistry\`

Unauthenticated \`api.github.com\` fetcher. Pulls README + \`package.json\` + top-level layout + recent commits for any public repo. Exposed as a single \`github_public_review({ owner, repo })\` tool.

Closes the cross-org external-repo review use case — "review montanaflynn/headless-terminal vs ours" — which authenticated tools (\`github_specialist\`, \`workspace_search\`) can't answer.

Cloudflare Workers safe (\`globalThis.fetch\`, every Response consumed or cancelled).

### 4. Tool-discipline prompt fragments

Three new exports next to \`HALLUCINATION_PREVENTION_CLAUSES\`:

- \`DRILL_IN_DISCIPLINE_CLAUSE\` — drill into the result you got, don't re-issue the same enumeration query.
- \`TOOL_INPUT_SHAPE_REMINDER_CLAUSE\` — tool input schemas describe SHAPE, not VALUE; don't pass schema descriptions as values.
- \`EXTERNAL_REPO_STEER_CLAUSE\` — for external public repos, use \`github_public_review\`, not \`github_specialist\` / \`workspace_search\`.

Plus a \`TOOL_DISCIPLINE_CLAUSES\` bundle for "include all three".

### 5. \`HarnessInvalidOutputCode\` + OpenRouter adapter wiring

New optional \`code\` field on \`HarnessInvalidOutput\` populated by the OpenRouter adapter:

\`\`\`ts
type HarnessInvalidOutputCode =
  | 'credits_exhausted'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_request'
  | 'context_length_exceeded'
  | 'model_not_found'
  | 'auth_failed'
  | 'unknown';
\`\`\`

Lets consumers \`switch (output.code)\` instead of substring-matching the free-text \`reason\`. Body-text classification (e.g. "out of credits", "context length") wins over status-based fallback so the credits-exhausted case classifies correctly regardless of HTTP code.

\`kind\` (transient / provider_error) and \`reason\` are unchanged.

## Backwards compatibility

- All five changes are additive: new optional fields, new opt-in factories, new exports.
- Existing function signatures unchanged. Existing field shapes unchanged. Existing prompt fragments unchanged.
- Single minor bump on \`@agent-assistant/harness\`.

## Test plan

- [x] \`npx vitest run packages/harness/\` — green.
- [x] \`cd packages/harness && npx tsc --noEmit\` — clean.
- [x] Each primitive has happy / edge / failure-path tests.
- [x] OpenRouter adapter classification covers 401/403/404/408/429/500 + body-text overrides for credits & context-length.
- [x] \`grep "import.*fetch" packages/harness/src/tools/github-public-fetcher.ts\` returns nothing (Cloudflare Workers safe).

## Followups

- Sage adoption (separate PR in the sage repo) — drops the local \`withRedundantCallGuard\`, the local clarification wrapper that filters memory_recall, the local \`GitHubPublicFetcher\`, the inlined prompt-extension strings, and the substring-matching \`getUserFacingErrorMessage\` in favor of these upstream exports.
- Consider per-call-id (vs name+input) keying as a future option on \`createIdempotencyGuard\` for tools that have side effects.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
wc -l tmp/aa-harness-pr-body.md`,
      captureOutput: true,
      failOnError: true,
    })

    .step('open-pr', {
      type: 'deterministic',
      dependsOn: ['write-pr-body'],
      // Idempotent against re-runs / resumes: if a PR already exists for
      // the current branch, print its URL and update the body instead of
      // failing with "a pull request for branch X already exists".
      command: [
        'set -e',
        'branch=$(git rev-parse --abbrev-ref HEAD)',
        'existing=$(gh pr list --head "$branch" --json url --jq ".[0].url" 2>/dev/null || true)',
        'if [ -n "$existing" ] && [ "$existing" != "null" ]; then',
        '  echo "[open-pr] PR already exists for $branch — updating body."',
        '  gh pr edit "$existing" --body-file tmp/aa-harness-pr-body.md > /dev/null',
        '  echo "PR: $existing"',
        'else',
        '  PR_URL=$(gh pr create --title "feat(harness): clarification exclude-tools, idempotency guard, github-public-review, prompt fragments, openrouter error codes" --body-file tmp/aa-harness-pr-body.md)',
        '  echo "PR: $PR_URL"',
        'fi',
      ].join('\n'),
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
