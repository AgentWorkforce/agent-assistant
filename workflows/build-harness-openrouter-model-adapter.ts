import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('build-harness-openrouter-model-adapter')
    .description(
      'Implement OpenRouterModelAdapter (HarnessModelAdapter with tool-call support) plus its vitest suite. Leaves changes uncommitted; integration workflow handles wiring, version bump, and PR.',
    )
    .pattern('dag')
    .channel('wf-build-openrouter-model-adapter')
    .maxConcurrency(2)
    .timeout(1_800_000)

    .agent('impl', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the OpenRouter HarnessModelAdapter and its vitest suite. Reads contract types from packages/harness/src/types.ts.',
      retries: 2,
    })

    .step('read-context', {
      type: 'deterministic',
      command: [
        'echo "===== HARNESS TYPES ====="',
        'cat packages/harness/src/types.ts',
        'echo "" && echo "===== EXISTING OPENROUTER EXECUTION ADAPTER (no-tool proof, do NOT modify) ====="',
        'cat packages/harness/src/adapter/openrouter-adapter.ts',
        'echo "" && echo "===== ADAPTER INDEX ====="',
        'cat packages/harness/src/adapter/index.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-adapter', {
      agent: 'impl',
      dependsOn: ['read-context'],
      task: `Create file: packages/harness/src/adapter/openrouter-model-adapter.ts

Implement OpenRouterModelAdapter — a HarnessModelAdapter (NOT the existing ExecutionAdapter). The existing OpenRouterExecutionAdapter at packages/harness/src/adapter/openrouter-adapter.ts is a no-tool proof slice; do NOT modify it.

Contract (from packages/harness/src/types.ts):

  interface HarnessModelAdapter {
    nextStep(input: HarnessModelInput): Promise<HarnessModelOutput>;
  }

  type HarnessModelOutput =
    | { type: 'final_answer'; text: string; usage?: HarnessUsage; metadata?: ... }
    | { type: 'tool_request'; calls: HarnessToolCall[]; usage?: HarnessUsage; metadata?: ... }
    | { type: 'clarification'; question: string; usage?: HarnessUsage; metadata?: ... }
    | { type: 'approval_request'; request: HarnessApprovalRequest; usage?: HarnessUsage; metadata?: ... }
    | { type: 'refusal'; reason: string; usage?: HarnessUsage; metadata?: ... }
    | { type: 'invalid'; reason: string; raw?: unknown; usage?: HarnessUsage }

  interface HarnessToolCall { id: string; name: string; input: Record<string, unknown> }

Read packages/harness/src/types.ts for HarnessModelInput, HarnessTranscriptItem, HarnessToolDefinition, and HarnessUsage exact shapes — match precisely.

Required exports:
  - export interface OpenRouterModelAdapterConfig {
      apiKey?: string;
      model?: string;                  // default 'anthropic/claude-sonnet-4-6'
      baseUrl?: string;                // default 'https://openrouter.ai/api/v1/chat/completions'
      fetchImpl?: typeof fetch;
      timeoutMs?: number;              // default 60_000
      defaultTemperature?: number;
    }
  - export class OpenRouterModelAdapter implements HarnessModelAdapter
  - export function createOpenRouterModelAdapter(config?): HarnessModelAdapter

nextStep behavior:
  - Build OpenAI-style request body: model, messages (system from instructions.systemPrompt, optional second system from developerPrompt, mapped transcript, then user message), tools mapped from availableTools (omit when empty), tool_choice 'auto' when tools present, temperature only if defined.
  - POST to baseUrl with Authorization Bearer apiKey, Content-Type application/json. AbortController with timeoutMs.
  - Response parsing:
      * choices[0].message.tool_calls non-empty → { type:'tool_request', calls: [{ id, name, input: JSON.parse(arguments) }], usage }
      * Else → { type:'final_answer', text: choices[0].message.content, usage }
  - Error mapping (return invalid, never throw):
      * Missing apiKey → { type:'invalid', reason:'OpenRouter API key is not configured.' }
      * HTTP non-ok → { type:'invalid', reason: error.message ?? \`HTTP \${status}\`, raw: body }
      * AbortError → { type:'invalid', reason:'timeout' }
      * tool_call arguments JSON parse fails → { type:'invalid', reason:'tool_call arguments are not valid JSON', raw: body }
  - Map usage from body.usage (prompt_tokens, completion_tokens, total_tokens) into HarnessUsage shape (verify field names from types.ts).

Style: match openrouter-adapter.ts. ESM imports with .js extensions. fetchImpl ?? fetch fallback.

Do NOT modify any other files. Write to disk. End with OPENROUTER_MODEL_ADAPTER_IMPLEMENTED.`,
      verification: {
        type: 'file_exists',
        value: 'packages/harness/src/adapter/openrouter-model-adapter.ts',
      },
    })

    .step('write-test', {
      agent: 'impl',
      dependsOn: ['implement-adapter'],
      task: `Create file: packages/harness/src/adapter/openrouter-model-adapter.test.ts

Use vitest. Test OpenRouterModelAdapter via fetchImpl injection (vi.fn).

Required cases:
  1. final_answer when response has no tool_calls
  2. tool_request when response has tool_calls (id, name, parsed input)
  3. availableTools forwarded as OpenAI tool descriptors (assert request body)
  4. system + developerPrompt + transcript map to messages array correctly
  5. HTTP error returns { type:'invalid', reason } with the API error message
  6. timeout via never-resolving fetchImpl returns { type:'invalid', reason:'timeout' } (timeoutMs:50)
  7. usage mapped from body.usage (prompt_tokens, completion_tokens, total_tokens)
  8. Missing apiKey returns { type:'invalid', reason: includes 'API key' }
  9. Malformed tool_call arguments returns { type:'invalid', reason: includes 'JSON' }

Parse fetchImpl.mock.calls[0][1].body as JSON for assertions. End with OPENROUTER_MODEL_ADAPTER_TEST_WRITTEN.`,
      verification: {
        type: 'file_exists',
        value: 'packages/harness/src/adapter/openrouter-model-adapter.test.ts',
      },
    })

    .step('run-tests-first-pass', {
      type: 'deterministic',
      dependsOn: ['write-test'],
      command:
        'npx vitest run packages/harness/src/adapter/openrouter-model-adapter.test.ts 2>&1 | tail -80',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-test-failures', {
      agent: 'impl',
      dependsOn: ['run-tests-first-pass'],
      task: `Fix failures until all OpenRouterModelAdapter tests pass.

Test output:
{{steps.run-tests-first-pass.output}}

If green, do nothing.
Otherwise: read the test + source, fix in source (unless test is wrong), re-run:
  npx vitest run packages/harness/src/adapter/openrouter-model-adapter.test.ts
Iterate until green. Do NOT modify openrouter-adapter.ts. End with TESTS_FIXED.`,
      verification: { type: 'exit_code' },
    })

    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-test-failures'],
      command:
        'npx vitest run packages/harness/src/adapter/openrouter-model-adapter.test.ts 2>&1',
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
      task: `Fix any tsc errors in @agent-assistant/harness from this change.

Build output:
{{steps.build-check.output}}

If exit 0, do nothing. Else fix in source (do NOT modify openrouter-adapter.ts), re-run:
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
