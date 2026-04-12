# v1 Memory Package — Focused Implementation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** READY_FOR_IMPLEMENTATION
**Date:** 2026-04-11
**Package:** `@relay-assistant/memory`
**Version:** v0.1.0
**Inputs:** v1-memory-spec.md, v1-memory-implementation-plan.md, v1-memory-reconciliation-review-verdict.md, memory-reuse-investigation.md, actual @agent-relay/memory v4.0.10 source

---

## 1. Bounded v1 Implementation Slice

This plan defines the exact files, types, and behaviors for the first implementable slice of `@relay-assistant/memory`. The slice produces a fully self-contained, testable memory package that composes over `@agent-relay/memory` adapters.

**In scope:**
- All assistant-facing types from spec §8
- In-memory adapter bridge over relay's `InMemoryAdapter`
- Generic relay adapter bridge over any `MemoryAdapter`
- `createMemoryStore` factory with all 8 `MemoryStore` methods
- Scope mapping, promotion, compaction orchestration, expiry filtering
- Provenance metadata preservation
- 50+ tests

**Out of scope:**
- Cross-agent consolidation / librarian (v5-v8)
- Semantic / embedding search (v1.1)
- Session archival workflow (v1.1)
- Policy-gated memory (v2)
- No model calls, no timers, no schedulers

---

## 2. Files to Create Under `packages/memory/`

```
packages/memory/
  package.json              — package metadata, @agent-relay/memory as only runtime dep
  tsconfig.json             — ES2022, NodeNext, strict, declarations to dist/
  src/
    types.ts                — all assistant-facing types, error classes (~200 lines)
    scope-mapper.ts         — scope ↔ relay field translation, promotion validation (~100 lines)
    relay-adapter.ts        — InMemoryMemoryStoreAdapter + RelayMemoryStoreAdapter (~220 lines)
    memory-store.ts         — createMemoryStore factory + all MemoryStore methods (~350 lines)
    index.ts                — public re-exports (~35 lines)
    memory-store.test.ts    — 50 tests using vitest (~450 lines)
  README.md                 — updated from direction doc to actual package documentation
```

**7 source files + 1 test file.** Total estimated: ~1350 lines.

---

## 3. Relay Types/Utilities Reused Directly

| Relay Component | Import Path | How Used |
|---|---|---|
| `InMemoryAdapter` | `@agent-relay/memory` | Wrapped by `InMemoryMemoryStoreAdapter` for tests |
| `MemoryAdapter` (interface) | `@agent-relay/memory` | Type constraint for `RelayMemoryStoreAdapter` constructor |
| `MemoryEntry` (relay type) | `@agent-relay/memory` | Internal type in adapter bridge; mapped to/from assistant `MemoryEntry` |
| `AddMemoryOptions` | `@agent-relay/memory` | Used by adapter bridge `insert()` to call `relay.add()` |
| `MemoryResult` | `@agent-relay/memory` | Return type from `relay.add()`, `relay.delete()`, `relay.update()` |

**NOT used from relay in v1:**
- `MemoryService`, `createMemoryService()` — lacks `get()`, `update()`, bulk-delete-by-scope
- `MemorySearchQuery` — requires semantic query string; v1 uses `list()` instead
- `ContextCompactor` full strategies — assistant compaction uses caller-supplied callback
- `createMemoryHooks()`, auto-learning detection — product-controlled write decisions

---

## 4. What the Assistant Composition Layer Adds in v1

### 4.1 Scoped Memory Model (NEW — ~80 lines in scope-mapper.ts)

Relay uses flat `agentId` + `projectId` + `sessionId`. The assistant layer adds hierarchical scopes:

| Scope | Key | Stored in relay as |
|---|---|---|
| `session` | sessionId | `relay.sessionId` + `relay.metadata._scopeKind: 'session'` |
| `user` | userId | `relay.metadata.userId` + `relay.metadata._scopeKind: 'user'` |
| `workspace` | workspaceId | `relay.projectId` + `relay.metadata._scopeKind: 'workspace'` |
| `org` | orgId | `relay.metadata.orgId` + `relay.metadata._scopeKind: 'org'` |
| `object` | objectId + objectType | `relay.metadata.objectId` + `relay.metadata.objectType` + `relay.metadata._scopeKind: 'object'` |

**Reconciliation follow-up resolved:** A `_scopeKind` discriminator is stored in relay `metadata` to guarantee unambiguous scope round-tripping. This resolves the reconciliation review finding §2 (scope reconstruction risk when entries carry both `sessionId` and `projectId`). Scope reconstruction reads `_scopeKind` first; relay field mapping is secondary.

