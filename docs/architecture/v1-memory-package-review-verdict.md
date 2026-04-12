# v1 Memory Package Review Verdict

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Package:** `@relay-assistant/memory`
**Reviewer:** non-interactive review agent
**Inputs reviewed:**
- `docs/specs/v1-memory-spec.md`
- `docs/architecture/v1-memory-package-implementation-plan.md`
- `docs/research/memory-reuse-investigation.md`
- `../relay/packages/memory/src/index.ts`
- `packages/memory/package.json`
- `packages/memory/tsconfig.json`
- `packages/memory/src/index.ts`
- `packages/memory/src/types.ts`
- `packages/memory/src/memory.ts`
- `packages/memory/src/memory.test.ts`
- `packages/memory/README.md`

---

## Verdict Summary

**PASS_WITH_FOLLOWUPS**

The core implementation is correct, complete, and well-structured. All eight `MemoryStore` methods are present, all five scope kinds round-trip cleanly, and the reuse-first posture is faithfully reflected. The primary blocker before product integration is the test shortfall: the spec requires 40+ tests and the plan specifies 50; the implementation delivers 14-16 integration-style tests. Additionally, one unused dependency should be removed. No architectural issues.

---

## 1. Spec Conformance

### Types (`types.ts`) — PASS

All interfaces and types match spec §8.1–§8.10 and §9 exactly:

| Type | Status |
|---|---|
| `MemoryEntry` | Matches spec §8.1 exactly |
| `MemoryScope` | Matches spec §8.2 exactly (5 discriminated union members) |
| `MemoryStore` | All 8 methods match spec §8.3 |
| `WriteMemoryInput` | Matches spec §8.4 |
| `MemoryQuery` | Matches spec §8.5 |
| `UpdateMemoryPatch` | Matches spec §8.6 |
| `PromoteMemoryInput` | Matches spec §8.7 |
| `CompactMemoryInput` | Matches spec §8.8 |
| `CompactionCallback` | Matches spec §8.8 |
| `MemoryStoreAdapter` | Minor deviation — see below |
| `MemoryAdapterQuery` | Matches spec §8.9 |
| `MemoryStoreConfig` | Matches spec §9 |
| Error classes (3) | All match; `this.name` and `this.cause` are bonus improvements |

**One minor deviation:** The spec (§8.9) declares `insert(entry: MemoryEntry): Promise<void>`, but the implementation declares `insert(entry: MemoryEntry): Promise<MemoryEntry>`. The implementation is correct — `insert()` round-trips through `adapter.add()` → `adapter.get()` to return the relay-assigned ID and timestamps, and callers depend on the returned entry. The spec text was underspecified. The `types.ts` declaration (`Promise<MemoryEntry>`) is the authoritative contract and is internally consistent.

### Behavior (`memory.ts`) — PASS

All spec §3 responsibilities implemented:

| Responsibility | Status |
|---|---|
| Write with scope + provenance | Implemented correctly; `scopeToRelayAddOptions()` sets `_scopeKind`, `_updatedAt`, and all relay field mappings |
| Retrieve with expiry filter | `fetchMany()` filters by `excludeExpiredBefore`; `fetchById()` calls `isExpired()` |
| Scope query expansion (`includeNarrower`) | `expandScopes()` adds session scope only when `context.sessionId` is explicitly provided; defaults to opt-out |
| Promotion (upward only) | `promotionAllowed()` table matches spec §11; downward throws `InvalidScopePromotionError` |
| Compaction (same-scope only) | Validates non-empty sources, shared scope, matching `targetScope`; wraps callback errors in `CompactionError` |
| `deleteByScope` | Correct; returns count |
| TTL/expiry in metadata | `expiresAt` stored as `metadata.expiresAt`; filtered post-retrieval |
| Provenance metadata | `agentId`, `source`, `confidence`, `createdInSessionId`, `promotedFromId`, `compactedFromIds` all pass through via metadata merge in promotion, compaction, and write paths |
| `applyInclusionRules` toggle | Respected in `retrieve()` |

**Scope reconstruction fallback** is correct: `relayEntryToScope()` reads `_scopeKind` first, then falls back to heuristics. Resolves the reconciliation finding §2.

**Timestamp management** is correct: `_updatedAt` (ISO-8601) is set on every write and update in relay metadata; `createdAt` is derived from relay's epoch-ms `createdAt` via ISO conversion.

**Retrieval completeness caveat** is documented accurately in README and matches the implementation's over-fetch pattern (`limit × 3`, capped at 200).

