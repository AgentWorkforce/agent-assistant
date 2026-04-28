import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 4 — Loosen the redundant-tool-loop detector + add large-output
 * advisory to workspace tool results.
 *
 * Captured live (sage prod turn slack-1777335112549-8npk7r): the model
 * called workspace_list /github/repos/AgentWorkforce/relay depth=2 five
 * times back-to-back with identical args, interleaving one
 * workspace_search at iteration 6 to dodge the existing redundant-loop
 * detector (which only trips on 3 CONSECUTIVE identical results). Hit
 * max_iterations_reached on iter 9. Slack reply was the user-facing
 * fallback "I could not complete that request right now."
 *
 * Two upstream changes:
 *
 * A. @agent-assistant/harness redundant-loop detector — change from
 *    "last 3 consecutive identical" to "M of last K identical, regardless
 *    of order, by (toolName, outputHash)". Defaults M=4, K=6 — tunable
 *    via createHarness limits config. Backwards compatible: the looser
 *    detector subsumes the strict one.
 *
 * B. @agent-assistant/harness workspace-tool-registry — when a tool's
 *    output exceeds 5KB, append a structured `_advisory: { kind:
 *    'large_output', hint: 'drill in via workspace_read on a specific
 *    file or workspace_list on a deeper subpath; do not re-call with
 *    identical args' }` field on the OUTER object (alongside the items
 *    array). This reaches every consumer, not just sage.
 *
 * Bumps @agent-assistant/harness minor (additive change).
 */

