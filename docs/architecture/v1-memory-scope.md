# v1 Memory Scope — `@relay-assistant/memory`

**Date:** 2026-04-11
**Author:** lead-claude (memory architect)
**Status:** SCOPE_DEFINED

---

## 1. Purpose

This document defines the bounded scope for the v1 implementation of `@relay-assistant/memory`. It establishes what should be reused from `@agent-relay/memory`, what the assistant-memory layer adds on top, and what is explicitly deferred.

The guiding principle is **reuse-first**: `@relay-assistant/memory` is an assistant-facing composition layer over `@agent-relay/memory`, not a greenfield memory engine.

---

## 2. What Exists in `@agent-relay/memory` (Reuse Candidates)

The relay foundation `@agent-relay/memory` package (v4.0.10) already provides:

### 2.1 Core Types and Interfaces (REUSE)
- **`MemoryEntry`** — content, id, tags, metadata, timestamps, source, agentId, projectId, sessionId, score
- **`MemoryAdapter`** — full CRUD interface: `add`, `search`, `get`, `delete`, `update?`, `list?`, `clear?`, `stats?`, `close?`
- **`MemorySearchQuery`** — semantic search with query text, limit, minScore, tags, agentId, projectId, time filters
- **`AddMemoryOptions`** — tags, source, agentId, projectId, sessionId, metadata
- **`MemoryResult`** — success/failure with id and error
- **`MemoryConfig`** — adapter type, apiKey, endpoint, defaults

### 2.2 Service Layer (REUSE)
- **`MemoryService`** — simplified interface wrapping adapters: `add`, `search`, `delete`, `list`, `isAvailable`
- **`createMemoryService()`** — factory with lazy adapter init, default injection for agentId/projectId/sessionId

### 2.3 Adapter Implementations (REUSE)
- **`InMemoryAdapter`** — Map-backed in-memory store for testing
- **`SupermemoryAdapter`** — supermemory.ai production backend with semantic search

### 2.4 Context Compaction (REUSE)
- **`ContextCompactor`** — token estimation, importance scoring, similarity detection, summarization
- Compaction strategies: trim_old, trim_low_importance, summarize, deduplicate, aggressive
- Token budget tracking

### 2.5 Memory Hooks (REUSE with adaptation)
- **`createMemoryHooks()`** — lifecycle hooks for session start (load context), session end (save learnings), output (`@memory:` command patterns)
- Auto-detection of learnings from output using pattern matching

---

## 3. What `@relay-assistant/memory` Adds in v1

The assistant-memory layer exists because relay memory is agent/project-scoped, while assistant memory needs **hierarchical scope semantics** and **cross-session promotion**. The v1 assistant-memory layer is a **thin composition layer** — not a wrapper, not a full re-implementation.

### 3.1 Scoped Memory Model (NEW — assistant-specific)

Relay memory uses flat `agentId` + `projectId` + `sessionId` keys. Assistant memory needs a hierarchical scope model:

| Scope | Key | Maps to relay memory fields |
|---|---|---|
| `session` | sessionId | `sessionId` on relay `MemoryEntry` |
| `user` | userId | `metadata.userId` (relay has no native userId) |
| `workspace` | workspaceId | `projectId` (natural mapping) |
| `org` | orgId | `metadata.orgId` (relay has no native orgId) |
| `object` | objectId + objectType | `metadata.objectId` + `metadata.objectType` |

**Implementation approach:** The `MemoryScope` type and scope-to-relay-field mapping logic is new assistant code. It translates assistant scope queries into relay adapter `search()` calls with appropriate filters.

### 3.2 Scope Query Expansion (NEW — assistant-specific)

The `includeNarrower` behavior (querying user scope optionally includes session-scope entries) does not exist in relay memory. This is new assistant-layer query logic that:
- Translates a single `MemoryQuery` with `includeNarrower: true` into multiple relay search calls
- Merges and deduplicates results
- Respects scope hierarchy rules

### 3.3 Promotion (NEW — assistant-specific)

Moving a memory entry from a narrower scope to a broader one (e.g., session → user) is not a relay memory concept. The assistant layer adds:
- `promote()` — creates a new entry at the target scope, sets `promotedFromId` metadata
- Scope validation: only upward promotion is allowed
- Optional deletion of the source entry

