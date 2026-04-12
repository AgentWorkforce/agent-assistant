# v1 Memory Review Verdict

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Scope reviewed:** `docs/architecture/v1-memory-scope.md`, `docs/specs/v1-memory-spec.md`, `docs/architecture/v1-memory-implementation-plan.md`, `docs/research/memory-reuse-investigation.md`, `packages/memory/README.md`, `../relay/packages/memory/src/index.ts`, `../relay/packages/memory/src/types.ts`, `../relay/packages/memory/src/service.ts`, `../relay/packages/memory/src/adapters/inmemory.ts`, `../relay/packages/memory/src/adapters/supermemory.ts`, `../relay/packages/memory/package.json`

## Findings

### 1. The implementation plan overstates fit with Relay's current service/search APIs
Severity: medium

- The spec and plan treat relay `MemorySearchQuery` as the direct basis for v1 structured retrieval and multi-scope expansion ([v1-memory-spec.md](./v1-memory-spec.md:74), [v1-memory-implementation-plan.md](./v1-memory-implementation-plan.md:110), [memory-reuse-investigation.md](../research/memory-reuse-investigation.md:26)).
- In the real relay package, `MemorySearchQuery` requires a semantic `query: string` field and only natively filters `agentId`, `projectId`, tags, and time ([../relay/packages/memory/src/types.ts](../../../relay/packages/memory/src/types.ts:39)).
- The in-memory adapter's `search()` is content-match driven and returns results only when score > 0, so a purely structured retrieval path is not actually defined yet ([../relay/packages/memory/src/adapters/inmemory.ts](../../../relay/packages/memory/src/adapters/inmemory.ts:80)).
- The supermemory adapter is likewise query-text driven and defaults `minScore` to `0.5` ([../relay/packages/memory/src/adapters/supermemory.ts](../../../relay/packages/memory/src/adapters/supermemory.ts:156)).

Impact: the reuse-first posture is still realistic, but the docs are not yet precise enough about how v1 structured retrieval avoids depending on semantic query behavior. The next workflow should first pin one bridge strategy: either use `list/get/clear` plus assistant-side filtering for v1 structured retrieval, or define an explicit sentinel query contract and verify it against both relay adapters.

### 2. `RelayMemoryStoreAdapter` cannot be implemented exactly as described on top of `MemoryService` alone
Severity: medium

- The plan says `RelayMemoryStoreAdapter` wraps `MemoryService` ([v1-memory-implementation-plan.md](./v1-memory-implementation-plan.md:163)).
- But `MemoryService` only exposes `add`, `search`, `delete`, `list`, and `isAvailable` ([../relay/packages/memory/src/types.ts](../../../relay/packages/memory/src/types.ts:200), [../relay/packages/memory/src/service.ts](../../../relay/packages/memory/src/service.ts:85)).
- The assistant store contract needs `fetchById`, `update`, and `deleteManyByScope` equivalents ([v1-memory-spec.md](./v1-memory-spec.md:328), [v1-memory-implementation-plan.md](./v1-memory-implementation-plan.md:220)).

Impact: the boundary is still valid, but the bridge should target the underlying relay `MemoryAdapter` for some operations, not `MemoryService` alone. This is a documentation correction, not a reason to change direction.

### 3. `includeNarrower` is underspecified for user-scope queries
Severity: low

- The spec says user-scope retrieval may include session memories "when `sessionId` provided" ([v1-memory-spec.md](./v1-memory-spec.md:185)).
- The README says session context is "derived from the scope or query context" ([README.md](../../packages/memory/README.md:148)).
- But `MemoryQuery` does not carry a session context outside the primary `scope` ([v1-memory-spec.md](./v1-memory-spec.md:292)).

Impact: this is a workflow-level ambiguity. The docs should either add explicit session context to `MemoryQuery`, or state that `includeNarrower` from `user` to `session` is only available when the primary scope itself is `session`.

### 4. The "no new adapters" language is directionally right but mechanically imprecise
Severity: low

