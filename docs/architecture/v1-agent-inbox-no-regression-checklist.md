# v1 Agent Inbox No-Regression Checklist

**Date:** 2026-04-15
**Status:** IMPLEMENTATION-READY

## Purpose

This checklist ensures the Agent Inbox implementation does not regress existing primitives or blur architectural boundaries.

---

## Relay-native communication boundary

- [ ] `packages/inbox/` does NOT import from `@agent-assistant/connectivity`
- [ ] `packages/inbox/` does NOT import from `@agent-assistant/coordination`
- [ ] `packages/inbox/` does NOT import from `@agent-assistant/routing`
- [ ] No inbox type appears in any Relay-native communication path
- [ ] No Relay-native agent identity type is used as an inbox source
- [ ] Tests assert that inbox items with `sourceId` matching a Relay-native agent identity are rejected or flagged

## Core runtime isolation

- [ ] `@agent-assistant/core` has zero new imports from `@agent-assistant/inbox`
- [ ] `InboundMessage` type is unchanged
- [ ] `AssistantRuntime` interface is unchanged
- [ ] `AssistantDefinition` interface is unchanged
- [ ] Core dispatch loop has zero inbox awareness

## Turn-context type stability

- [ ] `TurnMemoryCandidate` interface is unchanged in `@agent-assistant/turn-context`
- [ ] `TurnEnrichmentCandidate` interface is unchanged in `@agent-assistant/turn-context`
- [ ] `TurnContextInput` interface is unchanged
- [ ] `TurnContextAssembly` interface is unchanged
- [ ] Inbox projectors produce values conforming to existing turn-context types without modification

## Memory type stability

- [ ] `MemoryEntry` interface is unchanged in `@agent-assistant/memory`
- [ ] `MemoryStore` interface is unchanged
- [ ] `MemoryScope` type is unchanged
- [ ] `WriteMemoryInput` interface is unchanged
- [ ] No new memory scope kind is introduced for inbox items

## Continuation isolation

- [ ] `packages/inbox/` does NOT import from `@agent-assistant/continuation`
- [ ] No inbox type appears in continuation types
- [ ] `ContinuationRecord` is unchanged
- [ ] `ContinuationResumeTrigger` is unchanged

## Session and surface isolation

- [ ] `packages/inbox/` does NOT import from `@agent-assistant/sessions`
- [ ] `packages/inbox/` does NOT import from `@agent-assistant/surfaces`
- [ ] `Session` type is unchanged
- [ ] `SurfaceConnection` type is unchanged

## Policy and proactive isolation

- [ ] `packages/inbox/` does NOT import from `@agent-assistant/policy`
- [ ] `packages/inbox/` does NOT import from `@agent-assistant/proactive`
- [ ] No inbox-specific policy rules are introduced in this slice
- [ ] No inbox-specific proactive wake rules are introduced in this slice

## Trust model correctness

- [ ] `InboxSourceTrust.trustLevel` is product-assigned, not self-declared
- [ ] Trust levels map deterministically to relevance/confidence scores in projectors
- [ ] No trust level grants automatic memory persistence
- [ ] No trust level grants automatic turn-context injection

## Projector purity

- [ ] `InboxToMemoryProjector.project()` is a pure function (no side effects, no I/O)
- [ ] `InboxToEnrichmentProjector.project()` is a pure function (no side effects, no I/O)
- [ ] Projectors return `null` for dismissed or expired items
- [ ] Projectors do not call `MemoryStore.write()` or any store method
- [ ] Projectors do not call `InboxStore.updateStatus()` or any store method

## Store contract compliance

- [ ] `InboxStore` follows the adapter-backed pattern from `@agent-assistant/memory`
- [ ] `InboxStoreAdapter` is the only persistence seam
- [ ] `InboxStore.write()` generates a unique `id` and sets `receivedAt` / `updatedAt`
- [ ] `InboxStore.acknowledge()` transitions status from `pending` to `acknowledged`
- [ ] `InboxStore.dismiss()` transitions status to `dismissed`
- [ ] Store rejects invalid status transitions
- [ ] Expired items are excluded from `list()` queries by default

## SDK re-export correctness

- [ ] `packages/sdk/src/index.ts` re-exports only public inbox API
- [ ] No internal inbox types leak through the SDK surface
- [ ] Existing SDK re-exports are unchanged

## Test coverage

- [ ] Store contract compliance tests pass with an in-memory adapter
- [ ] Memory projector tests cover all `InboxItemKind` values
- [ ] Enrichment projector tests cover all `InboxItemKind` values
- [ ] Projector tests cover all three trust levels
- [ ] Projector tests verify `null` return for dismissed/expired items
- [ ] No existing test file is modified
- [ ] All existing tests continue to pass (`npm test` at root)

## Package structure

- [ ] `packages/inbox/package.json` follows the naming convention `@agent-assistant/inbox`
- [ ] `packages/inbox/tsconfig.json` follows the existing package tsconfig pattern
- [ ] `packages/inbox/` is added to root `package.json` workspaces
- [ ] `packages/inbox/` is added as a dependency in `packages/sdk/package.json`
