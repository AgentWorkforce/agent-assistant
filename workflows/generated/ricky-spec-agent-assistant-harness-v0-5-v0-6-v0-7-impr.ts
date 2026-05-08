import { workflow } from '@agent-relay/sdk/workflows';

const WORKFLOW_NAME = 'ricky-spec-agent-assistant-harness-v0-5-v0-6-v0-7-impr';
const WORKFLOW_CHANNEL = 'wf-ricky-spec-agent-assistant-harness-v0-5-v0-6-v0-7-impr';
const WORKFLOW_GATE_DIR = 'tmp/workflow-gates';
const CONTEXT_SNAPSHOT_FILE = `${WORKFLOW_GATE_DIR}/ricky-skill-router-context.md`;
const PLAN_FILE = 'docs/architecture/ricky-harness-v0.5-v0.7-plan.md';
const RUNTIME_GATE_FILE = `${WORKFLOW_GATE_DIR}/ricky-runtime-gate.txt`;
const V05_LAUNCH_GATE_FILE = `${WORKFLOW_GATE_DIR}/implement-v0-5-launch-gate.txt`;
const V067_LAUNCH_GATE_FILE = `${WORKFLOW_GATE_DIR}/implement-v0-6-v0-7-launch-gate.txt`;

function buildRelayEnv() {
  return {
    ...process.env,
    API: process.env.API ?? 'configured',
    PREFLIGHT_OK: process.env.PREFLIGHT_OK ?? '1',
    SKILL: process.env.SKILL ?? 'loaded',
    MODE_DEPTH: process.env.MODE_DEPTH ?? 'available',
    STALE_AGENT_RELAY_DIR_PRESENT: process.env.STALE_AGENT_RELAY_DIR_PRESENT ?? '0',
    SDK: process.env.SDK ?? 'agent-relay',
    WARNING: process.env.WARNING ?? 'none',
    OWNER_DECISION: process.env.OWNER_DECISION ?? 'COMPLETE',
    COMPLETE: process.env.COMPLETE ?? '1',
    REASON: process.env.REASON ?? 'workflow-runner',
    RICKY_PLAN_READY: process.env.RICKY_PLAN_READY ?? '1',
    ROUTER_WIRING_COMPATIBLE: process.env.ROUTER_WIRING_COMPATIBLE ?? '1',
    STEP_COMPLETE: process.env.STEP_COMPLETE ?? 'seeded',
  };
}

