# Sage v2 Substrate Executor Self-Reflection

Date: 2026-05-07

Audience: workflow owner, lead reviewer, and future agents picking up the Sage
v2 substrate extraction.

This document reflects on the implementation I landed in Agent Assistant for
the Sage v2 substrate extraction. It is intentionally about substrate only. I
am excluding workflow artifacts such as `.trajectories/*`, `.ricky/`, and
`tmp/`, because they are execution traces rather than reusable runtime code.

## Verification Summary

I verified the implementation with targeted workspace tests and builds:

- `npm test -w @agent-assistant/harness` -> 43 files, 416 tests passed
- `npm test -w @agent-assistant/telemetry` -> 12 files, 47 tests passed
- `npm test -w @agent-assistant/turn-context` -> 3 files, 9 tests passed
- `npm test -w @agent-assistant/vfs` -> 6 files, 44 tests passed
- `npm run build -w @agent-assistant/harness` -> passed
- `npm run build -w @agent-assistant/telemetry` -> passed
- `npm run build -w @agent-assistant/turn-context` -> passed
- `npm run build -w @agent-assistant/vfs` -> passed

## Exact Files Changed By Slice

### Slice 1: Nested subagent runner substrate

Production files:

- `packages/harness/src/nested-subagent-runner.ts`
- `packages/harness/src/subagent-registry.ts`
- `packages/harness/src/registries/index.ts`

Package/export wiring:

- `packages/harness/src/index.ts`

Tests:

- `packages/harness/src/nested-subagent-runner.test.ts`
- `packages/harness/src/subagent-registry.test.ts`

### Slice 2: Runtime budget policy primitives

Production files:

- `packages/harness/src/runtime-policy/index.ts`
- `packages/harness/src/harness.ts`
- `packages/harness/src/types.ts`

Package/export wiring:

- `packages/harness/package.json`
- `packages/harness/src/index.ts`

Tests:

- `packages/harness/src/runtime-policy.test.ts`
- `packages/harness/src/runtime-policy.integration.test.ts`
- `packages/harness/src/subpath-exports.test.ts`

### Slice 3: Subagent and runtime-policy telemetry vocabulary

Production files:

- `packages/telemetry/src/events.ts`
- `packages/telemetry/src/harness-bridge.ts`
- `packages/telemetry/src/sinks/console.ts`
- `packages/telemetry/src/sinks/types.ts`

Package/export wiring:

- `packages/telemetry/package.json`
- `packages/telemetry/src/index.ts`

Tests:

- `packages/telemetry/test/harness-bridge.test.ts`
- `packages/telemetry/test/private_content_never_leaks.test.ts`
- `packages/telemetry/test/runtime-policy-events.test.ts`
- `packages/telemetry/test/subagent-events.test.ts`

### Slice 4: Eval substrate

Production files:

- `packages/telemetry/src/evals/eval-checks.ts`
- `packages/telemetry/src/evals/eval-runner.ts`
- `packages/telemetry/src/evals/index.ts`
- `packages/telemetry/src/evals/pr-comment-format.ts`

Package/export wiring:

- `packages/telemetry/package.json`
- `packages/telemetry/src/index.ts`

Tests:

- `packages/telemetry/test/eval-runner.test.ts`
- `packages/telemetry/test/pr-comment-format.test.ts`

### Slice 5: Insight envelope and reader helpers

Production files in `@agent-assistant/vfs`:

- `packages/vfs/src/insight/envelope.ts`
- `packages/vfs/src/insight/index.ts`
- `packages/vfs/src/insight/reader.ts`
- `packages/vfs/src/index.ts`

Production files in `@agent-assistant/turn-context`:

- `packages/turn-context/src/insight-projection.ts`
- `packages/turn-context/src/projection.ts`
- `packages/turn-context/src/types.ts`
- `packages/turn-context/src/index.ts`
- `packages/turn-context/src/vfs-insight-types.d.ts`

Package wiring:

- `packages/turn-context/package.json`

Tests:

- `packages/vfs/src/insight/reader.test.ts`
- `packages/turn-context/src/insight-projection.test.ts`

### Shared support changes around the slice rollout

These were not substrate primitives themselves, but they were part of the
extraction delivery:

