const { workflow } = require('@agent-relay/sdk/workflows');
const { ClaudeModels, CodexModels } = require('@agent-relay/config');

async function main() {
  const result = await workflow('relay-assistant-tighten-repo-organization')
    .description('Perform a repeatable repo-tightening pass for RelayAssistant: improve workflow discoverability, source-of-truth clarity, current-state reporting, and small naming/organization inconsistencies.')
    .pattern('supervisor')
    .channel('wf-relay-assistant-tighten-repo')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Lead repo organizer who turns the current repository state into a repeatable tightening pass with explicit documentation outputs and minimal churn.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Applies the repo-organization updates, writes navigation/current-state/source-of-truth docs, and improves workflow discoverability.',
      retries: 1,
    })
    .agent('review-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Reviews the repo-tightening pass for practical usefulness, repeatability, and alignment with the current implemented state.',
      retries: 1,
    })

    .step('read-repo-organization-context', {
      type: 'deterministic',
      command: [
        'echo "---README---"',
        'sed -n "1,320p" README.md',
        'echo "" && echo "---DOCS INDEX---"',
        'sed -n "1,320p" docs/index.md',
        'echo "" && echo "---PACKAGE BOUNDARY MAP---"',
        'sed -n "1,360p" docs/architecture/package-boundary-map.md',
        'echo "" && echo "---WORKFLOW BACKLOG---"',
        'sed -n "1,360p" docs/workflows/v1-workflow-backlog.md',
        'echo "" && echo "---WORKFLOWS---"',
        'find workflows -maxdepth 1 -type f | sort',
        'echo "" && echo "---PACKAGE TREE---"',
        'find packages -maxdepth 2 -type f | sort | sed -n "1,240p"',
        'echo "" && echo "---ARCHITECTURE DOCS---"',
        'find docs/architecture -maxdepth 1 -type f | sort',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-tightening-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-repo-organization-context'],
      task: `Using the current repo state below, write a repeatable repo-tightening plan.

{{steps.read-repo-organization-context.output}}

Write docs/architecture/repo-tightening-plan.md.

The plan must:
1. define the minimal repeatable cleanup/organization outcomes
2. define what navigation docs should exist
3. define how source-of-truth hierarchy should be expressed
4. define how current implemented vs specified state should be summarized
5. identify any small naming/wording consistency fixes worth making now
6. keep the pass lightweight and repeatable for future reruns

End the document with REPO_TIGHTENING_PLAN_READY.`,
      verification: { type: 'file_exists', value: 'docs/architecture/repo-tightening-plan.md' },
    })

    .step('apply-repo-tightening', {
      agent: 'author-claude',
      dependsOn: ['lead-tightening-plan'],
      task: `Apply the repo-tightening pass using docs/architecture/repo-tightening-plan.md.

Required outputs/updates:
- docs/current-state.md
- docs/workflows/README.md
- docs/architecture/source-of-truth.md
- docs/index.md
- README.md

Optional updates if clearly helpful:
- small naming consistency fixes in existing docs
- small wording fixes around implemented/spec'd/deferred state
- lightweight doc index improvements in architecture/workflow sections

Requirements:
- keep the pass lightweight and repeatable
- do not refactor the whole repo
- make it easier for future humans or workflows to know where to look first
- make source-of-truth hierarchy explicit
- clearly summarize implemented vs specified vs deferred state

IMPORTANT:
- write files to disk
- do not print full docs to stdout
- end docs/current-state.md with CURRENT_STATE_READY
- end docs/workflows/README.md with WORKFLOW_INDEX_READY
- end docs/architecture/source-of-truth.md with SOURCE_OF_TRUTH_READY`,
      verification: { type: 'file_exists', value: 'docs/current-state.md' },
    })

    .step('review-repo-tightening', {
      agent: 'review-codex',
      dependsOn: ['apply-repo-tightening'],
      task: `Review the repo-tightening pass.

Read:
- docs/architecture/repo-tightening-plan.md
- docs/current-state.md
- docs/workflows/README.md
- docs/architecture/source-of-truth.md
- docs/index.md
- README.md

Assess:
1. Is the repo easier to navigate now?
2. Is source-of-truth hierarchy explicit enough?
3. Does current-state reporting match the implemented/spec'd/deferred reality well enough?
4. Is the pass lightweight and repeatable rather than over-engineered?
5. What small follow-ups remain, if any?

Write docs/architecture/repo-tightening-review-verdict.md.
Use PASS, PASS_WITH_FOLLOWUPS, or FAIL.
End with REPO_TIGHTENING_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: 'docs/architecture/repo-tightening-review-verdict.md' },
    })

    .step('verify-repo-tightening-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-repo-tightening'],
      command: [
        'test -f docs/architecture/repo-tightening-plan.md',
        'test -f docs/current-state.md',
        'test -f docs/workflows/README.md',
        'test -f docs/architecture/source-of-truth.md',
        'test -f docs/architecture/repo-tightening-review-verdict.md',
        'grep -q "REPO_TIGHTENING_PLAN_READY" docs/architecture/repo-tightening-plan.md',
        'grep -q "CURRENT_STATE_READY" docs/current-state.md',
        'grep -q "WORKFLOW_INDEX_READY" docs/workflows/README.md',
        'grep -q "SOURCE_OF_TRUTH_READY" docs/architecture/source-of-truth.md',
        'grep -q "REPO_TIGHTENING_REVIEW_COMPLETE" docs/architecture/repo-tightening-review-verdict.md',
        'echo "REPO_TIGHTENING_VERIFIED"',
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
