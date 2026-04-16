import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('adopt-v1-trusted-outsider-ingress-in-cloud-nango')
    .description('Prove and plan Cloud adoption of the trusted outsider ingress substrate around the existing Nango webhook flow without moving hosted glue into the SDK.')
    .pattern('supervisor')
    .channel('wf-adopt-v1-trusted-outsider-ingress-in-cloud-nango')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Locks the Cloud adoption boundary and ensures the proving slice remains additive, wrapper-based, and Cloud-owned where required.',
      retries: 1,
    })
    .agent('author-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Authors the Cloud alignment proof, additive adoption plan, and workflow-ready validation sequence for Nango ingress adoption.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews whether the Cloud adoption plan preserves hosted boundaries, avoids SDK widening, and remains safe to execute later.',
      retries: 1,
    })

    .step('read-agent-assistant-ingress-context', {
      type: 'deterministic',
      command: [
        'echo "---INGRESS BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-boundary.md',
        'echo "" && echo "---EXTRACTION MAP---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-extraction-map.md',
        'echo "" && echo "---PROOF PLAN---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-proof-plan.md',
        'echo "" && echo "---CLOUD ADOPTION PLAN---"',
        'sed -n "1,320p" docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-plan.md',
        'echo "" && echo "---IMPLEMENTATION CONTRACT---"',
        'sed -n "1,260p" docs/architecture/v1-trusted-outsider-ingress-implementation-contract.md',
        'echo "" && echo "---IMPLEMENTATION REVIEW---"',
        'sed -n "1,260p" docs/architecture/v1-trusted-outsider-ingress-implementation-review-verdict.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-cloud-nango-adoption-context', {
      type: 'deterministic',
      command: [
        'echo "---NANGO ROUTE---"',
        'sed -n "1,240p" ../cloud/packages/web/app/api/v1/webhooks/nango/route.ts',
        'echo "" && echo "---WORKSPACE RESOLVER---"',
        'sed -n "1,320p" ../cloud/packages/web/lib/integrations/workspace-identity-resolver.ts',
        'echo "" && echo "---NANGO ROUTER HEAD---"',
        'sed -n "1,360p" ../cloud/packages/web/lib/integrations/nango-webhook-router.ts',
        'echo "" && echo "---NANGO ROUTER MID---"',
        'sed -n "360,1080p" ../cloud/packages/web/lib/integrations/nango-webhook-router.ts',
        'echo "" && echo "---NANGO ROUTER TAIL---"',
        'sed -n "1080,1900p" ../cloud/packages/web/lib/integrations/nango-webhook-router.ts',
        'echo "" && echo "---NANGO TESTS---"',
        'sed -n "1,360p" ../cloud/tests/nango-sync-relayfile.test.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lock-cloud-adoption-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-agent-assistant-ingress-context', 'read-cloud-nango-adoption-context'],
      task: `Lock the Cloud adoption contract for trusted outsider ingress around the Nango proving case.

Agent Assistant ingress context:
{{steps.read-agent-assistant-ingress-context.output}}

Cloud Nango context:
{{steps.read-cloud-nango-adoption-context.output}}

Write docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md.

Requirements:
1. Restate the additive wrapper-based adoption posture.
2. Define exact Cloud-only boundaries that must not move into the SDK.
3. Define the exact seam where Cloud may adopt the SDK ingress substrate.
4. State clearly that this slice is read-proof plus adoption-plan oriented unless a later workflow explicitly edits Cloud.
5. Forbid wholesale router migration, SDK surface widening, transport abstraction drift, and provider-parser extraction.
6. Define exact validation gates for later adoption work.

End with V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_CONTRACT_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md' },
    })

    .step('author-cloud-alignment-and-adoption-plan', {
      agent: 'author-codex',
      dependsOn: ['lock-cloud-adoption-contract'],
      task: `Author the Cloud proving/adoption artifacts for trusted outsider ingress.

Read and follow:
- docs/architecture/v1-trusted-outsider-ingress-boundary.md
- docs/architecture/v1-trusted-outsider-ingress-extraction-map.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-plan.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md
- existing Cloud Nango route/resolver/router/test context

Write:
- docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md

Requirements:
1. Produce an explicit type and responsibility mapping from Cloud Nango concepts to the SDK ingress substrate.
2. Call out every field or behavior that remains Cloud-only.
3. Define the thinnest possible wrapper-based adoption sequence for Cloud.
4. Include rollback criteria and stop conditions if hidden coupling appears.
5. Keep the plan concrete enough for a future implementation workflow in Cloud, but do not edit Cloud code now.

End docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md with V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ALIGNMENT_READY.
End docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md with V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_WRAPPER_SEQUENCE_READY.
End docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md with V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_RISK_CHECKLIST_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md' },
    })

    .step('review-cloud-adoption-slice', {
      agent: 'review-codex',
      dependsOn: ['author-cloud-alignment-and-adoption-plan'],
      task: `Review the Cloud adoption slice for trusted outsider ingress.

Read:
- docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-plan.md
- docs/architecture/v1-trusted-outsider-ingress-boundary.md

Assess:
1. Does the plan preserve Cloud-only hosted glue boundaries?
2. Is the adoption shape additive and wrapper-based rather than a rewrite?
3. Does it avoid widening the SDK surface just to fit Cloud Nango?
4. Are rollback criteria honest and concrete?
5. Verdict: PASS, PASS_WITH_FOLLOWUPS, or FAIL.

Write docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-review-verdict.md.
End with V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-review-verdict.md' },
    })

    .step('verify-cloud-adoption-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-cloud-adoption-slice'],
      command: [
        'test -f docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-review-verdict.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_CONTRACT_READY" docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-contract.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ALIGNMENT_READY" docs/architecture/v1-trusted-outsider-ingress-cloud-alignment-proof.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_WRAPPER_SEQUENCE_READY" docs/architecture/v1-trusted-outsider-ingress-cloud-wrapper-adoption-sequence.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_RISK_CHECKLIST_READY" docs/architecture/v1-trusted-outsider-ingress-cloud-rollback-and-risk-checklist.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_REVIEW_COMPLETE" docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-review-verdict.md',
        'echo "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_ARTIFACTS_VERIFIED"',
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