- `package-lock.json`
- `workflows/generated/sage-v2-substrate-extraction-pr.ts`
- `workflows/lib/agent-assistant-repo-setup.ts`
- `docs/architecture/sage-v2-substrate-implementation-plan.md`
- `docs/architecture/sage-v2-substrate-lead-reflection.md`

## Tests Added Or Updated

### Added

- `packages/harness/src/nested-subagent-runner.test.ts`
- `packages/harness/src/runtime-policy.test.ts`
- `packages/harness/src/runtime-policy.integration.test.ts`
- `packages/telemetry/test/eval-runner.test.ts`
- `packages/telemetry/test/pr-comment-format.test.ts`
- `packages/telemetry/test/private_content_never_leaks.test.ts`
- `packages/telemetry/test/runtime-policy-events.test.ts`
- `packages/telemetry/test/subagent-events.test.ts`
- `packages/turn-context/src/insight-projection.test.ts`
- `packages/vfs/src/insight/reader.test.ts`

### Updated

- `packages/harness/src/subagent-registry.test.ts`
- `packages/harness/src/subpath-exports.test.ts`
- `packages/telemetry/test/harness-bridge.test.ts`

## Acceptance Coverage

### PR 1: Nested subagent runner helper

Acceptance item: a product can create a `task` tool with
`createSubagentToolRegistry` and a first-party nested runner helper.

Coverage:

- `packages/harness/src/nested-subagent-runner.ts` provides
  `createNestedSubagentRunner`.
- `packages/harness/src/registries/index.ts` and `packages/harness/src/index.ts`
  export it as first-party API.
- `packages/harness/src/nested-subagent-runner.test.ts` covers the happy-path
  registry integration in `success_returns_flat_result`.

Acceptance item: the nested runner starts a fresh harness turn with filtered
parent context.

Coverage:

- `createNestedSubagentRunner` calls `filterParentContextForSubagent` before
  creating the child harness.
- `nested-subagent-runner.test.ts` verifies filtered context in
  `success_returns_flat_result` and `parent_context_is_filtered`.

Acceptance item: the subagent sees only its allowlisted tools.

Coverage:

- The runner passes `allowedToolNames` into the child `HarnessTurnInput`.
- `tool_allowlist_enforced` proves the child harness only receives
  `memory_recall`.

Acceptance item: parent cancellation cancels nested turns.

Coverage:

- The runner forwards `signal` to child harness construction and execution.
- `parent_cancellation_propagates` verifies the nested run resolves as
  cancelled when the parent aborts.

Acceptance item: tests prove success, unknown subagent, subagent failure,
max-iteration failure, and parallel task batches.

Coverage:

- `success_returns_flat_result`
- `unknown_subagent_returns_ok_false`
- `subagent_failure_is_isolated`
- `max_iterations_failure`
- `parallel_task_batch`

I also added a Workers-specific construction guard test and an explicit
allowlist enforcement test, both of which were useful extra coverage beyond the
acceptance list.

### PR 2: Runtime budget policy

Acceptance item: duplicate tool calls can return cached turn-scoped results.

Coverage:

- `packages/harness/src/runtime-policy/index.ts` implements turn-local stable
  cache keys and cloned cached results.
- `runtime-policy.test.ts` covers cache behavior directly.
- `runtime-policy.integration.test.ts` proves cache hits avoid extra upstream
  tool execution and logical budget burn.

Acceptance item: todo rewrites can be capped.

Coverage:

- `todoRewriteCap` is implemented in `runtime-policy/index.ts`.
- `runtime-policy.integration.test.ts` verifies only two writes execute while
  the turn still reaches final synthesis.

Acceptance item: reserve-floor policy can stop broad tool calls while allowing
synthesis.

Coverage:

- `reserveFloor` is implemented in `runtime-policy/index.ts`.
- `runtime-policy.integration.test.ts` verifies broad enumeration stops at the
  floor and the harness emits salvaged synthesis.

Acceptance item: drill-or-stop policy can reject repeated broad listing after
candidate results.

Coverage:

- Candidate extraction and drilldown detection live in
  `runtime-policy/index.ts`.
- `runtime-policy.test.ts` covers the primitive directly.
- `runtime-policy.integration.test.ts` verifies a second broad list is blocked
  until the model drills into `package.json`.

Acceptance item: output sanitizer removes raw pseudo-tool XML from final text.

