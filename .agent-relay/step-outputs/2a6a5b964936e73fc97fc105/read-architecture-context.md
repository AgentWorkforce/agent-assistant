---BOUNDARY MAP---
# Package Boundary Map

Date: 2026-04-11

## Purpose

This document defines what belongs in:

- Relay foundation repos
- `relay-agent-assistant` OSS SDK packages
- product repositories such as Sage, MSD, and NightCTO

The goal is to prevent duplicate assistant-runtime work while avoiding leakage of transport infrastructure or product-specific behavior into the wrong layer.

## Boundary Rule

Use this rule first:

- if the capability is transport, auth, scheduling substrate, or low-level action dispatch, keep it in Relay foundation
- if the capability assumes an assistant identity, memory model, session continuity model, specialist orchestration model, or focused inter-agent connectivity model, move it here
- if the capability only makes sense for one product's domain, keep it in that product repo

## Layer Ownership

### Relay foundation

Relay family repos should continue to own:

- inbound webhook verification and provider-specific parsing
- normalized message and outbound delivery primitives
- channel and transport session substrate
- auth and connection wiring
- low-level action dispatch
- scheduler and wake-up substrate
- relaycast or other communication infrastructure
- transport-level observability

Examples that stay out of this repo:

- Slack signature verification
- WhatsApp payload parsing
- generic cron registration
- raw `spawn_agent` or message-delivery plumbing

### Relay Agent Assistant SDK

This repo should own reusable assistant-runtime behavior:

- assistant definition and capability registration
- memory scopes, retrieval, persistence contracts, promotion, compaction
- proactive engines, watch rules, reminders, scheduler bindings
- assistant session continuity across surfaces
- assistant-facing surface abstractions above normalized transport events
- coordinator and specialist orchestration
- focused inter-agent connectivity, signaling, and convergence contracts
- assistant-level routing, latency, depth, and budget-aware policy hooks
- policy, approvals, audit hooks, and action risk classification

Examples that should land here:

- a shared `AssistantSession` model
- a reusable `MemoryStore` contract
- a generic `ProactiveEngine`
- a coordinator that can delegate to specialists and synthesize one assistant response

### Product repositories

Product repos should continue to own:

- prompts and persona behavior beyond baseline assistant identity fields
- product-specific tools and workflows
- domain-specific watcher rules
- product UX and surface conventions
- business policy, escalation, and commercial rules
- product-specific specialist definitions

Examples:

- MSD review heuristics and PR-specific workflows
- Sage knowledge-capture behavior and workspace semantics
- NightCTO founder communication patterns and service-tier policy

## Package Responsibilities

### `@relay-assistant/core`

Owns:

- `createAssistant()` and assistant definition types
- runtime lifecycle and capability registration
- assistant identity fields shared across packages
- lightweight composition entrypoints and shared cross-package types

Composition note:
- `core` should not become a heavy package that hard-depends on every other package by default
- prefer interface-first composition and optional package wiring so consumers can adopt only the packages they need
- if `core` exposes convenience assembly helpers, they should live alongside modular entrypoints rather than replacing them

Must not own:

- provider-specific transport code
- memory backend implementation details
- product workflows

### `@relay-assistant/memory`

Owns:

- memory scopes such as user, session, workspace, org, and object
- retrieval, write, compaction, and promotion contracts
- memory adapter interfaces for future backends

Must not own:

- one product's tag taxonomy
- one surface's thread model as the only memory key shape

### `@relay-assistant/proactive`

Owns:

- follow-up engines
- watcher definitions
- reminder policies
- scheduler bindings over Relay substrate
- evidence contracts for stale-session or follow-up decisions

Must not own:

- product-only trigger logic
- surface-specific evidence collection that cannot generalize

### `@relay-assistant/sessions`

Owns:

- assistant session identity
- attachment of multiple surfaces to one assistant session
- resume, reattach, and affinity rules
- scoping rules across user, workspace, org, and object contexts

Must not own:

- raw transport sessions
- provider webhook semantics

### `@relay-assistant/surfaces`

Owns:

- assistant-facing inbound and outbound abstractions
- assistant-layer fanout policy describing which connected surfaces should receive a given assistant response
- formatter and capability hooks above Relay normalization
- surface metadata such as threading or attachment support

Fanout boundary note:
- Relay foundation still owns actual transport delivery to each destination
- `surfaces` only decides assistant-level targeting and formatting across attached surfaces
- Example: deciding that one assistant summary should go to web plus Slack belongs here; the actual Slack API post and web transport delivery remain in Relay foundation

Must not own:

- webhook verification
- provider SDK clients as foundational transport code

### `@relay-assistant/coordination`

Owns:

- coordinator and specialist registry contracts
- delegation plan and synthesis contracts
- many-agents-one-assistant orchestration semantics

Must not own:

- a fixed specialist lineup for any one product
- product-specific dispatch heuristics that cannot generalize

### `@relay-assistant/connectivity`

Owns:

- focused inter-agent signaling contracts
- convergence and escalation semantics
- attention, salience, confidence, and handoff message classes
- communication efficiency rules for internal assistant coordination

Must not own:

- raw message transport or relaycast substrate
- product-specific specialist registries
- generic user-facing messaging APIs

### `@relay-assistant/routing`

Owns:

