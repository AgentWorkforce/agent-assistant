# Sage v2 Nested Subagent Runner — Claude Self-Reflection

Date: 2026-05-07

Subject: `docs/architecture/sage-v2-nested-subagent-runner-claude-peer-review.md`

---

## Why The Verdict Is Valid Beyond Green Tests

The peer review reached `PASS_WITH_FOLLOWUPS`. That verdict is correct, but passing 25 tests and a clean build is not the full reason it is correct. The following explains why the implementation earns that verdict on structural and design grounds, independent of test outcomes.

### 1. Seam placement is the substance of substrate work

The core design decision in this PR is where product behavior is allowed to live. `createNestedSubagentRunner` exposes exactly two seams to callers: `createHarness` and `composeInstructions`. Everything product-specific — which model, which system prompt, which roster name, which workflow policy — flows through those seams and lives in the consuming product. The helper itself has no opinion on any of it.

This is not a trivial constraint to enforce. The plan's list of ten scope risks (lead reflection) documents the specific temptations: a convenience default harness, a telemetry event kind, a new excluded-context key, a new error code. None of those made it in. The implementation stayed mechanical: receive a subagent, derive child ids, filter context, forward allowlist, translate result. A reviewer reading the implementation after deleting the plan would reconstruct the same boundary.

Tests cannot verify this. Tests verify behavior for the inputs provided. They cannot verify that a future PR author won't mistake a substrate file for a product file. The seam design does that.

### 2. The plan deviation in `subagent-registry.ts` was structurally necessary, not a shortcut

The plan stated no changes were needed to `subagent-registry.ts`. The executor widened `RunSubagentInput` with `taskInput`, `signal`, and `parentTraceId`, and added `RunSubagentResult` as a backwards-compatible union.

This deviation was not scope creep. The plan's own `ComposeNestedSubagentInstructionsInput` requires `taskInput`, which meant the runner had to receive it and the registry had to pass it. The plan's claim that no registry changes were needed was an error in the plan, not in the implementation. The executor corrected it without inventing new surface: the widening is additive, `normalizeRunSubagentResult` keeps old callers working, and no existing test required updating to pass.

A green test suite would have hidden this divergence if the old registry shape had been silently tolerated. The peer review caught it by reading the actual types against the plan's stated contract. That difference matters because future PRs (2–5) build on the assumption that `RunSubagentInput` carries these fields.

### 3. The parent-context contract bug was a real behavioral defect, not a polish issue

Fresh-eyes review found and fixed the `parentContext` / `filteredParentContext` distinction before the peer review. In the pre-fix code, `createHarness` received the filtered copy in both the `parentContext` and `filteredParentContext` fields of `CreateNestedHarnessInput`. That meant callers had no way to access the raw parent context — they only ever saw the scrubbed version.

This is a correctness issue, not a style issue. A `createHarness` implementation that needs to read a field excluded from `SUBAGENT_EXCLUDED_PARENT_KEYS` (e.g., `messages` or `todos` for an orchestration-aware harness) would silently receive `undefined` instead of the actual value. The fix at `nested-subagent-runner.ts:179–194` passes the original `input.parentContext` as-is and the scrubbed copy separately. The direct-call test at line 473 covers the contract.

Without reading the code, a test suite running only through the registry path would not catch this, because the registry filters before calling the runner — so the test would verify a correctly-typed but vacuously-filtered input. The fresh-eyes review caught it by examining the direct-call path independently.

### 4. Workers-fetch compliance is a structural guarantee, not a test artifact

The `workers_fetch_compatibility` test stubs `globalThis.fetch` with a throwing getter and asserts that constructing the runner does not read it. This is meaningful precisely because the rule it enforces is invisible in a standard test environment: bare `fetch` capture during module evaluation is only detectable in a Cloudflare Workers context under `nodejs_compat`.

