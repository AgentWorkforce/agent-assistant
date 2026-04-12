# `@agent-assistant/surfaces`

`@agent-assistant/surfaces` provides the assistant-facing surface layer for Agent Assistant SDK. It owns surface registration, inbound normalization, outbound dispatch, formatting hooks, and multi-surface fanout. It does not implement transport protocols or product-specific surface logic.

## Responsibilities

- register and track `SurfaceConnection` records
- expose a single registry that satisfies the inbound and outbound adapter contracts used by `@agent-assistant/core`
- normalize raw inbound payloads into the structural `InboundMessage` shape core expects
- dispatch outbound events to one surface or fan them out across session-attached surfaces
- apply optional per-surface formatting hooks before delivery

## Non-Goals

- transport implementation such as HTTP, WebSocket, Slack Events, or desktop IPC
- authentication, webhook verification, or provider SDK concerns
- product-specific formatting conventions or UI behavior
- buffering, retries, or offline queueing

## Installation

```bash
npm install @agent-assistant/surfaces
```

## Core Concepts

`SurfaceConnection` describes one registered surface, including its adapter, capabilities, and current state.

`SurfaceAdapter` is implemented by product code or a transport-facing package. The adapter is responsible only for connection state callbacks and final payload delivery.

`createSurfaceRegistry()` returns one object that acts as:

- the surface registry
- the core inbound adapter
- the core outbound adapter

That lets products wire one registry instance into the runtime and the relay-facing transport layer.

## Usage

```ts
import { createAssistant } from '@agent-assistant/core';
import { createSurfaceRegistry } from '@agent-assistant/surfaces';

const surfaces = createSurfaceRegistry();

const runtime = createAssistant(
  {
    id: 'assistant-1',
    name: 'Assistant',
    capabilities: {
      chat: async (message, context) => {
        await context.runtime.emit({
          surfaceId: message.surfaceId,
          text: `echo:${message.text}`,
        });
      },
    },
  },
  {
    inbound: surfaces,
    outbound: surfaces,
  },
);
```

## Registering A Surface

```ts
surfaces.register({
  id: 'web-primary',
  type: 'web',
  state: 'registered',
  capabilities: {
    markdown: true,
    richBlocks: false,
    attachments: false,
    streaming: false,
    maxResponseLength: 0,
  },
  adapter: {
    async send(payload) {
      // Deliver payload to your transport layer.
    },
    onConnect(callback) {
      // Store and call when the transport becomes active.
    },
    onDisconnect(callback) {
      // Store and call when the transport becomes inactive.
    },
  },
});
```

When the adapter reports connect or disconnect events, the registry updates `connection.state` in place.

## Inbound Flow

Relay-facing code pushes raw events into the registry:

```ts
surfaces.receiveRaw('web-primary', {
  messageId: 'msg-1',
  userId: 'user-1',
  text: 'hello',
  capability: 'chat',
});
```

Default normalization extracts:

- `id` from `messageId` or `id`, otherwise a generated UUID
- `sessionId` from `sessionId` or `session.id`
- `userId` from `userId`, `user.id`, or `user` when it is a string
- `workspaceId` from `workspaceId` or `workspace.id`
- `text` from `text`, `content`, or `body`
- `receivedAt` from `timestamp` or `receivedAt`, otherwise the current time
- `capability` from `capability` or `type`, otherwise `'chat'`

If `userId` is missing, the message is dropped and an error is logged. If text is missing, an empty string is used and a warning is logged.

Products with non-standard relay payloads can replace the default normalization logic with `normalizationHook`.

## Outbound Delivery

Targeted delivery uses `send(event)` and requires `event.surfaceId`.

```ts
await surfaces.send({
  surfaceId: 'web-primary',
  text: 'Hello from the assistant',
});
```

If a connection has a `formatHook`, the hook receives the outbound event and the surface capabilities and can return any surface-specific formatted structure. Without a hook, the adapter receives `event.text` as the formatted output.

Adapter failures are wrapped in `SurfaceDeliveryError`.

## Fanout

When core resolves a session into a set of attached surface IDs, the registry can deliver to all of them:

```ts
const result = await surfaces.fanout(
  {
    sessionId: 'session-1',
    text: 'This reaches every attached surface',
  },
  ['web-primary', 'desktop-1'],
);
```

Fanout behavior:

- sends concurrently by default
- skips unknown surfaces
- skips inactive surfaces by default
- can continue collecting failures or abort on the first failure
- returns a `FanoutResult` with per-surface outcomes

Default fanout behavior can be configured with `defaultFanoutPolicy`.

## Package Boundary

This package is TypeScript-first, runtime-light, and has no cloud assumptions. It does not depend on specific transport stacks, does not import session logic at runtime, and does not contain relay transport implementations.

## Development

```bash
npm test
npm run build
```

SURFACES_PACKAGE_IMPLEMENTED
