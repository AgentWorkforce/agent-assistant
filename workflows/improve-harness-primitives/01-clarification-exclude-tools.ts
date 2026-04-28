import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 1 — `excludeToolNames` option on `createToolEvidenceClarificationHook`.
 *
 * Why this lifts upstream:
 *   sage's slack-runner currently wraps `createToolEvidenceClarificationHook`
 *   in a local function that filters out memory_recall (and other
 *   read-only "expected to sometimes return empty" tools) before deciding
 *   whether to surface a clarification. That wrapping is a sign the
 *   upstream API is missing a join point. This sub adds it.
 *
 * Contract:
 *   - Add `excludeToolNames?: readonly string[]` to
 *     `ToolEvidenceClarificationOptions`.
 *   - In `detectToolEvidenceClarification`, after readExplicitClarification
 *     returns null, check `result.toolName`: if it's in the
 *     `excludeToolNames` set, return null early (skip the
 *     classify+question pipeline entirely).
 *   - Both implicit (classified) and "transient_provider_error" paths are
 *     suppressed by exclusion; explicit clarification metadata on the
 *     result itself is NOT suppressed (consumer-set hint always wins).
 *   - Default empty / undefined → no exclusion (zero behavior change for
 *     existing consumers).
 *   - Minor bump on @agent-assistant/harness (additive option = minor).
 */

