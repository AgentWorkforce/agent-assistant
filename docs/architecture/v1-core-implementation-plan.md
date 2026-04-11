# v1 Core Implementation Plan

**Status:** DRAFT
**Date:** 2026-04-11
**Canonical spec:** `docs/specs/v1-core-spec.md` (SPEC_RECONCILED)
**Covers:** WF-1 (Define assistant and start runtime) + WF-2 (Handle inbound message via capability dispatch)

---

## 1. Files to Create

```
packages/core/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Public API barrel export
│   ├── types.ts              # All interfaces and type definitions
│   ├── errors.ts             # AssistantDefinitionError, OutboundEventError
│   ├── runtime.ts            # AssistantRuntime implementation + createAssistant factory
│   ├── logger.ts             # ContextLogger implementation (minimal structured logger)
│   └── __tests__/
│       ├── runtime.test.ts   # WF-1: lifecycle tests (start/stop/status/validation)
│       └── dispatch.test.ts  # WF-2: capability dispatch, emit, hooks, concurrency
```

**Total: 8 files.** No subdirectories beyond `src/` and `__tests__/`.

---

## 2. Implementation Slice — WF-1: Define Assistant and Start Runtime

### 2.1 `types.ts` — Type Definitions

Export all interfaces from the core spec §3:

| Type | Notes |
|---|---|
| `AssistantDefinition` | `id`, `name`, `description?`, `capabilities`, `hooks?`, `constraints?` |
| `AssistantRuntime` | Full interface: `definition`, `emit`, `dispatch`, `register`, `get`, `start`, `stop`, `status` |
| `CapabilityHandler` | `(message: InboundMessage, context: CapabilityContext) => Promise<void> \| void` |
| `InboundMessage` | All fields including `userId` (required) and `workspaceId?` (optional) per Contradiction 2 |
| `OutboundEvent` | `surfaceId?` (optional per Contradiction 3), `sessionId?`, `text`, `format?` |
| `CapabilityContext` | `{ runtime: AssistantRuntime, log: ContextLogger }` |
| `AssistantHooks` | `onStart?`, `onStop?`, `onMessage?`, `onError?` |
| `RuntimeConstraints` | `handlerTimeoutMs?` (default 30000), `maxConcurrentHandlers?` (default 10) |
| `RuntimeStatus` | `ready`, `startedAt`, `registeredSubsystems`, `registeredCapabilities`, `inFlightHandlers` |
| `RelayInboundAdapter` | `onMessage(handler)`, `offMessage(handler)` — accepts `InboundMessage` per Contradiction 1 |
| `RelayOutboundAdapter` | `send(event)`, `fanout?(event, surfaceIds)` — `fanout` optional for test stubs |
| `ContextLogger` | Minimal: `info`, `warn`, `error` with structured context fields |

### 2.2 `errors.ts` — Error Types

```typescript
export class AssistantDefinitionError extends Error {
  name = 'AssistantDefinitionError';
}

export class OutboundEventError extends Error {
  name = 'OutboundEventError';
}
```

### 2.3 `runtime.ts` — Runtime Implementation

**`createAssistant(definition, adapters)` factory:**

1. **Validate definition:**
   - `id` must be non-empty string
   - `name` must be non-empty string
   - `capabilities` must be an object with at least one entry; each value must be a function
   - Throw `AssistantDefinitionError` on any violation
2. **Freeze definition** — `Object.freeze` the definition so it cannot be mutated after creation
3. **Build internal state:**
   - `state: 'created' | 'started' | 'stopped'` — lifecycle state machine
   - `subsystems: Map<string, unknown>` — registered subsystems
   - `inFlightCount: number` — active handler invocations
   - `startedAt: string | null`
4. **Return `AssistantRuntime` object** with all methods bound to internal state

**Lifecycle state machine:**

```
created ──start()──▸ started ──stop()──▸ stopped
```

