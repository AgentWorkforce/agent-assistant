/**
 * Master workflow for improve-harness-primitives.
 *
 * Lifts five primitives discovered while fixing sage's recurring
 * Slack-bot failure modes (sage PR #155). Each currently lives sage-side
 * but is general enough that any harness consumer would re-invent it.
 * Pulling them upstream lets sage drop its local copies in a follow-up
 * adoption PR (and gives future consumers a head start).
 *
 * The five primitives:
 *   01 — `excludeToolNames` option on `createToolEvidenceClarificationHook`
 *        (so consumers can exempt specific tools — e.g. memory_recall —
 *         from the empty-result clarification path without wrapping locally)
 *   02 — `createIdempotencyGuard(inner, options?)` — registry wrapper that
 *        blocks the 2nd identical tool call within a turn with a structured
 *        error pointing at drill-in alternatives
 *   03 — `GitHubPublicFetcher` + `createGitHubPublicReviewToolRegistry` —
 *        unauthenticated public-repo readme/package.json/top-level/commits
 *        fetcher exposed as a `github_public_review` tool
 *   04 — Three new prompt fragments: `DRILL_IN_DISCIPLINE_CLAUSE`,
 *        `TOOL_INPUT_SHAPE_REMINDER_CLAUSE`, `EXTERNAL_REPO_STEER_CLAUSE`
 *   05 — Typed `OpenRouterError.code` enum
 *        ('credits_exhausted' | 'rate_limited' | 'timeout' |
 *         'invalid_request' | 'unknown') so consumers can switch on a
 *        machine-readable code instead of string-matching .message
 *
 * Mirrors `workflows/improve-memory-primitives/00-execute.ts`: applies
 * `applyAgentAssistantRepoSetup` ONCE for the whole run, then runs each
 * sub-workflow as a deterministic shell step that inherits the master's
 * worktree. Subs do NOT need their own setup helper because they execute
 * in the same working directory the master prepared.
 *
 * Per memory [agent-relay run exit code]: each sub-shell-step greps log
 * for "Workflow status: failed" AND checks pipeline exit via PIPESTATUS,
 * because the runner can exit 0 even when the inner workflow fails.
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { mkdirSync } from 'node:fs';

import { applyAgentAssistantRepoSetup } from '../lib/agent-assistant-repo-setup.ts';

const BRANCH = 'feat/improve-harness-primitives';
const LOG_DIR = 'logs/improve-harness-primitives-master';

// Wrapped in bash -c '...' (SINGLE quotes) because cloud /bin/sh is dash,
// which doesn't support ${PIPESTATUS[0]}. Single quotes prevent sh from
// expanding $status / ${PIPESTATUS[0]} before bash sees them.
const SUB = (file: string) => {
  const logPath = `${LOG_DIR}/${file}.log`;
  const script = [
    `set -o pipefail`,
    `agent-relay run workflows/improve-harness-primitives/${file} 2>&1 | tee ${logPath}`,
    `status=\${PIPESTATUS[0]}`,
    `if [ "$status" -ne 0 ]; then echo "SUB_WORKFLOW_EXIT_NONZERO: $status"; exit $status; fi`,
    `if grep -q "Workflow status: failed" ${logPath}; then echo "SUB_WORKFLOW_REPORTED_FAILED"; exit 1; fi`,
    `echo "SUB_WORKFLOW_OK: ${file}"`,
  ].join('; ');
  return `bash -c '${script}'`;
};

async function main() {
  mkdirSync(LOG_DIR, { recursive: true });

  const baseWf = workflow('aa-improve-harness-primitives-master')
    .description(
      'Master — setup-branch + install-deps via shared helper, then 01 → 02 → 03 → 04 → 05 → 06 sequentially. 06 commits + opens PR.',
    )
    .pattern('dag')
    .channel('wf-aa-improve-harness-primitives-master')
    .maxConcurrency(2)
    .timeout(7_200_000); // 2h

  // ─── Phase 0: Setup branch + deps (shared helper) ───────
  // Per workflows/AGENTS.md, this is where setup-branch and install-deps
  // land. Subs run as deterministic shell steps below and inherit this
  // working directory.
  const wf = applyAgentAssistantRepoSetup(baseWf, {
    branch: BRANCH,
    committerName: 'Harness Primitives Bot',
  });

  const result = await wf
    .step('sub-01-clarification-exclude-tools', {
      type: 'deterministic',
      dependsOn: ['install-deps'],
      command: SUB('01-clarification-exclude-tools.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('sub-02-idempotency-guard', {
      type: 'deterministic',
      dependsOn: ['sub-01-clarification-exclude-tools'],
      command: SUB('02-idempotency-guard.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('sub-03-github-public-review', {
      type: 'deterministic',
      dependsOn: ['sub-02-idempotency-guard'],
      command: SUB('03-github-public-review.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('sub-04-prompt-fragments', {
      type: 'deterministic',
      dependsOn: ['sub-03-github-public-review'],
      command: SUB('04-prompt-fragments.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('sub-05-openrouter-error-codes', {
      type: 'deterministic',
      dependsOn: ['sub-04-prompt-fragments'],
      command: SUB('05-openrouter-error-codes.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('sub-06-publish-pr', {
      type: 'deterministic',
      dependsOn: ['sub-05-openrouter-error-codes'],
      command: SUB('06-publish-pr.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
  if (result.status === 'failed') process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
