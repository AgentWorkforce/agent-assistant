# V1 Foundation Integration Plan

**Date:** 2026-04-11
**Scope:** WF-4 (core + sessions) and WF-6 (core + sessions + surfaces)
**Status:** Planning

---

## 1. Objective

Prove that the three foundation packages (core, sessions, surfaces) work together as one coherent assistant runtime. This integration slice validates the two critical cross-package workflows:

- **WF-4** — Wire session store into runtime: core dispatches messages, resolves sessions via affinity, touches sessions on activity, and emits to session-attached surfaces.
- **WF-6** — Multi-surface session fanout: surface registry serves as both inbound and outbound adapter for core; emit with sessionId fans out to all attached surfaces through the session subsystem.

---

## 2. WF-4 Integration Behaviors to Prove

### 2.1 Core registers sessions as a subsystem

The session store (created via `createSessionStore`) is registered on the runtime via `runtime.register('sessions', store)`. The runtime's `emit()` path calls `runtime.get('sessions')` to resolve attached surfaces when an outbound event carries a `sessionId`.

### 2.2 Session resolution on dispatch

When a message arrives, the integration layer uses `resolveSession()` to find or create a session for the `(userId, surfaceId)` pair. The resolved session is touched (state transitions from `created` → `active`), and the originating surface is attached.

### 2.3 Emit with sessionId resolves attached surfaces

Calling `runtime.emit({ sessionId, text })` triggers the runtime's session-aware fanout path: it reads `session.attachedSurfaces` from the session subsystem and sends to each surface via the outbound adapter.

### 2.4 Session touch updates lastActivityAt

Every dispatch through the integration path calls `store.touch(sessionId)`, which updates `lastActivityAt` and transitions `created`/`suspended` sessions to `active`.

### 2.5 Invalid emit handling

- `emit({})` (no surfaceId, no sessionId) throws `OutboundEventError`.
- `emit({ sessionId: 'nonexistent' })` throws when the session subsystem cannot resolve the session.

---

## 3. WF-6 Integration Behaviors to Prove

### 3.1 Surface registry as core adapters

`createSurfaceRegistry()` returns an object that satisfies both `RelayInboundAdapter` and `RelayOutboundAdapter`. It is passed directly to `createAssistant()` as `{ inbound: registry, outbound: registry }`.

### 3.2 Inbound flow: receiveRaw → normalize → dispatch → handler

A raw event pushed via `registry.receiveRaw(surfaceId, rawPayload)` is normalized into a `NormalizedInboundMessage`, forwarded to the runtime's inbound handler, dispatched to the matching capability handler, which can then emit a response.

### 3.3 Outbound fanout across multiple surfaces

A capability handler calls `runtime.emit({ sessionId, text })`. The runtime resolves attached surfaces from the session subsystem. The outbound adapter (surface registry) calls `registry.fanout()` if available, delivering to each registered, active surface.

### 3.4 Attach/detach affects fanout targets

- After `store.attachSurface(sessionId, 'surface-b')`, a fanout includes surface-b.
- After `store.detachSurface(sessionId, 'surface-b')`, a fanout no longer includes surface-b.

### 3.5 Full runtime lifecycle

`start()` → receive raw messages → dispatch → handle → emit → fanout → `stop()` (drains in-flight handlers). The lifecycle is clean with no leaked handlers or unresolved promises.

### 3.6 Inactive surface skipping during fanout

When a surface transitions to `inactive` state, the default fanout policy (`skipInactive: true`) skips it. Only active surfaces receive the fanout.

---

## 4. Files to Create or Update

### New files (integration tests)

| File | Purpose |
|------|---------|
| `packages/core/src/core-sessions.test.ts` | WF-4 integration tests: core + sessions |
| `packages/core/src/core-sessions-surfaces.test.ts` | WF-6 integration tests: core + sessions + surfaces |

### Existing files (minimal changes only if needed)

