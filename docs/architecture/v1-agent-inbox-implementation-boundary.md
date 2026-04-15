# v1 Agent Inbox Implementation Boundary

**Date:** 2026-04-15
**Status:** IMPLEMENTATION-READY

## 1. Scope

This document defines the exact first bounded implementation slice for the Agent Inbox primitive.

The Agent Inbox is for **trusted outsiders not already on the Relay**. It normalizes external inputs into bounded, typed, trust-aware items that can optionally route into memory candidates and/or turn-context enrichment.

### In scope

- `InboxItem` normalized shape and TypeScript types
- `InboxSourceTrust` metadata model
- `InboxStore` adapter interface (write, get, list, acknowledge)
- Route 1: Inbox item to memory candidate (`InboxToMemoryProjector`)
- Route 2: Inbox item to turn-context enrichment candidate (`InboxToEnrichmentProjector`)
- `@agent-assistant/inbox` package scaffold with types, store contract, and two projectors
- Unit tests for projectors and store contract compliance

### Out of scope

- Full end-user inbox UI
- Universal ingestion adapters (Slack, email, etc.)
- Relay-native agent-to-agent communication (explicitly excluded)
- Connectivity-assisted signaling
- Continuation route (deferred to a later slice)
- Cloud/platform provisioning
- Workflow/orchestration logic

## 2. Normalized Inbox Item Shape

```typescript
// packages/inbox/src/types.ts

export type InboxItemKind =
  | 'imported_chat'
  | 'forwarded_message'
  | 'external_transcript'
  | 'trusted_memo'
  | 'other';

export type InboxItemStatus =
  | 'pending'
  | 'acknowledged'
  | 'projected'
  | 'dismissed'
  | 'expired';

export interface InboxSourceTrust {
  /** Identifier for the originating system (e.g. 'claude-desktop', 'notion-export', 'slack-forward'). */
  sourceId: string;

  /** Human-readable label for the source. */
  sourceLabel?: string;

  /** Trust level assigned by the product layer. */
  trustLevel: 'verified' | 'trusted' | 'unverified';

  /** Identity of the external actor who produced or forwarded this item. */
  actorId?: string;
  actorLabel?: string;

  /** ISO timestamp of when the item was produced at the source. */
  producedAt?: string;
}

export interface InboxItem {
  /** Unique inbox item identifier (product-generated). */
  id: string;

  /** Stable assistant identifier this item is addressed to. */
  assistantId: string;

  /** Kind of inbox item. */
  kind: InboxItemKind;

  /** Processing status. */
  status: InboxItemStatus;

  /** Source and trust metadata. */
  source: InboxSourceTrust;

  /** Primary text content of the inbox item. */
  content: string;

  /** Optional structured payload for machine-readable data. */
  structured?: Record<string, unknown>;

  /** Optional title or subject line. */
  title?: string;

  /** Optional tags for downstream filtering. */
  tags?: string[];

  /** Scoping for memory/enrichment targeting. */
  scope?: InboxItemScope;

  /** ISO timestamp of when the item was received into the inbox. */
  receivedAt: string;

  /** ISO timestamp of when the item expires (optional TTL). */
  expiresAt?: string;

  /** ISO timestamp of last status change. */
  updatedAt: string;

  /** Arbitrary product-owned metadata. */
  metadata?: Record<string, unknown>;
}

export interface InboxItemScope {
  sessionId?: string;
  userId?: string;
  workspaceId?: string;
  threadId?: string;
}
```

## 3. Source Trust Model

Trust is product-assigned, not self-declared by the source. Three levels:

| Level | Meaning | Example |
|---|---|---|
| `verified` | Product has cryptographic or API-level proof of origin | OAuth-authenticated import from a known system |
| `trusted` | Product trusts this source by policy/configuration | Admin-configured forwarding rule |
| `unverified` | Source identity is asserted but not verified | User-pasted transcript |

Trust level flows through to memory and enrichment projections so downstream consumers can make scope and confidence decisions.

