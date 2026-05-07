# Sage v2 Nested Subagent Runner Plan (PR 1)

Date: 2026-05-07

Status: IMPLEMENTATION_READY.

Source: `tmp/sage-v2-nested-runner-workflow/source-context.md`, plus the
existing `docs/architecture/sage-v2-substrate-extraction-map.md` and
`docs/architecture/sage-v2-substrate-implementation-plan.md` (slice #1
only).

## Purpose

Sage PR #208 proves that products built on `@agent-assistant/harness` need a
default nested-harness runner to plug into `createSubagentToolRegistry`'s
`runSubagent` seam. Today every consumer hand-rolls that runner. This PR
extracts the smallest reusable mechanism that builds an isolated nested
harness turn around an existing `HarnessSubagent`, preserves parent trace
identifiers, applies the subagent tool allowlist, and returns a flat
`TaskToolResult`-compatible value.

This PR is substrate-only. It MUST NOT encode Sage product behavior.

## Scope And Ownership

### In scope (this PR)

- A first-party helper in `@agent-assistant/harness` whose only job is to
  return a `runSubagent` implementation suitable for
  `createSubagentToolRegistry({ runSubagent })`.
- Two caller-supplied seams: `createHarness(input)` and
  `composeInstructions(input)`. The helper owns nothing about which model,
  prompt text, or tool registry the nested harness uses.
- Deterministic child trace-id and child turn-id derivation from the parent
  context.
- Allowlist enforcement: the nested turn is invoked with
  `allowedToolNames = subagent.toolAllowlist`.
- Parent-context filtering via the existing
  `filterParentContextForSubagent` helper (no new keys added).
- Translation of `HarnessResult` outcomes into the existing
  `TaskToolResult` shape: success, max-iteration failure, cancellation,
  invalid-output, generic subagent error, and thrown errors caught at the
  runner boundary.
- Wiring the new export through `packages/harness/src/index.ts` and
  `packages/harness/src/registries/index.ts` so it is reachable from both
  the deprecated root entry and the `@agent-assistant/harness/registries`
  subpath.

### Out of scope (must NOT land in this PR)

The following are explicitly deferred and remain owned by downstream
products (Sage today, others later):

- Sage product prompts, tone, capability matrix language, delegation
  heuristics, `slack-runner` clauses, or any text fragment that names a
  Sage workflow.
- Roster definitions: `slack-researcher`, `competitor-researcher`,
  `github-investigator`, `linear-investigator`, `planner`, `doc-drafter`,
  `notion-librarian`, `notion-page-writer`, `web-researcher`,
  `repo-sandbox-researcher`, `qa-verifier`. The helper accepts a
  `HarnessSubagent` value; it does not create one.
- Slack channel semantics, Notion page/database semantics, GitHub/Linear
  product workflows.
- Work-mode classifiers (chat / single-tool / research / write / unsafe).
- Runtime budget policy primitives (todo rewrite caps, tool-result cache,
  drill-or-stop, output sanitizer). PR 2.
- Telemetry vocabulary for `subagent.*` / `runtime_policy.*` events.
  PR 3. The runner emits no new event kinds; existing `trace` events on
  the nested `HarnessRuntime` continue to flow through the caller-supplied
  config.
- Eval runner contracts. PR 4.
- Insight envelope contracts. PR 5.
- `SAGE_HARNESS_SUBAGENTS_ENABLED` or any `SAGE_*` flag.
- Sage open-issue numbers as identifiers in shared code, fixtures, or
  tests.

## Public API Shape

The smallest reusable surface, defined in
`packages/harness/src/nested-subagent-runner.ts`:

