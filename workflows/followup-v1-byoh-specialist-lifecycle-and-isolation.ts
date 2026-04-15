import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('followup-v1-byoh-specialist-lifecycle-and-isolation')
    .description('Third BYOH hardening slice: make the Relay-native specialist lifecycle fully awaited, failure-transparent, and thread-safe under concurrent proof runs.')
    .pattern('supervisor')
    .channel('wf-followup-v1-byoh-specialist-lifecycle-and-isolation')
    .maxConcurrency(4)
    .timeout(8_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Investigates the next hardening slice needed for specialist lifecycle correctness and thread-safe Relay-native coordination.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implements the specialist lifecycle and isolation hardening slice for the BYOH proof.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews whether the specialist lifecycle is now failure-transparent and concurrent-safe.',
      retries: 1,
    })

    .step('read-byoh-third-slice-context', {
      type: 'deterministic',
      command: [
        'echo "---RELAY-NATIVE FOLLOWUP REVIEW---"',
        'sed -n "1,320p" docs/architecture/v1-byoh-relay-native-followup-review-verdict.md',
        'echo "" && echo "---RELAY-NATIVE FOLLOWUP BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/v1-byoh-relay-native-followup-boundary.md',
        'echo "" && echo "---BYOH LOCAL PROOF---"',
        'sed -n "1,420p" packages/harness/src/adapter/proof/byoh-local-proof.ts',
        'echo "" && echo "---VALIDATION SPECIALIST---"',
        'sed -n "1,360p" packages/harness/src/adapter/proof/validation-specialist.ts',
        'echo "" && echo "---BYOH PROOF TESTS---"',
        'sed -n "1,420p" packages/harness/src/adapter/proof/byoh-local-proof.test.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-byoh-third-slice-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-byoh-third-slice-context'],
      task: `Define the third BYOH hardening slice from the follow-up review verdict.

{{steps.read-byoh-third-slice-context.output}}

Write:
- docs/architecture/v1-byoh-specialist-lifecycle-boundary.md
- docs/architecture/v1-byoh-specialist-lifecycle-no-regression-checklist.md
- docs/architecture/v1-byoh-specialist-lifecycle-proof-plan.md

Requirements:
1. make the specialist lifecycle fully awaited and failure-transparent
2. eliminate swallowed specialist-path errors
3. thread-scope specialist subscription and verdict flow for concurrency safety
4. add proof/tests for concurrent or mismatched-thread conditions
5. keep the slice bounded to proof hardening only

End with V1_BYOH_SPECIALIST_LIFECYCLE_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-byoh-specialist-lifecycle-boundary.md' },
    })

    .step('implement-byoh-third-slice', {
      agent: 'impl-codex',
      dependsOn: ['define-byoh-third-slice-boundary'],
      task: `Implement the third BYOH hardening slice.

Read:
- docs/architecture/v1-byoh-specialist-lifecycle-boundary.md
- docs/architecture/v1-byoh-specialist-lifecycle-no-regression-checklist.md
- docs/architecture/v1-byoh-specialist-lifecycle-proof-plan.md

Requirements:
1. keep the slice bounded to specialist lifecycle/error/concurrency hardening
2. preserve the existing Claude Code adapter and Relay-native proof shape
3. add deterministic tests that prove thread isolation and surfaced failures
4. do not broaden into new backends or cloud concerns

Write files to disk.
End your final summary with V1_BYOH_SPECIALIST_LIFECYCLE_IMPLEMENTATION_READY.`,
      verification: { type: 'exit_code' },
    })

    .step('validate-byoh-third-slice', {
      type: 'deterministic',
      dependsOn: ['implement-byoh-third-slice'],
      command: [
        'npm run build --workspace @agent-assistant/harness 2>&1 || true',
        'npm run test --workspace @agent-assistant/harness 2>&1 || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })

    .step('review-byoh-third-slice', {
      agent: 'review-codex',
      dependsOn: ['validate-byoh-third-slice'],
      task: `Review the third BYOH hardening slice.

Read:
- docs/architecture/v1-byoh-specialist-lifecycle-boundary.md
- changed files
- validation output:
{{steps.validate-byoh-third-slice.output}}

Write:
- docs/architecture/v1-byoh-specialist-lifecycle-review-verdict.md

Assess:
1. Is specialist lifecycle now fully awaited?
2. Are failures surfaced instead of swallowed?
3. Is thread/concurrency isolation materially improved?
4. What is the next continuation point after this slice?

End with V1_BYOH_SPECIALIST_LIFECYCLE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-byoh-specialist-lifecycle-review-verdict.md' },
    })

    .step('verify-byoh-third-slice-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-byoh-third-slice'],
      command: [
        'test -f docs/architecture/v1-byoh-specialist-lifecycle-boundary.md',
        'test -f docs/architecture/v1-byoh-specialist-lifecycle-no-regression-checklist.md',
        'test -f docs/architecture/v1-byoh-specialist-lifecycle-proof-plan.md',
        'test -f docs/architecture/v1-byoh-specialist-lifecycle-review-verdict.md',
        'grep -q "V1_BYOH_SPECIALIST_LIFECYCLE_REVIEW_COMPLETE" docs/architecture/v1-byoh-specialist-lifecycle-review-verdict.md',
        'echo "V1_BYOH_SPECIALIST_LIFECYCLE_VERIFIED"',
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
