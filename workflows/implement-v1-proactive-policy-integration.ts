const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-assistant-implement-v1-proactive-policy-integration')
    .description('Integrate the v1 proactive and v1 policy packages so proactive actions can be gated, approved, audited, and escalated with a clean assistant-runtime boundary.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-proactive-policy-integration')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead integration architect for proactive-policy composition, responsible for locking down the clean runtime boundary and proving the integration story.',
      retries: 1,
    })
    .agent('implementer-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the proactive-policy integration artifacts, tests, and docs.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews proactive-policy integration for boundary clarity, correctness, and test proof.',
      retries: 1,
    })

    .step('read-proactive-policy-context', {
      type: 'deterministic',
      command: [
        'echo "---PROACTIVE PACKAGE REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-proactive-package-review-verdict.md',
        'echo "" && echo "---POLICY PACKAGE REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-policy-package-review-verdict.md',
        'echo "" && echo "---PROACTIVE CONTRACT RECONCILIATION---"',
        'sed -n "1,260p" docs/architecture/v1-proactive-contract-reconciliation.md',
        'echo "" && echo "---POLICY CONTRACT RECONCILIATION---"',
        'sed -n "1,260p" docs/architecture/v1-policy-contract-reconciliation.md',
        'echo "" && echo "---PROACTIVE README---"',
        'sed -n "1,260p" packages/proactive/README.md',
        'echo "" && echo "---POLICY README---"',
        'sed -n "1,260p" packages/policy/README.md',
        'echo "" && echo "---PROACTIVE TREE---"',
        'find packages/proactive -maxdepth 3 -type f | sort',
        'echo "" && echo "---POLICY TREE---"',
        'find packages/policy -maxdepth 3 -type f | sort',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-proactive-policy-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-proactive-policy-context'],
      task: `Using the package review docs, reconciled contracts, and package READMEs below, define the clean proactive-policy runtime boundary.

{{steps.read-proactive-policy-context.output}}

Write docs/architecture/v1-proactive-policy-integration-contract.md.

The integration contract must define:
1. how proactive-generated actions become policy-evaluated actions
2. what data passes from proactive -> policy
3. what stays product-owned vs package-owned
4. how audit correlation should work in a realistic assistant runtime
5. how proactive allow/deny/require_approval/escalate outcomes should flow
6. what is explicitly deferred from the integration in v1

Hard constraints:
- keep package boundaries clean
- do not merge proactive and policy into one package
- optimize for testable integration proof

End with V1_PROACTIVE_POLICY_INTEGRATION_CONTRACT_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-proactive-policy-integration-contract.md' },
    })

    .step('implement-proactive-policy-integration', {
      agent: 'implementer-claude',
      dependsOn: ['define-proactive-policy-boundary'],
      task: `Implement the proactive-policy integration proof using the integration contract.

Read and follow:
- docs/architecture/v1-proactive-policy-integration-contract.md
- docs/architecture/v1-proactive-package-review-verdict.md
- docs/architecture/v1-policy-package-review-verdict.md
- packages/proactive/*
- packages/policy/*

Required outputs:
- integration docs under docs/architecture/
- integration-focused tests in an appropriate package or integration test location
- any minimal integration helper/types needed for clean composition
- README/doc updates if the integration model needs to be explained to consumers

Required proof scenarios:
1. proactive action allowed by policy
2. proactive action blocked pending approval
3. proactive action escalated
4. approval resolution recorded cleanly
5. audit/event correlation story is coherent

Implementation constraints:
- keep proactive package independent
- keep policy package independent
- integration should be composition, not package fusion
- prefer minimal integration helpers over broad abstraction churn
- keep tests local and deterministic

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- end your final summary with V1_PROACTIVE_POLICY_INTEGRATION_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-proactive-policy-integration-plan.md' },
    })

    .step('review-proactive-policy-integration', {
      agent: 'review-codex',
      dependsOn: ['implement-proactive-policy-integration'],
      task: `Review the proactive-policy integration work.

Read:
- docs/architecture/v1-proactive-policy-integration-contract.md
- docs/architecture/v1-proactive-policy-integration-plan.md
- any new/updated integration tests
- any docs updated to explain the integration model

Assess:
1. is the boundary between packages still clean?
2. does the integration proof cover the key runtime cases?
3. is the approval/audit correlation story coherent?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-proactive-policy-integration-review-verdict.md.
End with V1_PROACTIVE_POLICY_INTEGRATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-proactive-policy-integration-review-verdict.md' },
    })

    .step('verify-proactive-policy-integration', {
      type: 'deterministic',
      dependsOn: ['review-proactive-policy-integration'],
      command: [
        'test -f docs/architecture/v1-proactive-policy-integration-contract.md',
        'test -f docs/architecture/v1-proactive-policy-integration-plan.md',
        'test -f docs/architecture/v1-proactive-policy-integration-review-verdict.md',
        'grep -q "V1_PROACTIVE_POLICY_INTEGRATION_CONTRACT_READY" docs/architecture/v1-proactive-policy-integration-contract.md',
        'grep -q "V1_PROACTIVE_POLICY_INTEGRATION_REVIEW_COMPLETE" docs/architecture/v1-proactive-policy-integration-review-verdict.md',
        'echo "V1_PROACTIVE_POLICY_INTEGRATION_VERIFIED"',
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
