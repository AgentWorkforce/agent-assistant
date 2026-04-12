const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-reconcile-v1-memory-spec-to-relay-memory')
    .description('Reconcile the v1 memory spec and implementation plan so they match the actual @agent-relay/memory surface before memory implementation begins.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-reconcile-memory')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead memory reconciler who turns the memory review findings into a precise spec-to-reality correction plan.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Reconciles the v1 memory spec and implementation plan to the actual relay memory package surface.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the reconciled memory docs for fidelity to @agent-relay/memory and readiness for the implementation workflow.',
      retries: 1,
    })

    .step('read-memory-reconciliation-context', {
      type: 'deterministic',
      command: [
        'echo "---MEMORY REVIEW VERDICT---"',
        'sed -n "1,320p" docs/architecture/v1-memory-review-verdict.md',
        'echo "" && echo "---MEMORY SPEC---"',
        'sed -n "1,360p" docs/specs/v1-memory-spec.md',
        'echo "" && echo "---MEMORY PLAN---"',
        'sed -n "1,360p" docs/architecture/v1-memory-implementation-plan.md',
        'echo "" && echo "---MEMORY INVESTIGATION---"',
        'sed -n "1,360p" docs/research/memory-reuse-investigation.md',
        'echo "" && echo "---RELAY MEMORY PACKAGE.JSON---"',
        'cat ../relay/packages/memory/package.json',
        'echo "" && echo "---RELAY MEMORY INDEX---"',
        'sed -n "1,360p" ../relay/packages/memory/src/index.ts',
        'echo "" && echo "---RELAY MEMORY FILES---"',
        'find ../relay/packages/memory/src -maxdepth 2 -type f | sort | sed -n "1,120p"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-memory-reconciliation-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-memory-reconciliation-context'],
      task: `Using the memory review verdict, current memory docs, and actual relay memory package context below, write a focused reconciliation plan.

{{steps.read-memory-reconciliation-context.output}}

Write docs/architecture/v1-memory-reconciliation-plan.md.

The plan must:
1. identify the exact search-model mismatch to correct
2. identify the exact adapter-surface mismatch to correct
3. state what the assistant-memory layer may and may not assume about @agent-relay/memory in v1
4. keep the reuse-first posture intact
5. keep the result implementation-ready for the next workflow

End the document with V1_MEMORY_RECONCILIATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-memory-reconciliation-plan.md' },
    })

    .step('apply-memory-reconciliation', {
      agent: 'author-claude',
      dependsOn: ['lead-memory-reconciliation-plan'],
      task: `Apply the v1 memory reconciliation using docs/architecture/v1-memory-reconciliation-plan.md.

Update these files:
- docs/specs/v1-memory-spec.md
- docs/architecture/v1-memory-implementation-plan.md
- docs/research/memory-reuse-investigation.md
- packages/memory/README.md

Requirements:
- reconcile the spec to the actual @agent-relay/memory surface
- remove assumptions that MemoryService exposes operations it does not actually expose
- clarify how structured retrieval and relay search really relate in v1
- preserve the reuse-first posture and deferred librarian/cross-agent consolidation stance
- keep the docs implementation-ready for the next workflow

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- append MEMORY_SPEC_RECONCILED to docs/architecture/v1-memory-implementation-plan.md`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-memory-implementation-plan.md' },
    })

    .step('review-memory-reconciliation', {
      agent: 'review-codex',
      dependsOn: ['apply-memory-reconciliation'],
      task: `Review the reconciled memory docs.

Read:
- docs/architecture/v1-memory-review-verdict.md
- docs/architecture/v1-memory-reconciliation-plan.md
- docs/specs/v1-memory-spec.md
- docs/architecture/v1-memory-implementation-plan.md
- docs/research/memory-reuse-investigation.md
- packages/memory/README.md
- ../relay/packages/memory/src/index.ts

Assess:
1. Do the docs now match the actual @agent-relay/memory surface closely enough?
2. Is the reuse-first posture still clear and realistic?
3. Are the search and adapter assumptions now implementable?
4. Is the package ready for the actual implementation workflow next?

Write docs/architecture/v1-memory-reconciliation-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_MEMORY_RECONCILIATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-memory-reconciliation-review-verdict.md' },
    })

    .step('verify-memory-reconciliation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-memory-reconciliation'],
      command: [
        'test -f docs/architecture/v1-memory-reconciliation-plan.md',
        'test -f docs/architecture/v1-memory-implementation-plan.md',
        'test -f docs/specs/v1-memory-spec.md',
        'test -f docs/research/memory-reuse-investigation.md',
        'test -f packages/memory/README.md',
        'test -f docs/architecture/v1-memory-reconciliation-review-verdict.md',
        'grep -q "V1_MEMORY_RECONCILIATION_PLAN_READY" docs/architecture/v1-memory-reconciliation-plan.md',
        'grep -q "MEMORY_SPEC_RECONCILED" docs/architecture/v1-memory-implementation-plan.md',
        'grep -q "V1_MEMORY_RECONCILIATION_REVIEW_COMPLETE" docs/architecture/v1-memory-reconciliation-review-verdict.md',
        'echo "V1_MEMORY_RECONCILIATION_VERIFIED"',
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
