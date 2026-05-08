# Human-Driven Eval Adoption Guide

Agent Assistant exposes reusable eval primitives through
`@agent-assistant/telemetry/evals`. Products should keep their domain-specific
cases, rubrics, fixtures, and executors in their own repos, then use these
helpers for shared mechanics:

- loading human-authored `cases.jsonl` suites,
- filtering by suite, case id, and tags,
- applying deterministic expectation checks,
- marking cases that need human review,
- writing `result.json`, `summary.md`, and `human-review.md` artifacts.

The package intentionally does not decide what "good" means for a product. A
planning assistant, Slack coworker, coding assistant, or support agent should
encode that in product-owned `cases.jsonl` files and `rubric.md` documents.

## Product Layout

```text
evals/
  README.md
  suites/
    planning/
      cases.jsonl
      rubric.md
    routing/
      cases.jsonl
      rubric.md
  fixtures/
scripts/evals/
  run-product-evals.mjs
  summarize-product-evals.mjs
  compare-product-evals.mjs
```

## Case Shape

```json
{"id":"planning.example","suite":"planning","executor":"manual","kind":"capability","input":{"message":"Plan the feature"},"expected":{"must":["Includes validation gates"],"mustNot":["Claims implementation is complete"],"humanReviewRequired":true},"tags":["planning"]}
```

## Runner Shape

Products provide executors and call the shared helpers:

```js
import {
  assertHumanEvalExpected,
  createHumanEvalRunRecord,
  humanEvalNeedsReview,
  loadHumanEvalCasesFromSuitesDir,
  matchesHumanEvalFilters,
  validateHumanEvalCase,
  writeHumanEvalRunArtifacts,
} from "@agent-assistant/telemetry/evals";
```

Manual and transcript cases can often use only the shared helpers. Product
runtime cases usually need product-specific executors because routing, tool
registries, provider configuration, and sandbox setup are product-owned.

## Practice

Start with 20-50 cases. Keep capability cases separate from regression cases.
Prefer deterministic checks first, require human review for subjective planning
quality, and add LLM judges only after calibration against human verdicts.
