# Agent Assistant Telemetry

## Human Eval Helpers

`@agent-assistant/telemetry/evals` includes reusable helpers for product eval
systems that keep cases human-authored while sharing deterministic checks and
run artifacts.

Products can usually keep only a small wrapper script plus their own
`evals/suites/*/cases.md` files. The shared package provides:

- Markdown `cases.md` parsing and compilation to generated `cases.jsonl`.
- JSONL suite loading and filtering by suite, case, or tag.
- Deterministic checks for content, regexes, tool calls, routing metadata, stop
  reasons, and question counts.
- Human-review tracking via `Must`, `Must Not`, and `Human Review: true`.
- Run artifact writing: `result.json`, `summary.md`, and `human-review.md`.
- A generic CLI run loop with pluggable product executors.
- Provider executor helpers for local OpenCode one-shot runs and deeper
  Agent Relay handoffs.
- CI summary rendering that fails on failed/skipped cases while listing
  `needs-human` cases for review.

Minimal product runner:

```ts
import {
  compileHumanEvalSuitesFromMarkdown,
  runHumanEvalCli,
  summarizeLatestHumanEvalRunForCi,
} from '@agent-assistant/telemetry/evals';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '../..');

compileHumanEvalSuitesFromMarkdown({
  suitesDir: path.join(rootDir, 'evals', 'suites'),
});

const exitCode = await runHumanEvalCli({
  argv: process.argv.slice(2),
  rootDir,
  runsDir: path.join(rootDir, '.nightcto', 'evals', 'runs'),
  productName: 'NightCTO Evals',
  executors: {
    async nightcto(testCase, context) {
      // Invoke the product here and normalize to:
      // { content: string, toolCalls: Array<{ name: string }>, status?: string }
      return { content: String(testCase.input.message ?? ''), toolCalls: [] };
    },
  },
});

if (process.env.GITHUB_STEP_SUMMARY) {
  summarizeLatestHumanEvalRunForCi({
    rootDir,
    runsDir: path.join(rootDir, '.nightcto', 'evals', 'runs'),
    githubStepSummaryPath: process.env.GITHUB_STEP_SUMMARY,
    title: 'NightCTO Eval CI Summary',
  });
}

process.exit(exitCode);
```

## Provider-Backed Runs

Provider-backed runs are opt-in so offline deterministic checks stay cheap. Use
`--provider` to allow an executor to call a model or broker, and `--executor` to
run existing manual cases through a provider without rewriting every case.

```sh
node scripts/evals/run-product-evals.mjs --provider --executor opencode --suite workflow-authoring
```

The OpenCode helper wraps the Agent Assistant harness CLI runner, so products
can use free or local OpenCode models without OpenRouter credentials:

```ts
import {
  createOpenCodeHumanEvalExecutor,
  runHumanEvalCli,
} from '@agent-assistant/telemetry/evals';

const exitCode = await runHumanEvalCli({
  argv: process.argv.slice(2),
  rootDir,
  productName: 'Ricky Evals',
  executors: {
    opencode: createOpenCodeHumanEvalExecutor({
      productName: 'Ricky',
      model: 'opencode/minimax-m2.5-free',
      instructions: [
        'Follow Ricky workflow standards.',
        'Prefer deterministic verification, review artifacts, and honest blocker reporting.',
      ],
    }),
  },
});
```

Use the direct OpenCode path for quick local quality sweeps where the candidate
answer is a single assistant response. The result is still usually
`needs-human`; the model output is captured into `human-review.md` for a person
to grade against the case's `Must` and `Must Not` bullets.

## Agent Relay For Complex Evals

Use Agent Relay when the eval needs real execution topology rather than a single
model answer: worker spawning, tool-mediated work, channel/broker behavior,
multi-agent coordination, or a product path that depends on Relay metadata.
`createAgentRelayHumanEvalExecutor()` dynamically imports the Node-only Relay
adapter only when this executor runs.

```ts
import {
  createAgentRelayHumanEvalExecutor,
  runHumanEvalCli,
} from '@agent-assistant/telemetry/evals';

const exitCode = await runHumanEvalCli({
  argv: process.argv.slice(2),
  rootDir,
  productName: 'Ricky Evals',
  executors: {
    relay: createAgentRelayHumanEvalExecutor({
      productName: 'Ricky',
      channelId: 'agent-assistant-evals',
      workerName: 'ricky-eval-worker',
      timeoutMs: 300_000,
      spawnWorker: {
        enabled: true,
        cli: 'opencode',
        model: 'opencode/minimax-m2.5-free',
        includeWorkflowConventions: true,
      },
      instructions: 'Exercise the real worker path and return an Agent Assistant ExecutionResult.',
    }),
  },
});
```

Run those cases with:

```sh
node scripts/evals/run-product-evals.mjs --provider --executor relay --case workflow-authoring.multi-agent-repair
```

For long-running evals, prefer one case or one suite at a time and give the
executor a larger timeout. Relay eval outputs include normalized content,
structured tool calls when present, Relay metadata, and trace data in the normal
human-eval run artifacts.
