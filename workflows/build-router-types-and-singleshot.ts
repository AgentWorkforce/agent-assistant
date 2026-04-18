import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('build-router-types-and-singleshot')
    .description(
      'Adds Router / SingleShotAdapter / TieredRunner type interfaces in @agent-assistant/harness, plus a concrete OpenRouterSingleShotAdapter implementation and vitest suite. No exports are wired in this step; the integrate workflow handles that.',
    )
    .pattern('dag')
    .channel('wf-build-router-types-and-singleshot')
    .maxConcurrency(2)
    .timeout(2_400_000)

    .agent('impl', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the routing types and the OpenRouter single-shot adapter plus its tests.',
      retries: 2,
    })

    .step('read-context', {
      type: 'deterministic',
      command: [
        'echo "===== HARNESS TYPES ====="',
        'cat packages/harness/src/types.ts',
        'echo "" && echo "===== EXISTING OPENROUTER MODEL ADAPTER (reference) ====="',
        'cat packages/harness/src/adapter/openrouter-model-adapter.ts',
        'echo "" && echo "===== EXISTING OPENROUTER EXECUTION ADAPTER (do NOT touch) ====="',
        'sed -n "1,40p" packages/harness/src/adapter/openrouter-adapter.ts',
        'echo "" && echo "===== HARNESS INDEX (reference for export style) ====="',
        'cat packages/harness/src/index.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ── Step 1: routing type interfaces ───────────────────────────────
    .step('implement-router-types', {
      agent: 'impl',
      dependsOn: ['read-context'],
      task: `Create file: packages/harness/src/router/types.ts

Define provider-neutral interfaces for tiered routing on top of the existing harness types. Imports must use .js extensions and reference '../types.js' for HarnessUserMessage / HarnessPreparedContext / HarnessUsage / HarnessTurnInput / HarnessRuntime / HarnessResult.

Required exports:

  export type RoutingTier = 'fast' | 'harness' | 'reject';

  export interface RoutingDecision {
    tier: RoutingTier;
    reason?: string;
    metadata?: Record<string, unknown>;
  }

  export interface RouterInput {
    message: HarnessUserMessage;
    context?: HarnessPreparedContext;
    threadHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    metadata?: Record<string, unknown>;
  }

  export interface Router {
    route(input: RouterInput): Promise<RoutingDecision>;
  }

  export interface SingleShotInput {
    message: HarnessUserMessage;
    instructions: { systemPrompt: string; developerPrompt?: string };
    context?: HarnessPreparedContext;
    threadHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    metadata?: Record<string, unknown>;
  }

  export interface SingleShotResult {
    text: string;
    usage?: HarnessUsage;
    metadata?: Record<string, unknown>;
  }

  export interface SingleShotAdapter {
    generate(input: SingleShotInput): Promise<SingleShotResult>;
  }

  export interface TieredRunner {
    runTurn(input: HarnessTurnInput): Promise<TieredRunnerResult>;
  }

  export type TieredRunnerResult =
    | TieredRunnerFastResult
    | TieredRunnerHarnessResult
    | TieredRunnerRejectedResult;

  export interface TieredRunnerFastResult {
    tier: 'fast';
    routingDecision: RoutingDecision;
    text: string;
    usage?: HarnessUsage;
    singleShot: SingleShotResult;
  }

  export interface TieredRunnerHarnessResult {
    tier: 'harness';
    routingDecision: RoutingDecision;
    harnessResult: HarnessResult;
    text?: string;
  }

  export interface TieredRunnerRejectedResult {
    tier: 'rejected';
    routingDecision: RoutingDecision;
    text: string;
  }

Style:
  - ESM imports with .js suffixes (import type { HarnessUserMessage } from '../types.js')
  - Strict TS, exported types only — no implementation logic in this file
  - No comments unless the WHY is non-obvious

End with ROUTER_TYPES_IMPLEMENTED. Only create this one file.`,
      verification: {
        type: 'file_exists',
        value: 'packages/harness/src/router/types.ts',
      },
    })

    // ── Step 2: OpenRouter single-shot adapter ────────────────────────
    .step('implement-singleshot-adapter', {
      agent: 'impl',
      dependsOn: ['implement-router-types'],
      task: `Create file: packages/harness/src/router/openrouter-singleshot-adapter.ts

Implement OpenRouterSingleShotAdapter — a SingleShotAdapter (from ../router/types.js) that calls OpenRouter once, no tools, no loop. This is the cheap "one-shot reply" path used when the Router decides a request doesn't need tools.

Reference the existing packages/harness/src/adapter/openrouter-model-adapter.ts for style and conventions (fetchImpl injection, AbortController timeout, error mapping). Do NOT modify it.

Required exports:

  export interface OpenRouterSingleShotAdapterConfig {
    apiKey?: string;
    model?: string;                  // default 'anthropic/claude-haiku-4-5'
    baseUrl?: string;                // default 'https://openrouter.ai/api/v1/chat/completions'
    fetchImpl?: typeof fetch;
    timeoutMs?: number;              // default 30_000
    defaultTemperature?: number;
  }

  export class OpenRouterSingleShotAdapter implements SingleShotAdapter
  export function createOpenRouterSingleShotAdapter(config?: OpenRouterSingleShotAdapterConfig): SingleShotAdapter

generate(input) behavior:
  - Build OpenAI-style request body:
      model: config.model ?? 'anthropic/claude-haiku-4-5'
      messages: [
        { role: 'system', content: input.instructions.systemPrompt },
        ...optional second system message from developerPrompt if present,
        ...threadHistory mapped to { role, content },
        { role: 'user', content: input.message.text },
      ]
      temperature: config.defaultTemperature, only if defined
      // NO tools — this is the no-tool fast path
  - POST to baseUrl with Authorization Bearer apiKey + Content-Type application/json. AbortController with timeoutMs (default 30_000).
  - Parse response choices[0].message.content → return { text, usage }
  - Map usage from body.usage (prompt_tokens, completion_tokens, total_tokens) into HarnessUsage shape (verify field names from packages/harness/src/types.ts — likely promptTokens/completionTokens/totalTokens).
  - On missing apiKey → throw new Error('OpenRouter API key is not configured.') (consumers should pre-check; unlike the model adapter we don't return a placeholder result here because there is no HarnessModelOutput discriminated union to use).
  - On HTTP non-ok → throw new Error including response error.message and status
  - On AbortError → throw new Error('OpenRouter single-shot request timed out')
  - On missing content → throw new Error('OpenRouter response did not include assistant content')

Style: ESM imports, .js extensions. fetchImpl ?? fetch fallback for testability.

Only create this one file: packages/harness/src/router/openrouter-singleshot-adapter.ts. End with SINGLESHOT_ADAPTER_IMPLEMENTED.`,
      verification: {
        type: 'file_exists',
        value: 'packages/harness/src/router/openrouter-singleshot-adapter.ts',
      },
    })

    // ── Step 3: tests ─────────────────────────────────────────────────
    .step('write-singleshot-test', {
      agent: 'impl',
      dependsOn: ['implement-singleshot-adapter'],
      task: `Create file: packages/harness/src/router/openrouter-singleshot-adapter.test.ts

Use vitest. Test OpenRouterSingleShotAdapter via fetchImpl injection (vi.fn).

Required cases:
  1. "returns text from choices[0].message.content" — fetchImpl returns { ok:true, status:200, json:async()=>({ choices:[{ message:{ content:'hi there' }}] }) }. Assert generate(...) resolves with { text: 'hi there' }.
  2. "request body has no tools field" — assert the body sent to fetchImpl does NOT include a 'tools' key (parse fetchImpl.mock.calls[0][1].body and assert).
  3. "system prompt + threadHistory + user message map correctly" — pass instructions.systemPrompt='SYS', threadHistory of two messages, user message 'hi'. Assert messages array order is [system, history0, history1, user-message].
  4. "developerPrompt produces a second system message" — assert when present, messages[1].role === 'system'.
  5. "throws on HTTP error including status" — fetchImpl returns { ok:false, status:500, json:async()=>({ error:{ message:'boom' }}) }. Assert promise rejects with Error containing 'boom' and '500'.
  6. "throws on timeout" — fetchImpl returns a never-resolving Promise; pass timeoutMs:50. Assert promise rejects with Error matching /timed out/i.
  7. "throws when apiKey missing" — instantiate without apiKey, assert generate(...) rejects with Error containing 'API key'.
  8. "maps usage when present" — body.usage:{ prompt_tokens:10, completion_tokens:5, total_tokens:15 }. Assert returned usage matches HarnessUsage field names (verify field names from src/types.ts).
  9. "throws when message content missing" — choices[0].message has no content. Assert rejects with Error matching /content/i.

Use vitest vi.fn() for fetchImpl. Parse fetchImpl.mock.calls[0][1].body as JSON for body-shape assertions. End with SINGLESHOT_ADAPTER_TEST_WRITTEN. Only create this one file.`,
      verification: {
        type: 'file_exists',
        value: 'packages/harness/src/router/openrouter-singleshot-adapter.test.ts',
      },
    })

    // ── Step 4: test-fix-rerun loop ───────────────────────────────────
    .step('run-tests-first-pass', {
      type: 'deterministic',
      dependsOn: ['write-singleshot-test'],
      command:
        'npx vitest run packages/harness/src/router/openrouter-singleshot-adapter.test.ts 2>&1 | tail -100',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-test-failures', {
      agent: 'impl',
      dependsOn: ['run-tests-first-pass'],
      task: `Fix failures until all OpenRouterSingleShotAdapter tests pass.

Output:
{{steps.run-tests-first-pass.output}}

If green, do nothing. Else: read test + source, fix in source (unless test is wrong), re-run:
  npx vitest run packages/harness/src/router/openrouter-singleshot-adapter.test.ts
End with TESTS_FIXED.`,
      verification: { type: 'exit_code' },
    })

    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-test-failures'],
      command:
        'npx vitest run packages/harness/src/router/openrouter-singleshot-adapter.test.ts 2>&1',
      captureOutput: true,
      failOnError: true,
    })

    // ── Step 5: build check ───────────────────────────────────────────
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
      task: `Fix any tsc errors caused by these new files.

Output:
{{steps.build-check.output}}

If exit 0, do nothing. Else fix in source, re-run:
  npm run build -w @agent-assistant/harness
End with BUILD_FIXED.`,
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
