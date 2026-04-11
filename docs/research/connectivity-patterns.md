# Connectivity Patterns Research

Date: 2026-04-11

## Purpose

This note captures the practical patterns the connectivity package should support in its first spec and implementation passes.

It is intentionally narrower than a full protocol design.

## Research Thesis

The right abstraction is not "internal agents chatting."

The right abstraction is "specialized components exchanging compact signals that help the system converge."

That framing matters because it changes design defaults:

- from transcript to delta
- from broadcast to narrowcast
- from narration to actionability
- from unlimited context to bounded payloads

## Pattern 1: Attention Raise

Use when a component finds something another component should probably consider.

Good fit:

- memory finds prior context that changes likely intent
- retrieval finds contradictory background
- monitoring finds a newly relevant event

Recommended properties:

- small summary
- explicit audience
- no full transcript
- suppress if the same attention state is already active

## Pattern 2: Confidence Gradient

Use when a component needs to tell the rest of the system how stable its local result is.

Useful outputs:

- high confidence
- medium confidence
- low confidence
- blocker uncertainty

Why this matters:

- low confidence can trigger another pass without pretending the work is finished
- blocker uncertainty can trigger route escalation instead of silent failure

## Pattern 3: Conflict Detection

Use when two active views disagree in a way that affects the final answer.

Examples:

- reviewer evidence contradicts the current draft
- memory context and live surface context diverge
- two specialists propose incompatible next actions

Recommended behavior:

- send bounded evidence
- route to coordinator first
- do not broadcast conflict to everyone unless another participant must act

## Pattern 4: Handoff Ready

Use when a downstream component can proceed without more polling.

Examples:

- planner finished a bounded plan
- reviewer completed a pass
- memory finished enrichment and synthesis can continue

Why this matters:

- it turns implicit readiness into explicit state
- it reduces repeated "are you done?" traffic

## Pattern 5: Escalation Interrupt

Use when the current path should stop or change immediately.

Examples:

- policy issue
- unsafe action recommendation
- deadline risk
- invalid assumptions discovered

Recommended behavior:

- make interrupt semantics explicit
- route to coordinator and policy gate immediately
- replace prior non-urgent state

## Pattern 6: Consensus Compression

Use when several partial findings are all pointing to the same outcome.

Instead of forwarding every intermediate agreement:

- accumulate locally
- emit one compressed consensus signal
- preserve enough provenance for the coordinator to trust the result

This is especially important in `deep` mode, where more participants may be active.

## Focused Coordination vs Chatter

The package should actively encourage focused coordination patterns.

### Focused coordination looks like

- "conflict detected, reviewer evidence contradicts planned response"
- "handoff ready, summary attached, confidence medium"
- "escalation immediate, unsafe action path"

### Generic chatter looks like

- broad status narration
- multi-topic updates
- restating local scratch work
- describing thought process without a clear action implication

The difference is not cosmetic. It determines whether the system can act quickly.

## Routing-Aware Communication

Connectivity should react to route envelope.

### `cheap`

Target behavior:

- minimal participants
- hard cap on message volume
- summarize early
- avoid optional conflict loops

### `fast`

Target behavior:

- coordinator-first updates
- aggressive narrowcast
- only interrupt-worthy changes break through

### `deep`

Target behavior:

- broader evidence gathering
- explicit conflict and consensus handling
- still bounded verbosity

Across all routes:

- quality expectations remain fixed
- policy standards remain fixed
- escalation remains available

The route changes how much process the system can afford, not how correct it is allowed to be.

## Product Lens

### Sage

Likely dominant patterns:

- attention raise
- confidence gradient
- handoff ready

Reason:

- the main need is coordinating memory, proactive context, and final synthesis without over-notifying

### MSD

Likely dominant patterns:

- conflict detection
- handoff ready
- escalation interrupt

Reason:

- review workflows need clear contradiction handling and bounded synthesis inputs

### NightCTO

Likely dominant patterns:

- coordinator narrowcast
- conflict detection
- consensus compression
- escalation interrupt

Reason:

- many-specialist operation is where chatter risk is highest and convergence discipline matters most

## Implications For Specs

The first spec should emphasize:

- small conceptual message vocabulary
- explicit audience semantics
- explicit interrupt semantics
- confidence and conflict as first-class signals
- replacement and suppression rules

The first spec should avoid:

- giant protocol surface area
- product-specific signal types
- transport-specific fields
- hosted-only assumptions

## Implications For Workflows

The first reusable workflows should be:

1. narrowcast attention
2. reviewer conflict escalation
3. specialist handoff ready
4. blocker uncertainty requesting deeper routing

Those four workflows are enough to prove the package shape without overcommitting.

## Implications For Code

The first code should be small and testable:

- signal types
- audience selection helper
- suppression and replacement helper
- in-memory dispatcher
- example tests for Sage, MSD, and NightCTO style flows

Cloud-specific delivery should remain adapter-based and out of scope for the first OSS implementation.
