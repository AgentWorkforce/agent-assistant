import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-publish-runtime-core-followup')
    .description('Validate the next runtime-core publish posture after landing harness and turn-context so release infrastructure, package readiness, and consumer expectations stay aligned.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-publish-runtime-core-followup')
    .maxConcurrency(3)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Assesses runtime-core release posture after harness and turn-context landed and publish.yml was matrix-refactored.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the runtime-core publish follow-up for release-risk clarity and exact publish recommendations.',
      retries: 1,
    })

    .step('read-publish-followup-context', {
      type: 'deterministic',
      command: [
        'echo "---PUBLISH WORKFLOW---"',
        'sed -n "1,360p" .github/workflows/publish.yml',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---ROOT PACKAGE---"',
        'sed -n "1,220p" package.json',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('assess-runtime-core-publish-posture', {
      agent: 'lead-claude',
      dependsOn: ['read-publish-followup-context'],
      task: `Assess the runtime-core publish posture after landing harness and turn-context.

{{steps.read-publish-followup-context.output}}

Write docs/architecture/runtime-core-publish-followup.md.

The output should say:
1. which packages must be published next for real consumer use
2. whether the current workflow now matches the intended runtime-core set
3. any remaining release risks before the next publish
4. exact recommended next release action

End with RUNTIME_CORE_PUBLISH_FOLLOWUP_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/runtime-core-publish-followup.md' },
    })

    .step('review-runtime-core-publish-posture', {
      agent: 'review-codex',
      dependsOn: ['assess-runtime-core-publish-posture'],
      task: `Review docs/architecture/runtime-core-publish-followup.md for clarity and release usefulness.
Append a short note if needed. End with RUNTIME_CORE_PUBLISH_FOLLOWUP_REVIEW_COMPLETE.`,
      verification: { type: 'output_contains', value: 'RUNTIME_CORE_PUBLISH_FOLLOWUP_REVIEW_COMPLETE' },
    })

    .step('verify-runtime-core-publish-followup', {
      type: 'deterministic',
      dependsOn: ['review-runtime-core-publish-posture'],
      command: [
        'test -f docs/architecture/runtime-core-publish-followup.md',
        'grep -q "RUNTIME_CORE_PUBLISH_FOLLOWUP_READY" docs/architecture/runtime-core-publish-followup.md',
        'echo "RUNTIME_CORE_PUBLISH_FOLLOWUP_VERIFIED"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
