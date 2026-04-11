const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-implement-v1-foundation-integration')
    .description('Implement the v1 foundation integration slice proving core, sessions, and surfaces work together as one coherent assistant runtime foundation.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-impl-foundation')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead integration architect for the v1 foundation, responsible for turning the package specs and backlog into an integration plan covering WF-4 and WF-6 style behavior.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the v1 foundation integration tests and any narrow package changes required to make core, sessions, and surfaces work together cleanly.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the foundation integration for spec conformance, clean package interactions, and readiness for the next package layers.',
      retries: 1,
    })

    .step('read-foundation-context', {
      type: 'deterministic',
      command: [
        'echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,360p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---WEEKEND DELIVERY---"',
        'sed -n "1,320p" docs/workflows/weekend-delivery-plan.md',
        'echo "" && echo "---CORE REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-core-review-verdict.md',
        'echo "" && echo "---SESSIONS REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-sessions-review-verdict.md',
        'echo "" && echo "---SURFACES REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-surfaces-review-verdict.md',
        'echo "" && echo "---CORE TYPES---"',
        'sed -n "1,320p" packages/core/src/types.ts',
        'echo "" && echo "---CORE RUNTIME---"',
        'sed -n "1,360p" packages/core/src/core.ts',
        'echo "" && echo "---SESSIONS TYPES---"',
        'sed -n "1,320p" packages/sessions/src/types.ts',
        'echo "" && echo "---SESSIONS IMPLEMENTATION---"',
        'sed -n "1,360p" packages/sessions/src/sessions.ts',
        'echo "" && echo "---SURFACES TYPES---"',
        'sed -n "1,320p" packages/surfaces/src/types.ts',
        'echo "" && echo "---SURFACES IMPLEMENTATION---"',
        'sed -n "1,420p" packages/surfaces/src/surfaces.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-foundation-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-foundation-context'],
      task: `Using the workflow backlog, review verdicts, and current package implementations below, write a focused v1 foundation integration plan.

{{steps.read-foundation-context.output}}

Write docs/architecture/v1-foundation-integration-plan.md.

The plan must:
1. define the exact WF-4 and WF-6 integration behaviors to prove now
2. name the exact files to create or update
3. keep changes narrow and integration-focused, not a new package design pass
4. explicitly state what package-level follow-ups are in scope for this integration step versus deferred
5. specify the minimum integration tests and assertions required

End the document with V1_FOUNDATION_INTEGRATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-foundation-integration-plan.md' },
    })

    .step('implement-foundation-integration', {
      agent: 'implement-codex',
      dependsOn: ['lead-foundation-plan'],
      task: `Implement the v1 foundation integration using docs/architecture/v1-foundation-integration-plan.md and the existing core, sessions, and surfaces packages.

Required work:
- add the WF-4 integration test
- add the WF-6 integration test
- make any minimal, spec-aligned package changes required for the integration tests to pass
- keep changes tightly scoped to integration correctness
- update docs only if necessary to reflect the integration slice accurately

Expected files to create or update include:
- packages/core/src/core-sessions.test.ts
- packages/core/src/core-sessions-surfaces.test.ts
- any minimal updates in packages/core/src/core.ts
- any minimal updates in packages/sessions/src/sessions.ts
- any minimal updates in packages/surfaces/src/surfaces.ts
- docs/architecture/v1-foundation-integration-plan.md (if refined during implementation)

Requirements:
- TypeScript-first
- no new package creation
- no cloud assumptions
- no product-specific logic
- integration should prove targeted send, session fanout, session attach/detach effects, invalid emit handling, and clean runtime lifecycle across the foundation packages

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- append FOUNDATION_INTEGRATION_IMPLEMENTED to docs/architecture/v1-foundation-integration-plan.md`,
      verification: { type: 'file_exists', value: 'packages/core/src/core-sessions-surfaces.test.ts' },
    })

    .step('review-foundation-integration', {
      agent: 'review-claude',
      dependsOn: ['implement-foundation-integration'],
      task: `Review the implemented v1 foundation integration.

Read:
- docs/architecture/v1-foundation-integration-plan.md
- packages/core/src/core.ts
- packages/core/src/core-sessions.test.ts
- packages/core/src/core-sessions-surfaces.test.ts
- packages/sessions/src/sessions.ts
- packages/surfaces/src/surfaces.ts
- docs/architecture/v1-core-review-verdict.md
- docs/architecture/v1-sessions-review-verdict.md
- docs/architecture/v1-surfaces-review-verdict.md

Assess:
1. Do the integration tests actually prove WF-4 and WF-6 style behavior?
2. Are the package interactions clean and spec-aligned?
3. Were changes kept narrow and integration-focused?
4. What follow-ups remain before moving to the next package layers?

Write docs/architecture/v1-foundation-integration-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_FOUNDATION_INTEGRATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-foundation-integration-review-verdict.md' },
    })

    .step('verify-foundation-integration-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-foundation-integration'],
      command: [
        'test -f docs/architecture/v1-foundation-integration-plan.md',
        'test -f packages/core/src/core-sessions.test.ts',
        'test -f packages/core/src/core-sessions-surfaces.test.ts',
        'test -f docs/architecture/v1-foundation-integration-review-verdict.md',
        'grep -q "V1_FOUNDATION_INTEGRATION_PLAN_READY" docs/architecture/v1-foundation-integration-plan.md',
        'grep -q "FOUNDATION_INTEGRATION_IMPLEMENTED" docs/architecture/v1-foundation-integration-plan.md',
        'grep -q "V1_FOUNDATION_INTEGRATION_REVIEW_COMPLETE" docs/architecture/v1-foundation-integration-review-verdict.md',
        'echo "V1_FOUNDATION_INTEGRATION_VERIFIED"',
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
