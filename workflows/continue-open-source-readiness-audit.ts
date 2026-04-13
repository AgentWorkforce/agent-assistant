import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-continue-open-source-readiness-audit')
    .description('Continue the Agent Assistant SDK open-source readiness audit from the already-produced readiness rubric, avoiding the previously wedged rubric-definition step and focusing on concrete findings, remediation backlog, and launch readiness decision.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-oss-readiness-continue')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Executes the open-source readiness audit from the existing rubric, writes the report/backlog/launch decision, and stays concrete and outsider-focused.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the continued open-source readiness audit for realism, outsider clarity, and launch usefulness.',
      retries: 1,
    })

    .step('read-continued-oss-context', {
      type: 'deterministic',
      command: [
        'echo "---READINESS RUBRIC---"',
        'sed -n "1,260p" docs/architecture/open-source-readiness-rubric.md',
        'echo "" && echo "---README---"',
        'sed -n "1,320p" README.md',
        'echo "" && echo "---DOCS INDEX---"',
        'sed -n "1,260p" docs/index.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---NAME REFERENCES---"',
        'rg -n "RelayAssistant|relay-assistant|@relay-assistant" README.md docs packages .github workflows || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('execute-continued-oss-audit', {
      agent: 'author-claude',
      dependsOn: ['read-continued-oss-context'],
      task: `Continue the open-source readiness audit using the existing rubric and current repo state.

{{steps.read-continued-oss-context.output}}

Required outputs:
- docs/architecture/open-source-readiness-report.md
- docs/architecture/open-source-remediation-backlog.md
- docs/architecture/public-launch-decision.md

Requirements:
- be concrete and outsider-facing
- identify actual blockers and near-term fixes
- make the launch decision explicit: READY_NOW, READY_WITH_FIXES, or NOT_READY
- avoid broad exploratory wandering; use the existing rubric as authoritative

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/architecture/open-source-readiness-report.md with OPEN_SOURCE_READINESS_REPORT_READY
- end docs/architecture/open-source-remediation-backlog.md with OPEN_SOURCE_REMEDIATION_BACKLOG_READY
- end docs/architecture/public-launch-decision.md with PUBLIC_LAUNCH_DECISION_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/public-launch-decision.md' },
    })

    .step('review-continued-oss-audit', {
      agent: 'review-codex',
      dependsOn: ['execute-continued-oss-audit'],
      task: `Review the continued open-source readiness audit outputs.

Read:
- docs/architecture/open-source-readiness-rubric.md
- docs/architecture/open-source-readiness-report.md
- docs/architecture/open-source-remediation-backlog.md
- docs/architecture/public-launch-decision.md

Assess:
1. is the audit realistic for an outsider/public audience?
2. are the identified gaps concrete and useful?
3. is the public-launch decision well justified?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/open-source-readiness-review-verdict.md.
End with OPEN_SOURCE_READINESS_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/open-source-readiness-review-verdict.md' },
    })

    .step('verify-continued-oss-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-continued-oss-audit'],
      command: [
        'test -f docs/architecture/open-source-readiness-rubric.md',
        'test -f docs/architecture/open-source-readiness-report.md',
        'test -f docs/architecture/open-source-remediation-backlog.md',
        'test -f docs/architecture/public-launch-decision.md',
        'test -f docs/architecture/open-source-readiness-review-verdict.md',
        'grep -q "OPEN_SOURCE_READINESS_RUBRIC_READY" docs/architecture/open-source-readiness-rubric.md',
        'grep -q "OPEN_SOURCE_READINESS_REPORT_READY" docs/architecture/open-source-readiness-report.md',
        'grep -q "OPEN_SOURCE_REMEDIATION_BACKLOG_READY" docs/architecture/open-source-remediation-backlog.md',
        'grep -q "PUBLIC_LAUNCH_DECISION_READY" docs/architecture/public-launch-decision.md',
        'grep -q "OPEN_SOURCE_READINESS_REVIEW_COMPLETE" docs/architecture/open-source-readiness-review-verdict.md',
        'echo "OPEN_SOURCE_READINESS_CONTINUED_AUDIT_VERIFIED"',
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
