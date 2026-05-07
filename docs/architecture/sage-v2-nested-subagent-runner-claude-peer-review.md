# Sage v2 Nested Subagent Runner — Claude Peer Review

Date: 2026-05-07

Verdict: **PASS_WITH_FOLLOWUPS**

---

## Files Reviewed

- `docs/architecture/sage-v2-nested-subagent-runner-plan.md`
- `docs/architecture/sage-v2-nested-subagent-runner-lead-reflection.md`
- `docs/architecture/sage-v2-nested-subagent-runner-executor-reflection.md`
- `docs/architecture/sage-v2-nested-subagent-runner-fresh-eyes-review.md`
- `packages/harness/src/nested-subagent-runner.ts`
- `packages/harness/src/nested-subagent-runner.test.ts`
- `packages/harness/src/subagent-registry.ts`
- `packages/harness/src/subagent-registry.test.ts`
- `packages/harness/src/index.ts`
- `packages/harness/src/registries/index.ts`
- `packages/harness/src/subpath-exports.test.ts`

---

## 1. API Minimality

**Result: PASS**

The public surface matches the plan exactly. Four symbols are exported:

| Symbol | `registries/index.ts` | `index.ts` (deprecated wrapper) |
|---|---|---|
| `createNestedSubagentRunner` | line 36 (value) | lines 101–106 (wrapped with deprecation warning) |
| `CreateNestedSubagentRunnerOptions` | line 47 (type) | line 247 (type re-export) |
| `CreateNestedHarnessInput` | line 45 (type) | line 246 (type re-export) |
| `ComposeNestedSubagentInstructionsInput` | line 46 (type) | line 245 (type re-export) |

No additional types leak from `nested-subagent-runner.ts`. Internal helpers (`childCounterKey`, `resolveParentTraceId`, `readResultMessage`, `failureMessageForStopReason`, `classifyThrownError`, `toFailureResult`, `toSuccessResult`, `buildChildMetadata`) are all unexported. ✅

The `now?()` option on `CreateNestedSubagentRunnerOptions` is a useful test seam. It is not wired to any HTTP or I/O boundary, so no Workers-fetch concern. ✅

---

## 2. Extraction Boundary

**Result: PASS_WITH_FOLLOWUP (pre-existing, noted by fresh-eyes)**

### Core runner: clean

`nested-subagent-runner.ts` contains no Sage product strings, no roster names (with one caveat below), no `SAGE_*` flags, and no hard-wired model configuration. The helper delegates all product concerns to the caller-supplied `createHarness` and `composeInstructions` seams. ✅

### `subagent-registry.ts` widening

The plan stated "Not modified in this PR: `packages/harness/src/subagent-registry.ts`". In practice the executor had to widen `RunSubagentInput` with `taskInput`, `signal`, and `parentTraceId`, and added `RunSubagentResult` as a backwards-compatible union. This departure from the plan is **justified**: the plan's own `ComposeNestedSubagentInstructionsInput` requires `taskInput`, making the registry change logically necessary. The widening is additive-only and does not break existing callers (they receive the new fields as passthrough). Downstream packages that consume the old `{ output, iterations }` shape continue to work via `normalizeRunSubagentResult`. **The plan's assertion that no registry changes were needed was incorrect; the executor resolved this correctly.**

### `./runtime-policy` scope creep (FOLLOW-UP REQUIRED)

Three hunks unrelated to the nested runner are bundled in this diff:

1. `packages/harness/src/index.ts` line 2 — `export { createRuntimePolicy } from './runtime-policy/index.js'`
2. `packages/harness/src/subpath-exports.test.ts` lines 32–36 — assertion that `./runtime-policy` is in `package.json`'s exports map
3. `packages/harness/package.json` (presumed per fresh-eyes finding) — `./runtime-policy` export entry

These belong in a separate PR. They do not affect runner correctness, but they inflate this PR's diff against the declared scope and would fail gate #7 ("no new top-level exports beyond the documented surface") if `createRuntimePolicy` is counted. **Split before merge.**

### Test fixture name `doc-drafter`

The plan's "Out of scope" section lists `doc-drafter` as a Sage roster name. The test fixtures throughout `nested-subagent-runner.test.ts` use `doc-drafter` as the primary subagent fixture name. The mechanical gate #6 (`git grep` pattern) does not include `doc-drafter`, so it passes the CI check. However, using a Sage roster name as a test fixture creates a subtle conceptual coupling. This is a **minor observation, not a blocking issue**. Future test authors should prefer the plan's suggested fixture names (`example-researcher`, `worker-a`, `worker-b`) when authoring substrate-level tests.