### 4.2 Assistant-Managed `updatedAt` (NEW — convention in relay-adapter.ts)

**Reconciliation follow-up resolved:** Relay `MemoryEntry` has `createdAt` (epoch ms) and optional `lastAccessedAt`, but no `updatedAt`. The assistant layer stores and reads `metadata._updatedAt` (ISO-8601 string) on every write and update. The `createdAt` value is derived from relay's `createdAt` (epoch ms → ISO-8601 conversion).

### 4.3 Scope Query Expansion (NEW — ~70 lines in memory-store.ts)

`includeNarrower: true` causes fan-out to narrower scopes via multiple `list()` calls + merge. For user-scope queries, session entries are only included when `query.context.sessionId` is explicitly provided. No implicit session discovery.

### 4.4 Promotion (NEW — ~60 lines in memory-store.ts)

Read source entry → validate upward direction → write new entry at broader scope with `promotedFromId` → optionally delete source. Provenance metadata preserved through the promotion.

### 4.5 Entry-Level Compaction with Callback (NEW — ~60 lines in memory-store.ts)

Fetch source entries → invoke caller-supplied `CompactionCallback` → write result with `compactedFromIds` → optionally delete sources. Errors wrapped in `CompactionError`.

### 4.6 TTL / Expiry Filtering (NEW — ~25 lines in relay-adapter.ts)

`expiresAt` stored in `relay.metadata.expiresAt`. Post-retrieval filtering excludes expired entries from `retrieve()` and `get()`.

### 4.7 Provenance Metadata Preservation (CONVENTION — enforced in every write path)

Fields `agentId`, `source`, `confidence`, `createdInSessionId`, `promotedFromId`, `compactedFromIds` are stored in relay entry metadata and never stripped. `promote()` and `compact()` copy provenance from source entries.

### 4.8 Retrieval Completeness Caveat (DOCUMENTED)

**Reconciliation follow-up resolved:** v1 structured retrieval is recency-biased over `list()` results with assistant-side filtering. It is NOT a guaranteed exhaustive query over all stored entries. The adapter bridge uses an over-fetch factor (limit × 3, capped at 200) to partially compensate, but callers should understand the limitation. This is stated in the README.

---

## 5. Cross-Agent Consolidation — Explicitly Out of Scope

The librarian / night-crawler capability (v5-v8) is NOT implemented in v1. No consolidation logic, no deduplication across agents, no contradiction reconciliation.

**v1 investment for future consolidation:** provenance metadata fields are preserved through every write path (§4.7). This is the only v1 obligation toward consolidation.

---

## 6. Detailed File Specifications

### 6.1 `types.ts`

Exports all types from spec §8:

| Export | Kind |
|---|---|
| `MemoryEntry` | interface |
| `MemoryScope` | discriminated union |
| `MemoryStore` | interface (8 methods) |
| `WriteMemoryInput` | interface |
| `MemoryQuery` | interface |
| `UpdateMemoryPatch` | interface |
| `PromoteMemoryInput` | interface |
| `CompactMemoryInput` | interface |
| `CompactionCallback` | function type |
| `MemoryStoreAdapter` | interface (6 methods) |
| `MemoryAdapterQuery` | interface |
| `MemoryStoreConfig` | interface |
| `MemoryEntryNotFoundError` | error class |
| `InvalidScopePromotionError` | error class |
| `CompactionError` | error class |

All types exactly as specified in the v1-memory-spec §8.1–§8.10 and §9.

### 6.2 `scope-mapper.ts`

| Function | Purpose |
|---|---|
| `scopeToRelayAddOptions(scope, metadata?)` | Map assistant scope to relay `AddMemoryOptions` fields + metadata including `_scopeKind` |
| `relayEntryToScope(relayEntry)` | Reconstruct `MemoryScope` from relay entry; reads `_scopeKind` discriminator first |
| `expandScopeQuery(query)` | Expand `includeNarrower: true` into array of scopes |
| `validatePromotion(source, target)` | Throw `InvalidScopePromotionError` if direction is downward |
| `SCOPE_RANK` | `{ session: 0, object: 1, user: 1, workspace: 2, org: 3 }` |

Scope reconstruction priority (via `_scopeKind`):
1. Read `relay.metadata._scopeKind` → use directly if present
2. Fallback (for entries not written by this package): use relay field heuristic per implementation plan §4.3

### 6.3 `relay-adapter.ts`

