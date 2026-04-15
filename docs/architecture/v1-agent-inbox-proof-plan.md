# v1 Agent Inbox Proof Plan

**Date:** 2026-04-15
**Status:** IMPLEMENTATION-READY

## Purpose

Step-by-step implementation plan for the first bounded Agent Inbox slice. Each step is independently verifiable.

---

## Step 1: Package scaffold

**Goal:** Create `packages/inbox/` with build infrastructure.

**Files to create:**
- `packages/inbox/package.json`
- `packages/inbox/tsconfig.json`
- `packages/inbox/src/index.ts` (empty re-export stub)

**Files to modify:**
- `package.json` (root): add `packages/inbox` to workspaces array

**Verification:**
- `npm install` succeeds at root
- `npx tsc --noEmit -p packages/inbox/tsconfig.json` succeeds

---

## Step 2: Type definitions

**Goal:** Define all inbox types.

**Files to create:**
- `packages/inbox/src/types.ts`

**Types to define:**
- `InboxItemKind` (union: `imported_chat`, `forwarded_message`, `external_transcript`, `trusted_memo`, `other`)
- `InboxItemStatus` (union: `pending`, `acknowledged`, `projected`, `dismissed`, `expired`)
- `InboxSourceTrust` (interface: `sourceId`, `sourceLabel?`, `trustLevel`, `actorId?`, `actorLabel?`, `producedAt?`)
- `InboxItemScope` (interface: `sessionId?`, `userId?`, `workspaceId?`, `threadId?`)
- `InboxItem` (interface: full normalized shape per boundary doc)
- `InboxWriteInput` (interface)
- `InboxListQuery` (interface)
- `InboxStore` (interface: `write`, `get`, `list`, `acknowledge`, `dismiss`, `updateStatus`)
- `InboxStoreAdapter` (interface: `insert`, `fetchById`, `fetchMany`, `update`)
- `InboxAdapterQuery` (interface)
- `InboxStoreConfig` (interface: `adapter`)
- `InboxItemNotFoundError` (class)
- `InboxInvalidStatusTransitionError` (class)

**Verification:**
- `npx tsc --noEmit -p packages/inbox/tsconfig.json` succeeds
- Types align exactly with the boundary doc shapes

---

## Step 3: Inbox store implementation

**Goal:** Implement `createInboxStore()` backed by an adapter.

**Files to create:**
- `packages/inbox/src/inbox.ts`

**Implementation details:**
- `createInboxStore(config: InboxStoreConfig): InboxStore`
- `write()`: generate UUID id, set `status: 'pending'`, set `receivedAt` and `updatedAt` to now ISO, delegate to `adapter.insert()`
- `get()`: delegate to `adapter.fetchById()`
- `list()`: normalize query, set `excludeExpiredBefore` to now ISO, delegate to `adapter.fetchMany()`
- `acknowledge()`: fetch item, assert status is `pending`, set status to `acknowledged`, set `updatedAt`, delegate to `adapter.update()`
- `dismiss()`: fetch item, assert status is `pending` or `acknowledged`, set status to `dismissed`, set `updatedAt`, delegate to `adapter.update()`
- `updateStatus()`: fetch item, validate transition, set `updatedAt`, delegate to `adapter.update()`

**Valid status transitions:**
- `pending` -> `acknowledged`, `projected`, `dismissed`, `expired`
- `acknowledged` -> `projected`, `dismissed`, `expired`
- `projected` -> (terminal)
- `dismissed` -> (terminal)
- `expired` -> (terminal)

**Verification:**
- `npx tsc --noEmit` succeeds

---

## Step 4: Inbox store tests

**Goal:** Verify store contract compliance with an in-memory adapter.

**Files to create:**
- `packages/inbox/src/inbox.test.ts`

**Test cases:**
1. `write()` creates an item with generated id, pending status, and correct timestamps
2. `get()` returns the written item by id
3. `get()` returns null for unknown id
4. `list()` returns items filtered by assistantId
5. `list()` filters by status
6. `list()` filters by kind
7. `list()` excludes expired items
8. `list()` respects limit and order
9. `acknowledge()` transitions pending -> acknowledged
10. `acknowledge()` rejects non-pending items
11. `dismiss()` transitions pending -> dismissed
12. `dismiss()` transitions acknowledged -> dismissed
13. `dismiss()` rejects already-dismissed items
14. `updateStatus()` rejects invalid transitions (e.g., dismissed -> pending)

**In-memory adapter:** Create a simple `InMemoryInboxStoreAdapter` implementing `InboxStoreAdapter` for test use.

**Verification:**
- `npx vitest run packages/inbox/src/inbox.test.ts` passes

---

## Step 5: Memory projector

**Goal:** Implement inbox-to-memory-candidate projection.

**Files to create:**
- `packages/inbox/src/memory-projector.ts`

**Implementation details:**
- `createInboxMemoryProjector(): InboxToMemoryProjector`
- `project(item: InboxItem): TurnMemoryCandidate | null`
- Return `null` if `item.status` is `dismissed` or `expired`
- Map `id` to `'inbox:' + item.id`
- Map `text` to `item.content`
- Map `scope` from `item.scope`: prefer `userId` -> `'user'`, then `sessionId` -> `'session'`, then `workspaceId` -> `'workspace'`, default `'user'`
- Map `source` to `item.source.sourceId`
- Map `relevance`: `verified` -> 0.9, `trusted` -> 0.7, `unverified` -> 0.4
- Map `freshness`: if `receivedAt` < 1h ago -> `'current'`, < 24h -> `'recent'`, else `'stale'`

