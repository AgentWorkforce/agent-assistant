/**
 * proactive-signals 02: Event-signal inbox
 *
 * Adds a ProactiveSignal type + SignalInboxStore interface to
 * @agent-assistant/proactive so consumers can drop event-driven signals
 * (Slack presence, GitHub webhooks) into an inbox that the proactive
 * engine drains on its next tick (or on demand).
 *
 * Files:
 *   packages/proactive/src/signal-inbox.ts        — NEW
 *   packages/proactive/src/signal-inbox.test.ts   — NEW
 *   packages/proactive/src/index.ts               — UPDATE: barrel re-export
 *
 * Contract (the impl agent must match this exactly):
 *
 *   export type ProactiveSignalKind =
 *     | 'slack.presence'
 *     | 'slack.status'
 *     | 'github.pr_closed'
 *     | 'github.pr_review_submitted';
 *
 *   export interface ProactiveSignal {
 *     id: string;                // generated via nanoid() when missing
 *     kind: ProactiveSignalKind;
 *     workspaceId: string;
 *     subjectId: string;         // userId / prNumber / threadId — caller-defined
 *     payload: Record<string, unknown>;
 *     receivedAt: number;        // epoch ms
 *     expiresAt: number;         // epoch ms
 *   }
 *
 *   export const DEFAULT_TTL_MS_BY_KIND: Record<ProactiveSignalKind, number> = {
 *     'slack.presence':              10 * 60 * 1000,
 *     'slack.status':                30 * 60 * 1000,
 *     'github.pr_closed':            48 * 60 * 60 * 1000,
 *     'github.pr_review_submitted':  24 * 60 * 60 * 1000,
 *   };
 *
 *   export interface SignalInboxStore {
 *     put(signal: ProactiveSignal): Promise<void>;
 *     list(workspaceId: string): Promise<ProactiveSignal[]>;
 *     delete(workspaceId: string, signalId: string): Promise<void>;
 *   }
 *
 *   export interface RecordSignalInput {
 *     kind: ProactiveSignalKind;
 *     workspaceId: string;
 *     subjectId: string;
 *     payload?: Record<string, unknown>;
 *     now?: number;              // defaults to Date.now()
 *     ttlMs?: number;            // overrides DEFAULT_TTL_MS_BY_KIND
 *   }
 *
 *   export async function recordSignal(
 *     store: SignalInboxStore,
 *     input: RecordSignalInput,
 *   ): Promise<ProactiveSignal>;
 *
 *   export interface DrainOptions {
 *     kind?: ProactiveSignalKind | ProactiveSignalKind[];
 *     now?: number;              // defaults to Date.now(); used for expiry filter
 *     autoDeleteExpired?: boolean; // default true — expired signals get cleared as a side effect
 *   }
 *
 *   // Returns only non-expired signals matching the kind filter. Expired signals
 *   // are deleted from the store when autoDeleteExpired is true (default).
 *   export async function drainSignals(
 *     store: SignalInboxStore,
 *     workspaceId: string,
 *     options?: DrainOptions,
 *   ): Promise<ProactiveSignal[]>;
 *
 *   export async function clearSignal(
 *     store: SignalInboxStore,
 *     workspaceId: string,
 *     signalId: string,
 *   ): Promise<void>;
 *
 * Use nanoid (already a dep) to generate signal IDs.
 * Match tsconfig strictness (noUncheckedIndexedAccess).
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('aa-proactive-signals-02-signal-inbox')
    .description('Add ProactiveSignal + SignalInboxStore primitives to @agent-assistant/proactive')
    .pattern('dag')
    .channel('wf-aa-proactive-signals-02')
    .maxConcurrency(3)
    .timeout(1_800_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'lead',
      role: 'Lead — pins signal-inbox API, reviews impl, confirms TTL and drain behavior',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer — writes signal-inbox.ts and its tests',
      retries: 2,
    })

    .step('read-index', {
      type: 'deterministic',
      command: 'sed -n "1,80p" packages/proactive/src/index.ts',
      captureOutput: true,
      failOnError: true,
    })

    .step('plan', {
      agent: 'lead',
      dependsOn: ['read-index'],
      task: `Post a short plan on the channel confirming the signal-inbox contract (see workflow header).

Key impl notes:
- id defaults to nanoid() when caller omits it in recordSignal; the input type does NOT include id, it's always generated
- receivedAt defaults to Date.now(); override via input.now
- expiresAt = receivedAt + (input.ttlMs ?? DEFAULT_TTL_MS_BY_KIND[kind])
- drainSignals filters by expiresAt > now (strict greater)
- When autoDeleteExpired is true and a signal is expired, call store.delete(workspaceId, signal.id) but swallow errors (best-effort cleanup)
- kind filter supports single kind or array

Barrel exports in @agent-assistant/proactive index.ts:
  export { DEFAULT_TTL_MS_BY_KIND, clearSignal, drainSignals, recordSignal } from './signal-inbox.js';
  export type { DrainOptions, ProactiveSignal, ProactiveSignalKind, RecordSignalInput, SignalInboxStore } from './signal-inbox.js';

Current index:
{{steps.read-index.output}}

Keep plan to 8 bullets max. The contract in this workflow's header comment is the source of truth — the impl agent reads the workflow file directly.`,
    })

    .step('impl-signal-inbox', {
      agent: 'impl',
      dependsOn: ['plan'],
      task: `Create NEW file packages/proactive/src/signal-inbox.ts implementing the full contract from the workflow header. Import nanoid from 'nanoid'. Match the tsconfig of packages/proactive (strict, noUncheckedIndexedAccess — use defensive array/map access). Do not add any dependency. Write to disk.`,
      verification: { type: 'file_exists', value: 'packages/proactive/src/signal-inbox.ts' },
      retries: 2,
    })

    .step('impl-signal-inbox-test', {
      agent: 'impl',
      dependsOn: ['impl-signal-inbox'],
      task: `Create NEW file packages/proactive/src/signal-inbox.test.ts. Vitest coverage:
  1. recordSignal generates an id, sets receivedAt=now, expiresAt=now+DEFAULT_TTL_MS_BY_KIND[kind]
  2. recordSignal honors explicit input.now and input.ttlMs
  3. drainSignals returns all non-expired signals for the workspace
  4. drainSignals filters by a single kind
  5. drainSignals filters by an array of kinds
  6. drainSignals excludes expired signals (expiresAt <= now)
  7. drainSignals with autoDeleteExpired=true deletes expired signals from the store as a side effect
  8. drainSignals with autoDeleteExpired=false leaves expired signals in the store
  9. clearSignal deletes a signal by id
 10. delete errors in autoDeleteExpired path are swallowed (use a store that throws on delete)
Use an in-memory fake SignalInboxStore backed by a Map<workspaceId, Map<id, ProactiveSignal>>. Write to disk.`,
      verification: { type: 'file_exists', value: 'packages/proactive/src/signal-inbox.test.ts' },
      retries: 2,
    })

    .step('impl-index-export', {
      agent: 'impl',
      dependsOn: ['impl-signal-inbox'],
      task: `Edit ONLY packages/proactive/src/index.ts. Append near the other notify-channel exports:

  export { DEFAULT_TTL_MS_BY_KIND, clearSignal, drainSignals, recordSignal } from './signal-inbox.js';
  export type {
    DrainOptions,
    ProactiveSignal,
    ProactiveSignalKind,
    RecordSignalInput,
    SignalInboxStore,
  } from './signal-inbox.js';

Do not touch any other file.`,
      verification: { type: 'exit_code' },
      retries: 2,
    })
    .step('verify-index', {
      type: 'deterministic',
      dependsOn: ['impl-index-export'],
      command: 'grep -q "signal-inbox" packages/proactive/src/index.ts && echo OK',
      failOnError: true,
    })

    .step('build', {
      type: 'deterministic',
      dependsOn: ['impl-signal-inbox-test', 'verify-index'],
      command: 'cd packages/proactive && npm run build 2>&1 | tail -20 && echo BUILD_OK',
      failOnError: true,
    })
    .step('unit-tests', {
      type: 'deterministic',
      dependsOn: ['build'],
      command: 'cd packages/proactive && npx vitest run signal-inbox 2>&1 | tail -30',
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
