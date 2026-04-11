# v1 Surfaces Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Package:** `@relay-assistant/surfaces`
**Spec:** `docs/specs/v1-surfaces-spec.md` (SPEC_RECONCILED)
**Plan:** `docs/architecture/v1-surfaces-implementation-plan.md`

---

## Summary

The implementation is well-executed. All required types are present and structurally correct. The factory function, normalization logic, fanout, connection state management, and package boundary constraints are all implemented as specified. The tests cover the critical paths. Six follow-up items are identified below — none are blocking for the WF-5 PR, but three should be addressed before v1 assembly.

---

## 1. Spec Conformance

### 1.1 Type Exports

All types from spec §4 are implemented in `packages/surfaces/src/types.ts` and re-exported from `index.ts`:

| Spec section | Export | Status |
|---|---|---|
| §4.1 | `SurfaceConnection`, `SurfaceType`, `SurfaceState` | ✅ Exact match |
| §4.2 | `SurfaceCapabilities` | ✅ Exact match |
| §4.3 | `SurfaceAdapter` | ✅ Exact match |
| §4.4 | `SurfacePayload` | ✅ Matches (uses `SurfaceOutboundEvent` locally instead of `OutboundEvent` — same shape) |
| §4.5 | `SurfaceFormatHook` | ✅ Exact match |
| §4.6 | `SurfaceRegistry` | ✅ All methods present; see §1.3 for minor deviation |
| §4.7 | `FanoutPolicy` | ✅ Exact match |
| §4.8 | `FanoutResult`, `FanoutOutcome` | ✅ Exact match |
| §4.9–4.10 | Inbound adapter + normalization | ✅ Correctly implemented |
| §4.11 | `SurfaceNotFoundError`, `SurfaceConflictError`, `SurfaceDeliveryError` | ✅ Exact match including `this.name` and `this.cause` |
| §5 | `SurfaceRegistryConfig`, `createSurfaceRegistry` | ✅ Implemented |

Structural types `NormalizedInboundMessage` and `SurfaceOutboundEvent` match `core.InboundMessage` and `core.OutboundEvent` field-for-field. The zero-runtime-import pattern works correctly.

### 1.2 Factory Behavior

- `register()`: conflict check + adapter callback wiring ✅
- `unregister()`: idempotent ✅
- `get()`: returns null for missing ✅
- `list()`: state and type filter ✅
- `send()`: format hook application, SurfaceDeliveryError wrapping ✅
- `fanout()`: concurrent (Promise.all) for `continue`, sequential (for-of) for `abort`, correct FanoutResult construction ✅
- `receiveRaw()`: normalization hook bypass or default extraction ✅
- Default normalization: all field paths from spec §4.10 are implemented, `userId`-missing rejection is correct, `text`-missing warning is correct ✅
- `onMessage()` / `offMessage()`: implemented with a `Set` (correct; avoids duplicates and gives O(1) removal) ✅

### 1.3 Minor Spec Deviations

**`SurfaceRegistry` interface includes `receiveRaw`, `onMessage`, `offMessage`**

The spec's §4.6 `SurfaceRegistry` interface only defines `register`, `unregister`, `get`, `list`, `send`, and `fanout`. The implementation adds `receiveRaw`, `onMessage`, and `offMessage` directly to the `SurfaceRegistry` interface in `types.ts`. This is a pragmatic improvement — products can call `receiveRaw()` without needing to cast the registry. It is a minor deviation but not a problem for v1.

**`normalizationHook` return type extended**

The spec (§5) defines the hook as `(surfaceId, raw) => InboundMessage`. The implementation uses `(surfaceId, raw) => NormalizedInboundMessage | null | undefined`, which allows custom hooks to drop messages by returning null or undefined. This is a sensible extension and should be treated as a deliberate v1 decision. Worth documenting.

**`send()` does not guard against inactive surface state**

Spec OQ-2 states: "Current spec throws" for inactive surfaces targeted via `send()`. The implementation's `send()` does not check `connection.state` — it looks up the connection and attempts delivery regardless of state. The fanout path correctly handles inactive surfaces via `skipInactive`. This is an unresolved open question; see Follow-up F-1 below.

---

## 2. Adapter Integration with Core and Sessions

### 2.1 Core integration

The integration pattern is clean and explicit.

`createSurfaceRegistry()` returns `SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape`. The two shape types are locally defined structural aliases of core's `RelayInboundAdapter` and `RelayOutboundAdapter` — no runtime import of core occurs.

The intended wiring pattern:

```typescript
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,   // satisfies RelayInboundAdapter
  outbound: surfaceRegistry,  // satisfies RelayOutboundAdapter
});
```

is structurally sound. `core.ts` calls `adapters.inbound.onMessage(handler)` on start and `adapters.inbound.offMessage(handler)` on stop; both are implemented. `core.ts` calls `adapters.outbound.send(event)` for targeted delivery and `adapters.outbound.fanout(event, surfaceIds)` for session fanout; both are implemented with the correct signatures.

The compile-time contract assertions in the test file (lines 38–41) confirm structural assignability:

```typescript
const _inboundContractCheck: CoreInboundAdapter = createSurfaceRegistry();
const _outboundContractCheck: CoreOutboundAdapter = createSurfaceRegistry();
```

These checks will catch interface drift at compile time.

### 2.2 Sessions integration

Surfaces does not import sessions at all — confirmed by `package.json` (zero runtime dependencies). The fanout receives `attachedSurfaceIds: string[]` as a parameter, with session-to-surface-ID resolution happening in `core.ts:resolveAttachedSurfaces()` (lines 165–179). The dependency direction is clean: `core → sessions` (for resolution) and `core → surfaces` (for delivery). `surfaces → sessions` dependency is correctly absent.

