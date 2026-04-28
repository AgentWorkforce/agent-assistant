import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 4 — Three new prompt fragments.
 *
 * Why this lifts upstream:
 *   sage's harness consumer authors three near-identical prompt nudges
 *   for every system prompt to fight three failure modes seen in prod:
 *     - looping on workspace_search instead of drilling into a hit
 *     - using github_specialist enumerate to answer source-code questions
 *     - passing JSON Schema descriptions as values
 *     - asking about external repos without using the right tool
 *
 *   These are independent of sage's domain — they're general harness-model
 *   discipline. Co-locating them with the existing
 *   HALLUCINATION_PREVENTION_CLAUSES makes them a one-line import for
 *   future consumers.
 *
 * Contract:
 *
 * Add THREE new exports to packages/harness/src/tools/prompt-fragments.ts:
 *
 *   export const DRILL_IN_DISCIPLINE_CLAUSE
 *     "After a tool returns a useful hit (a path, an id, an entity), drill into THAT specific result on your next turn — read the file, fetch the entity, expand the id. Do NOT re-issue the same enumeration query hoping for different results. If the first result didn't answer the question, refine the query (different keywords, narrower scope, different tool); don't repeat it verbatim."
 *
 *   export const TOOL_INPUT_SHAPE_REMINDER_CLAUSE
 *     "Tool input schemas describe the SHAPE of the value you must provide; a description like 'A repository slug in owner/repo form' is not itself a valid value. Pass the actual value (e.g. 'AgentWorkforce/sage'), not the description text. If you don't have a real value, ask the user instead of submitting placeholder strings."
 *
 *   export const EXTERNAL_REPO_STEER_CLAUSE
 *     "When the user asks about a repository OUTSIDE their workspace (a public repo on GitHub, a competitor's project, an open-source library) use the github_public_review tool with { owner, repo } — it works against unauthenticated api.github.com and returns README + package.json + top-level layout + recent commits. Do NOT try github_specialist or workspace_search for external public repos; those only see the connected workspace."
 *
 * The exports are individual top-level constants (NOT inside an array)
 * because consumers cherry-pick which ones they want — sage may use all
 * three; another consumer may only want DRILL_IN_DISCIPLINE_CLAUSE.
 *
 * Also export a convenience array `TOOL_DISCIPLINE_CLAUSES` so the
 * default "include all three" import is a single token.
 *
 * Minor bump on @agent-assistant/harness.
 */

