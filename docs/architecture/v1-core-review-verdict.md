# v1 Core Review Verdict

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Reviewer:** Non-interactive review agent
**Artifacts reviewed:**
- `docs/specs/v1-core-spec.md`
- `docs/architecture/v1-core-implementation-plan.md`
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/index.ts`
- `packages/core/src/types.ts`
- `packages/core/src/core.ts`
- `packages/core/src/core.test.ts`
- `packages/core/README.md`

---

## 1. Spec Conformance

**Result: PASS**

### Types (`types.ts`)

All twelve interfaces and type aliases from spec §3 are present and field-accurate:

| Spec type | Present | Fields match |
|---|---|---|
| `AssistantDefinition` | ✓ | ✓ |
| `AssistantRuntime` | ✓ | ✓ |
| `CapabilityHandler` | ✓ | ✓ |
| `InboundMessage` | ✓ | ✓ (userId required, workspaceId optional per Contradiction 2) |
| `OutboundEvent` | ✓ | ✓ (surfaceId optional per Contradiction 3) |
| `CapabilityContext` | ✓ | ✓ |
| `AssistantHooks` | ✓ | ✓ |
| `RuntimeConstraints` | ✓ | ✓ |
| `RuntimeStatus` | ✓ | ✓ |
| `RelayInboundAdapter` | ✓ | ✓ |
| `RelayOutboundAdapter` | ✓ | ✓ (fanout optional) |
| `ContextLogger` | ✓ | ✓ |

### Runtime behavior (`core.ts`)

| Spec requirement | Status | Notes |
|---|---|---|
| `createAssistant` validates definition; throws `AssistantDefinitionError` | ✓ | Validates id, name, non-empty capabilities, function-typed handlers |
| Definition frozen after creation | ✓ | `freezeDefinition` does shallow freeze on definition + nested objects |
| Lifecycle state machine `created → started → stopped` | ✓ | Correctly enforced; restart after stop throws |
| `start()` idempotent | ✓ | No-op if already started |
| `stop()` idempotent | ✓ | No-op if already stopped |
| `stop()` drains in-flight handlers before `onStop` | ✓ | `waitForDrain()` with 30s timeout then `onStop` |
| `dispatch()` throws if not started | ✓ | |
| `dispatch()` calls `onMessage` hook; `false` drops message | ✓ | |
| `dispatch()` routes by `message.capability` | ✓ | |
| Missing capability calls `onError`, no throw | ✓ | |
| Handler errors call `onError` | ✓ | |
| Handler timeout calls `onError` after `handlerTimeoutMs` | ✓ | Per-invocation (OQ-4 resolved) |
| Concurrency gating with FIFO queue | ✓ | `pendingDispatches` array with `runNext()` drain loop |
| `emit()` targeted send via `surfaceId` | ✓ | |
| `emit()` session fanout via `sessionId` | ✓ | Delegates to `sessions` subsystem; supports both `get`/`getSession` shapes |
| `emit()` throws `OutboundEventError` when neither field set | ✓ | |
| `register()`/`get()` with string keys; `get` throws if missing | ✓ | OQ-2 resolved |
| `status()` returns all five required fields | ✓ | |
| `start()` calls `onStart`; `stop()` calls `onStop` | ✓ | |
| Inbound adapter wired on `start()`, unwired on `stop()` | ✓ | |

### Open question resolutions implemented

| OQ | Resolution | Implemented |
|---|---|---|
| OQ-1 | `emit()` returns `Promise<void>`, no ack | ✓ |
| OQ-2 | String keys for `register()`/`get()` | ✓ |
| OQ-3 | `onMessage` hook as pre-dispatch filter | ✓ |
| OQ-4 | `handlerTimeoutMs` per-invocation | ✓ |

### Minor structural deviation

The implementation plan specified seven source files (`types.ts`, `errors.ts`, `runtime.ts`, `logger.ts`, `index.ts`, and two test files in `__tests__/`). The implementation uses four files: `types.ts`, `core.ts` (combines errors + runtime + logger), `index.ts`, and `core.test.ts` (combines WF-1 + WF-2 tests). This is a cosmetic divergence. The combined file approach is acceptable for v1 and does not affect external contracts.

---

## 2. Package Boundaries

**Result: PASS**

- `package.json` has **zero runtime dependencies**. Only `typescript` and `vitest` as dev dependencies. ✓
- `core.ts` imports only from `./types.js` (internal). No imports from other `@relay-assistant/*` packages. ✓
- `tsconfig.json` has no path aliases or project references that would create hidden coupling. ✓
- The `SessionSubsystem` internal type in `core.ts` (lines 26–37) is a duck-typed shape that anticipates the sessions package's interface. It is **not exported**, so no external contract is formed. This is acceptable for v1. However, it represents an implicit forward-dependency on sessions conventions that should be acknowledged (see Follow-ups §5).

---

## 3. Test Coverage

**Result: PASS**

The single test file covers all 25 plan test cases from the implementation plan (§5.1 and §5.2), some combined into broader integration tests:

### WF-1 lifecycle (plan §5.1, 12 tests)

| Plan test | Covered | Test name |
|---|---|---|
| 1 — valid definition returns runtime | ✓ | `returns a runtime for a valid definition` |
| 2 — missing `id` throws | ✓ | `throws for a missing id` |
| 3 — empty capabilities throws | ✓ | `throws for empty capabilities` |
| 4 — non-function capability throws | ✓ | `throws for non-function capability values` |
| 5 — start sets `ready` and `startedAt` | ✓ | `supports start, stop, register, get, and status` |
| 6 — stop sets `ready = false` | ✓ | same |
| 7 — double start idempotent | ✓ | same |
| 8 — double stop idempotent | ✓ | same |
| 9 — register returns runtime; chaining works | ✓ | same |
| 10 — get returns registered subsystem | ✓ | same |
| 11 — get missing throws | ✓ | same |
| 12 — status includes registered capabilities | ✓ | same |

### WF-2 dispatch (plan §5.2, 13 tests)

| Plan test | Covered | Test name |
|---|---|---|
| 1 — dispatch calls correct handler | ✓ | `dispatches to the matching capability with the live runtime context` |
| 2 — handler receives live `context.runtime` | ✓ | same |
| 3 — emit → outbound adapter `send` | ✓ | same |
| 4 — emit with no routing target throws | ✓ | `throws when emit has no routing target` |
| 5 — onMessage false drops message | ✓ | `drops a message when onMessage returns false` |
| 6 — onMessage true allows message | ✓ | `allows a message when onMessage returns true` |
| 7 — unregistered capability calls onError | ✓ | `reports missing capabilities through onError without throwing` |
| 8 — handler throw calls onError | ✓ | `reports handler errors through onError` |
| 9 — dispatch on stopped runtime throws | ✓ | `throws when dispatch is called after stop` |
| 10 — inFlightHandlers increments during handler | ✓ | `tracks in-flight handlers during execution` |
| 11 — handler timeout triggers onError | ✓ | `times out handlers and reports the timeout through onError` |
| 12 — onStart hook called during start | ✓ | `supports start, stop, register, get, and status` |
| 13 — onStop hook called during stop | ✓ | same |

Two additional tests beyond the plan are present and valuable:
- `emits fanout events through the session subsystem` — validates the session fanout path
- `wires inbound adapter messages into dispatch on start` — validates the inbound adapter integration path

### Single gap

No explicit test for missing `name` (plan test 2 covers `id`; the same validation block handles `name` but it's not independently tested). Not blocking, but it's a plan item.

---

## 4. Follow-ups Before Coding Moves to Sessions

These are ordered by priority. Items 1–3 should be resolved before the sessions package begins implementation. Items 4–5 are advisory.

### 4.1 — Add test for missing `name` validation [SHOULD]

Plan §5.1 test 2 lists both `id` and `name` as required cases. Only `id` is tested. Add:

```typescript
it('throws for a missing name', () => {
  expect(() =>
    createAssistant({ id: 'assistant-1', name: '', capabilities: { reply: () => undefined } }, adapters)
  ).toThrowError(AssistantDefinitionError);
});
```

### 4.2 — Document and export the sessions subsystem contract [SHOULD]

`core.ts` contains an internal `SessionSubsystem` type (lines 26–37) that the sessions package must satisfy when registered under the `'sessions'` key. This type is not exported, leaving the sessions package author to infer the expected shape from README prose or the fanout test.

Options:
- Export `SessionSubsystem` from `types.ts` and `index.ts` as a named interface (preferred — gives the sessions package a compile-time target)
- Or document it formally in `docs/architecture/sessions-contract.md` before the sessions package is started

This prevents a coordination gap where sessions implements a different interface shape than core expects.

### 4.3 — Clarify stop-drain timeout behavior for sessions [SHOULD]

`STOP_DRAIN_TIMEOUT_MS` is hardcoded to 30 seconds in `core.ts` and is not configurable via `RuntimeConstraints`. If sessions package registers cleanup work in `onStop`, and in-flight handlers hold session locks, a 30-second drain timeout could cause `stop()` to reject — which the caller has no way to configure around. Consider:

- Exposing `stopDrainTimeoutMs` in `RuntimeConstraints`, or
- Documenting that `stop()` may reject in slow-drain scenarios so sessions package can handle it

### 4.4 — Verify `stop()` from `created` state behavior [ADVISORY]

Calling `stop()` before `start()` transitions to `stopped` without invoking `onStop` (because `wasStarted === false`). This is correct behavior but is not tested. The plan does not require this test, but it would prevent a subtle regression when sessions adds `onStop` cleanup.

### 4.5 — File structure vs. plan alignment [ADVISORY]

The implementation plan described separate `errors.ts`, `runtime.ts`, `logger.ts` files. The implementation consolidates all three into `core.ts`. If any tooling (CI steps, documentation generators, code owners) references the plan's file paths, update the plan or the tooling to reflect the actual structure. Otherwise, this has no functional impact.

---

## Summary

The v1 core implementation is **functionally complete and correct** against the spec. All required types are exported, the runtime implements the full lifecycle and dispatch pipeline, package boundaries are clean with zero runtime dependencies, and the test suite covers all 25 planned test cases plus two additional integration paths.

The follow-ups are minor and do not block tagging the package as v1-ready. Items 4.1–4.3 should be resolved before the sessions package begins implementation to avoid ambiguity in the sessions contract and runtime cleanup behavior.

**VERDICT: PASS_WITH_FOLLOWUPS**

V1_CORE_REVIEW_COMPLETE
