const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-reconcile-canonical-specs')
    .description('Reconcile the canonical v1 specs so they match the adopted reconciliation rules and unblock implementation workflows.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-reconcile-specs')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead spec reconciler who turns the review verdict and reconciliation rules into concrete canonical-spec edits',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Edits the canonical core and surfaces specs plus small stale-term cleanup to match the reconciliation rules',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the updated canonical specs for internal consistency and alignment with the reconciled planning docs',
      retries: 1,
    })

    .step('read-reconciliation-context', {
      type: 'deterministic',
      command: [
        'echo "---RECONCILIATION RULES---"',
        'sed -n "1,360p" docs/architecture/spec-reconciliation-rules.md',
        'echo "" && echo "---RECONCILIATION REVIEW VERDICT---"',
        'sed -n "1,320p" docs/architecture/spec-reconciliation-review-verdict.md',
        'echo "" && echo "---CORE SPEC---"',
        'sed -n "1,360p" docs/specs/v1-core-spec.md',
        'echo "" && echo "---SURFACES SPEC---"',
        'sed -n "1,360p" docs/specs/v1-surfaces-spec.md',
        'echo "" && echo "---SESSIONS SPEC---"',
        'sed -n "1,220p" docs/specs/v1-sessions-spec.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,320p" docs/workflows/v1-workflow-backlog.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-spec-fix-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-reconciliation-context'],
      task: `Using the reconciliation rules, the reconciliation review verdict, and the current canonical specs below, write a focused fix plan.

{{steps.read-reconciliation-context.output}}

Write docs/architecture/canonical-spec-fix-plan.md.

The plan must:
1. enumerate the exact edits required in v1-core-spec.md
2. enumerate the exact edits required in v1-surfaces-spec.md
3. identify the small stale-term cleanup needed in v1-sessions-spec.md and v1-workflow-backlog.md
4. restate the intended post-reconciliation source-of-truth model in concise implementation-facing terms

End the document with CANONICAL_SPEC_FIX_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/canonical-spec-fix-plan.md' },
    })

    .step('apply-spec-reconciliation', {
      agent: 'author-claude',
      dependsOn: ['lead-spec-fix-plan'],
      task: `Apply the canonical spec reconciliation using docs/architecture/canonical-spec-fix-plan.md.

Edit only these files:
- docs/specs/v1-core-spec.md
- docs/specs/v1-surfaces-spec.md
- docs/specs/v1-sessions-spec.md
- docs/workflows/v1-workflow-backlog.md

Required changes:
- surfaces owns inbound normalization
- core receives normalized InboundMessage
- add userId: string and workspaceId?: string to InboundMessage
- make OutboundEvent.surfaceId optional
- define OutboundEventError / invalid outbound behavior
- reconcile RelayInboundAdapter / surface registry contract
- add userId/workspaceId to the surfaces normalization table and missing-user behavior
- make targeted send vs session fanout rule explicit in both relevant specs
- remove stale legacy wording around resumed/closed where it conflicts with the canonical state model

IMPORTANT:
- keep the package specs as the source of truth
- write files to disk and exit when complete
- do not print full docs to stdout
- append SPEC_RECONCILED to both docs/specs/v1-core-spec.md and docs/specs/v1-surfaces-spec.md`,
      verification: { type: 'file_exists', value: 'docs/specs/v1-surfaces-spec.md' },
    })

    .step('review-canonical-specs', {
      agent: 'review-codex',
      dependsOn: ['apply-spec-reconciliation'],
      task: `Review the updated canonical specs.

Read:
- docs/architecture/canonical-spec-fix-plan.md
- docs/specs/v1-core-spec.md
- docs/specs/v1-surfaces-spec.md
- docs/specs/v1-sessions-spec.md
- docs/workflows/v1-workflow-backlog.md
- docs/architecture/spec-reconciliation-rules.md

Assess:
1. Do the canonical specs now reflect the reconciliation rules?
2. Is inbound normalization ownership now clear and consistent?
3. Are InboundMessage identity fields and outbound targeting/fanout rules now coherent?
4. Are stale session lifecycle terms cleaned up sufficiently?
5. What follow-ups remain, if any?

Write docs/architecture/canonical-spec-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with CANONICAL_SPEC_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/canonical-spec-review-verdict.md' },
    })

    .step('verify-canonical-spec-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-canonical-specs'],
      command: [
        'test -f docs/architecture/canonical-spec-fix-plan.md',
        'test -f docs/specs/v1-core-spec.md',
        'test -f docs/specs/v1-surfaces-spec.md',
        'test -f docs/specs/v1-sessions-spec.md',
        'test -f docs/workflows/v1-workflow-backlog.md',
        'test -f docs/architecture/canonical-spec-review-verdict.md',
        'grep -q "CANONICAL_SPEC_FIX_PLAN_READY" docs/architecture/canonical-spec-fix-plan.md',
        'grep -q "SPEC_RECONCILED" docs/specs/v1-core-spec.md',
        'grep -q "SPEC_RECONCILED" docs/specs/v1-surfaces-spec.md',
        'grep -q "CANONICAL_SPEC_REVIEW_COMPLETE" docs/architecture/canonical-spec-review-verdict.md',
        'echo "CANONICAL_SPEC_RECONCILIATION_VERIFIED"',
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
