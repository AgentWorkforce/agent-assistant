import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('relay-assistant-audit-repo-for-robustness')
    .description('Run a repeatable robustness audit over the RelayAssistant repo to catch shortcuts, non-canonical imports, overstated proofs, weak integration claims, and implementation/doc drift.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-robustness-audit')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead robustness auditor defining the repeatable audit standard and high-signal checks for shortcuts, stubs, non-canonical coupling, and proof drift.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Executes the robustness audit, writes the findings, and proposes concrete remediation items without overreaching.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the robustness audit for realism, repeatability, and whether it actually catches the classes of quality issues we care about.',
      retries: 1,
    })

    .step('read-robustness-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,260p" README.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---SOURCE OF TRUTH---"',
        'sed -n "1,260p" docs/architecture/source-of-truth.md',
        'echo "" && echo "---WORKFLOW INDEX---"',
        'sed -n "1,320p" docs/workflows/README.md',
        'echo "" && echo "---PACKAGE TREE---"',
        'find packages -maxdepth 3 -type f | sort | sed -n "1,320p"',
        'echo "" && echo "---DOCS TREE---"',
        'find docs -maxdepth 2 -type f | sort | sed -n "1,320p"',
        'echo "" && echo "---IMPORT SCAN: NON-CANONICAL HINTS---"',
        "rg -n '\\.\\./\\.\\./relay/|packages/.*/dist/|src/\\.\\./|from \\\'\\.\\./\\.\\./|from \"\\.\\./\\.\\./' . || true",
        'echo "" && echo "---BUILD/TEST PACKAGE FILES---"',
        'find packages -maxdepth 2 \( -name package.json -o -name tsconfig.json -o -name README.md \) | sort',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-robustness-audit-standard', {
      agent: 'lead-claude',
      dependsOn: ['read-robustness-context'],
      task: `Using the current repo context below, define a repeatable robustness-audit standard for RelayAssistant.

{{steps.read-robustness-context.output}}

Write docs/architecture/robustness-audit-standard.md.

The audit standard must explicitly check for:
1. non-canonical imports or local path shortcuts
2. docs that overclaim beyond current proof
3. integrations that claim more than tests/builds prove
4. placeholder/stub-like behavior hidden behind passing workflows
5. package boundary leakage
6. missing build/test proof or fragile build-order assumptions
7. consumer/adoption docs that outrun actual implementation readiness

Hard constraints:
- keep the audit repeatable and practical
- prefer concrete checklists over vague principles
- optimize for catching quality shortcuts before they harden into architecture

End with ROBUSTNESS_AUDIT_STANDARD_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/robustness-audit-standard.md' },
    })

    .step('execute-robustness-audit', {
      agent: 'author-claude',
      dependsOn: ['define-robustness-audit-standard'],
      task: `Execute the robustness audit using docs/architecture/robustness-audit-standard.md.

Required outputs:
- docs/architecture/robustness-audit-report.md
- docs/architecture/robustness-remediation-backlog.md

Requirements:
- identify real issues, not generic warnings
- distinguish between confirmed issue vs likely issue vs no finding
- call out any non-canonical dependency/import coupling
- call out any docs/examples that overstate proof
- call out any build/test proof gaps or fragile assumptions
- keep remediation items concrete and prioritized

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/architecture/robustness-audit-report.md with ROBUSTNESS_AUDIT_REPORT_READY
- end docs/architecture/robustness-remediation-backlog.md with ROBUSTNESS_REMEDIATION_BACKLOG_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/robustness-audit-report.md' },
    })

    .step('review-robustness-audit', {
      agent: 'review-codex',
      dependsOn: ['execute-robustness-audit'],
      task: `Review the robustness audit outputs.

Read:
- docs/architecture/robustness-audit-standard.md
- docs/architecture/robustness-audit-report.md
- docs/architecture/robustness-remediation-backlog.md

Assess:
1. does the audit actually target the right failure modes?
2. are the findings concrete and believable?
3. is the remediation backlog actionable?
4. is this repeatable enough to re-run later as the repo evolves?

Write docs/architecture/robustness-audit-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with ROBUSTNESS_AUDIT_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/robustness-audit-review-verdict.md' },
    })

    .step('verify-robustness-audit', {
      type: 'deterministic',
      dependsOn: ['review-robustness-audit'],
      command: [
        'test -f docs/architecture/robustness-audit-standard.md',
        'test -f docs/architecture/robustness-audit-report.md',
        'test -f docs/architecture/robustness-remediation-backlog.md',
        'test -f docs/architecture/robustness-audit-review-verdict.md',
        'grep -q "ROBUSTNESS_AUDIT_STANDARD_READY" docs/architecture/robustness-audit-standard.md',
        'grep -q "ROBUSTNESS_AUDIT_REPORT_READY" docs/architecture/robustness-audit-report.md',
        'grep -q "ROBUSTNESS_REMEDIATION_BACKLOG_READY" docs/architecture/robustness-remediation-backlog.md',
        'grep -q "ROBUSTNESS_AUDIT_REVIEW_COMPLETE" docs/architecture/robustness-audit-review-verdict.md',
        'echo "ROBUSTNESS_AUDIT_VERIFIED"',
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
