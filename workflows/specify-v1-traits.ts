const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-specify-v1-traits')
    .description('Turn the newly clarified traits/persona layer into a bounded v1 implementation-facing spec and implementation plan for the future traits package.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-spec-traits')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead spec architect for v1 traits, responsible for turning the traits/persona architecture into a practical package scope distinct from workforce personas.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the v1 traits spec, implementation plan, and package README direction.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the v1 traits docs for bounded scope, distinction from workforce personas, and implementation readiness.',
      retries: 1,
    })

    .step('read-traits-context', {
      type: 'deterministic',
      command: [
        'echo "---TRAITS LAYER---"',
        'sed -n "1,360p" docs/architecture/traits-and-persona-layer.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,360p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---INTERNAL COMPARISON---"',
        'sed -n "1,360p" docs/research/internal-system-comparison.md',
        'echo "" && echo "---WORKFORCE README---"',
        'sed -n "1,260p" ../workforce/README.md',
        'echo "" && echo "---HOW TO BUILD AN ASSISTANT---"',
        'sed -n "1,320p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---README---"',
        'sed -n "1,260p" README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-traits-scope', {
      agent: 'lead-claude',
      dependsOn: ['read-traits-context'],
      task: `Using the current traits/persona docs, package map, workforce context, and consumer guidance below, define the bounded v1 traits scope.

{{steps.read-traits-context.output}}

Write docs/architecture/v1-traits-scope.md.

The scope doc must:
1. define what traits are in the assistant SDK
2. distinguish traits/persona from workforce personas clearly
3. define what is in scope for v1 vs deferred
4. define how traits should relate to memory, routing, coordination, and surfaces without collapsing into them
5. keep the resulting package realistic for a first implementation workflow

End the document with V1_TRAITS_SCOPE_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-traits-scope.md' },
    })

    .step('author-v1-traits-spec', {
      agent: 'author-claude',
      dependsOn: ['lead-traits-scope'],
      task: `Using docs/architecture/v1-traits-scope.md and the current traits/persona docs, author the v1 traits implementation-facing spec set.

Required files:
- docs/specs/v1-traits-spec.md
- docs/architecture/v1-traits-implementation-plan.md
- packages/traits/README.md
- docs/research/traits-vs-workforce-personas.md

Requirements:
- define trait schema / trait bundle / expression rules / adaptation hooks at a practical v1 level
- keep the distinction from workforce personas explicit
- keep scope bounded and implementation-ready
- do not over-design dynamic learning or long-term adaptation beyond what v1 can realistically support
- position traits as a future package but make the docs strong enough to drive the next implementation workflow

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/specs/v1-traits-spec.md with V1_TRAITS_SPEC_READY
- end docs/architecture/v1-traits-implementation-plan.md with V1_TRAITS_IMPLEMENTATION_PLAN_READY
- end packages/traits/README.md with TRAITS_PACKAGE_DIRECTION_READY`,
      verification: { type: 'file_exists', value: 'docs/specs/v1-traits-spec.md' },
    })

    .step('review-v1-traits-spec', {
      agent: 'review-codex',
      dependsOn: ['author-v1-traits-spec'],
      task: `Review the v1 traits spec set.

Read:
- docs/architecture/v1-traits-scope.md
- docs/specs/v1-traits-spec.md
- docs/architecture/v1-traits-implementation-plan.md
- packages/traits/README.md
- docs/research/traits-vs-workforce-personas.md
- docs/architecture/traits-and-persona-layer.md
- ../workforce/README.md

Assess:
1. Is the v1 traits scope bounded and realistic?
2. Is the distinction from workforce personas clear enough?
3. Is the package relationship to memory/routing/coordination/surfaces clear enough?
4. Is this strong enough to directly drive the next implementation workflow?

Write docs/architecture/v1-traits-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_TRAITS_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-traits-review-verdict.md' },
    })

    .step('verify-traits-spec-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-v1-traits-spec'],
      command: [
        'test -f docs/architecture/v1-traits-scope.md',
        'test -f docs/specs/v1-traits-spec.md',
        'test -f docs/architecture/v1-traits-implementation-plan.md',
        'test -f packages/traits/README.md',
        'test -f docs/research/traits-vs-workforce-personas.md',
        'test -f docs/architecture/v1-traits-review-verdict.md',
        'grep -q "V1_TRAITS_SCOPE_READY" docs/architecture/v1-traits-scope.md',
        'grep -q "V1_TRAITS_SPEC_READY" docs/specs/v1-traits-spec.md',
        'grep -q "V1_TRAITS_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-traits-implementation-plan.md',
        'grep -q "TRAITS_PACKAGE_DIRECTION_READY" packages/traits/README.md',
        'grep -q "V1_TRAITS_REVIEW_COMPLETE" docs/architecture/v1-traits-review-verdict.md',
        'echo "V1_TRAITS_SPECIFICATION_VERIFIED"',
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
