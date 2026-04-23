/**
 * proactive-signals 03: Slack presence/status -> ProactiveSignal classifier
 *
 * Pure classifier in @agent-assistant/surfaces. Takes a raw Slack event
 * payload and returns a ProactiveSignal (shaped by @agent-assistant/proactive)
 * or null when the event is not proactive-relevant.
 *
 * Files:
 *   packages/surfaces/src/slack-presence-signal.ts        — NEW
 *   packages/surfaces/src/slack-presence-signal.test.ts   — NEW
 *   packages/surfaces/src/index.ts                        — UPDATE: barrel re-export
 *   packages/surfaces/package.json                        — UPDATE: add @agent-assistant/proactive dep
 *
 * Contract:
 *
 *   // Takes a Slack Event API envelope payload (the { type, team_id, event, ... } shape)
 *   // and returns a ProactiveSignal when the inner event is presence_change or
 *   // user_status_changed. Returns null for anything else.
 *   export function classifySlackPresenceSignal(
 *     payload: unknown,
 *     workspaceId: string,
 *   ): Pick<ProactiveSignal, 'kind' | 'workspaceId' | 'subjectId' | 'payload'> | null;
 *
 * The returned object is NOT a full ProactiveSignal — it's the shape you hand to
 * recordSignal(). id/receivedAt/expiresAt are filled in by recordSignal itself.
 *
 * Mapping:
 *   event.type === 'presence_change'     -> kind: 'slack.presence'
 *     subjectId = event.user (string); payload = { presence: event.presence }
 *   event.type === 'user_status_changed' -> kind: 'slack.status'
 *     subjectId = event.user.id (from nested user object); payload = { status_text, status_emoji }
 *
 * Any malformed shape -> null (never throw).
 *
 * NOTE on dependency direction: @agent-assistant/surfaces already publishes types used
 * by @agent-assistant/proactive (BotChannel). This workflow adds the reverse dep for the
 * ProactiveSignal type. The result is a cycle at package-dep level but TypeScript
 * handles it fine (both packages publish to dist/ via tsc, no circular runtime import
 * since these are type-only imports). If the cycle bothers us later, we can promote
 * shared types to @agent-assistant/core.
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('aa-proactive-signals-03-slack-presence')
    .description('Classifier: Slack presence/status events -> ProactiveSignal partial, for @agent-assistant/surfaces')
    .pattern('dag')
    .channel('wf-aa-proactive-signals-03')
    .maxConcurrency(3)
    .timeout(1_800_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'lead',
      role: 'Lead — pins classifier contract, confirms malformed-payload handling, reviews impl',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer — writes slack-presence-signal.ts and tests',
      retries: 2,
    })

    .step('read-surfaces-index', {
      type: 'deterministic',
      command: 'sed -n "1,80p" packages/surfaces/src/index.ts',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-slack-ingress-pattern', {
      type: 'deterministic',
      command: 'sed -n "1,80p" packages/surfaces/src/slack-ingress.ts',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-surfaces-pkg', {
      type: 'deterministic',
      command: 'cat packages/surfaces/package.json',
      captureOutput: true,
      failOnError: true,
    })

    .step('plan', {
      agent: 'lead',
      dependsOn: ['read-surfaces-index', 'read-slack-ingress-pattern', 'read-surfaces-pkg'],
      task: `Post a short plan confirming the slack-presence-signal classifier contract (see workflow header).

Key points for impl:
- Defensive parsing: every field access behind a typeof check. Never throw on malformed input.
- The envelope shape is { type: 'event_callback', team_id?, event: { type, ... } } — match slack-ingress style.
- Return null for any event.type that's not presence_change or user_status_changed.
- Add "@agent-assistant/proactive": ">=0.1.0" to packages/surfaces/package.json dependencies.
- Barrel exports to add to packages/surfaces/src/index.ts:
    export { classifySlackPresenceSignal } from './slack-presence-signal.js';

Current surfaces index:
{{steps.read-surfaces-index.output}}

slack-ingress pattern reference:
{{steps.read-slack-ingress-pattern.output}}

surfaces package.json:
{{steps.read-surfaces-pkg.output}}

Keep plan to 8 bullets max.`,
    })

    .step('impl-pkg-dep', {
      agent: 'impl',
      dependsOn: ['plan'],
      task: `Edit ONLY packages/surfaces/package.json. Add "@agent-assistant/proactive": ">=0.1.0" to dependencies, keeping the dependency list alphabetically sorted. Do not touch any other file.`,
      verification: { type: 'exit_code' },
      retries: 2,
    })
    .step('install-after-dep', {
      type: 'deterministic',
      dependsOn: ['impl-pkg-dep'],
      command: 'npm install --workspaces=false --include-workspace-root=false 2>&1 | tail -5; npm install 2>&1 | tail -5 && echo INSTALL_OK',
      failOnError: false,
    })

    .step('impl-classifier', {
      agent: 'impl',
      dependsOn: ['impl-pkg-dep'],
      task: `Create NEW file packages/surfaces/src/slack-presence-signal.ts implementing classifySlackPresenceSignal as defined in the workflow header.

Import type { ProactiveSignal } from '@agent-assistant/proactive' — TYPE-ONLY import to keep runtime cycle-free. Return shape is Pick<ProactiveSignal, 'kind' | 'workspaceId' | 'subjectId' | 'payload'>.

Match tsconfig strictness. Never throw. Write to disk. Do not create any other file.`,
      verification: { type: 'file_exists', value: 'packages/surfaces/src/slack-presence-signal.ts' },
      retries: 2,
    })

    .step('impl-classifier-test', {
      agent: 'impl',
      dependsOn: ['impl-classifier'],
      task: `Create NEW file packages/surfaces/src/slack-presence-signal.test.ts. Vitest tests:
  1. presence_change with presence='away' -> { kind: 'slack.presence', workspaceId, subjectId: 'U1', payload: { presence: 'away' } }
  2. presence_change with presence='active' -> same shape with presence: 'active'
  3. user_status_changed with nested user.id='U1' and profile { status_text, status_emoji } -> { kind: 'slack.status', subjectId: 'U1', payload: { status_text, status_emoji } }
  4. Unrelated event.type (e.g. 'message') -> null
  5. Missing event object -> null
  6. event.type=presence_change without user -> null
  7. event.type=user_status_changed with malformed nested user -> null
  8. Non-object payload -> null
Write to disk.`,
      verification: { type: 'file_exists', value: 'packages/surfaces/src/slack-presence-signal.test.ts' },
      retries: 2,
    })

    .step('impl-index-export', {
      agent: 'impl',
      dependsOn: ['impl-classifier'],
      task: `Edit ONLY packages/surfaces/src/index.ts. Append near the other slack-* exports:

  export { classifySlackPresenceSignal } from './slack-presence-signal.js';

Do not touch any other file.`,
      verification: { type: 'exit_code' },
      retries: 2,
    })
    .step('verify-index', {
      type: 'deterministic',
      dependsOn: ['impl-index-export'],
      command: 'grep -q "slack-presence-signal" packages/surfaces/src/index.ts && echo OK',
      failOnError: true,
    })

    .step('build', {
      type: 'deterministic',
      dependsOn: ['impl-classifier-test', 'verify-index', 'install-after-dep'],
      command: 'cd packages/surfaces && npm run build 2>&1 | tail -20 && echo BUILD_OK',
      failOnError: true,
    })
    .step('unit-tests', {
      type: 'deterministic',
      dependsOn: ['build'],
      command: 'cd packages/surfaces && npx vitest run slack-presence-signal 2>&1 | tail -30',
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
