import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-continue-top-level-sdk-facade-implementation')
    .description('Continue implementation of the top-level @agent-assistant/sdk facade from the already-produced implementation boundary, avoiding the previously wedged boundary step and focusing on package creation, docs/examples updates, and review proof.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-sdk-facade-impl-continue')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('implementer-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the top-level @agent-assistant/sdk facade from the saved implementation boundary and updates docs/examples accordingly.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the continued facade implementation for public ergonomics, modularity, and implementation readiness.',
      retries: 1,
    })

    .step('read-facade-impl-continuation-context', {
      type: 'deterministic',
      command: [
        'echo "---IMPLEMENTATION BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/top-level-sdk-facade-implementation-boundary.md',
        'echo "" && echo "---FACADE SPEC---"',
        'sed -n "1,320p" docs/architecture/top-level-sdk-facade-spec.md',
        'echo "" && echo "---FACADE IMPLEMENTATION PLAN---"',
        'sed -n "1,320p" docs/architecture/top-level-sdk-facade-implementation-plan.md',
        'echo "" && echo "---ADOPTION GUIDE---"',
        'sed -n "1,260p" docs/consumer/top-level-sdk-adoption-guide.md',
        'echo "" && echo "---PACKAGE MANIFESTS---"',
        'find packages -maxdepth 2 -name package.json -type f | sort | xargs -I{} sh -c "echo --- {}; sed -n \"1,220p\" {}"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-facade-from-boundary', {
      agent: 'implementer-claude',
      dependsOn: ['read-facade-impl-continuation-context'],
      task: `Continue the top-level @agent-assistant/sdk facade implementation from the saved boundary.

{{steps.read-facade-impl-continuation-context.output}}

Requirements:
- create packages/sdk if it does not already exist
- implement the agreed public exports
- update docs/examples/public guidance to use the facade where appropriate
- add minimal tests/build proof for the facade package
- keep changes within the approved implementation boundary

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- end your final summary with TOP_LEVEL_SDK_FACADE_CONTINUED_IMPLEMENTATION_READY`,
      verification: { type: 'file_exists', value: 'packages/sdk/package.json' },
    })

    .step('review-facade-continued-implementation', {
      agent: 'review-codex',
      dependsOn: ['implement-facade-from-boundary'],
      task: `Review the continued top-level SDK facade implementation.

Read:
- docs/architecture/top-level-sdk-facade-implementation-boundary.md
- changed files in packages/sdk
- changed docs/examples

Assess:
1. does the facade now materially simplify the public adoption path?
2. does it preserve modular package hygiene?
3. are docs/examples aligned with the new facade?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/top-level-sdk-facade-continued-implementation-review-verdict.md.
End with TOP_LEVEL_SDK_FACADE_CONTINUED_IMPLEMENTATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/top-level-sdk-facade-continued-implementation-review-verdict.md' },
    })

    .step('verify-facade-continued-implementation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-facade-continued-implementation'],
      command: [
        'test -f docs/architecture/top-level-sdk-facade-implementation-boundary.md',
        'test -f packages/sdk/package.json',
        'test -f docs/architecture/top-level-sdk-facade-continued-implementation-review-verdict.md',
        'grep -q "TOP_LEVEL_SDK_FACADE_CONTINUED_IMPLEMENTATION_REVIEW_COMPLETE" docs/architecture/top-level-sdk-facade-continued-implementation-review-verdict.md',
        'echo "TOP_LEVEL_SDK_FACADE_CONTINUED_IMPLEMENTATION_VERIFIED"',
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
