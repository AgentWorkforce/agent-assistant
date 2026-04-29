import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 5 — Typed error code on OpenRouter invalid outputs.
 *
 * Why this lifts upstream:
 *   sage's `getUserFacingErrorMessage` switches on substring matches
 *   against the free-text `reason` field returned by the OpenRouter
 *   adapter ("more credits", "rate limit", "timeout"). String matching
 *   is fragile — provider message text shifts between releases. Every
 *   harness consumer that surfaces user-facing errors wants a stable
 *   machine-readable code.
 *
 *   The current shape is `HarnessInvalidOutput { kind: 'transient' |
 *   'provider_error' | ...; reason: string }`. `kind` is too coarse —
 *   "out of credits" vs "rate limited" are both 'provider_error' today.
 *
 * Contract:
 *
 * 1. Add a NEW optional field to packages/harness/src/types.ts on
 *    HarnessInvalidOutput:
 *
 *      /**
 *       * Provider-specific error subcode. Optional. When present,
 *       * consumers should prefer this over substring-matching `reason`.
 *       * `kind` remains the high-level class ('transient' / 'provider_error').
 *       *\/
 *      code?: HarnessInvalidOutputCode;
 *
 *    export type HarnessInvalidOutputCode =
 *      | 'credits_exhausted'
 *      | 'rate_limited'
 *      | 'timeout'
 *      | 'invalid_request'
 *      | 'context_length_exceeded'
 *      | 'model_not_found'
 *      | 'auth_failed'
 *      | 'unknown';
 *
 * 2. Update packages/harness/src/adapter/openrouter-model-adapter.ts so
 *    every invalidOutput call site populates `code`:
 *
 *    | Trigger                                              | kind             | code                        |
 *    |------------------------------------------------------|------------------|-----------------------------|
 *    | AbortError after timeout                             | transient        | timeout                     |
 *    | response.status 408/409/425/429/5xx                  | transient        | rate_limited (429)          |
 *    |                                                      |                  | timeout (408)               |
 *    |                                                      |                  | unknown (others)            |
 *    | response.status 401/403                              | provider_error   | auth_failed                 |
 *    | response.status 400                                  | provider_error   | invalid_request             |
 *    | response.status 404                                  | provider_error   | model_not_found             |
 *    | message includes 'credits' / 'afford' / 'insufficient' regardless of status | provider_error | credits_exhausted |
 *    | message includes 'context length' / 'maximum context' / 'token limit' | provider_error | context_length_exceeded |
 *    | response body !valid JSON                            | provider_error   | unknown                     |
 *    | catch-all in the try/catch fall-through              | transient        | unknown                     |
 *    | Unknown error in catch                               | transient        | unknown                     |
 *
 *    Helper: a small classifyOpenRouterError(status, message) function
 *    that returns the code. Pure, exported as INTERNAL — not from the
 *    public package surface — but factored so it's unit-testable from
 *    the adapter's spec.
 *
 *    The credits/context-length detection happens BEFORE the status-based
 *    fallback, so a 402 with "out of credits" body becomes
 *    code='credits_exhausted' (not 'unknown').
 *
 * 3. Existing `kind` and `reason` fields keep their current values for
 *    backwards compatibility. `code` is purely additive.
 *
 * 4. Re-export the `HarnessInvalidOutputCode` type from
 *    packages/harness/src/index.ts so consumers can import it.
 *
 * Minor bump on @agent-assistant/harness.
 */

