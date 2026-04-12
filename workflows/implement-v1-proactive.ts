const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-implement-v1-proactive')
    .description('Implement the v1 proactive package for Agent Assistant SDK from the reviewed scope/spec/plan, resolving review follow-ups before landing code.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-implement-proactive')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 proactive package. Resolves review follow-ups into a single unambiguous contract before coding begins.',
      retries: 1,
    })
    .agent('implementer-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the proactive package, tests, and package docs according to the reconciled contract.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the v1 proactive implementation for contract alignment, package boundaries, and definition-of-done proof.',
      retries: 1,
    })

    .step('read-proactive-implementation-context', {
      type: 'deterministic',
      command: [
        'echo "---PROACTIVE SCOPE---"',
        'sed -n "1,260p" docs/architecture/v1-proactive-scope.md',
        'echo "" && echo "---PROACTIVE SPEC---"',
        'sed -n "1,360p" docs/specs/v1-proactive-spec.md',
        'echo "" && echo "---PROACTIVE IMPLEMENTATION PLAN---"',
        'sed -n "1,360p" docs/architecture/v1-proactive-implementation-plan.md',
        'echo "" && echo "---PROACTIVE REVIEW VERDICT---"',
        'sed -n "1,260p" docs/architecture/v1-proactive-review-verdict.md',
        'echo "" && echo "---PACKAGE README---"',
        'sed -n "1,260p" packages/proactive/README.md',
        'echo "" && echo "---PACKAGE TREE---"',
        'find packages/proactive -maxdepth 3 -type f | sort',
        'echo "" && echo "---PACKAGE.JSON---"',
        'sed -n "1,220p" packages/proactive/package.json 2>/dev/null || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('reconcile-proactive-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-proactive-implementation-context'],
      task: `Using the proactive scope/spec/implementation-plan/review below, resolve the review follow-ups into one implementation contract before coding begins.

{{steps.read-proactive-implementation-context.output}}

Write docs/architecture/v1-proactive-contract-reconciliation.md.

Required decisions to lock down explicitly:
1. whether v1 supports only 'fire | suppress' or also 'defer'
2. exact suppressWhenActive semantics
3. evidence-fetch behavior (per rule vs per evaluation)
4. canonical follow-up rule removal method name
5. watch lifecycle and scheduling responsibility split
6. watch evaluation granularity (per-rule wake-up vs evaluate-all)
7. removal of unsupported v1 claims

Hard constraints:
- produce a decisive implementation contract, not an essay
- prefer the simpler/better-bounded v1 choice when docs disagree
- keep relaycron ownership outside the package
- end with V1_PROACTIVE_CONTRACT_RECONCILED`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-proactive-contract-reconciliation.md' },
    })

    .step('implement-v1-proactive-package', {
      agent: 'implementer-claude',
      dependsOn: ['reconcile-proactive-contract'],
      task: `Implement the v1 proactive package using the reconciled contract.

Read and follow:
- docs/architecture/v1-proactive-contract-reconciliation.md
- docs/specs/v1-proactive-spec.md
- docs/architecture/v1-proactive-implementation-plan.md
- docs/architecture/v1-proactive-review-verdict.md

Required deliverables:
- package implementation under packages/proactive/
- tests with 40+ passing cases
- updated package README if implementation details need tightening
- updated proactive spec/plan wording only if required to match the reconciled contract

Implementation requirements:
- keep zero runtime dependency on other @agent-assistant packages
- do not implement a real relaycron binding
- include an in-memory scheduler binding for tests/dev
- keep the package single-process and bounded for v1
- prove the implemented API matches the reconciled contract
- avoid speculative v1.1+ behavior

Definition of done:
1. proactive package builds cleanly
2. proactive package tests pass (40+)
3. package exports are clean
4. README matches actual implementation
5. no unresolved contract drift remains between code and the reconciled contract

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- if package.json or tsconfig are missing, create them
- end your final status summary with V1_PROACTIVE_IMPLEMENTATION_READY`,
      verification: { type: 'file_exists', value: 'packages/proactive/src/index.ts' },
    })

    .step('review-v1-proactive-implementation', {
      agent: 'review-codex',
      dependsOn: ['implement-v1-proactive-package'],
      task: `Review the implemented v1 proactive package.

Read:
- docs/architecture/v1-proactive-contract-reconciliation.md
- docs/specs/v1-proactive-spec.md
- docs/architecture/v1-proactive-review-verdict.md
- packages/proactive/package.json
- packages/proactive/src/index.ts
- packages/proactive/src/types.ts
- packages/proactive/src/proactive.ts
- packages/proactive/src/proactive.test.ts
- packages/proactive/README.md

Assess:
1. does the code follow the reconciled contract?
2. are the prior review follow-ups actually resolved?
3. are package boundaries still clean?
4. is there sufficient test proof for DoD?
5. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-proactive-package-review-verdict.md.
End with V1_PROACTIVE_PACKAGE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-proactive-package-review-verdict.md' },
    })

    .step('verify-v1-proactive-implementation', {
      type: 'deterministic',
      dependsOn: ['review-v1-proactive-implementation'],
      command: [
        'test -f docs/architecture/v1-proactive-contract-reconciliation.md',
        'test -f packages/proactive/package.json',
        'test -f packages/proactive/tsconfig.json',
        'test -f packages/proactive/src/index.ts',
        'test -f packages/proactive/src/types.ts',
        'test -f packages/proactive/src/proactive.ts',
        'test -f packages/proactive/src/proactive.test.ts',
        'test -f docs/architecture/v1-proactive-package-review-verdict.md',
        'grep -q "V1_PROACTIVE_CONTRACT_RECONCILED" docs/architecture/v1-proactive-contract-reconciliation.md',
        'grep -q "V1_PROACTIVE_PACKAGE_REVIEW_COMPLETE" docs/architecture/v1-proactive-package-review-verdict.md',
        'cd packages/proactive && npm test',
        'echo "V1_PROACTIVE_IMPLEMENTATION_VERIFIED"',
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