```ts
export interface CreateNestedHarnessInput {
  subagent: HarnessSubagent;
  parentContext: HarnessTurnContext;
  parentTraceId: string;
  filteredParentContext: HarnessTurnContext;
  toolAllowlist: ReadonlySet<string>;
  signal?: AbortSignal;
}

export interface ComposeNestedSubagentInstructionsInput {
  subagent: HarnessSubagent;
  taskInput: TaskToolInput;
  parentContext: HarnessTurnContext;
}

export interface CreateNestedSubagentRunnerOptions {
  createHarness(input: CreateNestedHarnessInput): HarnessRuntime;
  composeInstructions(
    input: ComposeNestedSubagentInstructionsInput,
  ): HarnessInstructions;
  now?(): string;
}

export function createNestedSubagentRunner(
  options: CreateNestedSubagentRunnerOptions,
): CreateSubagentToolRegistryOptions['runSubagent'];
```

Behavioral contract:

1. The returned function is the exact `runSubagent` shape that
   `createSubagentToolRegistry` already consumes; no changes to
   `subagent-registry.ts` are required.
2. On every invocation the runner:
   - resolves `parentTraceId` from `input.parentTraceId`,
     `parentContext.traceId`, `parentContext.parentTraceId`,
     `parentContext.childTraceId`, the equivalent `metadata.*` fields,
     then falls back to `parentContext.turnId`;
   - allocates a deterministic child id pair
     `childTraceId = ${parentTraceId}.sa-${n}` and
     `childTurnId   = ${parentContext.turnId}.sa-${n}`;
   - calls `filterParentContextForSubagent(parentContext)` and forwards
     both the raw and filtered contexts into `createHarness`;
   - calls `composeInstructions` to obtain the nested
     `HarnessInstructions`;
   - constructs a `HarnessTurnInput` whose `allowedToolNames` is the
     subagent's `toolAllowlist` and whose `metadata` carries
     `parentTraceId`, `childTraceId`, `subagentName` alongside the parent
     metadata;
   - awaits `runtime.runTurn(turnInput)` and translates the result.
3. Result translation rules (no new fields on `TaskToolResult`):
   - `outcome === 'completed' && stopReason === 'answer_finalized'` →
     `{ ok: true, output: assistantMessage.text ?? '', iterations, subagent }`.
   - `stopReason === 'max_iterations_reached'` →
     `{ ok: false, error: { code: 'max_iterations', message }, iterations, subagent }`.
   - `stopReason === 'cancelled'` →
     `{ ok: false, error: { code: 'aborted', message }, iterations, subagent }`.
   - `stopReason === 'model_invalid_response'` →
     `{ ok: false, error: { code: 'invalid_output', message }, iterations, subagent }`.
   - any other non-success outcome → `error.code = 'subagent_error'` with
     a stop-reason-derived message.
   - thrown error → caught at the runner boundary and classified into
     `aborted` (AbortError), `max_iterations` (message contains
     `max_iterations`), or `subagent_error`.

The exported types are structural; downstream products keep ownership of
which `HarnessRuntime` they construct, which prompt they compose, and how
they wire model adapters.

## Files Likely To Change

Created:

- `packages/harness/src/nested-subagent-runner.ts` — the helper.
- `packages/harness/src/nested-subagent-runner.test.ts` — Vitest suite
  covering the cases in the **Tests** section.

Modified:

- `packages/harness/src/index.ts` — re-export
  `createNestedSubagentRunner` and the three new option/input types
  (kept behind the existing root-import deprecation warning so consumers
  migrate to the `/registries` subpath over time).
- `packages/harness/src/registries/index.ts` — first-class export of
  `createNestedSubagentRunner` plus
  `CreateNestedSubagentRunnerOptions`, `CreateNestedHarnessInput`,
  `ComposeNestedSubagentInstructionsInput`.
- `packages/harness/src/subpath-exports.test.ts` — assert the new
  subpath export is reachable.

Not modified in this PR:

- `packages/harness/src/subagent-registry.ts` — already exposes
  `RunSubagentInput`, `RunSubagentResult`, `TaskToolInput`,
  `TaskToolResult`, `HarnessTurnContext`,
  `filterParentContextForSubagent`, and
  `SUBAGENT_EXCLUDED_PARENT_KEYS`. No surface changes are required.
