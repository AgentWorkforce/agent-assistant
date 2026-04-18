import { workflow } from '@agent-relay/sdk/workflows';

// Master executor:
//   Wave 1 (parallel): build OpenRouter model adapter + Bash tool registry
//   Wave 2: integrate (wire exports, regression, version bump, commit, PR)
//
// Each sub-workflow operates on the same cwd so file changes accumulate
// in the worktree across waves.

async function runWorkflow() {
  const result = await workflow('master-build-harness-primitives')
    .description(
      'Master executor: builds the OpenRouter model adapter and Bash tool registry in parallel (wave 1), then integrates and opens a PR (wave 2). All sub-workflows operate in the same cwd.',
    )
    .pattern('dag')
    .channel('wf-master-build-harness-primitives')
    .maxConcurrency(2)
    .timeout(7_200_000)

    .step('preflight', {
      type: 'deterministic',
      command: [
        'echo "Master executor starting in $(pwd)"',
        'test -f packages/harness/package.json || (echo "Not in agent-assistant repo root"; exit 1)',
        'test -f workflows/build-harness-openrouter-model-adapter.ts || (echo "Missing wave 1a workflow file"; exit 1)',
        'test -f workflows/build-harness-bash-tool-registry.ts || (echo "Missing wave 1b workflow file"; exit 1)',
        'test -f workflows/integrate-harness-primitives-and-pr.ts || (echo "Missing wave 2 workflow file"; exit 1)',
        'command -v agent-relay >/dev/null || (echo "agent-relay CLI not on PATH"; exit 1)',
        'command -v gh >/dev/null || (echo "gh CLI not on PATH"; exit 1)',
        'echo "Preflight OK"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Wave 1 (parallel): two independent builds ────────────────────
    .step('wave1-openrouter-model-adapter', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command:
        'LOG=$(mktemp) && agent-relay run workflows/build-harness-openrouter-model-adapter.ts > "$LOG" 2>&1; STATUS=$?; tail -200 "$LOG"; if [ "$STATUS" -ne 0 ] || grep -q "Workflow status: failed" "$LOG"; then echo "WAVE 1A FAILED"; exit 1; fi; echo "WAVE 1A OK"',
      captureOutput: true,
      failOnError: true,
    })

    .step('wave1-bash-tool-registry', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command:
        'LOG=$(mktemp) && agent-relay run workflows/build-harness-bash-tool-registry.ts > "$LOG" 2>&1; STATUS=$?; tail -200 "$LOG"; if [ "$STATUS" -ne 0 ] || grep -q "Workflow status: failed" "$LOG"; then echo "WAVE 1B FAILED"; exit 1; fi; echo "WAVE 1B OK"',
      captureOutput: true,
      failOnError: true,
    })

    // ── Wave 2: integration + PR ─────────────────────────────────────
    .step('wave2-integrate-and-pr', {
      type: 'deterministic',
      dependsOn: ['wave1-openrouter-model-adapter', 'wave1-bash-tool-registry'],
      command:
        'LOG=$(mktemp) && agent-relay run workflows/integrate-harness-primitives-and-pr.ts > "$LOG" 2>&1; STATUS=$?; tail -300 "$LOG"; if [ "$STATUS" -ne 0 ] || grep -q "Workflow status: failed" "$LOG"; then echo "WAVE 2 FAILED"; exit 1; fi; echo "WAVE 2 OK"',
      captureOutput: true,
      failOnError: true,
    })

    .step('summary', {
      type: 'deterministic',
      dependsOn: ['wave2-integrate-and-pr'],
      command:
        'echo "=== HARNESS PRIMITIVES MIGRATION COMPLETE ===" && echo "PR:" && gh pr view --json url --jq .url 2>&1 || echo "(PR URL unavailable)"',
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
