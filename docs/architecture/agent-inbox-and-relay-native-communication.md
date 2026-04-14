# Agent Inbox and Relay-Native Communication

**Date:** 2026-04-14
**Status:** DIRECTIONAL

## 1. Purpose

Clarify that the proposed Agent Inbox is a different primitive from Relay-native agent-to-agent communication.

## 2. Relay-native communication

Agents that are already on the Relay should communicate through Relay-native coordination and messaging primitives.

Examples:
- Sage ↔ NightCTO
- NightCTO ↔ Raya the relay rabbit runner
- product assistants ↔ worker/specialist agents on the Relay

This is a core premise of the platform, not something the inbox should replace.

## 3. Agent Inbox

The Agent Inbox should exist for **trusted outsiders not already on the Relay**.

Examples:
- imported local AI chats
- trusted forwarded messages
- external transcripts
- trusted notes/memos from non-Relay systems

The inbox should normalize these inputs into bounded assistant-ingestible artifacts.

## 4. Why this is a separate primitive

Without this distinction, the system becomes muddled:
- inbox starts duplicating Relay-native communication
- agent coordination gets confused with external ingestion
- access control and trust boundaries weaken

The inbox should be treated as a primitive for:
- trusted external ingestion
- optional memory candidate creation
- optional turn-context enrichment
- optional continuation or follow-up candidate generation

## 5. Roadmap implication

Agent Assistant should explicitly add an **Inbox / trusted outsider ingestion** track, separate from:
- surfaces
- sessions
- continuation
- Relay-native coordination

## 6. Bottom line

Relay-native communication is for agents already on the Relay.
Agent Inbox is for trusted outsiders not on the Relay.
They are distinct primitives and should remain so.
