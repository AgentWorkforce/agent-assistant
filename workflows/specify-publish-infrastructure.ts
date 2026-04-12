import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('relay-assistant-specify-publish-infrastructure')
    .description('Define the RelayAssistant publish/release infrastructure using the established Relay-family publish patterns and requiring direct canonical consumption of the exported Workforce npm-provenance-publisher profile/package, not copied local persona data.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-publish-infra')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead release-architecture author defining the canonical publish infrastructure for RelayAssistant with robust versioning, provenance, and reusable persona/profile integration.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Authors the publish infrastructure contract, package readiness matrix, and implementation plan for RelayAssistant.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the publish infrastructure plan for realism, canonical reuse, and release discipline.',
      retries: 1,
    })

    .step('read-publish-context', {
      type: 'deterministic',
      command: [
        'echo "---RELAYFILE PUBLISH WORKFLOW---"',
        'sed -n "1,320p" ../relayfile/.github/workflows/publish.yml',
        'echo "" && echo "---RELAYAUTH PUBLISH WORKFLOW---"',
        'sed -n "1,320p" ../relayauth/.github/workflows/publish.yml',
        'echo "" && echo "---RELAYASSISTANT PACKAGE TREE---"',
        'find packages -maxdepth 2 -type f | sort | sed -n "1,320p"',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---WORKFORCE NPM PROVENANCE PUBLISHER PROFILE---"',
        'sed -n "1,240p" ../workforce/personas/npm-provenance-publisher.json',
        'echo "" && echo "---ROOT PACKAGE JSON---"',
        'sed -n "1,260p" package.json',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-publish-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-publish-context'],
      task: `Using the Relay-family publish workflows, RelayAssistant package state, and the Workforce npm provenance publisher profile below, define the canonical publish infrastructure contract.

{{steps.read-publish-context.output}}

Write docs/architecture/publish-infrastructure-contract.md.

The contract must define:
1. which RelayAssistant packages are publishable now vs not yet
2. how the publish workflow should mirror relayfile/relayauth patterns
3. the exact direct canonical consumption path for the Workforce npm-provenance-publisher profile/package
4. versioning, tagging, and provenance expectations
5. minimum CI/build/test gates before publish
6. what implementation work is required next

Hard constraints:
- direct Workforce package/profile consumption is required, not optional
- no local copy-paste persona shortcuts
- if direct consumption is impossible today, identify the exact missing Workforce export surface as a blocker
- no publishing placeholder/spec-only packages as if they are ready
- optimize for robust release discipline, not speed

End with PUBLISH_INFRASTRUCTURE_CONTRACT_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/publish-infrastructure-contract.md' },
    })

    .step('author-publish-plan', {
      agent: 'author-claude',
      dependsOn: ['define-publish-contract'],
      task: `Author the concrete RelayAssistant publish infrastructure plan.

Read and follow:
- docs/architecture/publish-infrastructure-contract.md
- relayfile/relayauth publish workflow patterns
- the Workforce npm provenance publisher profile

Required outputs:
- docs/architecture/publish-package-readiness-matrix.md
- docs/architecture/publish-infrastructure-implementation-plan.md
- docs/architecture/workforce-profile-consumption-plan.md

Requirements:
- package readiness matrix must identify publish-now vs defer
- implementation plan must be concrete enough to directly drive the next workflow
- profile consumption plan must specify the direct Workforce package/profile usage path; if it cannot, it must clearly identify the exact missing export and treat that as a blocker rather than recommending a local copy

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/architecture/publish-package-readiness-matrix.md with PUBLISH_PACKAGE_READINESS_MATRIX_READY
- end docs/architecture/publish-infrastructure-implementation-plan.md with PUBLISH_INFRA_IMPLEMENTATION_PLAN_READY
- end docs/architecture/workforce-profile-consumption-plan.md with WORKFORCE_PROFILE_CONSUMPTION_PLAN_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/publish-infrastructure-implementation-plan.md' },
    })

    .step('review-publish-plan', {
      agent: 'review-codex',
      dependsOn: ['author-publish-plan'],
      task: `Review the RelayAssistant publish infrastructure plan.

Read:
- docs/architecture/publish-infrastructure-contract.md
- docs/architecture/publish-package-readiness-matrix.md
- docs/architecture/publish-infrastructure-implementation-plan.md
- docs/architecture/workforce-profile-consumption-plan.md

Assess:
1. is the release plan robust and realistic?
2. does it avoid publishing unready packages?
3. does it require direct Workforce package/profile consumption rather than a copied local fallback?
4. if direct consumption is blocked, does it identify the blocker explicitly and correctly?
5. is this strong enough to drive implementation next?

Write docs/architecture/publish-infrastructure-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with PUBLISH_INFRASTRUCTURE_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/publish-infrastructure-review-verdict.md' },
    })

    .step('verify-publish-plan-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-publish-plan'],
      command: [
        'test -f docs/architecture/publish-infrastructure-contract.md',
        'test -f docs/architecture/publish-package-readiness-matrix.md',
        'test -f docs/architecture/publish-infrastructure-implementation-plan.md',
        'test -f docs/architecture/workforce-profile-consumption-plan.md',
        'test -f docs/architecture/publish-infrastructure-review-verdict.md',
        'grep -q "PUBLISH_INFRASTRUCTURE_CONTRACT_READY" docs/architecture/publish-infrastructure-contract.md',
        'grep -q "PUBLISH_PACKAGE_READINESS_MATRIX_READY" docs/architecture/publish-package-readiness-matrix.md',
        'grep -q "PUBLISH_INFRA_IMPLEMENTATION_PLAN_READY" docs/architecture/publish-infrastructure-implementation-plan.md',
        'grep -q "WORKFORCE_PROFILE_CONSUMPTION_PLAN_READY" docs/architecture/workforce-profile-consumption-plan.md',
        'grep -q "PUBLISH_INFRASTRUCTURE_REVIEW_COMPLETE" docs/architecture/publish-infrastructure-review-verdict.md',
        'echo "PUBLISH_INFRASTRUCTURE_PLAN_VERIFIED"',
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
