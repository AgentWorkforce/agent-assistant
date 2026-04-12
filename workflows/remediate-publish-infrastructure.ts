import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('relay-assistant-remediate-publish-infrastructure')
    .description('Fix the blocking findings from the RelayAssistant publish infrastructure review so the publish path is actually safe, canonical, and ready for manual publish testing.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-remediate-publish-infra')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead release-remediation architect responsible for resolving the review blockers without widening the publish scope or weakening release discipline.',
      retries: 1,
    })
    .agent('implementer-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the targeted fixes needed to make the RelayAssistant publish infrastructure safe and canonical.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews whether the publish infrastructure remediation actually resolves the blocking findings and is ready for manual publish testing.',
      retries: 1,
    })

    .step('read-remediation-context', {
      type: 'deterministic',
      command: [
        'echo "---IMPLEMENTATION BOUNDARY---"',
        'sed -n "1,260p" docs/architecture/publish-infrastructure-implementation-boundary.md',
        'echo "" && echo "---IMPLEMENTATION REVIEW VERDICT---"',
        'sed -n "1,320p" docs/architecture/publish-infrastructure-implementation-review-verdict.md',
        'echo "" && echo "---PUBLISH WORKFLOW---"',
        'sed -n "1,320p" .github/workflows/publish.yml',
        'echo "" && echo "---CI WORKFLOW---"',
        'sed -n "1,320p" .github/workflows/ci.yml',
        'echo "" && echo "---ROOT PACKAGE JSON---"',
        'sed -n "1,260p" package.json',
        'echo "" && echo "---WORKFORCE PROFILE FILE---"',
        'sed -n "1,240p" ../workforce/personas/npm-provenance-publisher.json',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-remediation-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-remediation-context'],
      task: `Using the publish infrastructure implementation and review findings below, define the exact remediation boundary.

{{steps.read-remediation-context.output}}

Write docs/architecture/publish-infrastructure-remediation-boundary.md.

The remediation boundary must resolve:
1. the single-package publish/release path problem
2. the incorrect Workforce direct-consumption implementation
3. package tarball/test-artifact leakage
4. artifact/release path complexity that makes publish unsafe

Hard constraints:
- direct Workforce package/profile consumption remains required
- no copied persona fallback
- keep the first publish scope narrow and safe

End with PUBLISH_INFRA_REMEDIATION_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/publish-infrastructure-remediation-boundary.md' },
    })

    .step('implement-remediation', {
      agent: 'implementer-claude',
      dependsOn: ['define-remediation-boundary'],
      task: `Implement the publish infrastructure remediation.

Read and follow:
- docs/architecture/publish-infrastructure-remediation-boundary.md
- docs/architecture/publish-infrastructure-implementation-review-verdict.md
- .github/workflows/publish.yml
- .github/workflows/ci.yml
- package manifests for publishable packages
- Workforce profile source

Requirements:
- fix the publish workflow and CI workflow safely
- resolve the Workforce direct-consumption issue correctly
- prevent test artifacts from leaking into published tarballs
- keep the publishable package scope honest and narrow
- do not actually publish packages

IMPORTANT:
- write files to disk
- do not print large file contents to stdout
- end your final summary with PUBLISH_INFRA_REMEDIATION_READY`,
      verification: { type: 'file_exists', value: '.github/workflows/publish.yml' },
    })

    .step('run-remediation-checks', {
      type: 'deterministic',
      dependsOn: ['implement-remediation'],
      command: [
        'npm ci 2>&1',
        'npm run test --workspace=packages/traits 2>&1',
        'npm run test --workspace=packages/core 2>&1',
        'npm run test --workspace=packages/sessions 2>&1',
        'npm run test --workspace=packages/surfaces 2>&1',
        'npm pack --dry-run --workspace=packages/traits 2>&1',
        'npm pack --dry-run --workspace=packages/core 2>&1',
        'npm pack --dry-run --workspace=packages/sessions 2>&1',
        'npm pack --dry-run --workspace=packages/surfaces 2>&1',
        'echo "PUBLISH_INFRA_REMEDIATION_CHECKS_GREEN"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-remediation', {
      agent: 'review-codex',
      dependsOn: ['run-remediation-checks'],
      task: `Review the publish infrastructure remediation.

Read:
- docs/architecture/publish-infrastructure-remediation-boundary.md
- docs/architecture/publish-infrastructure-implementation-review-verdict.md
- changed workflows/package files
- remediation check outputs

Assess:
1. were the original blocking findings actually resolved?
2. is direct Workforce package/profile consumption now handled correctly?
3. are the publish tarballs and workflow paths now safe enough for manual publish testing?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/publish-infrastructure-remediation-review-verdict.md.
End with PUBLISH_INFRA_REMEDIATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/publish-infrastructure-remediation-review-verdict.md' },
    })

    .step('verify-remediation-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-remediation'],
      command: [
        'test -f docs/architecture/publish-infrastructure-remediation-boundary.md',
        'test -f docs/architecture/publish-infrastructure-remediation-review-verdict.md',
        'grep -q "PUBLISH_INFRA_REMEDIATION_BOUNDARY_READY" docs/architecture/publish-infrastructure-remediation-boundary.md',
        'grep -q "PUBLISH_INFRA_REMEDIATION_REVIEW_COMPLETE" docs/architecture/publish-infrastructure-remediation-review-verdict.md',
        'echo "PUBLISH_INFRA_REMEDIATION_VERIFIED"',
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