- `start()`: Transitions `created → started`. Wires inbound adapter listener. Calls `onStart` hook. Sets `startedAt`. Double-start on `started` is idempotent (no-op). Start on `stopped` throws.
- `stop()`: Transitions `started → stopped`. Unwires inbound adapter listener. Waits for in-flight handlers to drain (with timeout). Calls `onStop` hook. Double-stop is idempotent.
- `dispatch()` on a stopped runtime throws.

**`runtime.status()`:**

```typescript
{
  ready: state === 'started',
  startedAt,
  registeredSubsystems: [...subsystems.keys()],
  registeredCapabilities: Object.keys(definition.capabilities),
  inFlightHandlers: inFlightCount,
}
```

**`runtime.register(name, subsystem)` / `runtime.get<T>(name)`:**

- OQ-2 resolution: **string keys** for v1 (typed tokens deferred)
- `register` stores in `Map`, returns `this` for chaining
- `get` retrieves from `Map`, throws if not found (clear error: `"Subsystem '${name}' is not registered"`)

### 2.4 `logger.ts` — Minimal ContextLogger

A thin structured logger that prepends `messageId`, `capability`, and `surfaceId` to every log call. Implementation delegates to `console.info/warn/error`. No external logging library.

```typescript
export function createContextLogger(context: {
  messageId: string;
  capability: string;
  surfaceId: string;
}): ContextLogger;
```

### 2.5 `index.ts` — Public Exports

```typescript
// Factory
export { createAssistant } from './runtime';

// Types
export type {
  AssistantDefinition,
  AssistantRuntime,
  AssistantHooks,
  CapabilityHandler,
  CapabilityContext,
  ContextLogger,
  InboundMessage,
  OutboundEvent,
  RuntimeConstraints,
  RuntimeStatus,
  RelayInboundAdapter,
  RelayOutboundAdapter,
} from './types';

// Errors
export { AssistantDefinitionError, OutboundEventError } from './errors';
```

---

## 3. Implementation Slice — WF-2: Capability Dispatch and Emit

All WF-2 logic lives in the same `runtime.ts` file. No new files needed.

### 3.1 `runtime.dispatch(message)`

1. If runtime state is not `started`, throw
2. Call `hooks.onMessage(message)` if defined — if it returns `false`, drop the message (return silently)
3. Look up `message.capability` in the capabilities map
4. If not found: call `hooks.onError` with a descriptive error, then return (no throw — unregistered capabilities are a no-op with error notification)
5. Increment `inFlightCount`
6. Create `CapabilityContext` with `{ runtime, log: createContextLogger(...) }`
7. Invoke handler with timeout:
   - Wrap handler call in `Promise.resolve(handler(message, context))`
   - Race against `setTimeout` of `constraints.handlerTimeoutMs` (default 30000, per-invocation per OQ-4)
   - On timeout: call `hooks.onError` with timeout error
8. On handler error: call `hooks.onError` if defined
9. Decrement `inFlightCount` in `finally` block

**Concurrency gating:**

- Track `inFlightCount` against `constraints.maxConcurrentHandlers` (default 10)
- When at max, queue incoming dispatches in a FIFO array
- When a handler completes, dequeue and dispatch the next message
- Queue is bounded only by memory; core does not drop queued messages

### 3.2 `runtime.emit(event)`

1. If neither `event.surfaceId` nor `event.sessionId` is set, throw `OutboundEventError`
2. **Targeted send** (`event.surfaceId` present): call `outboundAdapter.send(event)`
3. **Session fanout** (`event.sessionId` present, no `surfaceId`):
   - Retrieve session store via `runtime.get('sessions')` — this will throw if sessions subsystem is not registered (expected; fanout requires sessions)
   - Read `session.attachedSurfaces`
   - If `outboundAdapter.fanout` exists, call `outboundAdapter.fanout(event, attachedSurfaceIds)`
   - Otherwise, iterate `attachedSurfaceIds` and call `outboundAdapter.send({ ...event, surfaceId })` for each
