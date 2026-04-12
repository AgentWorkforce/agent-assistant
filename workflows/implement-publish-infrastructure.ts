import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('agent-assistant-implement-publish-infrastructure')
    .description('Implement Agent Assistant SDK publish infrastructure modeled after relayfile/relayauth, using the Workforce npm-provenance-publisher package/profile path directly where applicable and only publishing packages that are actually ready.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-implement-publish-infra')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead release engineer defining the exact implementation boundary and canonical Workforce profile/harness consumption path for Agent Assistant SDK publish infrastructure.',
      retries: 1,
    })
    .agent('implementer-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the Agent Assistant SDK publish workflow, required package metadata updates, and supporting release docs without publishing unready packages.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the publish infrastructure implementation for release discipline, canonical reuse, and readiness.',
      retries: 1,
    })

    .step('read-publish-implementation-context', {
      type: 'deterministic',
      command: [
        'echo "---PUBLISH CONTRACT---"',
        'sed -n "1,260p" docs/architecture/publish-infrastructure-contract.md',
        'echo "" && echo "---PUBLISH READINESS MATRIX---"',
        'sed -n "1,260p" docs/architecture/publish-package-readiness-matrix.md',
        'echo "" && echo "---PUBLISH IMPLEMENTATION PLAN---"',
        'sed -n "1,320p" docs/architecture/publish-infrastructure-implementation-plan.md',
        'echo "" && echo "---WORKFORCE PROFILE CONSUMPTION PLAN---"',
        'sed -n "1,260p" docs/architecture/workforce-profile-consumption-plan.md',
        'echo "" && echo "---PUBLISH REVIEW VERDICT---"',
        'sed -n "1,240p" docs/architecture/publish-infrastructure-review-verdict.md',
        'echo "" && echo "---RELAYFILE PUBLISH---"',
        'sed -n "1,320p" ../relayfile/.github/workflows/publish.yml',
        'echo "" && echo "---RELAYAUTH PUBLISH---"',
        'sed -n "1,320p" ../relayauth/.github/workflows/publish.yml',
        'echo "" && echo "---WORKFORCE PROFILE FILE---"',
        'sed -n "1,240p" ../workforce/personas/npm-provenance-publisher.json',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-publish-implementation-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-publish-implementation-context'],
      task: `Using the publish planning docs and reference workflows below, define the exact implementation boundary for Agent Assistant SDK publish infrastructure.

{{steps.read-publish-implementation-context.output}}

Write docs/architecture/publish-infrastructure-implementation-boundary.md.

The boundary must define:
1. which packages will be publishable in the first workflow version
2. what package.json metadata must be updated
3. what GitHub Actions files/scripts/docs will be added or modified
4. the exact direct Workforce profile/package usage path and harness implication
5. what is intentionally deferred

Hard constraints:
- no copied local persona fallback
- no publishing private/test/example-only packages
- no pretend publish support for packages that are not actually ready

End with PUBLISH_INFRA_IMPLEMENTATION_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/publish-infrastructure-implementation-boundary.md' },
    })

    .step('implement-publish-infrastructure', {
      agent: 'implementer-claude',
      dependsOn: ['define-publish-implementation-boundary'],
      task: `Implement the Agent Assistant SDK publish infrastructure.

Read and follow:
- docs/architecture/publish-infrastructure-implementation-boundary.md
- docs/architecture/publish-package-readiness-matrix.md
- docs/architecture/workforce-profile-consumption-plan.md
- relayfile/relayauth publish workflows
- Workforce npm-provenance-publisher profile

Required outcomes:
- add the publish workflow YAML under .github/workflows/
- update package metadata for packages that are actually publishable now
- add any small supporting release docs/scripts needed
- ensure the publish setup directly reflects the Workforce profile/harness direction rather than local imitation

Implementation constraints:
- do not publish private/example/integration-test packages
- do not invent a local cloned profile file
- keep the workflow selective and safe
- do not actually publish packages in this workflow; only implement the infrastructure

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- end your final summary with PUBLISH_INFRASTRUCTURE_IMPLEMENTED`,
      verification: { type: 'file_exists', value: '.github/workflows/publish.yml' },
    })

    .step('review-publish-implementation', {
      agent: 'review-codex',
      dependsOn: ['implement-publish-infrastructure'],
      task: `Review the Agent Assistant SDK publish infrastructure implementation.

Read:
- docs/architecture/publish-infrastructure-implementation-boundary.md
- .github/workflows/publish.yml
- changed package.json files
- any new release docs/scripts

Assess:
1. is the workflow robust and safe?
2. does it avoid publishing unready packages?
3. does it use the Workforce profile/package direction correctly rather than copying it locally?
4. is this ready for manual publish testing next?

Write docs/architecture/publish-infrastructure-implementation-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with PUBLISH_INFRASTRUCTURE_IMPLEMENTATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/publish-infrastructure-implementation-review-verdict.md' },
    })

    .step('verify-publish-implementation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-publish-implementation'],
      command: [
        'test -f docs/architecture/publish-infrastructure-implementation-boundary.md',
        'test -f .github/workflows/publish.yml',
        'test -f docs/architecture/publish-infrastructure-implementation-review-verdict.md',
        'grep -q "PUBLISH_INFRA_IMPLEMENTATION_BOUNDARY_READY" docs/architecture/publish-infrastructure-implementation-boundary.md',
        'grep -q "PUBLISH_INFRASTRUCTURE_IMPLEMENTATION_REVIEW_COMPLETE" docs/architecture/publish-infrastructure-implementation-review-verdict.md',
        'echo "PUBLISH_INFRASTRUCTURE_IMPLEMENTATION_VERIFIED"',
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