## 4. Inbox Store Contract

```typescript
// packages/inbox/src/types.ts

export interface InboxWriteInput {
  assistantId: string;
  kind: InboxItemKind;
  source: InboxSourceTrust;
  content: string;
  structured?: Record<string, unknown>;
  title?: string;
  tags?: string[];
  scope?: InboxItemScope;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface InboxListQuery {
  assistantId: string;
  status?: InboxItemStatus | InboxItemStatus[];
  kind?: InboxItemKind | InboxItemKind[];
  since?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
}

export interface InboxStore {
  write(input: InboxWriteInput): Promise<InboxItem>;
  get(itemId: string): Promise<InboxItem | null>;
  list(query: InboxListQuery): Promise<InboxItem[]>;
  acknowledge(itemId: string): Promise<InboxItem>;
  dismiss(itemId: string): Promise<InboxItem>;
  updateStatus(itemId: string, status: InboxItemStatus): Promise<InboxItem>;
}

export interface InboxStoreAdapter {
  insert(item: InboxItem): Promise<InboxItem>;
  fetchById(itemId: string): Promise<InboxItem | null>;
  fetchMany(query: InboxAdapterQuery): Promise<InboxItem[]>;
  update(itemId: string, patch: Partial<InboxItem>): Promise<InboxItem>;
}

export interface InboxAdapterQuery {
  assistantId: string;
  statuses?: InboxItemStatus[];
  kinds?: InboxItemKind[];
  since?: string;
  excludeExpiredBefore: string;
  limit: number;
  order: 'newest' | 'oldest';
}
```

This follows the same adapter-backed store pattern used by `@agent-assistant/memory` and `@agent-assistant/sessions`.

## 5. Route 1: Inbox to Memory Candidate

Projects an `InboxItem` into a `TurnMemoryCandidate` (from `@agent-assistant/turn-context`) suitable for inclusion in turn-context assembly.

```typescript
// packages/inbox/src/memory-projector.ts

import type { TurnMemoryCandidate } from '@agent-assistant/turn-context';
import type { InboxItem } from './types';

export interface InboxToMemoryProjector {
  project(item: InboxItem): TurnMemoryCandidate | null;
}
```

Projection rules:
- `id` maps from `item.id` (prefixed `inbox:` to distinguish provenance)
- `text` maps from `item.content` (truncated if needed by product config)
- `scope` maps from `item.scope`: userId -> `'user'`, sessionId -> `'session'`, workspaceId -> `'workspace'`, default `'user'`
- `source` set to `item.source.sourceId`
- `relevance` derived from trust level: `verified` -> 0.9, `trusted` -> 0.7, `unverified` -> 0.4
- `freshness` derived from `item.receivedAt` vs now
- Returns `null` for dismissed or expired items

## 6. Route 2: Inbox to Turn-Context Enrichment Candidate

Projects an `InboxItem` into a `TurnEnrichmentCandidate` (from `@agent-assistant/turn-context`) suitable for backstage enrichment in turn-context assembly.

```typescript
// packages/inbox/src/enrichment-projector.ts

import type { TurnEnrichmentCandidate } from '@agent-assistant/turn-context';
import type { InboxItem } from './types';

export interface InboxToEnrichmentProjector {
  project(item: InboxItem): TurnEnrichmentCandidate | null;
}
```

Projection rules:
- `id` maps from `item.id` (prefixed `inbox:`)
- `kind` maps from `item.kind`: `imported_chat` -> `'external_snapshot'`, `forwarded_message` -> `'handoff'`, `external_transcript` -> `'external_snapshot'`, `trusted_memo` -> `'specialist_memo'`, `other` -> `'other'`
- `source` set to `item.source.sourceId`
- `title` from `item.title`
- `content` from `item.content`
- `importance` derived from trust level: `verified` -> `'high'`, `trusted` -> `'medium'`, `unverified` -> `'low'`
- `confidence` derived from trust level: `verified` -> 0.95, `trusted` -> 0.75, `unverified` -> 0.4
- `freshness` derived from `item.receivedAt` vs now
- `audience` set to `'assistant'`
- Returns `null` for dismissed or expired items

