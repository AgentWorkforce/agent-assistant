const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-implement-v1-sessions')
    .description('Implement the v1 sessions package for relay-agent-assistant from the reconciled canonical specs and workflow backlog.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-impl-sessions')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 sessions package, responsible for turning the sessions spec and workflow backlog into a minimal, shippable package slice that aligns with core.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the v1 sessions package, tests, and package metadata according to the canonical sessions spec and the established core package contracts.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the sessions implementation for spec compliance, clean integration with core, and readiness for the surfaces package to follow.',
      retries: 1,
    })

    .step('read-sessions-context', {
      type: 'deterministic',
      command: [
        'echo "---SESSIONS SPEC---"',
        'sed -n "1,360p" docs/specs/v1-sessions-spec.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,280p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---CORE REVIEW VERDICT---"',
        'sed -n "1,260p" docs/architecture/v1-core-review-verdict.md',
        'echo "" && echo "---CORE TYPES---"',
        'sed -n "1,320p" packages/core/src/types.ts',
        'echo "" && echo "---CORE RUNTIME---"',
        'sed -n "1,320p" packages/core/src/core.ts',
        'echo "" && echo "---EXISTING SESSIONS README---"',
        'sed -n "1,240p" packages/sessions/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-sessions-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-sessions-context'],
      task: `Using the sessions spec, workflow backlog, and current core implementation context below, write a focused implementation plan for the v1 sessions package.

{{steps.read-sessions-context.output}}

Write docs/architecture/v1-sessions-implementation-plan.md.

The plan must:
1. name the exact files to create under packages/sessions
2. define the first implementation slice to match the sessions-related workflows
3. keep the package boundary strict: no surfaces implementation, no product logic, no cloud assumptions
4. explicitly define the contract shape sessions must satisfy when registered into core
5. specify the minimum tests to write now

End the document with V1_SESSIONS_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-sessions-implementation-plan.md' },
    })

    .step('implement-sessions-package', {
      agent: 'implement-codex',
      dependsOn: ['lead-sessions-plan'],
      task: `Implement the v1 sessions package using docs/architecture/v1-sessions-implementation-plan.md, docs/specs/v1-sessions-spec.md, and the current core package contracts.

Required work:
- create/update package files under packages/sessions/
- implement the minimal session store and lifecycle for v1
- implement spec-aligned types and exports
- implement the contract needed for core to use sessions during emit/session lookup flows
- write tests for the intended first sessions workflows
- update packages/sessions/README.md from placeholder to actual package documentation

Expected package shape:
- packages/sessions/package.json
- packages/sessions/tsconfig.json
- packages/sessions/src/index.ts
- packages/sessions/src/types.ts
- packages/sessions/src/sessions.ts
- packages/sessions/src/sessions.test.ts
- packages/sessions/README.md

Requirements:
- TypeScript-first
- no cloud assumptions
- no surfaces implementation inside sessions
- no product-specific logic
- align with the current core package integration shape
- make the package runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- end packages/sessions/README.md with SESSIONS_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/sessions/src/sessions.ts' },
    })

    .step('review-sessions-package', {
      agent: 'review-claude',
      dependsOn: ['implement-sessions-package'],
      task: `Review the implemented v1 sessions package.

Read:
- docs/specs/v1-sessions-spec.md
- docs/architecture/v1-sessions-implementation-plan.md
- packages/core/src/types.ts
- packages/core/src/core.ts
- packages/sessions/package.json
- packages/sessions/tsconfig.json
- packages/sessions/src/index.ts
- packages/sessions/src/types.ts
- packages/sessions/src/sessions.ts
- packages/sessions/src/sessions.test.ts
- packages/sessions/README.md

Assess:
1. Does the implementation match the canonical sessions spec closely enough for v1?
2. Is the integration shape with core clean and explicit?
3. Do the tests cover the intended sessions workflows?
4. What follow-ups remain before coding can move to surfaces?

Write docs/architecture/v1-sessions-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_SESSIONS_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-sessions-review-verdict.md' },
    })

    .step('verify-sessions-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-sessions-package'],
      command: [
        'test -f docs/architecture/v1-sessions-implementation-plan.md',
        'test -f packages/sessions/package.json',
        'test -f packages/sessions/tsconfig.json',
        'test -f packages/sessions/src/index.ts',
        'test -f packages/sessions/src/types.ts',
        'test -f packages/sessions/src/sessions.ts',
        'test -f packages/sessions/src/sessions.test.ts',
        'test -f packages/sessions/README.md',
        'test -f docs/architecture/v1-sessions-review-verdict.md',
        'grep -q "V1_SESSIONS_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-sessions-implementation-plan.md',
        'grep -q "SESSIONS_PACKAGE_IMPLEMENTED" packages/sessions/README.md',
        'grep -q "V1_SESSIONS_REVIEW_COMPLETE" docs/architecture/v1-sessions-review-verdict.md',
        'echo "V1_SESSIONS_IMPLEMENTATION_VERIFIED"',
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