4. Return `Promise<void>` — no ack semantics in v1 (OQ-1 resolution)

### 3.3 Inbound Adapter Wiring

On `runtime.start()`:
- Call `inboundAdapter.onMessage(handler)` where `handler` is a function that calls `runtime.dispatch(message)`

On `runtime.stop()`:
- Call `inboundAdapter.offMessage(handler)` to unwire

---

## 4. Package Boundary Rules

### Core MUST NOT:

- Import from any `@relay-assistant/*` package (core is the dependency root)
- Import from any `relay` foundation package
- Implement session creation, lookup, or lifecycle transitions
- Implement surface normalization, format hooks, or surface connection management
- Implement memory retrieval or persistence
- Start HTTP servers, open sockets, or manage transport
- Enforce action policy

### Core MUST:

- Define adapter interfaces (`RelayInboundAdapter`, `RelayOutboundAdapter`) that other packages implement
- Accept adapters via dependency injection at `createAssistant()` call site
- Treat registered subsystems as opaque — `register`/`get` with string keys, no type coupling
- Remain fully functional without any cloud service

### Interfaces That Must Stay Abstract

These interfaces are defined in core but implemented elsewhere:

| Interface | Implemented by | Package |
|---|---|---|
| `RelayInboundAdapter` | `SurfaceRegistry` | `@relay-assistant/surfaces` |
| `RelayOutboundAdapter` | `SurfaceRegistry` | `@relay-assistant/surfaces` |
| `ContextLogger` | Minimal default in core; products may replace | Consumer code |

The subsystem registry (`register`/`get`) is intentionally untyped at the core level. Type safety for subsystem access is the caller's responsibility via generics at call sites (e.g., `runtime.get<SessionStore>('sessions')`).

---

## 5. Minimum Tests

### 5.1 `runtime.test.ts` — WF-1 Lifecycle Tests

| # | Test | Asserts |
|---|---|---|
| 1 | `createAssistant` with valid definition returns runtime | `runtime.definition.id` matches input |
| 2 | `createAssistant` with missing `id` throws `AssistantDefinitionError` | Error name and message |
| 3 | `createAssistant` with empty `capabilities` throws `AssistantDefinitionError` | Error name and message |
| 4 | `createAssistant` with non-function capability value throws `AssistantDefinitionError` | Error name and message |
| 5 | `runtime.start()` sets `status().ready === true` and `startedAt` is set | Status fields |
| 6 | `runtime.stop()` sets `status().ready === false` | Status field |
| 7 | Double `start()` is idempotent | No throw, status unchanged |
| 8 | Double `stop()` is idempotent | No throw, status unchanged |
| 9 | `runtime.register('foo', obj)` returns runtime (chaining) | `runtime.status().registeredSubsystems` includes `'foo'` |
| 10 | `runtime.get('foo')` returns registered subsystem | Deep equals |
| 11 | `runtime.get('missing')` throws | Error message includes subsystem name |
| 12 | `runtime.status()` includes `registeredCapabilities` from definition | Array matches capability keys |

### 5.2 `dispatch.test.ts` — WF-2 Dispatch Tests

