import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('apply-agent-assistant-sdk-rename')
    .description('Apply the Agent Assistant SDK rename using the already-approved rename boundary document. This workflow performs the actual rename and public README cleanup without redoing the boundary-definition phase.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-apply-rename')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead rename implementation architect responsible for translating the approved rename boundary into a clean, consistent repo-wide rename and public README pass.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Applies the rename, updates package scopes/docs/workflows, and rewrites the README for public/open-source readiness.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the rename application for consistency, stale-name removal, and public/open-source quality.',
      retries: 1,
    })

    .step('read-rename-application-context', {
      type: 'deterministic',
      command: [
        'echo "---RENAME BOUNDARY---"',
        'sed -n "1,320p" docs/architecture/agent-assistant-sdk-rename-boundary.md',
        'echo "" && echo "---README---"',
        'sed -n "1,320p" README.md',
        'echo "" && echo "---DOCS INDEX---"',
        'sed -n "1,260p" docs/index.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---NAME REFERENCES---"',
        'rg -n "RelayAssistant|relay-assistant|@relay-assistant|relay-agent-assistant" README.md docs packages .github workflows || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-application-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-rename-application-context'],
      task: `Using the approved rename boundary and current repo state below, define the exact application boundary for the rename pass.

{{steps.read-rename-application-context.output}}

Write docs/architecture/agent-assistant-sdk-rename-application-boundary.md.

The application boundary must define:
1. which files/categories will be changed now
2. which historical docs will get header notes instead of full rewrites
3. the README/public-doc expectations for this pass
4. what manual/external follow-up remains after this pass

Hard constraints:
- do not re-litigate the name decision
- use the existing boundary as authoritative
- optimize for a complete and consistent rename pass

End with AGENT_ASSISTANT_RENAME_APPLICATION_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/agent-assistant-sdk-rename-application-boundary.md' },
    })

    .step('apply-rename', {
      agent: 'author-claude',
      dependsOn: ['define-application-boundary'],
      task: `Apply the Agent Assistant SDK rename pass.

Read and follow:
- docs/architecture/agent-assistant-sdk-rename-boundary.md
- docs/architecture/agent-assistant-sdk-rename-application-boundary.md

Requirements:
- update package scopes/names/docs/workflows consistently
- rewrite README for open-source/public readiness
- preserve intentional historical references via header notes where required
- update docs/index/current-state/consumer docs/package READMEs/publish workflow as required
- do not print large file contents to stdout

IMPORTANT:
- write files to disk
- end docs/architecture/agent-assistant-sdk-rename-application-report.md with AGENT_ASSISTANT_RENAME_APPLICATION_REPORT_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/agent-assistant-sdk-rename-application-report.md' },
    })

    .step('review-rename-application', {
      agent: 'review-codex',
      dependsOn: ['apply-rename'],
      task: `Review the Agent Assistant SDK rename application.

Read:
- docs/architecture/agent-assistant-sdk-rename-boundary.md
- docs/architecture/agent-assistant-sdk-rename-application-boundary.md
- docs/architecture/agent-assistant-sdk-rename-application-report.md
- README.md
- changed package manifests
- changed workflow files

Assess:
1. is the rename application consistent?
2. are stale old-name references removed except where intentionally historical?
3. is the public README now understandable to open-source readers?
4. is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

Write docs/architecture/agent-assistant-sdk-rename-application-review-verdict.md.
End with AGENT_ASSISTANT_RENAME_APPLICATION_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/agent-assistant-sdk-rename-application-review-verdict.md' },
    })

    .step('verify-rename-application-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-rename-application'],
      command: [
        'test -f docs/architecture/agent-assistant-sdk-rename-application-boundary.md',
        'test -f docs/architecture/agent-assistant-sdk-rename-application-report.md',
        'test -f docs/architecture/agent-assistant-sdk-rename-application-review-verdict.md',
        'grep -q "AGENT_ASSISTANT_RENAME_APPLICATION_BOUNDARY_READY" docs/architecture/agent-assistant-sdk-rename-application-boundary.md',
        'grep -q "AGENT_ASSISTANT_RENAME_APPLICATION_REPORT_READY" docs/architecture/agent-assistant-sdk-rename-application-report.md',
        'grep -q "AGENT_ASSISTANT_RENAME_APPLICATION_REVIEW_COMPLETE" docs/architecture/agent-assistant-sdk-rename-application-review-verdict.md',
        'echo "AGENT_ASSISTANT_RENAME_APPLICATION_VERIFIED"',
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
