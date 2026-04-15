# v1 BYOH Local Relay SDK Proof Boundary

**Date:** 2026-04-15
**Status:** IMPLEMENTATION_READY

## 1. Purpose

Define the first local BYOH implementation slice as a Relay-native proving environment, not as an isolated adapter experiment.

This slice should prove that:
- Agent Assistant remains the canonical product/runtime layer
- the Agent Relay SDK can coordinate the local proving environment
- connectivity can support efficient multi-agent communication where useful
- one external/local execution backend can participate through the execution-adapter seam
- Relay-native collaboration remains primary even when external execution planes are introduced

## 2. Core architectural decision

The first BYOH proof should be:

> **Agent Relay SDK–driven local BYOH proof**

Not:
- a provider-only adapter spike
- a cloud-first integration
- a replacement for Relay-native coordination

## 3. In scope

### 3.1 Canonical runtime stays in Agent Assistant
The slice must preserve:
- traits as identity floor
- turn-context as assembly seam
- policy as decision gate
- continuation as follow-up lineage
- execution adapter as translation seam

### 3.2 Local proving environment uses Agent Relay SDK
The slice must use Agent Relay SDK as the primary coordination substrate for:
- local broker/workspace/channel setup
- multi-agent coordination
- message passing between collaborators
- bounded proving workflows

### 3.3 Connectivity may be used for efficient focused signaling
Connectivity is in scope where it helps with:
- lightweight coordination signals
- convergence / handoff state
- efficient communication between local proving agents

### 3.4 One external/local execution backend only
The first slice must choose **one** external/local backend.
Examples:
- Codex CLI
- Claude Code

Do not attempt multiple backends in the first implementation slice.

## 4. Out of scope

- cloud credential brokerage
- multiple external backends at once
- broad product rollout in Sage and NightCTO simultaneously
- replacing Relay-native coordination with external execution systems
- finalized public package/API extraction for all BYOH concerns
- generalized cloud execution orchestration

## 5. Required proof components

### 5.1 Local proving environment
A local proving harness that uses Agent Relay SDK to coordinate:
- one canonical assistant runtime participant
- one or more collaborating local agents/specialists
- one external execution backend through an adapter

### 5.2 Execution adapter proof
The slice must prove:
- canonical execution request in
- adapter translation to local external backend
- normalized execution result out
- truthful degradation when the backend cannot satisfy a requested capability

### 5.3 Relay-native collaboration proof
The slice must also prove:
- Relay-native collaboration still works while external execution is in play
- product/runtime identity does not move into the external backend
- coordination remains on Relay rather than being absorbed into the external execution plane

## 6. Recommended first proving topology

### Participant A — canonical product/runtime agent
Owns:
- Agent Assistant identity/runtime semantics
- request shaping
- continuation/policy semantics

### Participant B — Relay-native collaborator(s)
Owns:
- bounded research / planning / helper work
- optional connectivity-assisted coordination

### Participant C — external execution plane
Owns:
- actual execution through one local external backend
- no ownership of product identity or Relay-native coordination

## 7. Suggested first backend choice

Pick whichever local backend is easiest to validate deterministically.

Selection criteria:
- stable local invocation
- reproducible auth/runtime behavior
- easy result normalization
- useful for Sage/NightCTO local testing

## 8. Required deliverables for the next implementation slice

1. implementation boundary doc for the chosen backend
2. no-regression checklist
3. proof plan
4. adapter implementation
5. local Relay SDK–driven proving workflow
6. review verdict documenting what was truly proven

## 9. Success criteria

The first BYOH slice is successful when all are true:
- a local external backend runs through the execution-adapter seam
- Relay-native coordination is used in the proving setup
- connectivity usage (if present) is bounded and useful
- the assistant runtime remains canonical
- one product path (or verification harness) can exercise the proof locally

## 10. Decision

Proceed with BYOH using an **Agent Relay SDK–driven local proving environment** with one external/local execution backend and Relay-native coordination preserved as the primary collaboration model.
