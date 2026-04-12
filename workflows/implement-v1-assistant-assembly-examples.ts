const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-assistant-implement-v1-assistant-assembly-examples')
    .description('Create canonical assistant assembly examples that show how RelayAssistant packages compose into real product-facing assistants, with a strong focus on adoption readiness for NightCTO, Sage, and My Senior Dev.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-assembly-examples')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead assembly architect for real assistant composition patterns and consumer-facing adoption examples.',
      retries: 1,
    })
    .agent('implementer-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements assembly examples, example docs, and adoption-ready consumer guidance.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the assembly examples for realism, composition quality, and consumer usefulness.',
      retries: 1,
    })

    .step('read-assembly-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,260p" README.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---HOW TO BUILD AN ASSISTANT---"',
        'sed -n "1,320p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---HOW PRODUCTS SHOULD ADOPT---"',
        'sed -n "1,320p" docs/consumer/how-products-should-adopt-relay-agent-assistant.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,320p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---PROACTIVE POLICY INTEGRATION REVIEW---"',
        'sed -n "1,240p" docs/architecture/v1-proactive-policy-integration-review-verdict.md',
        'echo "" && echo "---TRAITS CORE INTEGRATION REVIEW---"',
        'sed -n "1,240p" docs/architecture/v1-traits-core-integration-review-verdict.md',
        'echo "" && echo "---PACKAGE TREE---"',
        'find packages -maxdepth 2 -type f | sort | sed -n "1,260p"',
        'echo "" && echo "---EXAMPLES TREE---"',
        'find packages/examples -maxdepth 3 -type f 2>/dev/null | sort',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-assembly-example-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-assembly-context'],
      task: `Using the current docs and package state below, define the canonical v1 assistant assembly example contract.

{{steps.read-assembly-context.output}}

Write docs/architecture/v1-assistant-assembly-examples-contract.md.

The contract must define:
1. what example(s) should exist
2. what package set the examples should compose
3. what stays product-owned vs SDK-owned in the examples
4. what proof scenarios the examples should demonstrate
5. how these examples should help NightCTO, Sage, and My Senior Dev adopt the SDK
6. what is deferred from the examples in v1

Hard constraints:
- prefer realistic examples over toy abstractions
- optimize for consumer adoption value
- keep examples bounded and maintainable

End with V1_ASSISTANT_ASSEMBLY_EXAMPLES_CONTRACT_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-assistant-assembly-examples-contract.md' },
    })

    .step('implement-assistant-assembly-examples', {
      agent: 'implementer-claude',
      dependsOn: ['define-assembly-example-contract'],
      task: `Implement the assistant assembly examples and related adoption docs.

Read and follow:
- docs/architecture/v1-assistant-assembly-examples-contract.md
- docs/consumer/how-to-build-an-assistant.md
- docs/consumer/how-products-should-adopt-relay-agent-assistant.md
- current package READMEs and integration review docs

Required outputs:
- example assembly files under packages/examples/ or another clearly justified location
- docs/consumer updates that show the canonical assembly path
- an adoption-oriented note or matrix for NightCTO, Sage, and My Senior Dev
- any minimal integration/test proof needed to show the examples are realistic

Required proof scenarios:
1. a personal-assistant style assembly path
2. a company/shared-assistant style assembly path
3. traits/core/proactive/policy composition shown clearly
4. a consumer can tell what stays local in product code

Constraints:
- examples should not become fake product implementations
- keep them adoption-focused and realistic
- prefer clarity and composability over novelty

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- end your final summary with V1_ASSISTANT_ASSEMBLY_EXAMPLES_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-assistant-assembly-examples-plan.md' },
    })

    .step('review-assistant-assembly-examples', {
      agent: 'review-codex',
      dependsOn: ['implement-assistant-assembly-examples'],
      task: `Review the assistant assembly examples work.

Read:
- docs/architecture/v1-assistant-assembly-examples-contract.md
- docs/architecture/v1-assistant-assembly-examples-plan.md
- any new/updated example files
- any updated consumer docs

Assess:
1. are the examples realistic and consumer-useful?
2. do they reflect the actual SDK boundaries well?
3. do they help NightCTO, Sage, and MSD adoption concretely?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-assistant-assembly-examples-review-verdict.md.
End with V1_ASSISTANT_ASSEMBLY_EXAMPLES_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-assistant-assembly-examples-review-verdict.md' },
    })

    .step('verify-assistant-assembly-examples', {
      type: 'deterministic',
      dependsOn: ['review-assistant-assembly-examples'],
      command: [
        'test -f docs/architecture/v1-assistant-assembly-examples-contract.md',
        'test -f docs/architecture/v1-assistant-assembly-examples-plan.md',
        'test -f docs/architecture/v1-assistant-assembly-examples-review-verdict.md',
        'grep -q "V1_ASSISTANT_ASSEMBLY_EXAMPLES_CONTRACT_READY" docs/architecture/v1-assistant-assembly-examples-contract.md',
        'grep -q "V1_ASSISTANT_ASSEMBLY_EXAMPLES_REVIEW_COMPLETE" docs/architecture/v1-assistant-assembly-examples-review-verdict.md',
        'echo "V1_ASSISTANT_ASSEMBLY_EXAMPLES_VERIFIED"',
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