---

## 3. Test Coverage

### 3.1 Coverage by area

| Area | Plan count | Implemented | Notes |
|---|---|---|---|
| Surface registration | 5 | 5 | ✅ Full |
| Connection state management | 3 | 3 | ✅ Full |
| Inbound normalization + handlers | 6+3 | 7 | `offMessage` test folded into normalization describe; multi-handler test present |
| Outbound targeted send | 4 | 5 | ✅ Extra test for missing surfaceId |
| Outbound delivery errors | 2 | 2 | ✅ Full |
| Fanout | 7 | 6 | Missing concurrency timing test (see F-2) |
| RelayInboundAdapter contract | 3 | folded | Covered in normalization group, no dedicated describe |
| RelayOutboundAdapter contract | 2 | partially | Implicitly covered; no explicit "adapter contract" describe |
| Compile-time contract checks | 1 | 1 | Present at module level, not in a describe block |

### 3.2 Strengths

- All error paths are tested: `SurfaceConflictError`, `SurfaceNotFoundError`, `SurfaceDeliveryError` with cause chain.
- Normalization paths are well-covered: complete payload, missing userId (drop), missing text (warn + empty string), optional field fallbacks, normalization hook override.
- Fanout policy: continue-on-error, abort-on-first-failure, skipInactive=true (default), skipInactive=false (via defaultFanoutPolicy), unknown surface → skipped.
- Connection state lifecycle is covered: registered → active → inactive → active.
- `vi.spyOn(console, 'error')` and `console.warn` are correctly used to assert log side effects.

### 3.3 Gaps

- **No concurrency test** (plan test 27). The plan required timing-based verification that fanout sends overlap in time. Absent. Acceptable for WF-5 but worth adding.
- **No dedicated `RelayInboundAdapter` / `RelayOutboundAdapter` describe blocks** (plan tests 28–32). The coverage exists but is distributed across other describe groups and compile-time checks.
- **Compile-time contract check not inside a `describe` block.** The checks at lines 38–41 run at module load and will cause a TypeScript compile error if the contract drifts, but they are not structured as a named test. Minor organizational issue.

---

## 4. Follow-ups Before v1 Assembly/Integration

### F-1 — Resolve OQ-2: `send()` behavior for inactive surfaces (SHOULD-FIX before assembly)

**Current behavior:** `send()` looks up the connection and attempts delivery regardless of `connection.state`. There is no inactive guard in the targeted send path.

**Spec position:** OQ-2 is unresolved. The spec note says "current spec throws." The fanout path handles inactive via `skipInactive` policy, but targeted send is silent.

**Required action:** Decide and implement. Options: (a) throw `SurfaceDeliveryError` if `connection.state === 'inactive'`; (b) add an `allowInactive` flag to `send()`; (c) document that inactive state is advisory only for direct sends. Whichever is chosen should match the resolution of OQ-2 and be tested.

---

### F-2 — Add concurrency test for fanout (SHOULD-FIX before assembly)

**Current behavior:** Fanout uses `Promise.all` for the `continue` path, which is correct. But there is no test that verifies the concurrent behavior.

**Required action:** Add a timing-based test using `vi.useFakeTimers()` or delay-injecting mock adapters that verifies sends overlap (i.e., all adapter.send() calls are initiated before any resolve). This matches plan test 27.

---

### F-3 — WF-6 integration test (`packages/core/src/core-sessions-surfaces.test.ts`) (MUST before assembly)

The plan (§4, Slice 2) requires a WF-6 integration test in `packages/core/` covering:
- Session accumulates surface references across interactions
- Targeted send routes only to the specified adapter
- Fanout routes to all `session.attachedSurfaces`
- Invalid emit (no surfaceId, no sessionId) throws `OutboundEventError`
- Detach removes surface from fanout targets
- `FanoutResult` structure is correct

This test does not exist yet. It is the primary acceptance gate for v1 surfaces integration and must exist before the assembly step.

---

### F-4 — WF-4 integration test (`packages/core/src/core-sessions.test.ts`) (MUST before assembly)

Carried from sessions review (F-1). This test validates `runtime.register('sessions', store)` → `emit({ sessionId })` → fanout resolution. Required to verify the core fanout path before adding the surfaces layer on top.

---

### F-5 — Export `SessionSubsystem` from core (NICE-TO-HAVE)

Carried from core review (F-2). `SessionSubsystem` is defined as a local type in `core.ts` (lines 29–37). It is not exported. The surfaces package does not need it (fanout receives `string[]`), but exporting it would allow product code to type-check subsystem registrations. Non-blocking for surfaces v1.

---

### F-6 — Document `normalizationHook` null/undefined return (NICE-TO-HAVE)

The spec defines the hook return type as `InboundMessage`. The implementation returns `NormalizedInboundMessage | null | undefined`, where null/undefined drops the message. This is a useful extension but the README does not mention it. Update the README and spec to document this behavior explicitly so product authors know hooks can drop messages.

---

## Verdict

**PASS_WITH_FOLLOWUPS**

The implementation faithfully delivers the surfaces spec for WF-5: all types, the factory, normalization, send, fanout, state management, format hooks, and the adapter contract are correctly implemented. The package boundary (zero runtime imports from core or sessions) is enforced. Tests cover the essential paths.

F-3 (WF-6 integration test) and F-4 (WF-4 integration test) are required before v1 assembly. F-1 (inactive surface handling in `send()`) and F-2 (concurrency test) should be resolved in this same PR or a targeted patch before assembly. F-5 and F-6 are non-blocking.

V1_SURFACES_REVIEW_COMPLETE
