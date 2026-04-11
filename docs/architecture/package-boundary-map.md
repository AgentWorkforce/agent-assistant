# Package Boundary Map

Date: 2026-04-11
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — traits/persona layer added; implementation status reflected; reuse-first rule made explicit)

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

**Reuse-first rule for new implementations:** Before authoring a new package implementation workflow, inspect `relay` and related AgentWorkforce repos for reusable packages, contracts, or runtime capabilities. Only build new assistant-side code where a clear gap exists that is not already satisfied by Relay packages.

---

## Workforce Persona vs. Assistant Traits

These are distinct concerns that solve different problems. Do not conflate them.

**Workforce personas** are runtime execution profiles owned by Workforce infrastructure. A persona defines:
- system prompt
- model
- harness (Claude, Codex, OpenCode)
- harness settings
- optional skills
- service tiers (`best`, `best-value`, `minimum`)

Personas answer: **"What runtime configuration should this agent use to execute a task?"**

**Assistant traits** are identity and behavioral characteristics owned by this SDK (future `@relay-assistant/traits` package). Traits define:
- voice and communication style
- domain vocabulary and framing
- behavioral defaults (proactivity level, formality, risk tolerance)
- formatting preferences per surface
- personality continuity across sessions

Traits answer: **"How should this assistant present itself and behave across interactions?"**

A workforce persona's `systemPrompt` may **embed** trait values (e.g., "You are Sage, a knowledge-focused assistant who speaks concisely"), but the prompt is a persona artifact. Traits are the **source data** that prompts, formatters, and behavioral policies read from. Products compose traits into personas, not the other way around.

See [traits-and-persona-layer.md](traits-and-persona-layer.md) for the full boundary definition, integration points, and the proposed `@relay-assistant/traits` package spec.

---

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
- assistant identity traits (voice, style, behavioral defaults) — see `@relay-assistant/traits`
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

- workforce persona definitions (model, harness, system prompt, tier)
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

---

## Package Responsibilities

### `@relay-assistant/core`

**Implementation status: IMPLEMENTED — 44 tests passing, `SPEC_RECONCILED`**

Owns:

- `createAssistant()` and assistant definition types
- runtime lifecycle and capability registration
- assistant identity fields: `id`, `name`, `description?`
- lightweight composition entrypoints and shared cross-package types

Identity scope note:
- `core` owns `id`, `name`, `description?` — the minimum identity fields needed to run an assistant
- Behavioral identity (voice, style, vocabulary, proactivity) will live in `@relay-assistant/traits` when extracted
- `AssistantDefinition` does **not** have a `traits` field yet. When `@relay-assistant/traits` ships in v1.2, a `traits?: TraitsProvider` optional field will be added. Do not add it prematurely — the current types.ts has no such field and that is correct.

Composition note:
- `core` should not become a heavy package that hard-depends on every other package by default
- prefer interface-first composition and optional package wiring so consumers can adopt only the packages they need

Must not own:

- provider-specific transport code
- memory backend implementation details
- product workflows
- workforce persona definitions

### `@relay-assistant/traits` (planned — v1.2)

**Implementation status: NOT IMPLEMENTED — no spec, no types, no placeholder**

Owns:

- `AssistantTraits` type definition (voice, style, vocabulary, proactivity level, risk posture, formality, domain framing)
- `SurfaceFormattingTraits` type definition (per-surface-type formatting preferences that inform format hooks)
- `TraitsProvider` interface — a read-only accessor that packages can consume without hard-depending on traits
- `createTraitsProvider(traits: AssistantTraits)` factory
- Validation that trait values are within acceptable ranges/enums

Must not own:

- Persona definitions — those stay in workforce
- System prompts — those are persona artifacts, not traits
- Product-specific behavioral logic — stays in product repos
- Model selection or routing — stays in `routing`
- Memory or session state — stays in those packages

Dependency direction: traits has zero upstream dependencies on other SDK packages. It is a leaf data package.

See [traits-and-persona-layer.md](traits-and-persona-layer.md) for full spec.

### `@relay-assistant/memory`

**Implementation status: placeholder — spec exists (`v1-memory-spec.md`, `IMPLEMENTATION_READY`); roadmap: v1.1**

Implementation posture:

- first investigate and reuse the existing `@agent-relay/memory` package where possible
- prefer an assistant-facing adapter/composition layer over a greenfield memory engine
- only add new memory runtime logic here when assistant-specific requirements are not already satisfied by Relay memory capabilities

Owns:

- memory scopes such as user, session, workspace, org, and object
- retrieval, write, compaction, and promotion contracts
- memory adapter interfaces for future backends

Must not own:

- one product's tag taxonomy
- one surface's thread model as the only memory key shape

### `@relay-assistant/proactive`

**Implementation status: placeholder — no formal spec; roadmap: v1.2**

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

