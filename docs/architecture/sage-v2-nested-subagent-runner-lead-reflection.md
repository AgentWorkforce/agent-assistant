# Sage v2 Nested Subagent Runner — Lead Self-Reflection

Date: 2026-05-07

Subject of review: `docs/architecture/sage-v2-nested-subagent-runner-plan.md`

Reference: `docs/architecture/sage-v2-substrate-implementation-plan.md` (slice
#1 of five).

## Verdict

The plan is correctly scoped to PR 1 (nested subagent runner helper). The
"In scope" / "Out of scope" lines, the public API, the file list, and the
80-to-100 gates all stay inside the PR 1 boundary defined by the parent
substrate plan. Verification marker emitted by the verifier
(`SAGE_V2_NESTED_RUNNER_PLAN_VERIFIED`) is consistent with what I see.

That said, several places along the seam between this PR and the rest of
the substrate are easy to over-reach into during implementation. The risks
below are the ones Codex must actively avoid; they are not defects in the
plan, they are temptations the plan creates.

## Scope Check Against PR 1

PR 1 (per `sage-v2-substrate-implementation-plan.md`) is "Nested subagent
runner helper (`@agent-assistant/harness`)." Comparing line-by-line:

- **Public API surface.** Three exported types
  (`CreateNestedHarnessInput`, `ComposeNestedSubagentInstructionsInput`,
  `CreateNestedSubagentRunnerOptions`) plus one factory
  (`createNestedSubagentRunner`). All four live in
  `packages/harness/src/nested-subagent-runner.ts`. No new types added to
  `packages/harness/src/types.ts`. No new keys on `TaskToolResult`. No new
  excluded parent-context keys. No changes to `subagent-registry.ts`.
  This matches PR 1 exactly.
- **File list.** Created: the helper and its Vitest. Modified: root
  `index.ts`, `registries/index.ts`, `subpath-exports.test.ts`. Nothing in
  telemetry, turn-context, vfs, or evals — those belong to PRs 2–5.
- **Out-of-scope list.** Explicitly names PR 2 (runtime budget policy),
  PR 3 (telemetry vocabulary), PR 4 (eval runner), PR 5 (insight
  envelope), plus the entire Sage product surface (roster, prompts, flags,
  issue numbers). This mirrors the parent plan's boundary and protects
  against drift.
- **Gates.** The substrate-only `git grep` gate (#6) and the "no new
  top-level exports beyond the documented surface" gate (#7) are
  PR-1-specific and enforce the boundary mechanically. Good.

I see no out-of-scope deliverable promised in this plan. The scope is
PR 1 only.

## Scope Risks Codex Must Avoid

These are the foreseeable ways an implementer slides past the PR 1
boundary while writing code that "feels like it belongs":

1. **Inventing a default `createHarness` or `composeInstructions`.** The
   plan is explicit that these are caller-supplied seams. Do not ship a
   "convenience default" in `@agent-assistant/harness` that picks a model
   adapter or composes a system prompt. That is product wiring and lives
   in the consumer (Sage today). If a default is genuinely needed for the
   helper's own tests, it must live inside the test file, not be
   exported.

2. **Adding telemetry event kinds.** PR 3 owns `subagent.*` and
   `runtime_policy.*` event vocabulary. The runner emits no new event
   kinds; existing `trace` events on the nested `HarnessRuntime` flow
   through whatever the caller's `createHarness` returns. Do not add a
   `subagent.start` / `subagent.finish` event from inside the runner,
   even if it would make the parallel-execution test easier — record
   start/finish in the test's fake `runTurn`, not in the helper.

3. **Extending `SUBAGENT_EXCLUDED_PARENT_KEYS`.** The plan calls
   `filterParentContextForSubagent` and forwards the result. The
   exclusion set is whatever exists today in `subagent-registry.ts`. Do
   not add new keys (e.g. policy budgets, eval traces, insight envelopes)
   — those keys belong to PRs 2/4/5 and should not be referenced in PR 1
   at all.

4. **Touching `TaskToolResult` shape.** The translation table in the
   plan deliberately uses only the existing error codes
   (`unknown_subagent`, `max_iterations`, `aborted`, `invalid_output`,
   `subagent_error`). Do not introduce a new code (e.g.
   `policy_violation`, `budget_exhausted`) — those are PR 2 vocabulary.

5. **Capturing `fetch` on the runner module.** The Workers-fetch gate
   (#5) and the dedicated test (`workers_fetch_compatibility`) exist
   precisely because nothing in this helper should reference `fetch` at
   all. The runner has no HTTP boundary; if Codex finds itself importing
   or storing `fetch`, the design is wrong, not the constraint. The
   helper must not even read `globalThis.fetch`.

6. **Sage roster/prompt leakage in tests.** Vitest fixtures must use
   neutral subagent names (`example-researcher`, `worker-a`,
   `worker-b`), neutral tool names, and neutral instruction text. Do not
   import Sage roster strings or copy phrases from Sage prompts into
   fixtures, even "as realistic data." Gate #6 (`git grep` for
   `slack-researcher | competitor-researcher | …`) will fail the PR.

7. **Reaching into `subagent-registry.ts`.** The plan states no surface
   changes to that file are required. If a test seems to need a registry
   change to pass, treat that as a signal the test is wrong, not the
   registry. The registry already exposes everything the helper needs
   (`RunSubagentInput`, `RunSubagentResult`, `TaskToolInput`,
   `TaskToolResult`, `HarnessTurnContext`, `filterParentContextForSubagent`,
   `SUBAGENT_EXCLUDED_PARENT_KEYS`).

8. **Adding new top-level exports.** Gate #7 reviews the diff of
   `packages/harness/src/index.ts` and
   `packages/harness/src/registries/index.ts`. Only the four documented
   symbols may be added. Re-exporting `HarnessRuntime`,
   `HarnessInstructions`, or other types "for convenience" is out of
   scope; consumers can import them from their existing locations.

9. **Hand-waving the parallel-execution test.** Gate #9 (manual smoke)
   and test #9 (`parallel_task_batch`) prove the runner is genuinely
   reusable and that `executionMode: 'parallel'` from
   `createSubagentToolRegistry` still works end-to-end. Codex must not
   skip this test or replace it with a unit-level mock that doesn't go
   through the registry — the entire premise of the PR is that the
   helper plugs into the existing `runSubagent` seam without changes.

10. **Premature insight or eval coupling.** PRs 4 and 5 will add insight
    envelopes and eval contracts that touch the `runSubagent` boundary.
    The plan correctly excludes them. Codex must not "leave a hook" in
    the helper for those — no `insightSink?: …` option, no
    `evalContext?: …` field. Add them when PR 4/5 lands, not earlier.

## Process Risks (Not Plan Defects, But Worth Naming)

- **Trajectory contamination.** This repo already contains
  `docs/architecture/sage-v2-substrate-*` documents that describe the
  full five-PR program. A reader (human or model) skimming those before
  implementing PR 1 may unconsciously pull PR 2/3 material into the
  helper. Mitigation: implement directly from
  `sage-v2-nested-subagent-runner-plan.md` and rely on gates #6 and #7
  to catch leakage.
- **"While I'm here" cleanups.** The plan touches `index.ts`,
  `registries/index.ts`, and `subpath-exports.test.ts`. It is tempting
  to also reorder existing exports, fix unrelated lint warnings, or
  refactor the deprecation warning on the root entry. Don't. The PR
  should be a clean diff of the four documented changes plus the new
  helper and test files.
- **Workspace-aware test command.** Gate #8 requires `npm test` (or the
  workspace-aware CI equivalent) to pass. Downstream packages (telemetry,
  turn-context, workflows) re-export from `@agent-assistant/harness`. If
  Codex changes a re-exported symbol's shape, those packages break.
  The plan's "no surface changes to `subagent-registry.ts`" rule plus the
  no-new-exports rule should prevent this, but Codex must actually run
  the full suite, not just the harness package.

## Summary

Plan is in scope for PR 1 only. The risks above are implementation-time
temptations, not plan defects. Codex should treat the "Out of scope" list
plus gates #6 and #7 as hard fences and the ten risks above as soft
fences that catch failures before the hard fences do.

LEAD_SELF_REFLECTION_COMPLETE