async function runWorkflow() {
  const result = await workflow('improve-harness-primitives-01-clarification')
    .description(
      'Add excludeToolNames option to createToolEvidenceClarificationHook so consumers can exempt read-only tools (memory_recall, etc.) from the empty-result clarification path without wrapping locally.',
    )
    .pattern('dag')
    .channel('wf-aa-harness-01')
    .maxConcurrency(2)
    .timeout(2_400_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Architect/reviewer for the clarification surface.',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer for the clarification option + tests.',
      retries: 2,
    })

    .step('read-clarification', {
      type: 'deterministic',
      command:
        'cat packages/harness/src/tool-evidence-clarification.ts && echo --- && ' +
        'ls packages/harness/src/*.test.ts | xargs -I{} sh -c "echo === {} ===; cat {}" | head -300',
      captureOutput: true,
    })
    .step('read-existing-version', {
      type: 'deterministic',
      command: 'grep "\\"version\\"" packages/harness/package.json | head -1',
      captureOutput: true,
    })

    .step('implement', {
      agent: 'impl',
      dependsOn: ['read-clarification', 'read-existing-version'],
      task: `Edit packages/harness/src/tool-evidence-clarification.ts.

Current source:
{{steps.read-clarification.output}}

CONTRACT:

1. Extend \`ToolEvidenceClarificationOptions\`:
   \`\`\`ts
   export interface ToolEvidenceClarificationOptions {
     emptyResultKeys?: readonly string[];
     questionForReason?: Partial<Record<HarnessToolEvidenceClarificationReason, string>>;
     /**
      * Tool names that should NEVER trigger an evidence-based clarification.
      * Useful for read-only / "expected to sometimes be empty" tools like
      * memory_recall where empty results are normal, not a signal that the
      * model needs to ask the user a clarifying question.
      *
      * Note: explicit clarification hints on the tool result itself
      * (result.metadata.clarification or structuredOutput.clarification)
      * are still respected — the exclusion only suppresses the implicit
      * classifier path.
      */
     excludeToolNames?: readonly string[];
   }
   \`\`\`

2. In \`detectToolEvidenceClarification\`:
   - Keep readExplicitClarification first (consumer hint always wins).
   - Before calling classifyToolEvidence, check if
     \`options.excludeToolNames?.includes(result.toolName)\`. If yes,
     return null. (Use a Set internally for O(1) — but accept a readonly array as input so consumers can pass literals.)

3. \`createToolEvidenceClarificationHook\` signature unchanged. The hook
   factory just passes \`options\` through to detectToolEvidenceClarification
   as it already does.

4. Bump packages/harness/package.json version: minor bump from current to
   next minor (additive option = minor).

Edit ONLY:
- packages/harness/src/tool-evidence-clarification.ts
- packages/harness/package.json (version bump)

Do NOT touch other files.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-impl', {
      type: 'deterministic',
      dependsOn: ['implement'],
      command:
        'grep -q "excludeToolNames" packages/harness/src/tool-evidence-clarification.ts && ' +
        'grep -q "excludeToolNames" packages/harness/src/tool-evidence-clarification.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-tests', {
      agent: 'impl',
      dependsOn: ['verify-impl'],
      task: `Add tests to packages/harness/src/tool-evidence-clarification.test.ts (create if missing — there's already a tool-evidence-clarification.ts file in the package; check whether a test file exists with: ls packages/harness/src/tool-evidence-clarification* and cat any matching test file).

Required test cases (vitest):

1. Empty-result on excluded tool returns null.
   - Build a HarnessToolResult with toolName='memory_recall', status='success', structuredOutput={results: []}.
   - With { excludeToolNames: ['memory_recall'] }: detectToolEvidenceClarification returns null.
   - Without excludeToolNames: detectToolEvidenceClarification returns a non-null clarification with reason='empty_results'. (Verifies exclusion is what suppresses, not some other change.)

2. Transient error on excluded tool returns null.
   - HarnessToolResult with toolName='memory_recall', status='error', error: { code: 'rate_limited' }.
   - With { excludeToolNames: ['memory_recall'] }: returns null.
   - Without: returns reason='transient_provider_error'.

3. Ambiguous on excluded tool returns null.

4. Explicit clarification hint on excluded tool STILL surfaces.
   - HarnessToolResult with toolName='memory_recall' and metadata.clarification = { question: 'Which scope?' }.
   - With { excludeToolNames: ['memory_recall'] }: STILL returns the explicit clarification (consumer hint wins).

5. Multiple excluded names work (excludeToolNames: ['memory_recall', 'workspace_search']).

6. Empty / undefined excludeToolNames is zero behavior change (regression check).

Use vitest. Mirror existing test patterns in packages/harness/src/.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-tests', {
      type: 'deterministic',
      dependsOn: ['write-tests'],
      command:
        'test -f packages/harness/src/tool-evidence-clarification.test.ts && ' +
        'grep -Eq "excludeToolNames" packages/harness/src/tool-evidence-clarification.test.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-tests', {
      type: 'deterministic',
      dependsOn: ['verify-tests'],
      command: 'npx vitest run packages/harness/src/tool-evidence-clarification 2>&1 | tail -60',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-tests', {
      agent: 'impl',
      dependsOn: ['run-tests'],
      task: `Fix any failures from:
{{steps.run-tests.output}}
If green, no-op. Don't loosen assertions. Re-run: npx vitest run packages/harness/src/tool-evidence-clarification`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-tests'],
      command: 'npx vitest run packages/harness/src/tool-evidence-clarification 2>&1 | tail -30',
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
      task: `Review via: git diff packages/harness/src/tool-evidence-clarification.ts packages/harness/package.json packages/harness/src/tool-evidence-clarification.test.ts

Verify:
1. \`excludeToolNames\` is OPTIONAL — undefined means zero behavior change.
2. Explicit clarification hints (metadata.clarification, structuredOutput.clarification) are NOT suppressed by exclusion. Excluded only suppresses the classify path.
3. The check uses an O(1) Set lookup or short-array .includes; doesn't iterate twice.
4. JSDoc on the new option is present and explains the "explicit hint wins" carve-out.
5. Version bump is minor (additive option).
6. No drive-by edits to unrelated files.

Edit files directly to fix. Re-run npx vitest run packages/harness/src/tool-evidence-clarification + cd packages/harness && npx tsc --noEmit.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('post-review-final', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/harness/src/tool-evidence-clarification 2>&1 | tail -20 && echo --- && ' +
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