async function runWorkflow() {
  const result = await workflow('improve-harness-primitives-04-prompts')
    .description(
      'Add DRILL_IN_DISCIPLINE_CLAUSE, TOOL_INPUT_SHAPE_REMINDER_CLAUSE, EXTERNAL_REPO_STEER_CLAUSE to @agent-assistant/harness prompt-fragments. Plus a TOOL_DISCIPLINE_CLAUSES bundle.',
    )
    .pattern('dag')
    .channel('wf-aa-harness-04')
    .maxConcurrency(2)
    .timeout(1_800_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Architect/reviewer for prompt fragment phrasing.',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer for the prompt fragments + tests.',
      retries: 2,
    })

    .step('read-fragments', {
      type: 'deterministic',
      command:
        'cat packages/harness/src/tools/prompt-fragments.ts && echo --- && ' +
        'cat packages/harness/src/tools/prompt-fragments.test.ts && echo --- && ' +
        'grep -n "prompt-fragments\\|HALLUCINATION_PREVENTION" packages/harness/src/index.ts',
      captureOutput: true,
    })

    .step('implement', {
      agent: 'impl',
      dependsOn: ['read-fragments'],
      task: `Edit packages/harness/src/tools/prompt-fragments.ts.

Current:
{{steps.read-fragments.output}}

CONTRACT:

1. Add exactly the three exports below (verbatim — these strings are the contract):

   export const DRILL_IN_DISCIPLINE_CLAUSE =
     "After a tool returns a useful hit (a path, an id, an entity), drill into THAT specific result on your next turn — read the file, fetch the entity, expand the id. Do NOT re-issue the same enumeration query hoping for different results. If the first result didn't answer the question, refine the query (different keywords, narrower scope, different tool); don't repeat it verbatim.";

   export const TOOL_INPUT_SHAPE_REMINDER_CLAUSE =
     "Tool input schemas describe the SHAPE of the value you must provide; a description like 'A repository slug in owner/repo form' is not itself a valid value. Pass the actual value (e.g. 'AgentWorkforce/sage'), not the description text. If you don't have a real value, ask the user instead of submitting placeholder strings.";

   export const EXTERNAL_REPO_STEER_CLAUSE =
     "When the user asks about a repository OUTSIDE their workspace (a public repo on GitHub, a competitor's project, an open-source library) use the github_public_review tool with { owner, repo } — it works against unauthenticated api.github.com and returns README + package.json + top-level layout + recent commits. Do NOT try github_specialist or workspace_search for external public repos; those only see the connected workspace.";

2. Add a convenience bundle:

   export const TOOL_DISCIPLINE_CLAUSES = [
     DRILL_IN_DISCIPLINE_CLAUSE,
     TOOL_INPUT_SHAPE_REMINDER_CLAUSE,
     EXTERNAL_REPO_STEER_CLAUSE,
   ] as const;

3. Re-export everything new from packages/harness/src/index.ts (next to wherever HALLUCINATION_PREVENTION_CLAUSES is re-exported — keep it tidy).

4. Bump packages/harness/package.json version: minor bump.

Edit ONLY:
- packages/harness/src/tools/prompt-fragments.ts
- packages/harness/src/index.ts (re-exports if not already wildcarded)
- packages/harness/package.json (version bump)`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-impl', {
      type: 'deterministic',
      dependsOn: ['implement'],
      command:
        'grep -q "DRILL_IN_DISCIPLINE_CLAUSE" packages/harness/src/tools/prompt-fragments.ts && ' +
        'grep -q "TOOL_INPUT_SHAPE_REMINDER_CLAUSE" packages/harness/src/tools/prompt-fragments.ts && ' +
        'grep -q "EXTERNAL_REPO_STEER_CLAUSE" packages/harness/src/tools/prompt-fragments.ts && ' +
        'grep -q "TOOL_DISCIPLINE_CLAUSES" packages/harness/src/tools/prompt-fragments.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-tests', {
      agent: 'impl',
      dependsOn: ['verify-impl'],
      task: `Extend packages/harness/src/tools/prompt-fragments.test.ts (vitest):

1. Each of DRILL_IN_DISCIPLINE_CLAUSE, TOOL_INPUT_SHAPE_REMINDER_CLAUSE, EXTERNAL_REPO_STEER_CLAUSE is a non-empty string >= 80 chars.
2. DRILL_IN_DISCIPLINE_CLAUSE mentions "drill" and "enumeration" or "re-issue" — assert key terms are present.
3. TOOL_INPUT_SHAPE_REMINDER_CLAUSE mentions "schema" and "description" — assert key terms.
4. EXTERNAL_REPO_STEER_CLAUSE mentions "github_public_review" exactly once and mentions "owner" and "repo".
5. TOOL_DISCIPLINE_CLAUSES is a 3-element readonly array containing all three constants in order: DRILL_IN, INPUT_SHAPE, EXTERNAL_REPO.
6. None of the three new clauses appear in HALLUCINATION_PREVENTION_CLAUSES (they're a separate concern: discipline vs honesty).`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })

    .step('run-tests', {
      type: 'deterministic',
      dependsOn: ['write-tests'],
      command: 'npx vitest run packages/harness/src/tools/prompt-fragments 2>&1 | tail -50',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-tests', {
      agent: 'impl',
      dependsOn: ['run-tests'],
      task: `Fix any failures from:
{{steps.run-tests.output}}
If green, no-op. Re-run: npx vitest run packages/harness/src/tools/prompt-fragments`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-tests'],
      command: 'npx vitest run packages/harness/src/tools/prompt-fragments 2>&1 | tail -30',
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck', {
      type: 'deterministic',
      dependsOn: ['run-tests-final'],
      command: 'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-review', {
      agent: 'lead',
      dependsOn: ['typecheck'],
      task: `Review via: git diff packages/harness/

Verify:
1. The three clauses match the contract phrasing in this sub's JSDoc verbatim.
2. EXTERNAL_REPO_STEER_CLAUSE references the github_public_review tool name (the same name added in Sub 3).
3. TOOL_DISCIPLINE_CLAUSES is readonly (\`as const\` suffix).
4. Re-exports from index.ts are present.
5. Version bump is minor.
6. Existing HALLUCINATION_PREVENTION_CLAUSES export shape unchanged.

Edit files directly to fix. Re-run npx vitest run packages/harness/src/tools/prompt-fragments + cd packages/harness && npx tsc --noEmit.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('post-review-final', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/harness/src/tools/prompt-fragments 2>&1 | tail -20 && echo --- && ' +
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