async function runWorkflow() {
  const result = await workflow('improve-memory-primitives-04-detector-and-advisory')
    .description(
      'Loosen the harness redundant-tool-loop detector and add a large-output advisory to workspace tool results so future regressions trip as redundant_tool_loop instead of max_iterations_reached.',
    )
    .pattern('dag')
    .channel('wf-aa-memory-04')
    .maxConcurrency(2)
    .timeout(2_700_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Architect/reviewer for the harness detector + advisory shape.',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer for harness.ts detector tuning + workspace-tool-registry advisory + tests.',
      retries: 2,
    })

    // Read context
    .step('read-harness', {
      type: 'deterministic',
      command:
        'cat packages/harness/src/harness.ts | head -250 && echo --- && ' +
        'cat packages/harness/src/types.ts | head -150',
      captureOutput: true,
    })
    .step('read-workspace-tool-registry', {
      type: 'deterministic',
      command: 'cat packages/harness/src/tools/workspace-tool-registry.ts',
      captureOutput: true,
    })
    .step('read-existing-detector-test', {
      type: 'deterministic',
      command:
        'grep -nE "redundant_tool_loop|outputHash|lastThree" packages/harness/src/harness.ts && echo --- && ' +
        'grep -lE "redundant_tool_loop|outputHash" packages/harness/src/*.test.ts 2>/dev/null',
      captureOutput: true,
    })

    // ── A. Loosen the detector ────────────────────────────────────
    .step('implement-detector', {
      agent: 'impl',
      dependsOn: ['read-harness', 'read-existing-detector-test'],
      task: `Edit packages/harness/src/harness.ts. The current detector lives near \`buildLimitResult(..., 'redundant_tool_loop')\` and uses a \`lastThree\` window:
{{steps.read-existing-detector-test.output}}

Reference (search for 'lastThree' to find the exact block):
{{steps.read-harness.output}}

CONTRACT:

1. Replace the strict "last 3 consecutive identical" check with a windowed "M of last K identical, regardless of order" check:
   - Keep tracking each tool result's \`{ toolName, outputHash }\` in a per-turn ring buffer of size K.
   - When the buffer has K entries (or more), count occurrences by \`\${toolName}::\${outputHash}\` and trip if ANY signature appears >= M times in that window.
   - Defaults: M=4, K=6.

2. Make M and K configurable via createHarness limits:
     limits: {
       maxIterations,
       maxToolCalls,
       maxElapsedMs,
       redundantToolLoopThreshold?: { matches: number; window: number };
     }
   - Default value when unset: \`{ matches: 4, window: 6 }\`.
   - Validate: matches must be >= 2 AND <= window AND window must be >= matches AND <= 20. Invalid values fall back to defaults with a single console.warn.

3. Keep the trip behavior the same: \`buildLimitResult(config, input, state, 'redundant_tool_loop')\` and \`outcome === 'failed'\` for that stop reason.

4. Existing tests that assert the strict "3 consecutive identical" trip MUST still pass — the looser detector subsumes the strict pattern (3 consecutive identical is also 3 of last 3, which is 3+ of any window K >= 3 with M <= 3). If a test relied on a NON-trip with 3 consecutive non-matching but 4 of 6 matching, that's the regression we're fixing — update the test to assert the trip.

5. Export the threshold type:
     export interface RedundantToolLoopThreshold {
       matches: number;
       window: number;
     }

Only edit packages/harness/src/harness.ts (and types.ts if the threshold type lives there).`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-detector-impl', {
      type: 'deterministic',
      dependsOn: ['implement-detector'],
      command:
        'if git diff --quiet packages/harness/src/harness.ts; then echo "NOT MODIFIED"; exit 1; fi; ' +
        'grep -Eq "redundantToolLoopThreshold|RedundantToolLoopThreshold|matches.*window" packages/harness/src/harness.ts packages/harness/src/types.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    // ── B. Large-output advisory in workspace-tool-registry ───────
    .step('implement-advisory', {
      agent: 'impl',
      dependsOn: ['read-workspace-tool-registry', 'verify-detector-impl'],
      task: `Edit packages/harness/src/tools/workspace-tool-registry.ts.

Current contents:
{{steps.read-workspace-tool-registry.output}}

CONTRACT:

1. Add a module-level constant: \`LARGE_OUTPUT_ADVISORY_BYTES = 5 * 1024\` (5 KB).

2. After stringifyArrayOutput / stringifyObjectOutput produces the final JSON string for a tool result, BEFORE returning successResult: if byteLength(output) > LARGE_OUTPUT_ADVISORY_BYTES AND the tool name is workspace_list OR workspace_search, wrap the output:
   - Parse the existing output as JSON
   - If it's an array of items (workspace_list / workspace_search): wrap as
       { items: <originalArray>, _advisory: { kind: 'large_output', hint: 'This result is large. Do NOT re-call this tool with identical args (output will be identical). Drill in via workspace_read on a specific file from the listing (package.json, README.md, CHANGELOG.md, tsconfig.json) or workspace_list on a deeper subpath.' } }
   - If it's a single object (workspace_read_json): leave it; the JSON file's structure is the consumer's concern, not ours.
   - If it's raw text (workspace_read returning content): leave it; raw text doesn't have a place for a JSON advisory field.

3. Re-stringify the wrapped object via stringifyOutput. The truncation cap MAX_OUTPUT_BYTES (50KB) still applies.

4. Add an export so consumers can read the constant:
     export const WORKSPACE_LARGE_OUTPUT_ADVISORY_BYTES = LARGE_OUTPUT_ADVISORY_BYTES;

5. Backwards compatibility: small results (under 5 KB) are unchanged — same array shape consumers expect today. Only large results gain the wrapping object. Document this in a code comment so a consumer's runtime check on \`Array.isArray(parsed)\` knows to also handle \`parsed.items\`.

Only edit packages/harness/src/tools/workspace-tool-registry.ts.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-advisory-impl', {
      type: 'deterministic',
      dependsOn: ['implement-advisory'],
      command:
        'if git diff --quiet packages/harness/src/tools/workspace-tool-registry.ts; then echo "NOT MODIFIED"; exit 1; fi; ' +
        'grep -Eq "LARGE_OUTPUT_ADVISORY_BYTES|_advisory|large_output" packages/harness/src/tools/workspace-tool-registry.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    // ── Tests ─────────────────────────────────────────────────────
    .step('write-tests', {
      agent: 'impl',
      dependsOn: ['verify-advisory-impl'],
      task: `Add / extend tests:

1. packages/harness/src/harness.test.ts (extend) — redundant-loop detector:
   a) "trips with default 4 of last 6 when model interleaves":
      - Stub model to emit the sage prod sequence: list_A, list_A, search_A, list_A, list_A, list_A
      - Assert turn outcome=failed, stopReason='redundant_tool_loop'
      - This is the regression-under-fix from sage turn slack-1777335112549-8npk7r
   b) "still trips on 3 consecutive identical when threshold matches=3 window=3 (strict mode)":
      - Pass redundantToolLoopThreshold: { matches: 3, window: 3 }
      - Stub model to emit 3 identical calls
      - Assert trip
   c) "does NOT trip on 4 of last 6 when threshold matches=5 window=6":
      - Pass threshold { matches: 5, window: 6 }
      - Stub the same interleaved sequence; asserts no trip until 5 identical
   d) "validates threshold inputs and falls back to defaults on invalid values":
      - matches=1 (< 2) → falls back, single warn
      - matches > window → falls back
      - window > 20 → falls back

