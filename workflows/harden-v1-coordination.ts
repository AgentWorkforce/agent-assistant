const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-harden-v1-coordination')
    .description('Harden the v1 coordination package by addressing the highest-value review follow-ups before broader product integration.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-harden-coordination')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead hardening architect for v1 coordination, responsible for turning the review follow-ups into a narrow implementation patch plan.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the targeted v1 coordination hardening patch: selected-audience resolver wiring, highest-value missing tests, and small spec/API alignment fixes.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the hardened coordination package to confirm the key follow-ups were actually addressed and that the package is stronger for product integration.',
      retries: 1,
    })

    .step('read-coordination-hardening-context', {
      type: 'deterministic',
      command: [
        'echo "---COORDINATION REVIEW VERDICT---"',
        'sed -n "1,320p" docs/architecture/v1-coordination-review-verdict.md',
        'echo "" && echo "---COORDINATION PLAN---"',
        'sed -n "1,320p" docs/architecture/v1-coordination-implementation-plan.md',
        'echo "" && echo "---COORDINATION TYPES---"',
        'sed -n "1,360p" packages/coordination/src/types.ts',
        'echo "" && echo "---COORDINATION IMPLEMENTATION---"',
        'sed -n "1,420p" packages/coordination/src/coordination.ts',
        'echo "" && echo "---COORDINATION TESTS---"',
        'sed -n "1,420p" packages/coordination/src/coordination.test.ts',
        'echo "" && echo "---CONNECTIVITY TYPES---"',
        'sed -n "1,260p" packages/connectivity/src/types.ts',
        'echo "" && echo "---CONNECTIVITY IMPLEMENTATION---"',
        'sed -n "1,320p" packages/connectivity/src/connectivity.ts',
        'echo "" && echo "---COORDINATION README---"',
        'sed -n "1,260p" packages/coordination/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-coordination-hardening-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-coordination-hardening-context'],
      task: `Using the coordination review verdict and current package implementation below, write a narrow hardening plan.

{{steps.read-coordination-hardening-context.output}}

Write docs/architecture/v1-coordination-hardening-plan.md.

The plan must:
1. prioritize the exact review items to address now
2. keep scope narrow — no new package design work
3. require wiring registerSelectedResolver appropriately
4. specify which missing tests to add now
5. decide how to handle the validatePlan / validateDelegationPlan naming mismatch and the turnId prefix mismatch

End the document with V1_COORDINATION_HARDENING_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-coordination-hardening-plan.md' },
    })

    .step('implement-coordination-hardening', {
      agent: 'implement-codex',
      dependsOn: ['lead-coordination-hardening-plan'],
      task: `Implement the v1 coordination hardening patch using docs/architecture/v1-coordination-hardening-plan.md.

Required work:
- wire selected-audience resolution so coordination registers the resolver with connectivity
- add the highest-value missing tests from the review verdict
- resolve the spec/API mismatches chosen in the plan
- make any tiny docs/code clarifications required by the plan
- keep changes narrow and focused on the existing coordination package

Expected files to update may include:
- packages/coordination/src/index.ts
- packages/coordination/src/types.ts
- packages/coordination/src/coordination.ts
- packages/coordination/src/coordination.test.ts
- packages/coordination/README.md
- docs/architecture/v1-coordination-hardening-plan.md

Requirements:
- no broad redesign
- no new package creation
- no routing, memory, or surface implementation added here
- keep the package runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- append COORDINATION_HARDENING_IMPLEMENTED to docs/architecture/v1-coordination-hardening-plan.md`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-coordination-hardening-plan.md' },
    })

    .step('review-coordination-hardening', {
      agent: 'review-claude',
      dependsOn: ['implement-coordination-hardening'],
      task: `Review the hardened v1 coordination package.

Read:
- docs/architecture/v1-coordination-hardening-plan.md
- docs/architecture/v1-coordination-review-verdict.md
- packages/coordination/src/index.ts
- packages/coordination/src/types.ts
- packages/coordination/src/coordination.ts
- packages/coordination/src/coordination.test.ts
- packages/coordination/README.md

Assess:
1. Were the highest-value review follow-ups actually addressed?
2. Is selected-audience resolution now properly wired?
3. Is test coverage meaningfully stronger where it matters?
4. Are the key spec/API mismatches now resolved or intentionally documented?
5. What follow-ups remain, if any?

Write docs/architecture/v1-coordination-hardening-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_COORDINATION_HARDENING_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-coordination-hardening-review-verdict.md' },
    })

    .step('verify-coordination-hardening-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-coordination-hardening'],
      command: [
        'test -f docs/architecture/v1-coordination-hardening-plan.md',
        'test -f packages/coordination/src/index.ts',
        'test -f packages/coordination/src/types.ts',
        'test -f packages/coordination/src/coordination.ts',
        'test -f packages/coordination/src/coordination.test.ts',
        'test -f packages/coordination/README.md',
        'test -f docs/architecture/v1-coordination-hardening-review-verdict.md',
        'grep -q "V1_COORDINATION_HARDENING_PLAN_READY" docs/architecture/v1-coordination-hardening-plan.md',
        'grep -q "COORDINATION_HARDENING_IMPLEMENTED" docs/architecture/v1-coordination-hardening-plan.md',
        'grep -q "V1_COORDINATION_HARDENING_REVIEW_COMPLETE" docs/architecture/v1-coordination-hardening-review-verdict.md',
        'echo "V1_COORDINATION_HARDENING_VERIFIED"',
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
