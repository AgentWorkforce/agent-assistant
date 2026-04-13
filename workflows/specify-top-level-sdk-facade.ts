import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-specify-top-level-sdk-facade')
    .description('Define the top-level @agent-assistant/sdk facade so the public adoption story is package-simple, docs-simple, and aligned with future multi-language SDKs instead of exposing the entire internal package graph as the primary entrypoint.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-sdk-facade')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead SDK product architect defining the public facade package and the boundary between public ergonomic surface and internal modular architecture.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the top-level SDK facade spec, package-boundary plan, and public-usage guidance.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the SDK facade plan for public ergonomics, package clarity, and future language portability.',
      retries: 1,
    })

    .step('read-sdk-facade-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,320p" README.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,320p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---HOW TO BUILD AN ASSISTANT---"',
        'sed -n "1,320p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---OPEN SOURCE REPORT---"',
        'sed -n "1,260p" docs/architecture/open-source-readiness-report.md 2>/dev/null || true',
        'echo "" && echo "---PACKAGE MANIFESTS---"',
        'find packages -maxdepth 2 -name package.json -type f | sort | xargs -I{} sh -c "echo --- {}; sed -n \"1,220p\" {}"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-sdk-facade-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-sdk-facade-context'],
      task: `Using the current package/docs state below, define the public top-level SDK facade boundary.

{{steps.read-sdk-facade-context.output}}

Write docs/architecture/top-level-sdk-facade-boundary.md.

The boundary doc must define:
1. why @agent-assistant/sdk should exist
2. what it should re-export from internal packages
3. what should remain internal/advanced imports
4. what the canonical "hello world"/starter import path should be
5. how this affects docs/examples/publish strategy
6. how this sets up future Python parity

Hard constraints:
- optimize for outside adoption simplicity
- preserve internal modular package architecture
- do not turn the facade into a dumping ground

End with TOP_LEVEL_SDK_FACADE_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/top-level-sdk-facade-boundary.md' },
    })

    .step('author-sdk-facade-plan', {
      agent: 'author-claude',
      dependsOn: ['define-sdk-facade-boundary'],
      task: `Author the top-level SDK facade plan.

Read and follow:
- docs/architecture/top-level-sdk-facade-boundary.md
- package manifests
- public-facing docs

Required outputs:
- docs/architecture/top-level-sdk-facade-spec.md
- docs/architecture/top-level-sdk-facade-implementation-plan.md
- docs/consumer/top-level-sdk-adoption-guide.md

Requirements:
- define the exact intended public surface of @agent-assistant/sdk
- define what package changes are required next
- define how docs/examples should pivot to the facade
- make the guide concrete enough to drive implementation next

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/architecture/top-level-sdk-facade-spec.md with TOP_LEVEL_SDK_FACADE_SPEC_READY
- end docs/architecture/top-level-sdk-facade-implementation-plan.md with TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_PLAN_READY
- end docs/consumer/top-level-sdk-adoption-guide.md with TOP_LEVEL_SDK_ADOPTION_GUIDE_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/top-level-sdk-facade-implementation-plan.md' },
    })

    .step('review-sdk-facade-plan', {
      agent: 'review-codex',
      dependsOn: ['author-sdk-facade-plan'],
      task: `Review the top-level SDK facade plan.

Read:
- docs/architecture/top-level-sdk-facade-boundary.md
- docs/architecture/top-level-sdk-facade-spec.md
- docs/architecture/top-level-sdk-facade-implementation-plan.md
- docs/consumer/top-level-sdk-adoption-guide.md

Assess:
1. does this meaningfully improve public adoption ergonomics?
2. does it preserve modular architecture cleanly?
3. is the facade scoped well enough for JS/TS now and Python later?
4. is this strong enough to drive implementation next?

Write docs/architecture/top-level-sdk-facade-review-verdict.md.
End with TOP_LEVEL_SDK_FACADE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/top-level-sdk-facade-review-verdict.md' },
    })

    .step('verify-sdk-facade-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-sdk-facade-plan'],
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
        'echo "TOP_LEVEL_SDK_FACADE_VERIFIED"',
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