**Implementation status: IMPLEMENTED — 25 tests passing, `IMPLEMENTATION_READY`**

Owns:

- assistant session identity
- attachment of multiple surfaces to one assistant session
- resume, reattach, and affinity rules
- scoping rules across user, workspace, org, and object contexts

Must not own:

- raw transport sessions
- provider webhook semantics

### `@relay-assistant/surfaces`

**Implementation status: IMPLEMENTED — 28 tests passing, `SPEC_RECONCILED`**

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

**Implementation status: IMPLEMENTED — 45 tests passing**

Owns:

- coordinator and specialist registry contracts
- delegation plan and synthesis contracts
- many-agents-one-assistant orchestration semantics

Known gap (v1): coordinator does not pass `activeEscalations` to `router.decide()`. Escalation-routing pipeline is dormant. Document as v1 known gap; wire in v1.1.

Must not own:

- a fixed specialist lineup for any one product
- product-specific dispatch heuristics that cannot generalize

### `@relay-assistant/connectivity`

**Implementation status: IMPLEMENTED — 87 tests passing, `IMPLEMENTATION_READY`**

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

**Implementation status: IMPLEMENTED — 12 tests passing**

**Blocking DoD failure:** routing has 12 tests against a required 40+ target. Do not consume in products until resolved. See `docs/architecture/v1-routing-review-verdict.md` for F-1 (test count) and F-2 (escalated flag) details.

Owns:

- assistant-facing routing contracts
- latency/depth/cost response modes (`cheap`/`fast`/`deep` — SDK vocabulary, distinct from workforce tier names `minimum`/`best-value`/`best`)
- model-choice policy above raw provider clients
- integration points for workforce workload-router style persona/tier resolution

Must not own:

- raw transport routing
- provider SDK implementation details
- product-specific commercial routing rules
- workforce persona names or tier mapping — products map between SDK modes and workforce tiers

### `@relay-assistant/policy`

**Implementation status: placeholder — no formal spec; roadmap: v2**

Owns:

- approval modes
- external-action safeguards
- action risk classification
- audit hooks

Must not own:

- one product's commercial rules or customer-tier behavior

### `@relay-assistant/examples`

**Implementation status: placeholder**

Owns:

- reference examples showing how products should integrate the SDK
- skeletal example assistants and adoption patterns

Must not own:

- production product code
- private cloud adapters

---

## Extraction Guidance From Existing Systems

| Source | Signal | Destination |
| --- | --- | --- |
| Relay gateway and adapter infrastructure | transport, verification, normalization, raw actions | stay in Relay foundation |
| Sage memory and proactive behavior | reusable memory and follow-up patterns | `memory`, `proactive`, parts of `core` |
| Sage identity and communication style | voice, vocabulary, formality | `traits` (v1.2 extraction) |
| MSD session and surface convergence design | shared chat surface and runtime/session attachment | `sessions`, `surfaces`, parts of `core` |
| NightCTO specialist orchestration and per-client continuity | many-agents-one-assistant and proactive monitoring | `coordination`, `connectivity`, `policy`, `memory`, `proactive` |
| NightCTO founder-facing behavior | voice, risk posture, communication style | `traits` (v1.2 extraction) |
| Workforce workload-router and persona tiers | quality-preserving routing across depth/latency/cost envelopes | `routing`, parts of `core`, links to `coordination` |
| Workforce persona library | runtime execution profiles (model, harness, system prompt, tier) | stay in Workforce — NOT imported into SDK |

---

## Import Guidance For Consumers

Consumers should import only the package boundaries they need.

Examples:

- a simple assistant may import `@relay-assistant/core`, `@relay-assistant/sessions`, and `@relay-assistant/surfaces`
- a memory-heavy assistant may additionally import `@relay-assistant/memory`
- a specialist-based assistant may add `@relay-assistant/coordination` and `@relay-assistant/policy`
- an assistant with consistent behavioral identity may add `@relay-assistant/traits` (v1.2)

Consumers should not import Relay infrastructure directly to bypass assistant-level contracts unless they are implementing a transport adapter or other foundational infrastructure outside this repo.

**Consumers must not import workforce persona definitions into product code via this SDK.** Personas are workforce-owned runtime configs. Products compose traits (SDK) into personas (workforce) at the integration boundary.

## Future Advanced Capability: Cross-Agent Memory Consolidation

This should be treated as a **v5-v8 level** feature, not part of the initial memory slice.

Working concept:
- a librarian / night-crawler style capability that reconciles memories emitted by multiple agents
- deduplicates semantically overlapping facts
- preserves provenance, timestamps, and confidence
- resolves or marks contradictions
- publishes consolidated shared/team memory

Architectural implication for current memory work:
- memory data models should preserve enough provenance and confidence metadata to make future consolidation possible
- do not flatten memory records too aggressively if that would erase future reconciliation signals
