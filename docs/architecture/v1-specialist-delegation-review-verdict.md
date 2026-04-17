# V1 Specialist Delegation Review Verdict

Date: 2026-04-16

## Verdict

`PASS_WITH_FOLLOWUPS`

The proposed v1 design is directionally correct and is strong on the core architectural questions this review was asked to assess:

- Relay-native agent-to-agent communication is treated as a real request/response boundary, not an in-process abstraction shortcut.
- RelayFile is positioned as durable shared evidence/state, distinct from ephemeral coordination chatter.
- The GitHub specialist is mostly bounded as a reusable investigation worker rather than Sage-only prompt glue.
- The Sage versus Agent Assistant split is generally clear and defensible.
- The intended v1 slice is narrow and implementation-oriented.

The reason this is not a clean `PASS` is not architectural sprawl. It is internal contract drift across the docs that should be normalized before implementation begins.

## Assessment Against Requested Questions

### 1. Is Relay-native agent-to-agent communication truly first-class?

Yes.

The strongest evidence is in the boundary and exchange docs:

- The design explicitly says coordinator and specialist are separate Relay-connected agents communicating via Relay messages, not internal function calls: [v1-specialist-delegation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-boundary.md:292), [v1-specialist-delegation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-boundary.md:304).
- The wire format is defined around Relay message envelopes and correlation via `requestId`/Relay `threadId`: [v1-agent-to-agent-evidence-exchange.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-agent-to-agent-evidence-exchange.md:44).
- The Sage adoption map and GitHub specialist boundary both frame the proving path as coordinator-to-specialist Relay exchange, not SDK-local invocation: [v1-sage-specialist-adoption-map.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-sage-specialist-adoption-map.md:22), [v1-github-investigation-specialist-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-github-investigation-specialist-boundary.md:237).

This is first-class in the right sense: Relay is the runtime boundary, while `DelegationTransport` is an SDK boundary that prevents shared packages from importing Relay directly.

Follow-up required:

- The wire protocol says every payload has a discriminator `type` field, but the core `DelegationRequest` and `SpecialistFindings` interfaces shown in the boundary doc do not include that field: [v1-agent-to-agent-evidence-exchange.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-agent-to-agent-evidence-exchange.md:61), [v1-specialist-delegation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-boundary.md:66), [v1-specialist-delegation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-boundary.md:104).
- `threadId` semantics are inconsistent. `DelegationRequest.threadId` is documented as coordinator turn context, while the proof plan and wire format also require Relay `threadId == requestId`: [v1-specialist-delegation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-boundary.md:73), [v1-agent-to-agent-evidence-exchange.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-agent-to-agent-evidence-exchange.md:59), [v1-specialist-delegation-proof-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-proof-plan.md:128).

### 2. Is relayfile used as durable shared evidence/state, rather than just extra chat context?

Yes.

The RelayFile contract is substantially better than “extra prompt stuffing”:

- It clearly separates ephemeral evidence from durable artifacts and gives concrete storage guidance by size and reuse value: [v1-relayfile-backed-evidence-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-relayfile-backed-evidence-contract.md:13).
- Durable artifacts are path-scoped, correlated to request/evidence IDs, and backed by a required manifest: [v1-relayfile-backed-evidence-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-relayfile-backed-evidence-contract.md:47), [v1-relayfile-backed-evidence-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-relayfile-backed-evidence-contract.md:76).
- The docs explicitly distinguish synced provider source data under `/github/...` from specialist-produced investigation artifacts under `/evidence/...`: [v1-relayfile-backed-evidence-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-relayfile-backed-evidence-contract.md:231).
- The model supports coordinator reuse, later specialist reuse, inbox promotion, and memory promotion of derived insights without confusing any of those with raw chat history: [v1-relayfile-backed-evidence-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-relayfile-backed-evidence-contract.md:280).

This is a durable shared evidence/state design, not an “append more text to context” design.

Follow-up required:

- The manifest path convention and the example implementation disagree. The convention says `/evidence/{assistantId}/{requestId}/manifest.json`, but the example writes `/evidence/${findings.requestId}/manifest.json`: [v1-relayfile-backed-evidence-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-relayfile-backed-evidence-contract.md:78), [v1-relayfile-backed-evidence-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-relayfile-backed-evidence-contract.md:184).
- The example manifest writer reads `findings.metadata?.assistantId`, but `assistantId` is not part of the published `FindingsMetadata` contract: [v1-specialist-delegation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-boundary.md:154), [v1-relayfile-backed-evidence-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-relayfile-backed-evidence-contract.md:186).

### 3. Is the GitHub specialist bounded and reusable, rather than Sage-specific prompt glue?

Mostly yes.

What is good:

