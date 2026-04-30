# Subagent task tool — design

> Status: design only (no code in this step). Implementation lands in
> follow-up steps `aa-04-subagent-tool` and `aa-05-tests-subagent`.

## Goal

Expose a `task` tool that the model can call with
`(description, subagent_type)`. The named subagent runs in an
**isolated context window** with its own tool budget; only the final
synthesized result returns to the parent. Multiple subagents can run
in parallel (one `tool_request` batch with multiple `task` calls). A
failed subagent does **not** fail the parent turn — it returns a
structured error result that the parent observes as a regular
`tool_result`.

Reference: [`langchain-ai/deepagents`](https://github.com/langchain-ai/deepagents)
`libs/deepagents/deepagents/middleware/subagents.py` — see
`_build_task_tool` (subagents.py:363-470). Same intent;
reimplemented in TypeScript in `@agent-assistant/harness`'s idiom
(no LangGraph state graphs, no `Command` returns — we plug into the
existing `HarnessToolRegistry` contract).

## Public TypeScript API

```ts
export interface HarnessSubagent {
  /** Stable identifier the parent uses in subagent_type. */
  name: string;
  /** Human-readable description shown in the task tool's enum docs. */
  description: string;
  /**
   * Allowed tool names (whitelist) for this subagent. The subagent
   * sees ONLY these tools, not the parent's full registry.
   */
  toolAllowlist: readonly string[];
  /** System prompt fragment prepended to the subagent's persona. */
  systemPrompt: string;
  /** Maximum tool-iteration count for this subagent. Default 8. */
  maxIterations?: number;
}

export interface HarnessSubagentRegistry {
  list(): readonly HarnessSubagent[];
  get(name: string): HarnessSubagent | undefined;
}

export interface TaskToolInput {
  description: string;
  subagent_type: string;
}

export interface TaskToolResult {
  ok: boolean;
  /** Synthesized final output of the subagent (assistant text). */
  output?: string;
  /** Present when ok === false. */
  error?: { message: string; code?: string };
  /** For telemetry — number of tool iterations the subagent used. */
  iterations: number;
  /** For telemetry — the subagent that produced this result. */
  subagent: string;
}

export interface CreateSubagentToolRegistryOptions {
  subagents: readonly HarnessSubagent[];
  /**
   * Caller-provided runner: takes a description + subagent spec +
   * filtered parent state, runs an isolated harness turn, returns the
   * synthesized text or throws.
   */
  runSubagent: (input: {
    subagent: HarnessSubagent;
    description: string;
    parentContext: HarnessTurnContext;
  }) => Promise<{ output: string; iterations: number }>;
  /** Default max iterations across the registry. Default 8. */
  defaultMaxIterations?: number;
}

export function createSubagentToolRegistry(
  options: CreateSubagentToolRegistryOptions,
): HarnessToolRegistry;
```

The function returns a `HarnessToolRegistry`
(see `packages/harness/src/types.ts:208-211`) so it composes with the
existing harness via the same `tools` slot of `HarnessConfig`
(`packages/harness/src/types.ts:5-26`). `task` shows up in
`listAvailable` like any other tool, and `execute` dispatches to
`runSubagent`.

`HarnessTurnContext` is the shared infrastructure bundle the parent
already considers safe to pass down (workspace VFS, session/user/
workspace IDs, OpenRouter client, structured logger, abort signal —
see "Isolation rules" below). Its concrete shape lives outside this
package (`@agent-assistant/turn-context`); this design only requires
that `runSubagent` accept whatever the parent already has.

## Isolation rules (state filter)

Mirrors deepagents' `_EXCLUDED_STATE_KEYS` (subagents.py:184-191).
When the parent invokes a subagent, the runner clones the parent
context and **strips** these keys before passing them to the
subagent:

| Key                  | Why excluded                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `messages`           | Subagent gets a fresh message list seeded only with its system prompt + the `description` field.  |
| `todos`              | Subagent doesn't see / can't modify the parent's plan.                                             |
| `structuredResponse` | Subagent's structured response is local; not merged back into parent state.                       |
| `skillsMetadata`     | Skills middleware is parent-only; subagents that need skills load their own.                      |
| `memoryContents`     | Subagent does **not** inherit recalled memory; must call `memory_recall` itself if in allowlist.   |

Compare: deepagents performs the same filter twice — once on the
state *passed to* the subagent (`_validate_and_prepare_state`,
subagents.py:420-426) and once on the state *returned from* the
subagent (`_return_command_with_state_update`, subagents.py:389-418).
Our TS port does the inbound filter; the outbound filter is moot
because `TaskToolResult` is a flat object (no merging back into
parent execution state).

What **is** shared (passed by reference, not copied):

- Workspace VFS handle.
- Session / user / workspace / thread IDs (for tracing + audit).
- OpenRouter client (cost accounting rolls up to the same workspace).
- Structured logger.
- Abort signal — cancelling the parent cancels in-flight subagents.

This matches deepagents' implicit sharing model: anything attached to
`runtime` rather than `runtime.state` flows through.

## Parallel fan-out

When the model emits a `tool_request` batch
(`HarnessToolRequestOutput`, types.ts:140-145) containing multiple
`task` calls, the harness runner executes them in **parallel**: one
Promise per call, aggregated via `Promise.allSettled`. Results are
stitched back into the transcript in the same order as the original
calls so `HarnessToolResultStep` ordering (types.ts:322-326) stays
deterministic.

Concurrency cap: respected per the parent's existing
`HarnessLimits.maxToolCalls` (types.ts:43-49). No new knob; if a batch
of 10 task calls would exceed the budget, the parent's existing
limit-reached path triggers (`HarnessLimitReachedEvent`,
types.ts:497-505).

deepagents' equivalent: the LangGraph runtime invokes tools in
parallel by default; the subagent middleware is agnostic and just
exposes the tool. Our parallelism lives in the harness runner, not in
the registry — `createSubagentToolRegistry` only needs to be safe to
call concurrently from multiple `execute` invocations.

## Error propagation contract

A subagent that throws / hits its iteration cap / produces invalid
output yields:

```ts
{
  ok: false,
  error: { message: '<reason>', code: '<code>' },
  iterations,
  subagent,
}
```

Codes (initial set):

| Code              | Cause                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| `unknown_subagent`| `subagent_type` not in registry. Mirrors deepagents subagents.py:433-435.            |
| `max_iterations`  | Subagent hit its `maxIterations` cap without producing a final answer.               |
| `subagent_threw`  | Caller-provided `runSubagent` rejected.                                              |
| `aborted`         | Parent abort signal fired mid-subagent.                                              |
| `invalid_output`  | Subagent produced an `HarnessInvalidOutput` (types.ts:168-188) on its final step.    |

The parent sees this as a regular `HarnessToolResult` with
`status: 'success'` and a structured `output` JSON — the **subagent
failed**, but the **task tool call succeeded** in the sense that it
returned a well-formed result. The parent turn does not transition to
`failed` (types.ts:359-364) on subagent failure; it decides what to
do next (retry with a different subagent, give up, ask user).

(Why `status: 'success'` and not `'error'`? `HarnessToolResult.status`
is the harness's own retry signal — `error` + `retryable: true`
triggers `toolRetryConfig` (types.ts:28-41). We don't want subagent
failures to drive the harness's tool-retry loop; we want the model to
reason about them. So the failure is encoded in the `output` payload,
not in `status`.)

## Tool name + schema

Tool name: **`task`**. Matches deepagents
(`StructuredTool.from_function(name="task", ...)`, subagents.py:463-470)
and Anthropic's Agent SDK convention.

Description embeds the registered subagents' names + descriptions so
the model picks one. Same template strategy as deepagents — see
`TASK_TOOL_DESCRIPTION` (subagents.py:206) and the
`{available_agents}` substitution (subagents.py:379-387).

Inputs (mirrors `TaskToolSchema`, subagents.py:194-203):

```jsonc
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "Detailed brief for the subagent: full context, what to do, expected output format. Phrase as if to a fresh assistant."
    },
    "subagent_type": {
      "type": "string",
      "enum": ["<registered subagent names>"],
      "description": "Which subagent to invoke."
    }
  },
  "required": ["description", "subagent_type"]
}
```

The enum is generated at registry-construction time from
`options.subagents`; when the parent's `listAvailable` runs, the
schema is already concrete.

## Open questions

- **Does `HarnessTurnContext` currently expose enough infrastructure
  to spawn an isolated turn**, or does this require adding a
  runner-factory hook? The harness today is constructed once via
  `HarnessConfig` (types.ts:5-26) and runs one turn at a time; nothing
  in the public types lets a tool synthesize a nested
  `HarnessTurnInput`. Two plausible shapes:
  1. Caller wires their own `runSubagent` that re-instantiates a
     harness with a filtered tool registry. Simple, no harness
     changes; design doc assumes this.
  2. Add a `harness.spawnNested(...)` hook that reuses the parent's
     model adapter / trace sink with overridden limits + tool list.
     Cleaner DX but couples the registry helper to harness internals.
  Decision deferred to step `aa-02-harness-internals`; this design
  is compatible with either path because `runSubagent` is an opaque
  function injected by the caller.

- **Naming: `task` (deepagents) vs. `delegate` vs. `spawn_subagent`.**
  Recommend **`task`** to match deepagents (subagents.py:464) and
  the public Anthropic Agent SDK / Claude Code docs convention. The
  model has training-data familiarity with this name; renaming buys
  nothing.

## Patterns deferred (NOT in this design)

- **Subagent state persistence across turns.** deepagents threads
  subagent state back through the parent's LangGraph state
  (`_return_command_with_state_update`, subagents.py:389-418). All of
  sage's current use cases are single-turn fan-out; persistence adds
  significant complexity (where do we store it? how does it interact
  with `HarnessContinuation`, types.ts:291-300?) for no near-term
  win.
- **Subagent-to-subagent calls.** Forbidden in v1: only the parent
  can call `task`. Subagents that need delegation have to be promoted
  to the parent's tool list. (deepagents allows this transitively but
  it complicates the abort-signal + budget-rollup story.)
