const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-implement-v1-memory')
    .description('Implement the v1 memory package for agent-assistant-sdk as a reuse-first composition layer over @agent-relay/memory.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-impl-memory')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 memory package, responsible for translating the reconciled memory docs into a bounded, reuse-first implementation slice.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the v1 memory package, tests, and package metadata according to the reconciled memory spec and the actual @agent-relay/memory surface.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the memory implementation for reuse fidelity, clean package boundaries, and readiness for later assistant integration.',
      retries: 1,
    })

    .step('read-memory-implementation-context', {
      type: 'deterministic',
      command: [
        'echo "---MEMORY SPEC---"',
        'sed -n "1,360p" docs/specs/v1-memory-spec.md',
        'echo "" && echo "---MEMORY IMPLEMENTATION PLAN---"',
        'sed -n "1,360p" docs/architecture/v1-memory-implementation-plan.md',
        'echo "" && echo "---MEMORY RECONCILIATION REVIEW---"',
        'sed -n "1,320p" docs/architecture/v1-memory-reconciliation-review-verdict.md',
        'echo "" && echo "---MEMORY INVESTIGATION---"',
        'sed -n "1,360p" docs/research/memory-reuse-investigation.md',
        'echo "" && echo "---RELAY MEMORY PACKAGE.JSON---"',
        'cat ../relay/packages/memory/package.json',
        'echo "" && echo "---RELAY MEMORY INDEX---"',
        'sed -n "1,360p" ../relay/packages/memory/src/index.ts',
        'echo "" && echo "---MEMORY README---"',
        'sed -n "1,240p" packages/memory/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-memory-implementation-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-memory-implementation-context'],
      task: `Using the reconciled memory spec, implementation plan, reuse investigation, and actual relay memory package context below, write a focused implementation plan for the v1 assistant-memory package.

{{steps.read-memory-implementation-context.output}}

Write docs/architecture/v1-memory-package-implementation-plan.md.

The plan must:
1. define the bounded v1 implementation slice
2. name the exact files to create under packages/memory
3. state exactly which relay memory types/utilities/services are reused directly
4. define what the assistant-memory composition layer adds on top in v1
5. keep cross-agent consolidation/librarian work explicitly out of scope
6. specify the minimum tests to write now

End the document with V1_MEMORY_PACKAGE_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-memory-package-implementation-plan.md' },
    })

    .step('implement-memory-package', {
      agent: 'implement-codex',
      dependsOn: ['lead-memory-implementation-plan'],
      task: `Implement the v1 memory package using docs/architecture/v1-memory-package-implementation-plan.md, docs/specs/v1-memory-spec.md, and the actual @agent-relay/memory surface.

Required work:
- create/update package files under packages/memory/
- implement the minimal assistant-memory composition layer for v1
- reuse @agent-relay/memory directly where the reconciled docs say to do so
- add only the bounded assistant-facing behaviors approved for v1
- write tests for the intended first memory workflows
- update packages/memory/README.md from direction/spec doc to actual package documentation

Expected package shape:
- packages/memory/package.json
- packages/memory/tsconfig.json
- packages/memory/src/index.ts
- packages/memory/src/types.ts
- packages/memory/src/memory.ts
- packages/memory/src/memory.test.ts
- packages/memory/README.md

Requirements:
- TypeScript-first
- reuse-first over @agent-relay/memory
- no greenfield memory engine
- no cross-agent consolidation implementation
- no cloud assumptions
- keep the package runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- end packages/memory/README.md with MEMORY_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/memory/src/memory.ts' },
    })

    .step('review-memory-package', {
      agent: 'review-claude',
      dependsOn: ['implement-memory-package'],
      task: `Review the implemented v1 memory package.

Read:
- docs/specs/v1-memory-spec.md
- docs/architecture/v1-memory-package-implementation-plan.md
- docs/research/memory-reuse-investigation.md
- ../relay/packages/memory/src/index.ts
- packages/memory/package.json
- packages/memory/tsconfig.json
- packages/memory/src/index.ts
- packages/memory/src/types.ts
- packages/memory/src/memory.ts
- packages/memory/src/memory.test.ts
- packages/memory/README.md

Assess:
1. Does the implementation match the reconciled memory spec closely enough for v1?
2. Is the reuse-first posture actually reflected in the code?
3. Are boundaries with relay memory, future librarian logic, and cloud concerns kept clean?
4. Do the tests cover the intended first memory behaviors?
5. What follow-ups remain before product integration or later consolidation work?

Write docs/architecture/v1-memory-package-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_MEMORY_PACKAGE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-memory-package-review-verdict.md' },
    })

    .step('verify-memory-package-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-memory-package'],
      command: [
        'test -f docs/architecture/v1-memory-package-implementation-plan.md',
        'test -f packages/memory/package.json',
        'test -f packages/memory/tsconfig.json',
        'test -f packages/memory/src/index.ts',
        'test -f packages/memory/src/types.ts',
        'test -f packages/memory/src/memory.ts',
        'test -f packages/memory/src/memory.test.ts',
        'test -f packages/memory/README.md',
        'test -f docs/architecture/v1-memory-package-review-verdict.md',
        'grep -q "V1_MEMORY_PACKAGE_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-memory-package-implementation-plan.md',
        'grep -q "MEMORY_PACKAGE_IMPLEMENTED" packages/memory/README.md',
        'grep -q "V1_MEMORY_PACKAGE_REVIEW_COMPLETE" docs/architecture/v1-memory-package-review-verdict.md',
        'echo "V1_MEMORY_PACKAGE_IMPLEMENTATION_VERIFIED"',
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
