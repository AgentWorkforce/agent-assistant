import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-implement-v1-execution-adapter-proof')
    .description('Implement the first internal execution-adapter proof so canonical Agent Assistant turn intent flows through an adapter seam into the current first-party harness, with 80-to-100 validation and explicit parity proof.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-implement-execution-adapter-proof')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead architect for the internal execution-adapter proof, responsible for keeping the slice bounded to the proof contract and preserving canonical product/runtime semantics outside the adapter seam.',
      retries: 1,
    })
    .agent('impl-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the internal execution-adapter proof against the current first-party harness, including tests and proof artifacts.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the execution-adapter proof for boundary discipline, parity strength, capability negotiation realism, and validation quality.',
      retries: 1,
    })

    .step('read-execution-adapter-proof-context', {
      type: 'deterministic',
      command: [
        'echo "---EXECUTION ADAPTER BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/v1-execution-adapter-boundary.md',
        'echo "" && echo "---EXECUTION ADAPTER SPEC---"',
        'sed -n "1,360p" docs/specs/v1-execution-adapter-spec.md',
        'echo "" && echo "---EXECUTION ADAPTER PROOF SLICE---"',
        'sed -n "1,320p" docs/architecture/v1-execution-adapter-proof-slice.md',
        'echo "" && echo "---EXECUTION ADAPTER PROOF CONTRACT---"',
        'sed -n "1,360p" docs/architecture/v1-execution-adapter-proof-contract.md',
        'echo "" && echo "---EXECUTION ADAPTER REVIEW---"',
        'sed -n "1,220p" docs/architecture/v1-execution-adapter-proof-review-verdict.md',
        'echo "" && echo "---HARNESS PACKAGE---"',
        'find packages/harness -maxdepth 3 -type f | sort | xargs -I{} sh -c "echo --- {}; sed -n \"1,220p\" {}"',
        'echo "" && echo "---TURN CONTEXT PACKAGE---"',
        'find packages/turn-context -maxdepth 3 -type f | sort | xargs -I{} sh -c "echo --- {}; sed -n \"1,220p\" {}"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-execution-adapter-proof-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-execution-adapter-proof-context'],
      task: `Define the exact implementation plan for the first internal execution-adapter proof using the approved docs below.

{{steps.read-execution-adapter-proof-context.output}}

Write docs/architecture/v1-execution-adapter-proof-implementation-plan.md.

The plan must explicitly define:
1. package/files to add or edit
2. the canonical ExecutionRequest / ExecutionResult / adapter contract surfaces to prove first
3. how the current harness is wrapped as backend id agent-assistant-harness
4. parity cases that must pass before calling the seam real
5. what stays deferred

Keep this tightly bounded to the proof slice. End with V1_EXECUTION_ADAPTER_PROOF_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-execution-adapter-proof-implementation-plan.md' },
    })

    .step('implement-execution-adapter-proof', {
      agent: 'impl-claude',
      dependsOn: ['define-execution-adapter-proof-plan'],
      task: `Implement the first internal execution-adapter proof.

Binding docs:
- docs/architecture/v1-execution-adapter-boundary.md
- docs/specs/v1-execution-adapter-spec.md
- docs/architecture/v1-execution-adapter-proof-slice.md
- docs/architecture/v1-execution-adapter-proof-contract.md
- docs/architecture/v1-execution-adapter-proof-implementation-plan.md

Requirements:
- implement the minimal canonical execution request/result seam
- implement one internal adapter for backend id agent-assistant-harness
- truthfully implement capability description and negotiation
- translate canonical requests into current harness execution
- normalize harness outputs back into canonical execution results
- add meaningful parity tests for the required proof cases
- keep the slice bounded and internal; do not broaden to external providers yet

IMPORTANT:
- write files to disk
- do not overbuild into multi-provider routing or broad external integration
- end your final summary with V1_EXECUTION_ADAPTER_PROOF_IMPLEMENTED`,
      verification: { type: 'exit_code' },
    })

    .step('run-execution-adapter-tests-first-pass', {
      type: 'deterministic',
      dependsOn: ['implement-execution-adapter-proof'],
      command: 'npm test -w @agent-assistant/harness 2>&1',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-execution-adapter-test-failures', {
      agent: 'impl-claude',
      dependsOn: ['run-execution-adapter-tests-first-pass'],
      task: `Check the first-pass execution-adapter proof test output and fix failures until the proof is green.

Test output:
{{steps.run-execution-adapter-tests-first-pass.output}}

If tests already passed, do nothing.
If there are failures:
1. read the failing test(s) and source files
2. fix the implementation or tests as needed
3. re-run the relevant tests
4. keep fixing until the proof is green

Also ensure build still passes for the affected package(s).
End with V1_EXECUTION_ADAPTER_TEST_FIX_COMPLETE when done.`,
      verification: { type: 'exit_code' },
    })

    .step('validate-execution-adapter-proof', {
      type: 'deterministic',
      dependsOn: ['fix-execution-adapter-test-failures'],
      command: [
        'npm run build -w @agent-assistant/harness',
        'npm test -w @agent-assistant/harness',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-execution-adapter-proof', {
      agent: 'review-codex',
      dependsOn: ['validate-execution-adapter-proof'],
      task: `Review the implemented internal execution-adapter proof.

Read:
- docs/architecture/v1-execution-adapter-boundary.md
- docs/specs/v1-execution-adapter-spec.md
- docs/architecture/v1-execution-adapter-proof-slice.md
- docs/architecture/v1-execution-adapter-proof-contract.md
- docs/architecture/v1-execution-adapter-proof-implementation-plan.md
- changed files implementing the proof
- validation output:
{{steps.validate-execution-adapter-proof.output}}

Assess:
1. is the seam now real rather than merely documented?
2. did the slice stay bounded to the first-party harness adapter proof?
3. is capability negotiation meaningful enough for v1?
4. are the parity cases and tests strong enough?
5. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-execution-adapter-proof-package-review-verdict.md.
End with V1_EXECUTION_ADAPTER_PROOF_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-execution-adapter-proof-package-review-verdict.md' },
    })

    .step('verify-execution-adapter-proof-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-execution-adapter-proof'],
      command: [
        'test -f docs/architecture/v1-execution-adapter-proof-implementation-plan.md',
        'test -f docs/architecture/v1-execution-adapter-proof-package-review-verdict.md',
        'grep -q "V1_EXECUTION_ADAPTER_PROOF_PLAN_READY" docs/architecture/v1-execution-adapter-proof-implementation-plan.md',
        'grep -q "V1_EXECUTION_ADAPTER_PROOF_REVIEW_COMPLETE" docs/architecture/v1-execution-adapter-proof-package-review-verdict.md',
        'echo "V1_EXECUTION_ADAPTER_PROOF_VERIFIED"',
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
