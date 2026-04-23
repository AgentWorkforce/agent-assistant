/**
 * proactive-signals 01: Per-user quiet-hours gate
 *
 * Adds an opt-in quiet-hours primitive to @agent-assistant/proactive so
 * consumers can stop proactive posts during a user's configured sleep
 * window.
 *
 * Files:
 *   packages/proactive/src/quiet-hours.ts        — NEW
 *   packages/proactive/src/quiet-hours.test.ts   — NEW
 *   packages/proactive/src/index.ts              — UPDATE: barrel re-export
 *
 * Contract (the impl agent must match this exactly):
 *
 *   export interface QuietHoursConfig {
 *     timezone: string;      // IANA zone, e.g. "America/New_York"
 *     startHour: number;     // 0-23 local
 *     endHour: number;       // 0-23 local; if endHour < startHour the window wraps midnight
 *   }
 *
 *   export interface QuietHoursStore {
 *     get(userId: string): Promise<QuietHoursConfig | null>;
 *     set(userId: string, config: QuietHoursConfig): Promise<void>;
 *   }
 *
 *   // Pure: true iff `now` falls inside [startHour, endHour) in config.timezone.
 *   // Wraps midnight correctly when endHour < startHour.
 *   export function isInQuietHours(config: QuietHoursConfig, now: Date): boolean;
 *
 *   // OPT-IN: returns false (do not defer) when store has no config for the user.
 *   export async function shouldDeferForQuietHours(
 *     store: QuietHoursStore,
 *     userId: string,
 *     now: Date,
 *   ): Promise<boolean>;
 *
 * Use Intl.DateTimeFormat with timeZone for timezone math — do NOT add a dep.
 * Validate config on read: reject non-IANA-looking timezones, hours out of
 * 0..23, return null from get if the stored blob is malformed.
 */

import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('aa-proactive-signals-01-quiet-hours')
    .description('Add opt-in quiet-hours primitive to @agent-assistant/proactive')
    .pattern('dag')
    .channel('wf-aa-proactive-signals-01')
    .maxConcurrency(3)
    .timeout(1_800_000)

    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'lead',
      role: 'Lead — pins the quiet-hours API shape, reviews impl, confirms midnight-wrap behavior',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer — writes quiet-hours.ts and its tests',
      retries: 2,
    })

    .step('read-index', {
      type: 'deterministic',
      command: 'sed -n "1,80p" packages/proactive/src/index.ts',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-prefs-pattern', {
      type: 'deterministic',
      command: 'sed -n "1,60p" packages/proactive/src/notify-channel-prefs.ts',
      captureOutput: true,
      failOnError: true,
    })

    .step('plan', {
      agent: 'lead',
      dependsOn: ['read-index', 'read-prefs-pattern'],
      task: `Post a short plan on the channel confirming the quiet-hours contract as defined in the workflow header. Key points to call out to the impl:

- Use Intl.DateTimeFormat with timeZone to extract the local hour; do NOT add any dep like date-fns-tz
- Window is half-open: [startHour, endHour). If endHour < startHour, window wraps midnight (e.g. 22..8 means 22,23,0,1,2,3,4,5,6,7 local)
- Opt-in semantics: shouldDeferForQuietHours returns false when store.get returns null
- Malformed stored blob -> get() returns null (don't throw)
- Validate on set: timezone must match /^[A-Za-z_]+(?:\\/[A-Za-z_]+){1,2}$/ (accepts "UTC" too), hours 0..23 integers. Throw on invalid input.

Barrel export list in @agent-assistant/proactive index.ts:
  export { isInQuietHours, shouldDeferForQuietHours } from './quiet-hours.js';
  export type { QuietHoursConfig, QuietHoursStore } from './quiet-hours.js';

Current index:
{{steps.read-index.output}}

Pattern match with prefs module:
{{steps.read-prefs-pattern.output}}

Keep plan to 8 bullets max.`,
    })

    .step('impl-quiet-hours', {
      agent: 'impl',
      dependsOn: ['plan'],
      task: `Create NEW file packages/proactive/src/quiet-hours.ts implementing the contract from the workflow header. Use Intl.DateTimeFormat({ timeZone, hour: 'numeric', hourCycle: 'h23' }) to extract local hour. Match the tsconfig of packages/proactive (strict, noUncheckedIndexedAccess). Do not add any dependency. Write to disk.`,
      verification: { type: 'file_exists', value: 'packages/proactive/src/quiet-hours.ts' },
      retries: 2,
    })

    .step('impl-quiet-hours-test', {
      agent: 'impl',
      dependsOn: ['impl-quiet-hours'],
      task: `Create NEW file packages/proactive/src/quiet-hours.test.ts. Vitest coverage:
  1. isInQuietHours true when hour == startHour in the given timezone (use new Date of a fixed UTC instant + check against 'America/New_York')
  2. isInQuietHours false when hour == endHour (half-open)
  3. Midnight-wrap: startHour=22, endHour=8 — true at 23:00 local, true at 03:00 local, false at 09:00 local
  4. shouldDeferForQuietHours returns false when store.get returns null (opt-in semantics)
  5. shouldDeferForQuietHours returns true for a configured user inside their quiet window
  6. store.set validates input: throws on hour=25, throws on unknown timezone, throws on non-integer hour
  7. store.get returns null when stored blob is malformed (bad JSON or schema miss)
Use an in-memory fake store backed by a Map. Write to disk.`,
      verification: { type: 'file_exists', value: 'packages/proactive/src/quiet-hours.test.ts' },
      retries: 2,
    })

    .step('impl-index-export', {
      agent: 'impl',
      dependsOn: ['impl-quiet-hours'],
      task: `Edit ONLY packages/proactive/src/index.ts. Append (near the other notify-channel exports at end of file):

  export { isInQuietHours, shouldDeferForQuietHours } from './quiet-hours.js';
  export type { QuietHoursConfig, QuietHoursStore } from './quiet-hours.js';

Do not touch any other file.`,
      verification: { type: 'exit_code' },
      retries: 2,
    })
    .step('verify-index', {
      type: 'deterministic',
      dependsOn: ['impl-index-export'],
      command: 'grep -q "quiet-hours" packages/proactive/src/index.ts && echo OK',
      failOnError: true,
    })

    .step('build', {
      type: 'deterministic',
      dependsOn: ['impl-quiet-hours-test', 'verify-index'],
      command: 'cd packages/proactive && npm run build 2>&1 | tail -20 && echo BUILD_OK',
      failOnError: true,
    })
    .step('unit-tests', {
      type: 'deterministic',
      dependsOn: ['build'],
      command: 'cd packages/proactive && npx vitest run quiet-hours 2>&1 | tail -30',
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
