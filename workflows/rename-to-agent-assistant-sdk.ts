import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('rename-to-agent-assistant-sdk')
    .description('Rename Agent Assistant SDK to Agent Assistant SDK across the repo, package metadata, docs, publish infrastructure, and consumer materials, while also tightening the README and landing docs for open-source/public consumption.')
    .pattern('supervisor')
    .channel('wf-agent-assistant-rename')
    .maxConcurrency(4)
    .timeout(5_400_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead rename architect responsible for defining the exact rename boundary, naming decisions, and open-source positioning constraints before edits are made.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Applies the full rename, updates package metadata/docs/workflows, and rewrites the README for public/open-source readiness.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the rename and README/public-positioning cleanup for consistency, residual stale names, and open-source readiness.',
      retries: 1,
    })

    .step('read-rename-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,320p" README.md',
        'echo "" && echo "---CURRENT STATE---"',
        'sed -n "1,260p" docs/current-state.md',
        'echo "" && echo "---DOCS INDEX---"',
        'sed -n "1,260p" docs/index.md',
        'echo "" && echo "---PACKAGE MANIFESTS---"',
        'find packages -maxdepth 2 -name package.json -type f | sort | xargs -I{} sh -c "echo --- {}; sed -n \"1,220p\" {}"',
        'echo "" && echo "---PUBLISH WORKFLOW---"',
        'sed -n "1,320p" .github/workflows/publish.yml 2>/dev/null || true',
        'echo "" && echo "---NAME REFERENCES---"',
        'rg -n "Agent Assistant SDK|relay-assistant" README.md docs packages .github workflows || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('define-rename-boundary', {
      agent: 'lead-claude',
      dependsOn: ['read-rename-context'],
      task: `Using the current repo/docs/package state below, define the exact rename boundary and public-facing positioning for renaming Agent Assistant SDK to Agent Assistant SDK.

{{steps.read-rename-context.output}}

Write docs/architecture/agent-assistant-sdk-rename-boundary.md.

The boundary doc must define:
1. the exact public product name and repo/package naming decisions
2. whether package scope changes to @agent-assistant/* (and treat that as the intended target unless clearly impossible)
3. which existing Relay-family references remain intentionally historical vs must be renamed
4. the README/public landing-page requirements for open-source readiness
5. what manual/external follow-up remains (e.g. GitHub repo rename)

Hard constraints:
- this is a full rename, not a partial branding pass
- optimize for a public/open-source audience unfamiliar with the Relay ecosystem
- avoid leaving stale names unless intentionally documented as historical references

End with AGENT_ASSISTANT_RENAME_BOUNDARY_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/agent-assistant-sdk-rename-boundary.md' },
    })

    .step('apply-rename-and-public-readme-pass', {
      agent: 'author-claude',
      dependsOn: ['define-rename-boundary'],
      task: `Apply the full rename and README/public-doc cleanup using docs/architecture/agent-assistant-sdk-rename-boundary.md.

Required outcomes:
- rename repo-facing/docs-facing/package-facing references from Agent Assistant SDK to Agent Assistant SDK / agent-assistant as defined in the boundary
- update package metadata, docs, workflows, and publish infrastructure consistently
- update README so it reads as a strong public/open-source landing page
- update consumer/adoption docs as needed
- identify any residual manual rename work in docs rather than silently leaving it ambiguous

Requirements:
- this is a full rename pass, not a shallow string replacement
- README should be understandable to someone outside the Relay ecosystem
- package naming/scope should match the chosen public framing
- do not print full docs to stdout

IMPORTANT:
- write files to disk
- end the updated README with no special marker, but ensure it is open-source ready
- end docs/architecture/agent-assistant-sdk-rename-report.md with AGENT_ASSISTANT_RENAME_REPORT_READY`,
      verification: { type: 'file_exists', value: 'docs/architecture/agent-assistant-sdk-rename-report.md' },
    })

    .step('review-rename-and-public-positioning', {
      agent: 'review-codex',
      dependsOn: ['apply-rename-and-public-readme-pass'],
      task: `Review the Agent Assistant SDK rename and public README/docs pass.

Read:
- docs/architecture/agent-assistant-sdk-rename-boundary.md
- docs/architecture/agent-assistant-sdk-rename-report.md
- README.md
- docs/index.md
- changed package manifests
- changed workflow files

Assess:
1. is the rename consistent and complete enough?
2. are stale Agent Assistant SDK references removed except where intentionally historical?
3. is the README/public positioning actually ready for open-source readers?
4. is this strong enough to proceed with repo/package/public rename follow-through?

Write docs/architecture/agent-assistant-sdk-rename-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with AGENT_ASSISTANT_RENAME_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/agent-assistant-sdk-rename-review-verdict.md' },
    })

    .step('verify-rename-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-rename-and-public-positioning'],
      command: [
        'test -f docs/architecture/agent-assistant-sdk-rename-boundary.md',
        'test -f docs/architecture/agent-assistant-sdk-rename-report.md',
        'test -f docs/architecture/agent-assistant-sdk-rename-review-verdict.md',
        'grep -q "AGENT_ASSISTANT_RENAME_BOUNDARY_READY" docs/architecture/agent-assistant-sdk-rename-boundary.md',
        'grep -q "AGENT_ASSISTANT_RENAME_REPORT_READY" docs/architecture/agent-assistant-sdk-rename-report.md',
        'grep -q "AGENT_ASSISTANT_RENAME_REVIEW_COMPLETE" docs/architecture/agent-assistant-sdk-rename-review-verdict.md',
        'echo "AGENT_ASSISTANT_RENAME_VERIFIED"',
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