---

## 2. Reuse-First Posture

**Confirmed in code.**

| Check | Result |
|---|---|
| `MemoryService` not imported | Confirmed — `memory.ts` imports only `InMemoryAdapter`, `AddMemoryOptions`, `MemoryAdapter`, `MemoryEntry` from relay |
| `createMemoryService()` not used | Confirmed |
| `adapter.search()` not called | Confirmed — `list()` is the only retrieval primitive used |
| `ContextCompactor` full strategies not used | Confirmed — no compaction engine imported; callback pattern used |
| `InMemoryAdapter` reused as test backend | Confirmed — `InMemoryMemoryStoreAdapter` wraps it |
| All storage ultimately delegates to relay adapter | Confirmed — every write/read/delete calls a relay adapter method |
| New code only where relay demonstrably does not provide the behavior | Confirmed — scope mapping, expiry, promotion, compaction, query expansion are all genuinely absent from relay |

---

## 3. Boundary Cleanliness

**OSS/cloud/librarian/relay-internal boundaries are clean.**

| Boundary | Status |
|---|---|
| No import from surfaces, routing, transport, auth | Confirmed |
| No model call inside the package | Confirmed — compaction is callback-only |
| Cloud-specific adapters (Redis, Postgres, vector DB) not present | Confirmed — no cloud code |
| Cross-agent consolidation / librarian logic | Confirmed absent |
| Provenance fields preserved for future consolidation feasibility | Confirmed — `agentId`, `source`, `confidence`, `promotedFromId`, `compactedFromIds`, `createdInSessionId` are passed through in every write path |
| `MemoryStoreAdapter` interface OSS | Confirmed — no cloud requirement in the interface |
| `InMemoryMemoryStoreAdapter` usable without any external service | Confirmed |

**One boundary issue:**
`package.json` declares `@agent-relay/hooks` as a runtime dependency, but there are zero imports of `@agent-relay/hooks` anywhere in `memory.ts`, `types.ts`, or `index.ts`. This is dead weight in the published package and violates the plan's constraint ("only `@agent-relay/memory` as runtime dep"). It must be removed before publication.

---

## 4. Test Coverage

**FAIL on count; PASS on quality and scenario coverage for tests that exist.**

The spec (§16, criterion 8) requires 40+ tests. The implementation plan (§7) specifies exactly 50 tests. The implementation delivers **14 integration tests** in `memory package v1 workflows` plus **2 adapter guardrail tests** = **16 tests total**.

### Covered Scenarios (16 tests)

| Scenario | Covered |
|---|---|
| Write and read session memory, check metadata | Yes |
| All 5 scope kinds round-trip via `get()` | Yes |
| Tag filter, `since`, `order`, `limit` | Yes |
| Expiry exclusion from both `get()` and `retrieve()` | Yes |
| `includeNarrower: true` with and without `context.sessionId` | Yes |
| Promotion: correct scope, `promotedFromId`, provenance, `deleteOriginal` | Yes |
| Downward promotion rejection | Yes |
| Compaction: `compactedFromIds`, tags, metadata, source deletion | Yes |
| Compaction callback error wrapping | Yes |
| Cross-scope compaction rejection | Yes |
| `update()`: content, tags, metadata merge, expiry clear | Yes |
| `deleteByScope()`: count and isolation | Yes |
| `applyInclusionRules: false` disables fan-out | Yes |
| Adapter validation rejects adapters without `list()`/`update()` | Yes |
| `MemoryStoreAdapter` contract shape | Yes |

### Missing Tests (vs plan §7)

The 14–16 tests cover the key success-path workflows well. What is missing:

1. **Granular type structural tests (5)** — TypeScript structural assertions confirming all required fields exist on each type. Not strictly runtime tests, but the plan included them.
2. **Individual relay adapter bridge unit tests per scope (8)** — e.g., session scope stored and reconstructed, user scope stored and reconstructed, etc. Currently these are merged into a single round-trip test. If the adapter bridge changes, failures will be harder to localize.
3. **Provenance metadata field-by-field write tests (3)** — individual tests that `write()` preserves `agentId`, `confidence`, `source` in metadata.
4. **`update()` immutability enforcement tests** — explicit tests that scope and `promotedFromId` cannot be changed via `update()`. The current `update()` implementation enforces immutability, but there is no test asserting this.
5. **Fan-out deduplication test** — no test for entries that match multiple scopes not being duplicated in results.
6. **Scope query expansion unit test** — no direct test of `expandScopes()` or `listOptionsForScope()` logic.
7. **Promotion tests for content override, tag override** — spec §8.7 defines these as explicit options; only tested via the primary success path.
8. **Compact preserves `compactedFromAgentIds` in metadata** — plan test 47.
9. **`deleteByScope()` returns 0 for empty scope** — plan test 50.
10. **`update()` throws `MemoryEntryNotFoundError` for unknown id** — important error path with no test.
11. **`promote()` throws `MemoryEntryNotFoundError` for unknown source** — plan test 41, missing.

