# How Products Should Adopt Agent Assistant SDK

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

- `@agent-assistant/memory`
- `@agent-assistant/proactive`
- `@agent-assistant/sessions`

Reason:

- Sage already demonstrates strong memory and follow-up patterns that should become reusable contracts

Keep in Sage:

- workspace knowledge workflows
- product-specific context shaping
- Slack-specific behavior that is not general enough yet

### MSD

Adopt first:

- `@agent-assistant/core`
- `@agent-assistant/sessions`
- `@agent-assistant/surfaces`
- `@agent-assistant/policy`

Reason:

- MSD has strong cross-surface and shared-session architecture signals

Keep in MSD:

- code review operations
- PR workflows
- review-specific orchestration logic unless it clearly generalizes

### NightCTO

Adopt first:

- `@agent-assistant/coordination`
- `@agent-assistant/policy`
- `@agent-assistant/memory`
- `@agent-assistant/proactive`

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
- do not assume `@agent-assistant/memory` must be a greenfield package
- prefer wrapping, composing, or adapting Relay memory where it already satisfies the needed assistant contract

---

## v1 Package Status and Adoption Readiness

As of 2026-04-12, these packages are implemented with passing test suites and are ready for product adoption:

| Package | Status | Tests | Adopt now? |
|---|---|---|---|
| `@agent-assistant/core` | SPEC_RECONCILED | 40 passing | Yes — universal starting point |
| `@agent-assistant/traits` | IMPLEMENTATION_READY | 32 passing | Yes — lightweight, no downstream deps |
| `@agent-assistant/policy` | implemented | 64 passing | Yes — MSD and NightCTO priority |
| `@agent-assistant/proactive` | implemented | 45 passing | Yes — Sage and NightCTO priority |
| `@agent-assistant/sessions` | v1 baseline | — | Yes — for session continuity |
| `@agent-assistant/surfaces` | v1 baseline | — | Yes — for multi-surface fanout |
| `@agent-assistant/memory` | placeholder | — | No — evaluate `@agent-relay/memory` first |
| `@agent-assistant/routing` | DoD gap | 12/40+ | No — do not adopt until resolved |
| `@agent-assistant/coordination` | tests blocked | — | No — dependency gap |
| `@agent-assistant/connectivity` | tests blocked | — | No — dependency gap |

Products should adopt packages in the "Yes" rows now. Do not block on packages in the "No" rows.

---

## Assembly Examples

`packages/examples/` contains five reference assembly files showing the exact composition patterns products should use:

| Example | What to adopt from it |
|---|---|
| `01-minimal-assistant.ts` | Adapter wiring, lifecycle, `onError` hook — all products |
| `02-traits-assistant.ts` | Trait value choices, handler-level formatting — all products |
| `03-policy-gated-assistant.ts` | Policy rule shape, action construction, decision branching — MSD, NightCTO |
| `04-proactive-assistant.ts` | Follow-up rule conditions, watch rules, scheduler binding — Sage, NightCTO |
| `05-full-assembly.ts` | Full four-package composition, proactive→policy bridge — NightCTO and eventual convergence |

See `packages/examples/README.md` for the product adoption mapping table and build order.