| File | Potential change |
|------|-----------------|
| `packages/core/src/core.ts` | None expected — `SessionSubsystem` type already supports both `get()` and `getSession()` patterns; `emit()` already resolves attached surfaces and supports `fanout()` on the outbound adapter. |
| `packages/sessions/src/sessions.ts` | None expected — `resolveSession()` and `defaultAffinityResolver()` already exported. |
| `packages/surfaces/src/surfaces.ts` | None expected — `createSurfaceRegistry()` already returns the combined `SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape` shape. |

**Key observation:** The three packages were designed with these integration contracts already in mind. The integration tests should validate the contracts work together — not require new package code.

---

## 5. Scope Boundaries

### In scope for this integration step

- WF-4 integration test proving core + sessions interop
- WF-6 integration test proving core + sessions + surfaces interop
- Minimal package changes if a test reveals a genuine integration bug
- Verification that type contracts align across package boundaries

### Deferred (not in scope)

- WF-7 end-to-end assembly (separate workflow)
- New packages (connectivity, memory, policy)
- Cloud-specific adapters or product-specific logic
- Performance testing or stress testing
- Custom session affinity strategies beyond default
- OQ-2 (max surfaces per session) and OQ-3 (delete vs. retain expired records)
- OQ-2 from surfaces review (`send()` behavior for inactive surfaces)

---

## 6. Integration Test Specifications

### 6.1 `core-sessions.test.ts` — WF-4 Tests

**Test group: "core + sessions integration (WF-4)"**

1. **"registers session store as subsystem and retrieves it"**
   - Create a session store with in-memory adapter
   - Register it on the runtime as `'sessions'`
   - Assert `runtime.get('sessions')` returns the store
   - Assert `runtime.status().registeredSubsystems` includes `'sessions'`

2. **"resolves a new session on first message from a user"**
   - Start runtime with sessions registered
   - Use `resolveSession()` with a message `{ userId, surfaceId }`
   - Assert a session is created with state `'created'`, the surface is attached
   - Touch the session; assert state transitions to `'active'`

3. **"resolves an existing session on subsequent messages from same user"**
   - Create and touch a session (make it active)
   - Call `resolveSession()` again with the same userId
   - Assert the same session is returned (not a new one)

4. **"emit with sessionId resolves attached surfaces and calls outbound.send for each"**
   - Create a session, attach two surfaces
   - Register the session store on the runtime
   - Call `runtime.emit({ sessionId, text: 'hello' })`
   - Assert `outbound.send()` was called once per attached surface

5. **"emit with sessionId uses outbound.fanout when available"**
   - Same setup but provide an outbound adapter with `fanout()` method
   - Call `runtime.emit({ sessionId, text: 'hello' })`
   - Assert `outbound.fanout()` was called once (not `send()` per surface)

6. **"emit with nonexistent sessionId throws"**
   - Register an empty session store
   - Assert `runtime.emit({ sessionId: 'nope', text: 'x' })` rejects

7. **"emit without surfaceId or sessionId throws OutboundEventError"**
   - Assert `runtime.emit({ text: 'x' })` throws `OutboundEventError`

8. **"session touch updates lastActivityAt on dispatch"**
   - Create and touch a session to make it active
   - Record `lastActivityAt`
   - Wait briefly, touch again
   - Assert `lastActivityAt` has advanced

9. **"attach and detach surface updates session.attachedSurfaces"**
   - Create a session
   - Attach surface-a and surface-b
   - Assert `attachedSurfaces` is `['surface-a', 'surface-b']` (accounting for initial)
   - Detach surface-a
   - Assert `attachedSurfaces` no longer includes surface-a

### 6.2 `core-sessions-surfaces.test.ts` — WF-6 Tests

**Test group: "core + sessions + surfaces integration (WF-6)"**

1. **"surface registry serves as inbound and outbound adapter for core runtime"**
   - Create a surface registry
   - Pass it as `{ inbound: registry, outbound: registry }` to `createAssistant()`
   - Assert runtime starts without error

