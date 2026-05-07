# Sage v2 Nested Subagent Runner — Executor Self-Reflection

Date: 2026-05-07

Scope: PR 1 only, the reusable nested subagent runner helper in
`@agent-assistant/harness`.

## Files Changed For The Nested-Runner Slice

Created:

- `packages/harness/src/nested-subagent-runner.ts`
- `packages/harness/src/nested-subagent-runner.test.ts`
- `docs/architecture/sage-v2-nested-subagent-runner-executor-reflection.md`

Updated:

- `packages/harness/src/subagent-registry.ts`
- `packages/harness/src/subagent-registry.test.ts`
- `packages/harness/src/index.ts`
- `packages/harness/src/registries/index.ts`
- `packages/harness/src/subpath-exports.test.ts`

Not counted as part of this slice:

- `packages/harness/package.json` is dirty in the worktree for the separate
  `./runtime-policy` export work. The nested-runner slice did not need a
  package export change because `./registries` already existed.

## What The Slice Actually Added

`createNestedSubagentRunner` now provides a first-party `runSubagent` factory
for `createSubagentToolRegistry`. The helper:

- derives a parent trace id from the incoming turn context;
- filters parent context through `filterParentContextForSubagent` before child
  harness construction;
- creates deterministic child trace/turn ids scoped to the parent turn;
- forwards only the subagent tool allowlist into the child turn;
- translates child `HarnessResult` outcomes into the existing
  `TaskToolResult` shape instead of inventing a new result contract.

`subagent-registry.ts` was widened only enough to support that contract cleanly:

- `runSubagent` now receives `taskInput`, `signal`, and `parentTraceId`;
- the registry accepts either a normalized `TaskToolResult` or the older
  `{ output, iterations }` shape;
- the `task` tool is marked `executionMode: 'parallel'`, which the new tests
  exercise end to end.

## Tests Added Or Updated

Added:

- `packages/harness/src/nested-subagent-runner.test.ts`

Updated:

- `packages/harness/src/subagent-registry.test.ts`
- `packages/harness/src/subpath-exports.test.ts`

Focused coverage added in `nested-subagent-runner.test.ts`:

- `success_returns_flat_result`
- `unknown_subagent_returns_ok_false`
- `subagent_failure_is_isolated`
- `max_iterations_failure`
- `parent_cancellation_propagates`
- `tool_allowlist_enforced`
- `parent_context_is_filtered`
- `direct_runner_invocation_filters_parent_context_before_createHarness`
- `workers_fetch_compatibility`
- `child_ids_are_scoped_per_parent_turn`
- `parallel_task_batch`

## Validation Commands Run

I ran the workflow's shape gate locally:

```bash
set -e
rg -q "createNestedSubagentRunner|NestedSubagentRunner|CreateNestedSubagentRunner" packages/harness/src
test -f packages/harness/src/nested-subagent-runner.test.ts
rg -q "unknown|failure|max|cancel|parallel|allowlist" packages/harness/src/nested-subagent-runner.test.ts
if rg -n "SAGE_HARNESS_SUBAGENTS_ENABLED|slack-researcher|competitor-researcher|notion_create_page" packages/harness/src/nested-subagent-runner.ts packages/harness/src/subagent-registry.ts; then echo "Sage product semantics leaked"; exit 1; fi
if rg -n "(fetchImpl\\s*=\\s*[^?;]*\\?\\?\\s*fetch\\b|=\\s*fetch\\s*;)" packages/harness/src/nested-subagent-runner.ts packages/harness/src/subagent-registry.ts; then echo "bare fetch storage found"; exit 1; fi
echo SAGE_V2_NESTED_RUNNER_SHAPE_VERIFIED
```

Result: `SAGE_V2_NESTED_RUNNER_SHAPE_VERIFIED`

I ran the targeted harness tests for the slice:

```bash
npm test -w @agent-assistant/harness -- src/nested-subagent-runner.test.ts src/subagent-registry.test.ts src/subpath-exports.test.ts
```

Result: 3 test files passed, 25 tests passed.

I ran the harness package build:

```bash
npm run build -w @agent-assistant/harness
```

Result: `tsc -p tsconfig.json` completed successfully.

## How Sage Product Logic Was Kept Out

The implementation stayed substrate-only in three ways.

First, the helper exposes only two product-owned seams:
`createHarness(input)` and `composeInstructions(input)`. That keeps model
choice, prompt composition, roster semantics, and downstream workflow policy in
the consumer instead of inside `@agent-assistant/harness`.

Second, the helper operates strictly on existing harness primitives:
`HarnessSubagent`, `HarnessTurnContext`, `HarnessResult`, and
`TaskToolResult`. It does not add Sage flags, Sage-specific error codes, Slack
or Notion workflow semantics, or any roster names.

Third, the validation gate explicitly checked for product leakage with:

- `SAGE_HARNESS_SUBAGENTS_ENABLED`
- `slack-researcher`
- `competitor-researcher`
- `notion_create_page`

The test fixtures also stayed generic. They use neutral examples such as
`doc-drafter`, `researcher`, `memory_recall`, and generic instruction text
instead of copying Sage prompts or product language.

## Residual Risk

The main residual risk is the runner-local `childCounters` map. It gives stable
`parent-turn.sa-N` and `trace.sa-N` ids within one runner instance, which is
what this slice needed, but it is still process-local state. That means:

- counters reset if a caller reconstructs the runner between parent tool calls;
- the map can grow with many unique parent trace/turn pairs over a long-lived
  process.

That tradeoff is acceptable for PR 1 because the contract only requires a
deterministic child id derivation inside the reusable runner helper, not a
cross-process identity system. If later slices need lifecycle control or
telemetry correlation beyond one runner instance, that should be addressed in a
separate substrate change rather than by leaking product policy into this
helper.

## Summary

PR 1 landed as a bounded harness substrate change: one new nested runner helper,
minimal registry widening to support it, focused tests, passing targeted
validation, and no Sage product behavior embedded in shared code.

EXECUTOR_SELF_REFLECTION_COMPLETE