| # | Test | Asserts |
|---|---|---|
| 1 | Dispatch calls correct capability handler | Handler invoked with matching `InboundMessage` and `CapabilityContext` |
| 2 | Handler receives `CapabilityContext.runtime` that is the live runtime | `context.runtime === runtime` |
| 3 | Handler calls `context.runtime.emit({ surfaceId, text })` — outbound adapter `send` called | Adapter spy receives correct `OutboundEvent` |
| 4 | `emit()` with neither `surfaceId` nor `sessionId` throws `OutboundEventError` | Error name |
| 5 | `onMessage` hook returning `false` prevents handler invocation | Handler not called |
| 6 | `onMessage` hook returning `true` allows handler invocation | Handler called |
| 7 | Dispatch with unregistered capability calls `onError` hook | `onError` called with descriptive error |
| 8 | Handler that throws calls `onError` hook | `onError` called with handler's error and original message |
| 9 | `dispatch()` on stopped runtime throws | Error thrown |
| 10 | `status().inFlightHandlers` increments during handler execution | Checked inside handler via `context.runtime.status()` |
| 11 | Handler timeout triggers `onError` after `handlerTimeoutMs` | `onError` called with timeout error |
| 12 | `onStart` hook called during `runtime.start()` | Hook spy invoked |
| 13 | `onStop` hook called during `runtime.stop()` | Hook spy invoked |

### Test Infrastructure

- **Test runner:** Vitest (standard for TypeScript monorepos; zero-config with `tsconfig.json`)
- **No mocking library required:** Use simple function spies and stub adapters
- **Stub adapters:** Inline in test files — minimal objects implementing `RelayInboundAdapter` and `RelayOutboundAdapter`

```typescript
// Example stub used across tests
function createStubAdapters() {
  const handlers: Array<(msg: InboundMessage) => void> = [];
  const sent: OutboundEvent[] = [];
  return {
    inbound: {
      onMessage: (h: (msg: InboundMessage) => void) => { handlers.push(h); },
      offMessage: (h: (msg: InboundMessage) => void) => {
        const idx = handlers.indexOf(h);
        if (idx >= 0) handlers.splice(idx, 1);
      },
    } satisfies RelayInboundAdapter,
    outbound: {
      send: async (e: OutboundEvent) => { sent.push(e); },
    } satisfies RelayOutboundAdapter,
    sent,
    handlers,
  };
}
```

---

## 6. `package.json` Skeleton

```json
{
  "name": "@relay-assistant/core",
  "version": "0.1.0",
  "description": "Assistant definition, lifecycle, and runtime composition for Relay Agent Assistant SDK",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "files": ["dist"],
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

**Zero runtime dependencies.** Only `typescript` and `vitest` as dev dependencies. Core uses Node.js built-ins only.

---

## 7. Implementation Order

```
Step 1 ─ types.ts + errors.ts        (all interfaces and error classes)
Step 2 ─ logger.ts                    (minimal ContextLogger factory)
Step 3 ─ runtime.ts                   (createAssistant + lifecycle: WF-1)
Step 4 ─ runtime.test.ts             (WF-1 acceptance tests)
Step 5 ─ runtime.ts additions        (dispatch + emit + hooks + concurrency: WF-2)
Step 6 ─ dispatch.test.ts            (WF-2 acceptance tests)
Step 7 ─ index.ts                    (barrel exports)
Step 8 ─ package.json + tsconfig.json (build verification)
```

Steps 1–4 are WF-1. Steps 5–6 are WF-2. Steps 7–8 finalize the package shell.

Each step produces a working, testable increment. Steps 1–4 should be one PR (WF-1). Steps 5–8 should be a second PR (WF-2). Both PRs land in `packages/core/`.

---

## 8. Open Question Resolutions for v1

| OQ | Resolution | Rationale |
|---|---|---|
| OQ-1 | `emit()` returns `Promise<void>`, no ack | Keep simple; ack semantics deferred to when surfaces package defines delivery contracts |
| OQ-2 | String keys for `register()`/`get()` | Simpler; typed tokens add complexity without v1 payoff. Callers use `get<T>()` generics. |
| OQ-3 | `onMessage` hook is the pre-dispatch filter | Middleware chain deferred. `onMessage` returning `false` drops; `true`/`undefined` proceeds. |
| OQ-4 | `handlerTimeoutMs` applies per-invocation | Per-capability timeouts would require a more complex config shape; defer to v1.1 if needed. |

---

V1_CORE_IMPLEMENTATION_PLAN_READY
