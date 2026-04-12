# v1 Memory Reconciliation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Resolves:** Review verdict findings #1–#4 from `docs/architecture/v1-memory-review-verdict.md`
**Feeds into:** WF-5 implementation workflow

---

## 1. Search-Model Mismatch (Verdict Finding #1)

### The Problem

The spec and plan describe v1 retrieval as "structured queries by scope, tags, and recency" (`v1-memory-spec.md §6`). They assume `MemorySearchQuery` can serve as the relay-side retrieval primitive for these structured queries.

In practice, `MemorySearchQuery` **requires** a `query: string` field — a semantic search string. Both relay adapters are search-text-driven:

- **`InMemoryAdapter.search()`** scores entries by keyword match against `query`. Entries with `score === 0` are excluded entirely (`inmemory.ts:115`). A structured-only query (scope + tags, no meaningful search text) returns **zero results**.
- **`SupermemoryAdapter.search()`** sends `query` to the supermemory.ai API and defaults `minScore` to `0.5`. Same outcome: no search text means no useful results.

The spec's `MemoryQuery` has no `query: string` field. It retrieves by scope, tags, recency, and limit. These are structured filters, not semantic queries.

### The Correction

**v1 structured retrieval MUST NOT use `MemoryAdapter.search()` as its primary path.** Instead:

1. **`retrieve(query)` uses `MemoryAdapter.list()` + assistant-side filtering.** `list()` returns entries by recency with `agentId`/`projectId` filters. The assistant layer applies scope filtering (via metadata), tag filtering, time filtering (`since`), expiry filtering, and limit/order on the returned set.

2. **`MemoryAdapter.list()` is optional on the relay interface** (`types.ts:146`). The `MemoryStoreAdapter` bridge contract MUST require that the underlying relay adapter implements `list()`. Both `InMemoryAdapter` and `SupermemoryAdapter` implement it today. If a future relay adapter omits `list()`, the bridge must throw at construction time, not at query time.

3. **`MemoryAdapter.search()` is reserved for future semantic retrieval (v1.1+).** The assistant layer does not call `search()` in v1. When semantic retrieval is added, `MemoryQuery` will gain an optional `semanticQuery: string` field, and the bridge will route to `search()` only when that field is present.

4. **The `scopeToRelayFilters()` function in `scope-mapper.ts` maps to `list()` filter options, not to `MemorySearchQuery` fields.** The function signature changes from:
   ```typescript
   // WRONG — spec/plan version
   function scopeToRelayFilters(scope: MemoryScope): Partial<MemorySearchQuery>;
   // CORRECT — reconciled version
   function scopeToListFilters(scope: MemoryScope): { agentId?: string; projectId?: string };
   ```
   Scope fields that relay `list()` cannot filter natively (`userId`, `orgId`, `objectId`, `objectType`) are applied as post-retrieval metadata filters by the assistant layer.

### Implications

- `retrieve()` performance depends on `list()` returning a reasonably bounded set. The default `list()` limit on `InMemoryAdapter` is 50; the assistant layer should request `limit * 3` (or a configurable over-fetch factor) from `list()` to account for post-retrieval filtering reducing the result set.
- Tag filtering is always assistant-side. Relay `list()` does not filter by tags.
- This is a documentation and implementation correction, not a strategy change. The reuse-first posture is intact: relay handles storage and raw retrieval; the assistant layer handles structured query semantics.

---

## 2. Adapter-Surface Mismatch (Verdict Finding #2)

### The Problem

The plan says `RelayMemoryStoreAdapter` wraps `MemoryService` (`v1-memory-implementation-plan.md §3.5`). The assistant `MemoryStore` contract requires:

| Operation | Required by assistant | Available on `MemoryService` | Available on `MemoryAdapter` |
|---|---|---|---|
| `write` (insert) | Yes | `add()` — yes | `add()` — yes |
| `retrieve` (structured query) | Yes | `search()` — wrong model (see §1) | `list()` — yes (optional) |
| `get` (by ID) | Yes | **No** | `get()` — yes |
| `update` (by ID) | Yes | **No** | `update()` — yes (optional) |
| `delete` (by ID) | Yes | `delete()` — yes | `delete()` — yes |
| `deleteByScope` (bulk) | Yes | **No** | `clear()` — partial match (optional) |

`MemoryService` lacks `get()`, `update()`, and bulk-delete-by-scope. It exposes `getUnderlyingAdapter()` but this is an implementation detail, not a stable contract.

### The Correction

**`MemoryStoreAdapter` bridges directly to `MemoryAdapter`, not to `MemoryService`.**