Coverage:

- `sanitizePseudoToolBlocks` and the final-output sanitizer live in
  `runtime-policy/index.ts`.
- `runtime-policy.test.ts` covers nested pseudo-tool markup and fenced payloads.
- `runtime-policy.integration.test.ts` proves the final assistant text is
  rewritten before result publication.

Acceptance item: every policy intervention emits a structured trace or
telemetry event.

Coverage:

- `packages/harness/src/types.ts` adds runtime policy trace-event shapes.
- `packages/harness/src/harness.ts` emits policy events during tool execution
  and final synthesis salvage.
- `runtime-policy.integration.test.ts` asserts those trace emissions.
- Slice 3 then bridges those trace events into typed telemetry payloads.

### PR 3: Telemetry event vocabulary

Acceptance item: typed event constructors exist for subagent lifecycle and
runtime-policy events.

Coverage:

- `packages/telemetry/src/events.ts` implements constructors for
  `subagent.started`, `subagent.finished`, `subagent.failed`,
  `subagent.batch.started`, `runtime_policy.blocked`,
  `runtime_policy.cache_hit`, `runtime_policy.output_sanitized`, and
  `synthesis.salvaged`.
- `runtime-policy-events.test.ts` and `subagent-events.test.ts` assert stable,
  frozen payloads.

Acceptance item: harness bridge can include policy/subagent metadata without
logging raw private content.

Coverage:

- `packages/telemetry/src/harness-bridge.ts` maps subagent trace metadata and
  runtime-policy trace events into privacy-safe telemetry.
- `harness-bridge.test.ts` covers subagent lifecycle mapping and policy-event
  bridging.
- `private_content_never_leaks.test.ts` verifies forbidden metadata keys are
  rejected or stripped rather than serialized.

Acceptance item: memory and console sinks can receive the new events.

Coverage:

- `packages/telemetry/src/sinks/types.ts` widens the sink contract to the new
  event union.
- `packages/telemetry/src/sinks/console.ts` treats non-`turn.finished` events
  as first-class payloads instead of special-casing them away.
- `runtime-policy-events.test.ts` proves the in-memory sink round-trips the new
  event kinds.

This is covered functionally for the generic sink contract, although I did not
add a console-specific regression that snapshots a new runtime-policy or
subagent event line.

Acceptance item: tests assert event shape stability.

Coverage:

- `runtime-policy-events.test.ts`
- `subagent-events.test.ts`
- `harness-bridge.test.ts`
- `private_content_never_leaks.test.ts`

### PR 4: Eval runner substrate

Acceptance item: a local fixture runner can execute assistant turn cases with
mocked providers.

Coverage:

- `packages/telemetry/src/evals/eval-runner.ts` defines the runner contract and
  suite execution.
- `eval-runner.test.ts` uses a synthetic runner backed by fixture data rather
  than real providers.

Acceptance item: result JSON includes pass/fail, score components, required
evidence checks, forbidden behavior checks, cost, latency, and tool-call
counts.

Coverage:

- `EvalResult` in `eval-runner.ts` includes all of those fields.
- `eval-checks.ts` implements required-evidence, forbidden-fanout, budget, and
  final-output-clean checks.
- `eval-runner.test.ts` asserts success, evidence failure, fanout failure,
  budget failure, dirty-output failure, and deterministic ordering.

Acceptance item: the runner can produce a compact PR-comment summary.

Coverage:

- `packages/telemetry/src/evals/pr-comment-format.ts` formats summary output.
- `pr-comment-format.test.ts` asserts the summary stays under the size cap,
  uses compact failure details, and orders failures before passes.

The eval substrate is intentionally generic. It does not encode Sage fixtures,
Sage scoring thresholds, or Sage workspace evidence paths.

### PR 5: Insight envelope and reader helpers

Acceptance item: `InsightEnvelope` parses valid and partial artifacts.

Coverage:

- `packages/vfs/src/insight/envelope.ts` defines the substrate envelope shape.
- `packages/vfs/src/insight/reader.ts` handles valid, missing, malformed, and
  unsupported-schema cases, including partial-field salvage from malformed
  JSON.
- `reader.test.ts` covers each of those paths.

Acceptance item: reader helpers preserve `generatedAt`, `sourceProvider`, and
`sourcePaths`.