2. **"receiveRaw → normalize → dispatch → capability handler fires"**
   - Register a surface, start the runtime
   - Push a raw event via `registry.receiveRaw(surfaceId, { userId, text, ... })`
   - Assert the capability handler is called with the normalized message

3. **"capability handler emits to sessionId and fanout delivers to all attached surfaces"**
   - Register two surfaces (surface-a, surface-b) with mock adapters
   - Create a session with both surfaces attached
   - Register session store on runtime
   - Capability handler calls `runtime.emit({ sessionId, text: 'response' })`
   - Push a raw message on surface-a
   - Assert both surface-a and surface-b adapters received the outbound event

4. **"attach new surface mid-session expands fanout targets"**
   - Start with one surface attached
   - Attach a second surface to the session
   - Emit with sessionId
   - Assert both surfaces receive delivery

5. **"detach surface mid-session shrinks fanout targets"**
   - Start with two surfaces attached
   - Detach one
   - Emit with sessionId
   - Assert only the remaining surface receives delivery

6. **"inactive surface is skipped during fanout (default policy)"**
   - Register two surfaces, trigger disconnect on one (state → inactive)
   - Fanout via emit
   - Assert the inactive surface is skipped, active one receives delivery

7. **"full lifecycle: start → receive → dispatch → emit → fanout → stop"**
   - Wire all three packages together
   - Start runtime
   - Push a raw message
   - Assert the capability handler fires, emits a response, response is fanned out
   - Stop runtime
   - Assert clean shutdown (no in-flight handlers, drain completes)

8. **"stop drains in-flight handlers before completing"**
   - Wire a slow capability handler (delayed resolve)
   - Start runtime, push a message
   - Call `stop()` while handler is in-flight
   - Assert stop waits for handler to complete before resolving

9. **"raw message with missing userId is dropped by normalization"**
   - Push a raw event without userId
   - Assert the capability handler is NOT called

10. **"multiple messages dispatched concurrently respect maxConcurrentHandlers"**
    - Set `maxConcurrentHandlers: 2`
    - Push 4 messages rapidly
    - Track concurrent in-flight count inside the handler
    - Assert it never exceeds 2

---

## 7. Assertions Summary

| Behavior | Test file | Test # |
|----------|-----------|--------|
| Subsystem registration | core-sessions | 1 |
| Session resolution (new) | core-sessions | 2 |
| Session resolution (existing) | core-sessions | 3 |
| Emit → session → surfaces | core-sessions | 4, 5 |
| Invalid emit handling | core-sessions | 6, 7 |
| Session touch on activity | core-sessions | 8 |
| Attach/detach effects | core-sessions | 9 |
| Registry as adapter | core-sessions-surfaces | 1 |
| Full inbound flow | core-sessions-surfaces | 2 |
| Session fanout delivery | core-sessions-surfaces | 3 |
| Dynamic attach/detach fanout | core-sessions-surfaces | 4, 5 |
| Inactive surface skip | core-sessions-surfaces | 6 |
| Full lifecycle | core-sessions-surfaces | 7 |
| Drain on stop | core-sessions-surfaces | 8 |
| Normalization drop | core-sessions-surfaces | 9 |
| Concurrency limits | core-sessions-surfaces | 10 |

---

## 8. Implementation Notes

- All tests use `InMemorySessionStoreAdapter` — no external dependencies.
- Surface adapters in tests are simple mocks tracking `send()` calls and exposing `onConnect`/`onDisconnect` triggers.
- No new packages, no cloud assumptions, no product-specific logic.
- TypeScript-first; tests should import directly from package source files.
- Tests should verify the integration contracts, not re-test unit-level behavior already covered by existing test files.

---

V1_FOUNDATION_INTEGRATION_PLAN_READY
FOUNDATION_INTEGRATION_IMPLEMENTED
