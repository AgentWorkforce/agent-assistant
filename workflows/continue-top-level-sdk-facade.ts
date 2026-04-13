import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-continue-top-level-sdk-facade')
    .description('Continue the top-level @agent-assistant/sdk facade work from the already-produced facade boundary document, avoiding the previously wedged boundary-definition step and focusing on the spec, implementation plan, and adoption guide.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-sdk-facade-continue')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the top-level SDK facade spec, implementation plan, and adoption guide from the saved facade boundary.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the continued top-level SDK facade outputs for public ergonomics, modularity, and implementation readiness.',
      retries: 1,
    })

    .step('read-facade-continuation-context', {
      type: 'deterministic',
      command: [
        'echo "---FACADE BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/top-level-sdk-facade-boundary.md',
        'echo "" && echo "---README---"',
        'sed -n "1,320p" README.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---HOW TO BUILD AN ASSISTANT---"',
        'sed -n "1,320p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---PACKAGE MANIFESTS---"',
        'find packages -maxdepth 2 -name package.json -type f | sort | xargs -I{} sh -c "echo --- {}; sed -n \"1,220p\" {}"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('author-facade-plan', {
      agent: 'author-claude',
      dependsOn: ['read-facade-continuation-context'],
      task: `Continue the top-level SDK facade work from the existing boundary.

{{steps.read-facade-continuation-context.output}}

Required outputs:
- docs/architecture/top-level-sdk-facade-spec.md
- docs/architecture/top-level-sdk-facade-implementation-plan.md
- docs/consumer/top-level-sdk-adoption-guide.md

Requirements:
- use the boundary document as authoritative
- define the exact intended public surface of @agent-assistant/sdk
- define what package changes are required next
- define how docs/examples should pivot to the facade
- make the adoption guide concrete for outside consumers

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/architecture/top-level-sdk-facade-spec.md with TOP_LEVEL_SDK_FACADE_SPEC_READY
- end docs/architecture/top-level-sdk-facade-implementation-plan.md with TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_PLAN_READY
- end docs/consumer/top-level-sdk-adoption-guide.md with TOP_LEVEL_SDK_ADOPTION_GUIDE_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/top-level-sdk-facade-implementation-plan.md' },
    })

    .step('review-facade-plan', {
      agent: 'review-codex',
      dependsOn: ['author-facade-plan'],
      task: `Review the continued top-level SDK facade outputs.

Read:
- docs/architecture/top-level-sdk-facade-boundary.md
- docs/architecture/top-level-sdk-facade-spec.md
- docs/architecture/top-level-sdk-facade-implementation-plan.md
- docs/consumer/top-level-sdk-adoption-guide.md

Assess:
1. does this improve public adoption ergonomics materially?
2. does it preserve modular architecture cleanly?
3. does it create a strong foundation for future Python parity?
4. is this strong enough to drive implementation next?

Write docs/architecture/top-level-sdk-facade-review-verdict.md.
End with TOP_LEVEL_SDK_FACADE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/top-level-sdk-facade-review-verdict.md' },
    })

    .step('verify-facade-continuation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-facade-plan'],
      command: [
        'test -f docs/architecture/top-level-sdk-facade-boundary.md',
        'test -f docs/architecture/top-level-sdk-facade-spec.md',
        'test -f docs/architecture/top-level-sdk-facade-implementation-plan.md',
        'test -f docs/consumer/top-level-sdk-adoption-guide.md',
        'test -f docs/architecture/top-level-sdk-facade-review-verdict.md',
        'grep -q "TOP_LEVEL_SDK_FACADE_BOUNDARY_READY" docs/architecture/top-level-sdk-facade-boundary.md',
        'grep -q "TOP_LEVEL_SDK_FACADE_SPEC_READY" docs/architecture/top-level-sdk-facade-spec.md',
        'grep -q "TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_PLAN_READY" docs/architecture/top-level-sdk-facade-implementation-plan.md',
        'grep -q "TOP_LEVEL_SDK_ADOPTION_GUIDE_READY" docs/consumer/top-level-sdk-adoption-guide.md',
        'grep -q "TOP_LEVEL_SDK_FACADE_REVIEW_COMPLETE" docs/architecture/top-level-sdk-facade-review-verdict.md',
        'echo "TOP_LEVEL_SDK_FACADE_CONTINUATION_VERIFIED"',
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
