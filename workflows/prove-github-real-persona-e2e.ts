import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('prove-github-real-persona-e2e')
    .description(
      'Prove that the github-real persona exercises the default specialistFactory path in specialist-bridge.ts — dynamic-importing @agent-assistant/specialists and constructing createGitHubLibrarian({ vfs }) with the expected empty VFS, then routing execute() through to egress. Uses a mocked @agent-assistant/specialists module so the proof is deterministic and does not require any real GitHub auth.',
    )
    .pattern('dag')
    .channel('wf-prove-github-real-persona-e2e')
    .maxConcurrency(3)
    .timeout(3_600_000)

    .agent('lead-claude', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      preset: 'analyst',
      role: 'Writes the contract and evidence docs.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Authors the vitest E2E that drives the github-real persona with a mocked specialists module.',
      retries: 2,
    })
    .agent('fixer-codex', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Fixes failing tests, type errors, or regression breakage without expanding scope.',
      retries: 2,
    })

    // ── Phase 1: Context ─────────────────────────────────────────────
    .step('read-context', {
      type: 'deterministic',
      command: [
        'echo "---PERSONA github-real---"',
        'sed -n "65,95p" packages/webhook-runtime/examples/personas.ts',
        'echo "" && echo "---DEFAULT FACTORY (specialist-bridge.ts)---"',
        'sed -n "45,140p" packages/webhook-runtime/src/specialist-bridge.ts',
        'echo "" && echo "---SPECIALISTS entry (for createGitHubLibrarian location)---"',
        'sed -n "1,40p" packages/specialists/src/index.ts',
        'sed -n "1,80p" packages/specialists/src/github/index.ts',
        'sed -n "1,120p" packages/specialists/src/github/librarian.ts',
        'echo "" && echo "---EXISTING MOCKED byoh-webhook test (shape reference)---"',
        'sed -n "1,130p" packages/webhook-runtime/src/byoh-webhook-e2e.test.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 2: Acceptance contract ────────────────────────────────
    .step('define-contract', {
      agent: 'lead-claude',
      dependsOn: ['read-context'],
      task: `Define the acceptance contract for proving the github-real persona works end-to-end. Use only the sources below; do not speculate.

{{steps.read-context.output}}

Write docs/architecture/v1-github-real-persona-e2e-contract.md with:

1. Goal: webhook POST → github-real persona (no specialistFactory override) → defaultSpecialistFactory in specialist-bridge.ts → dynamic import of @agent-assistant/specialists → createGitHubLibrarian({ vfs }) → handler.execute(instruction, context) → egress.
2. Scope IN:
   - Dynamic import of @agent-assistant/specialists is invoked
   - createGitHubLibrarian is called with exactly { vfs } where vfs is the empty VFS from specialist-bridge.ts (list and search both return [])
   - handler.execute is invoked with (instruction, context) where instruction is built by instructionForEvent and context contains { source: 'webhook-runtime', consumerId: 'github-real', specialistKind: 'github', webhookEvent }
   - Egress is called with the ExecutionResult from handler.execute
   - Predicate gating: non-app_mention events are skipped
3. Scope OUT (residual risks):
   - Real GitHub auth / network calls (we mock @agent-assistant/specialists entirely)
   - The actual behavior of createGitHubLibrarian internals
   - Linear kind variant (covered separately if needed)
   - Error handling when the specialists package is not installed
4. Mocking strategy: vi.mock('@agent-assistant/specialists') returns { createGitHubLibrarian: vi.fn(() => ({ handler: { execute: spy } })) }. Record the args to both createGitHubLibrarian and handler.execute in arrays the test can assert on.
5. Exact assertions the test MUST make:
   - createGitHubLibrarian called exactly once
   - The config arg matches { vfs: <has async list and search functions that resolve to []> }
   - handler.execute called exactly once
   - First arg (instruction) equals the event's text field
   - Second arg (context) has source='webhook-runtime', consumerId='github-real', specialistKind='github', and webhookEvent is the normalized event
   - Egress receives an object with consumerId='github-real', specialistKind='github', event equal to the normalized event, and response equal to what the spy returned
   - Second test: for a non-app_mention event the predicate skips and the mocks are never called
6. Residual risks enumerated.

End with sentinel: V1_GITHUB_REAL_PERSONA_CONTRACT_READY`,
      verification: {
        type: 'file_exists',
        value: 'docs/architecture/v1-github-real-persona-e2e-contract.md',
      },
    })

    .step('verify-contract', {
      type: 'deterministic',
      dependsOn: ['define-contract'],
      command:
        'grep -q "V1_GITHUB_REAL_PERSONA_CONTRACT_READY" docs/architecture/v1-github-real-persona-e2e-contract.md && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 3: Author the test ───────────────────────────────────
    .step('author-test', {
      agent: 'impl-codex',
      dependsOn: ['verify-contract'],
      task: `Create packages/webhook-runtime/src/github-real-persona-e2e.test.ts.

Requirements (follow the contract at docs/architecture/v1-github-real-persona-e2e-contract.md):

1. Use vitest. At module top, vi.mock('@agent-assistant/specialists', () => ({
     createGitHubLibrarian: vi.fn(({ vfs }) => {
       capturedVfs.push(vfs);
       return {
         handler: {
           execute: vi.fn(async (instruction, context) => {
             executeCalls.push({ instruction, context });
             return 'mocked github-real response';
           }),
         },
       };
     }),
     createLinearLibrarian: vi.fn(),
   }));
   Use vi.hoisted for the capturedVfs, executeCalls, and egressCalls arrays so the mock factory can reference them.

2. Import personaCatalog from '../examples/personas.js'. The github-real persona uses a logging egress — wrap it to also push into egressCalls. The simplest way: register github-real, then register an additional 'egress-spy' consumer that listens to the same events? Actually simpler — clone or re-implement: call registerSlackSpecialistConsumer directly in the test with the same config as personaCatalog['github-real'] but with an egress that pushes into egressCalls. Name the consumer 'github-real' so the assertion checks still work.

3. Boot startHttpRuntime({ registry, port: 0 }).

4. Happy path test: POST an app_mention Slack event_callback. Assert:
   - HTTP 200, succeeded contains 'github-real', failed is empty
   - capturedVfs has length 1 and the entry has async list and search functions that resolve to empty arrays (test by awaiting vfs.list('/') and vfs.search('x'))
   - executeCalls has length 1
   - executeCalls[0].instruction equals the event's text
   - executeCalls[0].context.source === 'webhook-runtime'
   - executeCalls[0].context.consumerId === 'github-real'
   - executeCalls[0].context.specialistKind === 'github'
   - executeCalls[0].context.webhookEvent.eventType === 'app_mention'
   - egressCalls has length 1, egressCalls[0].consumerId === 'github-real', response === 'mocked github-real response'

5. Skipped test: POST a non-app_mention event. Assert succeeded is empty, skipped contains { id: 'github-real', reason: 'predicate' }, and none of the mocks were called.

Do NOT modify any other file. Do NOT add new dependencies.

Write to: packages/webhook-runtime/src/github-real-persona-e2e.test.ts`,
      verification: {
        type: 'file_exists',
        value: 'packages/webhook-runtime/src/github-real-persona-e2e.test.ts',
      },
    })

    .step('verify-test-grep', {
      type: 'deterministic',
      dependsOn: ['author-test'],
      command: [
        'test -f packages/webhook-runtime/src/github-real-persona-e2e.test.ts',
        'grep -q "vi.mock" packages/webhook-runtime/src/github-real-persona-e2e.test.ts',
        'grep -q "@agent-assistant/specialists" packages/webhook-runtime/src/github-real-persona-e2e.test.ts',
        'grep -q "createGitHubLibrarian" packages/webhook-runtime/src/github-real-persona-e2e.test.ts',
        'grep -q "github-real" packages/webhook-runtime/src/github-real-persona-e2e.test.ts',
        'echo OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 4: Test-fix-rerun loop ────────────────────────────────
    .step('run-test', {
      type: 'deterministic',
      dependsOn: ['verify-test-grep'],
      command:
        'npm --prefix packages/webhook-runtime test -- github-real-persona-e2e 2>&1 | tail -80; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-test', {
      agent: 'fixer-codex',
      dependsOn: ['run-test'],
      task: `Test output:

{{steps.run-test.output}}

If EXIT: 0 and all tests passed, do nothing.

Otherwise diagnose and fix. Common issues:
- vi.mock must be at module top before any import that loads the specialist-bridge path. If the persona's dynamic import of @agent-assistant/specialists happens at test runtime, vi.mock('@agent-assistant/specialists') intercepts it — but only if the mock is hoisted (vitest handles this automatically for vi.mock).
- vi.hoisted is needed for variables referenced inside vi.mock's factory.
- The persona's egress logs to console — if the test registers its own consumer with a spy egress, the happy-path assertion still needs to match the fanout result (succeeded names, not egress side-effects).
- The instruction built by specialist-bridge is derived from event.data.text — the assertion must match whatever the raw Slack text was.

Only edit packages/webhook-runtime/src/github-real-persona-e2e.test.ts. Re-run: npm --prefix packages/webhook-runtime test -- github-real-persona-e2e`,
      verification: { type: 'exit_code' },
    })

    .step('run-test-final', {
      type: 'deterministic',
      dependsOn: ['fix-test'],
      command:
        'npm --prefix packages/webhook-runtime test -- github-real-persona-e2e 2>&1 | tee /tmp/github-real-final.log | tail -80',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 5: Build + regression ─────────────────────────────────
    .step('build-check', {
      type: 'deterministic',
      dependsOn: ['run-test-final'],
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

    .step('run-all-tests', {
      type: 'deterministic',
      dependsOn: ['fix-build'],
      command:
        'npm --prefix packages/webhook-runtime test 2>&1 | tail -40; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-regressions', {
      agent: 'fixer-codex',
      dependsOn: ['run-all-tests'],
      task: `Full webhook-runtime suite output:\n{{steps.run-all-tests.output}}\n\nIf EXIT: 0 and all tests passed, do nothing. Otherwise identify regression — likely the new vi.mock of @agent-assistant/specialists is leaking into other test files. Scope the mock explicitly to the describe block or use vi.doMock inside the test. Only edit packages/webhook-runtime/src/github-real-persona-e2e.test.ts. Re-run: npm --prefix packages/webhook-runtime test`,
      verification: { type: 'exit_code' },
    })

    .step('run-all-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-regressions'],
      command: 'npm --prefix packages/webhook-runtime test 2>&1 | tail -30',
      captureOutput: true,
      failOnError: true,
    })

    // ── Phase 6: Evidence ───────────────────────────────────────────
    .step('read-final-output', {
      type: 'deterministic',
      dependsOn: ['run-all-tests-final'],
      command:
        'echo "---FULL SUITE---" && npm --prefix packages/webhook-runtime test 2>&1 | tail -40 && echo "" && echo "---GITHUB-REAL ONLY---" && cat /tmp/github-real-final.log 2>/dev/null | tail -80',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-evidence', {
      agent: 'lead-claude',
      dependsOn: ['read-final-output'],
      task: `Write docs/architecture/v1-github-real-persona-e2e-evidence.md using the output below as proof.

{{steps.read-final-output.output}}

Sections:
1. Proof summary — github-real persona exercises the default dynamic-import factory path.
2. What was asserted — enumerate the concrete assertions from packages/webhook-runtime/src/github-real-persona-e2e.test.ts verbatim.
3. Mock scope — which module and which exports were mocked.
4. Full suite output (fenced tail).
5. Before / after — before this proof github-real was documented as untested; after, the default factory path is covered.
6. Residual risks (carry from contract).
7. How to run: exact npm command.

End with sentinel: V1_GITHUB_REAL_PERSONA_PROVEN`,
      verification: {
        type: 'file_exists',
        value: 'docs/architecture/v1-github-real-persona-e2e-evidence.md',
      },
    })

    // ── Phase 7: Verify + commit ───────────────────────────────────
    .step('verify-artifacts', {
      type: 'deterministic',
      dependsOn: ['write-evidence'],
      command: [
        'test -f docs/architecture/v1-github-real-persona-e2e-contract.md',
        'test -f docs/architecture/v1-github-real-persona-e2e-evidence.md',
        'test -f packages/webhook-runtime/src/github-real-persona-e2e.test.ts',
        'grep -q "V1_GITHUB_REAL_PERSONA_CONTRACT_READY" docs/architecture/v1-github-real-persona-e2e-contract.md',
        'grep -q "V1_GITHUB_REAL_PERSONA_PROVEN" docs/architecture/v1-github-real-persona-e2e-evidence.md',
        'echo V1_GITHUB_REAL_PERSONA_ARTIFACTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('commit', {
      type: 'deterministic',
      dependsOn: ['verify-artifacts'],
      command: [
        'git add packages/webhook-runtime/src/github-real-persona-e2e.test.ts',
        'git add docs/architecture/v1-github-real-persona-e2e-contract.md',
        'git add docs/architecture/v1-github-real-persona-e2e-evidence.md',
        'git commit -m "test(webhook-runtime): prove github-real persona E2E via mocked specialists module" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"',
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
