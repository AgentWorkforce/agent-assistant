const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-implement-v1-coordination-routing-integration')
    .description('Implement the v1 coordination↔routing integration slice so coordination can request routing mode selection without taking ownership of routing internals.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-impl-coord-routing')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead integration architect for coordination↔routing, responsible for defining the bounded integration slice and keeping package ownership clean.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the narrow coordination↔routing integration, adds tests, and keeps changes tightly bounded to integration correctness.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the coordination↔routing integration for clean dependency direction, bounded scope, and useful v1 behavior.',
      retries: 1,
    })

    .step('read-coord-routing-context', {
      type: 'deterministic',
      command: [
        'echo "---ROUTING REVIEW---"',
        'sed -n "1,320p" docs/architecture/v1-routing-review-verdict.md',
        'echo "" && echo "---COORDINATION HARDENING REVIEW---"',
        'sed -n "1,320p" docs/architecture/v1-coordination-hardening-review-verdict.md',
        'echo "" && echo "---ROUTING TYPES---"',
        'sed -n "1,320p" packages/routing/src/types.ts',
        'echo "" && echo "---ROUTING IMPLEMENTATION---"',
        'sed -n "1,360p" packages/routing/src/routing.ts',
        'echo "" && echo "---COORDINATION TYPES---"',
        'sed -n "1,320p" packages/coordination/src/types.ts',
        'echo "" && echo "---COORDINATION IMPLEMENTATION---"',
        'sed -n "1,420p" packages/coordination/src/coordination.ts',
        'echo "" && echo "---CONNECTIVITY TYPES---"',
        'sed -n "1,260p" packages/connectivity/src/types.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-coord-routing-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-coord-routing-context'],
      task: `Using the routing review, coordination hardening review, and current package implementations below, write a focused v1 coordination↔routing integration plan.

{{steps.read-coord-routing-context.output}}

Write docs/architecture/v1-coordination-routing-integration-plan.md.

The plan must:
1. define the exact v1 integration scope
2. specify how CoordinatorConfig gains routing capability without owning routing
3. define the clean shared contract for RequestedRoutingMode to avoid drift
4. keep connectivity escalation and routing selection conceptually separate
5. specify the minimum integration tests to add now

End the document with V1_COORD_ROUTING_INTEGRATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-coordination-routing-integration-plan.md' },
    })

    .step('implement-coord-routing-integration', {
      agent: 'implement-codex',
      dependsOn: ['lead-coord-routing-plan'],
      task: `Implement the bounded v1 coordination↔routing integration using docs/architecture/v1-coordination-routing-integration-plan.md.

Required work:
- add a clean router dependency/interface to coordination if needed
- integrate pre-delegation mode selection in a bounded way
- reconcile RequestedRoutingMode usage so drift risk is reduced or eliminated
- add the minimum integration tests required to prove useful v1 behavior
- keep changes narrow: do not redesign routing or coordination broadly

Expected files to update may include:
- packages/coordination/src/types.ts
- packages/coordination/src/coordination.ts
- packages/coordination/src/coordination.test.ts
- packages/routing/src/types.ts
- packages/routing/src/routing.ts
- packages/routing/src/routing.test.ts
- docs/architecture/v1-coordination-routing-integration-plan.md

Requirements:
- no transport changes
- no memory changes
- no product-specific routing policies
- no connectivity ownership change
- keep the package boundaries clean and v1-bounded

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- append COORD_ROUTING_INTEGRATION_IMPLEMENTED to docs/architecture/v1-coordination-routing-integration-plan.md`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-coordination-routing-integration-plan.md' },
    })

    .step('review-coord-routing-integration', {
      agent: 'review-claude',
      dependsOn: ['implement-coord-routing-integration'],
      task: `Review the coordination↔routing integration.

Read:
- docs/architecture/v1-coordination-routing-integration-plan.md
- packages/coordination/src/types.ts
- packages/coordination/src/coordination.ts
- packages/coordination/src/coordination.test.ts
- packages/routing/src/types.ts
- packages/routing/src/routing.ts
- packages/routing/src/routing.test.ts
- docs/architecture/v1-routing-review-verdict.md
- docs/architecture/v1-coordination-hardening-review-verdict.md

Assess:
1. Does coordination now consume routing in a clean, bounded way?
2. Is RequestedRoutingMode drift reduced adequately?
3. Are routing selection and connectivity escalation still separated properly?
4. Do the tests prove useful v1 behavior?
5. What follow-ups remain before memory integration or product adoption?

Write docs/architecture/v1-coordination-routing-integration-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_COORD_ROUTING_INTEGRATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-coordination-routing-integration-review-verdict.md' },
    })

    .step('verify-coord-routing-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-coord-routing-integration'],
      command: [
        'test -f docs/architecture/v1-coordination-routing-integration-plan.md',
        'test -f docs/architecture/v1-coordination-routing-integration-review-verdict.md',
        'grep -q "V1_COORD_ROUTING_INTEGRATION_PLAN_READY" docs/architecture/v1-coordination-routing-integration-plan.md',
        'grep -q "COORD_ROUTING_INTEGRATION_IMPLEMENTED" docs/architecture/v1-coordination-routing-integration-plan.md',
        'grep -q "V1_COORD_ROUTING_INTEGRATION_REVIEW_COMPLETE" docs/architecture/v1-coordination-routing-integration-review-verdict.md',
        'echo "V1_COORD_ROUTING_INTEGRATION_VERIFIED"',
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