Two classes implementing `MemoryStoreAdapter`:

**`InMemoryMemoryStoreAdapter`** — wraps relay `InMemoryAdapter`. For tests and dev.

**`RelayMemoryStoreAdapter`** — wraps any relay `MemoryAdapter`. For production.

Both classes share the same translation logic:

| Operation | Relay method | Notes |
|---|---|---|
| `insert(entry)` | `adapter.add(content, addOptions)` | Maps scope to relay fields via `scopeToRelayAddOptions()` |
| `fetchById(id)` | `adapter.get(id)` | Maps relay entry back to assistant entry |
| `fetchMany(query)` | `adapter.list({ limit: query.limit * 3, ... })` | Over-fetch then post-filter by scope, tags, since, expiry |
| `update(id, patch)` | `adapter.update(id, content, options)` | Updates metadata including `_updatedAt` |
| `deleteById(id)` | `adapter.delete(id)` | Idempotent |
| `deleteManyByScope(scope)` | `adapter.clear(clearOpts)` if scope maps cleanly; else `list()` + per-entry `delete()` | Returns count |

**Timestamp conversion:**
- Relay → Assistant: `new Date(relayEntry.createdAt).toISOString()` for `createdAt`; `relay.metadata._updatedAt` for `updatedAt`
- Assistant → Relay: `createdAt` set by relay on `add()`; `_updatedAt` set by bridge in metadata

**Constructor validation:** Both classes validate that the underlying adapter implements `list()` and `update()` (these are optional on `MemoryAdapter`). Throws at construction time if absent.

### 6.4 `memory-store.ts`

`createMemoryStore(config: MemoryStoreConfig): MemoryStore`

All 8 methods:

| Method | Key behavior |
|---|---|
| `write(input)` | Generate UUID, set timestamps, preserve provenance metadata, call `adapter.insert()` |
| `retrieve(query)` | Expand scopes if `includeNarrower`, build `MemoryAdapterQuery`, call `adapter.fetchMany()`, sort, return |
| `get(entryId)` | `adapter.fetchById()`, return null if expired |
| `update(entryId, patch)` | Fetch, reject scope/promotedFromId changes, merge metadata (preserve provenance), set `updatedAt`, call `adapter.update()` |
| `delete(entryId)` | `adapter.deleteById()`, idempotent |
| `deleteByScope(scope)` | `adapter.deleteManyByScope()`, return count |
| `promote(input)` | Fetch source, `validatePromotion()`, build new entry with `promotedFromId`, preserve provenance, insert, optionally delete source |
| `compact(input)` | Fetch all sources, invoke callback (wrap errors in `CompactionError`), build entry with `compactedFromIds`, preserve provenance, insert, optionally delete sources |

### 6.5 `index.ts`

```typescript
// Value exports
export { createMemoryStore } from './memory-store.js';
export { InMemoryMemoryStoreAdapter, RelayMemoryStoreAdapter } from './relay-adapter.js';
export { MemoryEntryNotFoundError, InvalidScopePromotionError, CompactionError } from './types.js';

// Type exports
export type {
  MemoryEntry, MemoryScope, MemoryStore, WriteMemoryInput, MemoryQuery,
  UpdateMemoryPatch, PromoteMemoryInput, CompactMemoryInput, CompactionCallback,
  MemoryStoreAdapter, MemoryAdapterQuery, MemoryStoreConfig,
} from './types.js';
```

---

## 7. Minimum Tests (50 tests)

All in `packages/memory/src/memory-store.test.ts`, vitest, against `InMemoryMemoryStoreAdapter`.

### 7.1 Type structural tests (5)
1. `MemoryEntry` has all required fields
2. `MemoryScope` covers all 5 kinds
3. `MemoryStore` interface has all 8 methods
4. `MemoryStoreAdapter` interface has all 6 methods
5. `MemoryStoreConfig` requires adapter field

### 7.2 Relay adapter bridge (8)
6. `InMemoryMemoryStoreAdapter` insert + fetchById round-trips
7. Session scope stored and reconstructed
8. User scope stored and reconstructed
9. Workspace scope stored and reconstructed
10. Org scope stored and reconstructed
11. Object scope stored and reconstructed
12. Expired entry excluded from fetchMany
13. Non-expired entry included in fetchMany

### 7.3 Write + retrieve (8)
14. `write()` returns entry with id and timestamps
15. `write()` preserves agentId in metadata
16. `write()` preserves confidence in metadata
17. `write()` preserves source in metadata
18. `retrieve()` returns entries matching exact scope
19. `retrieve()` excludes expired entries
20. `retrieve()` filters by tags (all-match)
21. `retrieve()` respects limit and order

