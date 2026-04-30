## Summary

Ports three primitives from
[`langchain-ai/deepagents`](https://github.com/langchain-ai/deepagents)
(MIT) into `@agent-assistant/harness`:

1. **Subagent task tool** — `createSubagentToolRegistry({ subagents,
   runSubagent })` exposes a `task` tool the model invokes with
   `(description, subagent_type)`. Subagents run in an isolated
   context window with their own tool budget; only the synthesized
   final result returns to the parent. Multiple `task` calls in one
   `tool_request` batch run in parallel; failed subagents return
   structured errors and DO NOT fail the parent turn.
   - Reference: `libs/deepagents/deepagents/middleware/subagents.py`
     — `_build_task_tool` (~line 348), `TaskToolSchema` (~line 179),
     `_EXCLUDED_STATE_KEYS` (~line 176).

2. **Planning tool** — `createPlanningToolRegistry()` registers
   `write_todos` / `list_todos` / `complete_todo`. Todos persist
   across iterations within a turn via `HarnessTurnContext.scratch`.
   Surfaces partial completion to the user / operator for multi-step
   drafts. Auto-promotes the next pending todo to `in_progress` when
   the previous one completes.
   - Reference: `langchain-ai/deepagents` `graph.py` + planning
     middleware module (search for `write_todos` / `TodoWrite`).

3. **Scratchpad filesystem** — `createScratchpadToolRegistry()`
   registers `scratch_read` / `scratch_write` / `scratch_list` /
   `scratch_edit`. In-memory, per-turn virtual fs with byte caps.
   Tools are `scratch_*`-prefixed to avoid colliding with the
   existing `workspace_*` reads. Lives only for the lifetime of
   one turn — NOT persisted to memory or the workspace VFS.
   - Reference: `libs/deepagents/deepagents/middleware/filesystem.py`
     — `FilesystemState` (~line 114), schemas around lines 121-167,
     `FilesystemMiddleware` (~line 522).

## Sourcing

All three implementations are written from scratch in TS in the
`@agent-assistant/harness` idiom. The patterns themselves are
general engineering ideas (delegation, todo state, scratch buffer);
the implementations are not copied source.

Permitted references used:
- `https://github.com/langchain-ai/deepagents` (MIT) — primary
- `docs.claude.com` Agent SDK / Claude Code docs
- Public `@anthropic-ai/sdk`
- Zod public docs

Explicitly NOT used:
- `/Users/khaliqgant/Projects/claude-code` (leaked Anthropic source,
  leaked 2026-03-31 per its own README)
- `https://github.com/ultraworkers/claw-code` (same leak repackaged)

## Why now

Sage's slack runner has been failing in patterns this trio fixes:
- Long, mixed-context turns blow the parent's tool budget when a
  single tool would benefit from a focused sub-investigation
  (`task` tool fixes this).
- Multi-step drafts lose track of progress mid-turn (planning tool
  surfaces it to user + ops).
- The model wants to draft + edit JSON / markdown intermediates
  without persisting to the workspace VFS (scratchpad).

## API additions

All exported from `@agent-assistant/harness`:

- `createSubagentToolRegistry`, `filterParentContextForSubagent`,
  `SUBAGENT_DEFAULT_MAX_ITERATIONS`, `SUBAGENT_EXCLUDED_PARENT_KEYS`
- Types: `HarnessSubagent`, `HarnessSubagentRegistry`,
  `TaskToolInput`, `TaskToolResult`,
  `CreateSubagentToolRegistryOptions`
- `createPlanningToolRegistry`, `getOrCreatePlanState`,
  `PLANNING_DEFAULT_MAX_TODOS`, `PLANNING_SCRATCH_KEY`
- Types: `TodoStatus`, `HarnessTodo`, `HarnessPlanState`,
  `CreatePlanningToolRegistryOptions`
- `createScratchpadToolRegistry`, `getOrCreateScratchpadState`,
  `SCRATCHPAD_DEFAULT_MAX_FILE_BYTES`, `SCRATCHPAD_DEFAULT_MAX_TOTAL_BYTES`,
  `SCRATCHPAD_SCRATCH_KEY`
- Types: `HarnessScratchFile`, `HarnessScratchpadState`,
  `CreateScratchpadToolRegistryOptions`

## Tests

Vitest coverage for each primitive (isolation, parallel fan-out,
error propagation, max-iteration cap, byte caps, state persistence,
context isolation). Existing harness suite passes — no regressions.

## Version + rollout

Version bump: `@agent-assistant/harness` 0.x.y → **0.9.0** (minor;
additive primitives, no breaking changes).

After merge: maintainer publishes `@agent-assistant/harness@0.9.0`
via the package's normal release flow. Sage then adopts via Phase B
of `workflows/sage-deepagents-port/`.
