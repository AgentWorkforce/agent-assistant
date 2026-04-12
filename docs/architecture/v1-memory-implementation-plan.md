# v1 Memory Implementation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/memory`
**Spec:** `docs/specs/v1-memory-spec.md`
**Reuse investigation:** `docs/research/memory-reuse-investigation.md`
**Workflow:** WF-5 (standalone), WF-6 (integration with sessions)

---

## 1. Reuse-First Reminder

Before writing any code, check `@agent-relay/memory`. Every storage operation delegates to a relay `MemoryAdapter`. The implementation plan below explicitly marks which code is new and which is a relay import.

The relay foundation (`@agent-relay/memory` v4.0.10) provides:
- `MemoryAdapter` — inner engine; bridged directly (REUSE)
- `InMemoryAdapter`, `SupermemoryAdapter` — storage backends (REUSE)
- `MemoryEntry`, `AddMemoryOptions` — relay-domain types (REUSE internally)
- `ContextCompactor` token estimation and similarity — optional utilities (PARTIAL REUSE)

**Not used from relay:** `MemoryService`, `createMemoryService()` (see §3.5), `MemorySearchQuery` (see §3.4).

**No new storage backends. No new search engines.** The assistant layer introduces bridge classes (`InMemoryMemoryStoreAdapter`, `RelayMemoryStoreAdapter`) that translate between assistant-domain types and relay adapter primitives. These are type-translation boundaries, not storage implementations.

---

## 2. Files to Create

All files live under `packages/memory/`.

```
packages/memory/
  package.json
  tsconfig.json
  src/
    types.ts              — MemoryEntry, MemoryScope, MemoryStore, MemoryQuery,
                            WriteMemoryInput, UpdateMemoryPatch, PromoteMemoryInput,
                            CompactMemoryInput, CompactionCallback, MemoryStoreAdapter,
                            MemoryAdapterQuery, MemoryStoreConfig, error classes
    scope-mapper.ts       — Translates MemoryScope to @agent-relay/memory query fields
    relay-adapter.ts      — InMemoryMemoryStoreAdapter wrapping relay InMemoryAdapter;
                            RelayMemoryStoreAdapter wrapping relay MemoryService
    memory-store.ts       — createMemoryStore factory; all MemoryStore method implementations
    index.ts              — public exports
    memory-store.test.ts  — all implementation tests
```

**Five source files, one test file.** Mirrors the sessions package's consolidated approach.

---

## 3. File Contents

### 3.1 `package.json`

```json
{
  "name": "@relay-assistant/memory",
  "version": "0.1.0",
  "description": "Scoped, promotable memory for Relay Agent Assistant SDK",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@agent-relay/memory": "^4.0.10"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

`@agent-relay/memory` is the **only runtime dependency**. `@relay-assistant/core` and `@relay-assistant/sessions` are type-only imports resolved via structural duck-typing to avoid runtime coupling.

### 3.2 `tsconfig.json`

Same structure as core and sessions: ES2022 target, NodeNext module, strict mode, declarations to `dist/`.

### 3.3 `types.ts`

**NEW CODE.** Exports all assistant-facing types and error classes.

| Export | Kind | Spec section |
|---|---|---|
| `MemoryEntry` | interface | §8.1 |
| `MemoryScope` | discriminated union type | §8.2 |
| `MemoryStore` | interface | §8.3 |
| `WriteMemoryInput` | interface | §8.4 |
| `MemoryQuery` | interface | §8.5 |
| `UpdateMemoryPatch` | interface | §8.6 |
| `PromoteMemoryInput` | interface | §8.7 |
| `CompactMemoryInput` | interface | §8.8 |
| `CompactionCallback` | function type | §8.8 |
| `MemoryStoreAdapter` | interface | §8.9 |
| `MemoryAdapterQuery` | interface | §8.9 |
| `MemoryStoreConfig` | interface | §9 |
| `MemoryEntryNotFoundError` | class | §8.10 |
| `InvalidScopePromotionError` | class | §8.10 |
| `CompactionError` | class | §8.10 |

Estimated: ~180-220 lines.

### 3.4 `scope-mapper.ts`

**NEW CODE.** Translates `MemoryScope` to relay `list()` filter options and relay `AddMemoryOptions` metadata. Also provides post-retrieval filtering helpers.

> **Note:** v1 retrieval uses `MemoryAdapter.list()` (not `search()`). The `scopeToListFilters` function maps to `list()` filter shape (`{ agentId?, projectId? }`). Scope fields that `list()` cannot filter natively (`userId`, `orgId`, `objectId`, `objectType`) are applied post-retrieval by the filtering helpers below.

Key functions:

```typescript
/** Map assistant scope to relay list() filter options. Returns { agentId?, projectId? }. */
function scopeToListFilters(scope: MemoryScope): { agentId?: string; projectId?: string };

