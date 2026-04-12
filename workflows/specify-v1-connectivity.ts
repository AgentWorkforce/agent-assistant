const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-specify-v1-connectivity')
    .description('Turn the connectivity research/docs into a true v1 implementation spec and implementation plan for the @agent-assistant/connectivity package.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-spec-connectivity')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead spec architect for v1 connectivity, responsible for turning the existing docs into a practical implementation-ready package spec.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the v1 connectivity spec, signal catalog, and implementation plan.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the connectivity spec package docs for implementation-readiness, routing interaction clarity, and bounded v1 scope.',
      retries: 1,
    })

    .step('read-connectivity-context', {
      type: 'deterministic',
      command: [
        'echo "---CONNECTIVITY PACKAGE SPEC---"',
        'sed -n "1,360p" docs/architecture/connectivity-package-spec.md',
        'echo "" && echo "---CONNECTIVITY PATTERNS---"',
        'sed -n "1,320p" docs/research/connectivity-patterns.md',
        'echo "" && echo "---CONNECTIVITY ADOPTION---"',
        'sed -n "1,280p" docs/consumer/connectivity-adoption-guide.md',
        'echo "" && echo "---CONNECTIVITY README---"',
        'sed -n "1,240p" packages/connectivity/README.md',
        'echo "" && echo "---ROUTING SPEC---"',
        'sed -n "1,280p" docs/specs/v1-routing-spec.md',
        'echo "" && echo "---FOUNDATION INTEGRATION REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-foundation-integration-review-verdict.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-connectivity-scope', {
      agent: 'lead-claude',
      dependsOn: ['read-connectivity-context'],
      task: `Using the connectivity docs, routing spec, and current foundation context below, define the bounded v1 connectivity scope.

{{steps.read-connectivity-context.output}}

Write docs/architecture/v1-connectivity-scope.md.

The scope doc must:
1. define what v1 connectivity absolutely includes
2. define what is explicitly deferred beyond v1
3. distinguish connectivity from coordination, routing, and relay transport
4. define the minimum signal classes and semantics needed now
5. specify how connectivity can influence routing without owning routing

End the document with V1_CONNECTIVITY_SCOPE_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-connectivity-scope.md' },
    })

    .step('author-v1-connectivity-spec', {
      agent: 'author-claude',
      dependsOn: ['lead-connectivity-scope'],
      task: `Using docs/architecture/v1-connectivity-scope.md and the existing connectivity docs, author the true v1 implementation-facing spec set for connectivity.

Required files:
- docs/specs/v1-connectivity-spec.md
- docs/architecture/v1-connectivity-implementation-plan.md
- docs/reference/connectivity-signal-catalog.md
- packages/connectivity/README.md

Requirements:
- implementation-facing, not broad philosophy
- define signal envelope/types, salience, confidence, escalation, suppression, audience, and convergence rules
- define how connectivity interacts with routing without subsuming routing
- define the first package exports/interfaces expected in v1
- define what package boundaries remain strict
- keep scope bounded and realistic for weekend implementation
- update the package README so it aligns with the canonical v1 spec and no longer reads like just an early placeholder

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/specs/v1-connectivity-spec.md with V1_CONNECTIVITY_SPEC_READY
- end docs/architecture/v1-connectivity-implementation-plan.md with V1_CONNECTIVITY_IMPLEMENTATION_PLAN_READY
- end packages/connectivity/README.md with CONNECTIVITY_PACKAGE_READY`,
      verification: { type: 'file_exists', value: 'docs/specs/v1-connectivity-spec.md' },
    })

    .step('review-v1-connectivity-spec', {
      agent: 'review-codex',
      dependsOn: ['author-v1-connectivity-spec'],
      task: `Review the v1 connectivity specification set.

Read:
- docs/architecture/v1-connectivity-scope.md
- docs/specs/v1-connectivity-spec.md
- docs/architecture/v1-connectivity-implementation-plan.md
- docs/reference/connectivity-signal-catalog.md
- packages/connectivity/README.md
- docs/specs/v1-routing-spec.md

Assess:
1. Is the v1 scope properly bounded?
2. Is the spec implementation-ready rather than philosophical?
3. Are connectivity vs coordination vs routing boundaries now clear?
4. Is the routing interaction clear but appropriately limited?
5. Is this strong enough to directly drive the next implementation workflow?

Write docs/architecture/v1-connectivity-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_CONNECTIVITY_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-connectivity-review-verdict.md' },
    })

    .step('verify-connectivity-spec-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-v1-connectivity-spec'],
      command: [
        'test -f docs/architecture/v1-connectivity-scope.md',
        'test -f docs/specs/v1-connectivity-spec.md',
        'test -f docs/architecture/v1-connectivity-implementation-plan.md',
        'test -f docs/reference/connectivity-signal-catalog.md',
        'test -f packages/connectivity/README.md',
        'test -f docs/architecture/v1-connectivity-review-verdict.md',
        'grep -q "V1_CONNECTIVITY_SCOPE_READY" docs/architecture/v1-connectivity-scope.md',
        'grep -q "V1_CONNECTIVITY_SPEC_READY" docs/specs/v1-connectivity-spec.md',
        'grep -q "V1_CONNECTIVITY_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-connectivity-implementation-plan.md',
        'grep -q "CONNECTIVITY_PACKAGE_READY" packages/connectivity/README.md',
        'grep -q "V1_CONNECTIVITY_REVIEW_COMPLETE" docs/architecture/v1-connectivity-review-verdict.md',
        'echo "V1_CONNECTIVITY_SPECIFICATION_VERIFIED"',
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