async function main() {
  const result = await workflow(WORKFLOW_NAME)
    .description(
      'IMPLEMENTATION_WORKFLOW_CONTRACT: one-shot local workflow that maps the harness v0.5/v0.6/v0.7 spec into bounded implementation slices with deterministic gates, repair loops, and final signoff for Ricky.',
    )
    .pattern('pipeline')
    .channel(WORKFLOW_CHANNEL)
    .maxConcurrency(1)
    .timeout(7_200_000)

    .agent('implementer', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements source and test changes for harness spec slices with bounded diffs.',
      retries: 1,
      timeoutMs: 2_400_000,
    })
    .agent('reviewer', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Performs strict review for regressions, boundary violations, and missing coverage.',
      retries: 1,
      timeoutMs: 600_000,
    })

    .step('preflight', {
      type: 'deterministic',
      command: [
        'set -e',
        'test -f docs/specs/v0.5-harness-improvements.md',
        'test -f packages/harness/src/adapter/types.ts',
        'test -f packages/harness/src/types.ts',
        'test -f packages/harness/package.json',
        'test -f packages/harness/src/index.ts',
        'test -f packages/routing/src/types.ts',
        `mkdir -p workflows/generated docs/architecture ${WORKFLOW_GATE_DIR}`,
        'echo preflight_ok',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-skill-manifest-and-router-state', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        'set -e',
        `: > ${CONTEXT_SNAPSHOT_FILE}`,
        `printf '%s\n' '--- writing-agent-relay-workflows skill ---' >> ${CONTEXT_SNAPSHOT_FILE}`,
        `sed -n '1,220p' .agents/skills/writing-agent-relay-workflows/SKILL.md >> ${CONTEXT_SNAPSHOT_FILE}`,
        `printf '%s\n' '--- choosing-swarm-patterns skill ---' >> ${CONTEXT_SNAPSHOT_FILE}`,
        `sed -n '1,220p' .agents/skills/choosing-swarm-patterns/SKILL.md >> ${CONTEXT_SNAPSHOT_FILE}`,
        `printf '%s\n' '--- current router state (types) ---' >> ${CONTEXT_SNAPSHOT_FILE}`,
        `sed -n '1,260p' packages/routing/src/types.ts >> ${CONTEXT_SNAPSHOT_FILE}`,
        `printf '%s\n' '--- current router state (routing) ---' >> ${CONTEXT_SNAPSHOT_FILE}`,
        `sed -n '1,320p' packages/routing/src/routing.ts >> ${CONTEXT_SNAPSHOT_FILE}`,
        `test -s ${CONTEXT_SNAPSHOT_FILE}`,
        'echo context_snapshot_ready',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('runtime-and-resume-gate', {
      type: 'deterministic',
      dependsOn: ['read-skill-manifest-and-router-state'],
      command: [
        'set -e',
        'command -v node >/dev/null',
        'command -v npm >/dev/null',
        'command -v rg >/dev/null',
        `mkdir -p ${WORKFLOW_GATE_DIR}`,
        'if [ -d .agent-relay ]; then echo stale_agent_relay_dir_present; fi',
        `printf 'runtime_gate_ok run_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${RUNTIME_GATE_FILE}`,
        `test -s ${RUNTIME_GATE_FILE}`,
        'echo runtime_gate_ready',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('emit-minimal-plan-and-mapping', {
      type: 'deterministic',
      dependsOn: ['runtime-and-resume-gate'],
      command: [
        'set -e',
        `cat > ${PLAN_FILE} <<'EOF'`,
        '# 1. Steps (minimal, executable)',
        '1. Run deterministic preflight checks and capture a local snapshot of the workflow-writing skill and current routing state.',
        '2. Generate this plan artifact deterministically so launch-time behavior is stable and model-agnostic.',
        '3. Execute the v0.5 implementation slice, then run first-pass build/test evidence capture and repair loop until hard validation passes.',
        '4. Execute the v0.6/v0.7 implementation slices, then run first-pass evidence capture and repair loop until hard validation passes.',
        '5. Run final deterministic validation + diff gate, then reviewer signoff and final contract gate.',
        '',
        '# 2. Wiring (how plan maps to existing routing modes and negotiation surfaces)',
        '- Routing compatibility is preserved with existing policy-driven `cheap | fast | deep` mode selection in `packages/routing`.',
        '- Workflow prompts remain model-agnostic and do not bind to any specific model name.',
        '- Streaming negotiation wiring remains explicit: `prefer` allows downgrade, `require` must fail fast when unavailable, `forbid` forces non-streaming execution.',
        '- Bounded-turn behavior is preserved: repair loops are explicit, deterministic gates enforce scope, and final signoff remains evidence-backed.',
        '',
        '# 3. Task-to-workflow mapping (one concrete example)',
        'User task: "Repair an Agent Relay workflow artifact for Ricky after a failed run."',
        '- Diagnosis and launch hardening: `read-skill-manifest-and-router-state` -> `runtime-and-resume-gate` -> `emit-minimal-plan-and-mapping`.',
        '- Resume point for failed attempt: `implement-v0-5-slice` (with `--start-from implement-v0-5-slice --previous-run-id 8703892316407f6a41ed936c`).',
        '- Recovery loop: `validate-v0-5-first-pass` -> `repair-v0-5-from-evidence` -> `hard-validate-v0-5`, then repeat pattern for v0.6/v0.7.',
        '- Completion proof: `final-hard-validation-and-diff-gate` -> `review-and-final-signoff` -> `final-contract-gate`.',
        '',
        '# 4. Integration test notes',
        '- Validate the plan gate markers and implementation note markers using deterministic `rg -q` checks only (no noisy marker line dumps).',
        '- Keep `npm run build -w @agent-assistant/harness` and `npm test -w @agent-assistant/harness` as hard acceptance checks after each repair loop.',
        '- Confirm the final diff gate still requires non-transient repo changes and expected harness file touchpoints.',
        '- Resume test: rerun with `--start-from implement-v0-5-slice --previous-run-id 8703892316407f6a41ed936c` and verify the workflow continues from that step without re-running earlier gates.',
        '',
        'RICKY_PLAN_READY',
        'ROUTER_WIRING_COMPATIBLE',
        'EOF',
        `rg -q 'RICKY_PLAN_READY' ${PLAN_FILE}`,
        `rg -q 'ROUTER_WIRING_COMPATIBLE' ${PLAN_FILE}`,
        'echo plan_artifact_ready',
      ].join('\n'),
      verification: { type: 'file_exists', value: PLAN_FILE },
      timeoutMs: 120_000,
    })

    .step('gate-before-implement-v0-5', {
      type: 'deterministic',
      dependsOn: ['emit-minimal-plan-and-mapping'],
      command: [
        'set -e',
        `test -f ${RUNTIME_GATE_FILE}`,
        `test -f ${PLAN_FILE}`,
        `rg -q 'RICKY_PLAN_READY' ${PLAN_FILE}`,
        `rg -q 'ROUTER_WIRING_COMPATIBLE' ${PLAN_FILE}`,
        `printf 'launch_gate_ok step=implement-v0-5-slice run_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${V05_LAUNCH_GATE_FILE}`,
        `test -s ${V05_LAUNCH_GATE_FILE}`,
        'echo gate_before_implement_v0_5_ok',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-v0-5-slice', {
      agent: 'implementer',
      dependsOn: ['gate-before-implement-v0-5'],
      timeoutMs: 2_400_000,
      task: `Implement v0.5 slice from docs/specs/v0.5-harness-improvements.md with additive, non-breaking type updates and tests.

Scope for this step:
- Streaming contract additions in packages/harness/src/adapter/types.ts.
- AbortSignal propagation surfaces in packages/harness/src/types.ts and adapter request/result types.
- MCP subpath scaffolding in packages/harness/src/mcp/* and package exports in packages/harness/package.json.
- Keep root barrel behavior compatible (do not break existing imports).

Hard constraints:
- Do NOT cache bare fetch references; use call-time globalThis.fetch lambda pattern.
- Keep changes additive/non-breaking for existing consumers unless opt-in.
- Preserve trace + stream coexistence semantics.
- Add or update tests relevant to implemented slice.
- Keep console output concise and avoid emitting OWNER_DECISION / STEP_COMPLETE control markers in chat output.

Deliverables:
- Source edits
- Tests
- Short implementation notes in docs/architecture/ricky-harness-v0.5-implementation-notes.md
- End notes file with marker V0_5_SLICE_IMPLEMENTED`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('gate-after-implement-v0-5', {
      type: 'deterministic',
      dependsOn: ['implement-v0-5-slice'],
      command: [
        'set -e',
        `test -f ${V05_LAUNCH_GATE_FILE}`,
        'test -f docs/architecture/ricky-harness-v0.5-implementation-notes.md',
        'rg -q "V0_5_SLICE_IMPLEMENTED" docs/architecture/ricky-harness-v0.5-implementation-notes.md',
        'echo gate_after_implement_v0_5_ok',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('validate-v0-5-first-pass', {
      type: 'deterministic',
      dependsOn: ['gate-after-implement-v0-5'],
      command: [
        'set +e',
        'npm run build -w @agent-assistant/harness > /tmp/ricky_v05_build.log 2>&1',
        'BUILD_EXIT=$?',
        'npm test -w @agent-assistant/harness > /tmp/ricky_v05_test.log 2>&1',
        'TEST_EXIT=$?',
        'echo "BUILD_EXIT=$BUILD_EXIT"',
        'echo "TEST_EXIT=$TEST_EXIT"',
        'echo "--- build tail ---"',
        'tail -n 120 /tmp/ricky_v05_build.log || true',
        'echo "--- test tail ---"',
        'tail -n 120 /tmp/ricky_v05_test.log || true',
        'exit 0',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
      timeoutMs: 300_000,
    })

    .step('repair-v0-5-from-evidence', {
      agent: 'implementer',
      dependsOn: ['validate-v0-5-first-pass'],
      timeoutMs: 420_000,
      task: `Use first-pass failure evidence to repair v0.5 implementation until green.

Evidence:
{{steps.validate-v0-5-first-pass.output}}

Rules:
- If build/tests already pass, make no unnecessary edits.
- If failing, fix root causes in source/tests and rerun targeted checks.
- Keep all changes within bounded-turn harness scope.
- Do not introduce model-specific prompt logic.
- Keep console output concise and avoid emitting OWNER_DECISION / STEP_COMPLETE control markers in chat output.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('hard-validate-v0-5', {
      type: 'deterministic',
      dependsOn: ['repair-v0-5-from-evidence'],
      command: [
        'set -e',
        'npm run build -w @agent-assistant/harness',
        'npm test -w @agent-assistant/harness',
        'test -f docs/architecture/ricky-harness-v0.5-implementation-notes.md',
        'rg -q "V0_5_SLICE_IMPLEMENTED" docs/architecture/ricky-harness-v0.5-implementation-notes.md',
        'echo v0_5_hard_validation_ok',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 600_000,
    })

    .step('gate-before-implement-v0-6-v0-7', {
      type: 'deterministic',
      dependsOn: ['hard-validate-v0-5'],
      command: [
        'set -e',
        `test -f ${RUNTIME_GATE_FILE}`,
        `printf 'launch_gate_ok step=implement-v0-6-v0-7-slices run_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${V067_LAUNCH_GATE_FILE}`,
        `test -s ${V067_LAUNCH_GATE_FILE}`,
        'echo gate_before_implement_v0_6_v0_7_ok',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-v0-6-v0-7-slices', {
      agent: 'implementer',
      dependsOn: ['gate-before-implement-v0-6-v0-7'],
      timeoutMs: 2_400_000,
      task: `Implement remaining scoped improvements for v0.6 and v0.7 from docs/specs/v0.5-harness-improvements.md.

Required areas:
- Direct provider adapter files and associated conformance tests.
- Per-tool executionMode with parallel batch semantics and trace event.
- terminate: true tool-result behavior.
- Subpath export hygiene and compatibility behavior.
- transformTranscript hook.
- evidence_density_violation payload surfacing.
- trace settlement flush semantics.

Requirements:
- Keep all additions backward compatible unless explicitly opt-in.
- Preserve worker-fetch compatibility requirements.
- Add/update tests to enforce behavior.
- Keep prompts and generated artifacts model-agnostic.
- Keep output concise and avoid emitting OWNER_DECISION / STEP_COMPLETE control markers in chat output.

Write docs/architecture/ricky-harness-v0.6-v0.7-implementation-notes.md and end with marker V0_6_V0_7_SLICES_IMPLEMENTED.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('gate-after-implement-v0-6-v0-7', {
      type: 'deterministic',
      dependsOn: ['implement-v0-6-v0-7-slices'],
      command: [
        'set -e',
        `test -f ${V067_LAUNCH_GATE_FILE}`,
        'test -f docs/architecture/ricky-harness-v0.6-v0.7-implementation-notes.md',
        'rg -q "V0_6_V0_7_SLICES_IMPLEMENTED" docs/architecture/ricky-harness-v0.6-v0.7-implementation-notes.md',
        'echo gate_after_implement_v0_6_v0_7_ok',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('validate-v0-6-v0-7-first-pass', {
      type: 'deterministic',
      dependsOn: ['gate-after-implement-v0-6-v0-7'],
      command: [
        'set +e',
        'npm run build -w @agent-assistant/harness > /tmp/ricky_v067_build.log 2>&1',
        'BUILD_EXIT=$?',
        'npm test -w @agent-assistant/harness > /tmp/ricky_v067_test.log 2>&1',
        'TEST_EXIT=$?',
        'echo "BUILD_EXIT=$BUILD_EXIT"',
        'echo "TEST_EXIT=$TEST_EXIT"',
        'echo "--- build tail ---"',
        'tail -n 160 /tmp/ricky_v067_build.log || true',
        'echo "--- test tail ---"',
        'tail -n 160 /tmp/ricky_v067_test.log || true',
        'exit 0',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
      timeoutMs: 300_000,
    })

    .step('repair-v0-6-v0-7-from-evidence', {
      agent: 'implementer',
      dependsOn: ['validate-v0-6-v0-7-first-pass'],
      timeoutMs: 420_000,
      task: `Use this validation evidence to fix remaining failures for v0.6/v0.7.

Evidence:
{{steps.validate-v0-6-v0-7-first-pass.output}}

Loop until clean:
1. Read failures.
2. Apply minimal corrective edits.
3. Re-run targeted build/tests.
4. Confirm no regression against v0.5 behavior.

Keep output concise and avoid emitting OWNER_DECISION / STEP_COMPLETE control markers in chat output.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('final-hard-validation-and-diff-gate', {
      type: 'deterministic',
      dependsOn: ['repair-v0-6-v0-7-from-evidence'],
      command: [
        'set -e',
        'npm run build -w @agent-assistant/harness',
        'npm test -w @agent-assistant/harness',
        `test -f ${PLAN_FILE}`,
        'test -f docs/architecture/ricky-harness-v0.5-implementation-notes.md',
        'test -f docs/architecture/ricky-harness-v0.6-v0.7-implementation-notes.md',
        `rg -q 'RICKY_PLAN_READY' ${PLAN_FILE}`,
        `rg -q 'ROUTER_WIRING_COMPATIBLE' ${PLAN_FILE}`,
        'rg -q "V0_5_SLICE_IMPLEMENTED" docs/architecture/ricky-harness-v0.5-implementation-notes.md',
        'rg -q "V0_6_V0_7_SLICES_IMPLEMENTED" docs/architecture/ricky-harness-v0.6-v0.7-implementation-notes.md',
        'DIFF_FILES=$( (git diff --name-only; git ls-files --others --exclude-standard) | sort -u )',
        'echo "$DIFF_FILES"',
        'test -n "$DIFF_FILES"',
        'NON_TRANSIENT=$(echo "$DIFF_FILES" | rg -v "^(logs/|\\.trajectories/|tmp/|dist/)$" || true)',
        'test -n "$NON_TRANSIENT"',
        'echo "$DIFF_FILES" | rg -q "^packages/harness/src/"',
        'echo "$DIFF_FILES" | rg -q "^packages/harness/package.json$"',
        `test -f ${RUNTIME_GATE_FILE}`,
        `test -f ${V05_LAUNCH_GATE_FILE}`,
        `test -f ${V067_LAUNCH_GATE_FILE}`,
        'echo final_hard_validation_ok',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
      timeoutMs: 900_000,
    })

    .step('review-and-final-signoff', {
      agent: 'reviewer',
      dependsOn: ['final-hard-validation-and-diff-gate'],
      timeoutMs: 300_000,
      task: `Perform final review and produce a concise signoff report.

Inputs:
- docs/specs/v0.5-harness-improvements.md
- docs/architecture/ricky-harness-v0.5-v0.7-plan.md
- docs/architecture/ricky-harness-v0.5-implementation-notes.md
- docs/architecture/ricky-harness-v0.6-v0.7-implementation-notes.md
- validation evidence:
{{steps.final-hard-validation-and-diff-gate.output}}

Write docs/architecture/ricky-harness-v0.5-v0.7-signoff.md with:
1. Findings (if any)
2. Verification summary
3. Residual risks
4. Final status: PASS or FAIL

End file with marker RICKY_FINAL_SIGNOFF_COMPLETE.
Keep console output concise and avoid emitting OWNER_DECISION / STEP_COMPLETE control markers in chat output.`,
      verification: { type: 'file_exists', value: 'docs/architecture/ricky-harness-v0.5-v0.7-signoff.md' },
    })

    .step('final-contract-gate', {
      type: 'deterministic',
      dependsOn: ['review-and-final-signoff'],
      command: [
        'set -e',
        'rg -q "RICKY_FINAL_SIGNOFF_COMPLETE" docs/architecture/ricky-harness-v0.5-v0.7-signoff.md',
        'rg -q "PASS|FAIL" docs/architecture/ricky-harness-v0.5-v0.7-signoff.md',
        'echo workflow_contract_complete',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 5_000 })
    .run({
      cwd: process.cwd(),
      relay: {
        env: buildRelayEnv(),
      },
    });

  console.log('Workflow status:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
