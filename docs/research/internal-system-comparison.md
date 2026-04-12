# Internal System Comparison

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-11
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — implementation status added; workforce persona vs traits distinction made explicit)

## Purpose

Compare current internal systems to identify the assistant-runtime capabilities that should become shared SDK packages.

## Implementation Status as of 2026-04-11

Six packages are implemented and passing tests. This table reflects the current state of extraction:

| Signal source | Packages it justified | Implemented? |
| --- | --- | --- |
| MSD session/surface design | `sessions`, `surfaces`, `core` | Yes — 31/25/28 tests passing |
| NightCTO orchestration | `coordination`, `connectivity` | Yes — 39/30 tests passing |
| Workforce routing model | `routing` | Yes — 12 tests (DoD gap; not yet production-ready) |
| Sage memory/proactive patterns | `memory`, `proactive` | No — planned v1.1/v1.2 |
| Sage + NightCTO identity patterns | `traits` | No — planned v1.2 |
| All products | `policy` | No — planned v2 |

---

## Summary Table

| System | Strongest signal | What should inform this repo | What should stay product- or infra-specific |
| --- | --- | --- | --- |
| Relay foundation | transport and action substrate | normalized message, delivery, session substrate integration points | provider adapters, auth, webhook verification, raw action dispatch |
| Sage | memory and proactive continuity; identity and voice | memory contracts, follow-up engine concepts, stale-session patterns, traits extraction signal | workspace-specific prompt behavior, product heuristics, workforce persona definitions |
| MSD | session and multi-surface convergence | assistant session model, surface attachment rules, runtime composition | review workflows, review tools, PR-specific logic, workforce persona definitions |
| NightCTO | many-agents-one-assistant orchestration; founder-facing identity | coordination contracts, policy hooks, per-client continuity patterns, traits extraction signal | founder-facing product behavior, specialist lineup, service policy, workforce persona definitions |
| Workforce | routing, persona tiers, and budget envelopes | assistant-facing routing contracts, latency/depth/cost policy, quality-preserving tier selection | persona library, persona definitions, tier names — stay in Workforce |

---

## Workforce Persona vs. Assistant Traits

This is the most important boundary to understand before building against this SDK.

**Workforce personas** are runtime execution profiles (model, harness, system prompt, service tier). They are defined and owned in Workforce infrastructure. They answer: "What runtime configuration should this agent use to execute a task?"

**Assistant traits** are identity and behavioral characteristics (voice, style, vocabulary, proactivity, risk posture). They will live in `@relay-assistant/traits` when extracted. They answer: "How should this assistant present itself and behave across interactions?"

A workforce persona's `systemPrompt` may embed trait values, but the prompt is a persona artifact. Traits are the source data. Products compose traits into personas, not the other way around.

See [traits-and-persona-layer.md](../architecture/traits-and-persona-layer.md) for the full boundary definition.

---

## Relay Foundation

Relay already appears to own the substrate this repo should build on:

- transport adapters
- inbound normalization
- outbound delivery
- auth and connection wiring
- scheduler substrate
- low-level action dispatch

Implication:

- this repo should compose with Relay
- this repo should not recreate transport infrastructure

---

## Sage

Sage contributes the strongest memory and proactive signals:

- persistent conversation or workspace continuity
- memory load and save behavior
- follow-up and stale-thread thinking
- context-aware reminders

Sage also contributes the clearest identity signal for `@relay-assistant/traits` extraction:

- concise, knowledge-focused communication style
- workspace-specific vocabulary and framing
- medium proactivity level

Implication:

- memory and proactive packages are justified
- those packages should capture general contracts, not Sage's exact product behavior
- Sage's local trait object is a primary extraction signal for `@relay-assistant/traits` at v1.2
- Sage's workforce persona definitions stay in Sage/Workforce — they are not SDK concerns

---

## MSD

MSD contributes the strongest session and surface signals:

- one assistant experience across multiple surfaces
- shared session semantics
- orchestrator or runtime assignment concepts
- strong need for policy around external review actions

Implication:

- `sessions` and `surfaces` should be first-class packages
- `core` and `policy` should support multi-surface runtime composition without being review-specific
- MSD's workforce persona definitions stay in Workforce

---

## NightCTO

NightCTO contributes the strongest coordination signals:

- multiple internal specialists behind one assistant face
- per-client continuity and persistence
- proactive monitoring behavior
- need for governance and auditability

NightCTO also contributes a strong identity signal for traits extraction:

