# `@agent-assistant/sessions`

`@agent-assistant/sessions` owns assistant session continuity across surfaces and time. It provides spec-aligned session types, a session store factory, an in-memory adapter for local use and tests, and a small affinity helper for lookup-or-create flows.

## Scope

This package owns:

- session identity and lifecycle state
- surface attachment and detachment
- stale-session suspension and explicit expiry
- metadata updates
- affinity-based session reuse helpers

This package does not own:

- memory retrieval or storage
- routing policy decisions
- surface protocol implementations
- cloud storage implementations
- product-specific rules

## Install Shape

The package is TypeScript-first and builds to `dist/`.

```ts
import {
  InMemorySessionStoreAdapter,
  createSessionStore,
  defaultAffinityResolver,
  resolveSession,
} from '@agent-assistant/sessions';
```

## Core API

### `createSessionStore(config)`

Creates a `SessionStore` from an injected `SessionStoreAdapter`.

Supported operations:

- `create`
- `get`
- `find`
- `touch`
- `attachSurface`
- `detachSurface`
- `expire`
- `sweepStale`
- `updateMetadata`

Default TTL is one hour if `defaultTtlMs` is not provided.

### `InMemorySessionStoreAdapter`

Local adapter backed by an in-memory `Map`. It deep-clones reads and writes so callers cannot mutate stored session state accidentally. This is the default adapter to use for tests and isolated local execution.

### `defaultAffinityResolver(store)`

Returns an `AffinityResolver` that prefers the most recently active or suspended session for a user, and prefers a matching attached surface when one is provided.

### `resolveSession(message, store, resolver)`

Looks up an existing session through an affinity resolver and touches it when found. If no session is resolved, it creates a new one using the inbound `userId`, optional `workspaceId`, and `surfaceId`.

## Example

```ts
import {
  InMemorySessionStoreAdapter,
  createSessionStore,
  defaultAffinityResolver,
  resolveSession,
} from '@agent-assistant/sessions';

const store = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
  defaultTtlMs: 30 * 60 * 1000,
});

const resolver = defaultAffinityResolver(store);

const session = await resolveSession(
  {
    userId: 'user-123',
    workspaceId: 'workspace-456',
    surfaceId: 'web-thread-1',
  },
  store,
  resolver,
);

await store.attachSurface(session.id, 'slack-dm-99');
await store.updateMetadata(session.id, { locale: 'en-US' });
```

## Core Integration

The store returned by `createSessionStore` is structurally compatible with core runtime registration:

```ts
runtime.register('sessions', store);
```

Core can then use `store.get(sessionId)` during emit and session lookup flows because returned sessions include `attachedSurfaces`.

## Development

Run inside `packages/sessions`:

```sh
npm test
npm run build
```

SESSIONS_PACKAGE_IMPLEMENTED
