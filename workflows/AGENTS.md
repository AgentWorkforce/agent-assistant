# Agent-Assistant Workflow Conventions

## Shared setup helper (required)

Every cloud-sandboxed workflow in this repo that produces code changes MUST use the shared setup helper at [`workflows/lib/agent-assistant-repo-setup.ts`](./lib/agent-assistant-repo-setup.ts) for its branch checkout and install-deps steps. Do NOT copy-paste those steps inline.

**Why:** agent-assistant is a multi-package TS monorepo. Nearly every package's `package.json` points `main`/`types` at a generated `dist/`. A fresh sandbox clone doesn't have those `dist/` directories, so any agent importing from `@agent-assistant/proactive`, `@agent-assistant/surfaces`, etc. hits TS resolution errors. The helper prebuilds the workspace so cross-package imports resolve cleanly — without it, agents invent `external-modules.d.ts` shims and other workarounds that pollute the PR.

This follows the `writing-agent-relay-workflows` skill, Failure Prevention rule 9.

### Usage

```ts
import { workflow } from '@agent-relay/sdk/workflows';
import { applyAgentAssistantRepoSetup } from '../lib/agent-assistant-repo-setup';

const BRANCH = 'feat/my-change';

async function main() {
  const baseWf = workflow(NAME)
    .description('...')
    .pattern('dag')
    .channel(CHANNEL)
    .agent('lead', { ... })
    .agent('impl', { ... });

  const wf = applyAgentAssistantRepoSetup(baseWf, {
    branch: BRANCH,
    committerName: 'My Workflow Bot',
  });

  await wf
    .step('read-spec', { type: 'deterministic', dependsOn: ['install-deps'], ... })
    // ... rest of the workflow
    .run({ cwd: process.cwd() });
}
```

The helper adds two deterministic steps:

1. **`setup-branch`** — `git config` user + `git checkout -B <branch>`
2. **`install-deps`** — `npm install --legacy-peer-deps --no-audit --no-fund` + `npm run build --workspaces --if-present`

Downstream steps should depend on `install-deps`, not `setup-branch`.

### Options

| Option | Default | When to use |
|---|---|---|
| `branch` | — (required) | Target branch; helper runs `git checkout -B <branch>` |
| `committerName` | `Agent Assistant Bot` | Per-workflow attribution in commit messages |
| `committerEmail` | `agent@agent-assistant.local` | Override if your workflow needs real attribution |
| `extraSetupCommands` | `[]` | Appended to `setup-branch` (e.g. `prpm install`) |
| `skipWorkspaceBuild` | `false` | Skip the workspace prebuild. Rarely right — only use if the workflow touches no TS that imports cross-package dist |

### Maintaining the helper

If a new prerequisite becomes universal (e.g. a new workspace package whose dist must exist before agents run), add it to the helper — do NOT add it inline to one workflow.
