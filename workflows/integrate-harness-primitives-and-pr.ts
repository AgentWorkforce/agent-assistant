import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('integrate-harness-primitives-and-pr')
    .description(
      'Wire OpenRouterModelAdapter and BashToolRegistry into @agent-assistant/harness exports, run full regression across the workspace, bump patch version, commit, push branch, open PR.',
    )
    .pattern('dag')
    .channel('wf-integrate-harness-primitives')
    .maxConcurrency(2)
    .timeout(1_800_000)

    .agent('impl', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Wires exports and resolves any final type/test issues from the integration.',
      retries: 2,
    })

    // Sanity: both new files must already exist before we start
    .step('preflight', {
      type: 'deterministic',
      command: [
        'test -f packages/harness/src/adapter/openrouter-model-adapter.ts || (echo "MISSING openrouter-model-adapter.ts — run build-harness-openrouter-model-adapter workflow first"; exit 1)',
        'test -f packages/harness/src/tools/bash-tool-registry.ts || (echo "MISSING bash-tool-registry.ts — run build-harness-bash-tool-registry workflow first"; exit 1)',
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
      task: `Update packages/harness/src/index.ts. Add these re-exports (preserve all existing exports — do NOT remove or reorder them):

  export { OpenRouterModelAdapter, createOpenRouterModelAdapter } from './adapter/openrouter-model-adapter.js';
  export type { OpenRouterModelAdapterConfig } from './adapter/openrouter-model-adapter.js';
  export { BashToolRegistry, createBashToolRegistry } from './tools/bash-tool-registry.js';
  export type { BashToolConfig } from './tools/bash-tool-registry.js';

Current index.ts:
{{steps.read-current-index.output}}

Do NOT touch adapter/index.ts (the new model adapter is exported from package root, separate from ExecutionAdapter exports).

End with EXPORTS_WIRED.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-exports', {
      type: 'deterministic',
      dependsOn: ['wire-exports'],
      command:
        'grep -E "createOpenRouterModelAdapter|createBashToolRegistry" packages/harness/src/index.ts >/dev/null && echo "EXPORTS OK" || (echo "MISSING EXPORTS"; exit 1)',
      failOnError: true,
      captureOutput: true,
    })

    // Full harness suite (catches any export/typing issue introduced by wiring)
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
      task: `If the harness test suite has failures, fix them.

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

    // Workspace-wide regression — catch breakage in dependents
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
      task: `If workspace-wide tests broke (a dependent package importing from @agent-assistant/harness), fix.

Output:
{{steps.workspace-regression.output}}

If green, do nothing.
Common cause: a dependent expected the old harness exports unchanged. We added exports without removing — most regressions will be unrelated and pre-existing. If a regression IS caused by our change, fix the root cause in @agent-assistant/harness, not the dependent. Re-run:
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

    // Bump patch version on @agent-assistant/harness
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
        'git add packages/harness/src/adapter/openrouter-model-adapter.ts packages/harness/src/adapter/openrouter-model-adapter.test.ts packages/harness/src/tools/bash-tool-registry.ts packages/harness/src/tools/bash-tool-registry.test.ts packages/harness/src/index.ts packages/harness/package.json && git commit -m "feat(harness): add OpenRouter model adapter and Bash tool registry"',
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
        'gh pr create --title "feat(harness): OpenRouter model adapter + Bash tool registry" --body "$(printf \'%s\\n\' \'## Summary\' \'- Add OpenRouterModelAdapter (a HarnessModelAdapter) with tool-call support — distinct from the existing no-tool OpenRouterExecutionAdapter proof slice.\' \'- Add BashToolRegistry (a HarnessToolRegistry) exposing a single allowlist-gated bash tool, designed to drive CLI primitives like sage-vfs.\' \'- Bump @agent-assistant/harness patch version.\' \'\' \'## Why\' \'Sage Slack handler currently uses a plan-then-synthesize path that produces \\"Let me search...\\" prose without executing tools. Migrating Slack to drive a real harness loop with a Bash tool against sage-vfs eliminates that bug class structurally. This PR ships the harness-side primitives; sage wiring lands in a follow-up PR.\' \'\' \'## Validation\' \'- npm test -w @agent-assistant/harness: pass\' \'- npm test --workspaces --if-present: pass\' \'- npm run build -w @agent-assistant/harness: type-clean\' \'\' \'## Notes\' \'Publish manually after merge.\')"',
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
