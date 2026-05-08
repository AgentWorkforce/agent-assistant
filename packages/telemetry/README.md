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