---

## 3. Cancellation Behavior

**Result: PASS**

Signal forwarding path is complete and correct:

1. `createSubagentToolRegistry.execute()` receives `signal: context.signal` from the harness execution context (subagent-registry.ts line 452).
2. The runner receives `input.signal` and passes it unchanged to both `createHarness` (as `signal` in `CreateNestedHarnessInput`) and the child `HarnessTurnInput`.
3. Result translation maps `stopReason: 'cancelled'` → `{ ok: false, error: { code: 'aborted', message } }` (nested-subagent-runner.ts lines 127–129).
4. Thrown `AbortError` is classified to `code: 'aborted'` by `classifyThrownError` (lines 96–103).

The `parent_cancellation_propagates` test (line 326) verifies the signal identity (`receivedSignal === abortController.signal`), proves the correct error code, and correctly aborts mid-flight via an event listener on the signal. ✅

No race condition concern: the `runTurn` fake checks `signal.aborted` synchronously before registering the listener, matching real runtime patterns.

---

## 4. Allowlist Enforcement

**Result: PASS**

The allowlist path:

1. `input.subagent.toolAllowlist` is converted to a `Set<string>` (nested-subagent-runner.ts line 186).
2. That `Set` is passed to `createHarness` as `toolAllowlist` in `CreateNestedHarnessInput`.
3. `[...toolAllowlist]` is placed in `HarnessTurnInput.allowedToolNames` (line 213).
4. The child harness's `tools.listAvailable(input)` receives `input.allowedToolNames` and filters accordingly — as enforced by the `tool_allowlist_enforced` test (line 393).

The `tool_allowlist_enforced` test exercises a real `createHarness` instance with a filtering tool registry and confirms the model adapter only sees `['memory_recall']`. ✅

One implementation note: the `Set` conversion at line 186 is correct but the plan's `CreateNestedHarnessInput` declares `toolAllowlist: ReadonlySet<string>`. The actual call (`new Set(input.subagent.toolAllowlist)`) produces a `Set<string>` which is structurally compatible. ✅

---

## 5. Tests

**Result: PASS**

All 9 plan-specified test cases are present:

| Plan Case | Test File Location | Notes |
|---|---|---|
| `success_returns_flat_result` | line 141 | Verifies metadata fields (`parentTraceId`, `childTraceId`, `subagentName`), message shape, `turnId` derivation |
| `unknown_subagent_returns_ok_false` | line 213 | Verifies `createHarness` not called; correct error code |
| `subagent_failure_is_isolated` | line 243 | Uses real `createHarness` parent; verifies parent recovers |
| `max_iterations_failure` | line 282 | `outcome: 'deferred'`, `stopReason: 'max_iterations_reached'` → `code: 'max_iterations'` |
| `parent_cancellation_propagates` | line 326 | Signal identity check; aborted result code |
| `tool_allowlist_enforced` | line 393 | Real harness; model only sees allowlisted tools |
| `parent_context_is_filtered` | line 442 | Via registry path; both `parentContext` and `filteredParentContext` lack excluded keys |
| `workers_fetch_compatibility` | line 511 | Getter-throws pattern; `createNestedSubagentRunner` construction does not touch `globalThis.fetch` |
| `parallel_task_batch` | line 596 | Interleaved start/finish events; elapsed < 90ms; `executionMode: 'parallel'` verified |

Two additional tests beyond the plan:

- `direct_runner_invocation_preserves_raw_parent_context_and_provides_filtered_copy` (line 473) — added by fresh-eyes to cover the contract fix; verifies raw context survives in `parentContext` while excluded keys are absent from `filteredParentContext` on the direct-call path. ✅
- `child_ids_are_scoped_per_parent_turn` (line 539) — verifies counter isolation across different parent turn IDs. ✅

### Test design observations (non-blocking)

- The `parent_context_is_filtered` test exercises the **registry path**, meaning the registry already strips excluded keys before calling the runner. Both `parentContext` and `filteredParentContext` end up clean, but this test is technically verifying the registry's filter, not the runner's. The direct-call test at line 473 plugs that gap.
- The `workers_fetch_compatibility` test correctly restores the original descriptor in a `finally` block, avoiding test pollution. ✅
- `parallel_task_batch` uses a 50ms delay and a 90ms budget. This leaves a 40ms margin. On a loaded CI machine this could flake; consider relaxing to 150ms if CI environments are slow. Minor.

---

## 6. Public Exports

**Result: PASS (with the runtime-policy caveat counted as a follow-up, not a fail)**

