import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-implement-v1-continuation')
    .description('Implement @agent-assistant/continuation as the bounded runtime primitive that turns resumable harness outcomes into explicit continuation records and real follow-up delivery state, with 80-to-100 validation inside the workflow.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-implement-continuation')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead architect ensuring the continuation package stays bounded, separated cleanly from harness/turn-context/memory/proactive, and aligned with the approved primitive boundary.',
      retries: 1,
    })
    .agent('impl-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the @agent-assistant/continuation package, tests, and docs with real validation gates and no autonomy sprawl.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the continuation implementation for boundary discipline, API usefulness, truthfulness semantics, and validation strength.',
      retries: 1,
    })

    .step('read-continuation-implementation-context', {
      type: 'deterministic',
      command: [
        'echo "---CONTINUATION BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/v1-continuation-boundary.md',
        'echo "" && echo "---CONTINUATION SPEC---"',
        'sed -n "1,360p" docs/specs/v1-continuation-spec.md',
        'echo "" && echo "---CONTINUATION REVIEW---"',
        'sed -n "1,240p" docs/architecture/v1-continuation-review-verdict.md',
        'echo "" && echo "---RUNTIME PRIMITIVE MAP---"',
        'sed -n "1,280p" docs/architecture/agent-assistant-runtime-primitive-map.md',
        'echo "" && echo "---HARNESS SPEC---"',
        'sed -n "1,280p" docs/specs/v1-harness-spec.md',
        'echo "" && echo "---TURN CONTEXT SPEC---"',
        'sed -n "1,260p" docs/specs/v1-turn-context-enrichment-spec.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-continuation-implementation-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-continuation-implementation-context'],
      task: `Define the exact first implementation plan for @agent-assistant/continuation from the approved docs below.

{{steps.read-continuation-implementation-context.output}}

Write docs/architecture/v1-continuation-implementation-plan.md.

The plan must explicitly define:
1. package/files to create in packages/continuation
2. the minimum public API surface for v1
3. the continuation record model and resumed-turn re-entry expectations
4. tests needed to prove this is more than a placeholder
5. what is intentionally deferred

Keep this bounded and implementation-driving. End with V1_CONTINUATION_IMPLEMENTATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-continuation-implementation-plan.md' },
    })

    .step('implement-continuation-package', {
      agent: 'impl-claude',
      dependsOn: ['define-continuation-implementation-plan'],
      task: `Implement @agent-assistant/continuation from the approved boundary/spec/plan.

Binding docs:
- docs/architecture/v1-continuation-boundary.md
- docs/specs/v1-continuation-spec.md
- docs/architecture/v1-continuation-implementation-plan.md
- docs/specs/v1-harness-spec.md

Requirements:
- create packages/continuation
- implement the v1 continuation record lifecycle and bounded state model only
- include explicit wait conditions / resume triggers / TTL / terminal stop reasons
- keep follow-up delivery state in scope, but do not build a giant scheduler/workflow engine
- keep policy/memory/proactive concerns out of ownership
- add meaningful tests
- add package README and workspace updates as needed

IMPORTANT:
- write files to disk
- do not overbuild into generic long-running autonomy
- end your final summary with V1_CONTINUATION_PACKAGE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: 'packages/continuation/package.json' },
    })

    .step('run-continuation-tests-first-pass', {
      type: 'deterministic',
      dependsOn: ['implement-continuation-package'],
      command: 'npm test -w @agent-assistant/continuation 2>&1',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-continuation-test-failures', {
      agent: 'impl-claude',
      dependsOn: ['run-continuation-tests-first-pass'],
      task: `Check the first-pass continuation test output and fix any failures until the package is green.

Test output:
{{steps.run-continuation-tests-first-pass.output}}

If all tests already passed, do nothing.
If there are failures:
1. Read the failing test(s) and source files
2. Fix the implementation or tests as needed
3. Re-run: npm test -w @agent-assistant/continuation
4. Keep fixing until all tests pass

Then also ensure build and pack dry-run work.
End with V1_CONTINUATION_TEST_FIX_COMPLETE when done.`,
      verification: { type: 'exit_code' },
    })

    .step('validate-continuation-package', {
      type: 'deterministic',
      dependsOn: ['fix-continuation-test-failures'],
      command: [
        'npm run build -w @agent-assistant/continuation',
        'npm test -w @agent-assistant/continuation',
        'npm pack --dry-run -w @agent-assistant/continuation',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-continuation-package', {
      agent: 'review-codex',
      dependsOn: ['validate-continuation-package'],
      task: `Review the implemented @agent-assistant/continuation package.

Read:
- docs/architecture/v1-continuation-boundary.md
- docs/specs/v1-continuation-spec.md
- docs/architecture/v1-continuation-implementation-plan.md
- packages/continuation/**
- validation output:
{{steps.validate-continuation-package.output}}

Assess:
1. did the implementation stay bounded?
2. is the continuation model useful to a real product?
3. does it clearly separate from harness/turn-context/proactive/memory?
4. are the tests and validation strong enough for a first package pass?
5. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-continuation-package-review-verdict.md.
End with V1_CONTINUATION_PACKAGE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-continuation-package-review-verdict.md' },
    })

    .step('verify-continuation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-continuation-package'],
      command: [
        'test -f packages/continuation/package.json',
        'test -f packages/continuation/README.md',
        'test -f packages/continuation/src/index.ts',
        'test -f docs/architecture/v1-continuation-implementation-plan.md',
        'test -f docs/architecture/v1-continuation-package-review-verdict.md',
        'grep -q "V1_CONTINUATION_IMPLEMENTATION_PLAN_READY" docs/architecture/v1-continuation-implementation-plan.md',
        'grep -q "V1_CONTINUATION_PACKAGE_REVIEW_COMPLETE" docs/architecture/v1-continuation-package-review-verdict.md',
        'echo "V1_CONTINUATION_PACKAGE_VERIFIED"',
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