- **Per-subagent memory namespace.** Subagents share the workspace
  memory store; isolation is on `memoryContents` (recalled-into-state)
  only, not on the underlying store. Per-subagent namespacing can be
  added later as a `HarnessSubagent.memoryNamespace?: string` field
  without breaking the API.

## Test posture

See companion test file `aa-05-tests-subagent.ts`. Cases:

1. **Isolation** — parent state mutation between
   `runSubagent` invocation and resolution doesn't leak into the
   subagent's view (the registry must clone, not alias). Mirrors the
   guarantee of `_validate_and_prepare_state` (subagents.py:420-426).
2. **Parallel fan-out** — two `task` calls in one
   `HarnessToolRequestOutput` batch (types.ts:140-145) run
   concurrently (assert via overlapping fake-timer windows or
   Promise-resolution-order assertions).
3. **Error propagation** — a subagent whose `runSubagent` rejects
   yields `{ ok: false, code: 'subagent_threw' }`; the parent turn
   continues to the next iteration without transitioning to
   `outcome: 'failed'` (types.ts:359-364).
4. **Max-iteration cap** — a subagent that loops gets cut off at
   `maxIterations`, returns `{ ok: false, code: 'max_iterations' }`.
   Telemetry: `iterations` field equals the cap.
5. **Allowlist enforcement** — a subagent attempting a tool outside
   its `toolAllowlist` gets a clean refusal from the inner harness
   (treated as `tool_unavailable`, types.ts:366-380), surfaced to the
   parent as a successful `task` result containing the refusal text —
   *not* a runtime crash in `createSubagentToolRegistry`.
