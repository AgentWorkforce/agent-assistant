import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('implement-v1-trusted-outsider-ingress')
    .description('Implement the first bounded trusted outsider ingress substrate inside @agent-assistant/inbox, with deterministic validation and no Cloud glue migration.')
    .pattern('supervisor')
    .channel('wf-implement-v1-trusted-outsider-ingress')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Locks the implementation contract, guards the boundary, and reviews whether the implementation stays inbox-adjacent and Cloud-free.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implements the bounded ingress substrate in packages/inbox, adds targeted tests, and fixes failures until validation passes.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the resulting package slice for boundary discipline, export correctness, and test coverage.',
      retries: 1,
    })

    .step('read-ingress-spec-context', {
      type: 'deterministic',
      command: [
        'echo "---TRUSTED OUTSIDER INGRESS BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-boundary.md',
        'echo "" && echo "---EXTRACTION MAP---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-extraction-map.md',
        'echo "" && echo "---PROOF PLAN---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-proof-plan.md',
        'echo "" && echo "---IMPLEMENTATION SEQUENCE---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-implementation-sequence.md',
        'echo "" && echo "---NO SHORTCUTS CHECKLIST---"',
        'sed -n "1,260p" docs/architecture/v1-trusted-outsider-ingress-no-shortcuts-checklist.md',
        'echo "" && echo "---REVIEW VERDICT---"',
        'sed -n "1,260p" docs/architecture/v1-trusted-outsider-ingress-review-verdict.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-inbox-code-context', {
      type: 'deterministic',
      command: [
        'echo "---INBOX INDEX---"',
        'sed -n "1,220p" packages/inbox/src/index.ts',
        'echo "" && echo "---INBOX TYPES---"',
        'sed -n "1,320p" packages/inbox/src/types.ts',
        'echo "" && echo "---INBOX STORE---"',
        'sed -n "1,280p" packages/inbox/src/inbox.ts',
        'echo "" && echo "---MEMORY PROJECTOR---"',
        'sed -n "1,260p" packages/inbox/src/memory-projector.ts',
        'echo "" && echo "---ENRICHMENT PROJECTOR---"',
        'sed -n "1,260p" packages/inbox/src/enrichment-projector.ts',
        'echo "" && echo "---INBOX TESTS---"',
        'find packages/inbox/src -maxdepth 1 \( -name "*.test.ts" -o -name "*.ts" \) | sort',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lock-implementation-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-ingress-spec-context', 'read-inbox-code-context'],
      task: `Lock the implementation contract for the first trusted outsider ingress substrate slice.

Ingress spec context:
{{steps.read-ingress-spec-context.output}}

Inbox code context:
{{steps.read-inbox-code-context.output}}

Write docs/architecture/v1-trusted-outsider-ingress-implementation-contract.md.

Requirements:
1. Restate the exact bounded slice to implement now inside packages/inbox.
2. Explicitly include the review follow-up resolutions now locked into the contract:
   - router catches thrown handler errors and returns deterministic error results
   - v1 contract set wording is aligned
   - package-local inbox exports are in scope, broader SDK facade re-exports are out of scope
3. Enumerate exactly which files may be created and which existing files may be modified.
4. Define exact validation commands and success criteria.
5. Explicitly forbid Cloud code edits, new dependencies, provider adapters, retry wrappers, transport abstractions, telemetry expansion, and SDK facade widening.

End the file with V1_TRUSTED_OUTSIDER_INGRESS_IMPLEMENTATION_CONTRACT_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-implementation-contract.md' },
    })

    .step('implement-ingress-substrate', {
      agent: 'impl-codex',
      dependsOn: ['lock-implementation-contract'],
      task: `Implement the first bounded trusted outsider ingress substrate in @agent-assistant/inbox.

Read and follow:
- docs/architecture/v1-trusted-outsider-ingress-boundary.md
- docs/architecture/v1-trusted-outsider-ingress-proof-plan.md
- docs/architecture/v1-trusted-outsider-ingress-implementation-sequence.md
- docs/architecture/v1-trusted-outsider-ingress-no-shortcuts-checklist.md
- docs/architecture/v1-trusted-outsider-ingress-implementation-contract.md
- packages/inbox/src/index.ts
- packages/inbox/src/types.ts
- existing inbox source files/tests

Implement only this bounded slice:
- create packages/inbox/src/ingress-types.ts
- create packages/inbox/src/ingress-router.ts
- create packages/inbox/src/ingress-projection.ts
- create packages/inbox/src/ingress-router.test.ts
- create packages/inbox/src/ingress-projection.test.ts
- modify packages/inbox/src/index.ts only as needed for package-local exports

Requirements:
1. No Cloud code edits.
2. No new package dependencies.
3. Keep the router minimal and deterministic.
4. Router must catch thrown handler errors and return a deterministic error result rather than throw.
5. Projection should bridge verified/resolved ingress input into the existing inbox write shape without changing inbox store behavior.
6. Do not widen @agent-assistant/sdk facade exports.
7. After implementation, run and fix until these pass:
   - npx vitest run packages/inbox/src/ingress-router.test.ts packages/inbox/src/ingress-projection.test.ts
   - npx vitest run packages/inbox/src

If failures occur, keep fixing and re-running until green.
Report the exact files created/modified and the validation results.
`,
      verification: { type: 'exit_code' },
    })

    .step('verify-ingress-files-materialized', {
      type: 'deterministic',
      dependsOn: ['implement-ingress-substrate'],
      command: [
        'test -f packages/inbox/src/ingress-types.ts',
        'test -f packages/inbox/src/ingress-router.ts',
        'test -f packages/inbox/src/ingress-projection.ts',
        'test -f packages/inbox/src/ingress-router.test.ts',
        'test -f packages/inbox/src/ingress-projection.test.ts',
        'grep -q "ingress" packages/inbox/src/index.ts',
        'echo "V1_TRUSTED_OUTSIDER_INGRESS_FILES_PRESENT"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-targeted-ingress-tests', {
      type: 'deterministic',
      dependsOn: ['verify-ingress-files-materialized'],
      command: 'npx vitest run packages/inbox/src/ingress-router.test.ts packages/inbox/src/ingress-projection.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-targeted-ingress-tests', {
      agent: 'impl-codex',
      dependsOn: ['run-targeted-ingress-tests'],
      task: `Fix any targeted ingress test failures.

Test output:
{{steps.run-targeted-ingress-tests.output}}

Read the new ingress files and tests. If the targeted tests already passed, make no functional changes. If they failed, fix the implementation or tests, then re-run:
- npx vitest run packages/inbox/src/ingress-router.test.ts packages/inbox/src/ingress-projection.test.ts

Continue until the targeted ingress tests pass.`,
      verification: { type: 'exit_code' },
    })

    .step('run-targeted-ingress-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-targeted-ingress-tests'],
      command: 'npx vitest run packages/inbox/src/ingress-router.test.ts packages/inbox/src/ingress-projection.test.ts',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-inbox-suite', {
      type: 'deterministic',
      dependsOn: ['run-targeted-ingress-tests-final'],
      command: 'npx vitest run packages/inbox/src',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-inbox-regressions', {
      agent: 'impl-codex',
      dependsOn: ['run-inbox-suite'],
      task: `Fix any inbox regression failures caused by the trusted outsider ingress slice.

Inbox suite output:
{{steps.run-inbox-suite.output}}

If the inbox suite already passed, make no functional changes. If there are failures, fix them and re-run:
- npx vitest run packages/inbox/src

Continue until the inbox suite passes without widening scope.`,
      verification: { type: 'exit_code' },
    })

    .step('run-inbox-suite-final', {
      type: 'deterministic',
      dependsOn: ['fix-inbox-regressions'],
      command: 'npx vitest run packages/inbox/src',
      captureOutput: true,
      failOnError: true,
    })

    .step('review-ingress-implementation', {
      agent: 'review-codex',
      dependsOn: ['run-inbox-suite-final'],
      task: `Review the implemented trusted outsider ingress slice.

Read:
- docs/architecture/v1-trusted-outsider-ingress-boundary.md
- docs/architecture/v1-trusted-outsider-ingress-implementation-contract.md
- docs/architecture/v1-trusted-outsider-ingress-no-shortcuts-checklist.md
- packages/inbox/src/ingress-types.ts
- packages/inbox/src/ingress-router.ts
- packages/inbox/src/ingress-projection.ts
- packages/inbox/src/ingress-router.test.ts
- packages/inbox/src/ingress-projection.test.ts
- packages/inbox/src/index.ts

Assess:
1. Did the implementation stay inside the approved inbox-adjacent substrate?
2. Are router error semantics aligned with the tightened contract?
3. Did the work avoid Cloud edits, new deps, retry wrappers, transport abstractions, telemetry expansion, and SDK facade widening?
4. Are the tests strong enough for this bounded slice?
5. Verdict: PASS, PASS_WITH_FOLLOWUPS, or FAIL.

Write docs/architecture/v1-trusted-outsider-ingress-implementation-review-verdict.md.
End with V1_TRUSTED_OUTSIDER_INGRESS_IMPLEMENTATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-implementation-review-verdict.md' },
    })

    .step('verify-final-ingress-slice', {
      type: 'deterministic',
      dependsOn: ['review-ingress-implementation'],
      command: [
        'test -f docs/architecture/v1-trusted-outsider-ingress-implementation-contract.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-implementation-review-verdict.md',
        'test -f packages/inbox/src/ingress-types.ts',
        'test -f packages/inbox/src/ingress-router.ts',
        'test -f packages/inbox/src/ingress-projection.ts',
        'test -f packages/inbox/src/ingress-router.test.ts',
        'test -f packages/inbox/src/ingress-projection.test.ts',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_IMPLEMENTATION_CONTRACT_READY" docs/architecture/v1-trusted-outsider-ingress-implementation-contract.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_IMPLEMENTATION_REVIEW_COMPLETE" docs/architecture/v1-trusted-outsider-ingress-implementation-review-verdict.md',
        'echo "V1_TRUSTED_OUTSIDER_INGRESS_IMPLEMENTATION_VERIFIED"',
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
