# v1 Connectivity Package Review Verdict

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Reviewer:** v1-connectivity-package-review agent
**Package:** `@relay-assistant/connectivity`
**Files reviewed:**
- `docs/specs/v1-connectivity-spec.md`
- `docs/architecture/v1-connectivity-package-implementation-plan.md`
- `docs/reference/connectivity-signal-catalog.md`
- `docs/specs/v1-routing-spec.md`
- `packages/connectivity/package.json`
- `packages/connectivity/tsconfig.json`
- `packages/connectivity/src/index.ts`
- `packages/connectivity/src/types.ts`
- `packages/connectivity/src/connectivity.ts`
- `packages/connectivity/src/connectivity.test.ts`
- `packages/connectivity/README.md`

---

## 1. Spec Conformance

### Types — PASS

All types in `types.ts` match the canonical spec (§2.1–2.3, §7.2, §8–10) exactly:

| Type | Spec source | Match |
|---|---|---|
| `ConnectivitySignal` | §2.1 | ✓ All 14 fields present, correct optionality |
| `EmitSignalInput` | §2.3 | ✓ Excludes `id`, `emittedAt`, `state` |
| `SignalAudience` | §2.2 | ✓ 4 values |
| `MessageClass` | §2.2 | ✓ 5 values |
| `SignalClass` | §2.2 | ✓ 11 values, matches v1 vocabulary |
| `SignalPriority` | §2.2 | ✓ |
| `SignalState` | §2.2 | ✓ |
| `SignalEvent` | §8.2 | ✓ |
| `RequestedRoutingMode` | §9 | ✓ `'cheap' \| 'fast' \| 'deep'` |
| `SignalQuery` | §8.1 | ✓ Uses `since` per spec; adds `before` (harmless extension) |
| `SuppressionConfig` | §7.2 | ✓ |
| `RoutingEscalationHook` | §9 | ✓ |
| `ConnectivityLayerConfig` | §10 | ✓ |
| `ConnectivityLayer` interface | §8 | ✓ All 8 methods present with matching signatures |
| `SelectedAudienceResolver` | §8.3 | ✓ |
| `SignalCallback` | §8.2 | ✓ |

The implementation plan called for `errors.ts` as a separate file. The implementation places error classes inside `types.ts`. This is a non-functional structural deviation — acceptable.

### `emit()` Orchestration — PASS

The emit order in `connectivity.ts` matches spec §8 and implementation plan Step 8:

1. Validate input ✓
2. Validate `replaces` cross-thread ✓
3. Suppression check (critical bypasses) ✓
4. Supersede target + fire `'superseded'` callback ✓
5. Create signal with `id`, `emittedAt`, `state='emitted'` ✓
6. Store in thread array and by-ID index ✓
7. Routing escalation hook called (wrapped in try/catch) ✓
8. `onSignal(signal, 'emitted')` fired ✓
9. `state` promoted to `'active'` if any callback fired ✓
10. Return signal ✓

### Lifecycle State Machine — PASS

All transitions implemented correctly:
- `emitted → active`: after first `onSignal` callback fires ✓
- `active → superseded`: via `emit(replaces=...)` ✓
- `active → expired`: via `advanceStep()` ✓
- `active → resolved`: via `resolve()` ✓
- Terminal states blocked from further transition ✓
- `resolve()` idempotent for already-resolved signals ✓
- `resolve()` throws `ConnectivityError` for `superseded`/`expired` signals ✓

### Suppression — PASS

Duplicate key: `threadId|source|signalClass|audience` ✓

Suppression rules from spec §7.3:
- Returns existing signal unchanged on duplicate ✓
- `priority='critical'` bypasses suppression ✓
- `priority='high'` escalation with different `summary` bypasses suppression ✓
- Resolved signals do not count as duplicates; new signal is created ✓
- Step-basis: suppresses within same step, resets on `advanceStep()` ✓
- Time-basis: `windowMs` sliding window (defaults to 5000ms) ✓

### Validation — PASS

All rules from spec §2.3 enforced:
- `threadId`, `source`, `summary` non-empty strings ✓
- `messageClass`/`signalClass` cross-consistency check ✓
- `confidence` required for `confidence.*` and `conflict.*` classes ✓
- `confidence` range `[0.0, 1.0]` enforced when present ✓
- Per-class confidence ranges enforced (e.g., `confidence.high` requires `0.8–1.0`) ✓
- `expiresAtStep` must be non-negative integer ✓
- `replaces` must reference a signal in the same `threadId` ✓

### `advanceStep()` — PASS

Increments step counter, scans thread for `expiresAtStep <= currentStep` on non-terminal signals, transitions to `'expired'`, fires `onSignal(signal, 'expired')`. No-op on unknown thread. ✓

### `query()` — PASS

Matches spec §8.1:
- Default state filter `['emitted', 'active']` ✓
- All filters AND-combined, array-valued filters OR-within ✓
- `since`/`before` ISO-8601 time filters ✓
- `limit` defaults to 50 ✓
- `order` defaults to `'newest'` ✓

