import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';
import { applyAgentAssistantRepoSetup } from '../lib/agent-assistant-repo-setup.ts';

const WORKFLOW_NAME = 'sage-v2-substrate-extraction-pr';
const WORKFLOW_CHANNEL = 'wf-sage-v2-substrate-extraction-pr';
const IMPLEMENTATION_BRANCH = 'codex/sage-v2-agent-assistant-substrate';

const GATE_DIR = 'tmp/sage-v2-substrate-workflow';
const CONTEXT_FILE = `${GATE_DIR}/source-context.md`;
const VALIDATION_LOG = `${GATE_DIR}/hard-validation.log`;
const PR_BODY_FILE = `${GATE_DIR}/pr-body.md`;

const LEAD_PLAN = 'docs/architecture/sage-v2-substrate-implementation-plan.md';
const LEAD_REFLECTION = 'docs/architecture/sage-v2-substrate-lead-reflection.md';
const EXECUTOR_REFLECTION = 'docs/architecture/sage-v2-substrate-executor-reflection.md';
const FRESH_REVIEW = 'docs/architecture/sage-v2-substrate-fresh-eyes-review.md';
const FRESH_REFLECTION = 'docs/architecture/sage-v2-substrate-fresh-eyes-reflection.md';
const CLAUDE_REVIEW = 'docs/architecture/sage-v2-substrate-claude-peer-review.md';
const CLAUDE_REVIEW_REFLECTION = 'docs/architecture/sage-v2-substrate-claude-peer-review-reflection.md';
const VALIDATION_REPORT = 'docs/architecture/sage-v2-substrate-80-to-100-validation.md';
const VALIDATION_REFLECTION = 'docs/architecture/sage-v2-substrate-validation-reflection.md';