/** Map assistant scope to relay add options metadata. */
function scopeToRelayMetadata(scope: MemoryScope): Record<string, unknown>;

/** Expand a query with includeNarrower: true into multiple relay scopes. */
function expandScopeQuery(query: MemoryQuery): MemoryScope[];

/** Validate that a promotion direction is upward. Throws InvalidScopePromotionError if not. */
function validatePromotion(sourceScope: MemoryScope, targetScope: MemoryScope): void;

/** Post-retrieval: filter entries whose metadata matches the given scope. */
function filterByScope(entries: RelayMemoryEntry[], scope: MemoryScope): RelayMemoryEntry[];

/** Post-retrieval: filter entries that have ALL of the specified tags. */
function filterByTags(entries: RelayMemoryEntry[], tags: string[]): RelayMemoryEntry[];

/** Post-retrieval: filter entries created at or after the given ISO-8601 timestamp. */
function filterBySince(entries: RelayMemoryEntry[], since: string): RelayMemoryEntry[];

/** Scope hierarchy rank (higher = broader). Used for promotion direction check. */
const SCOPE_RANK: Record<MemoryScope['kind'], number>;
```

Scope rank table:

| Scope kind | Rank |
|---|---|
| `session` | 0 |
| `user` | 1 |
| `object` | 1 (lateral) |
| `workspace` | 2 |
| `org` | 3 |

Promotion validation: target rank must be > source rank, except `object` which allows promotion to `user`, `workspace`, or `org` (all higher rank).

Estimated: ~90-110 lines.

### 3.5 `relay-adapter.ts`

**REUSE + thin NEW bridge code.**

> **Correction from earlier plan:** Both adapter classes bridge to a `MemoryAdapter` instance **directly** — not to `MemoryService`. `MemoryService` is not imported. This is because `MemoryService` lacks `get()`, `update()`, and bulk-delete-by-scope operations. The bridge validates at construction time that the provided adapter implements the required optional methods (`list()`, `update()`).

Exports two classes:

**`InMemoryMemoryStoreAdapter`** — wraps `@agent-relay/memory`'s `InMemoryAdapter`. Used for tests and development.

```typescript
import { InMemoryAdapter, type MemoryAdapter } from '@agent-relay/memory';

export class InMemoryMemoryStoreAdapter implements MemoryStoreAdapter {
  private inner: MemoryAdapter = new InMemoryAdapter();
  // constructor validates inner.list and inner.update exist
  // translate MemoryEntry ↔ relay MemoryEntry (createdAt: number → ISO-8601 string)
  // fetchMany uses inner.list() + post-retrieval filtering (scope, tags, since, expiry)
}
```

**`RelayMemoryStoreAdapter`** — wraps any `@agent-relay/memory` `MemoryAdapter`. Used for production (with `SupermemoryAdapter` or any relay adapter).

```typescript
import { type MemoryAdapter } from '@agent-relay/memory';

