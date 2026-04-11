# Memory Reuse Investigation — `@relay-assistant/memory` over `@agent-relay/memory`

**Date:** 2026-04-11
**Author:** memory-architect
**Status:** COMPLETE
**Feeds into:** `docs/specs/v1-memory-spec.md`, `docs/architecture/v1-memory-implementation-plan.md`

---

## 1. Purpose

This document records the investigation that determined the reuse-first strategy for `@relay-assistant/memory`. It answers: what does `@agent-relay/memory` provide, what can be reused verbatim, what requires a thin adaptation layer, and what must be authored from scratch?

---

## 2. What `@agent-relay/memory` Provides (v4.0.10)

`@agent-relay/memory` is a production-grade relay foundation package. It is the primary storage and retrieval engine used by the relay agent runtime today.

### 2.1 Core Types

| Type | What it provides | Reuse decision |
|---|---|---|
| `MemoryEntry` | content, id, tags, metadata, timestamps, source, agentId, projectId, sessionId, score | **REUSE** — maps cleanly to assistant entry with scope fields stored in metadata |
| `MemoryAdapter` | CRUD interface: `add`, `search`, `get`, `delete`, `update?`, `list?`, `clear?`, `stats?`, `close?` | **REUSE** — assistant `MemoryStoreAdapter` wraps this |
| `MemorySearchQuery` | semantic search: query text, limit, minScore, tags, agentId, projectId, time filters | **NOT used in v1.** Requires a non-empty `query: string`; both adapters score by text match and return zero results without it. Reserved for v1.1 semantic search. v1 retrieval uses `list()` instead. |
| `AddMemoryOptions` | tags, source, agentId, projectId, sessionId, metadata | **REUSE** — assistant write input maps to this |
| `MemoryResult` | success/failure with id and error | **REUSE** — wrapped by assistant store error types |
| `MemoryConfig` | adapter type, apiKey, endpoint, defaults | **REUSE** — passed through at config time |

### 2.2 Service Layer

| Component | What it provides | Reuse decision |
|---|---|---|
| `MemoryService` | `add`, `search`, `delete`, `list`, `isAvailable` | **NOT USED in v1.** `MemoryService` lacks `get()`, `update()`, and bulk-delete-by-scope. The bridge (`RelayMemoryStoreAdapter`) connects to `MemoryAdapter` directly to access these operations. |
| `createMemoryService()` | factory with lazy adapter init, default injection for agentId/projectId/sessionId | **NOT USED in v1.** Adapter construction is the caller's responsibility; the assistant factory (`createMemoryStore`) accepts a pre-constructed `MemoryStoreAdapter`. |

### 2.3 Adapter Implementations

| Adapter | What it provides | Reuse decision |
|---|---|---|
| `InMemoryAdapter` | Map-backed in-memory store for testing | **REUSE DIRECTLY** — also serve as the `InMemoryMemoryStoreAdapter` in tests |
| `SupermemoryAdapter` | supermemory.ai production backend with semantic search | **REUSE** — available as a `MemoryStoreAdapter` option without modification |

### 2.4 Context Compaction

| Component | What it provides | Reuse decision |
|---|---|---|
| `ContextCompactor` | token estimation, importance scoring, similarity detection, summarization | **PARTIAL REUSE** — token estimation and similarity utilities are imported; full compaction engine not used |
| Compaction strategies | trim_old, trim_low_importance, summarize, deduplicate, aggressive | **NOT REUSED** — these are conversation-context strategies; assistant compaction uses a caller-supplied `CompactionCallback` |

### 2.5 Memory Hooks

| Component | What it provides | Reuse decision |
|---|---|---|
| `createMemoryHooks()` | lifecycle hooks for session start, session end, output patterns | **REUSE WITH ADAPTATION** — the hook pattern is adopted; assistant hooks plug into relay hooks but translate scope semantics |
| Auto-detection of learnings | `@memory:` pattern matching in output | **NOT REUSED IN V1** — assistant products control their own write decisions |

---

## 3. Gap Analysis: What Relay Memory Does NOT Provide

These gaps are what necessitate the `@relay-assistant/memory` layer. Each gap becomes new assistant-authored code.

### 3.1 Hierarchical Scope Model

**Relay memory uses:** flat `agentId` + `projectId` + `sessionId` keys.

