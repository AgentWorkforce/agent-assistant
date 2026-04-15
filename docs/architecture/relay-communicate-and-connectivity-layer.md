# Relay Communicate and Connectivity Layer

**Date:** 2026-04-15
**Status:** DIRECTIONAL

## 1. Purpose

Clarify the agent-to-agent communication model for Agent Assistant and related products.

This document makes explicit that agent-to-agent collaboration should remain Relay-native for both BYOH and non-BYOH configurations.

## 2. Core decision

**BYOH changes execution, not collaboration.**

That means:
- external harnesses/backends may change the execution plane
- Relay remains the collaboration and communication substrate
- connectivity remains the lightweight signaling helper
- higher-order multi-agent orchestration still belongs above these layers

## 3. Relay communicate

`relay communicate` is the best conceptual framing for the primary agent-to-agent communication primitive.

It should be understood as:
- Relay-native communication between agents already on the Relay
- workspace/channel-aware agent messaging
- the default communication substrate for assistants, specialists, and helper agents

Examples:
- Sage ↔ NightCTO
- NightCTO ↔ Raya (through platform/runtime integration surfaces)
- assistant ↔ specialist worker
- local proving agents coordinated through Agent Relay SDK

## 4. Agent Relay SDK as the primary collaboration substrate

The Agent Relay SDK should be treated as the primary implementation substrate for Relay-native communication.

This includes:
- broker/workspace/channel setup
- agent spawning and identity on Relay
- message passing between agents
- local multi-agent proving environments
- workflow-driven collaboration

This is true for:
- non-BYOH agent systems
- BYOH local proving environments
- future cloud/platform-mediated collaboration paths

## 5. Connectivity as the efficient signaling helper

`connectivity` should remain the lightweight signaling/comms helper that complements Relay-native communication.

Use connectivity for:
- efficient focused signals
- convergence state
- handoff metadata
- lighter coordination paths where full transcript-level communication is unnecessary

Do **not** treat connectivity as a replacement for Relay-native communication.

## 6. Coordination layer above communication

Higher-order collaboration/orchestration still belongs above Relay communicate and connectivity.

That layer can own:
- specialist routing
- collaboration patterns
- deliberation and role shaping
- multi-agent task structure

So the emerging stack is:

1. **Relay communicate** — primary agent-to-agent communication primitive
2. **connectivity** — lightweight signaling helper
3. **coordination** — higher-order orchestration logic
4. **execution plane** — harness / adapter / BYOH backend

## 7. Why this matters for BYOH

Without this clarification, BYOH can accidentally blur two separate things:
- execution
- collaboration

This document makes the intended split explicit:
- execution may become replaceable
- collaboration remains Relay-native

That preserves:
- canonical product/runtime identity
- existing multi-agent primitives
- local proving workflows using Agent Relay SDK

## 8. Relation to Agent Inbox

Agent Inbox is separate.

- `relay communicate` is for agents already on the Relay
- Agent Inbox is for trusted outsiders not on the Relay

These must remain distinct primitives.

## 9. Bottom line

Agent-to-agent communication should remain Relay-native.

The clearest framing is:
- **Relay communicate** = primary communication primitive
- **connectivity** = efficient signaling helper
- **coordination** = orchestration layer
- **BYOH** = execution-plane flexibility, not collaboration-plane replacement
