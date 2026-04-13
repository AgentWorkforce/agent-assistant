import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-implement-v1-turn-context')
    .description('Implement the first useful v1 of @agent-assistant/turn-context as a bounded assembly primitive that projects cleanly into @agent-assistant/harness.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-implement-turn-context')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead architecture implementer for the v1 turn-context package, responsible for keeping the implementation bounded to the approved boundary and preserving the primitive split between traits, turn-context, harness, and product intelligence.',
      retries: 1,
    })
    .agent('impl-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the @agent-assistant/turn-context package, package docs, and tests from the approved implementation boundary.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the v1 turn-context implementation for boundary discipline, API usefulness, projection clarity into harness, and validation strength.',
      retries: 1,
    })

    .step('read-turn-context-implementation-context', {
      type: 'deterministic',
      command: [
        'echo "---TURN CONTEXT BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/v1-turn-context-enrichment-boundary.md',
        'echo "" && echo "---TURN CONTEXT SPEC---"',
        'sed -n "1,360p" docs/specs/v1-turn-context-enrichment-spec.md',
        'echo "" && echo "---TURN CONTEXT IMPLEMENTATION BOUNDARY---"',
        'sed -n "1,360p" docs/architecture/v1-turn-context-implementation-boundary.md',
        'echo "" && echo "---TURN CONTEXT IMPL REVIEW---"',
        'sed -n "1,220p" docs/architecture/v1-turn-context-implementation-review-verdict.md',
        'echo "" && echo "---RUNTIME PRIMITIVE MAP---"',
        'sed -n "1,280p" docs/architecture/agent-assistant-runtime-primitive-map.md',
        'echo "" && echo "---HARNESS SPEC---"',
        'sed -n "1,320p" docs/specs/v1-harness-spec.md',
        'echo "" && echo "---TRAITS README---"',
        'sed -n "1,240p" packages/traits/README.md',
        'echo "" && echo "---CURRENT ROOT PACKAGE---"',
        'sed -n "1,220p" package.json',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-turn-context-implementation-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-turn-context-implementation-context'],
      task: `Using the approved turn-context docs below, define the exact implementation plan for the first package pass. Keep it bounded to the approved v1 milestone.

{{steps.read-turn-context-implementation-context.output}}

Write docs/architecture/v1-turn-context-package-implementation-plan.md.

The plan must explicitly define:
1. package/files to create in packages/turn-context
2. required public API surface for v1
3. what tests prove the primitive is useful and not just a string helper
4. what harness projection proof must be included
5. what is intentionally deferred even if tempting

End the doc with V1_TURN_CONTEXT_PACKAGE_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-turn-context-package-implementation-plan.md' },
    })

    .step('implement-turn-context-package', {
      agent: 'impl-claude',
      dependsOn: ['define-turn-context-implementation-plan'],
      task: `Implement @agent-assistant/turn-context v1 from the approved boundary and implementation plan.

Binding docs:
- docs/architecture/v1-turn-context-enrichment-boundary.md
- docs/specs/v1-turn-context-enrichment-spec.md
- docs/architecture/v1-turn-context-implementation-boundary.md
- docs/architecture/v1-turn-context-package-implementation-plan.md
- docs/specs/v1-harness-spec.md

Requirements:
- create packages/turn-context
- implement one primary public factory + assembler interface
- implement the required v1 input/output model only
- include deterministic shallow composition rules only
- project cleanly into harness-facing instructions/context
- add meaningful tests
- add package README and any necessary root workspace/package updates
- keep the package distinct from traits, harness, and product business logic

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- do not overbuild enrichment/memory/policy concerns
- end your final summary with V1_TURN_CONTEXT_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/turn-context/package.json' },
    })

    .step('validate-turn-context-package', {
      type: 'deterministic',
      dependsOn: ['implement-turn-context-package'],
      command: [
        'npm run build -w @agent-assistant/turn-context',
        'npm test -w @agent-assistant/turn-context',
        'npm pack --dry-run -w @agent-assistant/turn-context',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-turn-context-package', {
      agent: 'review-codex',
      dependsOn: ['validate-turn-context-package'],
      task: `Review the implemented @agent-assistant/turn-context package.

Read:
- docs/architecture/v1-turn-context-enrichment-boundary.md
- docs/specs/v1-turn-context-enrichment-spec.md
- docs/architecture/v1-turn-context-implementation-boundary.md
- docs/architecture/v1-turn-context-package-implementation-plan.md
- packages/turn-context/**
- validation output:
{{steps.validate-turn-context-package.output}}

Assess:
1. did the implementation stay bounded?
2. is the API actually useful to a real product?
3. does harness projection look clean and believable?
4. are the tests meaningful enough for a first package pass?
5. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-turn-context-package-review-verdict.md.
End with V1_TURN_CONTEXT_PACKAGE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-turn-context-package-review-verdict.md' },
    })

    .step('verify-turn-context-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-turn-context-package'],
      command: [
        'test -f packages/turn-context/package.json',
        'test -f packages/turn-context/README.md',
        'test -f packages/turn-context/src/index.ts',
        'test -f docs/architecture/v1-turn-context-package-implementation-plan.md',
        'test -f docs/architecture/v1-turn-context-package-review-verdict.md',
        'grep -q "V1_TURN_CONTEXT_PACKAGE_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-turn-context-package-implementation-plan.md',
        'grep -q "V1_TURN_CONTEXT_PACKAGE_REVIEW_COMPLETE" docs/architecture/v1-turn-context-package-review-verdict.md',
        'echo "V1_TURN_CONTEXT_PACKAGE_VERIFIED"',
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