- The capability table is investigation-focused and excludes writing, merge decisions, triage policy, and arbitrary cross-provider work: [v1-github-investigation-specialist-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-github-investigation-specialist-boundary.md:13).
- SDK versus product ownership is called out cleanly. Shared contracts stay in Agent Assistant; agent registration, routing, prompts, VFS/API integration, and synthesis stay product-owned in Sage: [v1-github-investigation-specialist-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-github-investigation-specialist-boundary.md:190), [v1-sage-specialist-adoption-map.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-sage-specialist-adoption-map.md:82).
- The doc explicitly explains how MSD and NightCTO could reuse the same contract surface with different product logic: [v1-github-investigation-specialist-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-github-investigation-specialist-boundary.md:215).

What needs tightening:

- The reusable boundary is clean, but the specialist capability surface is broader than the proof slice. v1 proof is supposed to stay fixed on `pr_investigation`, yet the specialist doc and migration section already lean into `issue_investigation`, `code_search`, `file_read`, and `repo_exploration`: [v1-specialist-delegation-proof-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-proof-plan.md:99), [v1-github-investigation-specialist-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-github-investigation-specialist-boundary.md:17), [v1-github-investigation-specialist-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-github-investigation-specialist-boundary.md:247).

This is still reusable rather than Sage-specific glue, but the v1 document set should explicitly mark all non-`pr_investigation` capabilities as dormant/future to avoid implementation spread.

### 4. Is the Sage vs Agent Assistant split clear and defensible?

Yes.

The split is one of the strongest parts of the proposal:

- Agent Assistant owns contracts, projection helpers, and test harnesses, but not Relay SDK clients, RelayFile clients, product routing heuristics, or synthesis policy: [v1-specialist-delegation-boundary.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-boundary.md:32), [v1-sage-specialist-adoption-map.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-sage-specialist-adoption-map.md:108).
- Sage owns proving, specialist behavior, VFS/API access policy, fallback behavior, and rollout timing: [v1-sage-specialist-adoption-map.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-sage-specialist-adoption-map.md:96).
- The no-shortcuts checklist reinforces the same boundary and explicitly blocks product-policy leakage into shared packages: [v1-specialist-delegation-no-shortcuts-checklist.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-no-shortcuts-checklist.md:13).

This is defensible because it extracts only contract-shaped substrate after Sage proves value, instead of pretending a generic framework already exists.

### 5. Is the v1 slice tight enough to implement without architectural sprawl?

Yes, with one caution.

The intended v1 slice is tight:

- one coordinator
- one GitHub specialist
- one request/response cycle
- one proving capability: `pr_investigation`
- optional durable evidence
- explicit fallback to Sage’s current inline path

That is consistent across the adoption map, proof plan, and no-shortcuts checklist: [v1-sage-specialist-adoption-map.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-sage-specialist-adoption-map.md:49), [v1-specialist-delegation-proof-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-proof-plan.md:99), [v1-specialist-delegation-no-shortcuts-checklist.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-specialist-delegation-no-shortcuts-checklist.md:23).

The caution is that some companion text still pulls wider than the proof plan:

- the GitHub specialist capability table is broad
- the migration section says Phase 1 includes `issue_investigation`
- the adoption map mentions issue investigation as the second target

That is not yet sprawl, but it is where sprawl would enter if the implementation starts from the broadest doc instead of the proof plan.

### 6. Is this PASS, PASS_WITH_FOLLOWUPS, or FAIL?

`PASS_WITH_FOLLOWUPS`

This should move forward, but only after a short doc normalization pass resolves the contract inconsistencies below.

## Required Follow-Ups Before Implementation

1. Normalize the wire payload contract.
The docs need one explicit choice:
- either add `type` to `DelegationRequest` and `SpecialistFindings`
- or define a Relay message envelope type that wraps those payloads

2. Normalize `threadId` semantics.
The docs currently overload two meanings:
- conversation/turn thread context inside the request
- Relay transport correlation thread on the message envelope

Rename one of them or remove the inner `threadId` from the request contract.

3. Fix the RelayFile manifest path inconsistency.
Every example and validation gate should use the same path:
- `/evidence/{assistantId}/{requestId}/manifest.json`

4. Fix the manifest writer metadata dependency.
If `assistantId` is required to write the manifest, it must be available from a published contract, not inferred from an undocumented `findings.metadata.assistantId`.

5. Freeze the v1 proving capability to `pr_investigation` everywhere.
Keep `issue_investigation`, `code_search`, `file_read`, and `repo_exploration` documented as future capability shapes, but mark them out of active v1 implementation scope.

## Final Review Summary

The design passes the architectural bar for a v1 proof. It is Relay-native in the right place, RelayFile is being used as durable evidence/state instead of chat padding, the GitHub specialist boundary is reusable, and the Sage versus Agent Assistant ownership line is clear.

The remaining work is a spec consistency cleanup, not a redesign.

V1_SPECIALIST_DELEGATION_REVIEW_COMPLETE
