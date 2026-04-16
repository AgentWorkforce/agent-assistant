import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('implement-v1-trusted-outsider-ingress-in-cloud-nango')
    .description('Implement the thin Cloud-owned adapter layer for trusted outsider ingress around the Nango webhook flow, with rollback and equivalence gates baked in.')
    .pattern('supervisor')
    .channel('wf-implement-v1-trusted-outsider-ingress-in-cloud-nango')
    .maxConcurrency(4)
    .timeout(7_200_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Locks the Cloud implementation contract and guards the adoption seam, rollback posture, and no-shortcuts boundaries.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implements thin Cloud-owned ingress adapters, wiring, and additive tests without migrating hosted glue into the SDK.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the Cloud ingress implementation for seam correctness, equivalence proof quality, and rollback safety.',
      retries: 1,
    })

    .step('read-cloud-adoption-contracts', {
      type: 'deterministic',
      command: [
        'echo "---CLOUD ADOPTION CONTRACT---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md',
        'echo "" && echo "---CLOUD ALIGNMENT PROOF---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md',
        'echo "" && echo "---CLOUD WRAPPER SEQUENCE---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md',
        'echo "" && echo "---CLOUD RISK CHECKLIST---"',
        'sed -n "1,260p" docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md',
        'echo "" && echo "---CLOUD REVIEW VERDICT---"',
        'sed -n "1,260p" docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-review-verdict.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-cloud-code-context', {
      type: 'deterministic',
      command: [
        'echo "---CLOUD NANGO ROUTE---"',
        'sed -n "1,260p" ../cloud/packages/web/app/api/v1/webhooks/nango/route.ts',
        'echo "" && echo "---CLOUD WORKSPACE RESOLVER---"',
        'sed -n "1,320p" ../cloud/packages/web/lib/integrations/workspace-identity-resolver.ts',
        'echo "" && echo "---CLOUD NANGO ROUTER HEAD---"',
        'sed -n "1,360p" ../cloud/packages/web/lib/integrations/nango-webhook-router.ts',
        'echo "" && echo "---CLOUD NANGO ROUTER MID---"',
        'sed -n "360,1080p" ../cloud/packages/web/lib/integrations/nango-webhook-router.ts',
        'echo "" && echo "---CLOUD NANGO ROUTER TAIL---"',
        'sed -n "1080,1900p" ../cloud/packages/web/lib/integrations/nango-webhook-router.ts',
        'echo "" && echo "---CLOUD TESTS---"',
        'sed -n "1,360p" ../cloud/tests/nango-sync-relayfile.test.ts',
        'echo "" && echo "---CLOUD PACKAGE JSON---"',
        'sed -n "1,220p" ../cloud/packages/web/package.json',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lock-cloud-implementation-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-cloud-adoption-contracts', 'read-cloud-code-context'],
      task: `Lock the Cloud implementation contract for trusted outsider ingress.

Contracts:
{{steps.read-cloud-adoption-contracts.output}}

Cloud code context:
{{steps.read-cloud-code-context.output}}

Write docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-contract.md.

Requirements:
1. Restate the exact bounded Cloud implementation slice.
2. Enumerate which new Cloud files may be created and which existing Cloud files may be modified.
3. Lock the implementation-time follow-ups from the adoption review:
   - exact forward/auth handler registration shape
   - one stable IngressHandlerResult.outcome convention
   - explicit forward/auth equivalence evidence before route cutover
4. Require rollback-safe route wiring.
5. Forbid SDK widening, parser extraction, transport abstraction drift, resolver retry leakage, and hosted glue migration.
6. Define exact validation commands and evidence gates.

End with V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_IMPLEMENTATION_CONTRACT_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-contract.md' },
    })

    .step('implement-cloud-ingress-adapters', {
      agent: 'impl-codex',
      dependsOn: ['lock-cloud-implementation-contract'],
      task: `Implement the thin Cloud-owned ingress adapter layer in the sibling Cloud repo.

Read and follow:
- docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-contract.md
- current Cloud route/resolver/router/tests in ../cloud

Work in ../cloud only.

Implementation goals:
1. Add thin shape-conversion helpers for Nango envelope and workspace-resolution/result mapping.
2. Add thin verifier/resolver wrappers that satisfy the SDK ingress contracts without changing Cloud semantics.
3. Add a small handler registration/orchestration layer that uses the SDK ingress router while delegating all provider-specific logic to existing Cloud functions.
4. Add additive tests for wrapper shape conversion and route/equivalence evidence, including forward and auth coverage.
5. If route wiring is introduced, keep it rollback-safe and reversible, with the old path preserved until equivalence is proven.

Hard constraints:
- no SDK repo edits from this step
- no new npm dependencies
- no provider-parser extraction into the SDK
- no Cloud function signature changes just to fit SDK types
- no migration of relayfile writes, DB logic, retries, or forwarding into shared substrate

Validation goals:
- targeted Cloud tests for new wrappers/equivalence
- existing nango sync tests still pass
- any route cutover path is backed by explicit forward/auth/sync equivalence evidence

If failures appear, keep fixing and re-running until the bounded Cloud slice is green.
Report the exact Cloud files created/modified and the validation performed.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-cloud-files-materialized', {
      type: 'deterministic',
      dependsOn: ['implement-cloud-ingress-adapters'],
      command: [
        'test -f docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-contract.md',
        'find ../cloud/packages/web -type f | grep -E "ingress|nango" >/dev/null',
        'echo "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_FILES_PRESENT"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-cloud-targeted-tests', {
      type: 'deterministic',
      dependsOn: ['verify-cloud-files-materialized'],
      command: 'cd ../cloud && npm test -- --runInBand tests/nango-sync-relayfile.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-cloud-targeted-tests', {
      agent: 'impl-codex',
      dependsOn: ['run-cloud-targeted-tests'],
      task: `Fix any Cloud targeted test failures for the Nango ingress adoption slice.

Test output:
{{steps.run-cloud-targeted-tests.output}}

Read the changed Cloud files and tests. If the targeted tests already passed, make no functional changes. If they failed, fix the issues and re-run the relevant Cloud tests until green.

Do not widen scope beyond the locked Cloud implementation contract.`,
      verification: { type: 'exit_code' },
    })

    .step('run-cloud-targeted-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-cloud-targeted-tests'],
      command: 'cd ../cloud && npm test -- --runInBand tests/nango-sync-relayfile.test.ts',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-cloud-validation-suite', {
      type: 'deterministic',
      dependsOn: ['run-cloud-targeted-tests-final'],
      command: 'cd ../cloud && npm test',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-cloud-regressions', {
      agent: 'impl-codex',
      dependsOn: ['run-cloud-validation-suite'],
      task: `Fix any Cloud regressions introduced by the ingress adoption slice.

Cloud validation output:
{{steps.run-cloud-validation-suite.output}}

If the Cloud suite already passed, make no functional changes. If there are failures, fix them and re-run until the bounded Cloud slice passes without violating the contract.`,
      verification: { type: 'exit_code' },
    })

    .step('run-cloud-validation-suite-final', {
      type: 'deterministic',
      dependsOn: ['fix-cloud-regressions'],
      command: 'cd ../cloud && npm test',
      captureOutput: true,
      failOnError: true,
    })

    .step('review-cloud-implementation', {
      agent: 'review-codex',
      dependsOn: ['run-cloud-validation-suite-final'],
      task: `Review the Cloud implementation of trusted outsider ingress adoption.

Read:
- docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-contract.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md
- changed Cloud files in ../cloud
- relevant Cloud tests and evidence outputs

Assess:
1. Did the implementation stay additive and wrapper-based?
2. Were Cloud-only boundaries preserved?
3. Is the handler registration shape locked and honest?
4. Is the chosen outcome convention stable and minimally distortionary?
5. Is forward/auth/sync equivalence evidence explicit enough for any route cutover?
6. Is rollback still simple and real?
7. Verdict: KEEP, PAUSE, or ROLLBACK.

Write docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-review-verdict.md.
End with V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_IMPLEMENTATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-review-verdict.md' },
    })

    .step('verify-cloud-implementation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-cloud-implementation'],
      command: [
        'test -f docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-contract.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-review-verdict.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_IMPLEMENTATION_CONTRACT_READY" docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-contract.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_IMPLEMENTATION_REVIEW_COMPLETE" docs/architecture/v1-trusted-outsider-ingress-cloud-implementation-review-verdict.md',
        'echo "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_IMPLEMENTATION_VERIFIED"',
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