**Assistant memory needs:** hierarchical scopes — `session`, `user`, `workspace`, `org`, `object` — with well-defined promotion paths and default inclusion rules.

**Gap:** relay has no `userId`, `workspaceId`, `orgId`, or `objectId` fields as first-class concepts. These must be stored in relay's `metadata` and translated by the assistant layer.

**Verdict:** New code required. ~80-100 lines of scope mapping logic.

### 3.2 Scope Query Expansion (`includeNarrower`)

**Relay memory:** a search call queries one adapter at a time with flat filters.

**Assistant memory needs:** a query at `user` scope optionally includes `session` scope entries (when `includeNarrower: true` and a `sessionId` is available).

**Gap:** relay has no multi-scope fan-out query logic. The assistant layer must issue multiple adapter calls and merge results.

**Verdict:** New code required. ~60-80 lines.

### 3.3 Promotion

**Relay memory:** no concept of moving an entry from one scope to another.

**Assistant memory needs:** `promote()` — reads a source entry, writes a new entry at a broader scope with `promotedFromId` set, optionally deletes the source.

**Gap:** entirely absent from relay memory.

**Verdict:** New code required. ~50-80 lines. Uses relay adapter CRUD primitives.

### 3.4 Entry-Level Compaction with Callback

**Relay memory:** `ContextCompactor` handles conversation context (turn history), not stored entry consolidation.

**Assistant memory needs:** `compact()` — reads multiple stored entries, calls a caller-supplied `CompactionCallback` to produce merged content, writes the result as a new entry.

**Gap:** relay compaction is for conversation turns, not for persistent entry reduction. The callback pattern is entirely new.

**Verdict:** New contract required. Utilities from `ContextCompactor` (token counting, similarity) can be imported. ~50-80 lines of orchestration.

### 3.5 TTL / Expiry Filtering

**Relay memory:** `MemoryEntry` has no native `expiresAt` field. Adapters do not filter by expiry.

**Assistant memory needs:** entries may declare `expiresAt`; expired entries are excluded from retrieval.

**Gap:** must be stored in relay entry `metadata.expiresAt` and filtered post-retrieval by the assistant layer.

**Verdict:** New code required. ~20-30 lines of filtering logic on top of relay search results.

### 3.6 Assistant-Facing Type Contracts

**Relay memory:** types are relay-domain types (`agentId`, `projectId`, relay-specific metadata).

**Assistant memory needs:** product code imports `MemoryEntry`, `MemoryScope`, `MemoryStore`, `MemoryQuery` — assistant-domain types.

**Gap:** the assistant must define its own public type surface, and the composition layer translates between them.

**Verdict:** New type definitions required (~150-200 lines). The backing storage is relay's.

### 3.7 Provenance Metadata for Future Consolidation

**Relay memory:** has `source` and `agentId` fields, but no `confidence`, `promotedFromId`, `compactedFromIds`, or `createdInSessionId`.

**Assistant memory needs:** these fields must be stored in relay entry `metadata` and preserved through promotion and compaction — so that v5-v8 cross-agent consolidation can trace memory provenance.

**Gap:** no relay enforcement of preservation; the assistant layer must explicitly pass these fields through every write operation.

**Verdict:** Convention + code discipline. No new infrastructure; new field conventions that the assistant layer enforces.

---

## 4. Reuse Classification Summary

| Relay Component | Reuse Class | V1 Action |
|---|---|---|
| `MemoryEntry` type | Direct reuse | Import and wrap in assistant entry mapping |
| `MemoryAdapter` interface | Direct reuse | Use as the inner engine behind `MemoryStoreAdapter` bridge |
| `MemorySearchQuery` | Not used in v1 | Reserved for v1.1 semantic search; v1 retrieval uses `list()` |
| `AddMemoryOptions` | Direct reuse | Write input maps to this |
| `MemoryService` | Not used in v1 | Lacks get(), update(), bulk-delete; bridge targets MemoryAdapter directly |
| `createMemoryService()` | Not used in v1 | Adapter construction is the caller's responsibility |
| `InMemoryAdapter` | Direct reuse | Default test adapter |
| `SupermemoryAdapter` | Direct reuse | Default production adapter |
| `ContextCompactor` (utilities) | Partial reuse | Token counting + similarity only |
| `createMemoryHooks()` | Reuse with adaptation | Hook pattern adopted; scope translation added |
| Compaction strategies | Not reused | Callback pattern used instead |
| Auto-learning detection | Not reused in v1 | Product-controlled write decisions |

