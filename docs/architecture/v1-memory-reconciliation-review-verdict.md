# v1 Memory Reconciliation Review Verdict

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Scope reviewed:** `docs/architecture/v1-memory-review-verdict.md`, `docs/architecture/v1-memory-reconciliation-plan.md`, `docs/specs/v1-memory-spec.md`, `docs/architecture/v1-memory-implementation-plan.md`, `docs/research/memory-reuse-investigation.md`, `packages/memory/README.md`, `../relay/packages/memory/src/index.ts`, plus referenced relay implementation files needed to verify claims: `../relay/packages/memory/src/types.ts`, `../relay/packages/memory/src/service.ts`, `../relay/packages/memory/src/factory.ts`, `../relay/packages/memory/src/adapters/inmemory.ts`, `../relay/packages/memory/src/adapters/supermemory.ts`

## Findings

### 1. The docs are now much closer to the real relay surface, but they still overstate timestamp support
Severity: medium

- The reconciliation correctly removes `MemoryService` from the bridge path and correctly switches v1 retrieval from `search()` to `list()`.
- That part matches the real relay surface in `types.ts`, `service.ts`, `inmemory.ts`, and `supermemory.ts`.
- But the implementation plan still translates relay entries using `relayEntry.updatedAt`, while relay `MemoryEntry` has `createdAt` and optional `lastAccessedAt`, not `updatedAt`.
- `SupermemoryAdapter` also drops upstream `updatedAt` when mapping API documents into relay `MemoryEntry`, so the assistant layer cannot rely on relay to provide an update timestamp today.

Impact: the assistant package can still expose `updatedAt`, but the docs must define how it is sourced, most likely by storing an assistant-managed `metadata.updatedAt` on write/update. As written, the translation contract is not exact yet.

### 2. Scope reconstruction order is still risky for entries that carry both session and project context
Severity: medium

- The implementation plan's `deriveScope()` priority reconstructs `workspace` before `session`.
- Relay entries can legitimately contain both `projectId` and `sessionId` because `AddMemoryOptions` supports both, and `MemoryService`/factory defaults encourage combined context.
- A session-scoped assistant entry written with project context could therefore round-trip back as `workspace` scope under the documented reconstruction order.

Impact: this is implementable, but only if the docs pin a canonical discriminator in metadata or tighten the reconstruction rules. Without that, exact scope round-tripping is not guaranteed.

### 3. The README production example is still wrong about adapter construction
Severity: low

- `createMemoryAdapter()` is async in relay `factory.ts`.
- `packages/memory/README.md` shows `const relayAdapter = createMemoryAdapter(...)` without `await`.

Impact: small, but this is precisely the kind of copy-paste error that will slow the first implementation or integration pass.

### 4. Search and adapter assumptions are now mostly implementable, with one realism caveat on retrieval completeness
Severity: low

- The corrected docs now properly treat `list()` and `update()` as required optional methods that must be validated at bridge construction.
- That is consistent with the current `InMemoryAdapter` and `SupermemoryAdapter`, both of which implement `list()` and `update()`.
- The remaining caveat is that structured retrieval depends on bounded over-fetch from `list()`, followed by assistant-side filtering on metadata, tags, time, and expiry.
- That is implementable, but not completeness-preserving for large datasets unless the caller accepts that v1 is best-effort recency retrieval rather than exhaustive structured query over all stored entries.

Impact: acceptable for v1 if stated plainly. The docs currently imply this, but they should be explicit that `list()`-based retrieval is recency-biased and may need pagination or stronger backend filtering in a future version.

## Assessment Against Requested Questions

### 1. Do the docs now match the actual `@agent-relay/memory` surface closely enough?
Yes, closely enough for implementation start, but not perfectly.

The major mismatches from the earlier review are fixed: `MemoryService` is no longer the bridge target, `MemorySearchQuery` is no longer treated as the v1 retrieval primitive, and the optional relay methods are now treated as capabilities that must be validated. The remaining mismatch is timestamp/round-trip precision, especially `updatedAt` and scope reconstruction.

### 2. Is the reuse-first posture still clear and realistic?
Yes.

This is the strongest part of the reconciled set. The docs consistently preserve the right boundary: relay owns storage and backend integration; the assistant package owns scope semantics, promotion, compaction orchestration, expiry filtering, and type translation. No greenfield backend or search engine work has crept back in.

### 3. Are the search and adapter assumptions now implementable?
Mostly yes.

The `list()`-plus-filtering path is implementable against the real adapters, and the direct-`MemoryAdapter` bridge is the correct correction. What still needs tightening is:

1. Define assistant-managed `updatedAt` explicitly.
2. Define an unambiguous scope discriminator so entries round-trip correctly.
3. State that `list()`-based retrieval is recency-biased and not a full structured-index query.

### 4. Is the package ready for the actual implementation workflow next?
Yes, with follow-ups.

It is ready for the workflow to start, but not ready to treat every current doc detail as executable truth. The next workflow should either fix the remaining doc issues first or resolve them in the first implementation commit before code fans out across multiple files.

## Final Verdict

`PASS_WITH_FOLLOWUPS` is the correct outcome.

The reconciliation materially improved the doc set and removed the most important architectural mismatches. The remaining issues are not strategy blockers; they are implementation-contract details that still need to be made explicit so the first coding pass does not invent behavior ad hoc.

## Required Follow-Ups Before or At WF-5 Start

1. Define the source of assistant `updatedAt` explicitly. Do not reference `relayEntry.updatedAt` unless the assistant bridge writes and reads it from metadata by contract.
2. Add an explicit scope discriminator in relay metadata, or revise `deriveScope()` precedence so session entries cannot be misclassified when `projectId` is also present.
3. Fix the README production example to `await createMemoryAdapter(...)`.
4. State clearly in spec/plan/README that v1 structured retrieval is recency-biased over `list()` results with assistant-side filtering, not a guaranteed exhaustive query over all stored entries.

Artifact produced: `docs/architecture/v1-memory-reconciliation-review-verdict.md`

V1_MEMORY_RECONCILIATION_REVIEW_COMPLETE
