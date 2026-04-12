# Relayauth for Compartmented Memory and Policy

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-12

## Purpose

Describe how RelayAssistant should use relayauth as an identity and authorization substrate for compartmented memory and policy enforcement without turning relayauth into the whole assistant policy engine.

## Core stance

Relayauth should help answer:
- who is this principal?
- what surfaces/accounts map to them?
- what workspace/org memberships do they have?
- what scopes are they allowed to access?
- what assistant context is this request operating in?

RelayAssistant should answer:
- what memory compartments exist?
- what can be promoted between them?
- what can the assistant surface automatically?
- what requires approval, audit, or suppression?

## Why this matters

RelayAssistant is moving toward a model with:
- personal agents for users on private surfaces like Telegram and WhatsApp
- company/shared agents on work surfaces like Slack
- unified identity across surfaces where appropriate
- private/shared memory compartments rather than one flat memory pool

That model depends on a clear split between identity/auth and assistant policy/memory behavior.

## What relayauth is well-suited for

### 1. Unified identity across surfaces
Relayauth can help bind:
- Telegram account X
- WhatsApp account X
- Slack member X

into one underlying principal when that is actually correct.

This allows RelayAssistant to know that the same human may appear in multiple surface contexts without assuming all memory becomes shared.

### 2. Membership and claims
Relayauth can expose facts like:
- user belongs to workspace A
- user has role B
- user is authorized for org C
- user is acting through personal or shared assistant context

These are powerful inputs for policy and memory access control.

### 3. Scope-aware authorization
Relayauth can help determine whether a principal is allowed to access:
- personal/private rooms
- workspace/shared rooms
- org-level rooms
- specific assistant contexts or tool capabilities

### 4. Assistant and background-agent grants
Over time, relayauth may help issue scope-bound grants so that:
- a visible assistant can access some rooms but not others
- a librarian/background agent can read backstage rooms without reading private user rooms indiscriminately
- a company assistant can access shared workspace memory but not a user's private direct-agent memory

## What should remain in RelayAssistant policy/memory

Relayauth should not be the full memory governance layer.

These concerns belong primarily in RelayAssistant:
- compartment definitions and room semantics
- promotion/projection rules between private and shared spaces
- provenance-aware memory movement
- assistant-facing allow/deny/escalate decisions
- audit semantics for assistant actions and memory access
- librarian/synthesis behavior

## Recommended split of responsibility

### Relayauth owns
- identity
- authentication
- principal linkage across surfaces
- memberships
- claims and grants
- authorized context boundaries

### RelayAssistant memory owns
- session/thread memory
- private user memory rooms
- shared workspace/company memory rooms
- backstage/library memory rooms
- provenance and compaction behavior
- promotion and projection logic

### RelayAssistant policy owns
- what memory access is allowed in a given assistant context
- what proactive or background actions may surface to the user
- what requires escalation or approval
- what must remain private
- what should be audited

## Example scenario

A user interacts with:
- a personal assistant in Telegram
- a company assistant in Slack

Relayauth may know these map to the same principal.

But the memory model should still allow:
- private Telegram memories to remain private
- shared Slack/team memory to remain workspace-visible
- only explicit policy-controlled promotion from personal -> shared

That is the key principle:
**unified identity should not imply unified memory visibility.**

## Interaction with the room model

This maps naturally onto the compartment/room approach:
- personal rooms
- shared company rooms
- session rooms
- backstage/library rooms

Relayauth can help identify who is standing at the door.
Policy decides whether they may enter.
Memory decides what is inside and how it was derived.

## Implementation direction

Near-term:
- treat relayauth as an input to policy and memory access checks
- model principal identity separately from memory scope visibility
- keep private/shared promotion explicit

Later:
- support richer grants for assistants and background agents
- support more formal room-level access controls
- connect relayauth claims with librarian/background-agent access policy

## Design summary

RelayAssistant should integrate with relayauth as the identity and authorization substrate for compartmented assistants.

That gives us:
- unified identity across surfaces where appropriate
- clean access-boundary inputs for policy
- a safer foundation for private/shared memory compartments

Without collapsing everything into one flat assistant memory system.