### Audience Resolution — PASS

| Audience | Behavior | Match |
|---|---|---|
| `self` | `[signal.source]` | ✓ |
| `coordinator` | `['coordinator']` | ✓ |
| `selected` | calls `SelectedAudienceResolver`; `[]` if none registered | ✓ |
| `all` | all thread sources + `'coordinator'` | ✓ |

Per spec: resolved recipients are informational only; `onSignal` fires to all subscribers regardless of audience. ✓

### File Structure Deviation — ACCEPTABLE

The implementation plan specified 24 files (8 runtime + 12 test + 4 integration test). The implementation uses 3 runtime files (`types.ts`, `connectivity.ts`, `index.ts`). All logic from the planned 8 runtime files is correctly consolidated into `connectivity.ts` (~445 lines). This is a pragmatic simplification that does not affect correctness or the public API surface.

### One Spec Deviation — MINOR

The implementation plan §7 explicitly required `"exactOptionalPropertyTypes": true` in `tsconfig.json`. The actual `tsconfig.json` omits this flag. Without it, TypeScript allows assigning `undefined` to optional properties as if they were present (e.g., `{ confidence: undefined }` satisfies `{ confidence?: number }`). The code is likely correct as written, but this weakens the type safety of the `EmitSignalInput` and `ConnectivitySignal` interfaces.

---

## 2. Boundary Cleanliness

### Routing Boundary — PASS

- `RoutingEscalationHook` is an interface defined in connectivity; routing implements it. ✓
- `RequestedRoutingMode` is defined in connectivity; routing re-defines its own mirror (`ConnectivityEscalationSignal`) to avoid circular imports per routing spec §4.7. ✓
- `connectivity.ts` calls `config.routingEscalationHook?.onEscalation(signal)` and ignores the returned mode. ✓
- No `@relay-assistant/routing` in `package.json` dependencies. ✓

### Coordination Boundary — PASS

- Coordination is not imported or referenced anywhere. ✓
- `SelectedAudienceResolver` is registered by coordination, called by connectivity — correct inversion. ✓
- Connectivity never calls coordination. ✓

### Transport / Persistence / Session / Surface Boundary — PASS

- All signals are in-process. ✓
- No network, queue, or storage dependencies. ✓
- `package.json` has exactly one runtime dependency: `nanoid`. ✓

### Public API Surface — NEAR PASS

Spec §15 specifies the exact export surface. The implementation exports everything from spec §15 and additionally exports the runtime constants:

```
MESSAGE_CLASSES, MESSAGE_CLASS_TO_SIGNAL_PREFIX, SIGNAL_AUDIENCES,
SIGNAL_CLASSES, SIGNAL_EVENTS, SIGNAL_PRIORITIES, SIGNAL_STATES, TERMINAL_STATES
```

These are beyond the spec's stated API surface. They do not expose internals (no `SignalLog`, `SuppressionWindow`, etc.) and are useful for downstream consumers doing validation. However, they widen the public API beyond what the spec intended for v1.

---

## 3. Test Coverage Assessment

### What Is Covered — STRONG

The consolidated `connectivity.test.ts` covers all four workflow shapes and the most important behaviors:

| Workflow / Behavior | Covered |
|---|---|
| WF-C1: Narrowcast attention, selected resolver called, signal queryable + resolvable | ✓ |
| WF-C2: Two conflict.active signals queryable; resolve clears them from active set | ✓ (partial — resolves only one, not both) |
| WF-C3: handoff.ready emits and fires onSignal | ✓ |
| WF-C4: escalation.uncertainty triggers hook; hook failure does not block callbacks | ✓ |
| ID format (`sig_<nanoid>`), ISO-8601 timestamp, initial state=emitted | ✓ |
| get() returns null for unknown IDs | ✓ |
| query() by messageClass, state, priority, limit, order, unknown thread | ✓ |
| resolve() emitted→resolved, active→resolved, idempotent | ✓ |
| resolve() throws for unknown signal, superseded signal | ✓ |
| Suppression within step, bypass on resolve, bypass on step advance | ✓ |
| Critical priority bypasses suppression | ✓ |
| High-priority escalation with different summary bypasses suppression | ✓ |
| Time-basis suppression with fake timers | ✓ |
| expiresAtStep expiry on advanceStep | ✓ |
| Already-terminal signals not re-expired | ✓ |
| advanceStep on unknown thread is no-op | ✓ |
| onSignal fires emitted/superseded/resolved/expired events | ✓ |
| offSignal stops delivery | ✓ |
| Callback exception isolation | ✓ |
| Routing hook called for escalation.interrupt and escalation.uncertainty, not for others | ✓ |
| Hook failure does not block onSignal callbacks | ✓ |
| messageClass/signalClass cross-consistency rejected | ✓ |
| Per-class confidence range rejected (confidence.blocker at 0.1) | ✓ |

### What Is Missing — GAPS

These scenarios from the implementation plan's minimum test spec are absent:

