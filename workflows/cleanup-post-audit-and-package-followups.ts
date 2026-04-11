const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-cleanup-post-audit-and-package-followups')
    .description('Apply a narrow cleanup sweep after the audit/alignment and recent package reviews, resolving small but repeated doc and package follow-ups before memory work begins.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-cleanup-followups')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead cleanup editor for the SDK, responsible for converting the recent review follow-ups into a narrow implementation and docs cleanup plan.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Applies the narrow cleanup sweep across docs and small package follow-up items without introducing new architecture work.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the cleanup sweep for accuracy, consistency, and readiness to move into memory work.',
      retries: 1,
    })

    .step('read-cleanup-context', {
      type: 'deterministic',
      command: [
        'echo "---AUDIT REVIEW---"',
        'sed -n "1,280p" docs/architecture/sdk-audit-and-traits-alignment-review-verdict.md',
        'echo "" && echo "---ROUTING REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-routing-review-verdict.md',
        'echo "" && echo "---COORD HARDENING REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-coordination-hardening-review-verdict.md',
        'echo "" && echo "---README---"',
        'sed -n "1,260p" README.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,320p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---TRAITS LAYER---"',
        'sed -n "1,320p" docs/architecture/traits-and-persona-layer.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,360p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---WEEKEND DELIVERY---"',
        'sed -n "1,320p" docs/workflows/weekend-delivery-plan.md',
        'echo "" && echo "---ROUTING README---"',
        'sed -n "1,260p" packages/routing/README.md',
        'echo "" && echo "---COORDINATION README---"',
        'sed -n "1,260p" packages/coordination/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-cleanup-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-cleanup-context'],
      task: `Using the recent review verdicts and current docs below, write a narrow cleanup plan for the next sweep.

{{steps.read-cleanup-context.output}}

Write docs/architecture/post-audit-cleanup-plan.md.

The plan must:
1. identify the exact stale status statements and wording mismatches to fix now
2. identify the AssistantDefinition.traits inconsistency to resolve now
3. identify the small routing/coordination README follow-ups to fix now
4. keep scope narrow and avoid new package design work

End the document with POST_AUDIT_CLEANUP_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/post-audit-cleanup-plan.md' },
    })

    .step('apply-cleanup-sweep', {
      agent: 'implement-codex',
      dependsOn: ['lead-cleanup-plan'],
      task: `Apply the post-audit cleanup sweep using docs/architecture/post-audit-cleanup-plan.md.

Update only what is necessary to resolve the known small follow-ups, likely including:
- README.md
- docs/architecture/package-boundary-map.md
- docs/architecture/traits-and-persona-layer.md
- docs/workflows/v1-workflow-backlog.md
- docs/workflows/weekend-delivery-plan.md
- packages/routing/README.md
- packages/coordination/README.md

Requirements:
- resolve stale status wording
- resolve the AssistantDefinition.traits timing inconsistency
- add any missing README notes called out by routing/coordination reviews
- keep changes narrow and practical
- do not introduce new package work here

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- append POST_AUDIT_CLEANUP_APPLIED to docs/architecture/post-audit-cleanup-plan.md`,
      verification: { type: 'file_exists', value: 'docs/architecture/post-audit-cleanup-plan.md' },
    })

    .step('review-cleanup-sweep', {
      agent: 'review-claude',
      dependsOn: ['apply-cleanup-sweep'],
      task: `Review the post-audit cleanup sweep.

Read:
- docs/architecture/post-audit-cleanup-plan.md
- README.md
- docs/architecture/package-boundary-map.md
- docs/architecture/traits-and-persona-layer.md
- docs/workflows/v1-workflow-backlog.md
- docs/workflows/weekend-delivery-plan.md
- packages/routing/README.md
- packages/coordination/README.md

Assess:
1. Were the known stale status statements fixed?
2. Is the AssistantDefinition.traits timing now consistent?
3. Were the small routing/coordination README follow-ups addressed?
4. Is the repo now in a cleaner state for memory work?

Write docs/architecture/post-audit-cleanup-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with POST_AUDIT_CLEANUP_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/post-audit-cleanup-review-verdict.md' },
    })

    .step('verify-cleanup-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-cleanup-sweep'],
      command: [
        'test -f docs/architecture/post-audit-cleanup-plan.md',
        'test -f docs/architecture/post-audit-cleanup-review-verdict.md',
        'grep -q "POST_AUDIT_CLEANUP_PLAN_READY" docs/architecture/post-audit-cleanup-plan.md',
        'grep -q "POST_AUDIT_CLEANUP_APPLIED" docs/architecture/post-audit-cleanup-plan.md',
        'grep -q "POST_AUDIT_CLEANUP_REVIEW_COMPLETE" docs/architecture/post-audit-cleanup-review-verdict.md',
        'echo "POST_AUDIT_CLEANUP_VERIFIED"',
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
