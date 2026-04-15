import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('implement-v1-agent-inbox')
    .description('Define and implement the first bounded Agent Inbox slice for trusted outsider ingestion, separate from Relay-native communication.')
    .pattern('supervisor')
    .channel('wf-implement-v1-agent-inbox')
    .maxConcurrency(4)
    .timeout(8_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Investigates and defines the first bounded Agent Inbox implementation slice.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implements the first bounded Agent Inbox slice.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the first Agent Inbox slice for boundedness and architecture fit.',
      retries: 1,
    })

    .step('read-agent-inbox-context', {
      type: 'deterministic',
      command: [
        'echo "---AGENT INBOX BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/v1-agent-inbox-boundary.md',
        'echo "" && echo "---INBOX VS RELAY COMMUNICATE---"',
        'sed -n "1,260p" docs/architecture/agent-inbox-and-relay-native-communication.md',
        'echo "" && echo "---RELAY COMMUNICATE LAYER---"',
        'sed -n "1,260p" docs/architecture/relay-communicate-and-connectivity-layer.md',
        'echo "" && echo "---HUMAN SPEC---"',
        'sed -n "1,260p" docs/specs/agent-assistant-human-spec.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-agent-inbox-implementation-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-agent-inbox-context'],
      task: `Define the exact first bounded Agent Inbox implementation slice.

{{steps.read-agent-inbox-context.output}}

Write:
- docs/architecture/v1-agent-inbox-implementation-boundary.md
- docs/architecture/v1-agent-inbox-no-regression-checklist.md
- docs/architecture/v1-agent-inbox-proof-plan.md

Requirements:
1. keep the slice bounded to trusted outsider ingestion
2. keep Relay-native communication explicitly out of scope for this slice
3. define the normalized inbox item shape
4. define one or two bounded routes into memory and/or turn-context candidate generation
5. specify exact files to add/change

End with V1_AGENT_INBOX_IMPLEMENTATION_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-agent-inbox-implementation-boundary.md' },
    })

    .step('implement-agent-inbox-slice', {
      agent: 'impl-codex',
      dependsOn: ['define-agent-inbox-implementation-boundary'],
      task: `Implement the first bounded Agent Inbox slice.

Read:
- docs/architecture/v1-agent-inbox-implementation-boundary.md
- docs/architecture/v1-agent-inbox-no-regression-checklist.md
- docs/architecture/v1-agent-inbox-proof-plan.md

Requirements:
1. keep the slice bounded and typed
2. do not expand into full UI/platform provisioning
3. preserve the separation from Relay-native communication
4. add deterministic tests and documentation

Write files to disk.
End your final summary with V1_AGENT_INBOX_IMPLEMENTATION_READY.`,
      verification: { type: 'exit_code' },
    })

    .step('validate-agent-inbox-slice', {
      type: 'deterministic',
      dependsOn: ['implement-agent-inbox-slice'],
      command: [
        'npm run build 2>&1 || true',
        'npm test 2>&1 || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })

    .step('review-agent-inbox-slice', {
      agent: 'review-codex',
      dependsOn: ['validate-agent-inbox-slice'],
      task: `Review the first Agent Inbox slice.

Read:
- docs/architecture/v1-agent-inbox-implementation-boundary.md
- changed files
- validation output:
{{steps.validate-agent-inbox-slice.output}}

Write:
- docs/architecture/v1-agent-inbox-review-verdict.md

Assess:
1. did the slice stay bounded?
2. is the inbox shape useful?
3. does it preserve separation from Relay-native communication?
4. what is the next continuation point?

End with V1_AGENT_INBOX_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-agent-inbox-review-verdict.md' },
    })

    .step('verify-agent-inbox-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-agent-inbox-slice'],
      command: [
        'test -f docs/architecture/v1-agent-inbox-implementation-boundary.md',
        'test -f docs/architecture/v1-agent-inbox-no-regression-checklist.md',
        'test -f docs/architecture/v1-agent-inbox-proof-plan.md',
        'test -f docs/architecture/v1-agent-inbox-review-verdict.md',
        'grep -q "V1_AGENT_INBOX_REVIEW_COMPLETE" docs/architecture/v1-agent-inbox-review-verdict.md',
        'echo "V1_AGENT_INBOX_VERIFIED"',
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
