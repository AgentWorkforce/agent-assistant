const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('agent-assistant-sdk-implement-v1-connectivity')
    .description('Implement the v1 connectivity package for agent-assistant-sdk from the canonical connectivity spec and implementation plan.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-impl-connectivity')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead implementation architect for the v1 connectivity package, responsible for translating the bounded connectivity spec into a minimal, shippable package slice.',
      retries: 1,
    })
    .agent('implement-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements the v1 connectivity package, tests, and package metadata according to the canonical connectivity spec and implementation plan.',
      retries: 1,
    })
    .agent('review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Reviews the connectivity implementation for spec compliance, package boundary discipline, and readiness for later routing/foundation integration.',
      retries: 1,
    })

    .step('read-connectivity-implementation-context', {
      type: 'deterministic',
      command: [
        'echo "---CONNECTIVITY SPEC---"',
        'sed -n "1,360p" docs/specs/v1-connectivity-spec.md',
        'echo "" && echo "---CONNECTIVITY PLAN---"',
        'sed -n "1,320p" docs/architecture/v1-connectivity-implementation-plan.md',
        'echo "" && echo "---CONNECTIVITY SIGNAL CATALOG---"',
        'sed -n "1,320p" docs/reference/connectivity-signal-catalog.md',
        'echo "" && echo "---ROUTING SPEC---"',
        'sed -n "1,260p" docs/specs/v1-routing-spec.md',
        'echo "" && echo "---CONNECTIVITY README---"',
        'sed -n "1,240p" packages/connectivity/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-connectivity-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-connectivity-implementation-context'],
      task: `Using the v1 connectivity spec, implementation plan, and signal catalog below, write a focused implementation plan for the package itself.

{{steps.read-connectivity-implementation-context.output}}

Write docs/architecture/v1-connectivity-package-implementation-plan.md.

The plan must:
1. name the exact files to create under packages/connectivity
2. define the minimal v1 slice to implement now
3. keep routing interaction abstract (hooks/interfaces only)
4. keep boundaries strict: no routing ownership, no coordination ownership, no transport implementation
5. specify the minimum tests to write now

End the document with V1_CONNECTIVITY_PACKAGE_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-connectivity-package-implementation-plan.md' },
    })

    .step('implement-connectivity-package', {
      agent: 'implement-codex',
      dependsOn: ['lead-connectivity-plan'],
      task: `Implement the v1 connectivity package using docs/architecture/v1-connectivity-package-implementation-plan.md, docs/specs/v1-connectivity-spec.md, and docs/reference/connectivity-signal-catalog.md.

Required work:
- create/update package files under packages/connectivity/
- implement the minimal signal envelope/types and runtime for v1
- implement salience, confidence, audience, suppression, escalation, and convergence primitives within the bounded v1 scope
- expose routing interaction points as interfaces/hooks only, not a routing implementation
- write tests for the intended first connectivity workflows
- update packages/connectivity/README.md from placeholder/spec doc to actual package documentation

Expected package shape:
- packages/connectivity/package.json
- packages/connectivity/tsconfig.json
- packages/connectivity/src/index.ts
- packages/connectivity/src/types.ts
- packages/connectivity/src/connectivity.ts
- packages/connectivity/src/connectivity.test.ts
- packages/connectivity/README.md

Requirements:
- TypeScript-first
- no cloud assumptions
- no routing ownership
- no coordination ownership
- no transport implementation
- make the package runnable/testable in isolation

IMPORTANT:
- write files to disk
- do not print full file contents to stdout
- end packages/connectivity/README.md with CONNECTIVITY_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/connectivity/src/connectivity.ts' },
    })

    .step('review-connectivity-package', {
      agent: 'review-claude',
      dependsOn: ['implement-connectivity-package'],
      task: `Review the implemented v1 connectivity package.

Read:
- docs/specs/v1-connectivity-spec.md
- docs/architecture/v1-connectivity-package-implementation-plan.md
- docs/reference/connectivity-signal-catalog.md
- docs/specs/v1-routing-spec.md
- packages/connectivity/package.json
- packages/connectivity/tsconfig.json
- packages/connectivity/src/index.ts
- packages/connectivity/src/types.ts
- packages/connectivity/src/connectivity.ts
- packages/connectivity/src/connectivity.test.ts
- packages/connectivity/README.md

Assess:
1. Does the implementation match the canonical connectivity spec closely enough for v1?
2. Are boundaries with routing/coordination/transport kept clean?
3. Do the tests cover the intended first connectivity behaviors?
4. What follow-ups remain before connectivity integration work begins?

Write docs/architecture/v1-connectivity-package-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with V1_CONNECTIVITY_PACKAGE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-connectivity-package-review-verdict.md' },
    })

    .step('verify-connectivity-package-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-connectivity-package'],
      command: [
        'test -f docs/architecture/v1-connectivity-package-implementation-plan.md',
        'test -f packages/connectivity/package.json',
        'test -f packages/connectivity/tsconfig.json',
        'test -f packages/connectivity/src/index.ts',
        'test -f packages/connectivity/src/types.ts',
        'test -f packages/connectivity/src/connectivity.ts',
        'test -f packages/connectivity/src/connectivity.test.ts',
        'test -f packages/connectivity/README.md',
        'test -f docs/architecture/v1-connectivity-package-review-verdict.md',
        'grep -q "V1_CONNECTIVITY_PACKAGE_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-connectivity-package-implementation-plan.md',
        'grep -q "CONNECTIVITY_PACKAGE_IMPLEMENTED" packages/connectivity/README.md',
        'grep -q "V1_CONNECTIVITY_PACKAGE_REVIEW_COMPLETE" docs/architecture/v1-connectivity-package-review-verdict.md',
        'echo "V1_CONNECTIVITY_PACKAGE_IMPLEMENTATION_VERIFIED"',
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
