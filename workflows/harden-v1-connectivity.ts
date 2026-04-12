const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-harden-v1-connectivity')
    .description('Harden the v1 connectivity package by addressing the highest-value review follow-ups before broader integration work proceeds.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-harden-connectivity')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead hardening architect for the v1 connectivity package, responsible for turning the review follow-ups into a narrow implementation patch plan.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the targeted v1 connectivity hardening patch: tsconfig strictness, missing tests, API surface decision, and minor clarifications.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the hardened connectivity package to confirm the key follow-ups were actually addressed and the package is stronger for downstream use.',
      retries: 1,
    })

    .step('read-connectivity-hardening-context', {
      type: 'deterministic',
      command: [
        'echo "---CONNECTIVITY REVIEW VERDICT---"',
        'sed -n "1,360p" docs/architecture/v1-connectivity-package-review-verdict.md',
        'echo "" && echo "---CONNECTIVITY SPEC---"',
        'sed -n "1,320p" docs/specs/v1-connectivity-spec.md',
        'echo "" && echo "---CONNECTIVITY PLAN---"',
        'sed -n "1,320p" docs/architecture/v1-connectivity-package-implementation-plan.md',
        'echo "" && echo "---CONNECTIVITY TYPES---"',
        'sed -n "1,360p" packages/connectivity/src/types.ts',
        'echo "" && echo "---CONNECTIVITY IMPLEMENTATION---"',
        'sed -n "1,420p" packages/connectivity/src/connectivity.ts',
        'echo "" && echo "---CONNECTIVITY TESTS---"',
        'sed -n "1,420p" packages/connectivity/src/connectivity.test.ts',
        'echo "" && echo "---CONNECTIVITY TSCONFIG---"',
        'cat packages/connectivity/tsconfig.json',
        'echo "" && echo "---CONNECTIVITY README---"',
        'sed -n "1,280p" packages/connectivity/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-connectivity-hardening-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-connectivity-hardening-context'],
      task: `Using the connectivity review verdict and current package implementation below, write a narrow hardening plan.

{{steps.read-connectivity-hardening-context.output}}

Write docs/architecture/v1-connectivity-hardening-plan.md.

The plan must:
1. prioritize the exact review items to address now
2. keep scope narrow — no new package design work
3. specify which missing tests to add now
4. decide whether extra exported constants stay or go, and state that clearly
5. require exactOptionalPropertyTypes if still missing

End the document with V1_CONNECTIVITY_HARDENING_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-connectivity-hardening-plan.md' },
    })

    .step('implement-connectivity-hardening', {
      agent: 'implement-codex',
      dependsOn: ['lead-connectivity-hardening-plan'],
      task: `Implement the v1 connectivity hardening patch using docs/architecture/v1-connectivity-hardening-plan.md.

Required work:
- update packages/connectivity/tsconfig.json to strengthen optional property semantics if needed
- add the highest-value missing tests from the review verdict
- resolve the public API decision for extra exported constants (either document intentionally or trim)
- add any tiny code/docs clarifications required by the plan
- keep changes narrow and focused on the package already implemented

Expected files to update may include:
- packages/connectivity/tsconfig.json
- packages/connectivity/src/index.ts
- packages/connectivity/src/types.ts
- packages/connectivity/src/connectivity.ts
- packages/connectivity/src/connectivity.test.ts
- packages/connectivity/README.md
- docs/architecture/v1-connectivity-hardening-plan.md

Requirements:
- no broad redesign
- no new package creation
- no routing implementation added here
- keep the package runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- append CONNECTIVITY_HARDENING_IMPLEMENTED to docs/architecture/v1-connectivity-hardening-plan.md`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-connectivity-hardening-plan.md' },
    })

    .step('review-connectivity-hardening', {
      agent: 'review-claude',
      dependsOn: ['implement-connectivity-hardening'],
      task: `Review the hardened v1 connectivity package.

Read:
- docs/architecture/v1-connectivity-hardening-plan.md
- docs/architecture/v1-connectivity-package-review-verdict.md
- packages/connectivity/tsconfig.json
- packages/connectivity/src/index.ts
- packages/connectivity/src/types.ts
- packages/connectivity/src/connectivity.ts
- packages/connectivity/src/connectivity.test.ts
- packages/connectivity/README.md

Assess:
1. Were the most important review follow-ups actually addressed?
2. Is the package now stronger for downstream integration?
3. Are boundaries still clean?
4. What follow-ups remain, if any?

Write docs/architecture/v1-connectivity-hardening-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_CONNECTIVITY_HARDENING_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-connectivity-hardening-review-verdict.md' },
    })

    .step('verify-connectivity-hardening-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-connectivity-hardening'],
      command: [
        'test -f docs/architecture/v1-connectivity-hardening-plan.md',
        'test -f packages/connectivity/tsconfig.json',
        'test -f packages/connectivity/src/index.ts',
        'test -f packages/connectivity/src/types.ts',
        'test -f packages/connectivity/src/connectivity.ts',
        'test -f packages/connectivity/src/connectivity.test.ts',
        'test -f packages/connectivity/README.md',
        'test -f docs/architecture/v1-connectivity-hardening-review-verdict.md',
        'grep -q "V1_CONNECTIVITY_HARDENING_PLAN_READY" docs/architecture/v1-connectivity-hardening-plan.md',
        'grep -q "CONNECTIVITY_HARDENING_IMPLEMENTED" docs/architecture/v1-connectivity-hardening-plan.md',
        'grep -q "V1_CONNECTIVITY_HARDENING_REVIEW_COMPLETE" docs/architecture/v1-connectivity-hardening-review-verdict.md',
        'echo "V1_CONNECTIVITY_HARDENING_VERIFIED"',
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
