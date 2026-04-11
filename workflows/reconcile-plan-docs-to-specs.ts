const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-reconcile-plan-docs')
    .description('Reconcile planning, backlog, and weekend-delivery docs so they exactly match the canonical v1 package specs.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-reconcile')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead editor who defines the reconciliation rules between canonical specs and the planning/backlog docs',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Rewrites the planning/workflow/adoption docs to align exactly with the canonical specs',
      retries: 1,
    })
    .agent('examples-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Fixes product adoption examples and weekend plan code sketches to match the current spec API vocabulary',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews all reconciled docs for contradictions, stale API names, and implementation-readiness drift',
      retries: 1,
    })

    .step('read-canonical-specs', {
      type: 'deterministic',
      command: [
        'echo "---SPEC PLAN---"',
        'sed -n "1,260p" docs/architecture/spec-program-plan.md',
        'echo "" && echo "---CORE SPEC---"',
        'sed -n "1,320p" docs/specs/v1-core-spec.md',
        'echo "" && echo "---SESSIONS SPEC---"',
        'sed -n "1,320p" docs/specs/v1-sessions-spec.md',
        'echo "" && echo "---SURFACES SPEC---"',
        'sed -n "1,320p" docs/specs/v1-surfaces-spec.md',
        'echo "" && echo "---MEMORY SPEC---"',
        'sed -n "1,260p" docs/specs/v1-memory-spec.md',
        'echo "" && echo "---CONNECTIVITY SPEC---"',
        'sed -n "1,260p" docs/specs/v1-connectivity-spec.md',
        'echo "" && echo "---ROUTING SPEC---"',
        'sed -n "1,260p" docs/specs/v1-routing-spec.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-plan-docs', {
      type: 'deterministic',
      command: [
        'echo "---SECTIONING---"',
        'sed -n "1,280p" docs/architecture/v1-sectioning-and-priorities.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,320p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---WEEKEND DELIVERY---"',
        'sed -n "1,320p" docs/workflows/weekend-delivery-plan.md',
        'echo "" && echo "---REVIEW VERDICT---"',
        'sed -n "1,320p" docs/architecture/spec-program-review-verdict.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-reconciliation-rules', {
      agent: 'lead-claude',
      dependsOn: ['read-canonical-specs', 'read-plan-docs'],
      task: `Using the canonical specs and current plan docs below, define explicit reconciliation rules.

Canonical specs/context:
{{steps.read-canonical-specs.output}}

Plan/backlog context:
{{steps.read-plan-docs.output}}

Write docs/architecture/spec-reconciliation-rules.md.

The rules must:
1. state that package specs are the source of truth when docs drift
2. list the exact stale API terms to replace
3. define the correct current vocabulary and file references
4. call out the highest-risk contradictions that must be fixed immediately
5. define how to keep weekend examples spec-conformant

End the file with SPEC_RECONCILIATION_RULES_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/spec-reconciliation-rules.md' },
    })

    .step('reconcile-plan-docs', {
      agent: 'author-claude',
      dependsOn: ['lead-reconciliation-rules'],
      task: `Use docs/architecture/spec-reconciliation-rules.md plus the canonical specs to reconcile the planning docs.

Update these files:
- docs/architecture/spec-program-plan.md
- docs/architecture/v1-sectioning-and-priorities.md
- docs/workflows/v1-workflow-backlog.md

Requirements:
- align all API vocabulary to the current package specs
- fix stale file references
- clarify cross-package workflow ownership where needed
- make fanout/targeting rules consistent with the surfaces spec
- explicitly note where specs are ahead of versioned implementation sequencing

IMPORTANT: write files to disk and exit when complete. End docs/workflows/v1-workflow-backlog.md with V1_WORKFLOW_BACKLOG_READY.`,
      verification: { type: 'file_exists', value: 'docs/workflows/v1-workflow-backlog.md' },
    })

    .step('reconcile-examples-and-weekend-plan', {
      agent: 'examples-claude',
      dependsOn: ['lead-reconciliation-rules'],
      task: `Use docs/architecture/spec-reconciliation-rules.md plus the canonical specs to reconcile the product examples and weekend plan.

Update these files:
- docs/workflows/weekend-delivery-plan.md
- docs/consumer/how-to-build-an-assistant.md

Requirements:
- make every product example spec-conformant
- remove or replace stale API names
- ensure Sage, MSD, and NightCTO examples all reflect the current package contract model
- add a short note that package specs are canonical if examples ever drift

IMPORTANT: write files to disk and exit when complete.`,
      verification: { type: 'file_exists', value: 'docs/workflows/weekend-delivery-plan.md' },
    })

    .step('review-reconciliation', {
      agent: 'review-codex',
      dependsOn: ['reconcile-plan-docs', 'reconcile-examples-and-weekend-plan'],
      task: `Review the reconciled docs for relay-agent-assistant.

Read:
- docs/architecture/spec-reconciliation-rules.md
- docs/architecture/spec-program-plan.md
- docs/architecture/v1-sectioning-and-priorities.md
- docs/workflows/v1-workflow-backlog.md
- docs/workflows/weekend-delivery-plan.md
- docs/consumer/how-to-build-an-assistant.md
- docs/specs/v1-core-spec.md
- docs/specs/v1-sessions-spec.md
- docs/specs/v1-surfaces-spec.md
- docs/specs/v1-memory-spec.md
- docs/specs/v1-connectivity-spec.md
- docs/specs/v1-routing-spec.md

Assess:
1. Are stale API names gone?
2. Do the planning docs now match the specs?
3. Are Sage/MSD/NightCTO examples implementation-credible now?
4. Is the weekend workflow backlog now trustworthy?
5. What follow-ups remain, if any?

Write docs/architecture/spec-reconciliation-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with SPEC_RECONCILIATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/spec-reconciliation-review-verdict.md' },
    })

    .step('verify-reconciliation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-reconciliation'],
      command: [
        'test -f docs/architecture/spec-reconciliation-rules.md',
        'test -f docs/architecture/spec-program-plan.md',
        'test -f docs/architecture/v1-sectioning-and-priorities.md',
        'test -f docs/workflows/v1-workflow-backlog.md',
        'test -f docs/workflows/weekend-delivery-plan.md',
        'test -f docs/consumer/how-to-build-an-assistant.md',
        'test -f docs/architecture/spec-reconciliation-review-verdict.md',
        'grep -q "SPEC_RECONCILIATION_RULES_READY" docs/architecture/spec-reconciliation-rules.md',
        'grep -q "V1_WORKFLOW_BACKLOG_READY" docs/workflows/v1-workflow-backlog.md',
        'grep -q "SPEC_RECONCILIATION_REVIEW_COMPLETE" docs/architecture/spec-reconciliation-review-verdict.md',
        'echo "SPEC_RECONCILIATION_VERIFIED"',
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