- assistant-facing routing contracts
- latency/depth/cost response modes
- model-choice policy above raw provider clients
- integration points for workforce workload-router style persona/tier resolution

Must not own:

- raw transport routing
- provider SDK implementation details
- product-specific commercial routing rules

### `@relay-assistant/policy`

Owns:

- approval modes
- external-action safeguards
- action risk classification
- audit hooks

Must not own:

- one product's commercial rules or customer-tier behavior

### `@relay-assistant/examples`

Owns:

- reference examples showing how products should integrate the SDK
- skeletal example assistants and adoption patterns

Must not own:

- production product code
- private cloud adapters

## Extraction Guidance From Existing Systems

| Source | Signal | Destination |
| --- | --- | --- |
| Relay gateway and adapter infrastructure | transport, verification, normalization, raw actions | stay in Relay foundation |
| Sage memory and proactive behavior | reusable memory and follow-up patterns | `memory`, `proactive`, parts of `core` |
| MSD session and surface convergence design | shared chat surface and runtime/session attachment | `sessions`, `surfaces`, parts of `core` |
| NightCTO specialist orchestration and per-client continuity | many-agents-one-assistant and proactive monitoring | `coordination`, `connectivity`, `policy`, `memory`, `proactive` |
| Workforce workload-router and persona tiers | quality-preserving routing across depth/latency/cost envelopes | `routing`, parts of `core`, links to `coordination` |

## Import Guidance For Consumers

Consumers should import only the package boundaries they need.

Examples:

- a simple assistant may import `@relay-assistant/core`, `@relay-assistant/sessions`, and `@relay-assistant/surfaces`
- a memory-heavy assistant may additionally import `@relay-assistant/memory`
- a specialist-based assistant may add `@relay-assistant/coordination` and `@relay-assistant/policy`

Consumers should not import Relay infrastructure directly to bypass assistant-level contracts unless they are implementing a transport adapter or other foundational infrastructure outside this repo.

---EXTRACTION ROADMAP---
# Extraction Roadmap

Date: 2026-04-11

## Goal

Extract a stable OSS assistant SDK without freezing product development in Sage, MSD, NightCTO, or future repos.

The roadmap favors:

- contracts before concrete implementations
- package boundaries before code moves
- adapters before rewrites
- one reusable slice at a time

## Phase 0: Docs-first foundation

Deliverables:

- root README that defines the repo and layer model
- package boundary map
- OSS vs cloud split guidance
- consumer adoption docs
- package README placeholders

Exit criteria:

- every consumer can understand what this repo will own
- every product team can identify what should stay in its own repo

## Phase 1: Establish package shells and type contracts

Target packages:

- `@relay-assistant/core`
- `@relay-assistant/sessions`
- `@relay-assistant/surfaces`

Reason:

- consumers need a stable assistant construction and session model before higher-level memory or proactive logic can converge cleanly

Deliverables:

- package manifests and empty source shells
- assistant definition and runtime contracts
- assistant session contracts
- assistant-facing surface contracts

Non-goals:

- backend adapters
- product migrations
- cloud deployment code

## Phase 2: Extract shared memory contracts

Primary source signals:

- Sage memory patterns
- NightCTO per-client continuity requirements

Deliverables:

- `MemoryStore` contract
- memory scopes and retrieval APIs
- promotion and compaction extension points
- placeholder adapter interfaces

Adoption rule:

- move shared memory semantics here
- leave product-specific tagging and prompt composition in product repos

## Phase 3: Extract proactive engine contracts

Primary source signals:

- Sage follow-ups and stale-thread handling
- NightCTO proactive monitoring and digests

Deliverables:

- `ProactiveEngine`
- watcher and reminder contracts
- scheduler binding interfaces over Relay substrate
- evidence model for proactive decisions

Adoption rule:

- the engine and policies move here
- each product still owns its own domain-specific watcher definitions until generalized

## Phase 4: Extract coordination and policy

Primary source signals:

- NightCTO specialist orchestration
- MSD orchestration requirements

Deliverables:

- coordinator and specialist registry contracts
- delegation and synthesis interfaces
- approval modes and audit hooks

Adoption rule:

- keep general orchestration semantics here
- keep product-specific specialist lineups and business escalation policy outside

## Phase 5: Publish examples and reference integrations

Deliverables:

- example assistant definitions
- example product integration docs
- migration examples from product repos to SDK packages

Example targets:

- Sage-style memory-heavy assistant
- MSD-style review-oriented assistant
- NightCTO-style specialist-based assistant

## Migration Strategy

Use wrappers first.

Preferred migration order:

1. define shared interfaces in this repo
2. adapt product code to those interfaces without large rewrites
3. move generalized code only after multiple products depend on the shared contract
4. remove duplicate implementations later

This reduces churn and keeps products shipping while the SDK stabilizes.

## What Not To Do

Avoid:

- moving product logic into the SDK just because it exists first in one product
- rebuilding Relay foundation primitives here
- tying package interfaces to one backend or one surface too early
- introducing cloud-only assumptions into OSS package contracts

## Success Criteria

This roadmap succeeds when:

- products can adopt packages incrementally
- product repos keep their domain logic and velocity
- the SDK remains useful without any hosted cloud dependency
- a future cloud layer can build on the OSS contracts without forking them
