import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('followup-v1-byoh-relay-native-proof')
    .description('Follow up the first local BYOH proof by making Relay participation mandatory and routing specialist validation through Relay-native coordination.')
    .pattern('supervisor')
    .channel('wf-followup-v1-byoh-relay-native-proof')
    .maxConcurrency(4)
    .timeout(8_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Investigates the follow-up slice needed to make Relay structurally central to the BYOH proof.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implements the Relay-native BYOH proof follow-up slice.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews whether Relay is now structurally central to the proof.',
      retries: 1,
    })

    .step('read-byoh-followup-context', {
      type: 'deterministic',
      command: [
        'echo "---BYOH REVIEW VERDICT---"',
        'sed -n "1,320p" docs/architecture/v1-byoh-local-relay-sdk-review-verdict.md',
        'echo "" && echo "---BYOH IMPLEMENTATION BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md',
        'echo "" && echo "---PROOF HARNESS---"',
        'sed -n "1,360p" packages/harness/src/adapter/proof/byoh-local-proof.ts',
        'echo "" && echo "---VALIDATION SPECIALIST---"',
        'sed -n "1,260p" packages/harness/src/adapter/proof/validation-specialist.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-byoh-relay-native-followup-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-byoh-followup-context'],
      task: `Define the exact follow-up slice needed to make Relay structurally central to the BYOH proof.

{{steps.read-byoh-followup-context.output}}

Write:
- docs/architecture/v1-byoh-relay-native-followup-boundary.md
- docs/architecture/v1-byoh-relay-native-followup-no-regression-checklist.md
- docs/architecture/v1-byoh-relay-native-followup-proof-plan.md

Requirements:
1. make Relay participation mandatory in the proof harness
2. route specialist validation through Relay-native coordination rather than direct local invocation
3. keep connectivity as helper rather than primary coordination path
4. define exact proof that fails when Relay is removed
5. keep the slice bounded to the existing Claude Code proof follow-up

End with V1_BYOH_RELAY_NATIVE_FOLLOWUP_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-byoh-relay-native-followup-boundary.md' },
    })

    .step('implement-byoh-relay-native-followup', {
      agent: 'impl-codex',
      dependsOn: ['define-byoh-relay-native-followup-boundary'],
      task: `Implement the bounded Relay-native BYOH follow-up slice.

Read:
- docs/architecture/v1-byoh-relay-native-followup-boundary.md
- docs/architecture/v1-byoh-relay-native-followup-no-regression-checklist.md
- docs/architecture/v1-byoh-relay-native-followup-proof-plan.md

Requirements:
1. keep the slice bounded to making Relay structurally central
2. do not broaden to multiple backends
3. add deterministic tests/proof showing Relay is required
4. preserve the existing Claude Code adapter and useful proof work

Write files to disk.
End your final summary with V1_BYOH_RELAY_NATIVE_FOLLOWUP_IMPLEMENTATION_READY.`,
      verification: { type: 'exit_code' },
    })

    .step('validate-byoh-relay-native-followup', {
      type: 'deterministic',
      dependsOn: ['implement-byoh-relay-native-followup'],
      command: [
        'npm run build --workspace @agent-assistant/harness 2>&1 || true',
        'npm run test --workspace @agent-assistant/harness 2>&1 || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })

    .step('review-byoh-relay-native-followup', {
      agent: 'review-codex',
      dependsOn: ['validate-byoh-relay-native-followup'],
      task: `Review the Relay-native BYOH follow-up slice.

Read:
- docs/architecture/v1-byoh-relay-native-followup-boundary.md
- changed files
- validation output:
{{steps.validate-byoh-relay-native-followup.output}}

Write:
- docs/architecture/v1-byoh-relay-native-followup-review-verdict.md

Assess:
1. Is Relay now structurally central?
2. Does specialist coordination really occur through Relay-native flow?
3. Is connectivity still secondary/helper rather than primary?
4. What remains as the next continuation point?

End with V1_BYOH_RELAY_NATIVE_FOLLOWUP_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-byoh-relay-native-followup-review-verdict.md' },
    })

    .step('verify-byoh-relay-native-followup-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-byoh-relay-native-followup'],
      command: [
        'test -f docs/architecture/v1-byoh-relay-native-followup-boundary.md',
        'test -f docs/architecture/v1-byoh-relay-native-followup-no-regression-checklist.md',
        'test -f docs/architecture/v1-byoh-relay-native-followup-proof-plan.md',
        'test -f docs/architecture/v1-byoh-relay-native-followup-review-verdict.md',
        'grep -q "V1_BYOH_RELAY_NATIVE_FOLLOWUP_REVIEW_COMPLETE" docs/architecture/v1-byoh-relay-native-followup-review-verdict.md',
        'echo "V1_BYOH_RELAY_NATIVE_FOLLOWUP_VERIFIED"',
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