2. packages/harness/src/tools/workspace-tool-registry.test.ts (extend) — large-output advisory:
   a) "small workspace_list output passes through as plain array (no advisory)":
      - Stub provider returning a tiny listing
      - Assert parsed output is Array.isArray, no _advisory key
   b) "large workspace_list output is wrapped with _advisory":
      - Stub provider returning ~6 KB of entries
      - Assert parsed output has shape { items: [...], _advisory: { kind: 'large_output', hint: <string with 'drill in' or 'do not re-call'> } }
      - Assert items.length matches the original
   c) "workspace_search large output also wrapped":
      - Same as (b) but via workspace_search
   d) "workspace_read raw text is NOT wrapped":
      - Stub a 6KB raw text read
      - Assert output is raw text (no _advisory wrapping)
   e) "workspace_read_json large output is NOT wrapped":
      - Stub returning a large JSON-parseable object
      - Assert output is the original WorkspaceReadJsonOutput shape (no _advisory)

Use vitest. Mirror existing patterns in packages/harness/src/.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-tests', {
      type: 'deterministic',
      dependsOn: ['write-tests'],
      command:
        'grep -cE "redundantToolLoopThreshold|4 of last 6|interleaves|large_output|_advisory" ' +
        'packages/harness/src/harness.test.ts ' +
        'packages/harness/src/tools/workspace-tool-registry.test.ts ' +
        '2>/dev/null && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-tests', {
      type: 'deterministic',
      dependsOn: ['verify-tests'],
      command: 'npx vitest run packages/harness/ 2>&1 | tail -100',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-tests', {
      agent: 'impl',
      dependsOn: ['run-tests'],
      task: `Fix any failures:
{{steps.run-tests.output}}
If green, no-op. Don't loosen the new assertions. The most likely cause of failures is an EXISTING test that asserted the strict "3 consecutive identical" behavior on a sequence that ALSO matches "M of K identical, regardless of order" — those tests still pass because the looser detector subsumes the strict one. If a test asserts NON-trip on a sequence that the new detector trips on, that test is testing the bug — update it to assert the trip.
Re-run: npx vitest run packages/harness/`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-tests'],
      command: 'npx vitest run packages/harness/ 2>&1 | tail -50',
      captureOutput: true,
      failOnError: true,
    })

    // ── Bump harness package version ──────────────────────────────
    .step('bump-version', {
      agent: 'impl',
      dependsOn: ['run-tests-final'],
      task: `Bump packages/harness/package.json minor (e.g. if Sub 2 already bumped to 0.7.0, this Sub bumps to 0.7.1 — patch is fine since it adds optional new exports plus the looser detector behavior. Or bump to 0.8.0 if you treat detector behavior change as minor. Pick whichever matches the repo's prior cadence; the previous bumps in this session went minor.).

Print the new version when done.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('verify-bump', {
      type: 'deterministic',
      dependsOn: ['bump-version'],
      command:
        'if git diff --quiet packages/harness/package.json; then echo "NOT BUMPED"; exit 1; fi; ' +
        'grep "\\"version\\"" packages/harness/package.json | head -1',
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck-final', {
      type: 'deterministic',
      dependsOn: ['verify-bump'],
      command: 'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-review', {
      agent: 'lead',
      dependsOn: ['typecheck-final'],
      task: `Review via: git diff packages/harness/

Verify:
1. Detector tuning: the new "M of last K identical" detector subsumes the strict "3 consecutive identical" — every sequence that tripped before still trips. Confirm by looking at the test suite — no existing trip-asserting test failed.
2. The detector's ring buffer is bounded — it doesn't grow unboundedly across iterations. K is the max size.
3. Threshold validation has a sensible default fallback path (matches=4, window=6) and a single console.warn on invalid inputs.
4. Large-output advisory wrapping changes the JSON shape on the wire for outputs > 5 KB. Document this in workspace-tool-registry.ts so consumers know to handle parsed.items in addition to bare arrays.
5. Tests cover the EXACT regression sequence from sage turn slack-1777335112549-8npk7r (list_A x2, search_A, list_A x3, with the search interleave that dodged the strict detector).
6. Version bump is appropriate — minor for behavior change OR patch for additive (your call; document in commit message).

Edit files to fix. Re-run npx vitest run packages/harness/ + cd packages/harness && npx tsc --noEmit.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('post-review-final', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/harness/ 2>&1 | tail -30 && echo --- && ' +
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
