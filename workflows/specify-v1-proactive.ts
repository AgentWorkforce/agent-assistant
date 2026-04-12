const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-assistant-specify-v1-proactive')
    .description('Turn the proactive layer into a bounded v1 implementation-facing spec and implementation plan for RelayAssistant.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-spec-proactive')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead spec architect for v1 proactive behavior, responsible for defining a bounded proactive layer grounded in scheduling, reminders, follow-up, and stale-state detection.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the v1 proactive spec, implementation plan, and package README direction.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the proactive spec docs for bounded scope, relaycron alignment, and implementation readiness.',
      retries: 1,
    })

    .step('read-proactive-context', {
      type: 'deterministic',
      command: [
        'echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,360p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,360p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---WEEKEND DELIVERY---"',
        'sed -n "1,320p" docs/workflows/weekend-delivery-plan.md',
        'echo "" && echo "---HOW TO BUILD AN ASSISTANT---"',
        'sed -n "1,320p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---RELAYCRON README---"',
        'sed -n "1,260p" ../relaycron/README.md 2>/dev/null || true',
        'echo "" && echo "---CONNECTIVITY REVIEW---"',
        'sed -n "1,220p" docs/architecture/v1-connectivity-package-review-verdict.md',
        'echo "" && echo "---COORDINATION HARDENING REVIEW---"',
        'sed -n "1,220p" docs/architecture/v1-coordination-hardening-review-verdict.md',
        'echo "" && echo "---MEMORY REVIEW---"',
        'sed -n "1,220p" docs/architecture/v1-memory-package-review-verdict.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-proactive-scope', {
      agent: 'lead-claude',
      dependsOn: ['read-proactive-context'],
      task: `Using the current package docs, workflow backlog, and relaycron context below, define the bounded v1 proactive scope.

{{steps.read-proactive-context.output}}

Write docs/architecture/v1-proactive-scope.md.

The scope doc must:
1. define what proactive behavior belongs in RelayAssistant
2. define how the package relates to relaycron without taking over scheduling infrastructure ownership
3. define what belongs in v1 vs what is deferred
4. define how proactive interacts with memory, coordination, routing, and surfaces
5. keep the package realistic for a first implementation workflow

End the document with V1_PROACTIVE_SCOPE_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-proactive-scope.md' },
    })

    .step('author-v1-proactive-spec', {
      agent: 'author-claude',
      dependsOn: ['lead-proactive-scope'],
      task: `Using docs/architecture/v1-proactive-scope.md and the current package docs, author the v1 proactive implementation-facing spec set.

Required files:
- docs/specs/v1-proactive-spec.md
- docs/architecture/v1-proactive-implementation-plan.md
- packages/proactive/README.md
- docs/research/proactive-runtime-notes.md

Requirements:
- define reminders, stale-thread detection, follow-up policies, and scheduled watch behavior at a practical v1 level
- keep scheduling infrastructure ownership outside the package (relaycron-aligned)
- define the package's runtime contracts and boundaries clearly
- keep scope bounded and implementation-ready
- do not overbuild a full hosted scheduler in the SDK

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/specs/v1-proactive-spec.md with V1_PROACTIVE_SPEC_READY
- end docs/architecture/v1-proactive-implementation-plan.md with V1_PROACTIVE_IMPLEMENTATION_PLAN_READY
- end packages/proactive/README.md with PROACTIVE_PACKAGE_DIRECTION_READY`,
      verification: { type: 'file_exists', value: 'docs/specs/v1-proactive-spec.md' },
    })

    .step('review-v1-proactive-spec', {
      agent: 'review-codex',
      dependsOn: ['author-v1-proactive-spec'],
      task: `Review the v1 proactive spec set.

Read:
- docs/architecture/v1-proactive-scope.md
- docs/specs/v1-proactive-spec.md
- docs/architecture/v1-proactive-implementation-plan.md
- packages/proactive/README.md
- docs/research/proactive-runtime-notes.md

Assess:
1. Is the v1 proactive scope bounded and realistic?
2. Is the relationship to relaycron clear enough?
3. Are the package boundaries with memory/coordination/routing/surfaces clear?
4. Is this strong enough to directly drive the next implementation workflow?

Write docs/architecture/v1-proactive-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_PROACTIVE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-proactive-review-verdict.md' },
    })

    .step('verify-proactive-spec-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-v1-proactive-spec'],
      command: [
        'test -f docs/architecture/v1-proactive-scope.md',
        'test -f docs/specs/v1-proactive-spec.md',
        'test -f docs/architecture/v1-proactive-implementation-plan.md',
        'test -f packages/proactive/README.md',
        'test -f docs/research/proactive-runtime-notes.md',
        'test -f docs/architecture/v1-proactive-review-verdict.md',
        'grep -q "V1_PROACTIVE_SCOPE_READY" docs/architecture/v1-proactive-scope.md',
        'grep -q "V1_PROACTIVE_SPEC_READY" docs/specs/v1-proactive-spec.md',
        'grep -q "V1_PROACTIVE_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-proactive-implementation-plan.md',
        'grep -q "PROACTIVE_PACKAGE_DIRECTION_READY" packages/proactive/README.md',
        'grep -q "V1_PROACTIVE_REVIEW_COMPLETE" docs/architecture/v1-proactive-review-verdict.md',
        'echo "V1_PROACTIVE_SPECIFICATION_VERIFIED"',
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