### 7.4 Update + delete (6)
22. `update()` changes content and updatedAt
23. `update()` changes tags
24. `update()` merges metadata without stripping existing keys
25. `update()` throws MemoryEntryNotFoundError for unknown id
26. `delete()` removes entry; idempotent on second call
27. `get()` returns null for expired entry

### 7.5 Scope query expansion (6)
28. `retrieve()` with `includeNarrower: false` returns only primary scope
29. `retrieve()` with `includeNarrower: true` at user scope includes session entries (when sessionId provided)
30. `retrieve()` with `includeNarrower: true` at user scope does NOT include session without sessionId
31. `expandScopeQuery()` returns correct scopes for user query with sessionId
32. Object scope query does not include user/workspace by default
33. Results are deduplicated when entry matches multiple scopes

### 7.6 Promotion (8)
34. `promote()` creates new entry at target scope
35. `promote()` sets promotedFromId on new entry
36. `promote()` preserves content from source by default
37. `promote()` uses input.content override when provided
38. `promote()` preserves provenance metadata (agentId, source, confidence, createdInSessionId)
39. `promote()` with deleteOriginal removes source entry
40. `promote()` downward throws InvalidScopePromotionError
41. `promote()` throws MemoryEntryNotFoundError for unknown source

### 7.7 Compaction (6)
42. `compact()` calls callback with correct source entries
43. `compact()` result has compactedFromIds set
44. `compact()` result content matches callback return
45. `compact()` with deleteSourceEntries removes sources
46. `compact()` wraps callback error in CompactionError
47. `compact()` preserves compactedFromAgentIds in metadata

### 7.8 deleteByScope (3)
48. `deleteByScope()` deletes correct entries, returns count
49. `deleteByScope()` does not affect other scopes
50. `deleteByScope()` returns 0 for empty scope

**Total: 50 tests.** Exceeds the spec's 40+ threshold.

---

## 8. Reconciliation Follow-Up Resolutions

The reconciliation review (PASS_WITH_FOLLOWUPS) identified 4 required follow-ups. This plan resolves all of them:

| Follow-up | Resolution in this plan |
|---|---|
| 1. Define source of assistant `updatedAt` | §4.2: stored as `metadata._updatedAt` (ISO-8601), managed by the assistant bridge on write and update |
| 2. Add explicit scope discriminator | §4.1: `metadata._scopeKind` stored on every write; `relayEntryToScope()` reads it first |
| 3. Fix README `await createMemoryAdapter()` | README will be rewritten as actual package documentation with correct examples |
| 4. State retrieval is recency-biased | §4.8: explicitly documented that v1 uses `list()` + post-filtering, not exhaustive query |

---

## 9. Package Boundary Constraints

| Rule | Enforcement |
|---|---|
| Only `@agent-relay/memory` as runtime dep | `package.json` |
| No `MemoryService` or `createMemoryService()` import | Code review on `relay-adapter.ts` |
| No `MemoryAdapter.search()` call in v1 | Retrieval uses `list()` only |
| No import from surfaces, routing, transport, auth | No runtime deps + code review |
| `_scopeKind` discriminator set on every write | Enforced in `scopeToRelayAddOptions()` |
| `_updatedAt` set on every write and update | Enforced in adapter bridge |
| Provenance preserved in all write paths | Enforced in `memory-store.ts` write/promote/compact + tested (tests 15-17, 38, 47) |
| Timestamp conversion (epoch ms ↔ ISO-8601) only in `relay-adapter.ts` | Isolated translation boundary |

---

## 10. Implementation Order

The implementer should follow this sequence:

1. **`package.json` + `tsconfig.json`** — scaffolding
2. **`types.ts`** — all types and error classes (no dependencies)
3. **`scope-mapper.ts`** — scope translation utilities (depends on types.ts)
4. **`relay-adapter.ts`** — adapter bridge (depends on types.ts, scope-mapper.ts, @agent-relay/memory)
5. **`memory-store.ts`** — factory + all methods (depends on types.ts, scope-mapper.ts, relay-adapter.ts through MemoryStoreAdapter interface)
6. **`index.ts`** — re-exports
7. **`memory-store.test.ts`** — all 50 tests
8. **`README.md`** — rewrite as actual package documentation

---

V1_MEMORY_PACKAGE_IMPLEMENTATION_PLAN_READY