- `packages/harness/src/types.ts` — no new exported types added; the
  helper consumes `HarnessRuntime`, `HarnessInstructions`,
  `HarnessResult`, `HarnessStopReason`, and `HarnessTurnInput` as-is.
- `packages/harness/package.json` — no new exports field entries.
  `./registries` already covers the subpath.

## Tests (Vitest, run by `npm --workspace packages/harness test`)

Each test lives in `packages/harness/src/nested-subagent-runner.test.ts`
and uses fakes for `createHarness` so no real model adapter or network is
exercised.

1. `success_returns_flat_result`
   - Configure `createHarness` to return a `HarnessRuntime` whose
     `runTurn` resolves with `outcome: 'completed'`,
     `stopReason: 'answer_finalized'`, `assistantMessage.text:
     'draft ready'`, `traceSummary.iterationCount: 2`.
   - Drive through `createSubagentToolRegistry.execute` with a
     well-formed `task` call.
   - Assert `parseTaskResult(result) ===
     { ok: true, output: 'draft ready', iterations: 2, subagent }`.
   - Assert `createHarness` saw `parentTraceId` resolved from
     `parentContext.traceId`, `toolAllowlist` equal to
     `new Set(subagent.toolAllowlist)`, and a `filteredParentContext`
     missing every key in `SUBAGENT_EXCLUDED_PARENT_KEYS`.
   - Assert the synthesized `HarnessTurnInput` has
     `turnId === parentTurnId.sa-1`,
     `allowedToolNames === [...toolAllowlist]`,
     `instructions.systemPrompt` matches what `composeInstructions`
     returned, and `metadata.parentTraceId / childTraceId / subagentName`
     are present.

2. `unknown_subagent_returns_ok_false`
   - Drive `task` with `subagent_type: 'missing'`.
   - Assert `createHarness` is **not** called (the registry handles
     unknown lookup before delegating to the runner).
   - Assert
     `{ ok: false, error: { code: 'unknown_subagent', message }, iterations: 0, subagent: 'missing' }`.

3. `subagent_failure_is_isolated`
   - `createHarness` returns a runtime whose `runTurn` throws.
   - Run inside a real parent harness whose model emits a `task` call
     followed by a `final_answer`.
   - Assert the parent completes with `stopReason: 'answer_finalized'`
     and the child `task` tool result has
     `error.code === 'subagent_error'`.

4. `max_iterations_failure`
   - `runTurn` resolves with `outcome: 'deferred'`,
     `stopReason: 'max_iterations_reached'`,
     `traceSummary.iterationCount: 3`.
   - Assert
     `{ ok: false, error: { code: 'max_iterations', message }, iterations: 3, subagent }`.

5. `parent_cancellation_propagates`
   - `runTurn` waits on `signal.aborted` and resolves with
     `stopReason: 'cancelled'` once aborted.
   - Pass a parent `AbortController` through the execution context;
     abort it after the `execute` call begins.
   - Assert the runner forwarded the same `signal` into
     `createHarness` and that the result has
     `error.code === 'aborted'`.

6. `tool_allowlist_enforced`
   - `createHarness` returns a real `createHarness` instance whose tool
     registry implements `listAvailable(input)` honoring
     `input.allowedToolNames`.
   - Drive a `task` call and assert the nested model only sees the
     allowlisted tools.

7. `parent_context_is_filtered`
   - Assert that for every key in `SUBAGENT_EXCLUDED_PARENT_KEYS`,
     neither `input.parentContext` (after filtering) nor
     `input.filteredParentContext` contains it.

8. `workers_fetch_compatibility`
   - Replace `globalThis.fetch` with a getter that throws if read.
   - Construct the runner. Assert it does not throw and the getter is
     never invoked. The runner must not capture `fetch` at construction
     time; it must not even reference it. Restoration happens in the
     test's `finally`.

