/**
 * proactive-signals 00: Master executor
 *
 *   Phase 0: setup-branch + install-deps (via applyAgentAssistantRepoSetup)
 *   Wave 1 (parallel): 01 quiet-hours | 02 signal-inbox
 *                         │ both edit only packages/proactive, different files
 *                         ▼  barrier: packages/proactive rebuild
 *   Wave 2 (parallel): 03 slack-presence  | 04 github-signal
 *                         │ both depend on 02's ProactiveSignal type, edit surfaces
 *                         ▼  final: full workspace build + all tests
 *
 * Per memory [agent-relay run exit code]: sub-workflow step greps log for
 * "Workflow status: failed" AND checks exit status via pipefail.
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { mkdirSync } from 'node:fs';

import { applyAgentAssistantRepoSetup } from '../lib/agent-assistant-repo-setup.ts';

const BRANCH = 'feat/proactive-signals';
const LOG_DIR = 'logs/proactive-signals-master';

const SUB = (file: string) => `set -o pipefail; \
agent-relay run workflows/proactive-signals/${file} 2>&1 | tee ${LOG_DIR}/${file}.log; \
status=\${PIPESTATUS[0]}; \
if [ "$status" -ne 0 ]; then echo "SUB_WORKFLOW_EXIT_NONZERO: $status"; exit $status; fi; \
if grep -q "Workflow status: failed" ${LOG_DIR}/${file}.log; then echo "SUB_WORKFLOW_REPORTED_FAILED"; exit 1; fi; \
echo "SUB_WORKFLOW_OK: ${file}"`;

async function main() {
  mkdirSync(LOG_DIR, { recursive: true });

  const baseWf = workflow('aa-proactive-signals-master')
    .description('Master — runs 01+02 in parallel, then 03+04 in parallel, with build barriers')
    .pattern('dag')
    .channel('wf-aa-proactive-signals-master')
    .maxConcurrency(3)
    .timeout(7_200_000); // 2h

  // ─── Phase 0: Setup branch + deps (shared helper) ───────
  const wf = applyAgentAssistantRepoSetup(baseWf, {
    branch: BRANCH,
    committerName: 'Proactive Signals Bot',
  });

  const result = await wf
    // ── Wave 1: primitives in @agent-assistant/proactive ────
    .step('wave1-01-quiet-hours', {
      type: 'deterministic',
      dependsOn: ['install-deps'],
      command: SUB('01-quiet-hours.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('wave1-02-signal-inbox', {
      type: 'deterministic',
      dependsOn: ['install-deps'],
      command: SUB('02-signal-inbox.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('wave1-barrier-build', {
      type: 'deterministic',
      dependsOn: ['wave1-01-quiet-hours', 'wave1-02-signal-inbox'],
      command: 'cd packages/proactive && npm run build 2>&1 | tail -20 && echo WAVE1_PROACTIVE_BUILD_OK',
      failOnError: true,
    })

    // ── Wave 2: sources in @agent-assistant/surfaces ────────
    .step('wave2-03-slack-presence', {
      type: 'deterministic',
      dependsOn: ['wave1-barrier-build'],
      command: SUB('03-slack-presence-source.ts'),
      captureOutput: true,
      failOnError: true,
    })
    .step('wave2-04-github-signal', {
      type: 'deterministic',
      dependsOn: ['wave1-barrier-build'],
      command: SUB('04-github-signal-source.ts'),
      captureOutput: true,
      failOnError: true,
    })

    // ── Final barrier: workspace build + full vitest ────────
    .step('final-workspace-build', {
      type: 'deterministic',
      dependsOn: ['wave2-03-slack-presence', 'wave2-04-github-signal'],
      command: 'npm run build --workspaces --if-present 2>&1 | tail -20 && echo FINAL_BUILD_OK',
      failOnError: true,
    })
    .step('final-proactive-tests', {
      type: 'deterministic',
      dependsOn: ['final-workspace-build'],
      command: 'cd packages/proactive && npx vitest run 2>&1 | tail -20',
      failOnError: true,
    })
    .step('final-surfaces-tests', {
      type: 'deterministic',
      dependsOn: ['final-workspace-build'],
      command: 'cd packages/surfaces && npx vitest run 2>&1 | tail -20',
      failOnError: true,
    })

    .step('summary', {
      type: 'deterministic',
      dependsOn: ['final-proactive-tests', 'final-surfaces-tests'],
      command: `echo "=== proactive-signals master summary ==="; \
echo "Logs: ${LOG_DIR}/"; \
ls -la ${LOG_DIR}; \
echo; \
echo "Changed files:"; \
git status --short; \
echo DONE`,
      failOnError: false,
    })

    .onError('fail-fast')
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
  if (result.status !== 'completed') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