export class RelayMemoryStoreAdapter implements MemoryStoreAdapter {
  constructor(adapter: MemoryAdapter) {
    // validates adapter.list and adapter.update exist; throws if absent
    this.inner = adapter;
  }
  // translate MemoryEntry ↔ relay MemoryEntry (createdAt: number → ISO-8601 string)
  // fetchMany uses inner.list() + post-retrieval filtering (scope, tags, since, expiry)
  // deleteManyByScope: uses inner.clear() if available; falls back to list() + per-entry delete()
}
```

**Timestamp conversion (mandatory):**
- Relay → Assistant: `new Date(relayEntry.createdAt).toISOString()` (relay stores epoch ms)
- Assistant → Relay: not passed; relay sets `createdAt` on `add()`
- `since` filter on `MemoryQuery` (ISO-8601) is applied post-retrieval: `new Date(relayEntry.createdAt) >= new Date(query.since)`

**Over-fetch factor:** `list()` calls use `limit * 3` (capped at 200) to account for post-retrieval filtering reducing the result set.

Both classes handle the relay ↔ assistant type translation:

| Assistant field | Relay field |
|---|---|
| `entry.scope` (session) | `relay.sessionId` |
| `entry.scope` (user) | `relay.metadata.userId` |
| `entry.scope` (workspace) | `relay.projectId` |
| `entry.scope` (org) | `relay.metadata.orgId` |
| `entry.scope` (object) | `relay.metadata.objectId` + `relay.metadata.objectType` |
| `entry.expiresAt` | `relay.metadata.expiresAt` |
| `entry.promotedFromId` | `relay.metadata.promotedFromId` |
| `entry.compactedFromIds` | `relay.metadata.compactedFromIds` |
| `entry.metadata.agentId` | `relay.agentId` |
| `entry.metadata.source` | `relay.source` |
| `entry.metadata.createdInSessionId` | `relay.metadata.createdInSessionId` |
| `entry.metadata.confidence` | `relay.metadata.confidence` |

Expiry filtering: relay adapters do not filter by `expiresAt`. The adapter bridge excludes entries where `metadata.expiresAt < query.excludeExpiredBefore`.

Estimated: ~200-250 lines (including translation logic for both classes).

### 3.6 `memory-store.ts`

**NEW CODE.** Implements `createMemoryStore` and all `MemoryStore` methods.

```typescript
export function createMemoryStore(config: MemoryStoreConfig): MemoryStore;
```

Method implementations:

**`write(input)`**
1. Generate `id` via `crypto.randomUUID()`.
2. Set `createdAt`, `updatedAt` to `new Date().toISOString()`.
3. Preserve provenance metadata: ensure `agentId`, `source`, `confidence`, `createdInSessionId` are passed into the entry metadata.
4. Call `adapter.insert(entry)`.
5. Return the stored entry.

**`retrieve(query)`**
1. If `config.applyInclusionRules` and `query.includeNarrower`, call `expandScopeQuery(query)` to get multiple scopes. For a `user`-scope query, session scope is only included when `query.context.sessionId` is explicitly provided.
2. Build `MemoryAdapterQuery` with `excludeExpiredBefore: new Date().toISOString()`, normalized `limit` (default 20), `order` (default 'newest').
3. Call `adapter.fetchMany(adapterQuery)` — the adapter calls `relay.list()` with an over-fetch factor (limit × 3, capped at 200) and applies scope, tag, `since`, and expiry filters post-retrieval.
4. Sort results (adapter may not guarantee order).
5. Return.

**`get(entryId)`**
1. Call `adapter.fetchById(entryId)`.
2. Apply expiry check (return null if expired).
3. Return entry or null.

**`update(entryId, patch)`**
1. Fetch entry; throw `MemoryEntryNotFoundError` if missing.
2. Reject any attempt to update `scope` or `promotedFromId` (immutable fields).
3. Apply `patch` fields (content, tags, expiresAt, metadata merge).
4. Set `updatedAt`.
5. Call `adapter.update(entryId, updated)`.
6. Return updated entry.

**`delete(entryId)`**
1. Call `adapter.deleteById(entryId)`. Idempotent (no error if missing).

**`deleteByScope(scope)`**
1. Call `adapter.deleteManyByScope(scope)`.
2. Return count.

**`promote(input)`**
1. Fetch source entry; throw `MemoryEntryNotFoundError` if missing.
2. Call `validatePromotion(sourceEntry.scope, input.targetScope)`.
3. Build new entry: copy content (or use `input.content`), copy tags (or use `input.tags`), set `scope: input.targetScope`, set `promotedFromId: sourceEntry.id`.
4. Preserve provenance: copy `agentId`, `source`, `confidence`, `createdInSessionId` from source metadata.
5. Call `adapter.insert(newEntry)`.
6. If `input.deleteOriginal`, call `adapter.deleteById(sourceEntry.id)`.
7. Return new entry.

**`compact(input)`**
1. Fetch all source entries by ID; throw `MemoryEntryNotFoundError` for any missing.
2. Invoke `input.compactionCallback(sourceEntries)`, wrap errors in `CompactionError`.
3. Build new entry: set `compactedFromIds: input.sourceEntryIds`, set `scope: input.targetScope`, use callback result as content.
4. Preserve provenance: collect unique `agentId` values from source entries; store as `metadata.compactedFromAgentIds`.
5. Call `adapter.insert(newEntry)`.
6. If `input.deleteSourceEntries`, call `adapter.deleteById()` for each source.
7. Return new entry.

Estimated: ~320-380 lines.

### 3.7 `index.ts`

```typescript
export { createMemoryStore } from './memory-store.js';
export { InMemoryMemoryStoreAdapter, RelayMemoryStoreAdapter } from './relay-adapter.js';
export {
  MemoryEntryNotFoundError,
  InvalidScopePromotionError,
  CompactionError,
} from './types.js';
export type {
  MemoryEntry,
  MemoryScope,
  MemoryStore,
  WriteMemoryInput,
  MemoryQuery,
  UpdateMemoryPatch,
  PromoteMemoryInput,
  CompactMemoryInput,
  CompactionCallback,
  MemoryStoreAdapter,
  MemoryAdapterQuery,
  MemoryStoreConfig,
} from './types.js';
```

---

## 4. Relay Adapter Bridge: Detailed Translation

The adapter bridge is the most relay-coupled code in the package. Keep it in `relay-adapter.ts` to isolate the translation boundary.

### 4.1 `MemoryEntry` → relay `AddMemoryOptions`

```
relay.add({
  content: entry.content,
  tags: entry.tags,
  agentId: entry.metadata.agentId as string | undefined,
  projectId: scopeKind === 'workspace' ? scope.workspaceId : undefined,
  sessionId: scopeKind === 'session' ? scope.sessionId : undefined,
  source: entry.metadata.source as string | undefined,
  metadata: {
    ...entry.metadata,
    userId:            scopeKind === 'user'      ? scope.userId      : undefined,
    orgId:             scopeKind === 'org'       ? scope.orgId       : undefined,
    objectId:          scopeKind === 'object'    ? scope.objectId    : undefined,
    objectType:        scopeKind === 'object'    ? scope.objectType  : undefined,
    expiresAt:         entry.expiresAt,
    promotedFromId:    entry.promotedFromId,
    compactedFromIds:  entry.compactedFromIds,
    createdInSessionId: entry.metadata.createdInSessionId,
    confidence:        entry.metadata.confidence,
  }
})
```

### 4.2 relay `MemoryEntry` → `MemoryEntry` (assistant)

```
{
  id: relayEntry.id,
  scope: deriveScope(relayEntry),   // reconstruct from relay fields
  content: relayEntry.content,
  tags: relayEntry.tags ?? [],
  createdAt: relayEntry.createdAt ?? new Date().toISOString(),
  updatedAt: relayEntry.updatedAt ?? new Date().toISOString(),
  expiresAt: relayEntry.metadata?.expiresAt as string | undefined,
  promotedFromId: relayEntry.metadata?.promotedFromId as string | undefined,
  compactedFromIds: relayEntry.metadata?.compactedFromIds as string[] | undefined,
  metadata: relayEntry.metadata ?? {},
}
```

### 4.3 Scope Reconstruction from Relay Entry

Priority order (first match wins):
1. If `relayEntry.metadata.userId` → `{ kind: 'user', userId }`
2. If `relayEntry.metadata.orgId` → `{ kind: 'org', orgId }`
3. If `relayEntry.metadata.objectId` → `{ kind: 'object', objectId, objectType }`
4. If `relayEntry.projectId` → `{ kind: 'workspace', workspaceId: relayEntry.projectId }`
5. If `relayEntry.sessionId` → `{ kind: 'session', sessionId }`
6. Fallback: throw `MemoryEntryNotFoundError` (malformed entry)

---

## 5. Provenance Metadata Preservation Requirements

These are not features — they are mandatory correctness rules for every write path.

| Operation | Required preservation |
|---|---|
| `write()` | Copy `agentId`, `source`, `confidence` from `input.metadata` into stored entry |
| `promote()` | Copy `agentId`, `source`, `confidence`, `createdInSessionId` from source entry metadata into promoted entry |
| `compact()` | Set `compactedFromIds`; collect unique `agentIds` from sources into `compactedFromAgentIds`; preserve `confidence` from highest-confidence source (or lowest, TBD at v5-v8 consolidation time — store all in `metadata.sourceConfidences` as an array) |
| `update()` | Do not strip provenance fields from existing metadata; merge new metadata shallowly |

Violation of these rules will break v5-v8 cross-agent consolidation. Code review must check every write path.

---

## 6. Implementation Slice Mapping

### Slice 1: WF-5 — Memory standalone (this PR)

Everything in §3 above. Fully self-contained. Produces:
- All types from spec §8
- `InMemoryMemoryStoreAdapter` and `RelayMemoryStoreAdapter`
- `createMemoryStore` factory with all `MemoryStore` methods
- Full test suite (50+ tests)

### Slice 2: WF-6 — Wire into sessions (next PR, separate plan)

Lives in `packages/sessions/` or a shared integration test. Validates:
- `promote()` called at session expiry (triggered by `SessionStore.expire()`)
- `deleteByScope()` called for session cleanup

Memory package ships no code changes in WF-6.

---

## 7. Minimum Tests

All tests in `packages/memory/src/memory-store.test.ts` using vitest, against `InMemoryMemoryStoreAdapter`.

### 7.1 Type structural tests (5 tests)

| # | Test |
|---|---|
| 1 | `MemoryEntry` type has all required fields |
| 2 | `MemoryScope` discriminated union covers all 5 kinds |
| 3 | `MemoryStore` interface has all 8 methods |
| 4 | `MemoryStoreAdapter` interface has all 6 methods |
| 5 | `MemoryStoreConfig` requires `adapter` field |

### 7.2 Relay adapter bridge (8 tests)

| # | Test |
|---|---|
| 6 | `InMemoryMemoryStoreAdapter` insert + fetchById round-trips correctly |
| 7 | Session scope stored and reconstructed |
| 8 | User scope stored and reconstructed |
| 9 | Workspace scope stored and reconstructed |
| 10 | Org scope stored and reconstructed |
| 11 | Object scope stored and reconstructed |
| 12 | Expiry filtering: expired entry excluded from fetchMany |
| 13 | Expiry filtering: non-expired entry included |

### 7.3 Write + retrieve (8 tests)

| # | Test |
|---|---|
| 14 | `write()` returns entry with assigned id and timestamps |
| 15 | `write()` preserves agentId in metadata |
| 16 | `write()` preserves confidence in metadata |
| 17 | `write()` preserves source in metadata |
| 18 | `retrieve()` returns entries matching exact scope |
| 19 | `retrieve()` excludes expired entries |
| 20 | `retrieve()` filters by tags (all-match) |
| 21 | `retrieve()` respects limit and order |

### 7.4 Update + delete (6 tests)

| # | Test |
|---|---|
| 22 | `update()` changes content and updatedAt |
| 23 | `update()` changes tags |
| 24 | `update()` merges metadata (does not strip existing keys) |
| 25 | `update()` throws `MemoryEntryNotFoundError` for unknown id |
| 26 | `delete()` removes entry; idempotent on second call |
| 27 | `get()` returns null for expired entry |

### 7.5 Scope query expansion (6 tests)

| # | Test |
|---|---|
| 28 | `retrieve()` with `includeNarrower: false` returns only primary scope entries |
| 29 | `retrieve()` with `includeNarrower: true` at user scope includes session entries |
| 30 | `retrieve()` with `includeNarrower: true` at workspace scope does not include user by default |
| 31 | `expandScopeQuery()` returns correct scopes for user query with sessionId |
| 32 | Object scope query does not include user/workspace by default |
| 33 | `retrieve()` deduplicates results when the same entry matches multiple scopes |

### 7.6 Promotion (8 tests)

| # | Test |
|---|---|
| 34 | `promote()` creates new entry at target scope |
| 35 | `promote()` sets `promotedFromId` on new entry |
| 36 | `promote()` preserves content from source by default |
| 37 | `promote()` uses `input.content` override when provided |
| 38 | `promote()` preserves provenance metadata (agentId, source, confidence, createdInSessionId) |
| 39 | `promote()` with `deleteOriginal: true` removes source entry |
| 40 | `promote()` with invalid downward direction throws `InvalidScopePromotionError` |
| 41 | `promote()` throws `MemoryEntryNotFoundError` for unknown sourceEntryId |

### 7.7 Compaction (6 tests)

| # | Test |
|---|---|
| 42 | `compact()` calls callback with correct source entries |
| 43 | `compact()` creates result entry with `compactedFromIds` set |
| 44 | `compact()` result entry content matches callback return value |
| 45 | `compact()` with `deleteSourceEntries: true` removes source entries |
| 46 | `compact()` wraps callback errors in `CompactionError` |
| 47 | `compact()` preserves `compactedFromAgentIds` in result metadata |

### 7.8 `deleteByScope` (3 tests)

| # | Test |
|---|---|
| 48 | `deleteByScope()` deletes all entries for scope; returns correct count |
| 49 | `deleteByScope()` does not affect entries in other scopes |
| 50 | `deleteByScope()` returns 0 for scope with no entries |

**Total: 50 tests.** Exceeds the 40+ DoD threshold.

---

## 8. Package Boundary Constraints

| Rule | Enforcement |
|---|---|
| Only `@agent-relay/memory` as runtime dependency | Checked via `package.json` |
| `MemoryService` and `createMemoryService()` are NOT imported | Code review: `relay-adapter.ts` imports only `MemoryAdapter`, `MemoryEntry`, `AddMemoryOptions`, `MemoryResult`, `createMemoryAdapter`, `InMemoryAdapter` |
| `MemoryAdapter.search()` is NOT called in v1 | Code review: retrieval path uses `list()` only; `search()` reserved for v1.1 |
| No import from `@relay-assistant/surfaces` | No runtime dep + code review |
| No import from `@relay-assistant/routing` | No runtime dep + code review |
| No relay transport/auth imports | `@agent-relay/memory` provides types only; transport not imported |
| `MemoryStoreAdapter` is the only storage interface | No direct storage driver deps |
| All relay ↔ assistant type translation in `relay-adapter.ts` | Code review: isolate translation boundary |
| Timestamp conversion (epoch ms ↔ ISO-8601) only in `relay-adapter.ts` | Code review |
| Provenance fields preserved in all write paths | Code review + dedicated tests (34-38, 42-47) |
| No model calls (no LLM invocations) | `CompactionCallback` is provided by caller; not invoked internally |
| No timer/scheduler | Sweep and archival are caller-driven |

---

## 9. Estimated New Code Volume

| File | Estimated lines |
|---|---|
| `types.ts` | 180-220 |
| `scope-mapper.ts` | 90-110 |
| `relay-adapter.ts` | 200-250 |
| `memory-store.ts` | 320-380 |
| `index.ts` | 30-40 |
| **Total implementation** | **820-1000** |
| `memory-store.test.ts` | 400-500 |
| **Grand total** | **1220-1500** |

The higher end vs the scope document's estimate (~650-890) reflects the inclusion of the relay adapter bridge translation code, which is new but reuse-guided.

---

## 10. Open Questions Resolved

| OQ | Resolution | Implementation impact |
|---|---|---|
| OQ-1 (`includeNarrower` opt-in) | Opt-in; default false | `retrieve()` defaults `query.includeNarrower = false`; no fan-out unless explicitly set |
| OQ-2 (object scope isolation) | Not included in user/workspace queries | `expandScopeQuery()` never adds object scope to user/workspace expansion |
| OQ-3 (conflict flag) | Deferred to v1.1 | No conflict field in `MemoryEntry`; no conflict detection code |
| OQ-4 (same-scope compaction) | Same scope required | `compact()` validates `targetScope` matches all source entry scopes; throws if mismatch |
| OQ-5 (max content length) | Adapter's responsibility | No length check in `write()` or `compact()`; document recommended 4096-char max in README |

---

V1_MEMORY_IMPLEMENTATION_PLAN_READY

---

## 11. Reconciliation Notes (applied 2026-04-11)

Reconciled against `docs/architecture/v1-memory-reconciliation-plan.md`. The following corrections were applied to this plan:

| Area | Correction |
|---|---|
| §1 Reuse list | Removed `MemoryService`, `createMemoryService()`, `MemorySearchQuery` from reused components. Added explicit note that `MemoryAdapter` is the direct bridge target. |
| §3.4 `scope-mapper.ts` | `scopeToRelayFilters` → `scopeToListFilters` returning `list()` filter shape `{ agentId?, projectId? }`. Added `filterByScope`, `filterByTags`, `filterBySince` post-retrieval filtering helpers. |
| §3.5 `relay-adapter.ts` | `RelayMemoryStoreAdapter` now bridges to `MemoryAdapter` directly (not `MemoryService`). Constructor validates `list()` and `update()` at construction time. Added timestamp conversion requirement (epoch ms ↔ ISO-8601). Added over-fetch factor (limit × 3, capped at 200). `deleteManyByScope` uses `clear()` if available; falls back to `list()` + per-entry `delete()`. |
| §3.6 `memory-store.ts` | `retrieve()` documented to use `adapter.fetchMany()` which calls `list()` + post-retrieval filtering (not `search()`). `includeNarrower: true` for user scope only includes session when `query.context.sessionId` is explicitly provided. |
| §8 Package Boundary | Added rules: no `MemoryService`/`createMemoryService()` import, no `search()` calls in v1, timestamp conversion isolated to `relay-adapter.ts`. |

MEMORY_SPEC_RECONCILED
