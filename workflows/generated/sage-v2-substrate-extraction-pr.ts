import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';
import { applyAgentAssistantRepoSetup } from '../lib/agent-assistant-repo-setup.ts';

const WORKFLOW_NAME = 'sage-v2-nested-subagent-runner-pr';
const WORKFLOW_CHANNEL = 'wf-sage-v2-nested-subagent-runner';
const IMPLEMENTATION_BRANCH = 'codex/sage-v2-nested-subagent-runner';

const GATE_DIR = 'tmp/sage-v2-nested-runner-workflow';
const CONTEXT_FILE = `${GATE_DIR}/source-context.md`;
const VALIDATION_LOG = `${GATE_DIR}/validation.log`;
const PR_BODY_FILE = `${GATE_DIR}/pr-body.md`;

const PLAN_DOC = 'docs/architecture/sage-v2-nested-subagent-runner-plan.md';
const LEAD_REFLECTION = 'docs/architecture/sage-v2-nested-subagent-runner-lead-reflection.md';
const EXECUTOR_REFLECTION = 'docs/architecture/sage-v2-nested-subagent-runner-executor-reflection.md';
const FRESH_REVIEW = 'docs/architecture/sage-v2-nested-subagent-runner-fresh-eyes-review.md';
const FRESH_REFLECTION = 'docs/architecture/sage-v2-nested-subagent-runner-fresh-eyes-reflection.md';
const CLAUDE_REVIEW = 'docs/architecture/sage-v2-nested-subagent-runner-claude-peer-review.md';
const CLAUDE_REFLECTION = 'docs/architecture/sage-v2-nested-subagent-runner-claude-reflection.md';
const VALIDATION_REPORT = 'docs/architecture/sage-v2-nested-subagent-runner-80-to-100-validation.md';
const VALIDATION_REFLECTION = 'docs/architecture/sage-v2-nested-subagent-runner-validation-reflection.md';

