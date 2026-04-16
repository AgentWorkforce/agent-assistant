import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('specify-v1-trusted-outsider-ingress')
    .description('Define the first bounded Agent Assistant trusted outsider ingress slice, using Cloud Nango webhook handling as the proving case while keeping hosted transport, env, DB, and deployment glue in Cloud.')
    .pattern('supervisor')
    .channel('wf-specify-v1-trusted-outsider-ingress')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Defines the bounded trusted outsider ingress architecture and extraction map from Cloud into Agent Assistant.',
      retries: 1,
    })
    .agent('author-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Authors the boundary docs, extraction map, and workflow-ready implementation plan for trusted outsider ingress.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the ingress boundary for boundedness, package fit, and hosted-vs-SDK separation quality.',
      retries: 1,
    })

    .step('read-agent-assistant-ingress-context', {
      type: 'deterministic',
      command: [
        'echo "---AGENT INBOX BOUNDARY---"',
        'sed -n "1,260p" docs/architecture/v1-agent-inbox-boundary.md',
        'echo "" && echo "---INBOX VS RELAY NATIVE---"',
        'sed -n "1,260p" docs/architecture/agent-inbox-and-relay-native-communication.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,320p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---INBOX README---"',
        'sed -n "1,220p" packages/inbox/README.md',
        'echo "" && echo "---INTEGRATION README---"',
        'sed -n "1,220p" packages/integration/README.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-cloud-nango-proving-context', {
      type: 'deterministic',
      command: [
        'echo "---CLOUD NANGO ROUTE---"',
        'sed -n "1,220p" ../cloud/packages/web/app/api/v1/webhooks/nango/route.ts',
        'echo "" && echo "---WORKSPACE IDENTITY RESOLVER---"',
        'sed -n "1,260p" ../cloud/packages/web/lib/integrations/workspace-identity-resolver.ts',
        'echo "" && echo "---NANGO WEBHOOK ROUTER HEAD---"',
        'sed -n "1,320p" ../cloud/packages/web/lib/integrations/nango-webhook-router.ts',
        'echo "" && echo "---NANGO WEBHOOK ROUTER MID---"',
        'sed -n "320,1120p" ../cloud/packages/web/lib/integrations/nango-webhook-router.ts',
        'echo "" && echo "---NANGO WEBHOOK ROUTER TAIL---"',
        'sed -n "1120,1815p" ../cloud/packages/web/lib/integrations/nango-webhook-router.ts',
        'echo "" && echo "---NANGO SYNC TESTS---"',
        'sed -n "1,320p" ../cloud/tests/nango-sync-relayfile.test.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-trusted-outsider-ingress-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-agent-assistant-ingress-context', 'read-cloud-nango-proving-context'],
      task: `Define the first bounded trusted outsider ingress boundary for Agent Assistant.

Agent Assistant context:
{{steps.read-agent-assistant-ingress-context.output}}

Cloud proving context:
{{steps.read-cloud-nango-proving-context.output}}

Write:
- docs/architecture/v1-trusted-outsider-ingress-boundary.md
- docs/architecture/v1-trusted-outsider-ingress-extraction-map.md
- docs/architecture/v1-trusted-outsider-ingress-proof-plan.md

Requirements:
1. Frame this as trusted outsider ingress, Inbox-adjacent, and explicitly separate from Relay-native communication.
2. Use Cloud Nango webhook handling as the proving case, not as the final productized shape.
3. Define the normalized ingress envelope, verifier contract, resolver contract, router/handler contract, and outcome/result semantics.
4. Identify exactly what remains Cloud-only: HTTP route transport, env/secret lookup, DB-backed workspace integration persistence, hosted forwarding, provider rollout glue, and deployment/runtime workarounds.
5. Identify exactly what is SDK-worthy now versus maybe-later.
6. Recommend package landing: extend Inbox first unless there is a hard reason to create a new package.
7. Keep the slice bounded. Do not propose moving the whole Nango router into the SDK.

End docs/architecture/v1-trusted-outsider-ingress-boundary.md with V1_TRUSTED_OUTSIDER_INGRESS_BOUNDARY_READY.
End docs/architecture/v1-trusted-outsider-ingress-extraction-map.md with V1_TRUSTED_OUTSIDER_INGRESS_EXTRACTION_MAP_READY.
End docs/architecture/v1-trusted-outsider-ingress-proof-plan.md with V1_TRUSTED_OUTSIDER_INGRESS_PROOF_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-boundary.md' },
    })

    .step('author-workflow-ready-ingress-plan', {
      agent: 'author-codex',
      dependsOn: ['define-trusted-outsider-ingress-boundary'],
      task: `Turn the trusted outsider ingress boundary into a workflow-ready plan.

Read and follow:
- docs/architecture/v1-trusted-outsider-ingress-boundary.md
- docs/architecture/v1-trusted-outsider-ingress-extraction-map.md
- docs/architecture/v1-trusted-outsider-ingress-proof-plan.md

Write:
- docs/architecture/v1-trusted-outsider-ingress-implementation-sequence.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-plan.md
- docs/architecture/v1-trusted-outsider-ingress-no-shortcuts-checklist.md

Requirements:
1. Provide a concrete sequence for:
   - docs-first specification
   - minimal SDK primitive implementation
   - Cloud proving-case adoption
   - review/remediation
2. Define exact validation gates for each phase.
3. Keep the first implementation slice bounded to reusable ingress substrate only.
4. Explicitly state what not to do in v1.
5. Make the sequence concrete enough to become immediate follow-up workflows.

End docs/architecture/v1-trusted-outsider-ingress-implementation-sequence.md with V1_TRUSTED_OUTSIDER_INGRESS_IMPLEMENTATION_SEQUENCE_READY.
End docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-plan.md with V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_READY.
End docs/architecture/v1-trusted-outsider-ingress-no-shortcuts-checklist.md with V1_TRUSTED_OUTSIDER_INGRESS_NO_SHORTCUTS_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-implementation-sequence.md' },
    })

    .step('review-trusted-outsider-ingress-plan', {
      agent: 'review-codex',
      dependsOn: ['author-workflow-ready-ingress-plan'],
      task: `Review the trusted outsider ingress boundary and workflow-ready plan.

Read:
- docs/architecture/v1-trusted-outsider-ingress-boundary.md
- docs/architecture/v1-trusted-outsider-ingress-extraction-map.md
- docs/architecture/v1-trusted-outsider-ingress-proof-plan.md
- docs/architecture/v1-trusted-outsider-ingress-implementation-sequence.md
- docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-plan.md
- docs/architecture/v1-trusted-outsider-ingress-no-shortcuts-checklist.md

Assess:
1. Is the reusable substrate clearly separated from Cloud-only hosted glue?
2. Is Inbox-adjacent placement justified?
3. Is the first slice tight enough to implement without architectural sprawl?
4. Does the plan avoid expedient shortcuts like moving provider/env/DB glue into the SDK?
5. Is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/v1-trusted-outsider-ingress-review-verdict.md.
End with V1_TRUSTED_OUTSIDER_INGRESS_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/v1-trusted-outsider-ingress-review-verdict.md' },
    })

    .step('verify-trusted-outsider-ingress-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-trusted-outsider-ingress-plan'],
      command: [
        'test -f docs/architecture/v1-trusted-outsider-ingress-boundary.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-extraction-map.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-proof-plan.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-implementation-sequence.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-plan.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-no-shortcuts-checklist.md',
        'test -f docs/architecture/v1-trusted-outsider-ingress-review-verdict.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_BOUNDARY_READY" docs/architecture/v1-trusted-outsider-ingress-boundary.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_EXTRACTION_MAP_READY" docs/architecture/v1-trusted-outsider-ingress-extraction-map.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_PROOF_PLAN_READY" docs/architecture/v1-trusted-outsider-ingress-proof-plan.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_IMPLEMENTATION_SEQUENCE_READY" docs/architecture/v1-trusted-outsider-ingress-implementation-sequence.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_CLOUD_ADOPTION_READY" docs/architecture/v1-trusted-outsider-ingress-cloud-adoption-plan.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_NO_SHORTCUTS_READY" docs/architecture/v1-trusted-outsider-ingress-no-shortcuts-checklist.md',
        'grep -q "V1_TRUSTED_OUTSIDER_INGRESS_REVIEW_COMPLETE" docs/architecture/v1-trusted-outsider-ingress-review-verdict.md',
        'echo "V1_TRUSTED_OUTSIDER_INGRESS_ARTIFACTS_VERIFIED"',
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
