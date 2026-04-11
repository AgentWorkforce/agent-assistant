# v1 Memory Spec — `@relay-assistant/memory`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/memory`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.1 (after core, sessions, surfaces land)

---

## 1. Reuse-First Mandate

`@relay-assistant/memory` is a **composition layer** over `@agent-relay/memory`. It is explicitly NOT a greenfield memory engine, NOT a wrapper, and NOT an adapter pattern.

**Guiding rule:** Before authoring any code, confirm that the required behavior does not already exist in `@agent-relay/memory`. Only write new code for behavior that relay memory provably does not provide.

The relay foundation package `@agent-relay/memory` (v4.0.10) is the storage and retrieval engine. All reads and writes ultimately delegate to a relay `MemoryAdapter`. The assistant layer adds scope semantics, promotion, compaction orchestration, and expiry filtering — and nothing else.

See `docs/research/memory-reuse-investigation.md` for the full investigation supporting this decision.

---

## 2. Package Role: Composition Layer

`@relay-assistant/memory` is a **thin composition layer**. This designation means:

- It **imports** relay types and uses relay service primitives directly.
- It defines **assistant-facing types** (`MemoryEntry`, `MemoryScope`, `MemoryStore`, `MemoryQuery`) that are the public API for product code.
- It **translates** between assistant-domain types and relay-domain types internally.
- It **does not duplicate** relay storage logic.
- Product code **never** imports from `@agent-relay/memory` for memory operations. The relay dependency is an implementation detail of this package.

This is distinct from:
- **Adapter** — `@relay-assistant/memory` is not implementing a new `MemoryAdapter` for relay; it uses relay adapters as its storage engine.
- **Wrapper** — a wrapper re-exports relay types with a thin pass-through; this package defines new types and semantics.
- **Thin extension** — an extension adds one or two behaviors; this package adds scope semantics, promotion, compaction, and expiry — a coherent new abstraction layer.

---

## 3. Responsibilities

`@relay-assistant/memory` provides scoped, retrievable, promotable memory across assistant sessions. Memory is not conversation history; it is durable context that survives session boundaries and informs future interactions.

**Owns:**
- `MemoryEntry` — unit of stored context, always associated with a scope
- `MemoryStore` — retrieval, write, and deletion interface; storage backend is injected
- Memory scopes — user, session, workspace, org, object (defined below)
- Retrieval — structured queries by scope, tags, and recency
- Promotion — moving an entry from a narrower scope to a broader one (e.g., session → user)
- Compaction — merging or summarizing multiple entries into fewer, denser entries
- TTL / expiry — entries may declare an expiry; expired entries are excluded from retrieval
- Tagging — arbitrary string tags on entries; used to narrow retrieval queries

