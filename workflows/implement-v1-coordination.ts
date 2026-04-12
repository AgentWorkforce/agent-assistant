const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-implement-v1-coordination')
    .description('Implement the v1 coordination package for agent-assistant-sdk from the package docs, connectivity package, and current v1 foundation.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-impl-coordination')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 coordination package, responsible for translating the package docs and current runtime foundation into a bounded, shippable coordination slice.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the v1 coordination package, tests, and package metadata according to the current coordination package intent and the now-hardened connectivity/foundation packages.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the coordination implementation for bounded v1 scope, clean dependency direction, and readiness for later memory/routing/product integration.',
      retries: 1,
    })

    .step('read-coordination-context', {
      type: 'deterministic',
      command: [
        'echo "---COORDINATION README---"',
        'sed -n "1,260p" packages/coordination/README.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,320p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---HOW TO BUILD AN ASSISTANT---"',
        'sed -n "1,320p" docs/consumer/how-to-build-an-assistant.md',
        'echo "" && echo "---CONNECTIVITY REVIEW VERDICT---"',
        'sed -n "1,260p" docs/architecture/v1-connectivity-package-review-verdict.md',
        'echo "" && echo "---CONNECTIVITY TYPES---"',
        'sed -n "1,360p" packages/connectivity/src/types.ts',
        'echo "" && echo "---CONNECTIVITY IMPLEMENTATION---"',
        'sed -n "1,360p" packages/connectivity/src/connectivity.ts',
        'echo "" && echo "---FOUNDATION INTEGRATION REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-foundation-integration-review-verdict.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-coordination-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-coordination-context'],
      task: `Using the coordination package docs, package-boundary map, assistant consumer guidance, connectivity package, and foundation integration context below, write a focused implementation plan for v1 coordination.

{{steps.read-coordination-context.output}}

Write docs/architecture/v1-coordination-implementation-plan.md.

The plan must:
1. define the bounded v1 coordination scope
2. name the exact files to create under packages/coordination
3. define the minimal coordinator/specialist/delegation/synthesis slice to implement now
4. define exactly how coordination depends on connectivity and how it must not take ownership of routing, memory, or surfaces
5. specify the minimum tests to write now

End the document with V1_COORDINATION_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-coordination-implementation-plan.md' },
    })

    .step('implement-coordination-package', {
      agent: 'implement-codex',
      dependsOn: ['lead-coordination-plan'],
      task: `Implement the v1 coordination package using docs/architecture/v1-coordination-implementation-plan.md and the current docs/package boundaries.

Required work:
- create/update package files under packages/coordination/
- implement the minimal coordinator/specialist registry/delegation/synthesis runtime for v1
- integrate with connectivity through a clean dependency direction
- keep routing, memory, surfaces, and transport concerns out of this package
- write tests for the intended first coordination workflows
- update packages/coordination/README.md from placeholder to actual package documentation

Expected package shape:
- packages/coordination/package.json
- packages/coordination/tsconfig.json
- packages/coordination/src/index.ts
- packages/coordination/src/types.ts
- packages/coordination/src/coordination.ts
- packages/coordination/src/coordination.test.ts
- packages/coordination/README.md

Requirements:
- TypeScript-first
- no cloud assumptions
- no product-specific logic
- coordination may depend on connectivity but not on routing ownership
- keep the package runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- end packages/coordination/README.md with COORDINATION_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/coordination/src/coordination.ts' },
    })

    .step('review-coordination-package', {
      agent: 'review-claude',
      dependsOn: ['implement-coordination-package'],
      task: `Review the implemented v1 coordination package.

Read:
- docs/architecture/v1-coordination-implementation-plan.md
- packages/connectivity/src/types.ts
- packages/connectivity/src/connectivity.ts
- packages/coordination/package.json
- packages/coordination/tsconfig.json
- packages/coordination/src/index.ts
- packages/coordination/src/types.ts
- packages/coordination/src/coordination.ts
- packages/coordination/src/coordination.test.ts
- packages/coordination/README.md

Assess:
1. Is the coordination package properly bounded for v1?
2. Does it depend on connectivity in a clean way?
3. Does it avoid taking ownership of routing, memory, surfaces, and transport?
4. Do the tests cover the intended first coordination behaviors?
5. What follow-ups remain before memory/routing/product integration?

Write docs/architecture/v1-coordination-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_COORDINATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-coordination-review-verdict.md' },
    })

    .step('verify-coordination-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-coordination-package'],
      command: [
        'test -f docs/architecture/v1-coordination-implementation-plan.md',
        'test -f packages/coordination/package.json',
        'test -f packages/coordination/tsconfig.json',
        'test -f packages/coordination/src/index.ts',
        'test -f packages/coordination/src/types.ts',
        'test -f packages/coordination/src/coordination.ts',
        'test -f packages/coordination/src/coordination.test.ts',
        'test -f packages/coordination/README.md',
        'test -f docs/architecture/v1-coordination-review-verdict.md',
        'grep -q "V1_COORDINATION_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-coordination-implementation-plan.md',
        'grep -q "COORDINATION_PACKAGE_IMPLEMENTED" packages/coordination/README.md',
        'grep -q "V1_COORDINATION_REVIEW_COMPLETE" docs/architecture/v1-coordination-review-verdict.md',
        'echo "V1_COORDINATION_IMPLEMENTATION_VERIFIED"',
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