1. **`RelayMemoryStoreAdapter` accepts a `MemoryAdapter` instance at construction**, not a `MemoryService`. The caller is responsible for constructing and initializing the relay adapter (via `createMemoryAdapter()` or direct instantiation).

2. **`InMemoryMemoryStoreAdapter` wraps `InMemoryAdapter` directly** — no change from the plan's intent, but now this is the explicit and only pattern.

3. **`createMemoryService()` is NOT used internally by the assistant memory package.** It provided lazy init and default injection, but those concerns are handled by `MemoryStoreConfig` and the assistant factory (`createMemoryStore`).

4. **Optional adapter methods are validated at bridge construction time.** The bridge constructor checks that the provided `MemoryAdapter` implements `list()` and `update()`. If either is missing, the constructor throws with a clear message. `clear()` is used for `deleteByScope` if available; if not, the bridge falls back to `list()` + per-entry `delete()`.

### Updated `relay-adapter.ts` Structure

```
RelayMemoryStoreAdapter
  constructor(adapter: MemoryAdapter)  // direct adapter, not MemoryService
  → validates adapter.list and adapter.update exist
  insert(entry)    → adapter.add(content, options)
  fetchById(id)    → adapter.get(id)
  fetchMany(query) → adapter.list(options) + assistant-side filtering
  update(id, ...)  → adapter.update!(id, content, options)
  deleteById(id)   → adapter.delete(id)
  deleteManyByScope(scope) → adapter.clear?(options) or list+delete fallback
```

### Updated `package.json` Dependency Note

The runtime dependency remains `@agent-relay/memory`. The assistant package imports `MemoryAdapter`, `MemoryEntry`, `AddMemoryOptions`, `MemoryResult`, `createMemoryAdapter`, and `InMemoryAdapter` from it. `MemoryService` and `createMemoryService` are **not imported**.

---

## 3. Assumptions the Assistant Layer May and May Not Make About `@agent-relay/memory`

### MAY Assume (Verified Against v4.0.10 Source)

| Assumption | Grounded in |
|---|---|
| `MemoryAdapter.add()` returns `{ success: true, id: string }` on success | `types.ts:109`, `inmemory.ts:53-78` |
| `MemoryAdapter.get(id)` returns the entry or `null` | `types.ts:123` |
| `MemoryAdapter.delete(id)` is safe to call with a non-existent ID | `inmemory.ts:139-146` |
| `MemoryEntry.metadata` is a `Record<string, unknown>` bag that round-trips through storage | `types.ts:33` |
| `MemoryEntry.createdAt` is a number (epoch ms), not an ISO string | `types.ts:17`, `inmemory.ts:55` |
| `MemoryEntry.tags` is `string[] | undefined`, not guaranteed to be present | `types.ts:21` |
| `InMemoryAdapter` implements `list()`, `update()`, `clear()`, and `stats()` | `inmemory.ts:148-265` |
| `createMemoryAdapter()` and `InMemoryAdapter` are stable public exports | `index.ts` re-exports |
| Metadata stored via `AddMemoryOptions.metadata` is preserved on the entry | `inmemory.ts:68` |

### MAY NOT Assume

| Wrong assumption | Reality |
|---|---|
| `MemorySearchQuery` can retrieve without a semantic query string | `query: string` is required; both adapters score by text match |
| `MemoryService` exposes `get()` or `update()` | It exposes only `add`, `search`, `delete`, `list`, `isAvailable` |
| `MemoryAdapter.update()` is always available | It is optional (`update?` in the interface) |
| `MemoryAdapter.list()` is always available | It is optional (`list?` in the interface) |
| `MemoryAdapter.clear()` filters by arbitrary metadata fields | It filters only by `agentId`, `projectId`, `before` |
| `MemoryEntry.createdAt` is an ISO-8601 string | It is `number` (epoch ms) |
| `MemoryAdapter.list()` filters by tags | It filters only by `limit`, `agentId`, `projectId` |
| `MemoryAdapter.list()` supports time-range filters | It does not; only `search()` and `clear()` have `since`/`before` |
| Relay adapters filter by `metadata` fields | Neither adapter inspects metadata during `list()` or `search()` |
| `SupermemoryAdapter` implements `update()` | Must be verified before `RelayMemoryStoreAdapter` is used with it |

### Type Translation Requirements (Timestamp Format)

Relay uses `number` (epoch ms) for `createdAt`. The assistant spec uses ISO-8601 strings. The bridge must convert in both directions:

