const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-assistant-implement-v1-traits')
    .description('Implement the v1 traits package for RelayAssistant from the traits spec, traits scope, and current package landscape.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-impl-traits')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 traits package, responsible for turning the traits spec into a bounded, shippable package slice distinct from workforce personas.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the v1 traits package, tests, and package metadata according to the canonical traits spec and current assistant package architecture.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the traits implementation for bounded scope, clean package boundaries, and useful readiness for future assistant composition.',
      retries: 1,
    })

    .step('read-traits-implementation-context', {
      type: 'deterministic',
      command: [
        'echo "---TRAITS SCOPE---"',
        'sed -n "1,360p" docs/architecture/v1-traits-scope.md',
        'echo "" && echo "---TRAITS SPEC---"',
        'sed -n "1,360p" docs/specs/v1-traits-spec.md',
        'echo "" && echo "---TRAITS IMPLEMENTATION PLAN---"',
        'sed -n "1,320p" docs/architecture/v1-traits-implementation-plan.md',
        'echo "" && echo "---TRAITS VS WORKFORCE PERSONAS---"',
        'sed -n "1,320p" docs/research/traits-vs-workforce-personas.md',
        'echo "" && echo "---TRAITS README---"',
        'sed -n "1,240p" packages/traits/README.md',
        'echo "" && echo "---WORKFORCE README---"',
        'sed -n "1,220p" ../workforce/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-traits-implementation-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-traits-implementation-context'],
      task: `Using the traits scope, traits spec, and current workforce/assistant context below, write a focused implementation plan for the v1 traits package.

{{steps.read-traits-implementation-context.output}}

Write docs/architecture/v1-traits-package-implementation-plan.md.

The plan must:
1. define the bounded v1 implementation slice
2. name the exact files to create under packages/traits
3. specify the minimal schema/provider/expression/adaptation slice to implement now
4. keep the distinction from workforce personas explicit
5. define the minimum tests to write now

End the document with V1_TRAITS_PACKAGE_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-traits-package-implementation-plan.md' },
    })

    .step('implement-traits-package', {
      agent: 'implement-codex',
      dependsOn: ['lead-traits-implementation-plan'],
      task: `Implement the v1 traits package using docs/architecture/v1-traits-package-implementation-plan.md and docs/specs/v1-traits-spec.md.

Required work:
- create/update package files under packages/traits/
- implement the minimal trait schema/provider/expression/adaptation layer for v1
- keep workforce persona concepts distinct and out of direct ownership here
- write tests for the intended first traits workflows
- update packages/traits/README.md from direction doc to actual package documentation

Expected package shape:
- packages/traits/package.json
- packages/traits/tsconfig.json
- packages/traits/src/index.ts
- packages/traits/src/types.ts
- packages/traits/src/traits.ts
- packages/traits/src/traits.test.ts
- packages/traits/README.md

Requirements:
- TypeScript-first
- no cloud assumptions
- no workforce persona ownership
- no product-specific logic
- no overbuilt dynamic learning system yet
- keep the package runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- end packages/traits/README.md with TRAITS_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/traits/src/traits.ts' },
    })

    .step('review-traits-package', {
      agent: 'review-claude',
      dependsOn: ['implement-traits-package'],
      task: `Review the implemented v1 traits package.

Read:
- docs/specs/v1-traits-spec.md
- docs/architecture/v1-traits-package-implementation-plan.md
- docs/research/traits-vs-workforce-personas.md
- packages/traits/package.json
- packages/traits/tsconfig.json
- packages/traits/src/index.ts
- packages/traits/src/types.ts
- packages/traits/src/traits.ts
- packages/traits/src/traits.test.ts
- packages/traits/README.md

Assess:
1. Is the traits package properly bounded for v1?
2. Is the distinction from workforce personas still clear in the code and docs?
3. Do the tests cover the intended first traits behaviors?
4. What follow-ups remain before traits can be integrated into higher-level assistant composition?

Write docs/architecture/v1-traits-package-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_TRAITS_PACKAGE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-traits-package-review-verdict.md' },
    })

    .step('verify-traits-package-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-traits-package'],
      command: [
        'test -f docs/architecture/v1-traits-package-implementation-plan.md',
        'test -f packages/traits/package.json',
        'test -f packages/traits/tsconfig.json',
        'test -f packages/traits/src/index.ts',
        'test -f packages/traits/src/types.ts',
        'test -f packages/traits/src/traits.ts',
        'test -f packages/traits/src/traits.test.ts',
        'test -f packages/traits/README.md',
        'test -f docs/architecture/v1-traits-package-review-verdict.md',
        'grep -q "V1_TRAITS_PACKAGE_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-traits-package-implementation-plan.md',
        'grep -q "TRAITS_PACKAGE_IMPLEMENTED" packages/traits/README.md',
        'grep -q "V1_TRAITS_PACKAGE_REVIEW_COMPLETE" docs/architecture/v1-traits-package-review-verdict.md',
        'echo "V1_TRAITS_PACKAGE_IMPLEMENTATION_VERIFIED"',
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
