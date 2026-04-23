/**
 * proactive-signals 04: GitHub webhook -> ProactiveSignal classifier
 *
 * Pure classifier in @agent-assistant/surfaces. Takes a raw GitHub webhook
 * payload + X-GitHub-Event header name and returns a ProactiveSignal partial
 * for the proactive inbox, or null.
 *
 * Files:
 *   packages/surfaces/src/github-signal-source.ts        — NEW
 *   packages/surfaces/src/github-signal-source.test.ts   — NEW
 *   packages/surfaces/src/index.ts                       — UPDATE: barrel re-export
 *
 * Contract:
 *
 *   export function classifyGithubProactiveSignal(
 *     eventName: string,         // X-GitHub-Event header value, e.g. 'pull_request'
 *     payload: unknown,          // parsed webhook JSON body
 *     workspaceId: string,
 *   ): Pick<ProactiveSignal, 'kind' | 'workspaceId' | 'subjectId' | 'payload'> | null;
 *
 * Mapping (v1, conservative — high-signal events only):
 *   eventName === 'pull_request' AND payload.action === 'closed'
 *     -> kind: 'github.pr_closed'
 *        subjectId = String(payload.pull_request.number)
 *        payload = { repo: payload.repository.full_name, merged: payload.pull_request.merged, url: payload.pull_request.html_url }
 *
 *   eventName === 'pull_request_review' AND payload.action === 'submitted'
 *     -> kind: 'github.pr_review_submitted'
 *        subjectId = String(payload.pull_request.number)
 *        payload = { repo, state: payload.review.state, reviewer: payload.review.user.login, url: payload.review.html_url }
 *
 * Everything else -> null. Malformed payloads -> null (never throw).
 *
 * Depends on @agent-assistant/proactive dep added in 03.
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('aa-proactive-signals-04-github-signals')
    .description('Classifier: GitHub PR webhooks -> ProactiveSignal partial, for @agent-assistant/surfaces')
    .pattern('dag')
    .channel('wf-aa-proactive-signals-04')
    .maxConcurrency(3)
    .timeout(1_800_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'lead',
      role: 'Lead — pins classifier contract, confirms safe payload extraction, reviews impl',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer — writes github-signal-source.ts and tests',
      retries: 2,
    })

    .step('read-surfaces-index', {
      type: 'deterministic',
      command: 'sed -n "1,80p" packages/surfaces/src/index.ts',
      captureOutput: true,
      failOnError: true,
    })

    .step('plan', {
      agent: 'lead',
      dependsOn: ['read-surfaces-index'],
      task: `Post a short plan confirming the github-signal-source classifier (see workflow header).

Key impl notes:
- v1 supports exactly two eventName values: 'pull_request' and 'pull_request_review'
- Only payload.action in {'closed', 'submitted'} triggers; all other actions return null
- Use helper readString(value: unknown) and readObject(value: unknown) for defensive access (match the slack-bot-channels style)
- Never throw on malformed input — return null
- Import type { ProactiveSignal } from '@agent-assistant/proactive' (TYPE-ONLY)
- Add barrel export: export { classifyGithubProactiveSignal } from './github-signal-source.js';

Current surfaces index:
{{steps.read-surfaces-index.output}}

Keep plan to 8 bullets max.`,
    })

    .step('impl-classifier', {
      agent: 'impl',
      dependsOn: ['plan'],
      task: `Create NEW file packages/surfaces/src/github-signal-source.ts implementing the contract from the workflow header. Type-only import of ProactiveSignal from '@agent-assistant/proactive'. Defensive parsing — every field behind a typeof guard. Never throw. Match tsconfig strictness. Write to disk.`,
      verification: { type: 'file_exists', value: 'packages/surfaces/src/github-signal-source.ts' },
      retries: 2,
    })

    .step('impl-classifier-test', {
      agent: 'impl',
      dependsOn: ['impl-classifier'],
      task: `Create NEW file packages/surfaces/src/github-signal-source.test.ts. Vitest tests:
  1. pull_request closed + merged=true -> { kind: 'github.pr_closed', subjectId: '42', payload: { repo: 'org/r', merged: true, url: '...' } }
  2. pull_request closed + merged=false -> same shape with merged: false
  3. pull_request opened -> null (wrong action)
  4. pull_request_review submitted with state='approved' -> { kind: 'github.pr_review_submitted', subjectId: '42', payload: { repo, state: 'approved', reviewer: 'u1', url } }
  5. pull_request_review edited -> null
  6. Unknown eventName (e.g. 'push') -> null
  7. Missing payload.pull_request -> null
  8. Non-object payload -> null
  9. Missing payload.repository.full_name -> repo field absent or null (depending on design — match whatever the impl does, document in test)
Write to disk.`,
      verification: { type: 'file_exists', value: 'packages/surfaces/src/github-signal-source.test.ts' },
      retries: 2,
    })

    .step('impl-index-export', {
      agent: 'impl',
      dependsOn: ['impl-classifier'],
      task: `Edit ONLY packages/surfaces/src/index.ts. Append near the other exports:

  export { classifyGithubProactiveSignal } from './github-signal-source.js';

Do not touch any other file.`,
      verification: { type: 'exit_code' },
      retries: 2,
    })
    .step('verify-index', {
      type: 'deterministic',
      dependsOn: ['impl-index-export'],
      command: 'grep -q "github-signal-source" packages/surfaces/src/index.ts && echo OK',
      failOnError: true,
    })

    .step('build', {
      type: 'deterministic',
      dependsOn: ['impl-classifier-test', 'verify-index'],
      command: 'cd packages/surfaces && npm run build 2>&1 | tail -20 && echo BUILD_OK',
      failOnError: true,
    })
    .step('unit-tests', {
      type: 'deterministic',
      dependsOn: ['build'],
      command: 'cd packages/surfaces && npx vitest run github-signal-source 2>&1 | tail -30',
      failOnError: true,
    })

    .onError('fail-fast')
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
  if (result.status !== 'completed') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
