import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('prove-byoh-webhook-runtime-e2e')
    .description(
      'Prove end-to-end that the webhook-runtime byoh-relay persona wires a Slack webhook POST through createAgentRelayExecutionAdapter and back out through the specialist-bridge egress. Produces a deterministic vitest suite, a contract doc, and an evidence doc. Uses a mocked @agent-assistant/harness so the proof does not require a running Relay broker.',
    )
    .pattern('dag')
    .channel('wf-prove-byoh-webhook-runtime-e2e')
    .maxConcurrency(3)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Writes the acceptance contract and the evidence doc; reads test output and decides whether the E2E proof holds.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Authors the vitest E2E harness that drives the byoh-relay persona through a mocked harness adapter.',
      retries: 2,
    })
    .agent('fixer-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Fixes failing tests, type errors, and regression breakage without expanding scope.',
      retries: 2,
    })

    // ── Phase 1: Context ─────────────────────────────────────────────
    .step('read-context', {
      type: 'deterministic',
      command: [
        'echo "---PERSONAS---"',
        'sed -n "1,260p" packages/webhook-runtime/examples/personas.ts',
        'echo "" && echo "---SPECIALIST BRIDGE---"',
        'sed -n "1,140p" packages/webhook-runtime/src/specialist-bridge.ts',
        'echo "" && echo "---HARNESS ADAPTER TYPES---"',
        'sed -n "1,120p" packages/harness/src/adapter/types.ts',
        'echo "" && echo "---HARNESS ADAPTER HEAD---"',
        'sed -n "1,120p" packages/harness/src/adapter/agent-relay-adapter.ts',
        'echo "" && echo "---HARNESS ADAPTER EXECUTE---"',
        'sed -n "420,720p" packages/harness/src/adapter/agent-relay-adapter.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 2: Acceptance contract ────────────────────────────────
    .step('define-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-context'],
      task: `Define the exact acceptance contract for proving the byoh-relay persona works end-to-end. Use the source context below; do not guess.

{{steps.read-context.output}}

Write docs/architecture/v1-byoh-webhook-runtime-e2e-contract.md with these sections:

1. Goal: what the E2E proof is asserting (webhook POST → persona → adapter.execute call with correct shape → result surfaces via egress)
2. Scope: what is in (shape of ExecutionRequest, predicate firing, egress invocation) and explicitly out (real Relay broker, real worker spawn, Slack signature verification, any non-slack provider)
3. Mocking strategy: the test mocks @agent-assistant/harness. State why: to keep the proof deterministic and not require a running broker. The real broker integration is a separate proof.
4. Assertions the test MUST make on the captured ExecutionRequest. Derive these from the actual call at packages/webhook-runtime/examples/personas.ts — specifically the shape passed to adapter.execute: assistantId, turnId (derived from event.deliveryId), message.id, message.text (must equal the instruction built by specialist-bridge), message.receivedAt, instructions.systemPrompt.
5. Assertions the test MUST make on the egress: that the ExecutionResult returned by the mocked adapter is passed to the egress with the correct consumerId and event.
6. Residual risks this proof does NOT cover (list at least: real broker message serialization, worker spawn auth, end-to-end latency, harness package version skew).

End the doc with the sentinel line: V1_BYOH_WEBHOOK_CONTRACT_READY`,
      verification: {
        type: 'file_exists',
        value: 'docs/architecture/v1-byoh-webhook-runtime-e2e-contract.md',
      },
    })

    .step('verify-contract', {
      type: 'deterministic',
      dependsOn: ['define-contract'],
      command:
        'grep -q "V1_BYOH_WEBHOOK_CONTRACT_READY" docs/architecture/v1-byoh-webhook-runtime-e2e-contract.md && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 3: E2E test harness ───────────────────────────────────
    .step('read-existing-tests', {
      type: 'deterministic',
      dependsOn: ['verify-contract'],
      command: [
        'echo "---HTTP RUNTIME TESTS---"',
        'sed -n "1,220p" packages/webhook-runtime/src/http-runtime.test.ts',
        'echo "" && echo "---SPECIALIST BRIDGE TEST---"',
        'sed -n "1,200p" packages/webhook-runtime/src/specialist-bridge.test.ts',
        'echo "" && echo "---PERSONAS byoh-relay---"',
        'grep -n "byoh-relay" packages/webhook-runtime/examples/personas.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('author-e2e-test', {
      agent: 'impl-codex',
      dependsOn: ['read-existing-tests'],
      task: `Create packages/webhook-runtime/src/byoh-webhook-e2e.test.ts. It must:

1. Use vitest. Mock @agent-assistant/harness via vi.mock so createAgentRelayExecutionAdapter returns a recorder whose execute(request) pushes the request into a shared array and returns a fixed ExecutionResult like { status: 'completed', output: { text: 'mocked specialist response' } }.
2. Import personaCatalog from '../examples/personas.js' and register the byoh-relay persona on a fresh createWebhookRegistry.
3. Boot startHttpRuntime({ registry, port: 0 }).
4. POST an app_mention Slack event_callback to /webhooks/slack.
5. Assert all of the following:
   - HTTP 200
   - response.succeeded contains 'byoh-relay'
   - response.failed is empty
   - the recorder captured exactly one ExecutionRequest
   - captured assistantId === 'slack-specialist'
   - captured turnId starts with 'turn-'
   - captured message.text equals the instruction string produced by specialist-bridge (the event text)
   - captured instructions.systemPrompt is a non-empty string
6. Have a second test case asserting: when the Slack event is NOT an app_mention, the byoh-relay persona is reported as skipped (predicate did not match) and executeCalls stays empty.

Existing vitest conventions for reference:
{{steps.read-existing-tests.output}}

Only create this one new file. Do NOT modify any other file. Do NOT add new dependencies. The test must run with the existing vitest setup.

Write to: packages/webhook-runtime/src/byoh-webhook-e2e.test.ts`,
      verification: {
        type: 'file_exists',
        value: 'packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
      },
    })

    .step('verify-e2e-test-grep', {
      type: 'deterministic',
      dependsOn: ['author-e2e-test'],
      command: [
        'test -f packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
        'grep -q "vi.mock" packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
        'grep -q "byoh-relay" packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
        'grep -q "startHttpRuntime" packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
        'grep -q "assistantId" packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
        'echo OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 4: Test-fix-rerun loop ────────────────────────────────
    .step('run-e2e-test', {
      type: 'deterministic',
      dependsOn: ['verify-e2e-test-grep'],
      command:
        'npm --prefix packages/webhook-runtime test -- byoh-webhook-e2e 2>&1 | tail -80; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-e2e-test', {
      agent: 'fixer-codex',
      dependsOn: ['run-e2e-test'],
      task: `The new E2E test at packages/webhook-runtime/src/byoh-webhook-e2e.test.ts was run. Output:

{{steps.run-e2e-test.output}}

If EXIT: 0 and all tests passed, do nothing.

Otherwise, diagnose and fix. Typical causes and their remedies:
- The mock path is wrong: vi.mock('@agent-assistant/harness') must be at module top before imports that transitively trigger the persona register.
- The mock factory returns the wrong shape: createAgentRelayExecutionAdapter must return an object with an execute function, not a Promise.
- The predicate did not match: the fixture must have event.event.type === 'app_mention' and a valid event_callback wrapper.
- The instruction the test asserts on is wrong: re-read packages/webhook-runtime/src/specialist-bridge.ts to see exactly how 'instruction' is built from an event.
- The ExecutionResult shape does not flow through egress: the persona uses a logging egress, so the test should not assert stdout — it should assert the mock captured the correct request.

Do not expand scope. Only edit packages/webhook-runtime/src/byoh-webhook-e2e.test.ts (and no other file). Re-run 'npm --prefix packages/webhook-runtime test -- byoh-webhook-e2e' until green.`,
      verification: { type: 'exit_code' },
    })

    .step('run-e2e-test-final', {
      type: 'deterministic',
      dependsOn: ['fix-e2e-test'],
      command:
        'npm --prefix packages/webhook-runtime test -- byoh-webhook-e2e 2>&1 | tee /tmp/byoh-e2e-final.log | tail -80',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 5: Build + regression ─────────────────────────────────
    .step('build-check', {
      type: 'deterministic',
      dependsOn: ['run-e2e-test-final'],
      command:
        'npm --prefix packages/webhook-runtime run build 2>&1 | tail -20; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-build', {
      agent: 'fixer-codex',
      dependsOn: ['build-check'],
      task: `Build output:

{{steps.build-check.output}}

If EXIT: 0 and no errors, do nothing.

Otherwise fix ONLY packages/webhook-runtime/src/byoh-webhook-e2e.test.ts (do not modify other files). Typical issue: vitest tsconfig includes tests but the tsc build step does not — the fix is to ensure the test file's imports use .js extensions that match the package's module resolution, not that you change build config.

Re-run: npm --prefix packages/webhook-runtime run build`,
      verification: { type: 'exit_code' },
    })

    .step('run-webhook-tests-all', {
      type: 'deterministic',
      dependsOn: ['fix-build'],
      command:
        'npm --prefix packages/webhook-runtime test 2>&1 | tail -40; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-regressions', {
      agent: 'fixer-codex',
      dependsOn: ['run-webhook-tests-all'],
      task: `Full webhook-runtime test suite output:

{{steps.run-webhook-tests-all.output}}

If EXIT: 0 and all tests passed, do nothing.

Otherwise identify which existing test regressed. Common causes:
- vi.mock('@agent-assistant/harness') leaks across test files — scope it to byoh-webhook-e2e.test.ts with vi.doMock inside the describe, or make sure the mock only applies when the module is dynamically imported.
- The new test file imports personas.ts which triggers a top-level side effect — if so, wrap the import under a lazy function inside the test.

Only edit packages/webhook-runtime/src/byoh-webhook-e2e.test.ts. Re-run: npm --prefix packages/webhook-runtime test`,
      verification: { type: 'exit_code' },
    })

    .step('run-webhook-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-regressions'],
      command: 'npm --prefix packages/webhook-runtime test 2>&1 | tail -30',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 6: Evidence doc ───────────────────────────────────────
    .step('read-final-test-output', {
      type: 'deterministic',
      dependsOn: ['run-webhook-tests-final'],
      command:
        'echo "---FINAL SUITE---" && npm --prefix packages/webhook-runtime test 2>&1 | tail -30 && echo "" && echo "---E2E ONLY---" && cat /tmp/byoh-e2e-final.log 2>/dev/null | tail -60',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-evidence', {
      agent: 'lead-claude',
      dependsOn: ['read-final-test-output'],
      task: `Write docs/architecture/v1-byoh-webhook-runtime-e2e-evidence.md using the test output below as proof.

{{steps.read-final-test-output.output}}

Sections required:

1. Proof summary: the byoh-relay persona routes a Slack app_mention through createAgentRelayExecutionAdapter with the expected ExecutionRequest shape.
2. What was asserted: enumerate the concrete assertions from packages/webhook-runtime/src/byoh-webhook-e2e.test.ts. Read the file to list them exactly.
3. Mock scope: the test mocks @agent-assistant/harness. State which function was mocked and what shape the mock returned.
4. Full test suite result: paste the tail of the test output verbatim inside a fenced block.
5. Before / after: before this workflow the CLI only exercised a stub factory; after this workflow the E2E test proves the byoh-relay persona builds a correctly-shaped ExecutionRequest.
6. Residual risks (copy from the contract, keep verbatim).
7. How to run locally: exact npm command.

End the doc with: V1_BYOH_WEBHOOK_E2E_PROVEN`,
      verification: {
        type: 'file_exists',
        value: 'docs/architecture/v1-byoh-webhook-runtime-e2e-evidence.md',
      },
    })

    // ── Phase 7: Verify all artifacts ───────────────────────────────
    .step('verify-artifacts', {
      type: 'deterministic',
      dependsOn: ['write-evidence'],
      command: [
        'test -f docs/architecture/v1-byoh-webhook-runtime-e2e-contract.md',
        'test -f docs/architecture/v1-byoh-webhook-runtime-e2e-evidence.md',
        'test -f packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
        'grep -q "V1_BYOH_WEBHOOK_CONTRACT_READY" docs/architecture/v1-byoh-webhook-runtime-e2e-contract.md',
        'grep -q "V1_BYOH_WEBHOOK_E2E_PROVEN" docs/architecture/v1-byoh-webhook-runtime-e2e-evidence.md',
        'echo V1_BYOH_WEBHOOK_ARTIFACTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 8: Commit ─────────────────────────────────────────────
    .step('commit', {
      type: 'deterministic',
      dependsOn: ['verify-artifacts'],
      command: [
        'git add packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
        'git add docs/architecture/v1-byoh-webhook-runtime-e2e-contract.md',
        'git add docs/architecture/v1-byoh-webhook-runtime-e2e-evidence.md',
        'git commit -m "test(webhook-runtime): prove byoh-relay persona E2E with mocked harness adapter" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })
    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
