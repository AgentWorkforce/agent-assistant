import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('prove-byoh-webhook-runtime-real-broker-e2e')
    .description(
      'Prove the byoh-relay persona end-to-end against a REAL Agent Relay broker (Rust subprocess). Spawns the broker via RelayAdapter.start(), registers an in-process test worker that responds to agent-assistant.execution-request.v1, fires a Slack webhook at the runtime with byoh-relay registered, asserts the adapter round-tripped through the broker and the ExecutionResult surfaced via the specialist-bridge egress. Goes one layer deeper than the mocked-harness proof committed in 306c1a1.',
    )
    .pattern('dag')
    .channel('wf-prove-byoh-real-broker-e2e')
    .maxConcurrency(3)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Writes the real-broker acceptance contract and the evidence doc.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Authors the vitest suite that spawns a real broker and drives the byoh-relay persona through it.',
      retries: 2,
    })
    .agent('fixer-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Fixes failing tests, type errors, broker teardown issues, or regression breakage without expanding scope.',
      retries: 2,
    })

    // ── Phase 1: Preflight — broker binary is present ────────────────
    .step('preflight-binary', {
      type: 'deterministic',
      command:
        'command -v agent-relay-broker >/dev/null && echo "BROKER_PRESENT" || (echo "BROKER_MISSING — install @agent-relay/cli or agent-relay-broker before running this workflow"; exit 1)',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 2: Context ─────────────────────────────────────────────
    .step('read-context', {
      type: 'deterministic',
      dependsOn: ['preflight-binary'],
      command: [
        'echo "---PERSONA byoh-relay (for reference only)---"',
        'sed -n "93,150p" packages/webhook-runtime/examples/personas.ts',
        'echo "" && echo "---SPECIALIST BRIDGE INSTRUCTION BUILDER---"',
        'sed -n "60,140p" packages/webhook-runtime/src/specialist-bridge.ts',
        'echo "" && echo "---HARNESS ADAPTER MESSAGE TYPES---"',
        'sed -n "30,120p" packages/harness/src/adapter/agent-relay-adapter.ts',
        'echo "" && echo "---HARNESS ADAPTER EXECUTE BODY---"',
        'sed -n "420,720p" packages/harness/src/adapter/agent-relay-adapter.ts',
        'echo "" && echo "---REFERENCE: byoh-local-proof.ts real broker pattern---"',
        'sed -n "300,540p" packages/harness/src/adapter/proof/byoh-local-proof.ts',
        'echo "" && echo "---EXISTING MOCKED TEST for shape reference---"',
        'sed -n "1,130p" packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
        'echo "" && echo "---RelayAdapter d.ts signatures---"',
        'find packages/webhook-runtime/node_modules/@agent-relay/sdk -name "relay-adapter.d.ts" -maxdepth 5 | head -1 | xargs -I{} sh -c "sed -n \"1,120p\" {}"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 3: Acceptance contract ────────────────────────────────
    .step('define-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-context'],
      task: `Define the acceptance contract for a REAL-broker byoh-relay proof. Use only the sources below; do not speculate beyond them.

{{steps.read-context.output}}

Write docs/architecture/v1-byoh-webhook-runtime-real-broker-contract.md with these sections:

1. Goal: webhook POST → persona → createAgentRelayExecutionAdapter → REAL agent-relay-broker subprocess → in-process test worker consumes agent-assistant.execution-request.v1 → responds with agent-assistant.execution-result.v1 → adapter returns ExecutionResult → specialist-bridge egress invoked. Distinguish this from the mocked proof at 306c1a1.

2. Scope IN:
   - Real broker subprocess spawned via RelayAdapter.start() against a mkdtemp cwd
   - Worker registered in-process that listens on relay.onEvent and echoes back a deterministic ExecutionResult with matching turnId/threadId
   - The byoh-relay persona (or, if persona wiring prevents broker sharing, a direct call to createAgentRelayExecutionAdapter using the same shared-cwd adapter config) sends a real message over the broker and receives a real response
   - Assertion that the assertion captures: ExecutionRequest shape on the wire, ExecutionResult shape coming back, no timeouts
   - Clean teardown: broker subprocess exits, tmpdir cleaned up

3. Scope OUT (document as residual risks):
   - Spawning a real Claude/Codex worker (we use a synchronous test responder)
   - Model billing / API auth
   - Slack signature verification
   - Non-slack providers
   - Broker failover or high-concurrency behavior

4. Wiring strategy decision: Decide up-front whether the test drives the full HTTP → persona chain or bypasses the persona. State the reasoning. The persona's factory calls createAgentRelayExecutionAdapter with config from process.env; if the adapter discovers the broker via {cwd}/.agent-relay/connection.json and the test sets cwd appropriately before POSTing, the persona SHOULD share the broker subprocess. Document the exact env vars the test will set (RELAY_CHANNEL, RELAY_WORKER, RELAY_AUTO_SPAWN=false) and the cwd strategy.

5. Fallback: if during impl the agents discover the persona cannot share the broker without code changes, the acceptable fallback is to test createAgentRelayExecutionAdapter directly with the same broker + worker harness. In that case the evidence doc must call out that the persona-to-adapter wiring is covered by the mocked proof and only the adapter-to-broker transport is covered by THIS proof.

6. Assertions the test MUST make:
   - Broker subprocess starts and connection.json is written
   - Worker receives at least one AgentRelayExecutionRequestMessage with the right type
   - turnId/threadId on the response match the request
   - adapter.execute returns an ExecutionResult whose status is 'completed' and output.text matches what the test worker sent
   - Broker subprocess exits cleanly on teardown (no leaked processes, no files left in cwd outside .agent-relay)

7. Residual risks — list explicitly.

End the doc with sentinel: V1_BYOH_WEBHOOK_REAL_BROKER_CONTRACT_READY`,
      verification: {
        type: 'file_exists',
        value: 'docs/architecture/v1-byoh-webhook-runtime-real-broker-contract.md',
      },
    })

    .step('verify-contract', {
      type: 'deterministic',
      dependsOn: ['define-contract'],
      command:
        'grep -q "V1_BYOH_WEBHOOK_REAL_BROKER_CONTRACT_READY" docs/architecture/v1-byoh-webhook-runtime-real-broker-contract.md && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 4: Author the real-broker test ────────────────────────
    .step('read-impl-refs', {
      type: 'deterministic',
      dependsOn: ['verify-contract'],
      command: [
        'echo "---byoh-local-proof.ts---"',
        'sed -n "1,540p" packages/harness/src/adapter/proof/byoh-local-proof.ts',
        'echo "" && echo "---agent-relay-adapter.test.ts (FakeRelayTransport pattern)---"',
        'sed -n "1,160p" packages/harness/src/adapter/agent-relay-adapter.test.ts',
        'echo "" && echo "---contract decisions---"',
        'sed -n "1,400p" docs/architecture/v1-byoh-webhook-runtime-real-broker-contract.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('author-real-broker-test', {
      agent: 'impl-codex',
      dependsOn: ['read-impl-refs'],
      task: `Create packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts.

Follow the wiring strategy decided in the contract doc (read the 'Wiring strategy decision' section of {{steps.read-impl-refs.output}}).

Hard requirements:
1. The test MUST spawn a real agent-relay broker via new RelayAdapter({ cwd }).start() from '@agent-relay/sdk'. The cwd must be a unique mkdtemp dir per test (use node:fs mkdtempSync + node:os tmpdir) so tests don't collide.
2. Register an in-process worker via relay.onEvent that:
   a. Filters for event.kind === 'relay_inbound'
   b. Parses event.body as JSON and matches type 'agent-assistant.execution-request.v1'
   c. Reads request.turnId, request.threadId, request.replyTo
   d. Responds with relay.sendMessage to request.replyTo.agentId, containing a JSON body of type 'agent-assistant.execution-result.v1' with matching turnId + threadId and an ExecutionResult payload { backendId: 'test-worker', status: 'completed', output: { text: 'real-broker test response' } }
3. Exercise the byoh-relay persona end-to-end by:
   - Importing personaCatalog from '../examples/personas.js'
   - Setting process.env.RELAY_CHANNEL, RELAY_WORKER, RELAY_AUTO_SPAWN='false' before registering
   - Creating a webhook registry, registering the byoh-relay persona
   - Starting startHttpRuntime({ registry, port: 0 })
   - POSTing a Slack app_mention event_callback to /webhooks/slack
   - Asserting HTTP 200, fanout.succeeded contains 'byoh-relay', fanout.failed is empty
   - Asserting the worker received exactly one execution-request message
   - Asserting the adapter's returned ExecutionResult (captured via a spy on the egress) has output.text === 'real-broker test response'
4. If during implementation it turns out that createAgentRelayExecutionAdapter in the persona does NOT discover the test's broker (e.g., it tries to spawn its own), fall back to the adapter-only pattern documented in the contract: call createAgentRelayExecutionAdapter directly with the same relay instance, and document in a code comment why the persona path was skipped.
5. Use beforeEach/afterEach to mkdtemp + relay.shutdown + rm -rf the tmpdir. NO leaked processes, NO leaked files.
6. Timeout the individual test at 30_000 ms (the broker spawn takes a few seconds cold).
7. At most 2 tests in the file: the happy path and a teardown/cleanup assertion.

Only create this one file. Do NOT modify other files.

Write to: packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts`,
      verification: {
        type: 'file_exists',
        value: 'packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts',
      },
    })

    .step('verify-test-grep', {
      type: 'deterministic',
      dependsOn: ['author-real-broker-test'],
      command: [
        'test -f packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts',
        'grep -q "RelayAdapter" packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts',
        'grep -q "mkdtemp" packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts',
        'grep -q "agent-assistant.execution-request.v1" packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts',
        'grep -q "shutdown" packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts',
        'echo OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 5: Test-fix-rerun loop (with longer per-run budget) ──
    .step('run-real-broker-test', {
      type: 'deterministic',
      dependsOn: ['verify-test-grep'],
      command:
        'npm --prefix packages/webhook-runtime test -- byoh-webhook-real-broker-e2e --testTimeout=45000 2>&1 | tail -120; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-real-broker-test', {
      agent: 'fixer-codex',
      dependsOn: ['run-real-broker-test'],
      task: `The real-broker test was run. Output:

{{steps.run-real-broker-test.output}}

If EXIT: 0 and all tests passed, do nothing.

Otherwise diagnose and fix. Common failure modes and how to respond:
- "Broker did not start" / timeout on RelayAdapter.start(): check that agent-relay-broker is on PATH and that the test cwd is valid. Do NOT mock the broker — that defeats the proof. Increase only the individual test timeout if genuinely slow.
- Worker never sees the request: the test must subscribe to the right channel BEFORE calling adapter.execute. Also ensure the persona's env vars (RELAY_CHANNEL) match the channel the worker listens on.
- turnId/threadId mismatch: the response must echo the request's ids exactly.
- Persona's adapter spawns its own broker: if discovered, fall back to calling createAgentRelayExecutionAdapter directly with the test's relay instance, and add a comment explaining why. Also update docs/architecture/v1-byoh-webhook-runtime-real-broker-contract.md scope 'Wiring strategy decision' section to reflect the fallback.
- Leaked processes after test: use afterEach with await relay.shutdown() and assert no lingering agent-relay-broker PID. Use try/finally.

Only edit packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts (and, if the fallback was taken, the contract doc). Re-run: npm --prefix packages/webhook-runtime test -- byoh-webhook-real-broker-e2e --testTimeout=45000`,
      verification: { type: 'exit_code' },
    })

    .step('run-real-broker-test-final', {
      type: 'deterministic',
      dependsOn: ['fix-real-broker-test'],
      command:
        'npm --prefix packages/webhook-runtime test -- byoh-webhook-real-broker-e2e --testTimeout=45000 2>&1 | tee /tmp/byoh-real-broker-final.log | tail -80',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 6: Build + regression ─────────────────────────────────
    .step('build-check', {
      type: 'deterministic',
      dependsOn: ['run-real-broker-test-final'],
      command:
        'npm --prefix packages/webhook-runtime run build 2>&1 | tail -20; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-build', {
      agent: 'fixer-codex',
      dependsOn: ['build-check'],
      task: `Build output:\n{{steps.build-check.output}}\n\nIf EXIT: 0 and no errors, do nothing. Otherwise fix ONLY the new test file. Re-run: npm --prefix packages/webhook-runtime run build`,
      verification: { type: 'exit_code' },
    })

    .step('run-all-webhook-tests', {
      type: 'deterministic',
      dependsOn: ['fix-build'],
      command:
        'npm --prefix packages/webhook-runtime test -- --testTimeout=45000 2>&1 | tail -40; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-regressions', {
      agent: 'fixer-codex',
      dependsOn: ['run-all-webhook-tests'],
      task: `Full webhook-runtime test suite output:\n{{steps.run-all-webhook-tests.output}}\n\nIf EXIT: 0 and all tests passed, do nothing. Otherwise the real-broker test is likely interfering with other tests (e.g., setting env vars that leak, leaving broker processes). Scope env var mutations and broker lifecycle entirely inside the describe via beforeEach/afterEach. Only edit packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts. Re-run: npm --prefix packages/webhook-runtime test -- --testTimeout=45000`,
      verification: { type: 'exit_code' },
    })

    .step('run-all-webhook-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-regressions'],
      command:
        'npm --prefix packages/webhook-runtime test -- --testTimeout=45000 2>&1 | tail -30',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 7: Evidence ───────────────────────────────────────────
    .step('read-final-output', {
      type: 'deterministic',
      dependsOn: ['run-all-webhook-tests-final'],
      command:
        'echo "---FULL SUITE---" && npm --prefix packages/webhook-runtime test -- --testTimeout=45000 2>&1 | tail -40 && echo "" && echo "---REAL-BROKER ONLY---" && cat /tmp/byoh-real-broker-final.log 2>/dev/null | tail -80',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-evidence', {
      agent: 'lead-claude',
      dependsOn: ['read-final-output'],
      task: `Write docs/architecture/v1-byoh-webhook-runtime-real-broker-evidence.md using the test output below as proof.

{{steps.read-final-output.output}}

Sections:
1. Proof summary — real broker subprocess spawned, worker round-tripped the ExecutionRequest.
2. What was asserted — enumerate the concrete assertions from packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts (read the file to list them verbatim).
3. Wiring actually used (full persona chain vs. adapter-direct fallback). Say which, and why. Read the test file to determine this.
4. Full suite output (tail in fenced block).
5. Before / after: before this proof the BYOH path was only covered by a mocked adapter; after, the transport through the real broker binary is proven.
6. Residual risks (carry over from contract, plus any discovered during implementation — e.g., broker startup latency, platform-specific binary availability).
7. How to run locally: exact npm command + prerequisites (agent-relay-broker on PATH).

End with sentinel: V1_BYOH_WEBHOOK_REAL_BROKER_PROVEN`,
      verification: {
        type: 'file_exists',
        value: 'docs/architecture/v1-byoh-webhook-runtime-real-broker-evidence.md',
      },
    })

    // ── Phase 8: Verify artifacts + commit ──────────────────────────
    .step('verify-artifacts', {
      type: 'deterministic',
      dependsOn: ['write-evidence'],
      command: [
        'test -f docs/architecture/v1-byoh-webhook-runtime-real-broker-contract.md',
        'test -f docs/architecture/v1-byoh-webhook-runtime-real-broker-evidence.md',
        'test -f packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts',
        'grep -q "V1_BYOH_WEBHOOK_REAL_BROKER_CONTRACT_READY" docs/architecture/v1-byoh-webhook-runtime-real-broker-contract.md',
        'grep -q "V1_BYOH_WEBHOOK_REAL_BROKER_PROVEN" docs/architecture/v1-byoh-webhook-runtime-real-broker-evidence.md',
        'echo V1_BYOH_WEBHOOK_REAL_BROKER_ARTIFACTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('commit', {
      type: 'deterministic',
      dependsOn: ['verify-artifacts'],
      command: [
        'git add packages/webhook-runtime/src/byoh-webhook-real-broker-e2e.test.ts',
        'git add docs/architecture/v1-byoh-webhook-runtime-real-broker-contract.md',
        'git add docs/architecture/v1-byoh-webhook-runtime-real-broker-evidence.md',
        'git commit -m "test(webhook-runtime): prove byoh-relay persona E2E against a real agent-relay broker" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"',
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
