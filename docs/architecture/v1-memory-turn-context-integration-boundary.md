# v1 Memory → Turn-Context Integration Boundary

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-14

## Purpose
Define the first bounded memory integration slice for Agent Assistant now that `@agent-assistant/memory` already exists as a reuse-first composition layer over `@agent-relay/memory`.

This slice does **not** build a new memory package. It proves that real memory can be retrieved and projected into turn-context in a truthful, bounded, testable way.

## Why this slice exists
The assistant runtime already has:
- `@agent-assistant/memory`
- `@agent-assistant/turn-context`
- `@agent-assistant/harness`
- `@agent-assistant/continuation`

The current gap is not storage. The gap is **runtime wiring**:
- retrieving bounded memory candidates for a turn
- projecting those candidates into `TurnMemoryInput`
- carrying them into `TurnContextAssembly`
- proving that downstream execution used real persistent memory candidates rather than only thread/window continuity

## In scope
This slice should implement only:
1. a narrow memory retrieval seam for turn assembly
2. mapping `MemoryEntry[]` into `TurnMemoryCandidate[]`
3. a turn-context-friendly integration helper/factory
4. bounded tests proving retrieval and projection behavior
5. docs describing the integration contract and its limits

## Out of scope
This slice must not implement:
- automatic memory writes
- semantic memory search
- librarian / cross-agent consolidation
- contradiction resolution or memory reconciliation
- policy-gated memory access control
- cloud-only memory infrastructure
- product-specific write heuristics
- broad Sage product integration in the same slice

## Recommended package placement
Keep this work inside `@agent-assistant/turn-context` for now.

Rationale:
- the immediate need is turn-scoped retrieval + projection
- the integration belongs at the turn assembly seam
- we do not need a new public package for this first proof
- extraction can be revisited later if retrieval/orchestration grows meaningfully beyond turn-context needs

## Required contract

### New retrieval-facing interface
```ts
export interface TurnMemoryRetriever {
  retrieve(input: TurnMemoryRetrievalInput): Promise<TurnMemoryCandidate[]>;
}

export interface TurnMemoryRetrievalInput {
  assistantId: string;
  turnId: string;
  sessionId?: string;
  userId?: string;
  threadId?: string;
  query?: string;
  limit?: number;
  metadata?: Record<string, unknown>;
}
```

### Adapter/factory helper
Provide a helper that adapts `MemoryStore` retrieval output into `TurnMemoryCandidate[]`.

Expected shape:
```ts
createMemoryTurnRetriever(options: {
  store: MemoryStore;
  defaultLimit?: number;
  includeSessionScope?: boolean;
  includeUserScope?: boolean;
  includeWorkspaceScope?: boolean;
  workspaceIdResolver?: (input: TurnMemoryRetrievalInput) => string | undefined;
  queryTagger?: (input: TurnMemoryRetrievalInput) => string[] | undefined;
}): TurnMemoryRetriever
```

## Retrieval rules for this first slice
1. Keep retrieval structured and bounded.
2. Prefer session scope first when `sessionId` is present.
3. Optionally include user scope when `userId` is present.
4. Include workspace scope only if explicitly configured.
5. Use `limit` defensively.
6. Do not invent semantic search if not already supported by `MemoryStore`.
7. Preserve provenance from `MemoryEntry.metadata` into `TurnMemoryCandidate.metadata`.
8. Map recency into turn-context freshness values when possible.

## Turn-context integration shape
Add an optional retrieval seam to turn-context assembly so product/runtime code can say:
- here is the turn
- retrieve bounded memory candidates now
- then continue with normal assembly

Recommended addition:
```ts
export interface CreateTurnContextAssemblerOptions {
  memoryRetriever?: TurnMemoryRetriever;
}
```

Assembly behavior:
- if `input.memory?.candidates` is already present, use them directly
- else, if `options.memoryRetriever` exists, retrieve candidates from it
- else, assemble without memory candidates

This preserves product control while making real memory retrieval possible.

## Minimum tests required
1. memory retriever maps `MemoryEntry` into `TurnMemoryCandidate`
2. retriever uses session scope when session id is present
3. retriever can include user scope when configured
4. assembler uses provided memory candidates without calling retriever
5. assembler calls retriever when memory candidates are absent
6. assembler remains valid when no retriever exists
7. candidate provenance survives into assembly provenance/context blocks

## Follow-up after this slice
After this slice lands, the next proving step should be product integration, likely in Sage:
- wire bounded memory retrieval into the client-chat harness path
- test whether the assistant behaves more continuous/truthful
- only then consider write heuristics or broader lifecycle work

V1_MEMORY_TURN_CONTEXT_INTEGRATION_BOUNDARY_READY
