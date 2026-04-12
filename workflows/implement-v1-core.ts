const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-implement-v1-core')
    .description('Implement the v1 core package for agent-assistant-sdk from the reconciled canonical specs and workflow backlog.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-impl-core')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 core package, responsible for converting the core spec and workflow backlog into a minimal, shippable package slice',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the v1 core package, tests, and package metadata according to the canonical core spec',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the implementation for spec compliance, package boundaries, and v1 readiness',
      retries: 1,
    })

    .step('read-core-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,240p" README.md',
        'echo "" && echo "---CORE SPEC---"',
        'sed -n "1,360p" docs/specs/v1-core-spec.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,260p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---SPEC PROGRAM PLAN---"',
        'sed -n "1,260p" docs/architecture/spec-program-plan.md',
        'echo "" && echo "---EXISTING CORE README---"',
        'sed -n "1,240p" packages/core/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-core-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-core-context'],
      task: `Using the core spec, workflow backlog, and current repo context below, write a focused implementation plan for the v1 core package.

{{steps.read-core-context.output}}

Write docs/architecture/v1-core-implementation-plan.md.

The plan must:
1. name the exact files to create under packages/core
2. define the first implementation slice to match WF-1 and WF-2
3. keep the package boundary strict: no memory, no surfaces logic, no sessions implementation details
4. specify the minimum tests to write now
5. identify any interfaces that must stay abstract for later packages

End the document with V1_CORE_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-core-implementation-plan.md' },
    })

    .step('implement-core-package', {
      agent: 'implement-codex',
      dependsOn: ['lead-core-plan'],
      task: `Implement the v1 core package using docs/architecture/v1-core-implementation-plan.md and docs/specs/v1-core-spec.md.

Required work:
- create/update package files under packages/core/
- implement the minimal runtime for v1 core
- implement the spec-aligned types and exports
- write tests for the first core workflows (WF-1 and WF-2 scope)
- update packages/core/README.md from placeholder to actual package documentation

Expected package shape:
- packages/core/package.json
- packages/core/tsconfig.json
- packages/core/src/index.ts
- packages/core/src/types.ts
- packages/core/src/core.ts
- packages/core/src/core.test.ts
- packages/core/README.md

Requirements:
- TypeScript-first
- no cloud assumptions
- no product-specific logic
- no surfaces normalization logic
- no sessions implementation inside core
- keep later-package contracts abstract where required
- make the package actually runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- end packages/core/README.md with CORE_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/core/src/core.ts' },
    })

    .step('review-core-package', {
      agent: 'review-claude',
      dependsOn: ['implement-core-package'],
      task: `Review the implemented v1 core package.

Read:
- docs/specs/v1-core-spec.md
- docs/architecture/v1-core-implementation-plan.md
- packages/core/package.json
- packages/core/tsconfig.json
- packages/core/src/index.ts
- packages/core/src/types.ts
- packages/core/src/core.ts
- packages/core/src/core.test.ts
- packages/core/README.md

Assess:
1. Does the implementation match the canonical core spec closely enough for v1?
2. Does it keep package boundaries clean?
3. Do the tests cover the intended first workflows?
4. What follow-ups remain before coding can move to sessions?

Write docs/architecture/v1-core-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_CORE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-core-review-verdict.md' },
    })

    .step('verify-core-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-core-package'],
      command: [
        'test -f docs/architecture/v1-core-implementation-plan.md',
        'test -f packages/core/package.json',
        'test -f packages/core/tsconfig.json',
        'test -f packages/core/src/index.ts',
        'test -f packages/core/src/types.ts',
        'test -f packages/core/src/core.ts',
        'test -f packages/core/src/core.test.ts',
        'test -f packages/core/README.md',
        'test -f docs/architecture/v1-core-review-verdict.md',
        'grep -q "V1_CORE_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-core-implementation-plan.md',
        'grep -q "CORE_PACKAGE_IMPLEMENTED" packages/core/README.md',
        'grep -q "V1_CORE_REVIEW_COMPLETE" docs/architecture/v1-core-review-verdict.md',
        'echo "V1_CORE_IMPLEMENTATION_VERIFIED"',
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
