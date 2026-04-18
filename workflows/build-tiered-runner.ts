import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('build-tiered-runner')
    .description(
      'Adds createTieredRunner implementation in @agent-assistant/harness — composes a Router + SingleShotAdapter + HarnessRuntime to produce a tiered execution pipeline (fast path bypasses tools; harness path drives the full loop). Includes vitest suite that proves both branches.',
    )
    .pattern('dag')
    .channel('wf-build-tiered-runner')
    .maxConcurrency(2)
    .timeout(2_400_000)

    .agent('impl', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the createTieredRunner factory and its vitest suite, composing the new router types + SingleShotAdapter + HarnessRuntime.',
      retries: 2,
    })

    .step('preflight', {
      type: 'deterministic',
      command: [
        'test -f packages/harness/src/router/types.ts || (echo "MISSING router types — run build-router-types-and-singleshot first"; exit 1)',
        'test -f packages/harness/src/router/openrouter-singleshot-adapter.ts || (echo "MISSING singleshot adapter"; exit 1)',
        'echo "Preflight OK"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-context', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        'echo "===== ROUTER TYPES ====="',
        'cat packages/harness/src/router/types.ts',
        'echo "" && echo "===== HARNESS RUNTIME ====="',
        'cat packages/harness/src/harness.ts',
        'echo "" && echo "===== HARNESS TYPES (for HarnessTurnInput / HarnessResult shapes) ====="',
        'sed -n "1,250p" packages/harness/src/types.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tiered-runner', {
      agent: 'impl',
      dependsOn: ['read-context'],
      task: `Create file: packages/harness/src/router/tiered-runner.ts

Implement createTieredRunner — composes Router + SingleShotAdapter + HarnessRuntime to produce a TieredRunner.

Required exports:

  export interface TieredRunnerConfig {
    router: Router;
    fast: SingleShotAdapter;
    harness: HarnessRuntime;
    rejectMessage?: string;       // default "I can't help with that request."
  }

  export function createTieredRunner(config: TieredRunnerConfig): TieredRunner

runTurn(input: HarnessTurnInput) behavior:

  1. Build a RouterInput from input:
       message: input.message
       context: input.context
       threadHistory: extract from input.context.blocks where label is 'user' | 'assistant' (best effort) — if shape doesn't match, pass undefined
       metadata: input.metadata
     Then: const decision = await config.router.route(routerInput);

  2. Branch on decision.tier:
       'fast'     → call config.fast.generate({ message, instructions: input.instructions, context: input.context, threadHistory: same as above, metadata: input.metadata })
                    → return { tier: 'fast', routingDecision: decision, text: result.text, usage: result.usage, singleShot: result }
       'harness'  → call config.harness.runTurn(input)
                    → return { tier: 'harness', routingDecision: decision, harnessResult: result, text: <best-effort extract from result> }
                    → To extract text: try result.outcome === 'completed' && result.finalAnswer?.text; otherwise undefined. Read packages/harness/src/types.ts for the actual HarnessResult shape and adjust field paths.
       'reject'   → return { tier: 'rejected', routingDecision: decision, text: config.rejectMessage ?? "I can't help with that request." }
       (Any other value should also map to 'rejected' with a warning, defensively.)

  3. Errors propagate — do not swallow. Caller decides.

Imports:
  import type {
    Router,
    RouterInput,
    SingleShotAdapter,
    TieredRunner,
    TieredRunnerResult,
  } from './types.js';
  import type { HarnessRuntime, HarnessTurnInput, HarnessResult } from '../types.js';

No new comments unless WHY is non-obvious.

End with TIERED_RUNNER_IMPLEMENTED. Only create this one file.`,
      verification: {
        type: 'file_exists',
        value: 'packages/harness/src/router/tiered-runner.ts',
      },
    })

    .step('write-test', {
      agent: 'impl',
      dependsOn: ['implement-tiered-runner'],
      task: `Create file: packages/harness/src/router/tiered-runner.test.ts

Use vitest. Test createTieredRunner with three mocks:
  - router: a Router whose route() returns whatever the test sets
  - fast: a SingleShotAdapter whose generate() returns a stubbed text
  - harness: a HarnessRuntime whose runTurn() returns a stubbed HarnessResult

Required cases:

1. "fast tier → calls fast.generate, returns tier:'fast'" —
   router returns { tier:'fast', reason:'no tools needed' }
   fast.generate returns { text:'hello back', usage:{ promptTokens:5, completionTokens:2, totalTokens:7 } }
   Assert harness.runTurn was NOT called. Assert result.tier === 'fast', result.text === 'hello back', result.routingDecision.reason === 'no tools needed'.

2. "harness tier → calls harness.runTurn, returns tier:'harness' with text extracted" —
   router returns { tier:'harness' }
   harness.runTurn returns a completed HarnessResult with finalAnswer text 'tool-driven answer' (build the full HarnessResult shape — read packages/harness/src/types.ts to get it right)
   Assert fast.generate was NOT called. Assert result.tier === 'harness', result.text === 'tool-driven answer', result.harnessResult is the same object.

3. "harness tier with non-completed outcome → text is undefined but result still surfaces" —
   harness.runTurn returns a HarnessResult with outcome 'failed' (or 'awaiting_approval' etc.)
   Assert result.tier === 'harness', result.text is undefined, result.harnessResult is the failed result. No throw.

4. "reject tier → returns tier:'rejected' with rejectMessage" —
   router returns { tier:'reject', reason:'out of scope' }
   Assert neither fast nor harness was called. Assert result.tier === 'rejected', result.text === default message, result.routingDecision.reason === 'out of scope'.

5. "custom rejectMessage is respected" — pass rejectMessage:'Sorry, no.' in config. Assert result.text === 'Sorry, no.'.

6. "router error propagates" — router.route() throws. Assert createTieredRunner(...).runTurn(...) rejects.

7. "fast adapter error propagates" — fast.generate throws. Assert runTurn rejects.

8. "harness error propagates" — harness.runTurn throws. Assert runTurn rejects.

9. "router input is built from HarnessTurnInput correctly" — router.route is a vi.fn. After runTurn, assert the routerInput passed had message === turnInput.message and context === turnInput.context.

Use vi.fn() for all three mocks. Build minimal HarnessTurnInput / HarnessResult fixtures locally — no need for full adapters.

End with TIERED_RUNNER_TEST_WRITTEN. Only create this one file.`,
      verification: {
        type: 'file_exists',
        value: 'packages/harness/src/router/tiered-runner.test.ts',
      },
    })

    .step('run-tests-first-pass', {
      type: 'deterministic',
      dependsOn: ['write-test'],
      command:
        'npx vitest run packages/harness/src/router/tiered-runner.test.ts 2>&1 | tail -100',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-test-failures', {
      agent: 'impl',
      dependsOn: ['run-tests-first-pass'],
      task: `Fix failures until all tiered-runner tests pass.

Output:
{{steps.run-tests-first-pass.output}}

If green, do nothing. Else fix in source (unless test is wrong), re-run:
  npx vitest run packages/harness/src/router/tiered-runner.test.ts
End with TESTS_FIXED.`,
      verification: { type: 'exit_code' },
    })

    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-test-failures'],
      command:
        'npx vitest run packages/harness/src/router/tiered-runner.test.ts 2>&1',
      captureOutput: true,
      failOnError: true,
    })

    .step('build-check', {
      type: 'deterministic',
      dependsOn: ['run-tests-final'],
      command: 'npm run build -w @agent-assistant/harness 2>&1 | tail -40; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-build-errors', {
      agent: 'impl',
      dependsOn: ['build-check'],
      task: `Fix any tsc errors. Output:
{{steps.build-check.output}}

If exit 0, do nothing. Else fix and re-run: npm run build -w @agent-assistant/harness. End with BUILD_FIXED.`,
      verification: { type: 'exit_code' },
    })

    .step('build-final', {
      type: 'deterministic',
      dependsOn: ['fix-build-errors'],
      command: 'npm run build -w @agent-assistant/harness 2>&1',
      captureOutput: true,
      failOnError: true,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 5_000 })
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
}

runWorkflow().catch((error) => {
  console.error(error);
  process.exit(1);
});
