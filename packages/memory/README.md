# `@agent-assistant/memory`

`@agent-assistant/memory` is the v1 assistant-facing composition layer over `@agent-relay/memory`.

It reuses relay adapters directly for persistence and CRUD, then adds only the approved v1 behaviors:
- assistant memory scopes: `session`, `user`, `workspace`, `org`, `object`
- structured retrieval by scope, tags, and recency
- optional user-scope expansion into an explicit session scope
- promotion to broader scopes
- compaction orchestration through a caller-supplied callback
- TTL filtering through assistant-managed metadata

It does not implement a new memory engine, semantic search, policy controls, cloud-only behavior, or cross-agent consolidation.

## Installation

```bash
npm install @agent-assistant/memory
```

## Exports

```typescript
import {
  createMemoryStore,
  InMemoryMemoryStoreAdapter,
  RelayMemoryStoreAdapter,
} from '@agent-assistant/memory';
```

The package exports the public `MemoryEntry`, `MemoryScope`, `MemoryStore`, input/query types, and the error classes `MemoryEntryNotFoundError`, `InvalidScopePromotionError`, and `CompactionError`.

## Quick Start

```typescript
import { createMemoryStore, InMemoryMemoryStoreAdapter } from '@agent-assistant/memory';

const memory = createMemoryStore({
  adapter: new InMemoryMemoryStoreAdapter(),
});

const sessionEntry = await memory.write({
  scope: { kind: 'session', sessionId: 'sess-123' },
  content: 'User prefers concise responses.',
  tags: ['preference', 'style'],
  metadata: {
    agentId: 'assistant-1',
    source: 'capability:intake',
  },
});

const results = await memory.retrieve({
  scope: { kind: 'session', sessionId: 'sess-123' },
  tags: ['preference'],
});

const promoted = await memory.promote({
  sourceEntryId: sessionEntry.id,
  targetScope: { kind: 'user', userId: 'user-456' },
  deleteOriginal: true,
});

const compacted = await memory.compact({
  sourceEntryIds: [promoted.id],
  targetScope: { kind: 'user', userId: 'user-456' },
  compactionCallback: (entries) => entries.map((entry) => entry.content).join('\n'),
  tags: ['summary'],
});
```

## Relay Reuse

V1 reuses `@agent-relay/memory` directly:
- `InMemoryAdapter` powers `InMemoryMemoryStoreAdapter`
- any compatible relay `MemoryAdapter` can be wrapped with `RelayMemoryStoreAdapter`
- relay `add()`, `get()`, `update()`, `delete()`, and `list()` remain the underlying storage operations

V1 intentionally does not use relay `MemoryService` or `search()`:
- `MemoryService` does not expose the full update/get/delete-by-scope surface the assistant package needs
- semantic search is deferred; v1 retrieval is structured and recency-biased

## Scope Mapping

Assistant scopes are encoded onto relay fields and metadata:

| Assistant scope | Relay mapping |
|---|---|
| `session` | `sessionId` + `metadata._scopeKind = 'session'` |
| `user` | `metadata.userId` + `metadata._scopeKind = 'user'` |
| `workspace` | `projectId` + `metadata._scopeKind = 'workspace'` |
| `org` | `metadata.orgId` + `metadata._scopeKind = 'org'` |
| `object` | `metadata.objectId` + `metadata.objectType` + `metadata._scopeKind = 'object'` |

The package also stores `metadata._updatedAt` because relay entries expose `createdAt` but no native `updatedAt`.

## Retrieval Rules

`retrieve()` filters by:
- exact scope match
- all requested tags
- `since` timestamp
- expiry

`includeNarrower: true` is intentionally narrow in v1:
- for a `user` scope query, the store also includes `session` entries only when `context.sessionId` is provided
- there is no implicit session discovery
- workspace/org fan-out is not implemented in v1

Retrieval uses relay `list()` and assistant-side filtering. Because relay `list()` is a recent-items primitive, v1 retrieval is recency-biased rather than a guaranteed exhaustive scan over all stored entries.

## Promotion and Compaction

Promotion is upward only:
- `session -> user | workspace | org | object`
- `user -> workspace | org`
- `workspace -> org`
- `object -> user | workspace | org`

Compaction is bounded in v1:
- all source entries must exist
- all sources must share one scope
- `targetScope` must match that source scope
- the caller supplies the compaction callback
- the package never makes a model call

## Expiry and Provenance

`expiresAt` is stored in relay metadata and filtered out by `get()` and `retrieve()`. Expired records remain in the underlying adapter until explicitly deleted.

The package preserves assistant provenance metadata through writes, updates, promotion, and compaction. The intended fields are:
- `agentId`
- `source`
- `confidence`
- `createdInSessionId`
- `promotedFromId`
- `compactedFromIds`

## Production Usage

```typescript
import { createMemoryStore, RelayMemoryStoreAdapter } from '@agent-assistant/memory';
import { createMemoryAdapter } from '@agent-relay/memory';

const relayAdapter = await createMemoryAdapter({
  type: 'supermemory',
  apiKey: process.env.SUPERMEMORY_API_KEY,
});

const memory = createMemoryStore({
  adapter: new RelayMemoryStoreAdapter(relayAdapter),
});
```

The wrapped relay adapter must implement `list()` and `update()`. The constructor rejects adapters that do not provide both methods.

## Isolation

`packages/memory` is runnable on its own:
- `npm install`
- `npm run build`
- `npm test`

The package has no cloud requirement. `InMemoryMemoryStoreAdapter` is the default local/test backend.

## Not In V1

- semantic or embedding search
- automatic memory-writing heuristics
- session archival workflows
- policy-gated access control
- assistant-layer encryption
- cross-agent consolidation, contradiction handling, or shared-team publication

MEMORY_PACKAGE_IMPLEMENTED
