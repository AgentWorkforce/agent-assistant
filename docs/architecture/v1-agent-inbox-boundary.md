# v1 Agent Inbox Boundary

**Date:** 2026-04-15
**Status:** DIRECTIONAL

## Purpose

Define the first explicit Agent Inbox primitive.

The Agent Inbox is for **trusted outsiders not already on the Relay**.

It is separate from:
- Relay-native agent-to-agent communication
- connectivity-assisted signaling between Relay-native agents

## Why this primitive exists

Agent Assistant currently has strong primitives for:
- Relay-native communication
- turn-context
- memory
- continuation
- policy / proactive behavior

But it does not yet have an explicit first-class ingestion primitive for trusted external sources such as:
- imported local AI chats
- trusted forwarded messages
- external transcripts
- trusted memos/notes from non-Relay systems

## In scope for the first slice

A first bounded inbox slice should define:
- trusted inbox item shape
- source/trust metadata
- optional route to memory candidates
- optional route to turn-context enrichment
- optional route to continuation/follow-up candidates

## Out of scope for the first slice

- full end-user inbox UI
- universal ingestion adapters for every source
- replacing Relay-native communication
- broad workflow/orchestration logic
- heavy cloud/platform provisioning

## Core rules

1. Inbox is for outsiders not on the Relay.
2. Relay-native agents should use Relay-native communication, not the inbox.
3. Inbox items should be bounded, typed, and trust-aware.
4. Inbox should integrate naturally with memory, turn-context, and continuation.

## Recommended next step

After this boundary, define the first implementation contract for:
- normalized inbox item shape
- source trust model
- one or two ingestion-to-memory / ingestion-to-context routes
