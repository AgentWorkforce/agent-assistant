const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-assistant-specify-v1-policy')
    .description('Define a bounded v1 policy package for RelayAssistant, covering approvals, action classes, audit hooks, and trust/risk boundaries without overreaching into product-specific policy.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-spec-policy')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead policy architect responsible for defining a bounded v1 assistant policy layer and keeping the package cleanly separated from product-specific business rules.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the v1 policy scope/spec/implementation docs and package README direction.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the v1 policy spec for boundedness, implementation readiness, and clean package boundaries.',
      retries: 1,
    })

    .step('read-policy-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,260p" README.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,360p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---TRAITS LAYER---"',
        'sed -n "1,260p" docs/architecture/traits-and-persona-layer.md',
        'echo "" && echo "---PROACTIVE SPEC---"',
        'sed -n "1,260p" docs/specs/v1-proactive-spec.md',
        'echo "" && echo "---HOW TO BUILD AN ASSISTANT---"',
        'sed -n "1,260p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,260p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---POLICY README PLACEHOLDER---"',
        'sed -n "1,220p" packages/policy/README.md 2>/dev/null || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-policy-scope', {
      agent: 'lead-claude',
      dependsOn: ['read-policy-context'],
      task: `Using the current repo context below, define the bounded v1 policy scope.

{{steps.read-policy-context.output}}

Write docs/architecture/v1-policy-scope.md.

The scope doc must:
1. define what policy belongs in RelayAssistant
2. define action/risk/approval concepts for v1
3. define what stays product-specific or outside the package
4. define how policy interacts with proactive, traits, coordination, and surfaces
5. define what is deferred beyond v1

Hard constraints:
- keep the package reusable and assistant-facing
- do not absorb full product governance or billing logic
- optimize for implementation-ready scope, not completeness

End with V1_POLICY_SCOPE_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-policy-scope.md' },
    })

    .step('author-v1-policy-spec', {
      agent: 'author-claude',
      dependsOn: ['lead-policy-scope'],
      task: `Using docs/architecture/v1-policy-scope.md and the repo context, author the v1 policy spec set.

Required files:
- docs/specs/v1-policy-spec.md
- docs/architecture/v1-policy-implementation-plan.md
- packages/policy/README.md
- docs/research/policy-runtime-notes.md

Requirements:
- define approvals, action classes, policy checks, audit hooks, and allow/deny/escalate outcomes at a practical v1 level
- keep package boundaries explicit
- keep the package implementation-ready
- avoid speculative product-specific policy engines

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/specs/v1-policy-spec.md with V1_POLICY_SPEC_READY
- end docs/architecture/v1-policy-implementation-plan.md with V1_POLICY_IMPLEMENTATION_PLAN_READY
- end packages/policy/README.md with POLICY_PACKAGE_DIRECTION_READY`,
      verification: { type: 'file_exists', value: 'docs/specs/v1-policy-spec.md' },
    })

    .step('review-v1-policy-spec', {
      agent: 'review-codex',
      dependsOn: ['author-v1-policy-spec'],
      task: `Review the v1 policy spec set.

Read:
- docs/architecture/v1-policy-scope.md
- docs/specs/v1-policy-spec.md
- docs/architecture/v1-policy-implementation-plan.md
- packages/policy/README.md
- docs/research/policy-runtime-notes.md

Assess:
1. Is the v1 policy scope bounded and realistic?
2. Are package boundaries clean?
3. Is this strong enough to drive implementation next?
4. Are proactive/policy interactions well-defined enough for future integration?

Write docs/architecture/v1-policy-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_POLICY_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-policy-review-verdict.md' },
    })

    .step('verify-policy-spec-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-v1-policy-spec'],
      command: [
        'test -f docs/architecture/v1-policy-scope.md',
        'test -f docs/specs/v1-policy-spec.md',
        'test -f docs/architecture/v1-policy-implementation-plan.md',
        'test -f packages/policy/README.md',
        'test -f docs/research/policy-runtime-notes.md',
        'test -f docs/architecture/v1-policy-review-verdict.md',
        'grep -q "V1_POLICY_SCOPE_READY" docs/architecture/v1-policy-scope.md',
        'grep -q "V1_POLICY_SPEC_READY" docs/specs/v1-policy-spec.md',
        'grep -q "V1_POLICY_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-policy-implementation-plan.md',
        'grep -q "POLICY_PACKAGE_DIRECTION_READY" packages/policy/README.md',
        'grep -q "V1_POLICY_REVIEW_COMPLETE" docs/architecture/v1-policy-review-verdict.md',
        'echo "V1_POLICY_SPECIFICATION_VERIFIED"',
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
