# Sage v2 Nested Subagent Runner — Fresh Eyes Self-Reflection

Date: 2026-05-07

Scope: PR 1 only, the nested subagent runner helper in `@agent-assistant/harness`.

## Verdict

PASS_WITH_FOLLOWUPS

The reusable runner behavior itself is in good shape for PR 1. The remaining issue is scope hygiene: the current worktree still carries unrelated `runtime-policy` export-surface changes that should be split out before this PR is treated as cleanly scoped.

## What I Checked

I reviewed the current worktree diff against `HEAD`, not the branch tip against `origin/main`, because the nested-runner slice is present as local worktree changes rather than committed branch history. For PR 1 only, I checked:

- `packages/harness/src/nested-subagent-runner.ts:18-238` for the new helper API, parent-trace resolution, child id derivation, allowlist forwarding, nested turn construction, and `HarnessResult` to `TaskToolResult` translation.
- `packages/harness/src/subagent-registry.ts:65-95` and `packages/harness/src/subagent-registry.ts:228-252` for the widened `runSubagent` seam, normalized result handling, and `executionMode: 'parallel'` on the `task` tool.
- `packages/harness/src/registries/index.ts:30-48` and `packages/harness/src/index.ts:36-106,244-248` for export wiring of `createNestedSubagentRunner` and its supporting types.
- `packages/harness/src/nested-subagent-runner.test.ts:140-509` for the core success, failure, cancellation, filtering, allowlist, child-id, and direct-runner contract cases.
- `packages/harness/src/subpath-exports.test.ts:13-43` and `packages/harness/package.json:9-45` to separate PR 1 export wiring from unrelated package-surface churn.

I also ran the explicit scope and compatibility checks that matter for this slice:

- no Sage product leakage in the shared helper or registry;
- no bare `fetch` capture pattern in the reviewed files;
- targeted harness tests for the nested-runner slice;
- harness package build.

## Fixes Made

No new code edits were required in this pass.

I did verify that the earlier contract fix called out in the fresh-eyes review is now present: `createNestedSubagentRunner` passes the original `parentContext` and the separately scrubbed `filteredParentContext` into `createHarness` at `packages/harness/src/nested-subagent-runner.ts:179-194`, and the direct-call contract is covered by `packages/harness/src/nested-subagent-runner.test.ts:473-509`.

## Validation

I ran:

```bash
npm test -w @agent-assistant/harness -- src/nested-subagent-runner.test.ts src/subagent-registry.test.ts src/subpath-exports.test.ts
```

Result: 3 test files passed, 25 tests passed.

I ran:

```bash
npm run build -w @agent-assistant/harness
```

Result: build completed successfully.

I ran:

```bash
set -e
rg -q "createNestedSubagentRunner|NestedSubagentRunner|CreateNestedSubagentRunner" packages/harness/src
test -f packages/harness/src/nested-subagent-runner.test.ts
rg -q "unknown|failure|max|cancel|parallel|allowlist" packages/harness/src/nested-subagent-runner.test.ts
if rg -n "SAGE_HARNESS_SUBAGENTS_ENABLED|slack-researcher|competitor-researcher|notion_create_page" packages/harness/src/nested-subagent-runner.ts packages/harness/src/subagent-registry.ts; then exit 1; fi
if rg -n "(fetchImpl\\s*=\\s*[^?;]*\\?\\?\\s*fetch\\b|=\\s*fetch\\s*;)" packages/harness/src/nested-subagent-runner.ts packages/harness/src/subagent-registry.ts; then exit 1; fi
echo SAGE_V2_NESTED_RUNNER_SHAPE_VERIFIED
```

Result: `SAGE_V2_NESTED_RUNNER_SHAPE_VERIFIED`

## Why The Verdict Is Justified

The pass side of the verdict is justified because the PR 1 logic path is coherent and verified:

- The runner helper stays substrate-only. Its only product-owned seams are `createHarness` and `composeInstructions`, and the helper does not embed Sage roster names, flags, or workflow behavior in shared code.
- Parent context handling is correct for both call paths. Registry-driven execution hands the runner a filtered context, while direct runner invocation preserves the raw parent context and separately exposes the filtered copy for child harness construction.
- The nested turn shape matches the PR 1 plan: child turn ids derive from the parent turn, child trace ids derive from the parent trace, and allowed tools are restricted to the subagent allowlist.
- The registry change is minimal and aligned with the helper: it widens `runSubagent` just enough to pass `taskInput`, `signal`, and `parentTraceId`, and it normalizes both legacy and fully structured runner results.
- The targeted tests prove the intended behaviors instead of only unit-mocking fragments. In particular, success, failure isolation, cancellation, allowlist enforcement, direct-runner context semantics, and parallel task execution are all exercised.

The follow-up side of the verdict is also justified. PR 1 is supposed to be the nested-runner helper, but the current worktree still includes unrelated `runtime-policy` public-surface changes in `packages/harness/package.json:34-37`, `packages/harness/src/index.ts:2,11-21`, and `packages/harness/src/subpath-exports.test.ts:31-34`. Those hunks are not needed to prove the nested-runner substrate and should be split out so this PR remains reviewable on its declared boundary.

## Summary

I checked the current PR 1 worktree slice, confirmed the nested-runner helper behavior against code and tests, verified the earlier parent-context contract fix is present, and found no new functional defects in the runner path. The verdict remains `PASS_WITH_FOLLOWUPS` because the helper is ready, but unrelated `runtime-policy` export changes should be removed or moved to a separate PR before merge.

Artifact produced: `docs/architecture/sage-v2-nested-subagent-runner-fresh-eyes-reflection.md`

FRESH_EYES_SELF_REFLECTION_COMPLETE
