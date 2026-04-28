/**
 * Master workflow for improve-memory-primitives.
 *
 * Mirrors the proactive-signals master pattern: applies
 * `applyAgentAssistantRepoSetup` ONCE for the whole run (setup-branch +
 * install-deps + workspace build), then runs each sub-workflow as a
 * deterministic shell step that inherits the master's worktree. Subs do
 * NOT need their own setup helper because they execute in the same
 * working directory the master prepared.
 *
 * This satisfies `workflows/AGENTS.md` ("every cloud-sandboxed workflow
 * that produces code changes MUST use the shared setup helper") at the
 * orchestration layer — the same pattern proactive-signals/00-master.ts
 * uses. Per Devin/codex review on PR #68 (comment IDs 3151086913,
 * 3151086941, 3151106923, 3151413279).
 *
 * Subs (run in order; final sub commits + opens PR):
 *   01 — @agent-assistant/memory primitives (formatRelativeAge,
 *        renderTurnMemoryContext, structured logs, content-hash, query
 *        plumbing, scope load constants)
 *   02 — @agent-assistant/harness memory tool registry
 *        (createMemoryToolRegistry exposing memory_remember/recall/forget)
 *   04 — Loosen redundant-tool-loop detector + large-output advisory
 *   03 — Final review, commit, push, open PR
 *
 * Per memory [agent-relay run exit code]: each sub-shell-step greps log
 * for "Workflow status: failed" AND checks pipeline exit via PIPESTATUS,
 * because the runner can exit 0 even when the inner workflow fails.
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { mkdirSync } from 'node:fs';

import { applyAgentAssistantRepoSetup } from '../lib/agent-assistant-repo-setup.ts';

const BRANCH = 'feat/memory-primitives-and-harness-tools';
const LOG_DIR = 'logs/improve-memory-primitives-master';

// Wrapped in bash -c '...' (SINGLE quotes) because cloud /bin/sh is dash,
// which doesn't support ${PIPESTATUS[0]}. Single quotes prevent sh from
// expanding $status / ${PIPESTATUS[0]} before bash sees them. Same
// rationale as proactive-signals/00-master.ts.
const SUB = (file: string) => {
  const logPath = `${LOG_DIR}/${file}.log`;
  const script = [
    `set -o pipefail`,
    `agent-relay run workflows/improve-memory-primitives/${file} 2>&1 | tee ${logPath}`,
    `status=\${PIPESTATUS[0]}`,
    `if [ "$status" -ne 0 ]; then echo "SUB_WORKFLOW_EXIT_NONZERO: $status"; exit $status; fi`,
    `if grep -q "Workflow status: failed" ${logPath}; then echo "SUB_WORKFLOW_REPORTED_FAILED"; exit 1; fi`,
    `echo "SUB_WORKFLOW_OK: ${file}"`,
  ].join('; ');
  return `bash -c '${script}'`;
};

async function main() {
  mkdirSync(LOG_DIR, { recursive: true });

  const baseWf = workflow('aa-improve-memory-primitives-master')
    .description(
      'Master — setup-branch + install-deps via shared helper, then 01 → 02 → 04 → 03 sequentially. 03 commits + opens PR.',
    )
    .pattern('dag')
    .channel('wf-aa-improve-memory-primitives-master')
    .maxConcurrency(2)
    .timeout(7_200_000); // 2h

  // ─── Phase 0: Setup branch + deps (shared helper) ───────
  // Per workflows/AGENTS.md and the proactive-signals reference pattern,
  // this is where setup-branch and install-deps land. Subs run as
  // deterministic shell steps below and inherit this working directory.
  const wf = applyAgentAssistantRepoSetup(baseWf, {
    branch: BRANCH,
    committerName: 'Memory Primitives Bot',
  });

  const result = await wf
    .step('sub-01-memory-package', {
      type: 'deterministic',
      dependsOn: ['install-deps'],
      command: SUB('01-memory-package.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('sub-02-harness-memory-tools', {
      type: 'deterministic',
      dependsOn: ['sub-01-memory-package'],
      command: SUB('02-harness-memory-tools.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('sub-04-loosen-detector', {
      type: 'deterministic',
      dependsOn: ['sub-02-harness-memory-tools'],
      command: SUB('04-loosen-detector-and-large-output-advisory.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('sub-03-publish-pr', {
      type: 'deterministic',
      dependsOn: ['sub-04-loosen-detector'],
      command: SUB('03-publish-pr.ts'),
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