**Implementation approach:** Promotion is implemented as a read-from-source + write-to-target-scope operation using the underlying relay adapter.

### 3.4 Compaction with Callback (NEW contract, REUSE infrastructure)

Relay memory has `ContextCompactor` for conversation context. Assistant memory needs entry-level compaction — merging multiple stored memories into fewer, denser ones.

- The `CompactionCallback` contract is new (caller provides the LLM summarization)
- The read-source-entries + write-compacted-entry + optional-delete-sources flow is new
- Token estimation and similarity utilities from relay's `ContextCompactor` can be reused

### 3.5 TTL / Expiry (NEW — thin layer)

Relay memory entries have no native `expiresAt` field. The assistant layer adds:
- `expiresAt` stored in relay entry `metadata.expiresAt`
- Expiry filtering applied in the assistant layer after relay `search()` returns results
- No automatic deletion — expired entries are excluded from retrieval but remain in storage

### 3.6 Assistant-Facing Type Re-exports (NEW types, REUSE backing)

The assistant layer defines its own public API types (`MemoryEntry`, `MemoryScope`, `MemoryStore`, `MemoryQuery`, etc.) that are semantically richer than relay types. These are the types that product code imports. The assistant layer translates between its types and relay types internally.

### 3.7 Provenance and Confidence Metadata (NEW — future-enabling)

To support future cross-agent memory consolidation (v5-v8), v1 memory entries must preserve:

