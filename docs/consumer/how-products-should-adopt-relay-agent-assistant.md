# How Products Should Adopt Relay Agent Assistant

Date: 2026-04-11

## Purpose

This document gives product teams a concrete adoption rule for Sage, MSD, NightCTO, and future assistants.

The goal is incremental adoption, not a rewrite.

## Core Adoption Rule

Products should adopt this SDK by replacing duplicated assistant-runtime infrastructure first, while keeping product logic where it already belongs.

Adopt:

- assistant construction
- session continuity contracts
- memory contracts
- proactive engine contracts
- coordination contracts
- policy and audit hooks

Do not move:

- product prompts
- product-specific tools
- business policy
- product dashboards or UI
- one-off automations that are not reusable across assistants

## Adoption Sequence

### Step 1: depend on package contracts, not implementations

Use the package boundaries as the integration targets even before heavy code moves happen.

### Step 2: wrap existing product behavior

Start by adapting current product logic to shared interfaces.

Do not pause product delivery for deep extraction work.

### Step 3: move generalized code only after two or more products need it

A capability should usually show repeated value across products before it becomes shared SDK code.

### Step 4: keep product-owned extensions in product repos

If the shared contract needs customization, implement the customization in the product repo rather than widening the core package for one product only.

## Product-Specific Guidance

### Sage

Adopt first:

- `@relay-assistant/memory`
- `@relay-assistant/proactive`
- `@relay-assistant/sessions`

Reason:

- Sage already demonstrates strong memory and follow-up patterns that should become reusable contracts

Keep in Sage:

- workspace knowledge workflows
- product-specific context shaping
- Slack-specific behavior that is not general enough yet

### MSD

Adopt first:

- `@relay-assistant/core`
- `@relay-assistant/sessions`
- `@relay-assistant/surfaces`
- `@relay-assistant/policy`

Reason:

- MSD has strong cross-surface and shared-session architecture signals

Keep in MSD:

- code review operations
- PR workflows
- review-specific orchestration logic unless it clearly generalizes

### NightCTO

Adopt first:

- `@relay-assistant/coordination`
- `@relay-assistant/policy`
- `@relay-assistant/memory`
- `@relay-assistant/proactive`

Reason:

- NightCTO strongly exercises many-agents-one-assistant behavior and per-client continuity

Keep in NightCTO:

- founder/CTO communication style
- client-tier and service policy
- domain-specific specialist lineups

## Relay Foundation Boundary

Products should continue to depend on Relay family repos for:

- transport adapters
- normalized inbound/outbound messages
- auth
- scheduler substrate
- low-level action dispatch

This repo is not a replacement for Relay.

It is the assistant layer built on top of Relay.

## Cloud Adoption Direction

Products should target the OSS SDK interfaces first.

If a future cloud adapter layer is introduced later, products should adopt it as an implementation detail behind the OSS contracts rather than binding themselves directly to hosted infrastructure.

This keeps product repos portable and avoids a second architecture fork.

## Decision Test

Before moving code here, ask:

- would Sage, MSD, and NightCTO all plausibly use this with different configuration or adapters

If yes, it probably belongs here.

If no, keep it in the product repo.


## Reuse Existing Relay Capabilities First

Products and implementation workflows should inspect the existing `relay` ecosystem before introducing new package implementations.

Important example:
- for memory, start by evaluating and reusing `@agent-relay/memory`
- do not assume `@relay-assistant/memory` must be a greenfield package
- prefer wrapping, composing, or adapting Relay memory where it already satisfies the needed assistant contract