async function runWorkflow() {
  const result = await workflow('improve-harness-primitives-05-error-codes')
    .description(
      'Add HarnessInvalidOutputCode + populate it from the OpenRouter adapter — stable machine-readable subcode so consumers stop substring-matching reason.',
    )
    .pattern('dag')
    .channel('wf-aa-harness-05')
    .maxConcurrency(2)
    .timeout(2_700_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Architect/reviewer for the error-classification surface.',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer for the code field + adapter wiring + tests.',
      retries: 2,
    })

    .step('read-context', {
      type: 'deterministic',
      command:
        'sed -n "130,170p" packages/harness/src/types.ts && echo --- && ' +
        'sed -n "420,640p" packages/harness/src/adapter/openrouter-model-adapter.ts && echo --- && ' +
        'cat packages/harness/src/adapter/openrouter-model-adapter.test.ts | head -120',
      captureOutput: true,
    })

    .step('implement-types', {
      agent: 'impl',
      dependsOn: ['read-context'],
      task: `Edit packages/harness/src/types.ts.

Current relevant slice:
{{steps.read-context.output}}

CONTRACT:

1. Add type alias near HarnessInvalidOutputKind:
   export type HarnessInvalidOutputCode =
     | 'credits_exhausted'
     | 'rate_limited'
     | 'timeout'
     | 'invalid_request'
     | 'context_length_exceeded'
     | 'model_not_found'
     | 'auth_failed'
     | 'unknown';

2. Add optional field to HarnessInvalidOutput:
   /**
    * Provider-specific error subcode. Optional; populated by adapters
    * (e.g. OpenRouter) so consumers can switch on a stable enum instead
    * of substring-matching the free-text \`reason\` field. \`kind\` remains
    * the high-level transient/provider_error split.
    */
   code?: HarnessInvalidOutputCode;

3. Re-export HarnessInvalidOutputCode from packages/harness/src/index.ts.

DO NOT change kind, reason, or any other field's type. The change is additive.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-types', {
      type: 'deterministic',
      dependsOn: ['implement-types'],
      command:
        'grep -q "HarnessInvalidOutputCode" packages/harness/src/types.ts && ' +
        'grep -q "HarnessInvalidOutputCode" packages/harness/src/index.ts && ' +
        'grep -q "code?: HarnessInvalidOutputCode" packages/harness/src/types.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-adapter', {
      agent: 'impl',
      dependsOn: ['verify-types'],
      task: `Edit packages/harness/src/adapter/openrouter-model-adapter.ts.

CONTRACT:

1. Add a private helper near invalidOutput():

   function classifyOpenRouterError(httpStatus: number | undefined, reason: string | undefined): HarnessInvalidOutputCode {
     const text = (reason ?? '').toLowerCase();

     // Body-content rules (run BEFORE status-based fallback)
     if (text.includes('credits') || text.includes('afford') || text.includes('insufficient')) {
       return 'credits_exhausted';
     }
     if (text.includes('context length') || text.includes('maximum context') || text.includes('token limit')) {
       return 'context_length_exceeded';
     }
     if (text === 'timeout') return 'timeout';

     // Status-based fallback
     switch (httpStatus) {
       case 400: return 'invalid_request';
       case 401:
       case 403: return 'auth_failed';
       case 404: return 'model_not_found';
       case 408: return 'timeout';
       case 429: return 'rate_limited';
       default:
         if (httpStatus !== undefined && httpStatus >= 500) return 'unknown';
         return 'unknown';
     }
   }

2. Wherever invalidOutput(...) is called, attach a code via the options bag:
   - HTTP non-OK: code = classifyOpenRouterError(response.status, body?.error?.message)
   - JSON-parse fail (response.ok but body undefined): code = 'unknown'
   - AbortError catch: code = 'timeout'
   - Generic catch fall-through: code = classifyOpenRouterError(undefined, error.message) (lets credits/context-length matches in thrown errors still classify)

   To keep changes minimal: extend invalidOutput's options-bag-merging to forward code, OR pass code in the options object that already gets spread into the return.

3. Do NOT change kind values (transient vs provider_error). Only add code.

4. Bump packages/harness/package.json minor version.

Re-read this sub's source for the exact mapping table:
workflows/improve-harness-primitives/05-openrouter-error-codes.ts

Edit ONLY:
- packages/harness/src/adapter/openrouter-model-adapter.ts
- packages/harness/package.json (version bump)`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-adapter', {
      type: 'deterministic',
      dependsOn: ['implement-adapter'],
      command:
        'grep -q "classifyOpenRouterError" packages/harness/src/adapter/openrouter-model-adapter.ts && ' +
        'grep -q "credits_exhausted" packages/harness/src/adapter/openrouter-model-adapter.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-tests', {
      agent: 'impl',
      dependsOn: ['verify-adapter'],
      task: `Add packages/harness/src/adapter/openrouter-model-adapter.error-codes.test.ts (vitest).

Required test cases (use a fetchImpl mock returning Response-like objects):

1. 402 with body.error.message containing "more credits" → output.kind='provider_error', output.code='credits_exhausted'.
2. 429 status → output.kind='transient', output.code='rate_limited'.
3. 408 → output.kind='transient', output.code='timeout'.
4. 401 → output.kind='provider_error', output.code='auth_failed'.
5. 403 → output.kind='provider_error', output.code='auth_failed'.
6. 400 → output.kind='provider_error', output.code='invalid_request'.
7. 404 → output.kind='provider_error', output.code='model_not_found'.
8. 500 → output.kind='transient', output.code='unknown'.
9. Body-message containing "context length" → code='context_length_exceeded' regardless of status.
10. Body-message containing "insufficient" → code='credits_exhausted'.
11. AbortError (simulated by signal abort) → code='timeout'.
12. Generic thrown error with message "openrouter says you need more credits" → code='credits_exhausted'.
13. response.ok but malformed JSON → code='unknown'.
14. Existing kind values are unchanged: 429 still kind='transient', 402 with credits text still kind='provider_error'.
15. The classify helper itself is exercised: a unit test pasted in-line that calls classifyOpenRouterError(429, 'too many requests') → 'rate_limited'.

Look at packages/harness/src/adapter/openrouter-model-adapter.test.ts for the existing test scaffold (request mocking pattern). Add the new cases there OR in a sibling file — your call, but tests must exercise the public OpenRouterModelAdapter.nextStep(...) path, not just call classifyOpenRouterError directly (the classify-only test in #15 is fine to also include).`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })

    .step('run-tests', {
      type: 'deterministic',
      dependsOn: ['write-tests'],
      command: 'npx vitest run packages/harness/src/adapter/openrouter-model-adapter 2>&1 | tail -100',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-tests', {
      agent: 'impl',
      dependsOn: ['run-tests'],
      task: `Fix any failures from:
{{steps.run-tests.output}}
If green, no-op. Don't loosen assertions. Re-run: npx vitest run packages/harness/src/adapter/openrouter-model-adapter`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-tests'],
      command: 'npx vitest run packages/harness/src/adapter/openrouter-model-adapter 2>&1 | tail -50',
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck', {
      type: 'deterministic',
      dependsOn: ['run-tests-final'],
      command: 'cd packages/harness && npx tsc --noEmit 2>&1 | tail -30; echo EXIT=$?',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-typecheck', {
      agent: 'impl',
      dependsOn: ['typecheck'],
      task: `If errors, fix. If EXIT=0, no-op.
{{steps.typecheck.output}}
Re-run: cd packages/harness && npx tsc --noEmit`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('typecheck-final', {
      type: 'deterministic',
      dependsOn: ['fix-typecheck'],
      command: 'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-review', {
      agent: 'lead',
      dependsOn: ['typecheck-final'],
      task: `Review via: git diff packages/harness/src/types.ts packages/harness/src/index.ts packages/harness/src/adapter/openrouter-model-adapter.ts

Verify:
1. \`code\` is OPTIONAL on HarnessInvalidOutput. Existing consumers that don't read it are unaffected.
2. \`kind\` values are unchanged. The OpenRouter adapter still returns 'transient' for 429 and 'provider_error' for 4xx like 401/403/400/404. Only \`code\` is new.
3. Body-message classification (credits / context-length) runs BEFORE status fallback so a 402 with "out of credits" message classifies as credits_exhausted, not 'invalid_request' / 'unknown'.
4. AbortError → timeout (not 'unknown').
5. Generic catch fall-through still classifies via message text — a thrown Error("more credits") becomes credits_exhausted.
6. The adapter's existing public API (createOpenRouterModelAdapter, OpenRouterModelAdapter, OpenRouterModelAdapterConfig) is unchanged.
7. classifyOpenRouterError is internal — NOT re-exported from packages/harness/src/index.ts.
8. Version bump is minor.

Edit files directly to fix. Re-run npx vitest run packages/harness/src/adapter + cd packages/harness && npx tsc --noEmit.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('post-review-final', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/harness/src/adapter/openrouter-model-adapter 2>&1 | tail -30 && echo --- && ' +
        'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
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
