import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('remediate-agent-assistant-sdk-rename')
    .description('Fix the blocking findings from the Agent Assistant SDK rename review so the rename is operationally consistent and the public/open-source docs are trustworthy.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-rename-remediation')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead rename-remediation architect responsible for resolving only the specific blocking rename issues without reopening the naming decision.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Applies the targeted rename fixes for workflow IDs, doc paths, and public-facing consistency.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the rename remediation for operational consistency and public documentation integrity.',
      retries: 1,
    })

    .step('read-rename-remediation-context', {
      type: 'deterministic',
      command: [
        'echo "---RENAME BOUNDARY---"',
        'sed -n "1,260p" docs/architecture/agent-assistant-sdk-rename-boundary.md',
        'echo "" && echo "---APPLICATION REVIEW VERDICT---"',
        'sed -n "1,260p" docs/architecture/agent-assistant-sdk-rename-application-review-verdict.md',
        'echo "" && echo "---APPLICATION REPORT---"',
        'sed -n "1,260p" docs/architecture/agent-assistant-sdk-rename-application-report.md',
        'echo "" && echo "---README---"',
        'sed -n "1,260p" README.md',
        'echo "" && echo "---BROKEN NAME REFERENCES---"',
        'rg -n "relay-assistant|RelayAssistant|wf-relay-assistant|relay-assistant-" README.md docs .github workflows packages || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-remediation-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-rename-remediation-context'],
      task: `Using the rename review findings below, define the exact remediation boundary.

{{steps.read-rename-remediation-context.output}}

Write docs/architecture/agent-assistant-sdk-rename-remediation-boundary.md.

The remediation boundary must resolve:
1. stale old workflow IDs/channel names in active workflows
2. broken consumer-doc file naming/linking
3. overclaiming in the rename application report
4. any remaining public-facing stale-name references that undermine open-source readiness

Hard constraints:
- do not reopen naming decisions
- keep fixes tightly scoped to the review findings
- optimize for a trustworthy, operationally consistent rename

End with AGENT_ASSISTANT_RENAME_REMEDIATION_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/agent-assistant-sdk-rename-remediation-boundary.md' },
    })

    .step('apply-remediation', {
      agent: 'author-claude',
      dependsOn: ['define-remediation-boundary'],
      task: `Apply the rename remediation.

Read and follow:
- docs/architecture/agent-assistant-sdk-rename-remediation-boundary.md
- docs/architecture/agent-assistant-sdk-rename-application-review-verdict.md

Requirements:
- fix active workflow IDs/channel names
- fix doc path/file naming mismatches
- fix public-facing stale-name references
- correct overclaiming in the rename application report
- do not print large file contents to stdout

IMPORTANT:
- write files to disk
- end docs/architecture/agent-assistant-sdk-rename-remediation-report.md with AGENT_ASSISTANT_RENAME_REMEDIATION_REPORT_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/agent-assistant-sdk-rename-remediation-report.md' },
    })

    .step('review-remediation', {
      agent: 'review-codex',
      dependsOn: ['apply-remediation'],
      task: `Review the Agent Assistant SDK rename remediation.

Read:
- docs/architecture/agent-assistant-sdk-rename-remediation-boundary.md
- docs/architecture/agent-assistant-sdk-rename-remediation-report.md
- README.md
- changed docs/workflows/package manifests

Assess:
1. are the blocking rename issues actually fixed?
2. are workflow/doc/public surfaces now consistent?
3. is the rename now ready to be treated as operationally complete?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/agent-assistant-sdk-rename-remediation-review-verdict.md.
End with AGENT_ASSISTANT_RENAME_REMEDIATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/agent-assistant-sdk-rename-remediation-review-verdict.md' },
    })

    .step('verify-remediation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-remediation'],
      command: [
        'test -f docs/architecture/agent-assistant-sdk-rename-remediation-boundary.md',
        'test -f docs/architecture/agent-assistant-sdk-rename-remediation-report.md',
        'test -f docs/architecture/agent-assistant-sdk-rename-remediation-review-verdict.md',
        'grep -q "AGENT_ASSISTANT_RENAME_REMEDIATION_BOUNDARY_READY" docs/architecture/agent-assistant-sdk-rename-remediation-boundary.md',
        'grep -q "AGENT_ASSISTANT_RENAME_REMEDIATION_REPORT_READY" docs/architecture/agent-assistant-sdk-rename-remediation-report.md',
        'grep -q "AGENT_ASSISTANT_RENAME_REMEDIATION_REVIEW_COMPLETE" docs/architecture/agent-assistant-sdk-rename-remediation-review-verdict.md',
        'echo "AGENT_ASSISTANT_RENAME_REMEDIATION_VERIFIED"',
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
