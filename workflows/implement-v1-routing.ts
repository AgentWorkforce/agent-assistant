const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-agent-assistant-implement-v1-routing')
    .description('Implement the v1 routing package for relay-agent-assistant from the routing spec, workforce-aligned concepts, and current package foundation.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-impl-routing')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 routing package, responsible for translating the routing spec and workforce-aligned constraints into a bounded, shippable package slice.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the v1 routing package, tests, and package metadata according to the canonical routing spec and current assistant-sdk foundation.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the routing implementation for bounded scope, workforce alignment, latency/depth/cost correctness, and clean dependency direction.',
      retries: 1,
    })

    .step('read-routing-context', {
      type: 'deterministic',
      command: [
        'echo "---ROUTING SPEC---"',
        'sed -n "1,360p" docs/specs/v1-routing-spec.md',
        'echo "" && echo "---WORKFORCE COMPARISON---"',
        'sed -n "1,320p" docs/research/internal-system-comparison.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,320p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---CONNECTIVITY REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-connectivity-package-review-verdict.md',
        'echo "" && echo "---COORDINATION HARDENING REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-coordination-hardening-review-verdict.md',
        'echo "" && echo "---CONNECTIVITY TYPES---"',
        'sed -n "1,320p" packages/connectivity/src/types.ts',
        'echo "" && echo "---COORDINATION TYPES---"',
        'sed -n "1,320p" packages/coordination/src/types.ts',
        'echo "" && echo "---ROUTING README---"',
        'sed -n "1,240p" packages/routing/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-routing-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-routing-context'],
      task: `Using the routing spec, workforce-aligned comparison notes, package-boundary map, and current connectivity/coordination context below, write a focused implementation plan for v1 routing.

{{steps.read-routing-context.output}}

Write docs/architecture/v1-routing-implementation-plan.md.

The plan must:
1. define the bounded v1 routing scope
2. name the exact files to create under packages/routing
3. define the minimal cheap/fast/deep and latency/depth/cost routing slice to implement now
4. specify how routing interacts with connectivity without collapsing the package boundary
5. keep package boundaries strict: no provider SDK ownership, no transport, no product-specific routing policies
6. specify the minimum tests to write now

End the document with V1_ROUTING_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-routing-implementation-plan.md' },
    })

    .step('implement-routing-package', {
      agent: 'implement-codex',
      dependsOn: ['lead-routing-plan'],
      task: `Implement the v1 routing package using docs/architecture/v1-routing-implementation-plan.md and docs/specs/v1-routing-spec.md.

Required work:
- create/update package files under packages/routing/
- implement the minimal routing mode/types/runtime for v1
- implement cheap/fast/deep and latency/depth/cost policy primitives within bounded scope
- implement clean hooks/interfaces for connectivity interaction without taking over connectivity
- keep workforce alignment visible in naming and semantics without importing external provider logic
- write tests for the intended first routing workflows
- update packages/routing/README.md from placeholder to actual package documentation

Expected package shape:
- packages/routing/package.json
- packages/routing/tsconfig.json
- packages/routing/src/index.ts
- packages/routing/src/types.ts
- packages/routing/src/routing.ts
- packages/routing/src/routing.test.ts
- packages/routing/README.md

Requirements:
- TypeScript-first
- no cloud assumptions
- no product-specific logic
- no provider SDK ownership
- no transport implementation
- keep the package runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- end packages/routing/README.md with ROUTING_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/routing/src/routing.ts' },
    })

    .step('review-routing-package', {
      agent: 'review-claude',
      dependsOn: ['implement-routing-package'],
      task: `Review the implemented v1 routing package.

Read:
- docs/specs/v1-routing-spec.md
- docs/architecture/v1-routing-implementation-plan.md
- packages/connectivity/src/types.ts
- packages/coordination/src/types.ts
- packages/routing/package.json
- packages/routing/tsconfig.json
- packages/routing/src/index.ts
- packages/routing/src/types.ts
- packages/routing/src/routing.ts
- packages/routing/src/routing.test.ts
- packages/routing/README.md

Assess:
1. Is the routing package properly bounded for v1?
2. Does it model cheap/fast/deep and latency/depth/cost clearly enough?
3. Are workforce-aligned concepts reflected without overreaching package scope?
4. Are connectivity/coordination boundaries still clean?
5. What follow-ups remain before memory or product integration?

Write docs/architecture/v1-routing-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_ROUTING_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-routing-review-verdict.md' },
    })

    .step('verify-routing-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-routing-package'],
      command: [
        'test -f docs/architecture/v1-routing-implementation-plan.md',
        'test -f packages/routing/package.json',
        'test -f packages/routing/tsconfig.json',
        'test -f packages/routing/src/index.ts',
        'test -f packages/routing/src/types.ts',
        'test -f packages/routing/src/routing.ts',
        'test -f packages/routing/src/routing.test.ts',
        'test -f packages/routing/README.md',
        'test -f docs/architecture/v1-routing-review-verdict.md',
        'grep -q "V1_ROUTING_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-routing-implementation-plan.md',
        'grep -q "ROUTING_PACKAGE_IMPLEMENTED" packages/routing/README.md',
        'grep -q "V1_ROUTING_REVIEW_COMPLETE" docs/architecture/v1-routing-review-verdict.md',
        'echo "V1_ROUTING_IMPLEMENTATION_VERIFIED"',
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
