const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-implement-v1-surfaces')
    .description('Implement the v1 surfaces package for relay-agent-assistant from the reconciled canonical specs and workflow backlog.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-impl-surfaces')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 surfaces package, responsible for turning the surfaces spec and workflow backlog into a minimal, shippable package slice aligned with core and sessions.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the v1 surfaces package, tests, and package metadata according to the canonical surfaces spec and the established core/sessions package contracts.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the surfaces implementation for spec compliance, clean integration with core and sessions, and readiness for v1 assembly.',
      retries: 1,
    })

    .step('read-surfaces-context', {
      type: 'deterministic',
      command: [
        'echo "---SURFACES SPEC---"',
        'sed -n "1,420p" docs/specs/v1-surfaces-spec.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,320p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---CORE REVIEW VERDICT---"',
        'sed -n "1,220p" docs/architecture/v1-core-review-verdict.md',
        'echo "" && echo "---SESSIONS REVIEW VERDICT---"',
        'sed -n "1,240p" docs/architecture/v1-sessions-review-verdict.md',
        'echo "" && echo "---CORE TYPES---"',
        'sed -n "1,320p" packages/core/src/types.ts',
        'echo "" && echo "---CORE RUNTIME---"',
        'sed -n "1,320p" packages/core/src/core.ts',
        'echo "" && echo "---SESSIONS TYPES---"',
        'sed -n "1,320p" packages/sessions/src/types.ts',
        'echo "" && echo "---SESSIONS IMPLEMENTATION---"',
        'sed -n "1,360p" packages/sessions/src/sessions.ts',
        'echo "" && echo "---EXISTING SURFACES README---"',
        'sed -n "1,240p" packages/surfaces/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-surfaces-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-surfaces-context'],
      task: `Using the surfaces spec, workflow backlog, and current core/sessions implementation context below, write a focused implementation plan for the v1 surfaces package.

{{steps.read-surfaces-context.output}}

Write docs/architecture/v1-surfaces-implementation-plan.md.

The plan must:
1. name the exact files to create under packages/surfaces
2. define the first implementation slice to match the surfaces-related workflows and current v1 scope
3. keep the package boundary strict: no product logic, no cloud assumptions, no relay transport implementation
4. explicitly define how surfaces satisfies the adapter contracts expected by core and interacts with sessions for fanout
5. specify the minimum tests to write now

End the document with V1_SURFACES_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-surfaces-implementation-plan.md' },
    })

    .step('implement-surfaces-package', {
      agent: 'implement-codex',
      dependsOn: ['lead-surfaces-plan'],
      task: `Implement the v1 surfaces package using docs/architecture/v1-surfaces-implementation-plan.md, docs/specs/v1-surfaces-spec.md, and the current core/sessions package contracts.

Required work:
- create/update package files under packages/surfaces/
- implement the minimal surface registry and connection/fanout behavior for v1
- implement spec-aligned types and exports
- implement the adapter contract shape expected by core
- support sessions-based fanout interaction in the surfaces layer where appropriate
- write tests for the intended first surfaces workflows
- update packages/surfaces/README.md from placeholder to actual package documentation

Expected package shape:
- packages/surfaces/package.json
- packages/surfaces/tsconfig.json
- packages/surfaces/src/index.ts
- packages/surfaces/src/types.ts
- packages/surfaces/src/surfaces.ts
- packages/surfaces/src/surfaces.test.ts
- packages/surfaces/README.md

Requirements:
- TypeScript-first
- no cloud assumptions
- no product-specific logic
- no relay transport implementation inside surfaces
- align cleanly with the current core and sessions package contracts
- make the package runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- end packages/surfaces/README.md with SURFACES_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/surfaces/src/surfaces.ts' },
    })

    .step('review-surfaces-package', {
      agent: 'review-claude',
      dependsOn: ['implement-surfaces-package'],
      task: `Review the implemented v1 surfaces package.

Read:
- docs/specs/v1-surfaces-spec.md
- docs/architecture/v1-surfaces-implementation-plan.md
- packages/core/src/types.ts
- packages/core/src/core.ts
- packages/sessions/src/types.ts
- packages/sessions/src/sessions.ts
- packages/surfaces/package.json
- packages/surfaces/tsconfig.json
- packages/surfaces/src/index.ts
- packages/surfaces/src/types.ts
- packages/surfaces/src/surfaces.ts
- packages/surfaces/src/surfaces.test.ts
- packages/surfaces/README.md

Assess:
1. Does the implementation match the canonical surfaces spec closely enough for v1?
2. Is the adapter integration with core and sessions clean and explicit?
3. Do the tests cover the intended surfaces workflows?
4. What follow-ups remain before moving to v1 assembly/integration?

Write docs/architecture/v1-surfaces-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_SURFACES_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-surfaces-review-verdict.md' },
    })

    .step('verify-surfaces-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-surfaces-package'],
      command: [
        'test -f docs/architecture/v1-surfaces-implementation-plan.md',
        'test -f packages/surfaces/package.json',
        'test -f packages/surfaces/tsconfig.json',
        'test -f packages/surfaces/src/index.ts',
        'test -f packages/surfaces/src/types.ts',
        'test -f packages/surfaces/src/surfaces.ts',
        'test -f packages/surfaces/src/surfaces.test.ts',
        'test -f packages/surfaces/README.md',
        'test -f docs/architecture/v1-surfaces-review-verdict.md',
        'grep -q "V1_SURFACES_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-surfaces-implementation-plan.md',
        'grep -q "SURFACES_PACKAGE_IMPLEMENTED" packages/surfaces/README.md',
        'grep -q "V1_SURFACES_REVIEW_COMPLETE" docs/architecture/v1-surfaces-review-verdict.md',
        'echo "V1_SURFACES_IMPLEMENTATION_VERIFIED"',
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
