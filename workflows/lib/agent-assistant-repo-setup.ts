/**
 * Shared setup helper for agent-assistant workflows.
 *
 * Adds the two deterministic steps every cloud-sandboxed workflow needs
 * before any agent touches code:
 *
 *   - `setup-branch` — `git config` user + `git checkout -B <branch>`
 *   - `install-deps` — `npm install` + `npm run build --workspaces --if-present`
 *
 * Agent-assistant is a multi-package TypeScript monorepo; nearly every
 * package's `package.json` points `main`/`types` at a generated `dist/`.
 * A fresh sandbox clone does NOT have those `dist/` directories, so any
 * agent importing from `@agent-assistant/proactive`, `@agent-assistant/surfaces`,
 * etc. would hit TS resolution errors and be tempted to invent ad-hoc
 * `external-modules.d.ts` shims to paper over it. Running the workspace
 * build up front makes those imports resolve cleanly.
 *
 * Usage:
 *
 *   const baseWf = workflow(NAME)
 *     .description('...')
 *     .pattern('dag')
 *     .channel(CHANNEL)
 *     .agent(...);
 *
 *   const wf = applyAgentAssistantRepoSetup(baseWf, {
 *     branch: 'feat/my-change',
 *     committerName: 'My Workflow Bot',
 *   });
 *
 *   await wf
 *     .step('read-spec', { type: 'deterministic', dependsOn: ['install-deps'], ... })
 *     ...
 *     .run({ cwd: process.cwd() });
 *
 * Rule source: `writing-agent-relay-workflows` skill, Failure Prevention rule 9
 * ("Factor repo-specific setup into a shared helper").
 */

export interface AgentAssistantRepoSetupOptions {
  /** Target branch. The helper runs `git checkout -B <branch>`. */
  branch: string;
  /** Display name for the git committer. Defaults to "Agent Assistant Bot". */
  committerName?: string;
  /** Email for the git committer. Defaults to agent@agent-assistant.local. */
  committerEmail?: string;
  /** Extra shell commands appended to the setup-branch step (e.g. `prpm install`). */
  extraSetupCommands?: string[];
  /** Skip `npm run build --workspaces --if-present`. Rarely the right call; only set when the workflow produces no TS changes that consume cross-package dist output. */
  skipWorkspaceBuild?: boolean;
}

interface StepChain {
  step: (name: string, cfg: unknown) => StepChain;
}

export function applyAgentAssistantRepoSetup<T>(
  wf: T,
  opts: AgentAssistantRepoSetupOptions,
): T {
  const committerName = opts.committerName ?? 'Agent Assistant Bot';
  const committerEmail = opts.committerEmail ?? 'agent@agent-assistant.local';

  const setupBranchCommand = [
    'set -e',
    `git config user.email ${JSON.stringify(committerEmail)}`,
    `git config user.name ${JSON.stringify(committerName)}`,
    `git checkout -B ${opts.branch}`,
    'git log -1 --oneline',
    ...(opts.extraSetupCommands ?? []),
  ].join(' && ');

  // `--legacy-peer-deps --no-audit --no-fund` keeps install output small enough
  // to survive captureOutput size limits and tolerates the monorepo's
  // peer-dep graph. `tail -10` trims further.
  const installCommand = opts.skipWorkspaceBuild
    ? 'npm install --legacy-peer-deps --no-audit --no-fund 2>&1 | tail -10'
    : [
        'npm install --legacy-peer-deps --no-audit --no-fund 2>&1 | tail -10',
        'npm run build --workspaces --if-present 2>&1 | tail -20',
      ].join(' && ');

  const chain = wf as unknown as StepChain;
  chain
    .step('setup-branch', {
      type: 'deterministic',
      command: setupBranchCommand,
      captureOutput: true,
      failOnError: true,
    })
    .step('install-deps', {
      type: 'deterministic',
      dependsOn: ['setup-branch'],
      command: installCommand,
      captureOutput: true,
      failOnError: true,
    });

  return wf;
}