9. `parallel_task_batch`
   - Build a parent harness whose first model step emits a
     `tool_request` with two `task` calls referencing two different
     subagents.
   - The faked `runTurn` records start/finish events with a 50ms delay.
   - Assert the recorded order is
     `start:A, start:B, finish:A, finish:B` (proves parallel execution),
     elapsed time is below `2 × delay`, and the registered tool exposes
     `executionMode: 'parallel'` (already provided by
     `createSubagentToolRegistry`).

## Cloudflare Workers Fetch Compatibility

This PR adds no new HTTP boundary. The runner only orchestrates
caller-supplied `HarnessRuntime` instances. To stay safe for Workers
consumers (cloud/specialist-worker, Sage, relayfile, cataloging-agent,
web), the implementation MUST:

- Avoid every form of bare `fetch` capture: no `const f = fetch`, no
  `import { fetch } from ...`, no constructor argument stored as
  `this.fetchImpl = fetch`, no top-level `fetch.bind(globalThis)`.
- Avoid any module-load side effects that read `globalThis.fetch`. The
  helper must work when imported under a getter that throws on read,
  which the `workers_fetch_compatibility` test enforces.
- Defer all I/O to the caller's `createHarness` factory. Any Worker
  runtime concerns live in the model adapter the caller injects, not in
  this helper.

If a future revision adds an HTTP fallback, it must follow the lambda
pattern documented in `.claude/rules/workers-fetch.md`:
`(options.fetch ?? globalThis.fetch)(input, init)` resolved at call time,
plus a regression test that swaps `globalThis.fetch` after module load.

## 80-to-100 Validation Gates

The PR is not "done at 80%" when types compile. It must pass every gate
below before merge. Each gate is a deterministic command a CI step or a
reviewer can run.

1. **Build clean.** `npm --workspace packages/harness run build`
   succeeds with no `tsc` errors.
2. **Type-check clean.** `npm --workspace packages/harness run
   typecheck` succeeds.
3. **All harness tests pass.** `npm --workspace packages/harness test`
   passes, including every new case in
   `nested-subagent-runner.test.ts` and the existing
   `subagent-registry.test.ts`.
4. **Subpath export reachable.** `npm --workspace packages/harness test
   -- subpath-exports` passes and demonstrates that
   `import { createNestedSubagentRunner } from
   '@agent-assistant/harness/registries'` resolves to the new helper.
5. **Workers-fetch regression.** The
   `workers_fetch_compatibility` test passes under a getter that throws
   on `globalThis.fetch` access; this gate is the substitute for an
   HTTP-boundary fetch test, since the helper exposes none.
6. **Substrate-only check.** `git grep -nE
   '(slack-researcher|competitor-researcher|github-investigator|linear-investigator|notion-librarian|notion-page-writer|repo-sandbox-researcher|qa-verifier|SAGE_HARNESS_SUBAGENTS_ENABLED|SAGE_)'
   packages/harness` returns no hits inside the runner or its tests.
7. **No new top-level exports beyond the documented surface.** A diff
   review of `packages/harness/src/index.ts` and
   `packages/harness/src/registries/index.ts` shows only the four
   symbols listed under **Files Likely To Change**.
8. **Repo-wide test suite green.** `npm test` (or the workspace-aware
   equivalent already used by CI) passes; downstream packages that
   re-export from `@agent-assistant/harness` (telemetry, turn-context,
   workflows) build without changes.
9. **Manual smoke from the registries subpath.** A reviewer constructs
   a runner with a stub `createHarness`, wires it into
   `createSubagentToolRegistry`, executes a `task` call, and confirms
   the returned `TaskToolResult` shape matches the success and failure
   contracts above without any product-specific wiring. This proves the
   helper is genuinely reusable, not just a Sage-shaped module.

Only after every gate is green is this PR mergeable. PRs 2–5 build on
this slice and assume the API in **Public API Shape** is stable.

SAGE_V2_NESTED_RUNNER_PLAN_READY