## 7. Exact Files to Add/Change

### New package: `packages/inbox/`

| File | Purpose |
|---|---|
| `packages/inbox/package.json` | Package manifest, deps on `@agent-assistant/turn-context` and `@agent-assistant/memory` |
| `packages/inbox/tsconfig.json` | TypeScript config (follow existing package pattern) |
| `packages/inbox/src/types.ts` | `InboxItem`, `InboxSourceTrust`, `InboxItemKind`, `InboxItemStatus`, `InboxItemScope`, `InboxStore`, `InboxStoreAdapter`, `InboxWriteInput`, `InboxListQuery`, `InboxAdapterQuery` |
| `packages/inbox/src/inbox.ts` | `createInboxStore(config: InboxStoreConfig): InboxStore` implementation |
| `packages/inbox/src/memory-projector.ts` | `createInboxMemoryProjector(): InboxToMemoryProjector` implementation |
| `packages/inbox/src/enrichment-projector.ts` | `createInboxEnrichmentProjector(): InboxToEnrichmentProjector` implementation |
| `packages/inbox/src/index.ts` | Public re-exports |
| `packages/inbox/src/inbox.test.ts` | Store contract compliance tests (in-memory adapter) |
| `packages/inbox/src/memory-projector.test.ts` | Memory projector unit tests |
| `packages/inbox/src/enrichment-projector.test.ts` | Enrichment projector unit tests |

### Changes to existing packages

| File | Change |
|---|---|
| `packages/sdk/src/index.ts` | Add re-exports for `@agent-assistant/inbox` public API |
| `packages/sdk/package.json` | Add `@agent-assistant/inbox` dependency |
| `package.json` (root) | Add `packages/inbox` to workspaces |

### No changes to

| Package | Why |
|---|---|
| `@agent-assistant/core` | Inbox does not touch the core runtime dispatch loop |
| `@agent-assistant/connectivity` | Inbox is not connectivity-assisted signaling |
| `@agent-assistant/coordination` | Inbox is not orchestration |
| `@agent-assistant/continuation` | Continuation route is deferred to a later slice |
| `@agent-assistant/turn-context` | Types consumed, not modified; inbox imports turn-context types |

## 8. Integration Points

### Turn-context assembly

Products that want inbox items in turn-context should:
1. Query `InboxStore.list({ assistantId, status: 'pending' })` before assembling a turn
2. Use `InboxToMemoryProjector.project()` to create `TurnMemoryCandidate[]`
3. Pass those candidates into `TurnContextInput.memory.candidates`
4. And/or use `InboxToEnrichmentProjector.project()` to create `TurnEnrichmentCandidate[]`
5. Pass those candidates into `TurnContextInput.enrichment.candidates`
6. After successful turn execution, call `InboxStore.acknowledge(itemId)` or `InboxStore.updateStatus(itemId, 'projected')`

This is product-driven composition. The inbox package provides the projectors; the product decides when and how to use them.

### Memory persistence

Products that want inbox items persisted to long-term memory should:
1. Project an inbox item via `InboxToMemoryProjector`
2. Use the resulting candidate to inform a `MemoryStore.write()` call
3. This is a product decision, not an automatic behavior

## 9. Boundary Rules

1. **Inbox is for outsiders not on the Relay.** Relay-native agents must not use the inbox to communicate.
2. **Trust is product-assigned.** Sources do not self-declare their trust level.
3. **Inbox items are bounded and typed.** Every item has a kind, status, source trust, and content.
4. **Projectors are pure functions.** They transform inbox items into existing turn-context types without side effects.
5. **No automatic persistence.** The inbox does not auto-write to memory or auto-inject into turns. Products compose these behaviors.
6. **No Relay-native overlap.** The inbox package must not import from `@agent-assistant/connectivity` or `@agent-assistant/coordination`.
