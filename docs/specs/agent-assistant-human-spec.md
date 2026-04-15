# Agent Assistant Human Spec (v1)

**Date:** 2026-04-15
**Status:** HUMAN-READABLE REFERENCE

## Purpose

This document is the quick human-readable spec for Agent Assistant.

It is meant to answer:
- what Agent Assistant is supposed to do
- what constraints it should preserve
- what knobs a human builder/operator should be able to tune
- what boundaries it should not cross

This is intentionally list-like and fast to scan.

---

# 1. What Agent Assistant is

Agent Assistant is a reusable runtime substrate for productized assistants.

It should provide:
- stable assistant identity
- bounded turn execution
- turn-scoped context assembly
- policy-aware behavior
- continuation/follow-up support
- proactive initiation support
- memory retrieval integration
- Relay-native collaboration support
- execution-plane flexibility (BYOH)

It is **not** meant to be only a chatbot wrapper.

---

# 2. What Agent Assistant must support

## Identity and behavior
- stable assistant identity floor
- product-owned personality/behavior shaping
- tunable response style
- tunable verbosity and explanation density
- tunable technicality level
- tunable directness/warmth

## Runtime
- bounded turn execution
- deterministic stop reasons
- tool-bearing execution
- clarification / approval / deferred outcomes
- continuation across unfinished turns
- product-owned policy checks

## Context
- turn-context assembly from multiple inputs
- memory candidates
- enrichment candidates
- session continuity inputs
- guardrails and instruction overlays
- provenance of what context was used

## Memory
- retrieval-oriented memory integration
- truthful use of memory
- no fake memory claims
- support for product-owned memory strategies

## Proactivity
- assistant-initiated wake-ups
- policy-aware interruption behavior
- support for alert / digest / defer / silence patterns

## Collaboration
- Relay-native agent-to-agent communication
- optional connectivity-assisted efficient signaling
- higher-order coordination above the communication layer

## BYOH
- execution backend can be swapped
- collaboration should remain Relay-native
- product/runtime identity must remain canonical
- external execution planes must not replace Relay-native coordination

## Ingestion
- support for trusted outsider ingestion through an inbox-like primitive
- keep inbox separate from Relay-native inter-agent communication

---

# 3. What Agent Assistant should preserve

- product identity remains canonical
- product intelligence remains product-owned
- execution remains bounded
- collaboration remains Relay-native
- policy stays explicit rather than hand-wavy
- proactive behavior remains controllable
- memory remains truthful and bounded
- external execution should not absorb runtime identity or collaboration semantics

---

# 4. Human/operator knobs that should exist

These knobs should be configurable by a human builder/operator.

## Expression / style knobs
- verbosity
- explanation density
- technicality level
- directness
- warmth
- humor level
- response structure / formatting style

## Interaction knobs
- how aggressively the assistant asks clarifying questions
- how readily it takes initiative
- how much it prefers action vs discussion
- how much it summarizes vs explores

## Proactivity knobs
- interruption threshold
- alert vs digest preference
- follow-up aggressiveness
- reminder cadence / persistence
- when to stay silent

## Memory knobs
- how strongly memory should be surfaced
- whether memory is retrieved conservatively or aggressively
- whether stale memory should be shown or suppressed
- how much memory should be included in turn context

## Collaboration knobs
- whether specialist collaboration is enabled
- when helper agents should be consulted
- how visible agent collaboration should be in the resulting output

## BYOH knobs
- which execution backend to use
- fallback behavior if a backend lacks a capability
- whether to prefer first-party execution or external execution
- what degraded behaviors are acceptable

---

# 5. What Agent Assistant must not become

Agent Assistant must not become:
- a replacement for product-specific logic
- a cloud orchestration platform by itself
- a credential broker implementation by itself
- a workflow runner platform by itself
- a fake-memory system that overclaims continuity
- a system that collapses Relay-native collaboration into provider-specific execution backends

---

# 6. Boundaries by layer

## Agent Assistant should own
- identity/runtime primitives
- turn-context
- continuation
- policy semantics
- proactive semantics
- inbox semantics for trusted outsiders
- execution adapter contracts
- collaboration assumptions (Relay-native first)

## Products should own
- domain workflows
- product-specific heuristics
- product surfaces and UX
- integration/business logic
- customer-specific settings and delivery behavior

## Cloud/platform should own
- workflow execution infrastructure
- credential brokerage implementations
- operational schedulers/runners
- platform telemetry and deployment machinery

---

# 7. Relay and communication rules

## Relay-native communication
Agents already on the Relay should communicate through Relay-native primitives.

Examples:
- Sage ↔ NightCTO
- product assistant ↔ specialist worker
- local proving agents in Relay SDK–driven environments

## Connectivity
Connectivity is a lightweight signaling helper, not a replacement for Relay-native communication.

## Inbox
Agent Inbox is for trusted outsiders **not already on the Relay**.
It is not the same thing as Relay-native inter-agent communication.

---

# 8. BYOH rules

- BYOH changes execution, not collaboration
- external backends are execution planes
- Relay remains the collaboration fabric
- product identity must remain canonical
- one bounded backend proof is better than many vague adapters
- local proving should use Agent Relay SDK as a primary coordination substrate

---

# 9. NightCTO / Sage implications

## Sage
Agent Assistant should help Sage become:
- context-rich
- memory-aware
- continuation-capable
- product-specific in planning/research behavior

## NightCTO
Agent Assistant should help NightCTO become:
- observability-aware
- proactive
- runtime-context-rich
- founder-facing

But NightCTO should still own its product-specific observability and operational logic.

---

# 10. Current v1 priorities

1. stable published runtime-core packages
2. real product proof in Sage
3. local BYOH proof using Agent Relay SDK
4. NightCTO first bounded observability implementation
5. inbox/trusted-outsider ingestion as an explicit next primitive

---

# 10A. Hosted assistant compatibility

Agent Assistant should be definable and configurable enough to support **hosted assistant instantiation** by a platform layer.

This means the SDK should support:
- assistant definitions as data/config, not only hand-coded app logic
- configurable identity/traits/behavior knobs
- configurable runtime surfaces (memory, proactive behavior, BYOH preferences, communication surfaces)
- product/platform-driven assistant templates

The SDK should make assistants **definable**.
A cloud/platform product should make assistants **spawnable and operable**.


# 11. Bottom line

Agent Assistant is a runtime substrate for real assistants.

It should be:
- configurable
- bounded
- Relay-native in collaboration
- flexible in execution
- honest in memory/proactivity
- understandable by humans quickly

If a builder cannot quickly understand what it does, what it preserves, and what they can tune, the SDK is not yet in a good enough shape.