- The scope, investigation, and plan correctly reject new storage backends and greenfield memory infrastructure ([v1-memory-scope.md](./v1-memory-scope.md:195), [memory-reuse-investigation.md](../research/memory-reuse-investigation.md:211), [README.md](../../packages/memory/README.md:14)).
- The plan still introduces assistant-side bridge classes (`InMemoryMemoryStoreAdapter`, `RelayMemoryStoreAdapter`) ([v1-memory-implementation-plan.md](./v1-memory-implementation-plan.md:151)).

Impact: this is mostly wording. The intent is clear: no new storage backend or search engine. Tightening that phrasing will prevent future reviewers from reading it as a contradiction.

## Assessment Against Requested Questions

### 1. Is the reuse-first posture over `@agent-relay/memory` clear and realistic?
Yes.

The posture is very clear across all documents and correctly grounded in the actual relay package export surface ([../relay/packages/memory/src/index.ts](../../../relay/packages/memory/src/index.ts:24), [../relay/packages/memory/package.json](../../../relay/packages/memory/package.json:2)). It is also realistic as long as the implementation workflow explicitly accounts for the semantic-first shape of relay search and the thinner-than-assumed `MemoryService` API.

### 2. Is the assistant-memory package boundary well-defined?
Mostly yes.

The ownership boundary is strong: assistant memory owns scopes, promotion, compaction orchestration, TTL filtering, and assistant-facing types, while relay owns persistence and backend integration ([v1-memory-spec.md](./v1-memory-spec.md:44), [v1-memory-scope.md](./v1-memory-scope.md:147)). The only boundary cleanup needed is clarifying that some bridge operations must use the underlying relay adapter rather than `MemoryService` alone.

### 3. Is greenfield memory work being avoided where Relay memory already suffices?
Yes.

The docs consistently avoid inventing a new backend, search engine, compactor, or lifecycle system. The proposed new work is limited to assistant-domain semantics that relay does not already provide: scope mapping, fan-out, promotion, compaction orchestration, expiry filtering, and type translation.

### 4. Is librarian/cross-agent consolidation correctly deferred to v5-v8 while preserving future-enabling metadata requirements?
Yes.

This is one of the strongest parts of the set. The deferral is explicit, and the metadata preservation requirements are concrete enough to keep v1 future-compatible without pulling consolidation logic forward ([v1-memory-scope.md](./v1-memory-scope.md:130), [v1-memory-spec.md](./v1-memory-spec.md:151), [README.md](../../packages/memory/README.md:217)).

### 5. Is this strong enough to directly drive the next memory implementation workflow?
Almost, but not as-is.

It is strong enough to start implementation immediately if the workflow begins with two short doc corrections:

1. Lock the retrieval bridge strategy for structured v1 queries against the real relay APIs.
2. Change the plan to state that `RelayMemoryStoreAdapter` uses relay `MemoryAdapter` capabilities directly where `MemoryService` is insufficient.

Without those corrections, the next implementation workflow risks either stalling on API mismatch or silently inventing behavior that the current spec does not describe.

## Final Verdict

`PASS_WITH_FOLLOWUPS` is the correct outcome.

The architectural direction is sound, reuse-first is clear, greenfield work is appropriately constrained, and the v5-v8 librarian deferral is handled correctly. The remaining issues are implementation-contract precision issues, not strategy failures. Fix those before treating the implementation plan as exact.

## Required Follow-Ups Before or At WF-5 Start

1. Amend the spec/plan to define the exact retrieval path for structured queries over relay adapters.
2. Amend the plan to use the underlying relay `MemoryAdapter` where `MemoryService` lacks required operations.
3. Resolve the `includeNarrower` session-context gap in the public `MemoryQuery` contract or narrow the feature.
4. Replace "no new adapters" with "no new storage backends or search engines" to match the planned bridge classes.

Artifact produced: `docs/architecture/v1-memory-review-verdict.md`

V1_MEMORY_REVIEW_COMPLETE