async function runWorkflow() {
  const baseWf = workflow(WORKFLOW_NAME)
    .description(
      'Implement the reusable Agent Assistant substrate extracted from Sage v2: nested subagent runner, runtime budget policy, telemetry vocabulary, eval substrate, insight contracts, full validation, review, commit, push, and PR.',
    )
    .pattern('dag')
    .channel(WORKFLOW_CHANNEL)
    .maxConcurrency(4)
    .timeout(10_800_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'lead',
      role: 'Lead architect. Converts the Sage v2 specs into an Agent Assistant implementation contract, keeps Sage product logic out, and owns final architectural coherence.',
      retries: 1,
      timeoutMs: 1_200_000,
    })
    .agent('executor-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Implementation executor. Edits source and tests in narrow slices, follows Cloudflare Workers fetch rules, and keeps every change backed by deterministic tests.',
      retries: 2,
      timeoutMs: 2_400_000,
    })
    .agent('fresh-eyes-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'reviewer',
      role: 'Fresh-eyes self reviewer. Reviews the complete Codex-produced diff as if seeing it for the first time, fixes narrow issues, and writes a verdict.',
      retries: 1,
      timeoutMs: 1_200_000,
    })
    .agent('peer-review-claude', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'Claude peer reviewer. Reviews implementation quality, extraction boundaries, test sufficiency, and hidden regressions.',
      retries: 1,
      timeoutMs: 1_200_000,
    })
    .agent('validation-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'reviewer',
      role: '80-to-100 validator. Proves the feature works beyond compilation, applies the relay-80-100 workflow checklist, and records evidence before PR publication.',
      retries: 1,
      timeoutMs: 1_800_000,
    });

  const wf = applyAgentAssistantRepoSetup(baseWf, {
    branch: IMPLEMENTATION_BRANCH,
    committerName: 'Sage v2 Substrate Workflow',
    committerEmail: 'agent@agent-assistant.local',
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
        'test -f ../sage/specs/sage-v2-runtime-budget-control.md',
        'test -f .agents/skills/writing-agent-relay-workflows/SKILL.md',
        'test -f .agents/skills/relay-80-100-workflow/SKILL.md',
        `mkdir -p ${GATE_DIR}`,
        'echo SAGE_V2_PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('collect-source-context', {
      type: 'deterministic',
      dependsOn: ['preflight-source-docs'],
      command: [
        'set -e',
        `: > ${CONTEXT_FILE}`,
        `printf '%s\n' '# Sage v2 substrate workflow context' >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Extraction map' >> ${CONTEXT_FILE}`,
        `sed -n '1,340p' docs/architecture/sage-v2-substrate-extraction-map.md >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Sage orchestration spec' >> ${CONTEXT_FILE}`,
        `sed -n '1,420p' ../sage/specs/sage-v2-agentic-orchestration.md >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Sage runtime budget spec' >> ${CONTEXT_FILE}`,
        `sed -n '1,360p' ../sage/specs/sage-v2-runtime-budget-control.md >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## writing-agent-relay-workflows skill' >> ${CONTEXT_FILE}`,
        `sed -n '1,360p' .agents/skills/writing-agent-relay-workflows/SKILL.md >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## relay-80-100-workflow skill' >> ${CONTEXT_FILE}`,
        `sed -n '1,320p' .agents/skills/relay-80-100-workflow/SKILL.md >> ${CONTEXT_FILE}`,
        `printf '%s\n' '## Current package surfaces' >> ${CONTEXT_FILE}`,
        `rg --files packages/harness packages/telemetry packages/vfs packages/turn-context | sort >> ${CONTEXT_FILE}`,
        `test -s ${CONTEXT_FILE}`,
        'echo SAGE_V2_CONTEXT_READY',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-architecture-contract', {
      agent: 'lead-claude',
      dependsOn: ['collect-source-context'],
      task: `Read ${CONTEXT_FILE} and write ${LEAD_PLAN}.

The plan must be an implementation contract, not a product roadmap. It must:
1. Keep Sage-owned product prompts, Slack/Notion semantics, and specialist roster definitions out of Agent Assistant.
2. Define exact Agent Assistant deliverables for nested subagent runner, runtime budget policy, telemetry event vocabulary, eval substrate, and insight envelope/readers.
3. Name the packages/files likely to change and the tests required for each slice.
4. Include Cloudflare Workers fetch compatibility: no bare fetch storage; call globalThis.fetch at invocation time.
5. Include the 80-to-100 validation contract: targeted tests, final hard gates, regression suite, review gates, and PR publication.
6. Include how Claude leads, Codex executes, every agent self-reflects, Codex fresh-eyes reviews, Claude peer-reviews, and Claude signs off on 80-to-100.

End with SAGE_V2_SUBSTRATE_PLAN_READY.`,
      verification: { type: 'file_exists', value: LEAD_PLAN },
    })

    .step('verify-lead-contract', {
      type: 'deterministic',
      dependsOn: ['lead-architecture-contract'],
      command: [
        'set -e',
        `rg -q 'SAGE_V2_SUBSTRATE_PLAN_READY' ${LEAD_PLAN}`,
        `rg -q 'nested subagent|Nested subagent|createNestedSubagentRunner' ${LEAD_PLAN}`,
        `rg -q 'runtime budget|runtime policy|Runtime budget' ${LEAD_PLAN}`,
        `rg -q 'telemetry' ${LEAD_PLAN}`,
        `rg -q 'eval' ${LEAD_PLAN}`,
        `rg -q 'InsightEnvelope|insight envelope|insight' ${LEAD_PLAN}`,
        `rg -q 'globalThis.fetch|Cloudflare' ${LEAD_PLAN}`,
        `rg -q '80-to-100|80 to 100' ${LEAD_PLAN}`,
        'echo SAGE_V2_LEAD_CONTRACT_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-self-reflection', {
      agent: 'lead-claude',
      dependsOn: ['verify-lead-contract'],
      task: `Write ${LEAD_REFLECTION}.

Reflect on your own architecture contract against the source specs and skills. Include:
- any risk that the plan accidentally moves Sage product intelligence into Agent Assistant
- any risk that the workflow misses an 80-to-100 gate
- any scope-control adjustment Codex should honor before implementation

End with LEAD_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: LEAD_REFLECTION },
    })

    .step('implement-nested-subagent-runner', {
      agent: 'executor-codex',
      dependsOn: ['lead-self-reflection'],
      task: `Implement the nested subagent runner slice from ${LEAD_PLAN}.

Scope:
- Add a first-party helper for createSubagentToolRegistry runSubagent wiring in @agent-assistant/harness.
- Preserve parent trace ids, isolate nested turns, enforce subagent tool allowlists, support cancellation, and return TaskToolResult-compatible flat output.
- Keep product subagent selection, Sage prompts, Slack/Notion/GitHub/Linear semantics, and model policy out of Agent Assistant.
- Add focused tests for success, unknown subagent, subagent failure, max-iteration failure, cancellation, and parallel task batches where supported.
- Do not store bare fetch references; use globalThis.fetch only at call time if fetch is needed.

Keep edits narrow. Run the targeted harness tests you add before exiting.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('verify-nested-subagent-runner', {
      type: 'deterministic',
      dependsOn: ['implement-nested-subagent-runner'],
      command: [
        'set -e',
        'git diff --quiet packages/harness && (echo "packages/harness was not modified"; exit 1) || true',
        'rg -q "createNestedSubagentRunner|NestedSubagentRunner|CreateNestedSubagentRunner" packages/harness/src',
        'rg -q "createNestedSubagentRunner|NestedSubagentRunner|subagent runner" packages/harness/src --glob "*test.ts"',
        'echo SAGE_V2_NESTED_RUNNER_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-harness-tests-after-nested-runner', {
      type: 'deterministic',
      dependsOn: ['verify-nested-subagent-runner'],
      command: 'npm test -w @agent-assistant/harness 2>&1 | tail -120; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
      timeoutMs: 600_000,
    })

    .step('fix-harness-after-nested-runner', {
      agent: 'executor-codex',
      dependsOn: ['run-harness-tests-after-nested-runner'],
      task: `Harness test output after nested runner:

{{steps.run-harness-tests-after-nested-runner.output}}

If EXIT: 0, do nothing. Otherwise fix only the nested runner slice and its tests, then rerun npm test -w @agent-assistant/harness until green.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('hard-harness-tests-after-nested-runner', {
      type: 'deterministic',
      dependsOn: ['fix-harness-after-nested-runner'],
      command: 'npm test -w @agent-assistant/harness 2>&1 | tail -80',
      captureOutput: true,
      failOnError: true,
      timeoutMs: 600_000,
    })

    .step('implement-runtime-budget-policy', {
      agent: 'executor-codex',
      dependsOn: ['hard-harness-tests-after-nested-runner'],
      task: `Implement the runtime budget policy slice from ${LEAD_PLAN}.

Scope:
- Add configurable turn-scoped runtime policy primitives in @agent-assistant/harness, conservatively defaulted or opt-in.
- Cover todo rewrite cap, duplicate tool-result cache, reserved synthesis budget, drill-or-stop validation, deep-repo funnel hook if planned, and final pseudo-tool output sanitizer.
- Emit structured trace or telemetry-ready events for blocked calls, cache hits, no-op todo rewrites, sanitizer activity, and synthesis salvage.
- Tests must prove the acceptance criteria from ../sage/specs/sage-v2-runtime-budget-control.md.
- Keep product definitions of "broad", provider priorities, and final answer style out of shared packages.

Run targeted runtime-policy tests before exiting.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('verify-runtime-budget-policy', {
      type: 'deterministic',
      dependsOn: ['implement-runtime-budget-policy'],
      command: [
        'set -e',
        'rg -q "runtime.*policy|RuntimePolicy|createRuntimePolicy|todo rewrite|pseudo-tool|sanit" packages/harness/src',
        'rg -q "duplicate|cache_hit|reserve|drill|write_todos|function_calls|pseudo" packages/harness/src --glob "*test.ts"',
        'echo SAGE_V2_RUNTIME_POLICY_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-harness-tests-after-runtime-policy', {
      type: 'deterministic',
      dependsOn: ['verify-runtime-budget-policy'],
      command: 'npm test -w @agent-assistant/harness 2>&1 | tail -120; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
      timeoutMs: 600_000,
    })

    .step('fix-harness-after-runtime-policy', {
      agent: 'executor-codex',
      dependsOn: ['run-harness-tests-after-runtime-policy'],
      task: `Harness test output after runtime policy:

{{steps.run-harness-tests-after-runtime-policy.output}}

If EXIT: 0, do nothing. Otherwise fix runtime policy implementation or tests. Re-run npm test -w @agent-assistant/harness until green.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('hard-harness-tests-after-runtime-policy', {
      type: 'deterministic',
      dependsOn: ['fix-harness-after-runtime-policy'],
      command: 'npm test -w @agent-assistant/harness 2>&1 | tail -80',
      captureOutput: true,
      failOnError: true,
      timeoutMs: 600_000,
    })

    .step('implement-telemetry-evals-insights', {
      agent: 'executor-codex',
      dependsOn: ['hard-harness-tests-after-runtime-policy'],
      task: `Implement the telemetry, eval substrate, and insight contract slices from ${LEAD_PLAN}.

Scope:
- In @agent-assistant/telemetry, add typed constructors or helpers for subagent lifecycle, runtime_policy.*, and synthesis.salvaged style events without raw private provider content by default.
- Bridge policy/subagent metadata from harness where the plan requires it.
- Add a small fixture-oriented eval runner contract either in a new @agent-assistant/evals package or a narrowly scoped telemetry/evals module, following the plan's package choice.
- Add InsightEnvelope and reader helpers in @agent-assistant/vfs and/or @agent-assistant/turn-context with provenance, freshness, partial JSON tolerance, and graceful malformed-input failures.
- Add tests for event shape stability, eval result JSON summary shape, and insight parsing/provenance.

Do not add Sage-specific prompts, tool rosters, Slack/Notion workflows, or customer semantics.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('verify-telemetry-evals-insights', {
      type: 'deterministic',
      dependsOn: ['implement-telemetry-evals-insights'],
      command: [
        'set -e',
        'rg -q "subagent\\.batch\\.started|subagent\\.started|runtime_policy|synthesis\\.salvaged|output_sanitized" packages/telemetry packages/harness',
        '(test -d packages/evals || rg -q "eval.*runner|fixture.*runner|PR-comment|score" packages/telemetry packages/harness packages/turn-context packages/vfs)',
        'rg -q "InsightEnvelope|sourceProvider|sourcePaths|generatedAt|freshness" packages/vfs packages/turn-context',
        'rg -q "InsightEnvelope|runtime_policy|subagent\\.started|eval.*runner|fixture" packages --glob "*test.ts"',
        'echo SAGE_V2_TELEMETRY_EVALS_INSIGHTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-targeted-package-tests', {
      type: 'deterministic',
      dependsOn: ['verify-telemetry-evals-insights'],
      command: [
        'set +e',
        'npm test -w @agent-assistant/harness > /tmp/sage_v2_harness_tests.log 2>&1',
        'HARNESS_EXIT=$?',
        'npm test -w @agent-assistant/telemetry > /tmp/sage_v2_telemetry_tests.log 2>&1',
        'TELEMETRY_EXIT=$?',
        'npm test -w @agent-assistant/vfs > /tmp/sage_v2_vfs_tests.log 2>&1',
        'VFS_EXIT=$?',
        'npm test -w @agent-assistant/turn-context > /tmp/sage_v2_turn_context_tests.log 2>&1',
        'TURN_CONTEXT_EXIT=$?',
        'echo "HARNESS_EXIT=$HARNESS_EXIT"',
        'echo "TELEMETRY_EXIT=$TELEMETRY_EXIT"',
        'echo "VFS_EXIT=$VFS_EXIT"',
        'echo "TURN_CONTEXT_EXIT=$TURN_CONTEXT_EXIT"',
        'echo "--- harness tail ---"; tail -80 /tmp/sage_v2_harness_tests.log || true',
        'echo "--- telemetry tail ---"; tail -80 /tmp/sage_v2_telemetry_tests.log || true',
        'echo "--- vfs tail ---"; tail -80 /tmp/sage_v2_vfs_tests.log || true',
        'echo "--- turn-context tail ---"; tail -80 /tmp/sage_v2_turn_context_tests.log || true',
        'exit 0',
      ].join('\n'),
      captureOutput: true,
      failOnError: false,
      timeoutMs: 900_000,
    })

    .step('fix-targeted-package-tests', {
      agent: 'executor-codex',
      dependsOn: ['run-targeted-package-tests'],
      task: `Targeted package test output:

{{steps.run-targeted-package-tests.output}}

If every *_EXIT is 0, do nothing. Otherwise fix only regressions caused by this workflow's changes, then rerun the failing package tests until green.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('hard-targeted-package-tests', {
      type: 'deterministic',
      dependsOn: ['fix-targeted-package-tests'],
      command: [
        'set -e',
        'npm test -w @agent-assistant/harness 2>&1 | tail -80',
        'npm test -w @agent-assistant/telemetry 2>&1 | tail -80',
        'npm test -w @agent-assistant/vfs 2>&1 | tail -80',
        'npm test -w @agent-assistant/turn-context 2>&1 | tail -80',
        'echo SAGE_V2_TARGETED_TESTS_GREEN',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 900_000,
    })

    .step('executor-self-reflection', {
      agent: 'executor-codex',
      dependsOn: ['hard-targeted-package-tests'],
      task: `Write ${EXECUTOR_REFLECTION}.

Reflect on your own implementation. Include:
- exact files changed by slice
- tests added or updated
- how each Sage v2 extraction acceptance item is covered
- Cloudflare Workers fetch compatibility evidence
- any residual risks or deferred Sage-owned behavior

End with EXECUTOR_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: EXECUTOR_REFLECTION },
    })

    .step('build-and-regression-first-pass', {
      type: 'deterministic',
      dependsOn: ['executor-self-reflection'],
      command: [
        'set +e',
        `mkdir -p ${GATE_DIR}`,
        `: > ${VALIDATION_LOG}`,
        'npm run build --workspaces --if-present >> ' + VALIDATION_LOG + ' 2>&1',
        'BUILD_EXIT=$?',
        'npm test --workspaces --if-present >> ' + VALIDATION_LOG + ' 2>&1',
        'TEST_EXIT=$?',
        'echo "BUILD_EXIT=$BUILD_EXIT"',
        'echo "TEST_EXIT=$TEST_EXIT"',
        `tail -160 ${VALIDATION_LOG}`,
        'exit 0',
      ].join('\n'),
      captureOutput: true,
      failOnError: false,
      timeoutMs: 1_800_000,
    })

    .step('fix-build-and-regressions', {
      agent: 'executor-codex',
      dependsOn: ['build-and-regression-first-pass'],
      task: `Workspace build/regression output:

{{steps.build-and-regression-first-pass.output}}

If BUILD_EXIT=0 and TEST_EXIT=0, do nothing. Otherwise fix only issues caused by this workflow. Re-run:
  npm run build --workspaces --if-present
  npm test --workspaces --if-present

Keep fixing until both are green.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('hard-workspace-validation', {
      type: 'deterministic',
      dependsOn: ['fix-build-and-regressions'],
      command: [
        'set -e',
        `mkdir -p ${GATE_DIR}`,
        `: > ${VALIDATION_LOG}`,
        `npm run build --workspaces --if-present >> ${VALIDATION_LOG} 2>&1`,
        `npm test --workspaces --if-present >> ${VALIDATION_LOG} 2>&1`,
        `tail -120 ${VALIDATION_LOG}`,
        'echo SAGE_V2_WORKSPACE_VALIDATION_GREEN',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 1_800_000,
    })

    .step('codex-fresh-eyes-review', {
      agent: 'fresh-eyes-codex',
      dependsOn: ['hard-workspace-validation'],
      task: `Perform a fresh-eyes review of the complete diff:
  git diff origin/main...HEAD

Review for bugs, missing tests, product-boundary violations, Cloudflare Workers fetch mistakes, public API breakage, and workflow scope creep. You may make narrow fixes if you find issues, but do not broaden the implementation.

Write ${FRESH_REVIEW}. Use one of PASS, PASS_WITH_FOLLOWUPS, or FAIL as the verdict. End with FRESH_EYES_REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: FRESH_REVIEW },
    })

    .step('verify-fresh-eyes-review', {
      type: 'deterministic',
      dependsOn: ['codex-fresh-eyes-review'],
      command: [
        'set -e',
        `rg -q 'FRESH_EYES_REVIEW_COMPLETE' ${FRESH_REVIEW}`,
        `! rg -q '^FAIL\\b' ${FRESH_REVIEW}`,
        'npm run build --workspaces --if-present 2>&1 | tail -80',
        'npm test --workspaces --if-present 2>&1 | tail -80',
        'echo SAGE_V2_FRESH_EYES_REVIEW_VERIFIED',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 1_800_000,
    })

    .step('fresh-eyes-self-reflection', {
      agent: 'fresh-eyes-codex',
      dependsOn: ['verify-fresh-eyes-review'],
      task: `Write ${FRESH_REFLECTION}.

Reflect on your review process: what you checked, what you fixed if anything, what uncertainty remains, and why the verdict is justified.

End with FRESH_EYES_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: FRESH_REFLECTION },
    })

    .step('claude-peer-review', {
      agent: 'peer-review-claude',
      dependsOn: ['fresh-eyes-self-reflection'],
      task: `Perform the required Claude peer review.

Inputs:
- ${LEAD_PLAN}
- ${LEAD_REFLECTION}
- ${EXECUTOR_REFLECTION}
- ${FRESH_REVIEW}
- git diff origin/main...HEAD
- ${VALIDATION_LOG}

Review for extraction correctness, API minimality, type safety, test adequacy, telemetry privacy, eval usefulness, insight provenance, runtime budget behavior, and absence of Sage product logic. Make narrow fixes if needed, then rerun relevant tests.

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
        'npm run build --workspaces --if-present 2>&1 | tail -80',
        'npm test --workspaces --if-present 2>&1 | tail -80',
        'echo SAGE_V2_CLAUDE_PEER_REVIEW_VERIFIED',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 1_800_000,
    })

    .step('claude-peer-review-self-reflection', {
      agent: 'peer-review-claude',
      dependsOn: ['verify-claude-peer-review'],
      task: `Write ${CLAUDE_REVIEW_REFLECTION}.

Reflect on the peer review. Include what you checked, why the verdict is not merely based on green tests, and which follow-ups remain outside this Agent Assistant substrate PR.

End with CLAUDE_PEER_REVIEW_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: CLAUDE_REVIEW_REFLECTION },
    })

    .step('claude-80-to-100-validation', {
      agent: 'validation-claude',
      dependsOn: ['claude-peer-review-self-reflection'],
      task: `Apply the relay-80-100-workflow skill as the final validation authority.

You must:
1. Read ${LEAD_PLAN}, ${EXECUTOR_REFLECTION}, ${FRESH_REVIEW}, ${CLAUDE_REVIEW}, and ${VALIDATION_LOG}.
2. Inspect git diff origin/main...HEAD.
3. Re-run or spot-run the highest-risk targeted tests for nested runner, runtime policy, telemetry, eval, and insights.
4. Verify the final hard gates are real: tests exist, tests run deterministically, failures have a fix-rerun path, build passes, regressions pass, and commit is downstream of all gates.
5. Verify Cloudflare Workers fetch safety with rg.
6. Verify no Sage product prompts, tool roster definitions, Slack/Notion product workflows, or Sage env flags leaked into shared packages.

Write ${VALIDATION_REPORT} with an explicit checklist and evidence. Use PASS, PASS_WITH_FOLLOWUPS, or FAIL. End with CLAUDE_80_TO_100_VALIDATION_COMPLETE.`,
      verification: { type: 'file_exists', value: VALIDATION_REPORT },
    })

    .step('verify-claude-80-to-100-validation', {
      type: 'deterministic',
      dependsOn: ['claude-80-to-100-validation'],
      command: [
        'set -e',
        `rg -q 'CLAUDE_80_TO_100_VALIDATION_COMPLETE' ${VALIDATION_REPORT}`,
        `! rg -q '^FAIL\\b' ${VALIDATION_REPORT}`,
        'npm run build --workspaces --if-present 2>&1 | tail -100',
        'npm test --workspaces --if-present 2>&1 | tail -100',
        'if rg -n "(fetchImpl\\s*=\\s*[^?;]*\\?\\?\\s*fetch\\b|=\\s*fetch\\s*;)" packages; then echo "bare fetch storage found"; exit 1; fi',
        'if rg -n "SAGE_HARNESS_SUBAGENTS_ENABLED|slack-researcher|competitor-researcher|notion_create_page" packages; then echo "Sage product semantics leaked into shared packages"; exit 1; fi',
        'echo SAGE_V2_80_TO_100_VERIFIED',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 1_800_000,
    })

    .step('validation-self-reflection', {
      agent: 'validation-claude',
      dependsOn: ['verify-claude-80-to-100-validation'],
      task: `Write ${VALIDATION_REFLECTION}.

Reflect on whether your 80-to-100 signoff truly proves production readiness. Name any blind spots and why they are acceptable for this PR or explicitly documented as follow-ups.

End with VALIDATION_SELF_REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: VALIDATION_REFLECTION },
    })

    .step('final-acceptance-gate', {
      type: 'deterministic',
      dependsOn: ['validation-self-reflection'],
      command: [
        'set -e',
        `rg -q 'LEAD_SELF_REFLECTION_COMPLETE' ${LEAD_REFLECTION}`,
        `rg -q 'EXECUTOR_SELF_REFLECTION_COMPLETE' ${EXECUTOR_REFLECTION}`,
        `rg -q 'FRESH_EYES_SELF_REFLECTION_COMPLETE' ${FRESH_REFLECTION}`,
        `rg -q 'CLAUDE_PEER_REVIEW_SELF_REFLECTION_COMPLETE' ${CLAUDE_REVIEW_REFLECTION}`,
        `rg -q 'VALIDATION_SELF_REFLECTION_COMPLETE' ${VALIDATION_REFLECTION}`,
        'git diff --quiet && (echo "No implementation diff to publish"; exit 1) || true',
        'git status --short',
        'echo "--- diff stat ---"',
        'git diff --stat',
        'echo SAGE_V2_FINAL_ACCEPTANCE_GATE_OK',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('commit', {
      type: 'deterministic',
      dependsOn: ['final-acceptance-gate'],
      command: [
        'set -e',
        `mkdir -p ${GATE_DIR}`,
        `cat > ${GATE_DIR}/commit-message.txt <<'COMMIT'`,
        'feat: add Sage v2 reusable substrate primitives',
        '',
        'Implement the reusable Agent Assistant substrate needed by Sage v2 without importing Sage product behavior:',
        '- nested subagent runner helper for harness task delegation',
        '- runtime budget policy primitives and final-output sanitation',
        '- reusable telemetry vocabulary for subagents, policies, and synthesis salvage',
        '- eval runner substrate for assistant-turn fixtures',
        '- insight envelope and reader helpers with provenance',
        '',
        'Validation, fresh-eyes review, Claude peer review, and Claude 80-to-100 signoff are recorded under docs/architecture.',
        'COMMIT',
        'git add package.json package-lock.json packages docs/architecture',
        'git status --short',
        'if git diff --cached --quiet; then echo "Nothing staged for commit"; exit 1; fi',
        `git commit -F ${GATE_DIR}/commit-message.txt`,
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('push', {
      type: 'deterministic',
      dependsOn: ['commit'],
      command: 'branch=$(git rev-parse --abbrev-ref HEAD) && git push -u origin "$branch"',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-pr-body', {
      type: 'deterministic',
      dependsOn: ['push'],
      command: `mkdir -p ${GATE_DIR} && cat > ${PR_BODY_FILE} <<'PRBODY'
## Summary

This PR extracts the reusable Agent Assistant substrate required by Sage v2 while keeping Sage product intelligence in Sage.

- Add nested subagent runner support for harness task delegation.
- Add runtime budget policy primitives for todo rewrite caps, duplicate call caching, synthesis reserve, drill-or-stop enforcement, and pseudo-tool output sanitation.
- Add reusable telemetry event vocabulary for subagent lifecycle, runtime policy interventions, and synthesis salvage.
- Add a fixture-oriented eval substrate for assistant turns.
- Add insight envelope and reader helpers with provenance and graceful malformed-input handling.

## Boundary

This PR intentionally does not move Sage prompts, Sage specialist roster definitions, Slack-to-Notion workflows, connector semantics, or Sage environment flags into Agent Assistant.

## Validation

- Claude lead architecture contract: ${LEAD_PLAN}
- Codex executor reflection: ${EXECUTOR_REFLECTION}
- Codex fresh-eyes review: ${FRESH_REVIEW}
- Claude peer review: ${CLAUDE_REVIEW}
- Claude 80-to-100 validation: ${VALIDATION_REPORT}
- npm run build --workspaces --if-present
- npm test --workspaces --if-present
- rg check for bare fetch storage and Sage product semantic leakage

## Follow-up

Sage should adopt the new Agent Assistant release in a separate Sage PR and delete or simplify its local nested subagent runner and duplicated generic policy machinery.
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
        `  gh pr edit "$existing" --title "feat: add Sage v2 reusable substrate primitives" --body-file ${PR_BODY_FILE} >/dev/null`,
        '  echo "PR: $existing"',
        'else',
        `  PR_URL=$(gh pr create --title "feat: add Sage v2 reusable substrate primitives" --body-file ${PR_BODY_FILE})`,
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
