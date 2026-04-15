import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('implement-v1-byoh-local-relay-sdk-proof')
    .description('Define and implement the first local BYOH proof using Agent Relay SDK as the proving environment and one external/local execution backend through the execution-adapter seam.')
    .pattern('supervisor')
    .channel('wf-implement-v1-byoh-local-relay-sdk-proof')
    .maxConcurrency(4)
    .timeout(8_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Investigates and defines the exact first local BYOH proof boundary and no-regression constraints.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implements the first bounded local BYOH proof slice using the approved boundary.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the implementation for boundedness, Relay-native coordination, and local proof credibility.',
      retries: 1,
    })

    .step('read-byoh-local-proof-context', {
      type: 'deterministic',
      command: [
        'echo "---BYOH RELAY SDK PROOF BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/v1-byoh-local-relay-sdk-proof-boundary.md',
        'echo "" && echo "---EXECUTION ADAPTER BOUNDARY---"',
        'sed -n "1,260p" docs/architecture/v1-execution-adapter-boundary.md',
        'echo "" && echo "---EXECUTION ADAPTER PROOF SLICE---"',
        'sed -n "1,260p" docs/architecture/v1-execution-adapter-proof-slice.md',
        'echo "" && echo "---RUNTIME PRIMITIVE MAP---"',
        'sed -n "1,260p" docs/architecture/agent-assistant-runtime-primitive-map.md',
        'echo "" && echo "---HARNESS ADAPTER CODE---"',
        'find packages/harness/src/adapter -maxdepth 3 -type f | sort | xargs -I{} sh -c "echo --- {}; sed -n \"1,240p\" {}"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-byoh-local-proof-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-byoh-local-proof-context'],
      task: `Define the exact first bounded local BYOH implementation boundary from the provided Relay SDK proof boundary.

{{steps.read-byoh-local-proof-context.output}}

Write:
- docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md
- docs/architecture/v1-byoh-local-relay-sdk-no-regression-checklist.md
- docs/architecture/v1-byoh-local-relay-sdk-proof-plan.md

Requirements:
1. choose one local external backend only
2. make Agent Relay SDK central to the proving environment
3. preserve Relay-native coordination as primary
4. specify exact implementation files to change or add
5. keep the slice useful for local Sage/NightCTO testing but bounded

End the boundary doc with V1_BYOH_LOCAL_RELAY_SDK_IMPLEMENTATION_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md' },
    })

    .step('implement-byoh-local-proof-slice', {
      agent: 'impl-codex',
      dependsOn: ['define-byoh-local-proof-boundary'],
      task: `Implement the first bounded local BYOH proof slice.

Read:
- docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md
- docs/architecture/v1-byoh-local-relay-sdk-no-regression-checklist.md
- docs/architecture/v1-byoh-local-relay-sdk-proof-plan.md

Requirements:
1. implement only the bounded first local BYOH slice
2. keep Relay-native coordination central
3. use Agent Relay SDK as the proving environment where appropriate
4. add deterministic tests or proof artifacts
5. do not broaden into cloud or multiple backends

Write files to disk and keep the slice surgical.
End your final summary with V1_BYOH_LOCAL_RELAY_SDK_IMPLEMENTATION_READY.`,
      verification: { type: 'exit_code' },
    })

    .step('validate-byoh-local-proof-slice', {
      type: 'deterministic',
      dependsOn: ['implement-byoh-local-proof-slice'],
      command: [
        'npm run build 2>&1 || true',
        'npm test 2>&1 || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })

    .step('review-byoh-local-proof-slice', {
      agent: 'review-codex',
      dependsOn: ['validate-byoh-local-proof-slice'],
      task: `Review the first local BYOH proof slice.

Read:
- docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md
- changed files
- validation output:
{{steps.validate-byoh-local-proof-slice.output}}

Write:
- docs/architecture/v1-byoh-local-relay-sdk-review-verdict.md

Assess:
1. did the slice stay bounded?
2. is Agent Relay SDK truly central to the proving setup?
3. is Relay-native coordination preserved?
4. is the slice genuinely useful for local proving?
5. what is the next continuation point?

End with V1_BYOH_LOCAL_RELAY_SDK_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-byoh-local-relay-sdk-review-verdict.md' },
    })

    .step('verify-byoh-local-proof-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-byoh-local-proof-slice'],
      command: [
        'test -f docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md',
        'test -f docs/architecture/v1-byoh-local-relay-sdk-no-regression-checklist.md',
        'test -f docs/architecture/v1-byoh-local-relay-sdk-proof-plan.md',
        'test -f docs/architecture/v1-byoh-local-relay-sdk-review-verdict.md',
        'grep -q "V1_BYOH_LOCAL_RELAY_SDK_REVIEW_COMPLETE" docs/architecture/v1-byoh-local-relay-sdk-review-verdict.md',
        'echo "V1_BYOH_LOCAL_RELAY_SDK_PROOF_VERIFIED"',
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