**Dependency:** imports `TurnMemoryCandidate` from `@agent-assistant/turn-context`

**Verification:**
- `npx tsc --noEmit` succeeds

---

## Step 6: Memory projector tests

**Goal:** Verify memory projection logic.

**Files to create:**
- `packages/inbox/src/memory-projector.test.ts`

**Test cases:**
1. Projects `imported_chat` item with verified trust to correct memory candidate
2. Projects `trusted_memo` item with trusted trust level
3. Projects `forwarded_message` with unverified trust level
4. Returns null for dismissed item
5. Returns null for expired item
6. Maps scope correctly: userId present -> `'user'`
7. Maps scope correctly: only sessionId present -> `'session'`
8. Maps scope correctly: only workspaceId present -> `'workspace'`
9. Freshness is `'current'` for items received < 1h ago
10. Freshness is `'stale'` for items received > 24h ago

**Verification:**
- `npx vitest run packages/inbox/src/memory-projector.test.ts` passes

---

## Step 7: Enrichment projector

**Goal:** Implement inbox-to-enrichment-candidate projection.

**Files to create:**
- `packages/inbox/src/enrichment-projector.ts`

**Implementation details:**
- `createInboxEnrichmentProjector(): InboxToEnrichmentProjector`
- `project(item: InboxItem): TurnEnrichmentCandidate | null`
- Return `null` if `item.status` is `dismissed` or `expired`
- Map `id` to `'inbox:' + item.id`
- Map `kind`: `imported_chat` -> `'external_snapshot'`, `forwarded_message` -> `'handoff'`, `external_transcript` -> `'external_snapshot'`, `trusted_memo` -> `'specialist_memo'`, `other` -> `'other'`
- Map `source` to `item.source.sourceId`
- Map `title` from `item.title`
- Map `content` from `item.content`
- Map `importance`: `verified` -> `'high'`, `trusted` -> `'medium'`, `unverified` -> `'low'`
- Map `confidence`: `verified` -> 0.95, `trusted` -> 0.75, `unverified` -> 0.4
- Map `freshness` same as memory projector
- Set `audience` to `'assistant'`

**Dependency:** imports `TurnEnrichmentCandidate` from `@agent-assistant/turn-context`

**Verification:**
- `npx tsc --noEmit` succeeds

---

## Step 8: Enrichment projector tests

**Goal:** Verify enrichment projection logic.

**Files to create:**
- `packages/inbox/src/enrichment-projector.test.ts`

**Test cases:**
1. Projects `imported_chat` to `external_snapshot` kind with correct fields
2. Projects `forwarded_message` to `handoff` kind
3. Projects `external_transcript` to `external_snapshot` kind
4. Projects `trusted_memo` to `specialist_memo` kind
5. Projects `other` to `other` kind
6. Maps verified trust to high importance and 0.95 confidence
7. Maps trusted trust to medium importance and 0.75 confidence
8. Maps unverified trust to low importance and 0.4 confidence
9. Returns null for dismissed item
10. Returns null for expired item
11. Sets audience to `'assistant'`

**Verification:**
- `npx vitest run packages/inbox/src/enrichment-projector.test.ts` passes

---

## Step 9: Public API and SDK integration

**Goal:** Wire up public exports and add to SDK facade.

**Files to modify:**
- `packages/inbox/src/index.ts`: re-export public types, `createInboxStore`, `createInboxMemoryProjector`, `createInboxEnrichmentProjector`, error classes
- `packages/sdk/src/index.ts`: add `@agent-assistant/inbox` re-exports section
- `packages/sdk/package.json`: add `@agent-assistant/inbox` to dependencies

**Public API surface:**
```typescript
// Functions
export { createInboxStore } from './inbox';
export { createInboxMemoryProjector } from './memory-projector';
export { createInboxEnrichmentProjector } from './enrichment-projector';

// Types
export type {
  InboxItem,
  InboxItemKind,
  InboxItemStatus,
  InboxSourceTrust,
  InboxItemScope,
  InboxStore,
  InboxStoreAdapter,
  InboxStoreConfig,
  InboxWriteInput,
  InboxListQuery,
  InboxAdapterQuery,
  InboxToMemoryProjector,
  InboxToEnrichmentProjector,
} from './types';

// Errors
export { InboxItemNotFoundError, InboxInvalidStatusTransitionError } from './types';
```

**Verification:**
- `npx tsc --noEmit` succeeds across all packages
- `npm test` passes at root (no regressions)

---

## Step 10: Full verification

**Goal:** Confirm the entire implementation against the no-regression checklist.

**Actions:**
1. Run `npm test` at root — all tests pass
2. Run `npx tsc --noEmit` at root — no type errors
3. Walk through every item in `v1-agent-inbox-no-regression-checklist.md`
4. Confirm no imports from connectivity, coordination, routing, continuation, sessions, surfaces, policy, or proactive in `packages/inbox/`
5. Confirm no changes to any existing type interface
6. Confirm all existing tests remain unchanged and passing

**Verification:**
- Checklist is fully green
- Implementation is ready for review

---

## Summary

| Step | Files created | Files modified | Test count |
|---|---|---|---|
| 1 | 3 | 1 | 0 |
| 2 | 1 | 0 | 0 |
| 3 | 1 | 0 | 0 |
| 4 | 1 | 0 | 14 |
| 5 | 1 | 0 | 0 |
| 6 | 1 | 0 | 10 |
| 7 | 1 | 0 | 0 |
| 8 | 1 | 0 | 11 |
| 9 | 0 | 3 | 0 |
| 10 | 0 | 0 | 0 |
| **Total** | **10 new files** | **4 modified files** | **35 tests** |
