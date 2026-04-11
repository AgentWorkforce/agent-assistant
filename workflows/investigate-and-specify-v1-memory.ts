const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-investigate-and-specify-v1-memory')
    .description('Investigate the existing @agent-relay/memory package and define the bounded v1 assistant-memory layer as a reuse-first adapter/composition package, not a greenfield memory engine.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-spec-memory')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead memory architect for the assistant SDK, responsible for mapping relay memory capabilities into a bounded assistant-memory layer.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the v1 memory investigation/spec set with an explicit reuse-first posture over @agent-relay/memory.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the memory investigation/spec docs for reuse realism, clear package boundaries, and implementation-readiness.',
      retries: 1,
    })

    .step('read-memory-context', {
      type: 'deterministic',
      command: [
        'echo "---MEMORY SPEC---"',
        'sed -n "1,360p" docs/specs/v1-memory-spec.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,360p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,360p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---WEEKEND DELIVERY---"',
        'sed -n "1,320p" docs/workflows/weekend-delivery-plan.md',
        'echo "" && echo "---MEMORY README PLACEHOLDER---"',
        'sed -n "1,240p" packages/memory/README.md',
        'echo "" && echo "---RELAY MEMORY PACKAGE.JSON---"',
        'cat ../relay/packages/memory/package.json',
        'echo "" && echo "---RELAY MEMORY INDEX---"',
        'sed -n "1,320p" ../relay/packages/memory/src/index.ts',
        'echo "" && echo "---RELAY MEMORY ADAPTERS---"',
        'find ../relay/packages/memory/src -maxdepth 2 -type f | sort | sed -n "1,120p"',
        'echo "" && echo "---RELAY MEMORY TYPES---"',
        'sed -n "1,320p" ../relay/packages/memory/src/types.ts 2>/dev/null || true',
        'echo "" && echo "---SAGE MEMORY SIGNALS---"',
        'rg -n "SageMemory|OrgMemory|memory|compaction|supermemory|promotion|context" ../sage/src ../sage/README.md | head -n 240 || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-memory-scope', {
      agent: 'lead-claude',
      dependsOn: ['read-memory-context'],
      task: `Using the current v1 memory spec, package-boundary docs, relay memory package, and Sage memory signals below, define the bounded v1 assistant-memory scope.

{{steps.read-memory-context.output}}

Write docs/architecture/v1-memory-scope.md.

The scope doc must:
1. state clearly what should be reused from @agent-relay/memory
2. define what assistant-memory adds on top (if anything) in v1
3. define what is deferred beyond v1, including librarian/cross-agent consolidation
4. define how memory should preserve provenance/confidence metadata for future consolidation
5. keep the scope realistic for a reuse-first implementation workflow

End the document with V1_MEMORY_SCOPE_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-memory-scope.md' },
    })

    .step('author-v1-memory-spec', {
      agent: 'author-claude',
      dependsOn: ['lead-memory-scope'],
      task: `Using docs/architecture/v1-memory-scope.md and the relay memory investigation context, author the true reuse-first v1 memory spec set.

Required files:
- docs/specs/v1-memory-spec.md
- docs/architecture/v1-memory-implementation-plan.md
- docs/research/memory-reuse-investigation.md
- packages/memory/README.md

Requirements:
- make it explicit that @relay-assistant/memory is reuse-first over @agent-relay/memory
- define whether the assistant-memory package is an adapter, wrapper, composition layer, or thin extension in v1
- identify exact relay memory pieces to reuse
- define what assistant-facing memory contracts remain necessary
- explicitly defer cross-agent consolidation / librarian capability to v5-v8
- keep the scope bounded and implementation-ready

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/specs/v1-memory-spec.md with V1_MEMORY_SPEC_READY
- end docs/architecture/v1-memory-implementation-plan.md with V1_MEMORY_IMPLEMENTATION_PLAN_READY
- end packages/memory/README.md with MEMORY_PACKAGE_DIRECTION_READY`,
      verification: { type: 'file_exists', value: 'docs/specs/v1-memory-spec.md' },
    })

    .step('review-v1-memory-spec', {
      agent: 'review-codex',
      dependsOn: ['author-v1-memory-spec'],
      task: `Review the v1 memory investigation/spec set.

Read:
- docs/architecture/v1-memory-scope.md
- docs/specs/v1-memory-spec.md
- docs/architecture/v1-memory-implementation-plan.md
- docs/research/memory-reuse-investigation.md
- packages/memory/README.md
- ../relay/packages/memory/src/index.ts
- ../relay/packages/memory/package.json

Assess:
1. Is the reuse-first posture over @agent-relay/memory clear and realistic?
2. Is the assistant-memory package boundary well-defined?
3. Is greenfield memory work being avoided where Relay memory already suffices?
4. Is librarian/cross-agent consolidation correctly deferred to v5-v8 while preserving future-enabling metadata requirements?
5. Is this strong enough to directly drive the next memory implementation workflow?

Write docs/architecture/v1-memory-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_MEMORY_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-memory-review-verdict.md' },
    })

    .step('verify-memory-spec-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-v1-memory-spec'],
      command: [
        'test -f docs/architecture/v1-memory-scope.md',
        'test -f docs/specs/v1-memory-spec.md',
        'test -f docs/architecture/v1-memory-implementation-plan.md',
        'test -f docs/research/memory-reuse-investigation.md',
        'test -f packages/memory/README.md',
        'test -f docs/architecture/v1-memory-review-verdict.md',
        'grep -q "V1_MEMORY_SCOPE_READY" docs/architecture/v1-memory-scope.md',
        'grep -q "V1_MEMORY_SPEC_READY" docs/specs/v1-memory-spec.md',
        'grep -q "V1_MEMORY_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-memory-implementation-plan.md',
        'grep -q "MEMORY_PACKAGE_DIRECTION_READY" packages/memory/README.md',
        'grep -q "V1_MEMORY_REVIEW_COMPLETE" docs/architecture/v1-memory-review-verdict.md',
        'echo "V1_MEMORY_SPECIFICATION_VERIFIED"',
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
