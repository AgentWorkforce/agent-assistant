const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-assistant-implement-v1-traits-core-integration')
    .description('Integrate the v1 traits package with core assistant composition so traits become a real first-class assembly input rather than a parallel isolated package.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-traits-core-integration')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead integration architect for traits-core composition, responsible for locking down the clean assembly boundary and ensuring traits are truly first-class in assistant runtime construction.',
      retries: 1,
    })
    .agent('implementer-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements traits-core integration artifacts, code, tests, and docs.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the traits-core integration for assembly correctness, package-boundary clarity, and proof quality.',
      retries: 1,
    })

    .step('read-traits-core-context', {
      type: 'deterministic',
      command: [
        'echo "---TRAITS REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-traits-package-review-verdict.md',
        'echo "" && echo "---CORE REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-core-review-verdict.md',
        'echo "" && echo "---FOUNDATION INTEGRATION REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-foundation-integration-review-verdict.md',
        'echo "" && echo "---TRAITS LAYER DOC---"',
        'sed -n "1,260p" docs/architecture/traits-and-persona-layer.md',
        'echo "" && echo "---CORE TREE---"',
        'find packages/core -maxdepth 3 -type f | sort',
        'echo "" && echo "---TRAITS TREE---"',
        'find packages/traits -maxdepth 3 -type f | sort',
        'echo "" && echo "---CORE PACKAGE.JSON---"',
        'sed -n "1,220p" packages/core/package.json',
        'echo "" && echo "---TRAITS PACKAGE.JSON---"',
        'sed -n "1,220p" packages/traits/package.json',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-traits-core-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-traits-core-context'],
      task: `Using the traits/core review docs and package trees below, define the clean traits-core integration contract.

{{steps.read-traits-core-context.output}}

Write docs/architecture/v1-traits-core-integration-contract.md.

The integration contract must define:
1. how traits enter core assistant composition
2. whether core should depend directly on a TraitsProvider or a narrower interface
3. how traits affect assembly without collapsing into product-specific persona logic
4. what belongs in core vs what stays in traits
5. what assembly/test proof is required
6. what is explicitly deferred from this integration in v1

Hard constraints:
- keep traits distinct from workforce personas
- keep core reusable and not overloaded with behavior policy
- optimize for real assistant assembly proof

End with V1_TRAITS_CORE_INTEGRATION_CONTRACT_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-traits-core-integration-contract.md' },
    })

    .step('implement-traits-core-integration', {
      agent: 'implementer-claude',
      dependsOn: ['define-traits-core-boundary'],
      task: `Implement the traits-core integration using the integration contract.

Read and follow:
- docs/architecture/v1-traits-core-integration-contract.md
- docs/architecture/v1-traits-package-review-verdict.md
- docs/architecture/v1-core-review-verdict.md
- docs/architecture/traits-and-persona-layer.md
- packages/core/*
- packages/traits/*

Required outputs:
- integration docs under docs/architecture/
- core/traits code changes needed for clean composition
- integration-focused tests in an appropriate package or integration test location
- README/doc updates if assistant assembly needs to be clarified for consumers

Required proof scenarios:
1. assistant definition accepts traits in a first-class way
2. traits flow through core assembly cleanly
3. surface-facing formatting/voice defaults can be derived from traits without embedding product persona logic into core
4. traits remain distinct from workforce/runtime personas

Implementation constraints:
- do not merge traits into core as a giant undifferentiated config blob
- preserve package boundaries
- prefer minimal clean interfaces over broad refactors
- keep tests local and deterministic

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- end your final summary with V1_TRAITS_CORE_INTEGRATION_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-traits-core-integration-plan.md' },
    })

    .step('review-traits-core-integration', {
      agent: 'review-codex',
      dependsOn: ['implement-traits-core-integration'],
      task: `Review the traits-core integration work.

Read:
- docs/architecture/v1-traits-core-integration-contract.md
- docs/architecture/v1-traits-core-integration-plan.md
- any new/updated integration tests
- any docs updated to explain the integration model

Assess:
1. is the boundary between core and traits still clean?
2. does the integration make traits truly first-class in assembly?
3. is the proof sufficient and realistic?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-traits-core-integration-review-verdict.md.
End with V1_TRAITS_CORE_INTEGRATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-traits-core-integration-review-verdict.md' },
    })

    .step('verify-traits-core-integration', {
      type: 'deterministic',
      dependsOn: ['review-traits-core-integration'],
      command: [
        'test -f docs/architecture/v1-traits-core-integration-contract.md',
        'test -f docs/architecture/v1-traits-core-integration-plan.md',
        'test -f docs/architecture/v1-traits-core-integration-review-verdict.md',
        'grep -q "V1_TRAITS_CORE_INTEGRATION_CONTRACT_READY" docs/architecture/v1-traits-core-integration-contract.md',
        'grep -q "V1_TRAITS_CORE_INTEGRATION_REVIEW_COMPLETE" docs/architecture/v1-traits-core-integration-review-verdict.md',
        'echo "V1_TRAITS_CORE_INTEGRATION_VERIFIED"',
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