- founder/CTO communication register
- high-stakes risk posture
- client-specific vocabulary and framing

Implication:

- `coordination`, `policy`, `memory`, and `proactive` are all justified
- the many-agents-one-assistant model is not hypothetical; it already has a clear internal use case
- NightCTO's local trait object is a primary extraction signal for `@relay-assistant/traits` alongside Sage
- NightCTO's workforce personas and service-tier policy stay in Workforce

---

## Cross-System Synthesis

Across the internal systems, the same assistant concerns keep recurring:

- continuity over time
- continuity across surfaces
- proactive behavior
- coordinated specialists
- focused internal connectivity
- policy around external actions
- consistent identity and behavioral voice across sessions and surfaces

This is enough evidence to justify a dedicated assistant SDK layer and a dedicated traits layer.

---

## Overlap And Tension Analysis

### Sage vs NightCTO on memory

Sage's memory signals emphasize conversation continuity, workspace context retention, and proactive follow-up evidence. NightCTO's memory signals emphasize per-client continuity, specialist context, and durable service relationships.

Shared implication:
- a future `MemoryStore` interface must support more than one scope shape
- the memory layer cannot assume that every durable object is just a chat thread
- the likely shared scopes are user, session, workspace, org, and object/client

### MSD vs Sage on sessions and surfaces

MSD's strongest contribution is shared session convergence across multiple surfaces. Sage currently shows more product-specific memory and proactive behavior, but its runtime still implies the need for consistent session continuity when the assistant appears in multiple places.

Shared implication:
- the session layer should treat surfaces as attachments to one assistant session rather than as the primary continuity object
- that abstraction is likely reusable across both product styles

### NightCTO vs MSD on coordination

NightCTO makes the specialist pattern explicit through registry, dispatch, triage, and proactive flows. MSD's architecture implies orchestrator/notifier/reviewer roles and multi-surface runtime composition.

Shared implication:
- coordination should be separated from domain-specific specialist lineups
- both products need many-agents-one-assistant semantics even though their domains differ

### Why connectivity deserves its own package

The internal systems do not merely need transport; they need efficient communication between sophisticated subsystems.

This communication is not generic chatter. It needs to be:
- low-latency
- selective
- high-signal
- oriented toward convergence
- able to carry attention, uncertainty, escalation, and synthesis cues

That is why a distinct `@relay-assistant/connectivity` package is justified above Relay transport and alongside coordination.

### Why traits deserve their own package

Sage, MSD, and NightCTO all have product-local patterns for how their assistants present themselves. The field shapes overlap (voice, formality, proactivity, risk posture). Extracting these into a shared `@relay-assistant/traits` package is justified when two or more products have defined local trait objects with overlapping shapes.

The extraction should not happen before those patterns exist in the products. Define local trait objects first; extract when there is concrete overlap to generalize.

---

## Boundary Conclusion

The right separation is:

- Relay foundation for transport and substrate
- `relay-agent-assistant` for shared assistant runtime contracts and identity traits
- Workforce for runtime execution profiles (personas, tiers, model selection)
- product repos for domain behavior, product-specific persona definitions, and product policy

That separation is consistent with all three product directions and does not require cloud-specific assumptions.

---

## Workforce

Workforce contributes the strongest routing and token-budgeting signals:

- intent to persona selection
- tiered runtimes (`minimum`, `best-value`, `best`)
- explicit depth/latency/cost envelopes
- routing profiles that preserve quality while changing operating envelope

Implication:

- `routing` should be a first-class assistant-sdk package
- the assistant SDK should align with workforce workload-router concepts instead of inventing a divergent model-choice layer
- latency and cost policy should be explicit runtime concerns rather than ad hoc product logic
- SDK routing modes (`cheap`/`fast`/`deep`) are SDK vocabulary; workforce tier names (`minimum`/`best-value`/`best`) stay in Workforce; products map between them
- workforce persona definitions remain Workforce-owned and are not imported into this SDK


## Future Differentiator: Cross-Agent Memory Consolidation

One likely differentiator for this SDK is support for a later-stage librarian/night-crawler style capability that consolidates memories across multiple agents sharing channels, trajectories, and partial memory overlap.

Most current frameworks still assume one agent and one memory surface. A future **v5-v8 level** consolidation layer would let the system:
- deduplicate facts across agents
- resolve or mark contradictions
- preserve provenance and confidence
- publish consolidated shared/team memory

This should not be pulled into the first memory implementation, but the current architecture should explicitly preserve the metadata needed for it later.