- **Relay → Assistant:** `new Date(relayEntry.createdAt).toISOString()`
- **Assistant → Relay:** timestamps are set by relay on `add()`; the assistant layer does not pass `createdAt` to relay.

The `since` filter on `MemoryQuery` (ISO-8601 string) cannot be passed to `list()` (which has no time filter). It must be applied as a post-retrieval filter: `new Date(entry.createdAt) >= new Date(query.since)`.

---

## 4. `includeNarrower` Session-Context Clarification (Verdict Finding #3)

### The Correction

`includeNarrower: true` on a `user`-scope query includes session entries **only when the caller provides an explicit `sessionId` in the query**. The `MemoryQuery` type gains an optional context field:

```typescript
export interface MemoryQuery {
  scope: MemoryScope;
  includeNarrower?: boolean;
  tags?: string[];
  since?: string;
  limit?: number;
  order?: 'newest' | 'oldest';

  /**
   * Additional context for scope expansion. When includeNarrower is true
   * and the primary scope is 'user', a sessionId here causes session-scope
   * entries for that session to be included in results.
   */
  context?: {
    sessionId?: string;
  };
}
```

If `includeNarrower: true` is set on a `user`-scope query and `context.sessionId` is absent, only user-scope entries are returned. No implicit session discovery.

---

## 5. Terminology Tightening (Verdict Finding #4)

### The Correction

Replace all instances of "no new adapters" in spec and plan documents with:

> **No new storage backends or search engines.** The assistant layer introduces bridge classes (`InMemoryMemoryStoreAdapter`, `RelayMemoryStoreAdapter`) that translate between assistant-domain types and relay adapter primitives. These are type-translation boundaries, not storage implementations.

This prevents reviewers from reading "no new adapters" as contradicting the existence of `MemoryStoreAdapter` bridge classes.

---

## 6. Amended File Plan

Changes to the implementation plan's file structure:

| File | Change |
|---|---|
| `scope-mapper.ts` | `scopeToRelayFilters` → `scopeToListFilters`; returns `list()` filter shape, not `MemorySearchQuery` shape. Add `filterByScope(entries, scope)` for post-retrieval metadata filtering. Add `filterByTags(entries, tags)` and `filterBySince(entries, since)`. |
| `relay-adapter.ts` | Bridge targets `MemoryAdapter` directly, not `MemoryService`. Constructor validates `list` and `update` availability. Remove `createMemoryService` import. Add timestamp conversion helpers. |
| `memory-store.ts` | `retrieve()` uses `adapter.fetchMany()` (which calls `list()` + filters), not `search()`. |
| `types.ts` | Add `context?: { sessionId?: string }` to `MemoryQuery`. |

No new files. No removed files. Estimated line count change: net +30-50 lines (filtering helpers offset by removed `MemorySearchQuery` translation).

---

## 7. Summary of What Stays the Same

The following architectural decisions from the spec and plan are **unchanged**:

- Reuse-first posture: all storage delegates to relay `MemoryAdapter`
- Composition layer designation (not wrapper, not adapter, not re-implementation)
- Assistant-facing type surface (`MemoryEntry`, `MemoryScope`, `MemoryStore`, `MemoryQuery`)
- Scope model (session, user, workspace, org, object) with metadata-based storage in relay
- Promotion logic (read-write-delete with provenance preservation)
- Compaction with `CompactionCallback` pattern
- TTL/expiry filtering (stored in metadata, filtered post-retrieval)
- Provenance metadata preservation requirements
- v5-v8 librarian/consolidation deferral with future-enabling metadata
- Package boundary: product code imports only from `@relay-assistant/memory`
- File structure: five source files, one test file

---

## 8. Pre-Implementation Checklist for WF-5

Before writing code, the WF-5 implementer must:

- [ ] Verify `SupermemoryAdapter` implements `list()` and `update()` — if not, the `RelayMemoryStoreAdapter` fallback paths must handle their absence
- [ ] Confirm `InMemoryAdapter.clear()` filter semantics match `deleteByScope` needs (it filters by `agentId` + `projectId` + `before`, not by metadata — so scope-based bulk delete for `user`, `org`, and `object` scopes requires the `list()` + per-entry `delete()` fallback)
- [ ] Decide over-fetch factor for `list()` calls that precede post-retrieval filtering (recommended: `limit * 3`, capped at 200)
- [ ] Update `docs/specs/v1-memory-spec.md` §8.5 with the `context` field on `MemoryQuery`
- [ ] Update `docs/architecture/v1-memory-implementation-plan.md` §3.4, §3.5, §3.6 with the corrections from this document

---

V1_MEMORY_RECONCILIATION_PLAN_READY