The test is a proxy for a class of production incidents documented in `.claude/rules/workers-fetch.md` (three incidents: OpenRouter adapter on 2026-04-24, sage#110, cloud#328). The structural guarantee is that `nested-subagent-runner.ts` has no `fetch` reference of any kind — not at construction, not in the module body, not in any import. That guarantee is verifiable by reading the file, not by running the test. The test enforces it mechanically against future edits.

### 5. Cancellation path correctness requires end-to-end reasoning, not just a passing test

The `parent_cancellation_propagates` test verifies signal identity (`receivedSignal === abortController.signal`) and correct error code translation. But the reason this test is sufficient is that the signal forwarding path is structurally simple: `input.signal` flows unchanged into `createHarness` and `HarnessTurnInput`, and the child harness propagates it to its `runTurn`. There are no intermediary steps that could drop, copy, or re-wrap the signal.

If the design had introduced a signal wrapper (e.g., a derived `AbortController` that listened to the parent), the test would still pass but the guarantee would be weaker: the child harness's signal would be a descendant, not the parent signal itself. The current design's identity guarantee matters for callers that register their own listeners on the signal and expect child harness activity to honor the same signal lifetime. The peer review validated this by tracing the signal through all four hops (registry context → runner input → `createHarness` → `HarnessTurnInput`).

### 6. Result translation covers the error vocabulary boundary, not just the happy path

The `toFailureResult` function maps five stop reasons plus two thrown-error classifications to the existing `TaskToolResult` error codes. No new codes are introduced. The peer review validated this mapping exhaustively against the plan's translation table.

This matters beyond test coverage because PRs 2–5 are expected to introduce new stop-reason vocabulary (`policy_violation`, `budget_exhausted`, and variants). If this PR had invented those codes preemptively, it would have implicitly defined a contract that PR 2 would need to honor — creating an undocumented dependency between substrate slices. By staying within the existing six codes (`unknown_subagent`, `max_iterations`, `aborted`, `invalid_output`, `subagent_error`, and the implicit `ok: true`), the runner leaves the error vocabulary extension to the PRs that own it.

---

## Follow-Up Substrate Slices That Remain Separate PRs

The five substrate PRs named in `sage-v2-substrate-implementation-plan.md` are PRs 1–5. PR 1 is this slice. The following remain separate, in dependency order.

### Immediate pre-merge (not a substrate PR, but blocks this merge)

**F-1: Split `./runtime-policy` export surface**

The current worktree includes three hunks unrelated to the nested runner:
- `packages/harness/src/index.ts:2` — `export { createRuntimePolicy } from './runtime-policy/index.js'`
- `packages/harness/src/subpath-exports.test.ts:31–34` — assertion that `./runtime-policy` is in `package.json`'s exports map
- `packages/harness/package.json:34–37` — the `./runtime-policy` export entry

These must move to a dedicated PR (logically PR 2 pre-work or a standalone subpath-exports cleanup PR) before this PR is merged. They inflate the diff beyond the declared scope, fail gate #7 if `createRuntimePolicy` is counted as a new top-level export, and make the PR boundary illegible to reviewers reading the diff against the plan.

### PR 2: Runtime Budget Policy

**Owner: PR 2 of the substrate plan.**

This PR introduces `createRuntimePolicy`, which enforces per-subagent resource constraints: todo-rewrite caps, tool-result caches, drill-or-stop heuristics, and output sanitizers. It also defines the error codes `policy_violation` and `budget_exhausted` that are intentionally absent from the PR 1 error vocabulary.

The `./runtime-policy` subpath export that leaked into this diff belongs here. The nested runner's `CreateNestedSubagentRunnerOptions` may gain a `runtimePolicy?` field in this slice — but that field must not appear in the PR 1 types.

### PR 3: Telemetry Vocabulary (`subagent.*` / `runtime_policy.*`)

**Owner: PR 3 of the substrate plan.**

The nested runner currently emits no new telemetry event kinds. Existing `trace` events from the child `HarnessRuntime` flow through whatever the caller's `createHarness` returns. PR 3 defines the structured `subagent.start`, `subagent.finish`, `subagent.failed`, and `runtime_policy.*` event kinds, along with the harness-bridge vocabulary updates in `packages/telemetry/src/harness-bridge.ts`.

This slice was explicitly excluded from PR 1. Adding any `subagent.*` event emission to `nested-subagent-runner.ts` before PR 3 lands would create an undocumented vocabulary divergence between what the helper emits and what telemetry consumers expect.

### PR 4: Eval Runner Contracts

**Owner: PR 4 of the substrate plan.**

PR 4 adds the eval runner abstraction: a contract for executing subagents in a controlled evaluation harness, recording ground-truth inputs and outputs, and comparing them against expected results. This touches the same `runSubagent` seam that PR 1 stabilizes. The PR 1 types (`CreateNestedHarnessInput`, `RunSubagentInput`) become the baseline API that the eval runner extends.

No `evalContext?` option on `CreateNestedSubagentRunnerOptions` should appear before this slice lands.

### PR 5: Insight Envelope Contracts

**Owner: PR 5 of the substrate plan.**

PR 5 defines the insight envelope: a structured carrier for subagent-produced analysis that flows back to the parent harness as typed metadata rather than unstructured assistant text. This changes the `TaskToolResult` shape (or introduces a parallel type) and adds new fields to `CreateNestedHarnessInput`.

The current PR 1 `toSuccessResult` function maps `assistantMessage.text ?? ''` as the flat output string. PR 5 will need to replace or augment this with the envelope structure. That is safe precisely because PR 1 does not add any insight-shaped fields — the extension point is clean.

---

### Minor Non-Blocking Follow-Ups

**F-2: Rename `doc-drafter` test fixture**

`doc-drafter` appears in `nested-subagent-runner.test.ts` as the primary subagent fixture name. It is also listed in the plan's "Out of scope" roster names. The mechanical gate #6 does not include `doc-drafter` in its grep pattern, so CI passes. But the conceptual coupling is real: substrate-level tests should use names like `example-drafter`, `worker-a`, `worker-b` that carry no Sage product meaning. This is a low-effort rename with no behavioral consequence, best done in the PR 1 cleanup commit if the `./runtime-policy` split requires one.

**F-3: Relax `parallel_task_batch` timing budget**

The test uses a 50ms delay and asserts elapsed time below 90ms, leaving a 40ms margin. On heavily loaded CI machines this could flake. Relaxing to a 150ms budget (100ms delay, 150ms assertion) would reduce CI sensitivity without changing what the test proves.

---

## Summary

The `PASS_WITH_FOLLOWUPS` verdict is valid because the implementation correctly enforces the substrate boundary at the design level — not just at the test level. The seam design, the backwards-compatible registry widening, the parent-context contract fix, the Workers-fetch structural guarantee, and the result translation completeness are all reasons the PR is ready at the behavior layer. The sole blocking follow-up (F-1: `./runtime-policy` split) is a PR-hygiene issue, not a behavioral defect.

The four remaining substrate PRs (runtime budget policy, telemetry vocabulary, eval runner, insight envelope) are correctly deferred. Each one extends the `runSubagent` boundary that PR 1 stabilizes. The PR 1 implementation leaves no premature hooks for any of them, which is the right posture for slice #1 of a five-PR program.

CLAUDE_PEER_REVIEW_SELF_REFLECTION_COMPLETE
