import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-implement-top-level-sdk-facade')
    .description('Implement the top-level @agent-assistant/sdk facade so the public adoption story has one obvious entrypoint while preserving the modular internal package architecture.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-implement-sdk-facade')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead SDK product architect responsible for translating the approved top-level facade plan into a clean implementation boundary and public package shape.',
      retries: 1,
    })
    .agent('implementer-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the @agent-assistant/sdk facade package, updates docs/examples, and adds the necessary tests/build proof.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the top-level SDK facade implementation for public ergonomics, modular boundary hygiene, and implementation readiness.',
      retries: 1,
    })

    .step('read-sdk-facade-implementation-context', {
      type: 'deterministic',
      command: [
        'echo "---FACADE BOUNDARY---"',
        'sed -n "1,260p" docs/architecture/top-level-sdk-facade-boundary.md',
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

    .step('define-sdk-facade-implementation-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-sdk-facade-implementation-context'],
      task: `Using the approved top-level SDK facade planning docs below, define the exact implementation boundary.

{{steps.read-sdk-facade-implementation-context.output}}

Write docs/architecture/top-level-sdk-facade-implementation-boundary.md.

The boundary must define:
1. what the new packages/sdk package will contain
2. what it will re-export now vs later
3. what tests/build proof are required
4. what docs/examples must be updated in the same pass
5. what remains intentionally deferred

Hard constraints:
- keep the public facade simple
- preserve the internal modular architecture
- do not let the facade become an unstructured kitchen sink

End with TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/top-level-sdk-facade-implementation-boundary.md' },
    })

    .step('implement-sdk-facade', {
      agent: 'implementer-claude',
      dependsOn: ['define-sdk-facade-implementation-boundary'],
      task: `Implement the top-level @agent-assistant/sdk facade.

Read and follow:
- docs/architecture/top-level-sdk-facade-implementation-boundary.md
- docs/architecture/top-level-sdk-facade-spec.md
- docs/architecture/top-level-sdk-facade-implementation-plan.md
- docs/consumer/top-level-sdk-adoption-guide.md

Requirements:
- add the new packages/sdk package
- implement the agreed public exports
- update docs/examples/public guidance to use the facade where appropriate
- add tests/build proof for the facade package
- keep changes within the approved facade boundary

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- end your final summary with TOP_LEVEL_SDK_FACADE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/sdk/package.json' },
    })

    .step('review-sdk-facade-implementation', {
      agent: 'review-codex',
      dependsOn: ['implement-sdk-facade'],
      task: `Review the top-level SDK facade implementation.

Read:
- docs/architecture/top-level-sdk-facade-implementation-boundary.md
- changed files in packages/sdk
- changed docs/examples

Assess:
1. does the facade meaningfully simplify the public adoption path?
2. does it preserve modular package hygiene?
3. are the docs/examples aligned with the new public entrypoint?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/top-level-sdk-facade-implementation-review-verdict.md.
End with TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/top-level-sdk-facade-implementation-review-verdict.md' },
    })

    .step('verify-sdk-facade-implementation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-sdk-facade-implementation'],
      command: [
        'test -f docs/architecture/top-level-sdk-facade-implementation-boundary.md',
        'test -f packages/sdk/package.json',
        'test -f docs/architecture/top-level-sdk-facade-implementation-review-verdict.md',
        'grep -q "TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_BOUNDARY_READY" docs/architecture/top-level-sdk-facade-implementation-boundary.md',
        'grep -q "TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_REVIEW_COMPLETE" docs/architecture/top-level-sdk-facade-implementation-review-verdict.md',
        'echo "TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_VERIFIED"',
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
