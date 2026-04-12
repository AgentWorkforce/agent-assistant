const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-assistant-implement-v1-policy')
    .description('Implement the v1 policy package for RelayAssistant from the reviewed scope/spec/plan, resolving review follow-ups before landing code.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-implement-policy')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 policy package. Resolves review follow-ups into one clear implementation contract before coding begins.',
      retries: 1,
    })
    .agent('implementer-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the v1 policy package, tests, and package docs according to the reconciled contract.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the v1 policy implementation for contract alignment, package boundaries, and DoD proof.',
      retries: 1,
    })

    .step('read-policy-implementation-context', {
      type: 'deterministic',
      command: [
        'echo "---POLICY SCOPE---"',
        'sed -n "1,260p" docs/architecture/v1-policy-scope.md',
        'echo "" && echo "---POLICY SPEC---"',
        'sed -n "1,360p" docs/specs/v1-policy-spec.md',
        'echo "" && echo "---POLICY IMPLEMENTATION PLAN---"',
        'sed -n "1,360p" docs/architecture/v1-policy-implementation-plan.md',
        'echo "" && echo "---POLICY REVIEW VERDICT---"',
        'sed -n "1,260p" docs/architecture/v1-policy-review-verdict.md',
        'echo "" && echo "---PACKAGE README---"',
        'sed -n "1,260p" packages/policy/README.md',
        'echo "" && echo "---PACKAGE TREE---"',
        'find packages/policy -maxdepth 3 -type f | sort',
        'echo "" && echo "---PACKAGE.JSON---"',
        'sed -n "1,220p" packages/policy/package.json 2>/dev/null || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('reconcile-policy-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-policy-implementation-context'],
      task: `Using the policy scope/spec/implementation-plan/review below, resolve the review follow-ups into one implementation contract before coding begins.

{{steps.read-policy-implementation-context.output}}

Write docs/architecture/v1-policy-contract-reconciliation.md.

Required decisions to lock down explicitly:
1. how approval outcomes correlate back to the original audit record in v1
2. how invalid classifier outputs are validated and surfaced
3. how the default-deny/default-approval wording aligns with actual fallback behavior
4. whether workspaceId remains in v1 and, if so, how it is provided
5. duplicate registration error behavior and wording

Hard constraints:
- produce a decisive implementation contract, not an essay
- prefer the simpler and more implementation-ready v1 choice when docs disagree
- keep relayauth concerns outside the package boundary
- end with V1_POLICY_CONTRACT_RECONCILED`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-policy-contract-reconciliation.md' },
    })

    .step('implement-v1-policy-package', {
      agent: 'implementer-claude',
      dependsOn: ['reconcile-policy-contract'],
      task: `Implement the v1 policy package using the reconciled contract.

Read and follow:
- docs/architecture/v1-policy-contract-reconciliation.md
- docs/specs/v1-policy-spec.md
- docs/architecture/v1-policy-implementation-plan.md
- docs/architecture/v1-policy-review-verdict.md

Required deliverables:
- package implementation under packages/policy/
- tests with 40+ passing cases
- updated package README if implementation details need tightening
- updated policy spec/plan wording only if required to match the reconciled contract

Implementation requirements:
- keep zero runtime dependency on other @relay-assistant packages
- do not implement approval UX or hosted audit infrastructure
- include an in-memory audit sink for tests/dev
- keep the package bounded and reusable for v1
- prove the implemented API matches the reconciled contract
- avoid speculative v1.1+ behavior

Definition of done:
1. policy package builds cleanly
2. policy package tests pass (40+)
3. package exports are clean
4. README matches actual implementation
5. no unresolved contract drift remains between code and the reconciled contract

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- if package.json or tsconfig are missing, create them
- end your final status summary with V1_POLICY_IMPLEMENTATION_READY`,
      verification: { type: 'file_exists', value: 'packages/policy/src/index.ts' },
    })

    .step('review-v1-policy-implementation', {
      agent: 'review-codex',
      dependsOn: ['implement-v1-policy-package'],
      task: `Review the implemented v1 policy package.

Read:
- docs/architecture/v1-policy-contract-reconciliation.md
- docs/specs/v1-policy-spec.md
- docs/architecture/v1-policy-review-verdict.md
- packages/policy/package.json
- packages/policy/src/index.ts
- packages/policy/src/types.ts
- packages/policy/src/policy.ts
- packages/policy/src/policy.test.ts
- packages/policy/README.md

Assess:
1. does the code follow the reconciled contract?
2. are the prior review follow-ups actually resolved?
3. are package boundaries still clean?
4. is there sufficient test proof for DoD?
5. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-policy-package-review-verdict.md.
End with V1_POLICY_PACKAGE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-policy-package-review-verdict.md' },
    })

    .step('verify-v1-policy-implementation', {
      type: 'deterministic',
      dependsOn: ['review-v1-policy-implementation'],
      command: [
        'test -f docs/architecture/v1-policy-contract-reconciliation.md',
        'test -f packages/policy/package.json',
        'test -f packages/policy/tsconfig.json',
        'test -f packages/policy/src/index.ts',
        'test -f packages/policy/src/types.ts',
        'test -f packages/policy/src/policy.ts',
        'test -f packages/policy/src/policy.test.ts',
        'test -f docs/architecture/v1-policy-package-review-verdict.md',
        'grep -q "V1_POLICY_CONTRACT_RECONCILED" docs/architecture/v1-policy-contract-reconciliation.md',
        'grep -q "V1_POLICY_PACKAGE_REVIEW_COMPLETE" docs/architecture/v1-policy-package-review-verdict.md',
        'cd packages/policy && npm test',
        'echo "V1_POLICY_IMPLEMENTATION_VERIFIED"',
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
