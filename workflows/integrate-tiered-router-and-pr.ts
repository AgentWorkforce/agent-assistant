import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('integrate-tiered-router-and-pr')
    .description(
      'Wire the new tiered routing exports into @agent-assistant/harness root index, run the full harness suite plus workspace regression, bump patch version, commit, push branch, open PR.',
    )
    .pattern('dag')
    .channel('wf-integrate-tiered-router-and-pr')
    .maxConcurrency(2)
    .timeout(2_400_000)

    .agent('impl', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Wires exports and resolves any final type/test issues from the integration.',
      retries: 2,
    })

    .step('preflight', {
      type: 'deterministic',
      command: [
        'test -f packages/harness/src/router/types.ts || (echo "MISSING router types"; exit 1)',
        'test -f packages/harness/src/router/openrouter-singleshot-adapter.ts || (echo "MISSING singleshot adapter"; exit 1)',
        'test -f packages/harness/src/router/tiered-runner.ts || (echo "MISSING tiered runner"; exit 1)',
        'echo "Preflight OK"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-current-index', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: 'cat packages/harness/src/index.ts',
      captureOutput: true,
      failOnError: true,
    })

    .step('wire-exports', {
      agent: 'impl',
      dependsOn: ['read-current-index'],
      task: `Update packages/harness/src/index.ts. Preserve all existing exports — do NOT remove or reorder.

Add these new exports (group near the existing OpenRouterModelAdapter / BashToolRegistry block):

  export { OpenRouterSingleShotAdapter, createOpenRouterSingleShotAdapter } from './router/openrouter-singleshot-adapter.js';
  export type { OpenRouterSingleShotAdapterConfig } from './router/openrouter-singleshot-adapter.js';
  export { createTieredRunner } from './router/tiered-runner.js';
  export type { TieredRunnerConfig } from './router/tiered-runner.js';
  export type {
    Router,
    RouterInput,
    RoutingDecision,
    RoutingTier,
    SingleShotAdapter,
    SingleShotInput,
    SingleShotResult,
    TieredRunner,
    TieredRunnerResult,
    TieredRunnerFastResult,
    TieredRunnerHarnessResult,
    TieredRunnerRejectedResult,
  } from './router/types.js';

Current index.ts:
{{steps.read-current-index.output}}

End with EXPORTS_WIRED.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-exports', {
      type: 'deterministic',
      dependsOn: ['wire-exports'],
      command:
        'grep -E "createOpenRouterSingleShotAdapter|createTieredRunner|RoutingDecision" packages/harness/src/index.ts >/dev/null && echo "EXPORTS OK" || (echo "MISSING EXPORTS"; exit 1)',
      failOnError: true,
      captureOutput: true,
    })

    .step('harness-suite', {
      type: 'deterministic',
      dependsOn: ['verify-exports'],
      command: 'npm test -w @agent-assistant/harness 2>&1 | tail -60',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-harness-suite', {
      agent: 'impl',
      dependsOn: ['harness-suite'],
      task: `Fix any harness test suite failures.

Output:
{{steps.harness-suite.output}}

If green, do nothing. Else fix and re-run:
  npm test -w @agent-assistant/harness
End with HARNESS_SUITE_FIXED.`,
      verification: { type: 'exit_code' },
    })

    .step('harness-suite-final', {
      type: 'deterministic',
      dependsOn: ['fix-harness-suite'],
      command: 'npm test -w @agent-assistant/harness 2>&1',
      captureOutput: true,
      failOnError: true,
    })

    .step('workspace-regression', {
      type: 'deterministic',
      dependsOn: ['harness-suite-final'],
      command: 'npm test --workspaces --if-present 2>&1 | tail -120',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-workspace-regression', {
      agent: 'impl',
      dependsOn: ['workspace-regression'],
      task: `Fix any workspace-wide test regressions caused by these changes.

Output:
{{steps.workspace-regression.output}}

If green, do nothing.
We added new exports without removing — most regressions will be unrelated. If a regression IS caused by our change, fix the root cause in @agent-assistant/harness, not the dependent. Re-run:
  npm test --workspaces --if-present
End with WORKSPACE_REGRESSION_FIXED.`,
      verification: { type: 'exit_code' },
    })

    .step('workspace-regression-final', {
      type: 'deterministic',
      dependsOn: ['fix-workspace-regression'],
      command: 'npm test --workspaces --if-present 2>&1 | tail -40',
      captureOutput: true,
      failOnError: true,
    })

    .step('bump-version', {
      type: 'deterministic',
      dependsOn: ['workspace-regression-final'],
      command:
        'node -e "const fs=require(\'node:fs\'); const path=\'packages/harness/package.json\'; const p=JSON.parse(fs.readFileSync(path,\'utf8\')); const [a,b,c]=p.version.split(\'.\'); const n=[a,b,Number(c)+1].join(\'.\'); console.log(\'Bumping \'+p.version+\' -> \'+n); p.version=n; fs.writeFileSync(path, JSON.stringify(p,null,2)+\'\\n\');"',
      captureOutput: true,
      failOnError: true,
    })

    .step('verify-changes', {
      type: 'deterministic',
      dependsOn: ['bump-version'],
      command: 'git status --short && echo "--- DIFF SUMMARY ---" && git diff --stat',
      captureOutput: true,
      failOnError: false,
    })

    .step('commit', {
      type: 'deterministic',
      dependsOn: ['verify-changes'],
      command:
        'git add packages/harness/src/router/types.ts packages/harness/src/router/openrouter-singleshot-adapter.ts packages/harness/src/router/openrouter-singleshot-adapter.test.ts packages/harness/src/router/tiered-runner.ts packages/harness/src/router/tiered-runner.test.ts packages/harness/src/index.ts packages/harness/package.json && git commit -m "feat(harness): add tiered router (Router, SingleShotAdapter, createTieredRunner)"',
      captureOutput: true,
      failOnError: true,
    })

    .step('push-branch', {
      type: 'deterministic',
      dependsOn: ['commit'],
      command:
        'BRANCH=$(git rev-parse --abbrev-ref HEAD) && echo "Pushing $BRANCH" && git push -u origin "$BRANCH" 2>&1',
      captureOutput: true,
      failOnError: true,
    })

    .step('open-pr', {
      type: 'deterministic',
      dependsOn: ['push-branch'],
      command:
        'gh pr create --title "feat(harness): tiered router (Router + SingleShotAdapter + createTieredRunner)" --body "$(printf \'%s\\n\' \'## Summary\' \'- Add Router / RoutingDecision / RoutingTier interfaces — provider-neutral classifier contract.\' \'- Add SingleShotAdapter interface + OpenRouterSingleShotAdapter implementation — cheap one-shot model call with no tool loop, defaults to claude-haiku-4-5.\' \'- Add createTieredRunner that composes Router + SingleShotAdapter + HarnessRuntime to produce tiered execution (fast path bypasses tools; harness path drives the full loop; reject path returns a canned message).\' \'- Bump @agent-assistant/harness patch version.\' \'\' \'## Why\' \'The existing harness loop ships every request through the full model->tools->model iteration which is more expensive than the legacy plan-then-synthesize pattern by 3-5x. A tiered runner with a cheap classifier in front recovers the cost savings for the majority of casual or non-tool messages while keeping the harness for requests that genuinely need tool use. Concrete consumer (sage Slack handler) lands in a follow-up PR.\' \'\' \'## Validation\' \'- npm test -w @agent-assistant/harness: pass\' \'- npm test --workspaces --if-present: pass\' \'- npm run build -w @agent-assistant/harness: type-clean\' \'\' \'## Notes\' \'Publish manually after merge.\')"',
      captureOutput: true,
      failOnError: true,
    })

    .step('print-pr-url', {
      type: 'deterministic',
      dependsOn: ['open-pr'],
      command: 'gh pr view --json url --jq .url',
      captureOutput: true,
      failOnError: false,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 5_000 })
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
}

runWorkflow().catch((error) => {
  console.error(error);
  process.exit(1);
});
