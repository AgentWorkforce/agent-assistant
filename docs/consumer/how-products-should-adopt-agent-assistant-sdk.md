# How Products Should Adopt Agent Assistant SDK

Date: 2026-04-16

## Purpose

This document gives product teams a concrete adoption rule for Sage, NightCTO, MSD, and future assistants.

The goal is incremental adoption, not a rewrite.

## Core Adoption Rule

Products should adopt this SDK by replacing duplicated assistant-runtime infrastructure first, while keeping product intelligence where it already belongs.

Adopt shared runtime primitives such as:

- assistant construction
- session continuity
- assistant-facing surfaces
- traits / identity defaults
- bounded turn execution
- turn-context assembly
- continuation
- inbox / outsider ingestion boundary
- policy and audit seams
- proactive engine contracts
- memory composition contracts
- connectivity / coordination when the product genuinely needs them

Do not move product-owned concerns such as:

- product prompts
- product-specific tools
- business policy
- product dashboards or UI
- domain heuristics that only one product needs
- one-off automations that are not reusable across assistants

## Practical Adoption Sequence

### Step 1: depend on package contracts, not internal implementation details

Use the package boundaries as the integration targets. Do not couple product code to internal folder structure or historical plan docs.

### Step 2: wrap existing product behavior before extracting it

Start by adapting current product logic to shared interfaces.

Do not pause product delivery for deep extraction work.

### Step 3: move generalized code only after repeated product value is clear

A capability should usually show repeated value across multiple products before it becomes shared SDK code.

### Step 4: keep product-owned extensions in product repos

If a shared contract needs customization, implement the customization in the product repo rather than widening a core SDK package for one product only.

## Runtime Primitive Adoption Order

Products should think in runtime primitives, not in one monolithic “harness adoption” motion.

Recommended order:

1. `@agent-assistant/core`
2. `@agent-assistant/sessions`
3. `@agent-assistant/surfaces`
4. `@agent-assistant/traits`
5. `@agent-assistant/policy`
6. `@agent-assistant/proactive`
7. `@agent-assistant/harness`
8. `@agent-assistant/turn-context`
9. `@agent-assistant/memory`
10. `@agent-assistant/continuation`
11. `@agent-assistant/inbox`
12. `@agent-assistant/connectivity` / `@agent-assistant/coordination` only where the product really benefits from backstage collaboration

That order is practical, not absolute. Some products will adopt memory before continuation; some will need policy before proactive; some may not need coordination at all.

## Product-Specific Guidance

### Sage

Adopt first:

- `@agent-assistant/core`
- `@agent-assistant/traits`
- `@agent-assistant/harness`
- `@agent-assistant/turn-context`
- `@agent-assistant/memory`
- `@agent-assistant/continuation`

Reason:

- Sage strongly exercises the visible-assistant turn path, identity, turn shaping, continuity, and unfinished-turn follow-up behavior.

Keep in Sage:

- workspace knowledge workflows
- product-specific context shaping heuristics
- Slack/server behavior that is not general enough yet
- product-owned prompt stacks and superpowers

### NightCTO

Adopt first:

- `@agent-assistant/core`
- `@agent-assistant/traits`
- `@agent-assistant/policy`
- `@agent-assistant/proactive`
- `@agent-assistant/memory`
- `@agent-assistant/coordination`
- `@agent-assistant/connectivity`
- `@agent-assistant/inbox`

Reason:

- NightCTO strongly exercises runtime-assistant behavior, proactive follow-up, observability-oriented coordination, outsider ingestion boundaries, and per-client continuity.

Keep in NightCTO:

- founder/CTO communication style
- client-tier and service policy
- domain-specific specialist lineup choices
- product-specific observability semantics and escalation heuristics

### MSD

Adopt first:

- `@agent-assistant/core`
- `@agent-assistant/sessions`
- `@agent-assistant/surfaces`
- `@agent-assistant/traits`
- `@agent-assistant/policy`
- `@agent-assistant/coordination`

Reason:

- MSD strongly exercises cross-surface continuity, product-owned review workflows, and coordinator/specialist patterns around code-review-style work.

Keep in MSD:

- review-specific tools
- PR workflows
- domain-specific delegation and synthesis heuristics unless they clearly generalize

## Relay Foundation Boundary

Products should continue to depend on Relay family repos for:

- transport adapters
- normalized inbound/outbound transport messages
- auth
- scheduler substrate
- low-level action dispatch
- Relay-native coordination fabric

This repo is not a replacement for Relay.

It is the assistant-facing runtime layer built on top of Relay.

## BYOH / Execution Plane Rule

Products should preserve their own identity and Relay-native collaboration model even if execution harnesses are replaceable.

That means:

- product identity is canonical
- execution harnesses are replaceable
- Relay remains the coordination/collaboration fabric

Do not let external harness choice erase product individuality or flatten Relay-native collaboration into a single provider call.

## Decision Test

Before moving code into this repo, ask:

- would multiple products plausibly use this capability with different configuration or adapters?
- is this truly assistant-runtime infrastructure rather than product behavior?
- does this belong below product prompts/heuristics and above Relay transport/foundation?

If yes, it probably belongs here.

If no, keep it in the product repo.

## Current Adoption Reality

As of the current local repo state:

- core, sessions, surfaces, routing, connectivity, coordination, traits, harness, turn-context, memory, continuation, inbox, proactive, and policy all have implemented package surfaces with passing local tests
- the main remaining adoption questions are now less about raw package existence and more about:
  - product-proof quality
  - publish/install truth
  - where product-specific behavior should stop and shared runtime should begin

## Recommended Product Adoption Discipline

1. pick one bounded product slice
2. adopt one or two SDK primitives into that slice
3. prove the slice in the real product path
4. fix seam issues in the SDK only when they are clearly reusable
5. stop before rewriting the product around the SDK for its own sake

Incremental proof beats broad migration plans.