---

## 5. Architecture Decision: Composition Layer, Not Wrapper

The investigation considered four architectural patterns for `@relay-assistant/memory`:

| Pattern | Description | Verdict |
|---|---|---|
| **Adapter** | `@relay-assistant/memory` implements a new `MemoryAdapter` that wraps relay adapters | Rejected — inverts the abstraction; relay adapters become internal |
| **Wrapper** | Re-exports relay types with a thin pass-through facade | Rejected — provides no scope semantics, no promotion, no compaction |
| **Composition layer** | New assistant-facing types and logic on top of relay service + adapter | **CHOSEN** — clean separation; relay is infrastructure, assistant is product |
| **Full re-implementation** | Replaces relay memory entirely | Rejected — violates reuse-first principle; duplicates proven infrastructure |

**The composition layer is the right pattern because:**

1. Relay `MemoryAdapter` handles storage and retrieval — proven infrastructure. The bridge connects directly to `MemoryAdapter` (not `MemoryService`) to access the full operation surface (`get()`, `update()`, `list()`, `delete()`).
2. The assistant layer adds scope semantics, promotion, compaction, and expiry on top — genuinely new behavior that relay has no reason to provide.
3. Product code imports only `@relay-assistant/memory` types — the relay dependency is an implementation detail.
4. Relay can be upgraded without changing the assistant API surface.
5. The assistant layer is thin (~650-890 lines) — it does not duplicate relay's storage logic.
6. v1 retrieval is structured (scope + tags + recency) using `MemoryAdapter.list()` as the relay primitive. `MemoryAdapter.search()` is reserved for v1.1 semantic retrieval because it requires a non-empty query string and both current adapters return zero results without one.

---

## 6. Boundary Enforcement

The following rules are non-negotiable for v1:

| Rule | Rationale |
|---|---|
| `@relay-assistant/memory` depends on `@agent-relay/memory` | Primary reuse target |
| `@relay-assistant/memory` does NOT depend on relay transport, auth, or protocol | Memory is application-layer, not protocol-layer |
| `@relay-assistant/memory` does NOT depend on surfaces or routing | These are forbidden directions per the spec |
| Relay types are internal implementation details | Product code never imports from `@agent-relay/memory` for memory operations |
| Provenance fields (`agentId`, `confidence`, `promotedFromId`, `compactedFromIds`, `createdInSessionId`) are always passed through | Required for v5-v8 consolidation feasibility |

---

## 7. Deferred Items (Not Reuse Gaps — Deliberate Deferrals)

The following items were considered and deliberately deferred. They are NOT gaps in the relay package; they are features the assistant layer will add in future versions.

| Item | Deferred to | Reason |
|---|---|---|
| Semantic/embedding search | v1.1 | Requires adapter interface extension; relay's `SupermemoryAdapter` already supports it — wire-up is low effort but out of v1 scope |
| Session archival workflow | v1.1 | Requires coordination with `@relay-assistant/sessions` |
| Proactive memory creation | v1.2 | Requires `@relay-assistant/proactive` |
| Memory-informed traits | v1.2 | Requires `@relay-assistant/traits` |
| Policy-gated memory | v2 | Requires `@relay-assistant/policy` |
| Encrypted memory | v2 | Storage-layer concern |
| Cross-agent memory consolidation (librarian) | v5-v8 | Explicitly out of scope; v1 preserves provenance metadata to enable this |

---

## 8. Conclusion

`@relay-assistant/memory` is correctly understood as a **thin composition layer** over `@agent-relay/memory`. The relay package provides all storage infrastructure. The assistant package provides the assistant-domain type system, scope semantics, promotion, compaction orchestration, and expiry filtering.

The investigation found no reason to author new storage backends, new search algorithms, or new adapter implementations in v1. Every storage operation ultimately delegates to a relay `MemoryAdapter`. The new code is scope translation, scope query expansion, promotion logic, compaction orchestration, and expiry filtering — totaling ~650-890 lines.

This architecture is validated. The implementation plan and spec follow from this investigation.