| Missing scenario | Plan source |
|---|---|
| `handoff.partial` → `handoff.ready` with `replaces` supersedes the partial signal | `wf-c3.test.ts` test 2 |
| `audience='self'` resolves to `[signal.source]` | `audience.test.ts` |
| `audience='all'` includes all thread sources + coordinator | `audience.test.ts` |
| `audience='selected'` with no resolver returns `[]` | `audience.test.ts` |
| Registering a new resolver replaces the prior one | `audience.test.ts` |
| Different `audience` bypasses suppression | `suppression.test.ts` |
| Superseding a terminal signal throws `ConnectivityError` | `lifecycle.test.ts` |
| Signal without `expiresAtStep` does not expire | `step.test.ts` |
| Signal with `expiresAtStep=2` not expired after one advanceStep | `step.test.ts` |
| EmitSignalInput does not include id/emittedAt/state (structural) | `types.test.ts` |
| Suppressed emit does NOT fire callbacks | `callbacks.test.ts` + `suppression.test.ts` |
| WF-C2: resolving BOTH conflict.active signals clears both from active query | `wf-c2.test.ts` test 2 |

**Overall test count:** approximately 16–20 `it()` blocks vs. the plan's minimum of 60. The plan's 12-file / 60-test target is not met.

---

## 4. Follow-ups Before Integration Work Begins

The following items should be addressed or tracked before `@relay-assistant/connectivity` is integrated as a dependency in `@relay-assistant/coordination` or product code:

### Required Before Integration

**FU-1: Add `exactOptionalPropertyTypes: true` to tsconfig.json**
The implementation plan explicitly required this flag. Without it, optional property semantics are weaker than intended. Risk: low for current code, higher as consumers start passing `EmitSignalInput` objects with explicit `undefined` values.

**FU-2: Add missing test scenarios**
The following gaps should be closed before coordination starts writing integration tests that depend on this package:
- `handoff.partial` → `handoff.ready` supersession (WF-C3 second case)
- `audience='self'` and `audience='all'` resolution paths
- `audience='selected'` with no resolver returns `[]`
- Different `audience` bypasses suppression
- Superseding a terminal signal throws `ConnectivityError`
- Suppressed emit does NOT fire callbacks
- Resolving both conflict signals clears both from active query (WF-C2 complete)

**FU-3: Decide on extra constant exports**
`MESSAGE_CLASSES`, `SIGNAL_CLASSES`, `SIGNAL_AUDIENCES`, `SIGNAL_EVENTS`, `SIGNAL_PRIORITIES`, `SIGNAL_STATES`, `TERMINAL_STATES`, and `MESSAGE_CLASS_TO_SIGNAL_PREFIX` are exported beyond spec §15's stated surface. This is useful for downstream consumers but was not in the spec. Either document these as intentional v1 extensions or remove them before consumers take a dependency.

### Advisory (Can Follow Integration)

**FU-4: Run `tsc --noEmit` and verify zero errors**
The implementation plan's Definition of Done (§9, item 3) requires `tsc --noEmit` to pass with strict mode. This was not independently verified during this review. Run before marking v1 complete.

**FU-5: Verify `advanceStep()` expiry boundary condition**
The expiry condition is `expiresAtStep <= currentStep`. With step-basis suppression, a signal emitted at step 0 with `expiresAtStep=1` should expire after the first `advanceStep()` (step becomes 1, `1 <= 1` is true). This is correct per implementation plan test target. Add an explicit test to lock this behavior before routing integration tests depend on it.

**FU-6: Document the `active` state promotion edge case**
`state='active'` is assigned after callbacks fire, conditioned on `callbacks.size > 0 && signal.state === 'emitted'`. If a callback calls `resolve()` on the signal during the fire loop, the signal lands in `'resolved'` rather than `'active'`. This is correct but worth a comment in the code and a test for coordination's benefit.

---

## Summary

| Dimension | Verdict |
|---|---|
| Type definitions match spec | PASS |
| emit() orchestration matches spec | PASS |
| Lifecycle state machine correct | PASS |
| Suppression logic correct | PASS |
| Routing boundary clean | PASS |
| Coordination boundary clean | PASS |
| No forbidden dependencies | PASS |
| Public API surface | NEAR PASS (extra constants exported) |
| tsconfig strictness | GAP (missing exactOptionalPropertyTypes) |
| Test count vs. plan minimum | GAP (~20 of 60+ tests) |
| All 4 workflow shapes covered | PASS (WF-C1, WF-C4 complete; WF-C2 partial; WF-C3 partial) |

The implementation is functionally correct, boundary-clean, and demonstrates all four v1 workflow shapes. The core logic faithfully implements the spec. The gaps are in test completeness and one tsconfig flag — neither blocks the implementation from being valid, but both should be resolved before integration dependencies accumulate. Integration work can begin in parallel with FU-1 and FU-2 being addressed.

---

V1_CONNECTIVITY_PACKAGE_REVIEW_COMPLETE
