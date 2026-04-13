import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-audit-open-source-readiness')
    .description('Run a comprehensive open-source/public-readiness audit for Agent Assistant SDK covering README quality, naming consistency, docs/explanations, examples, package boundaries, and whether the repo is ready to be made public.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-oss-readiness')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead open-source readiness auditor defining the evaluation rubric for making Agent Assistant SDK public.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Executes the open-source readiness audit, identifies concrete gaps, and proposes a release-ready remediation backlog.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the open-source readiness audit for realism, outsider clarity, and usefulness for a public launch decision.',
      retries: 1,
    })

    .step('read-oss-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,320p" README.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---DOCS INDEX---"',
        'sed -n "1,260p" docs/index.md',
        'echo "" && echo "---HOW TO BUILD---"',
        'sed -n "1,260p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---ADOPT DOC---"',
        'sed -n "1,260p" docs/consumer/how-products-should-adopt-agent-assistant-sdk.md',
        'echo "" && echo "---EXAMPLES README---"',
        'sed -n "1,260p" packages/examples/README.md',
        'echo "" && echo "---PACKAGE MANIFESTS---"',
        'find packages -maxdepth 2 -name package.json -type f | sort | xargs -I{} sh -c "echo --- {}; sed -n \"1,220p\" {}"',
        'echo "" && echo "---NAME REFERENCES---"',
        'rg -n "RelayAssistant|relay-assistant|@relay-assistant" README.md docs packages .github workflows || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-oss-readiness-rubric', {
      agent: 'lead-claude',
      dependsOn: ['read-oss-context'],
      task: `Using the current repo state below, define the exact open-source readiness rubric.

{{steps.read-oss-context.output}}

Write docs/architecture/open-source-readiness-rubric.md.

The rubric must evaluate:
1. README/public landing quality
2. naming consistency and public clarity
3. examples and onboarding usefulness
4. documentation completeness for an outsider
5. package publishability and package-boundary clarity
6. unresolved internal references or ecosystem assumptions
7. whether the repo is ready to be made public now, later, or only after specific fixes

End with OPEN_SOURCE_READINESS_RUBRIC_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/open-source-readiness-rubric.md' },
    })

    .step('execute-oss-readiness-audit', {
      agent: 'author-claude',
      dependsOn: ['define-oss-readiness-rubric'],
      task: `Execute the open-source readiness audit using the rubric.

Required outputs:
- docs/architecture/open-source-readiness-report.md
- docs/architecture/open-source-remediation-backlog.md
- docs/architecture/public-launch-decision.md

Requirements:
- be honest about what is and is not public-ready
- identify concrete gaps rather than vague advice
- make the launch decision explicit: READY_NOW, READY_WITH_FIXES, or NOT_READY

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/architecture/open-source-readiness-report.md with OPEN_SOURCE_READINESS_REPORT_READY
- end docs/architecture/open-source-remediation-backlog.md with OPEN_SOURCE_REMEDIATION_BACKLOG_READY
- end docs/architecture/public-launch-decision.md with PUBLIC_LAUNCH_DECISION_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/public-launch-decision.md' },
    })

    .step('review-oss-readiness-audit', {
      agent: 'review-codex',
      dependsOn: ['execute-oss-readiness-audit'],
      task: `Review the open-source readiness audit outputs.

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

    .step('verify-oss-readiness-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-oss-readiness-audit'],
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
        'echo "OPEN_SOURCE_READINESS_AUDIT_VERIFIED"',
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