**Bottom line on tests:** 24–34 tests short of the spec requirement. The existing 16 tests cover the happy path and key error paths for promotion and compaction well. The missing tests are mostly unit/granular tests and negative cases. The test suite as-is is not sufficient for safe product integration at the 40+ threshold the spec set.

---

## 5. Follow-Ups Required Before Product Integration

### Blocking (must fix before integration)

1. **Expand test suite to 40+ tests.** The spec requires this. At minimum: add per-scope adapter unit tests, provenance field assertions on write, `update()` immutability test, `MemoryEntryNotFoundError` paths for `update()` and `promote()`, `deleteByScope()` returning 0, and compaction preserving `compactedFromAgentIds`. Target the 50-test plan.

2. **Remove `@agent-relay/hooks` from `package.json` dependencies.** It is unused in all source files and should not be a published runtime dependency. The plan explicitly stated `@agent-relay/memory` as the only runtime dep.

### Non-Blocking Follow-Ups (can land in v1.1 or via PR comment)

3. **File consolidation note.** The implementation plan specified 7 source files (`types.ts`, `scope-mapper.ts`, `relay-adapter.ts`, `memory-store.ts`, `index.ts`, test, README). The implementation consolidates into 4 files (`types.ts`, `memory.ts`, `index.ts`, test). This consolidation is pragmatically reasonable given the actual code size (~700 lines), but the `scope-mapper.ts`, `relay-adapter.ts`, and `memory-store.ts` split was designed for readability and isolation. If `memory.ts` continues to grow, the planned split should be revisited.

4. **`MemoryStoreAdapter.insert()` spec deviation.** The spec §8.9 says `Promise<void>`; the implementation returns `Promise<MemoryEntry>`. The implementation is correct. The spec should be updated to reflect `Promise<MemoryEntry>` so future readers are not confused.

5. **Verify `createMemoryAdapter()` is not a named export from `@agent-relay/memory` or document the correct import path.** The relay `src/index.ts` exports `createMemoryAdapter` from `./factory.js`, so the README example is correct. No action needed unless the relay factory API changes.

6. **`compactedFromAgentIds` vs `compactedFromIds`** — the plan test 47 references `compactedFromAgentIds` (agent IDs of source entries' authors), but the spec's `MemoryEntry` only defines `compactedFromIds` (source entry IDs). The distinction is worth clarifying: either add a separate `compactedFromAgentIds` field to `MemoryEntry` and propagate it in `compact()`, or confirm that agent IDs are preserved via the `agentId` key in the merged source metadata (which is what the current `mergeSourceMetadata()` function would do). This is a minor spec ambiguity to clarify before v1.1.

7. **`deleteManyByScope` uses `Number.MAX_SAFE_INTEGER` as list limit.** Scopes with large numbers of entries will trigger very large relay `list()` calls. For v1 with `InMemoryAdapter` this is fine. Before `SupermemoryAdapter` production use, a paginated delete strategy should be considered.

---

## 6. Definition of Done Assessment (spec §15)

| Criterion | Met? |
|---|---|
| Capability handler can `write()` session-scoped memory | Yes |
| Same handler can `retrieve()` in next turn | Yes |
| Handler can `promote()` session → user at session end | Yes |
| Scheduled job can `compact()` with caller-provided LLM callback | Yes |
| All operations preserve provenance metadata | Yes |
| Expired entries excluded from retrieval | Yes |
| Storage backed by `@agent-relay/memory` adapters | Yes |
| **40+ tests pass** | **No — 16 tests present** |

The only failing criterion is the test count.

---

## Conclusion

The implementation is architecturally sound, spec-compliant at the behavioral level, and ready for review on all dimensions except test count. The reuse-first posture is genuine — no storage logic was duplicated, no new engines were written, and the boundaries with relay, cloud, and future consolidation concerns are cleanly maintained.

**To reach PASS:** expand the test suite to the 40+ threshold and remove the unused `@agent-relay/hooks` dependency.

V1_MEMORY_PACKAGE_REVIEW_COMPLETE
