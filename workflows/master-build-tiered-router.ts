import { workflow } from '@agent-relay/sdk/workflows';

// Master executor for tiered router primitives:
//   Wave 1: types + SingleShotAdapter (must complete before tiered-runner)
//   Wave 2: createTieredRunner (depends on wave 1's types)
//   Wave 3: integrate exports + regression + version bump + PR
//
// Each sub-workflow runs in the same cwd so file changes accumulate
// in the worktree across waves.

async function runWorkflow() {
  const result = await workflow('master-build-tiered-router')
    .description(
      'Master executor: builds Router/SingleShotAdapter types + OpenRouterSingleShotAdapter (wave 1), then createTieredRunner (wave 2, depends on wave 1 types), then integrates and opens a PR (wave 3).',
    )
    .pattern('dag')
    .channel('wf-master-build-tiered-router')
    .maxConcurrency(2)
    .timeout(7_200_000)

    .step('preflight', {
      type: 'deterministic',
      command: [
        'echo "Master executor starting in $(pwd)"',
        'test -f packages/harness/package.json || (echo "Not in agent-assistant repo root"; exit 1)',
        'test -f workflows/build-router-types-and-singleshot.ts || (echo "Missing wave 1 workflow"; exit 1)',
        'test -f workflows/build-tiered-runner.ts || (echo "Missing wave 2 workflow"; exit 1)',
        'test -f workflows/integrate-tiered-router-and-pr.ts || (echo "Missing wave 3 workflow"; exit 1)',
        'command -v agent-relay >/dev/null || (echo "agent-relay CLI not on PATH"; exit 1)',
        'command -v gh >/dev/null || (echo "gh CLI not on PATH"; exit 1)',
        'echo "Preflight OK"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('wave1-router-types-and-singleshot', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command:
        'LOG=$(mktemp) && agent-relay run workflows/build-router-types-and-singleshot.ts > "$LOG" 2>&1; STATUS=$?; tail -300 "$LOG"; if [ "$STATUS" -ne 0 ] || grep -q "Workflow status: failed" "$LOG"; then echo "WAVE 1 FAILED"; exit 1; fi; echo "WAVE 1 OK"',
      captureOutput: true,
      failOnError: true,
    })

    .step('wave2-tiered-runner', {
      type: 'deterministic',
      dependsOn: ['wave1-router-types-and-singleshot'],
      command:
        'LOG=$(mktemp) && agent-relay run workflows/build-tiered-runner.ts > "$LOG" 2>&1; STATUS=$?; tail -300 "$LOG"; if [ "$STATUS" -ne 0 ] || grep -q "Workflow status: failed" "$LOG"; then echo "WAVE 2 FAILED"; exit 1; fi; echo "WAVE 2 OK"',
      captureOutput: true,
      failOnError: true,
    })

    .step('wave3-integrate-and-pr', {
      type: 'deterministic',
      dependsOn: ['wave2-tiered-runner'],
      command:
        'LOG=$(mktemp) && agent-relay run workflows/integrate-tiered-router-and-pr.ts > "$LOG" 2>&1; STATUS=$?; tail -300 "$LOG"; if [ "$STATUS" -ne 0 ] || grep -q "Workflow status: failed" "$LOG"; then echo "WAVE 3 FAILED"; exit 1; fi; echo "WAVE 3 OK"',
      captureOutput: true,
      failOnError: true,
    })

    .step('summary', {
      type: 'deterministic',
      dependsOn: ['wave3-integrate-and-pr'],
      command:
        'echo "=== TIERED ROUTER MIGRATION COMPLETE ===" && echo "PR:" && gh pr view --json url --jq .url 2>&1 || echo "(PR URL unavailable)"',
      captureOutput: true,
      failOnError: false,
    })

    .onError('fail-fast')
    .run({ cwd: process.cwd() });

  console.log('Master workflow status:', result.status);
}

runWorkflow().catch((error) => {
  console.error(error);
  process.exit(1);
});
