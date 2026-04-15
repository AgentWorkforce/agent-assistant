# v1 Agent Inbox Review Verdict

## Verdict

Verdict: **accept this slice as a valid first bounded implementation**, with one follow-up caveat.

The slice stayed close to the implementation boundary in [docs/architecture/v1-agent-inbox-implementation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-agent-inbox-implementation-boundary.md:8). It delivers the bounded primitive that was asked for: normalized inbox types, an adapter-backed store, two pure projectors, tests, workspace wiring, and SDK exports. It does **not** pull in Relay-native transport, orchestration, or connectivity packages.

## Findings

### Medium: Relay-native separation is preserved architecturally, but only weakly enforced at write time

The boundary document says inbox is for outsiders not already on Relay and explicitly excludes Relay-native agent communication ([docs/architecture/v1-agent-inbox-implementation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-agent-inbox-implementation-boundary.md:10), [docs/architecture/v1-agent-inbox-implementation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-agent-inbox-implementation-boundary.md:26), [docs/architecture/v1-agent-inbox-implementation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-agent-inbox-implementation-boundary.md:260)). The implementation keeps that separation at the package level: `packages/inbox` imports only turn-context types and its own types, not `@agent-assistant/connectivity` or `@agent-assistant/coordination` ([packages/inbox/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/types.ts:1), [packages/inbox/src/memory-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/memory-projector.ts:1), [packages/inbox/src/enrichment-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/enrichment-projector.ts:1)).

The caveat is the runtime guard in `assertNoRelayNativeSource()`: it only rejects writes where `source.sourceId === assistantId` ([packages/inbox/src/inbox.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/inbox.ts:54)). That prevents one obvious self-loop, but it is not a reliable classifier for Relay-native traffic in general. So the slice preserves separation by architecture and policy, not by a strong boundary check. That is acceptable for v1, but the next slice should avoid overclaiming this as a hard guarantee.

### Low: validation failure is monorepo-script wiring, not inbox-package breakage

The supplied validation output reports missing root `build` and `test` scripts. That is consistent with the current root manifest, which only exposes `build:sdk` ([package.json](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/package.json:24)). The inbox package itself does build and test successfully via workspace commands. This does not block the slice review, but it does mean repo-level validation is not yet wired for this new workspace.

## Assessment

### 1. Did the slice stay bounded?

Yes, mostly.

Evidence:
- The implemented shape matches the scoped types and store contract from the boundary doc: kinds, statuses, trust metadata, scope, list filters, and adapter query shape are all present ([packages/inbox/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/types.ts:6), [packages/inbox/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/types.ts:20), [packages/inbox/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/types.ts:36), [packages/inbox/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/types.ts:75), [packages/inbox/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/types.ts:91)).
- The store remains adapter-backed and narrow: `write`, `get`, `list`, `acknowledge`, `dismiss`, and `updateStatus`, with no ingestion adapters, UI, orchestration, continuation, or platform behavior ([packages/inbox/src/inbox.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/inbox.ts:87)).
- The two projectors are pure transforms into existing turn-context candidate shapes and return `null` for dismissed/expired items as intended ([packages/inbox/src/memory-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/memory-projector.ts:46), [packages/inbox/src/enrichment-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/enrichment-projector.ts:56)).
- Tests cover the store contract and projector mappings (`39` tests passing in the inbox workspace).

Minor boundary expansion:
- The implementation adds explicit error classes and exports them through the package and SDK ([packages/inbox/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/types.ts:113), [packages/sdk/src/index.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/sdk/src/index.ts:97)). These are reasonable and still within the primitive, but they were not called out in the original boundary document.

### 2. Is the inbox shape useful?

Yes.

Why it is useful:
- `InboxItem` carries the minimum fields needed for downstream product decisions without forcing a transport-specific model: addressability (`assistantId`), lifecycle (`status`), provenance/trust (`source`), content (`content`, `structured`, `title`), and targeting (`scope`) ([packages/inbox/src/types.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/types.ts:36)).
- The trust model is directly consumable by projection logic. The memory projector converts trust into numeric relevance and freshness; the enrichment projector converts it into importance and confidence ([packages/inbox/src/memory-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/memory-projector.ts:35), [packages/inbox/src/enrichment-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/enrichment-projector.ts:34), [packages/inbox/src/enrichment-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/enrichment-projector.ts:45)).
- The scope mapping is simple and compatible with existing `TurnMemoryCandidate` scope values, which makes the projection actually usable in the current turn-context system rather than inventing a parallel shape ([packages/inbox/src/memory-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/memory-projector.ts:19)).
- The projector metadata preserves inbox provenance (`kind`, `assistantId`, `trustLevel`, `threadId`) so products can later distinguish inbox-derived candidates from native memory or other enrichments ([packages/inbox/src/memory-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/memory-projector.ts:60), [packages/inbox/src/enrichment-projector.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/enrichment-projector.ts:73)).

Net: this is a useful, composable v1 shape. It is broad enough for imported chats, forwarded messages, transcripts, and memos without collapsing back into transport-specific schemas.

### 3. Does it preserve separation from Relay-native communication?

Yes at the module boundary, partially at runtime policy.

What is preserved:
- No imports from Relay-native coordination or connectivity packages were introduced in the inbox package.
- The README and boundary doc both keep the product story explicit: inbox is for external inputs, not agent-to-agent relay traffic ([packages/inbox/README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/README.md:3), [packages/inbox/README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/README.md:13)).
- The projectors target turn-context candidates only; they do not dispatch, signal, wake, or orchestrate anything.

What is not fully preserved:
- The runtime check for Relay-native misuse is only `sourceId === assistantId` ([packages/inbox/src/inbox.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/inbox/src/inbox.ts:54)). That is a narrow heuristic, not a robust Relay-native boundary.

Conclusion:
- Separation is preserved well enough for this bounded slice because the package does not overlap with Relay-native communication concerns.
- The next iteration should keep the architectural separation and either remove the implication of hard enforcement or introduce a stronger product-owned source-classification seam.

### 4. What is the next continuation point?

The next continuation point should be **product-side composition, not inbox-package expansion**.

Recommended next step:
- Add one thin integration example or package-level proof showing how a product queries pending inbox items, projects them into `TurnContextInput.memory.candidates` and `TurnContextInput.enrichment.candidates`, then acknowledges or marks them projected after a successful turn. That is the exact composition path the boundary doc describes and is the missing bridge between primitive and usage ([docs/architecture/v1-agent-inbox-implementation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-agent-inbox-implementation-boundary.md:267)).

Secondary cleanup to do alongside that:
- Add root-level `build` and `test` scripts, or update validation to run workspace-specific commands, so slice validation is meaningful for new packages.
- Decide whether `InboxRelayNativeSourceError` should remain as a documented soft guard or evolve into a stronger product-configurable classification seam.

## Validation Notes

Observed validation input:
- Root `npm run build` failed because the root manifest has no `build` script.
- Root `npm run test` failed because the root manifest has no `test` script.

Additional verification performed during review:
- `npm run build -w @agent-assistant/inbox` passed.
- `npm run test -w @agent-assistant/inbox` passed with `39/39` tests passing.

## Summary

This review read the boundary doc, inspected the inbox package and SDK export changes, checked the supplied validation failure, and verified the inbox workspace directly. The slice is accepted as a good bounded v1 primitive. The inbox shape is useful, the separation from Relay-native communication is preserved architecturally, and the clearest continuation point is product-side turn-context composition plus repo-level validation wiring.

V1_AGENT_INBOX_REVIEW_COMPLETE