async function runWorkflow() {
  const baseWf = workflow(WORKFLOW_NAME)
    .description(
      'First Sage v2 substrate PR only: add the reusable nested subagent runner helper in @agent-assistant/harness with targeted tests, review, validation, commit, push, and PR.',
    )
    .pattern('dag')
    .channel(WORKFLOW_CHANNEL)
    .maxConcurrency(2)
    .timeout(5_400_000)

    .step('runtime-launch', {
      type: 'deterministic',
      command: 'echo SAGE_V2_NESTED_RUNNER_RUNTIME_READY',
      captureOutput: true,
      failOnError: true,
    })

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'lead',
      role: 'Lead architect for the first Sage v2 substrate slice. Keeps scope to nested subagent runner only.',
      retries: 1,
      timeoutMs: 900_000,
    })
    .agent('executor-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implements only the @agent-assistant/harness nested subagent runner slice and its focused tests.',
      retries: 2,
      timeoutMs: 1_200_000,
    })
    .agent('fresh-eyes-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Fresh-eyes reviewer for the nested runner diff only.',
      retries: 1,
      timeoutMs: 600_000,
    })
    .agent('peer-review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Claude peer reviewer for API shape, extraction boundary, and test adequacy.',
      retries: 1,
      timeoutMs: 600_000,
    })
    .agent('validation-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: '80-to-100 validator. Confirms deterministic evidence, scoped diff, and production readiness for this one slice.',
      retries: 1,
      timeoutMs: 600_000,
    });

  const wf = applyAgentAssistantRepoSetup(baseWf, {
    branch: IMPLEMENTATION_BRANCH,
    committerName: 'Sage v2 Nested Runner Workflow',
    committerEmail: 'agent@agent-assistant.local',
    dependsOn: ['runtime-launch'],
  });

  const result = await wf
    .step('preflight-source-docs', {
      type: 'deterministic',
      dependsOn: ['install-deps'],
      command: [
        'set -e',
        'command -v rg >/dev/null',
        'command -v gh >/dev/null',
        'gh auth status >/dev/null',
        'test -f docs/architecture/sage-v2-substrate-extraction-map.md',
        'test -f ../sage/specs/sage-v2-agentic-orchestration.md',
        'test -f .agents/skills/writing-agent-relay-workflows/SKILL.md',
        'test -f .agents/skills/relay-80-100-workflow/SKILL.md',
        'test -f packages/harness/src/subagent-registry.ts',
        'test -f packages/harness/src/types.ts',
        `mkdir -p ${GATE_DIR}`,
        'echo SAGE_V2_NESTED_RUNNER_PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('collect-context', {
      type: 'deterministic',
      dependsOn: ['preflight-source-docs'],
      command: [
        'set -e',
        `: > ${CONTEXT_FILE}`,
        `printf '%s\n' '# Sage v2 nested subagent runner context' >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Extraction map' >> ${CONTEXT_FILE}`,
        `sed -n '1,150p' docs/architecture/sage-v2-substrate-extraction-map.md >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Orchestration spec task-tool target' >> ${CONTEXT_FILE}`,
        `sed -n '1,180p' ../sage/specs/sage-v2-agentic-orchestration.md >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Current harness subagent registry' >> ${CONTEXT_FILE}`,
        `sed -n '1,260p' packages/harness/src/subagent-registry.ts >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Harness types' >> ${CONTEXT_FILE}`,
        `sed -n '1,260p' packages/harness/src/types.ts >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Harness exports/package' >> ${CONTEXT_FILE}`,
        `sed -n '1,220p' packages/harness/src/index.ts >> ${CONTEXT_FILE}`,
        `sed -n '1,220p' packages/harness/package.json >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Workflow skills' >> ${CONTEXT_FILE}`,
        `sed -n '1,240p' .agents/skills/writing-agent-relay-workflows/SKILL.md >> ${CONTEXT_FILE}`,
        `sed -n '1,220p' .agents/skills/relay-80-100-workflow/SKILL.md >> ${CONTEXT_FILE}`,
        `test -s ${CONTEXT_FILE}`,
        'echo SAGE_V2_NESTED_RUNNER_CONTEXT_READY',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['collect-context'],
      task: `Write ${PLAN_DOC} from ${CONTEXT_FILE}.

This is PR 1 only: nested subagent runner helper in @agent-assistant/harness.

The plan must:
1. Define the smallest reusable API shape for a helper that supplies createSubagentToolRegistry's runSubagent implementation.
2. Keep Sage product prompts, roster definitions, Slack/Notion semantics, work-mode classifiers, runtime budget policy, telemetry vocabulary, evals, and insight contracts out of this PR.
3. Name exact files likely to change.
4. Require tests for success, unknown subagent, subagent failure, max-iteration failure, cancellation, and parallel task batches where the existing registry supports them.
5. Include Cloudflare Workers fetch compatibility guidance: no bare fetch storage.
6. Include the 80-to-100 validation gates for this single slice.

End with SAGE_V2_NESTED_RUNNER_PLAN_READY.`,
      verification: { type: 'file_exists', value: PLAN_DOC },
    })

    .step('verify-lead-plan', {
      type: 'deterministic',
      dependsOn: ['lead-plan'],
      command: [
        'set -e',
        `rg -q 'SAGE_V2_NESTED_RUNNER_PLAN_READY' ${PLAN_DOC}`,
        `rg -q 'nested subagent|Nested subagent|createNestedSubagentRunner' ${PLAN_DOC}`,
        `rg -q 'runtime budget policy|Runtime budget policy|Runtime budget' ${PLAN_DOC}`,
        `rg -q 'PR 2|deferred|out of scope|Out of scope|must NOT|MUST NOT' ${PLAN_DOC}`,
        `rg -q '80.*100' ${PLAN_DOC}`,
        'echo SAGE_V2_NESTED_RUNNER_PLAN_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-self-reflection', {
      agent: 'lead-claude',
      dependsOn: ['verify-lead-plan'],
      task: `Write ${LEAD_REFLECTION}.

Reflect on whether ${PLAN_DOC} is actually scoped to PR 1 only. Name any scope risks Codex must avoid.

End with LEAD_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: LEAD_REFLECTION },
    })

    .step('implement-nested-runner', {
      agent: 'executor-codex',
      dependsOn: ['lead-self-reflection'],
      task: `Implement only the nested subagent runner slice using ${PLAN_DOC}.

Allowed scope:
- packages/harness/src/nested-subagent-runner.ts
- packages/harness/src/nested-subagent-runner.test.ts
- packages/harness/src/subagent-registry.ts and existing subagent registry tests, only if needed for the helper contract
- packages/harness/src/index.ts, packages/harness/src/registries/index.ts, packages/harness/src/subpath-exports.test.ts, and packages/harness/package.json, only for exports/subpaths
- docs/architecture/sage-v2-nested-subagent-runner-*.md

Do not add runtime policy, telemetry, eval, insight, Slack, Notion, GitHub, Linear, or Sage-specific product behavior.
If unrelated changes exist in the worktree from previous runs, ignore them and do not edit or revert them.
Run the targeted nested-runner tests before exiting.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('verify-implementation-shape', {
      type: 'deterministic',
      dependsOn: ['implement-nested-runner'],
      command: [
        'set -e',
        'rg -q "createNestedSubagentRunner|NestedSubagentRunner|CreateNestedSubagentRunner" packages/harness/src',
        'test -f packages/harness/src/nested-subagent-runner.test.ts',
        'rg -q "unknown|failure|max|cancel|parallel|allowlist" packages/harness/src/nested-subagent-runner.test.ts',
        'if rg -n "SAGE_HARNESS_SUBAGENTS_ENABLED|slack-researcher|competitor-researcher|notion_create_page" packages/harness/src/nested-subagent-runner.ts packages/harness/src/subagent-registry.ts; then echo "Sage product semantics leaked"; exit 1; fi',
        'if rg -n "(fetchImpl\\s*=\\s*[^?;]*\\?\\?\\s*fetch\\b|=\\s*fetch\\s*;)" packages/harness/src/nested-subagent-runner.ts packages/harness/src/subagent-registry.ts; then echo "bare fetch storage found"; exit 1; fi',
        'echo SAGE_V2_NESTED_RUNNER_SHAPE_VERIFIED',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-targeted-tests-first-pass', {
      type: 'deterministic',
      dependsOn: ['verify-implementation-shape'],
      command: [
        'set +e',
        'npm test -w @agent-assistant/harness -- src/nested-subagent-runner.test.ts src/subagent-registry.test.ts src/subpath-exports.test.ts > /tmp/sage_v2_nested_targeted.log 2>&1',
        'TEST_EXIT=$?',
        'npm run build -w @agent-assistant/harness > /tmp/sage_v2_nested_build.log 2>&1',
        'BUILD_EXIT=$?',
        'echo "TEST_EXIT=$TEST_EXIT"',
        'echo "BUILD_EXIT=$BUILD_EXIT"',
        'echo "--- targeted tests tail ---"; tail -100 /tmp/sage_v2_nested_targeted.log || true',
        'echo "--- harness build tail ---"; tail -80 /tmp/sage_v2_nested_build.log || true',
        'exit 0',
      ].join('\n'),
      captureOutput: true,
      failOnError: false,
      timeoutMs: 600_000,
    })

    .step('fix-targeted-tests', {
      agent: 'executor-codex',
      dependsOn: ['run-targeted-tests-first-pass'],
      task: `Targeted test/build evidence:

{{steps.run-targeted-tests-first-pass.output}}

If TEST_EXIT=0 and BUILD_EXIT=0, do nothing.
Otherwise fix only the nested-runner slice. Re-run:
  npm test -w @agent-assistant/harness -- src/nested-subagent-runner.test.ts src/subagent-registry.test.ts src/subpath-exports.test.ts
  npm run build -w @agent-assistant/harness

Do not edit runtime policy, telemetry, eval, insight, or Sage product files.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('hard-targeted-validation', {
      type: 'deterministic',
      dependsOn: ['fix-targeted-tests'],
      command: [
        'set -e',
        `mkdir -p ${GATE_DIR}`,
        `: > ${VALIDATION_LOG}`,
        `npm test -w @agent-assistant/harness -- src/nested-subagent-runner.test.ts src/subagent-registry.test.ts src/subpath-exports.test.ts >> ${VALIDATION_LOG} 2>&1`,
        `npm run build -w @agent-assistant/harness >> ${VALIDATION_LOG} 2>&1`,
        `tail -120 ${VALIDATION_LOG}`,
        'echo SAGE_V2_NESTED_RUNNER_TARGETED_GREEN',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 600_000,
    })

    .step('executor-self-reflection', {
      agent: 'executor-codex',
      dependsOn: ['hard-targeted-validation'],
      task: `Write ${EXECUTOR_REFLECTION}.

Include:
- files changed for the nested-runner slice
- tests added/updated
- validation commands run
- how Sage product logic was kept out
- any residual risk

End with EXECUTOR_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: EXECUTOR_REFLECTION },
    })

    .step('fresh-eyes-review', {
      agent: 'fresh-eyes-codex',
      dependsOn: ['executor-self-reflection'],
      task: `Review only the nested-runner intended diff.

Use:
  git diff -- packages/harness/src/nested-subagent-runner.ts packages/harness/src/nested-subagent-runner.test.ts packages/harness/src/subagent-registry.ts packages/harness/src/subagent-registry.test.ts packages/harness/src/index.ts packages/harness/src/registries/index.ts packages/harness/src/subpath-exports.test.ts packages/harness/package.json docs/architecture/sage-v2-nested-subagent-runner-*.md

Look for bugs, missing edge tests, API breakage, product-boundary leaks, and scope creep. Make narrow fixes only if needed.
Write ${FRESH_REVIEW}. Use PASS, PASS_WITH_FOLLOWUPS, or FAIL. End with FRESH_EYES_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: FRESH_REVIEW },
    })

    .step('verify-fresh-eyes-review', {
      type: 'deterministic',
      dependsOn: ['fresh-eyes-review'],
      command: [
        'set -e',
        `rg -q 'FRESH_EYES_REVIEW_COMPLETE' ${FRESH_REVIEW}`,
        `! rg -q '^FAIL\\b' ${FRESH_REVIEW}`,
        'npm test -w @agent-assistant/harness -- src/nested-subagent-runner.test.ts src/subagent-registry.test.ts src/subpath-exports.test.ts 2>&1 | tail -100',
        'echo SAGE_V2_FRESH_EYES_VERIFIED',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 600_000,
    })

    .step('fresh-eyes-self-reflection', {
      agent: 'fresh-eyes-codex',
      dependsOn: ['verify-fresh-eyes-review'],
      task: `Write ${FRESH_REFLECTION}.

Reflect on what you checked, any fixes made, and why the verdict is justified for PR 1 only.

End with FRESH_EYES_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: FRESH_REFLECTION },
    })

    .step('claude-peer-review', {
      agent: 'peer-review-claude',
      dependsOn: ['fresh-eyes-self-reflection'],
      task: `Perform Claude peer review for this one nested-runner PR.

Read ${PLAN_DOC}, ${LEAD_REFLECTION}, ${EXECUTOR_REFLECTION}, ${FRESH_REVIEW}, and the nested-runner diff.
Review API minimality, extraction boundary, cancellation behavior, allowlist enforcement, tests, and public exports.
Make narrow fixes only if needed.
Write ${CLAUDE_REVIEW}. Use PASS, PASS_WITH_FOLLOWUPS, or FAIL. End with CLAUDE_PEER_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: CLAUDE_REVIEW },
    })

    .step('verify-claude-peer-review', {
      type: 'deterministic',
      dependsOn: ['claude-peer-review'],
      command: [
        'set -e',
        `rg -q 'CLAUDE_PEER_REVIEW_COMPLETE' ${CLAUDE_REVIEW}`,
        `! rg -q '^FAIL\\b' ${CLAUDE_REVIEW}`,
        'npm test -w @agent-assistant/harness -- src/nested-subagent-runner.test.ts src/subagent-registry.test.ts src/subpath-exports.test.ts 2>&1 | tail -100',
        'echo SAGE_V2_CLAUDE_REVIEW_VERIFIED',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 600_000,
    })

    .step('claude-peer-review-self-reflection', {
      agent: 'peer-review-claude',
      dependsOn: ['verify-claude-peer-review'],
      task: `Write ${CLAUDE_REFLECTION}.

Reflect on why the review verdict is valid beyond green tests, and list follow-up substrate slices that remain separate PRs.

End with CLAUDE_PEER_REVIEW_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: CLAUDE_REFLECTION },
    })

    .step('claude-80-to-100-validation', {
      agent: 'validation-claude',
      dependsOn: ['claude-peer-review-self-reflection'],
      task: `Apply the relay-80-100-workflow checklist to this nested-runner PR only.

Verify from evidence:
1. Tests exist and were run deterministically.
2. Test failures had a fix-rerun path.
3. Harness build passes.
4. Review gates completed.
5. Final commit will stage only nested-runner allowlist files.
6. Follow-up slices remain out of scope.

Write ${VALIDATION_REPORT}. Use PASS, PASS_WITH_FOLLOWUPS, or FAIL. End with CLAUDE_80_TO_100_VALIDATION_COMPLETE.`,
      verification: { type: 'file_exists', value: VALIDATION_REPORT },
    })

    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['claude-80-to-100-validation'],
      command: [
        'set -e',
        `rg -q 'CLAUDE_80_TO_100_VALIDATION_COMPLETE' ${VALIDATION_REPORT}`,
        `! rg -q '^FAIL\\b' ${VALIDATION_REPORT}`,
        `mkdir -p ${GATE_DIR}`,
        `: > ${VALIDATION_LOG}`,
        `npm test -w @agent-assistant/harness -- src/nested-subagent-runner.test.ts src/subagent-registry.test.ts src/subpath-exports.test.ts >> ${VALIDATION_LOG} 2>&1`,
        `npm run build -w @agent-assistant/harness >> ${VALIDATION_LOG} 2>&1`,
        'if rg -n "(fetchImpl\\s*=\\s*[^?;]*\\?\\?\\s*fetch\\b|=\\s*fetch\\s*;)" packages/harness/src/nested-subagent-runner.ts packages/harness/src/subagent-registry.ts; then echo "bare fetch storage found"; exit 1; fi',
        'if rg -n "SAGE_HARNESS_SUBAGENTS_ENABLED|slack-researcher|competitor-researcher|notion_create_page" packages/harness/src/nested-subagent-runner.ts packages/harness/src/subagent-registry.ts; then echo "Sage product semantics leaked"; exit 1; fi',
        `tail -120 ${VALIDATION_LOG}`,
        'echo SAGE_V2_NESTED_RUNNER_FINAL_VALIDATION_GREEN',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 600_000,
    })

    .step('validation-self-reflection', {
      agent: 'validation-claude',
      dependsOn: ['final-hard-validation'],
      task: `Write ${VALIDATION_REFLECTION}.

Reflect on final confidence for the nested-runner PR and name any residual risk or follow-up slice.

End with VALIDATION_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: VALIDATION_REFLECTION },
    })

    .step('stage-allowlist-and-commit', {
      type: 'deterministic',
      dependsOn: ['validation-self-reflection'],
      command: [
        'set -e',
        `mkdir -p ${GATE_DIR}`,
        `cat > ${GATE_DIR}/commit-message.txt <<'COMMIT'`,
        'feat(harness): add nested subagent runner helper',
        '',
        'Add the first reusable Sage v2 substrate slice: a harness helper for wiring createSubagentToolRegistry to isolated nested harness turns.',
        '',
        'Keep Sage product prompts, specialist rosters, runtime policy, telemetry, eval, and insight slices out of this PR.',
        '',
        'Validation is recorded in docs/architecture/sage-v2-nested-subagent-runner-80-to-100-validation.md.',
        'COMMIT',
        'git add packages/harness/package.json packages/harness/src/nested-subagent-runner.ts packages/harness/src/nested-subagent-runner.test.ts packages/harness/src/subagent-registry.ts packages/harness/src/subagent-registry.test.ts packages/harness/src/index.ts packages/harness/src/registries/index.ts packages/harness/src/subpath-exports.test.ts',
        'git add docs/architecture/sage-v2-nested-subagent-runner-*.md',
        'git diff --cached --name-only > /tmp/sage_v2_nested_staged.txt',
        'test -s /tmp/sage_v2_nested_staged.txt',
        'if rg -v "^(packages/harness/package\\.json|packages/harness/src/(nested-subagent-runner|nested-subagent-runner\\.test|subagent-registry|subagent-registry\\.test|index|registries/index|subpath-exports\\.test)\\.ts|docs/architecture/sage-v2-nested-subagent-runner-.*\\.md)$" /tmp/sage_v2_nested_staged.txt; then echo "unexpected staged file"; exit 1; fi',
        'git status --short',
        `git commit -F ${GATE_DIR}/commit-message.txt`,
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('push', {
      type: 'deterministic',
      dependsOn: ['stage-allowlist-and-commit'],
      command: 'branch=$(git rev-parse --abbrev-ref HEAD) && git push -u origin "$branch"',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-pr-body', {
      type: 'deterministic',
      dependsOn: ['push'],
      command: `mkdir -p ${GATE_DIR} && cat > ${PR_BODY_FILE} <<'PRBODY'
## Summary

First Sage v2 substrate extraction slice:

- Add a reusable @agent-assistant/harness nested subagent runner helper for createSubagentToolRegistry.
- Preserve Sage product prompts, specialist rosters, runtime policy, telemetry, eval, and insight work for separate PRs.
- Include targeted nested-runner tests, fresh-eyes review, Claude peer review, and Claude 80-to-100 validation.

## Validation

- npm test -w @agent-assistant/harness -- src/nested-subagent-runner.test.ts src/subagent-registry.test.ts src/subpath-exports.test.ts
- npm run build -w @agent-assistant/harness
- Cloudflare Workers bare-fetch storage grep
- Sage product semantic leakage grep

## Follow-ups

- Runtime budget policy primitives
- Telemetry event vocabulary
- Eval runner substrate
- Insight envelope and reader helpers
- Sage adoption after Agent Assistant release
PRBODY
wc -l ${PR_BODY_FILE}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('open-pr', {
      type: 'deterministic',
      dependsOn: ['write-pr-body'],
      command: [
        'set -e',
        'branch=$(git rev-parse --abbrev-ref HEAD)',
        'existing=$(gh pr list --head "$branch" --json url --jq ".[0].url" 2>/dev/null || true)',
        'if [ -n "$existing" ] && [ "$existing" != "null" ]; then',
        '  echo "[open-pr] PR already exists for $branch; updating body."',
        `  gh pr edit "$existing" --title "feat(harness): add nested subagent runner helper" --body-file ${PR_BODY_FILE} >/dev/null`,
        '  echo "PR: $existing"',
        'else',
        `  PR_URL=$(gh pr create --title "feat(harness): add nested subagent runner helper" --body-file ${PR_BODY_FILE})`,
        '  echo "PR: $PR_URL"',
        'fi',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
  if (result.status === 'failed') process.exit(1);
}

runWorkflow().catch((error) => {
  console.error(error);
  process.exit(1);
});