- **`metadata.source`** — which agent or process created this entry (maps naturally to relay's `source` field)
- **`metadata.agentId`** — the specific agent that authored the entry (direct relay field)
- **`metadata.confidence`** — optional float (0-1) indicating the entry creator's confidence in the content's accuracy. Not used in v1 retrieval ranking, but preserved for future consolidation logic
- **`metadata.promotedFromId`** — provenance chain for promoted entries
- **`metadata.compactedFromIds`** — provenance chain for compacted entries
- **`metadata.createdInSessionId`** — the session where the entry originated, preserved even after promotion

These fields must not be stripped by compaction or promotion. The v1 implementation must pass them through faithfully.

---

## 4. What is NOT in v1 (Deferred)

### 4.1 Deferred to v1.1
- **Semantic/embedding search** — v1 retrieval is structured (scope + tags + recency). Semantic search requires an additional adapter interface. Relay's supermemory adapter already supports it; the assistant layer will expose it as an optional `MemoryStore` method in v1.1.
- **Session archival workflow** — automated archival of session-scoped memories when a session expires. Requires coordination with `@relay-assistant/sessions`.

### 4.2 Deferred to v1.2+
- **Proactive memory** — automatic memory creation based on conversation patterns. Requires `@relay-assistant/proactive`.
- **Memory-informed traits** — using memory to influence assistant personality or style. Requires `@relay-assistant/traits`.

### 4.3 Deferred to v2
- **Policy-gated memory** — restrictions on what can be stored, who can read it, audit logging. Requires `@relay-assistant/policy`.
- **Encrypted memory** — encryption at the assistant layer (storage encryption is the adapter's responsibility).

### 4.4 Deferred to v5-v8: Cross-Agent Memory Consolidation

The **librarian / night-crawler** capability is explicitly out of scope for v1. This future layer would:
- Deduplicate facts produced by multiple agents
- Reconcile contradictions between agent memories
- Preserve provenance and confidence through consolidation
- Publish consolidated shared/team memory

**v1 preparation:** The provenance and confidence metadata fields defined in section 3.7 are the v1 investment that makes future consolidation feasible. The v1 implementation must:
1. Always preserve `agentId`, `source`, and `confidence` through promotion and compaction
2. Never flatten `compactedFromIds` or `promotedFromId` metadata
3. Store `createdInSessionId` so consolidation can trace memory origins

This is a metadata preservation requirement, not a feature. No consolidation logic runs in v1.

---

## 5. Dependency and Integration Map

```
@agent-relay/memory (relay foundation)
  ├── MemoryAdapter interface
  ├── InMemoryAdapter
  ├── SupermemoryAdapter
  ├── ContextCompactor
  └── MemoryService

@relay-assistant/memory (this package — v1)
  ├── imports @agent-relay/memory adapters and types
  ├── imports @relay-assistant/core (InboundMessage type — optional utility)
  ├── imports @relay-assistant/sessions (Session type — scope key extraction)
  ├── defines MemoryScope, MemoryStore, MemoryQuery (assistant-facing)
  ├── implements scope mapping, query expansion, promotion, compaction
  └── exports createMemoryStore() factory

Products (Sage, MSD, NightCTO)
  ├── import @relay-assistant/memory
  ├── provide CompactionCallback (LLM call)
  ├── provide MemoryAdapter (or use default relay adapters)
  └── own tag taxonomy and memory write decisions
```

### Forbidden Dependencies
- Memory → surfaces: Forbidden
- Memory → routing: Forbidden
- Memory → relay foundation (transport, auth): Forbidden
- Memory → policy: Forbidden (v1)

### Allowed Dependencies
- Memory → `@agent-relay/memory`: Allowed (primary reuse target)
- Memory → core: Allowed (type imports only)
- Memory → sessions: Allowed (Session type import only)

---

## 6. v1 Implementation Realism Check

### What v1 actually builds (new code)
1. **Type definitions** — `MemoryScope`, `MemoryStore`, `MemoryQuery`, `PromoteMemoryInput`, `CompactMemoryInput`, error types (~150-200 lines)
2. **Scope mapper** — translates assistant scopes to relay adapter query fields (~80-100 lines)
3. **`createMemoryStore()` factory** — wraps a relay `MemoryAdapter` with scope, promotion, compaction, and expiry logic (~300-400 lines)
4. **Promotion logic** — scope validation + read-write-delete flow (~50-80 lines)
5. **Compaction orchestration** — callback invocation + result write + source cleanup (~50-80 lines)
6. **Expiry filtering** — post-retrieval filter for `expiresAt` (~20-30 lines)

### What v1 does NOT build
- No new storage backend
- No new search algorithm
- No new adapter implementations
- No new context compaction engine
- No LLM calls
- No session lifecycle management
- No cross-agent consolidation logic

**Estimated new code:** ~650-890 lines of TypeScript (types + implementation), plus ~400-600 lines of tests.

### Realistic test target
Based on the spec's 8-step implementation plan and comparable packages:
- Type structural tests: ~5
- InMemoryAdapter passthrough: ~8
- Write + retrieve: ~8
- Update + delete: ~6
- Scope query expansion: ~6
- Promotion: ~8
- Compaction: ~6
- deleteByScope: ~3
- **Total: ~50 tests** (above the 40+ DoD threshold)

---

## 7. Open Question Resolutions for v1

| # | Question | v1 Resolution |
|---|---|---|
| OQ-1 | `includeNarrower` opt-in vs opt-out | **Opt-in** (current spec). Default `false` to prevent surprise data leakage. |
| OQ-2 | Object scope retrievable via user/workspace queries | **No** in v1. Object scope is independent; query explicitly. Revisit when Sage integration lands. |
| OQ-3 | Conflicting entries | **Deferred** to v1.1. No conflict flag in v1. |
| OQ-4 | Cross-scope compaction | **Same scope required** in v1. All source entries must share the same scope. Simplifies implementation and avoids scope ambiguity on the compacted result. |
| OQ-5 | Max content length | **Adapter's responsibility** in v1. The assistant layer does not enforce a limit. Document recommended maximums in the README. |

---

## 8. Success Criteria

The v1 memory implementation is complete when:

1. A capability handler can `write()` a session-scoped memory entry during a turn
2. The same handler can `retrieve()` that entry in the next turn
3. At session end, a handler can `promote()` a session memory to user scope
4. A scheduled job can `compact()` user memories using a caller-provided LLM callback
5. All operations preserve provenance metadata (`agentId`, `source`, `confidence`, `promotedFromId`, `compactedFromIds`)
6. Expired entries are excluded from retrieval
7. The underlying storage is provided by `@agent-relay/memory` adapters — no new storage code
8. 40+ tests pass

V1_MEMORY_SCOPE_READY