**`registries/index.ts`:** Exports exactly the four documented symbols plus pre-existing subagent-registry exports (`createSubagentToolRegistry`, `filterParentContextForSubagent`, `SUBAGENT_DEFAULT_MAX_ITERATIONS`, `SUBAGENT_EXCLUDED_PARENT_KEYS`, and their types). No undocumented new values. ✅

**`index.ts` root:** The deprecated-root-import wrapper for `createNestedSubagentRunner` follows the established pattern of the file (same wrapper style as `createBashToolRegistry`, `createSubagentToolRegistry`, etc.). The three new type re-exports at lines 245–248 are correct. The unrelated `createRuntimePolicy` export at line 2 is flagged above as scope creep — it exists in the file but should ship in a separate PR.

---

## 7. Workers-Fetch Compliance

**Result: PASS**

`nested-subagent-runner.ts` contains no `fetch` reference of any kind. There is no `import { fetch }`, no `globalThis.fetch`, no stored `fetchImpl`. The `workers_fetch_compatibility` test enforces this at the `createNestedSubagentRunner` construction boundary. ✅

---

## 8. Deterministic Child ID Derivation

**Result: PASS**

Counter key combines `parentTraceId` and `parentContext.turnId` (line 42):
```ts
return `${parentTraceId}::${input.parentContext.turnId}`;
```

This correctly scopes child counters per (trace, turn) pair. The `child_ids_are_scoped_per_parent_turn` test at line 539 verifies that invocations under different parent turn IDs start their own counter sequence and do not share state. ✅

The executor's "residual risk" note (counters grow with unique turn pairs over a long-lived process, reset if runner is reconstructed) is accurately described and is acceptable for PR 1. ✅

---

## 9. Result Translation

**Result: PASS**

All plan-specified translation rules are implemented correctly in `toFailureResult` and the inline success branch:

| Condition | Code |
|---|---|
| `outcome === 'completed' && stopReason === 'answer_finalized'` | `ok: true, output: assistantMessage.text ?? ''` ✅ |
| `stopReason === 'max_iterations_reached'` | `code: 'max_iterations'` ✅ |
| `stopReason === 'cancelled'` | `code: 'aborted'` ✅ |
| `stopReason === 'model_invalid_response'` | `code: 'invalid_output'` ✅ |
| any other non-success | `code: 'subagent_error'` ✅ |
| thrown `AbortError` | `code: 'aborted'` ✅ |
| thrown message contains `max_iterations` | `code: 'max_iterations'` ✅ |
| other thrown error | `code: 'subagent_error'` ✅ |

`readResultMessage` correctly prefers `assistantMessage.text` and falls back to `metadata.reason` before falling back to the canned stop-reason message. No new error codes (`policy_violation`, `budget_exhausted`) are introduced. ✅

---

## Summary of Follow-ups

| # | Severity | Description |
|---|---|---|
| F-1 | **Required before merge** | Split `./runtime-policy` export (index.ts line 2, subpath-exports.test.ts lines 32–36, package.json entry) into a separate PR. This keeps the diff matched to the declared PR scope and satisfies gate #7 cleanly. |
| F-2 | Recommended | Replace `doc-drafter` fixture name with a neutral name like `example-drafter` to avoid pulling a Sage roster name into substrate test fixtures. Low impact; `doc-drafter` is not in the mechanical gate #6 grep pattern and does not encode product semantics in the implementation. |
| F-3 | Informational | `parallel_task_batch` uses a 50ms/90ms delay budget. Consider relaxing to 150ms to improve CI resilience on loaded machines. |

---

## Prior Reviews Assessed

- **Lead reflection** correctly identified the ten implementation-time risks. The implementation avoided all of them.
- **Executor reflection** accurately documents the `subagent-registry.ts` widening as a necessary pragmatic deviation from the plan's claim that no registry changes were needed. The widening is sound.
- **Fresh-eyes review** identified and fixed the `parentContext`/`filteredParentContext` contract bug before this review. The fix at nested-subagent-runner.ts line 187–194 is correct; the direct-call test at line 473 covers it.

All three prior reviewers converged on the same `./runtime-policy` scope creep finding. This review concurs.

---

## Final Verdict

**PASS_WITH_FOLLOWUPS**

The nested subagent runner helper is functionally correct, well-tested against all plan-specified cases, Workers-fetch safe, and free of Sage product contamination in the implementation. The fresh-eyes fix resolved the only behavioral bug found in prior review. The sole blocking follow-up is splitting the unrelated `./runtime-policy` export surface changes into a separate PR before merge. The implementation and tests are otherwise ready.

CLAUDE_PEER_REVIEW_COMPLETE
