# v1 Connectivity Package Hardening Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Input:** v1 Connectivity Package Review Verdict (PASS_WITH_FOLLOWUPS)
**Package:** `@relay-assistant/connectivity`
**Scope:** Narrow — address review follow-ups only; no new features or package design work

---

## 1. Priority Order

Items are ordered by integration-blocking risk. All items in §2 (Required) must be completed before `@relay-assistant/coordination` takes a runtime dependency on this package.

---

## 2. Required Before Integration

### H-1: Add `exactOptionalPropertyTypes: true` to `tsconfig.json`

**Review item:** FU-1
**Why now:** Without this flag, consumers can pass `{ confidence: undefined }` and TypeScript will not catch it. This weakens the contract that `confidence` is either a valid number or absent. The implementation plan explicitly required this flag.

**Action:** Add `"exactOptionalPropertyTypes": true` to `compilerOptions` in `packages/connectivity/tsconfig.json`. Fix any resulting type errors in `connectivity.ts` or `types.ts` (expected: zero or minimal — the implementation already guards against `undefined` at runtime).

**Verify:** `npx tsc --noEmit` passes with zero errors after the change.

---

### H-2: Add missing test scenarios

**Review item:** FU-2
**Why now:** Coordination's integration tests will assume these behaviors work. Gaps in coverage here become silent regressions later.

All new tests go in `packages/connectivity/src/connectivity.test.ts` (the existing consolidated test file). No new test files are needed.

#### Tests to add (12 scenarios):

**Supersession edge cases:**
1. `handoff.partial` → `handoff.ready` with `replaces` supersedes the partial signal; the partial signal's state is `'superseded'` and the ready signal's state is `'emitted'` (or `'active'` if callbacks registered).
2. Superseding a signal that is already in a terminal state (`superseded`, `expired`, `resolved`) throws `ConnectivityError`.

**Audience resolution:**
3. `audience='self'` — emit with `audience='self'`; register a `SelectedAudienceResolver` spy; verify the resolver is NOT called (only `'selected'` calls it).
4. `audience='all'` — emit signals from two different sources on the same thread, then emit a third with `audience='all'`; verify the resolver callback receives the signal (or verify indirectly via query that all sources are represented).
5. `audience='selected'` with no resolver registered — emit succeeds; no error thrown.
6. Registering a new `SelectedAudienceResolver` replaces the previous one — register resolver A, emit (verify A called), register resolver B, emit (verify B called, A not called again).

**Suppression:**
7. Different `audience` values on otherwise-identical signals bypass suppression — emit with `audience='coordinator'`, then emit with `audience='selected'`; second emit produces a new signal ID.
8. Suppressed `emit()` does NOT fire `onSignal` callbacks — register a callback, emit twice with the same key in the same step; callback fires exactly once.

**Step and expiry:**
9. Signal without `expiresAtStep` does not expire after `advanceStep()` — emit without `expiresAtStep`, advance step, verify state is unchanged.
10. Signal with `expiresAtStep=2` is not expired after one `advanceStep()` (step goes from 0→1, `2 <= 1` is false) — verify state is still `'emitted'` or `'active'`.

**Workflow completions:**
11. WF-C2 complete: resolve BOTH `conflict.active` signals, then query with default state filter — result is empty.
12. WF-C3 complete: `handoff.partial` emitted, then `handoff.ready` emitted with `replaces` pointing to the partial — verify partial is `'superseded'` and ready is queryable.

**Not adding:**
- `EmitSignalInput` structural type test (types.test.ts in plan) — this is a compile-time guarantee, not a runtime behavior. The `exactOptionalPropertyTypes` flag (H-1) covers the real risk.
- `advanceStep()` boundary condition for `expiresAtStep=1` at step 1 — this is already implicitly covered by the existing expiry test. Adding scenario 10 above covers the complementary case.

---

### H-3: Decide on extra exported constants — KEEP

**Review item:** FU-3
**Decision:** Keep the following runtime constant exports:

```
MESSAGE_CLASSES
MESSAGE_CLASS_TO_SIGNAL_PREFIX
SIGNAL_AUDIENCES
SIGNAL_CLASSES
SIGNAL_EVENTS
SIGNAL_PRIORITIES
SIGNAL_STATES
TERMINAL_STATES
```

**Rationale:**
- `MESSAGE_CLASS_TO_SIGNAL_PREFIX` and `TERMINAL_STATES` are already used internally for validation and lifecycle logic. Removing them from the public surface while keeping them internal gains nothing.
- The remaining constants (`MESSAGE_CLASSES`, `SIGNAL_CLASSES`, etc.) are the canonical enumerations of the union types. Downstream consumers (coordination, routing, tests) will need them for exhaustive checks, switch guards, and test fixtures. Requiring consumers to duplicate these arrays is worse than exporting them.
- These constants expose no internal implementation detail — they are the vocabulary itself.
- None of them create a maintenance burden or coupling risk.

**Action:** No code change. Document these as intentional v1 extensions by adding a brief note to `packages/connectivity/README.md` under a "Constants" subsection.

---

## 3. Advisory — Complete Before v1 Sign-off

These do not block integration work but must be done before the package is considered v1-complete.

### H-4: Run `tsc --noEmit` and verify zero errors

**Review item:** FU-4
**Action:** Run `npx tsc --noEmit` in `packages/connectivity/`. This will be done as part of H-1 verification. If it already passes, no further action. If it fails, fix errors before merging the hardening changes.

### H-5: Add explicit `expiresAtStep` boundary test

**Review item:** FU-5
**Action:** Covered by test scenario 10 in H-2 above (`expiresAtStep=2` not expired after one step advance). No separate action needed.

### H-6: Document and test the `active` state promotion edge case

**Review item:** FU-6
**Action:** Add a brief inline comment in `connectivity.ts` at the `active` promotion block explaining that a callback calling `resolve()` during the fire loop will land the signal in `'resolved'` rather than `'active'`. Optionally add a test that registers a callback which calls `resolve()` on the signal it receives, then verifies the signal's final state is `'resolved'`.

---

## 4. Out of Scope

The following are explicitly NOT part of this hardening plan:

- Splitting `connectivity.ts` into multiple files (the consolidated structure is acceptable per review)
- Moving error classes to a separate `errors.ts` file (non-functional structural preference)
- Adding new signal classes or message classes
- Async `emit()` or distributed delivery
- Persistence, serialization, or telemetry
- Any changes to the `ConnectivityLayer` interface
- Any changes to signal semantics or lifecycle rules

---

## 5. Execution Order

1. **H-1** — Add `exactOptionalPropertyTypes` to tsconfig; fix any type errors; verify `tsc --noEmit` passes (also satisfies H-4)
2. **H-2** — Add the 12 missing test scenarios; verify all tests pass
3. **H-3** — Add constants documentation note to README
4. **H-6** — Add inline comment and optional edge-case test

Steps 1–2 are blocking. Steps 3–4 can follow in the same PR or a fast-follow.

---

## 6. Definition of Done

- [ ] `exactOptionalPropertyTypes: true` present in `tsconfig.json`
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All 12 test scenarios from H-2 added and passing
- [ ] Existing tests still pass (no regressions)
- [ ] README updated with constants documentation note
- [ ] Inline comment added for `active` promotion edge case

---

V1_CONNECTIVITY_HARDENING_PLAN_READY
CONNECTIVITY_HARDENING_IMPLEMENTED
