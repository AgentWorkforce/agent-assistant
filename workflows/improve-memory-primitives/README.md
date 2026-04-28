# improve-memory-primitives

Adds the memory primitives any `@agent-assistant/harness` consumer needs to
surface memory to its model. Sage today reinvents most of these locally;
consolidating upstream lets future consumers (and the next iteration of
sage) build on a shared foundation.

## What ships in this workflow

### `@agent-assistant/memory` (minor bump)

| Symbol | Purpose |
|---|---|
| `formatRelativeAge(entry, now?)` | "just now" / "N minutes ago" / etc. |
| `renderTurnMemoryContext(context, opts?)` | `[<scope>, <age>] <content>` lines for direct prompt injection |
| `SESSION_LOAD_LIMIT`, `USER_LOAD_LIMIT`, `WORKSPACE_LOAD_LIMIT` | Named per-scope load constants |
| `retrieveTurnMemoryContext(input)` | Now accepts optional `perScopeLimits` and `query` (forwarded to `MemoryStore.retrieve`) |
| `logMemoryOp(event)` + `measureMemoryOp(meta, fn)` | Single-line JSON `event=memory_op` console.info for save/load/promote/close/init/forget. `measureMemoryOp` re-throws originals — observability is additive. |
| `hashMemoryContent(content)` | SHA-256 base64url helper for content-hash dedup |

### `@agent-assistant/harness` (minor bump)

| Symbol | Purpose |
|---|---|
| `createMemoryToolRegistry({ store, resolveScopeContext })` | Analogous to `createWorkspaceToolRegistry({ provider })` |
| `MEMORY_TOOL_NAMES`, `MEMORY_REMEMBER_TOOL_NAME`, `MEMORY_RECALL_TOOL_NAME`, `MEMORY_FORGET_TOOL_NAME` | Tool name constants |
| Tools: `memory_remember`, `memory_recall`, `memory_forget` | Model-callable memory ops with scope guards |
| `RedundantToolLoopThreshold` + `createHarness({ limits: { redundantToolLoopThreshold } })` | Replaces "last 3 consecutive identical" with "M of last K identical, regardless of order" (defaults M=4, K=6). Models can no longer dodge the detector by interleaving one different call. |
| `WORKSPACE_LARGE_OUTPUT_ADVISORY_BYTES` constant + `_advisory` wrap on workspace_list / workspace_search outputs > 5 KB | Tells the model to drill in via `workspace_read` on a specific file or `workspace_list` on a deeper subpath; do not re-call with identical args. |

## Layout

| File | Purpose |
|---|---|
| `00-execute.ts` | Master — branch + sequential subs + fail-fast |
| `01-memory-package.ts` | `@agent-assistant/memory` primitives + tests |
| `02-harness-memory-tools.ts` | `createMemoryToolRegistry` + tests |
| `04-loosen-detector-and-large-output-advisory.ts` | Loosen redundant-tool-loop detector ("M of last K identical, regardless of order") + add `_advisory` wrap on workspace tool outputs > 5 KB |
| `03-publish-pr.ts` | Lead review + commit + push + PR (runs last so PR includes Sub 4) |

## Run

```bash
cd ../agent-assistant
npx tsx workflows/improve-memory-primitives/00-execute.ts
```

Each sub also calls `process.exit(1)` on `result.status === 'failed'`; the
master greps stdout for `Workflow status: failed` as a second guard. Branch
left in place on failure for inspection.

## What this is NOT doing

- Not changing how sage consumes memory (that's the followup workflow in
  the sage repo, `workflows/improve-sage-memory/`, which depends on the
  versions published by this PR's merge).
- Not introducing dedup at the store layer — `hashMemoryContent` is the
  building block; consumers decide whether to dedup at write.
- Not changing existing function signatures — every new arg is optional;
  every existing helper keeps its current shape so out-of-tree consumers
  don't break.
- Not publishing to npm — that's the existing `@agent-assistant` release
  workflow's job, fired automatically on PR merge.

## Why upstream first

Per the AgentWorkforce convention (see `.claude/rules/...` in sage):
"primitives that any consumer needs belong in `@agent-assistant`; sage
consumes via semver." Mirroring `formatRelativeAge` / a memory tool
registry inside sage would block the next consumer from getting them
without a copy-paste.

## Acceptance contract

`gh pr view <pr#> --json mergeStateStatus` returns `MERGEABLE` after lead
review approves and CI passes. The two version bumps are minor (new
exports = minor under semver). Once merged, the release workflow fires and
the published versions (e.g. `@agent-assistant/memory@0.4.0`,
`@agent-assistant/harness@0.7.0`) become the minimum sage will pin to.

## Followup

After merge + publish, run `workflows/improve-sage-memory/00-execute.ts` in
the sage repo. That workflow:
1. Bumps sage's deps to the new minors.
2. Replaces sage's local memory render with `renderTurnMemoryContext`.
3. Wires `createMemoryToolRegistry` into `SageHarnessRegistryDeps` so the
   slack-runner harness model can call `memory_remember/recall/forget`.
4. Updates the capabilities + thread-context prompt layers to describe the
   new model agency truthfully.
5. Adds smarter heuristic improvements (LLM-judge promotion, query
   plumbing) and unifies the slack/client-api write paths.
