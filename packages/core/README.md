# `@relay-assistant/core`

`@relay-assistant/core` is the root composition package for the Relay Agent Assistant SDK. It defines the assistant contract, creates the runtime, dispatches normalized inbound messages to capability handlers, and emits outbound events through injected adapters.

The package is TypeScript-first, has no cloud assumptions, and does not implement sessions, surfaces, memory, routing, or product logic. Those concerns stay in later packages and integrate through abstract contracts defined here.

## What It Owns

- `AssistantDefinition` for assistant identity, capabilities, hooks, and runtime constraints
- `createAssistant()` for constructing the runtime with injected inbound and outbound adapters
- `AssistantRuntime` lifecycle methods: `start()`, `stop()`, `dispatch()`, `emit()`, `register()`, `get()`, and `status()`
- capability dispatch with hook support, timeout handling, and concurrency limiting
- outbound targeting by `surfaceId` or session fanout through an abstract sessions subsystem

## What It Does Not Own

- relay transport, HTTP servers, sockets, or surface normalization
- session creation or session lifecycle rules
- memory persistence or retrieval
- model routing, policy enforcement, or coordination logic
- product-specific prompts, workflows, or adapters

## Installation

```bash
npm install
```

From the package directory:

```bash
cd packages/core
npm install
npm test
npm run build
```

## Public API

```ts
import {
  AssistantDefinitionError,
  OutboundEventError,
  createAssistant,
  type AssistantDefinition,
  type InboundMessage,
  type OutboundEvent,
} from "@relay-assistant/core";
```

### `createAssistant(definition, adapters)`

Creates an `AssistantRuntime` from a validated assistant definition and two injected adapters:

- `inbound.onMessage(handler)` and `inbound.offMessage(handler)` connect normalized inbound messages into core
- `outbound.send(event)` delivers targeted outbound messages
- `outbound.fanout(event, surfaceIds)` is optional and used for session fanout when available

The runtime is created in the `created` state. Call `start()` before dispatching messages.

## Runtime Behavior

### Lifecycle

- `start()` is idempotent while started
- `stop()` is idempotent after stop
- a stopped runtime cannot be restarted
- `status()` returns readiness, startup time, registered subsystems, registered capabilities, and current in-flight handler count

### Dispatch

- `dispatch(message)` runs the pre-dispatch `onMessage` hook when defined
- returning `false` from `onMessage` drops the message without invoking a capability
- missing capabilities do not throw from `dispatch()`; they report through `onError`
- capability failures and timeouts report through `onError`
- concurrency is limited by `constraints.maxConcurrentHandlers` and extra dispatches queue in FIFO order

### Emit

- `emit({ surfaceId, text })` performs a targeted send
- `emit({ sessionId, text })` resolves the registered `sessions` subsystem and fans out to its `attachedSurfaces`
- `emit()` throws `OutboundEventError` when neither `surfaceId` nor `sessionId` is present

Core keeps the sessions contract abstract. The runtime expects a subsystem registered under the string key `sessions` with either:

```ts
runtime.register("sessions", {
  async getSession(sessionId: string) {
    return {
      attachedSurfaces: ["surface-a", "surface-b"],
    };
  },
});
```

or:

```ts
runtime.register("sessions", {
  async get(sessionId: string) {
    return {
      attachedSurfaces: ["surface-a", "surface-b"],
    };
  },
});
```

## Example

```ts
import { createAssistant, type InboundMessage } from "@relay-assistant/core";

const runtime = createAssistant(
  {
    id: "assistant-1",
    name: "Example Assistant",
    capabilities: {
      reply: async (message: InboundMessage, context) => {
        context.log.info("handling inbound message");
        await context.runtime.emit({
          surfaceId: message.surfaceId,
          text: `Echo: ${message.text}`,
        });
      },
    },
  },
  {
    inbound: {
      onMessage(handler) {
        void handler;
      },
      offMessage(handler) {
        void handler;
      },
    },
    outbound: {
      async send(event) {
        console.log("send", event);
      },
    },
  },
);

await runtime.start();
```

## Development

- `npm test` runs the isolated Vitest suite for WF-1 and WF-2 core workflows
- `npm run build` emits `dist/` declarations and JavaScript via `tsc`

CORE_PACKAGE_IMPLEMENTED
