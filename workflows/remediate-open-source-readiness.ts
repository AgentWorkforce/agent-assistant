import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-remediate-open-source-readiness')
    .description('Fix the concrete blockers identified by the open-source readiness audit so Agent Assistant SDK can move from READY_WITH_FIXES toward a genuinely public/open-source-ready state.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-oss-remediation')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead public-readiness architect who translates the audit findings into a tightly scoped remediation boundary.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Applies the public-readiness remediation across docs, examples, naming, and package/public-surface messaging.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews whether the remediation meaningfully resolves the public/open-source blockers and improves launch readiness.',
      retries: 1,
    })

    .step('read-oss-remediation-context', {
      type: 'deterministic',
      command: [
        'echo "---OPEN SOURCE READINESS REPORT---"',
        'sed -n "1,320p" docs/architecture/open-source-readiness-report.md',
        'echo "" && echo "---OPEN SOURCE REMEDIATION BACKLOG---"',
        'sed -n "1,320p" docs/architecture/open-source-remediation-backlog.md',
        'echo "" && echo "---PUBLIC LAUNCH DECISION---"',
        'sed -n "1,220p" docs/architecture/public-launch-decision.md',
        'echo "" && echo "---README---"',
        'sed -n "1,320p" README.md',
        'echo "" && echo "---DOCS INDEX---"',
        'sed -n "1,260p" docs/index.md',
        'echo "" && echo "---REMAINING OLD-NAME REFERENCES---"',
        'rg -n "RelayAssistant|relay-assistant|@relay-assistant" README.md docs packages .github workflows || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-oss-remediation-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-oss-remediation-context'],
      task: `Using the open-source readiness audit outputs below, define the exact remediation boundary.

{{steps.read-oss-remediation-context.output}}

Write docs/architecture/open-source-remediation-boundary.md.

The boundary must define:
1. which audit blockers will be fixed now
2. what docs/examples/public surfaces will be updated
3. which naming/link issues are in scope
4. what package/public-surface messaging must be clarified now
5. what remains intentionally deferred

Hard constraints:
- optimize for a real improvement in public-readiness
- keep the remediation concrete and bounded
- do not overclaim remaining unresolved publish/runtime issues

End with OPEN_SOURCE_REMEDIATION_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/open-source-remediation-boundary.md' },
    })

    .step('apply-oss-remediation', {
      agent: 'author-claude',
      dependsOn: ['define-oss-remediation-boundary'],
      task: `Apply the open-source/public-readiness remediation.

Read and follow:
- docs/architecture/open-source-remediation-boundary.md
- docs/architecture/open-source-remediation-backlog.md
- docs/architecture/public-launch-decision.md

Requirements:
- fix the most important public-facing blockers now
- improve README/docs/examples/public messaging for outside readers
- resolve remaining stale naming/linking problems within the remediation scope
- make package/public-surface status clearer
- do not print large file contents to stdout

IMPORTANT:
- write files to disk
- end docs/architecture/open-source-remediation-report.md with OPEN_SOURCE_REMEDIATION_REPORT_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/open-source-remediation-report.md' },
    })

    .step('review-oss-remediation', {
      agent: 'review-codex',
      dependsOn: ['apply-oss-remediation'],
      task: `Review the open-source/public-readiness remediation.

Read:
- docs/architecture/open-source-remediation-boundary.md
- docs/architecture/open-source-remediation-report.md
- README.md
- changed docs/examples/package metadata

Assess:
1. were the major public-readiness blockers meaningfully reduced?
2. is the repo more understandable to an outsider now?
3. are the remaining unresolved items represented honestly?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/open-source-remediation-review-verdict.md.
End with OPEN_SOURCE_REMEDIATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/open-source-remediation-review-verdict.md' },
    })

    .step('verify-oss-remediation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-oss-remediation'],
      command: [
        'test -f docs/architecture/open-source-remediation-boundary.md',
        'test -f docs/architecture/open-source-remediation-report.md',
        'test -f docs/architecture/open-source-remediation-review-verdict.md',
        'grep -q "OPEN_SOURCE_REMEDIATION_BOUNDARY_READY" docs/architecture/open-source-remediation-boundary.md',
        'grep -q "OPEN_SOURCE_REMEDIATION_REPORT_READY" docs/architecture/open-source-remediation-report.md',
        'grep -q "OPEN_SOURCE_REMEDIATION_REVIEW_COMPLETE" docs/architecture/open-source-remediation-review-verdict.md',
        'echo "OPEN_SOURCE_REMEDIATION_VERIFIED"',
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