**Does NOT own:**
- The strategy for deciding what to write to memory (that is the capability handler's concern)
- The model call that generates compacted summaries (compaction requires a callback; memory does not call a model directly)
- Session lifecycle (→ `@relay-assistant/sessions`)
- Surface delivery (→ `@relay-assistant/surfaces`)
- Routing (→ `@relay-assistant/routing`)
- Policy enforcement on what may be stored (→ `@relay-assistant/policy`)

---

## 4. What Is Reused from `@agent-relay/memory`

The following relay components are reused directly. No reimplementation.

### 4.1 Types (direct import)

| Relay Type | Reuse | Notes |
|---|---|---|
| `MemoryEntry` | Direct import | Used internally; assistant-facing `MemoryEntry` is a distinct type that maps to relay's |
| `MemoryAdapter` | Direct import | Used as the inner engine behind `MemoryStoreAdapter` |
| `MemorySearchQuery` | Direct import | Scope mapper translates `MemoryQuery` to this |
| `AddMemoryOptions` | Direct import | `WriteMemoryInput` maps to this |
| `MemoryResult` | Direct import | Wrapped by assistant store error types |
| `MemoryConfig` | Direct import | Passed through at configuration time |

### 4.2 Service (direct use)

| Relay Component | Reuse |
|---|---|
| `MemoryService` | Used internally by the adapter bridge |
| `createMemoryService()` | Inner factory; provides lazy adapter init and default field injection |

### 4.3 Adapters (direct use, no modification)

| Adapter | Reuse |
|---|---|
| `InMemoryAdapter` | Serves as `InMemoryMemoryStoreAdapter` for tests |
| `SupermemoryAdapter` | Available as production `MemoryStoreAdapter` without modification |

### 4.4 Compaction Utilities (partial import)

| Utility | Reuse |
|---|---|
| `ContextCompactor` token estimation | Imported for optional token budget enforcement |
| `ContextCompactor` similarity detection | Imported for optional pre-compaction deduplication hint |
| `ContextCompactor` full strategies | NOT used — assistant compaction uses a caller-supplied `CompactionCallback` |

---

## 5. What Is New in `@relay-assistant/memory` v1

New code is authored only where relay memory demonstrably does not provide the behavior.

### 5.1 Scoped Memory Model

Relay uses flat `agentId` + `projectId` + `sessionId`. Assistant memory needs hierarchical scopes:

| Scope | Key | Maps to relay fields |
|---|---|---|
| `session` | sessionId | `sessionId` on relay `MemoryEntry` |
| `user` | userId | `metadata.userId` |
| `workspace` | workspaceId | `projectId` |
| `org` | orgId | `metadata.orgId` |
| `object` | objectId + objectType | `metadata.objectId` + `metadata.objectType` |

New code: `MemoryScope` type and scope-to-relay-field translation (~80-100 lines).

### 5.2 Scope Query Expansion

`includeNarrower: true` on a query causes the assistant layer to issue multiple relay search calls and merge results. Relay has no multi-scope fan-out.

New code: query expansion and result merge logic (~60-80 lines). Defaults to `includeNarrower: false` (opt-in) to prevent unintended cross-scope data leakage.

### 5.3 Promotion

Reading a source entry and writing it to a broader scope with `promotedFromId` metadata is entirely absent from relay memory.

New code: scope validation + read-write-delete flow (~50-80 lines).

### 5.4 Entry-Level Compaction with Callback

Relay's `ContextCompactor` handles conversation turns, not stored entry consolidation. The `CompactionCallback` pattern (caller provides the LLM call) is new.

New code: callback invocation, result write, source cleanup (~50-80 lines). Utilities from `ContextCompactor` may be imported for token counting.

### 5.5 TTL / Expiry Filtering

Relay entries have no native `expiresAt`. The assistant layer stores `expiresAt` in relay `metadata` and filters post-retrieval.

New code: expiry filtering on search results (~20-30 lines).

### 5.6 Assistant-Facing Types

Product code imports `MemoryEntry`, `MemoryScope`, `MemoryStore`, `MemoryQuery` from `@relay-assistant/memory`. These are semantically richer than relay types.

New code: type definitions (~150-200 lines).

### 5.7 Provenance Metadata Convention

For v5-v8 consolidation feasibility, these fields are stored in relay entry `metadata` and must never be stripped:

| Field | Purpose |
|---|---|
| `metadata.agentId` | Which agent authored the entry |
| `metadata.source` | Which process created the entry |
| `metadata.confidence` | Optional float (0-1); not used in v1 retrieval ranking |
| `metadata.promotedFromId` | Provenance chain for promoted entries |
| `metadata.compactedFromIds` | Provenance chain for compacted entries |
| `metadata.createdInSessionId` | Session of origin, preserved through promotion |

No new infrastructure. Convention + pass-through enforcement in every write path.

---

## 6. Non-Goals (v1)

- Memory is not a vector store. Retrieval in v1 is structured (scope + tags + recency). Semantic/embedding search requires a separate adapter interface.
- Memory does not implement the compaction LLM call. It provides a `CompactionCallback` interface; the caller provides the model invocation.
- Memory does not sync across distributed instances. Consistency is the storage adapter's responsibility.
- Memory does not own session archival decisions. It provides query + bulk-delete; sessions or policy drives archival.
- Memory does not encrypt at rest. Encryption is the storage adapter's responsibility.

---

## 7. Memory Scopes

Scopes are hierarchical. Queries at a broader scope may optionally include entries from narrower scopes (opt-in; defaults shown).

| Scope | Key | Description | Default query includes narrower? |
|---|---|---|---|
| `session` | sessionId | Lives for the duration of a session. Narrowest scope. | n/a |
| `user` | userId | Persists across sessions for one user. | Includes session when sessionId provided and `includeNarrower: true` |
| `workspace` | workspaceId | Shared across users in a workspace. | Does not include user by default |
| `org` | orgId | Shared across workspaces in an org. | Does not include workspace by default |
| `object` | objectId + objectType | Attached to a specific domain object (e.g., a ticket, a document). | Independent scope |

Scope keys are opaque strings. Memory does not validate that they correspond to real entities.

A single entry belongs to exactly one scope. Promotion creates a new entry at the broader scope; the original is not deleted unless the caller requests it.

---

## 8. Interfaces and Contracts

### 8.1 `MemoryEntry`

```typescript
export interface MemoryEntry {
  /** Globally unique ID. Assigned by the store on write. */
  id: string;

  /** Scope this entry belongs to. */
  scope: MemoryScope;

  /** Content. Plain text in v1; structured content is a future extension. */
  content: string;

  /**
   * Arbitrary string tags. Used to narrow retrieval (e.g., 'preference',
   * 'fact', 'instruction', 'context').
   */
  tags: string[];

  /** ISO-8601 creation timestamp. */
  createdAt: string;

  /** ISO-8601 last-updated timestamp. */
  updatedAt: string;

  /**
   * ISO-8601 expiry timestamp. If set, store excludes this entry from
   * retrieval after this time. Store does not delete automatically.
   */
  expiresAt?: string;

  /**
   * If this entry was promoted from another entry, the source entry's ID.
   * Preserved for audit and future consolidation; does not affect retrieval.
   */
  promotedFromId?: string;

  /**
   * If this entry was produced by compaction, the IDs of source entries.
   * Preserved for audit and future consolidation.
   */
  compactedFromIds?: string[];

  /** Arbitrary key-value metadata for product extensions and provenance. */
  metadata: Record<string, unknown>;
}
```

### 8.2 `MemoryScope`

```typescript
export type MemoryScope =
  | { kind: 'session'; sessionId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'org'; orgId: string }
  | { kind: 'object'; objectId: string; objectType: string };
```

### 8.3 `MemoryStore`

```typescript
export interface MemoryStore {
  /**
   * Write a new memory entry. Returns the stored entry with assigned id
   * and timestamps.
   */
  write(input: WriteMemoryInput): Promise<MemoryEntry>;

  /**
   * Retrieve entries matching the query. Excludes expired entries.
   */
  retrieve(query: MemoryQuery): Promise<MemoryEntry[]>;

  /**
   * Retrieve a single entry by ID. Returns null if not found or expired.
   */
  get(entryId: string): Promise<MemoryEntry | null>;

  /**
   * Update the content and/or tags of an existing entry. Scope and
   * promotedFromId are immutable after creation.
   */
  update(entryId: string, patch: UpdateMemoryPatch): Promise<MemoryEntry>;

  /**
   * Delete an entry by ID. Idempotent.
   */
  delete(entryId: string): Promise<void>;

  /**
   * Delete all entries matching the scope. Used during session expiry or
   * workspace teardown. Returns count of deleted entries.
   */
  deleteByScope(scope: MemoryScope): Promise<number>;

  /**
   * Promote an entry to a broader scope. Creates a new entry at the target
   * scope with promotedFromId set. Original entry is not deleted unless
   * deleteOriginal is true.
   */
  promote(input: PromoteMemoryInput): Promise<MemoryEntry>;

  /**
   * Compact multiple entries into one. Calls the provided callback to
   * generate the compacted content; writes the result at the target scope.
   * Source entries are not deleted unless deleteSourceEntries is true.
   */
  compact(input: CompactMemoryInput): Promise<MemoryEntry>;
}
```

### 8.4 `WriteMemoryInput`

```typescript
export interface WriteMemoryInput {
  scope: MemoryScope;
  content: string;
  tags?: string[];
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}
```

### 8.5 `MemoryQuery`

```typescript
export interface MemoryQuery {
  /** Primary scope to query. Required. */
  scope: MemoryScope;

  /**
   * When true, include entries from narrower scopes according to default
   * inclusion rules. Defaults to false (opt-in to prevent surprise data
   * leakage across scopes).
   */
  includeNarrower?: boolean;

  /** Filter to entries that have ALL of the specified tags. */
  tags?: string[];

  /** Return entries created/updated after this ISO-8601 timestamp. */
  since?: string;

  /** Maximum entries to return. Defaults to 20. */
  limit?: number;

  /** Sort order. Defaults to 'newest'. */
  order?: 'newest' | 'oldest';
}
```

### 8.6 `UpdateMemoryPatch`

```typescript
export interface UpdateMemoryPatch {
  content?: string;
  tags?: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}
```

### 8.7 `PromoteMemoryInput`

```typescript
export interface PromoteMemoryInput {
  sourceEntryId: string;
  targetScope: MemoryScope;
  /** If true, delete the source entry after promotion. Defaults to false. */
  deleteOriginal?: boolean;
  /** Override content in the promoted entry. Defaults to source content. */
  content?: string;
  /** Override tags. Defaults to source tags. */
  tags?: string[];
}
```

### 8.8 `CompactMemoryInput`

```typescript
export interface CompactMemoryInput {
  /** IDs of entries to compact. Must be non-empty. All must share the same scope. */
  sourceEntryIds: string[];

  /** Scope of the resulting compacted entry. Must match source entries' scope. */
  targetScope: MemoryScope;

  /**
   * Callback that receives the source entries and returns compacted content.
   * Memory does not call a model; the caller provides this function.
   */
  compactionCallback: CompactionCallback;

  /** If true, delete source entries after compaction. Defaults to false. */
  deleteSourceEntries?: boolean;

  tags?: string[];
  metadata?: Record<string, unknown>;
}

export type CompactionCallback = (
  entries: MemoryEntry[],
) => Promise<string> | string;
```

### 8.9 `MemoryStoreAdapter`

```typescript
/**
 * Storage backend interface. In v1, implementations wrap @agent-relay/memory
 * adapters (InMemoryAdapter, SupermemoryAdapter). Memory package never
 * imports a specific storage driver.
 */
export interface MemoryStoreAdapter {
  insert(entry: MemoryEntry): Promise<void>;
  fetchById(entryId: string): Promise<MemoryEntry | null>;
  fetchMany(query: MemoryAdapterQuery): Promise<MemoryEntry[]>;
  update(entryId: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry>;
  deleteById(entryId: string): Promise<void>;
  deleteManyByScope(scope: MemoryScope): Promise<number>;
}

/** Internal query shape passed to the adapter after normalization. */
export interface MemoryAdapterQuery {
  scopes: MemoryScope[];
  tags?: string[];
  since?: string;
  excludeExpiredBefore: string; // ISO-8601; adapter filters entries with expiresAt < this value
  limit: number;
  order: 'newest' | 'oldest';
}
```

### 8.10 Error Types

```typescript
export class MemoryEntryNotFoundError extends Error {
  constructor(public readonly entryId: string) {
    super(`Memory entry not found: ${entryId}`);
  }
}

export class InvalidScopePromotionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class CompactionError extends Error {
  constructor(
    public readonly sourceEntryIds: string[],
    cause: Error,
  ) {
    super(`Compaction failed for entries [${sourceEntryIds.join(', ')}]: ${cause.message}`);
  }
}
```

---

## 9. `createMemoryStore` Factory

```typescript
export function createMemoryStore(config: MemoryStoreConfig): MemoryStore;

export interface MemoryStoreConfig {
  /** Storage backend. Use relay adapters (InMemoryAdapter, SupermemoryAdapter) directly. */
  adapter: MemoryStoreAdapter;

  /**
   * When true, scope inclusion rules (includeNarrower) are applied on the
   * store layer. When false, callers must construct explicit multi-scope
   * queries themselves. Defaults to true.
   */
  applyInclusionRules?: boolean;
}
```

---

## 10. Package Boundaries

### Depends on
- `@agent-relay/memory` — **primary dependency**; all storage and retrieval delegates here
- `@relay-assistant/core` — imports `InboundMessage` (type only; optional convenience utility)
- `@relay-assistant/sessions` — imports `Session` type to extract scope keys

### Depended on by
- `@relay-assistant/proactive` — reads memory for triggers and evidence
- `@relay-assistant/coordination` — reads shared workspace/org memory
- Product capability handlers (direct consumers)

### Dependency Rules

| Direction | Rule |
|---|---|
| Memory → `@agent-relay/memory` | **Allowed. Primary reuse target.** |
| Memory → core | Allowed. Import types only. |
| Memory → sessions | Allowed. Import `Session` type only. |
| Memory → surfaces | **Forbidden.** |
| Memory → routing | **Forbidden.** |
| Memory → relay transport/auth | **Forbidden.** |
| Memory → policy | **Forbidden in v1.** |

---

## 11. Scope Promotion Rules

Promotion is only valid "upward" (narrower → broader):

- `session` → `user`, `workspace`, `org`, `object`
- `user` → `workspace`, `org`
- `workspace` → `org`
- `object` → `user`, `workspace`, `org` (object scope is lateral, not strictly nested)

Attempting to promote downward (e.g., `org` → `user`) throws `InvalidScopePromotionError`.

Cross-scope compaction is not allowed in v1. All source entries must share the same scope as the `targetScope`. This simplifies implementation and avoids scope ambiguity on the compacted result.

---

## 12. Open Question Resolutions

| # | Question | v1 Resolution |
|---|---|---|
| OQ-1 | `includeNarrower` opt-in vs opt-out | **Opt-in.** Default `false` to prevent surprise data leakage. |
| OQ-2 | Object scope retrievable via user/workspace queries | **No in v1.** Object scope is independent; query explicitly. Revisit when Sage integration lands. |
| OQ-3 | Conflicting entries | **Deferred to v1.1.** No conflict flag in v1. |
| OQ-4 | Cross-scope compaction | **Same scope required in v1.** All source entries must share the same scope. |
| OQ-5 | Max content length | **Adapter's responsibility in v1.** Document recommended maximums in the README. |

---

## 13. OSS vs Cloud Boundary

All types, factory functions, and the in-memory adapter bridge are OSS.

The `MemoryStoreAdapter` interface is OSS; Redis/Postgres/vector-DB implementations may be cloud-specific.

Compaction callbacks that call a hosted model are product code, not part of this package.

Semantic retrieval (embedding-based search) is out of scope for v1. When added, it will be an optional method on `MemoryStore` backed by an additional adapter interface.

---

## 14. Explicitly Deferred

### Deferred to v1.1
- Semantic/embedding search — relay's `SupermemoryAdapter` supports it; assistant adapter wire-up deferred
- Session archival workflow — requires `@relay-assistant/sessions` coordination

### Deferred to v1.2+
- Proactive memory — requires `@relay-assistant/proactive`
- Memory-informed traits — requires `@relay-assistant/traits`

### Deferred to v2
- Policy-gated memory — requires `@relay-assistant/policy`
- Encrypted memory — storage adapter responsibility

### Deferred to v5-v8: Cross-Agent Memory Consolidation

The **librarian / night-crawler** capability is explicitly out of scope for v1 through v4. This future layer would:
- Deduplicate facts produced by multiple agents
- Reconcile contradictions between agent memories
- Preserve provenance and confidence through consolidation
- Publish consolidated shared/team memory

**v1 preparation:** The provenance metadata fields defined in §5.7 are the v1 investment that makes future consolidation feasible. The v1 implementation must:
1. Always preserve `agentId`, `source`, and `confidence` through promotion and compaction
2. Never flatten `compactedFromIds` or `promotedFromId` metadata
3. Store `createdInSessionId` so consolidation can trace memory origins

No consolidation logic runs in v1. This is metadata preservation only.

---

## 15. First Implementation Slice

**Step 1 — Type exports only**
- Export all interfaces, types, and error classes.
- Tests: TypeScript structural checking on all types.

**Step 2 — Relay adapter bridge (`InMemoryMemoryStoreAdapter`)**
- Implements `MemoryStoreAdapter` wrapping `@agent-relay/memory`'s `InMemoryAdapter`.
- Tests: insert, fetchById, fetchMany with scope and tag filters, expiry exclusion.

**Step 3 — `createMemoryStore` with write + retrieve**
- Implement `write()` (assign id and timestamps, map scope to relay fields) and `retrieve()` (scope mapper + adapter call + expiry filter).
- Tests: write entry; retrieve by exact scope; retrieve excludes expired; tag filtering works.

**Step 4 — `update` and `delete`**
- Implement update (immutability constraints on scope) and delete.
- Tests: update content and tags; cannot update scope; delete is idempotent.

**Step 5 — Scope query expansion**
- Implement `includeNarrower` logic (fan-out + merge).
- Tests: user-scope query with sessionId includes session entries when flag is true.

**Step 6 — Promotion**
- Implement `promote()` with scope validation.
- Tests: session → user promotion; invalid downward promotion throws.

**Step 7 — Compaction**
- Implement `compact()` with callback invocation and error wrapping.
- Tests: callback receives correct entries; result entry has compactedFromIds set; source entries deleted when flag is true.

**Step 8 — `deleteByScope`**
- Implement bulk delete; return count.
- Tests: deletes correct entries; does not affect other scopes.

**Definition of done:** A capability handler can write session-scoped memory during a turn, retrieve it in the next turn, promote it to user scope at session end, and compact user memories on a schedule. 40+ tests pass.

---

## 16. Success Criteria

1. A capability handler can `write()` a session-scoped memory entry during a turn
2. The same handler can `retrieve()` that entry in the next turn
3. At session end, a handler can `promote()` a session memory to user scope
4. A scheduled job can `compact()` user memories using a caller-provided LLM callback
5. All operations preserve provenance metadata (`agentId`, `source`, `confidence`, `promotedFromId`, `compactedFromIds`, `createdInSessionId`)
6. Expired entries are excluded from retrieval
7. The underlying storage is provided by `@agent-relay/memory` adapters — no new storage code
8. 40+ tests pass

V1_MEMORY_SPEC_READY
