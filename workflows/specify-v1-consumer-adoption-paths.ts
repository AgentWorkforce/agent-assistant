const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-assistant-specify-v1-consumer-adoption-paths')
    .description('Define concrete SDK adoption paths for real consumers: NightCTO, Sage, and My Senior Dev. The goal is to turn the current RelayAssistant substrate into a practical product-adoption plan, not just generic guidance.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-consumer-adoption')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead adoption architect for mapping RelayAssistant packages and integration patterns onto real consumer products.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the consumer adoption docs, migration matrix, and recommended rollout sequence for NightCTO, Sage, and MSD.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the consumer adoption plan for realism, sequence quality, and practical product usefulness.',
      retries: 1,
    })

    .step('read-consumer-adoption-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,260p" README.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---PRODUCT ADOPTION DOC---"',
        'sed -n "1,320p" docs/consumer/how-products-should-adopt-relay-agent-assistant.md',
        'echo "" && echo "---HOW TO BUILD AN ASSISTANT---"',
        'sed -n "1,320p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---ASSISTANT ASSEMBLY REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-assistant-assembly-examples-review-verdict.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,320p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---INTERNAL SYSTEM COMPARISON---"',
        'sed -n "1,320p" docs/research/internal-system-comparison.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-consumer-adoption-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-consumer-adoption-context'],
      task: `Using the current SDK docs and consumer-facing docs below, define the adoption-planning contract for NightCTO, Sage, and My Senior Dev.

{{steps.read-consumer-adoption-context.output}}

Write docs/architecture/v1-consumer-adoption-contract.md.

The contract must define:
1. what an adoption-path deliverable should include for each consumer
2. how to distinguish ready-now SDK packages from defer-later packages
3. how to identify what stays local in each consumer repo
4. how to choose the best first adopter for the weekend product goal
5. what proof of adoption-readiness is required in docs

Hard constraints:
- optimize for practical rollout, not generic strategy language
- focus on NightCTO, Sage, and My Senior Dev specifically
- keep the outcome concrete enough to drive actual implementation work next

End with V1_CONSUMER_ADOPTION_CONTRACT_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-consumer-adoption-contract.md' },
    })

    .step('author-consumer-adoption-paths', {
      agent: 'author-claude',
      dependsOn: ['define-consumer-adoption-contract'],
      task: `Author the concrete consumer adoption plan using the contract.

Read and follow:
- docs/architecture/v1-consumer-adoption-contract.md
- docs/consumer/how-products-should-adopt-relay-agent-assistant.md
- docs/consumer/how-to-build-an-assistant.md
- docs/current-state.md
- docs/architecture/v1-assistant-assembly-examples-review-verdict.md
- docs/research/internal-system-comparison.md

Required outputs:
- docs/consumer/nightcto-adoption-path.md
- docs/consumer/sage-adoption-path.md
- docs/consumer/msd-adoption-path.md
- docs/consumer/consumer-adoption-matrix.md
- docs/architecture/v1-consumer-adoption-rollout-plan.md

Requirements:
- each consumer doc must identify what to adopt first, what to defer, what stays local, and immediate blockers
- the matrix must compare the three consumers side by side
- the rollout plan must recommend which consumer to adopt first for the weekend goal and why
- keep this practical and implementation-driving

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/consumer/consumer-adoption-matrix.md with CONSUMER_ADOPTION_MATRIX_READY
- end docs/architecture/v1-consumer-adoption-rollout-plan.md with V1_CONSUMER_ADOPTION_ROLLOUT_READY`,
      verification: { type: 'file_exists', value: 'docs/consumer/consumer-adoption-matrix.md' },
    })

    .step('review-consumer-adoption-paths', {
      agent: 'review-codex',
      dependsOn: ['author-consumer-adoption-paths'],
      task: `Review the consumer adoption planning outputs.

Read:
- docs/architecture/v1-consumer-adoption-contract.md
- docs/consumer/nightcto-adoption-path.md
- docs/consumer/sage-adoption-path.md
- docs/consumer/msd-adoption-path.md
- docs/consumer/consumer-adoption-matrix.md
- docs/architecture/v1-consumer-adoption-rollout-plan.md

Assess:
1. are these adoption paths concrete enough to act on immediately?
2. is the package readiness judgment realistic?
3. is the recommended first adopter well justified?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-consumer-adoption-review-verdict.md.
End with V1_CONSUMER_ADOPTION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-consumer-adoption-review-verdict.md' },
    })

    .step('verify-consumer-adoption-paths', {
      type: 'deterministic',
      dependsOn: ['review-consumer-adoption-paths'],
      command: [
        'test -f docs/architecture/v1-consumer-adoption-contract.md',
        'test -f docs/consumer/nightcto-adoption-path.md',
        'test -f docs/consumer/sage-adoption-path.md',
        'test -f docs/consumer/msd-adoption-path.md',
        'test -f docs/consumer/consumer-adoption-matrix.md',
        'test -f docs/architecture/v1-consumer-adoption-rollout-plan.md',
        'test -f docs/architecture/v1-consumer-adoption-review-verdict.md',
        'grep -q "V1_CONSUMER_ADOPTION_CONTRACT_READY" docs/architecture/v1-consumer-adoption-contract.md',
        'grep -q "CONSUMER_ADOPTION_MATRIX_READY" docs/consumer/consumer-adoption-matrix.md',
        'grep -q "V1_CONSUMER_ADOPTION_ROLLOUT_READY" docs/architecture/v1-consumer-adoption-rollout-plan.md',
        'grep -q "V1_CONSUMER_ADOPTION_REVIEW_COMPLETE" docs/architecture/v1-consumer-adoption-review-verdict.md',
        'echo "V1_CONSUMER_ADOPTION_PATHS_VERIFIED"',
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