Coverage:

- `reader.test.ts` verifies those fields survive parsing.
- `packages/turn-context/src/insight-projection.ts` preserves them when
  converting the envelope into a prepared context block.
- `insight-projection.test.ts` verifies provenance metadata and freshness are
  retained.

Acceptance item: turn-context can accept selected insights as prepared context
blocks with provenance.

Coverage:

- `projectInsightAsContextBlock` returns a `TurnPreparedContextBlock` with
  provenance in `metadata`.
- `packages/turn-context/src/projection.ts` now preserves block metadata when
  projecting to the canonical execution-request shape.
- `packages/turn-context/src/types.ts` now allows prepared-context block
  metadata.

Acceptance item: tests prove malformed insight JSON fails gracefully.

Coverage:

- `reader.test.ts` includes malformed JSON and partial-artifact cases that
  return structured failure instead of throwing.

## Cloudflare Workers Fetch Compatibility Evidence

The short version is that this implementation did not introduce new HTTP call
sites in the Sage v2 substrate slices, and I still added explicit protection
against accidental bare-fetch capture.

Evidence:

1. The new slice implementation files do not contain production `fetch`
   references. A targeted `rg` across the changed slice files only surfaced
   fetch mentions in tests:
   `packages/harness/src/nested-subagent-runner.test.ts` and
   `packages/harness/src/runtime-policy.test.ts`.
2. `packages/harness/src/nested-subagent-runner.test.ts` includes
   `workers_fetch_compatibility`, which replaces `globalThis.fetch` with a
   throwing getter and proves `createNestedSubagentRunner` does not read fetch
   at construction time.
3. `packages/harness/src/runtime-policy.test.ts` includes
   `does not capture bare fetch in runtime-policy modules`, which scans the
   runtime-policy source and rejects `= fetch` and `?? fetch` patterns.
4. The pre-existing harness Workers regression suite also stayed green inside
   the full harness run, including
   `packages/harness/src/adapter/openrouter-model-adapter.workers-fetch.test.ts`
   and the direct-provider streaming Workers-fetch tests.
5. The repo rule in `.claude/rules/workers-fetch.md` remained satisfied: when a
   fetch override is needed elsewhere in the repo, the existing approved
   pattern is the call-time lambda
   `((input, init) => globalThis.fetch(input, init))`, not a stored bare
   reference.

Because the substrate slices themselves are fetch-free, the compatibility
evidence here is mainly negative proof plus regression coverage, not a new HTTP
path-specific swap test.

## Residual Risks And Deferred Sage-Owned Behavior

### Residual substrate risks

- `subagent.batch.started` exists as typed telemetry vocabulary, but it is not
  yet emitted automatically by the harness or the telemetry bridge. The
  constructor and sink support are in place; the trace source is not.
- Console-sink compatibility for new event kinds is implemented generically,
  but I did not add a console-specific assertion that snapshots emitted
  subagent/runtime-policy log lines.
- The eval substrate is fixture-oriented, not a full end-to-end harness runner
  that boots real model adapters, tool registries, or workspace fixtures.
- Insight parsing is schema-tolerant and provenance-preserving, but it does not
  decide relevance ranking, stale-data wording, or insight selection policy.

### Deliberately deferred Sage-owned behavior

- No Sage subagent roster, prompts, tone, or delegation heuristics were moved
  into `@agent-assistant/*`.
- No Sage-specific runtime categories such as a baked-in definition of
  "broad", "planner", or "competitor research" were added. Consumers must
  supply tool names, categories, candidate extraction, and guard logic.
- No Sage workspace fixtures, eval thresholds, or expected evidence paths were
  added to the eval substrate.
- No Sage-specific insight selection or fallback ordering was added to
  `@agent-assistant/vfs` or `@agent-assistant/turn-context`.
- No `SAGE_*` flags or downstream workflow semantics were introduced into the
  substrate packages.

## Summary

I completed all five extraction slices as reusable Agent Assistant substrate,
kept the product boundary intact, and verified the result with passing tests and
builds across `harness`, `telemetry`, `turn-context`, and `vfs`.

Artifacts produced:

- `docs/architecture/sage-v2-substrate-executor-reflection.md`

EXECUTOR_SELF_REFLECTION_COMPLETE
