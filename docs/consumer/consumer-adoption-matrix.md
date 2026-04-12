# Consumer Adoption Matrix

**Date:** 2026-04-12
**Audience:** NightCTO, Sage, MSD
**Contract:** `docs/architecture/v1-consumer-adoption-contract.md`
**Purpose:** Side-by-side comparison of adoption path, packages, assembly reference, local concerns, and proof status for all three consumers.

---

## Package Adoption Comparison

| Package | NightCTO | Sage | MSD |
|---|---|---|---|
| `@relay-assistant/core` | **Adopt now** | **Adopt now** | **Adopt now** |
| `@relay-assistant/traits` | **Adopt now** | **Adopt now** | **Adopt now** |
| `@relay-assistant/policy` | **Adopt now** | Defer to v1.2 | **Adopt now** |
| `@relay-assistant/proactive` | **Adopt now** | **Adopt now** | Defer to v1.2 |
| `@relay-assistant/sessions` | Available (v1 baseline) | Available (v1 baseline) | Available (v1 baseline) |
| `@relay-assistant/surfaces` | Available (v1 baseline) | Available (v1 baseline) | Available (v1 baseline) |
| `@relay-assistant/memory` | Do not adopt (blocked) | Do not adopt (blocked — evaluate `@agent-relay/memory` first) | Do not adopt (blocked) |
| `@relay-assistant/coordination` | Do not adopt (blocked) | Do not adopt (blocked) | Do not adopt (blocked) |
| `@relay-assistant/connectivity` | Do not adopt (blocked) | Do not adopt (blocked) | Do not adopt (blocked) |
| `@relay-assistant/routing` | Do not adopt (DoD gap) | Do not adopt (DoD gap) | Do not adopt (DoD gap) |

**Package count (ready-now):** NightCTO 4/4 · Sage 3/4 · MSD 3/4

---

## Assembly Reference Comparison

| Dimension | NightCTO | Sage | MSD |
|---|---|---|---|
| **Primary example** | `05-full-assembly.ts` | `04-proactive-assistant.ts` | `03-policy-gated-assistant.ts` |
| **Complexity** | Full four-package composition | Three-package (core + traits + proactive) | Three-package (core + traits + policy) |
| **Stepping path** | Start directly at 05 | 01 → 02 → 04 | 01 → 03 → add 02 |
| **Future upgrade target** | Already at target | Add policy → upgrade to 05 at v1.2 | Add proactive → upgrade to 05 at v1.2 |
| **Known example gap** | Watch-trigger-to-policy path not yet in 05 | None at v1 | Non-allow decision paths only Inspectable in 03 |

---

## Adoption Order

| Order | Consumer | Rationale |
|---|---|---|
| **1st** | **NightCTO** | Exercises all four packages; proves proactive→policy bridge; de-risks Sage and MSD |
| **2nd** | **Sage** | Exercises proactive engine with different domain; validates traits with different personality |
| **3rd** | **MSD** | Exercises policy engine with different domain; validates adapter pattern independently |

---

## Product-Local Concerns Comparison

| Concern category | NightCTO keeps | Sage keeps | MSD keeps |
|---|---|---|---|
| Communication style / identity | Founder/CTO register, client-specific vocabulary | Workspace knowledge style, conversational tone | Technical reviewer voice, code-review-specific vocabulary |
| Domain logic | Client-tier rules, specialist lineup, escalation to human CTO | Workspace follow-up heuristics, context shaping, digest generation | PR workflow, review tools, risk classifier, coordinator delegation |
| Memory | Per-client continuity (until v1.1) | Workspace context assembly (until v1.1) | Review history (until v1.1) |
| Persona / Workforce concerns | Specialist persona definitions, service tiers | Sage workforce persona | MSD workforce persona |
| Infrastructure | Monitoring window definitions, escalation routing | Slack-specific behavior | Review escalation chains |

---

## Adapter Replacement Summary

| Adapter | NightCTO replacement | Sage replacement | MSD replacement |
|---|---|---|---|
| Inbound adapter (stub) | Relay inbound (NightCTO channels) | Relay inbound (Slack) | Relay inbound (MSD surfaces) |
| Outbound adapter (stub) | Relay outbound (NightCTO delivery) | Relay outbound (Slack delivery) | Relay outbound (MSD delivery) |
| `InMemorySchedulerBinding` | Relay cron substrate | Relay cron substrate | N/A at v1 (proactive deferred) |
| `InMemoryAuditSink` | NightCTO audit infrastructure | N/A at v1 (policy deferred) | MSD code review audit log |
| Trait values | formal, assertive, executive-advisory | conversational, high-proactivity, knowledge-and-workspace | technical, cautious, code-review |
| Policy rules | block-cross-client-data, escalate-critical | N/A at v1 | block-destructive, approve-pr-merge, approve-code-deploy |
| Proactive rules | client-status-check-in (12h idle) | Workspace-activity follow-up conditions | N/A at v1 |

---

## Proof Status Comparison

| Proof category | NightCTO status | Sage status | MSD status |
|---|---|---|---|
| Assembly (createAssistant + lifecycle) | Inspectable post-wiring | Inspectable post-wiring | Inspectable post-wiring |
| Traits (frozen, handler-readable) | Inspectable | Inspectable | Inspectable |
| Policy rules registered | Inspectable | Planned (v1.2) | Inspectable |
| Policy four-branch handling | Inspectable (deny/require/escalate stubbed ok at v1) | Planned (v1.2) | Inspectable (non-allow branches not yet driven) |
| Proactive rule registered | Inspectable | Inspectable | Planned (v1.2) |
| Proactive evaluateFollowUp called | Inspectable | Inspectable | Planned (v1.2) |
| Proactive→policy bridge | Inspectable | Planned (v1.2) | Planned (v1.2) |
| Watch-trigger-to-policy path | **Planned** (example gap) | N/A at v1 | N/A at v1 |
| Concrete Relay adapters wired | Planned (Relay wiring) | Planned (Relay wiring) | Planned (Relay wiring) |
| Boundary proof (no SDK contamination) | Planned (verify at wiring) | Planned (verify at wiring) | Planned (verify at wiring) |

---

## Immediate Blockers Comparison

| Blocker | NightCTO | Sage | MSD |
|---|---|---|---|
| Relay adapter wiring | **Yes — blocks real traffic** | **Yes — blocks real traffic** | **Yes — blocks real traffic** |
| Relay cron wiring | **Yes — blocks proactive monitoring** | **Yes — blocks proactive follow-up** | N/A at v1 |
| Production audit sink | Yes — InMemoryAuditSink not for production | N/A at v1 | Yes — InMemoryAuditSink not for production |
| Watch-trigger path (example gap) | **Yes — NightCTO must implement product-side** | N/A | N/A |
| Follow-up condition authoring | Yes — product must define conditions | **Yes — most product-specific item** | N/A at v1 |
| Risk classifier implementation | N/A | N/A | **Yes — required before policy decisions are meaningful** |
| Non-allow branch coverage | Inspectable only at v1 | N/A at v1 | **Yes — MSD should drive these in product tests** |
| Memory strategy decision | Defer to v1.1 | **Yes — must evaluate `@agent-relay/memory` before building** | Defer to v1.1 |

---

## Deferred Package Schedule Comparison

| Package | NightCTO defer reason | Sage defer reason | MSD defer reason |
|---|---|---|---|
| `@relay-assistant/memory` | `@agent-relay/memory` dep blocked; v1.1 | Evaluate existing Relay memory first; v1.1 | `@agent-relay/memory` dep blocked; v1.1 |
| `@relay-assistant/policy` | N/A — adopted now | v1.2 — when proactive needs gating | N/A — adopted now |
| `@relay-assistant/proactive` | N/A — adopted now | N/A — adopted now | v1.2 — when PR follow-up prioritized |
| `@relay-assistant/coordination` | v1.2 — nanoid/connectivity unblocked | v1.2 — lower priority for Sage | v1.2 — nanoid/connectivity unblocked |
| `@relay-assistant/connectivity` | v1.2 — nanoid dep prerequisite | v1.2 — nanoid dep prerequisite | v1.2 — nanoid dep prerequisite |

---

## Scoring Summary (from contract section 4)

| Criterion | NightCTO | Sage | MSD |
|---|---|---|---|
| Package coverage | 4/4 | 3/4 | 3/4 |
| Assembly complexity | Full (`05-full-assembly.ts`) | Partial (`04-proactive-assistant.ts`) | Partial (`03-policy-gated-assistant.ts`) |
| Adoption friction | Medium (four packages, clear example) | Low (three packages, simpler composition) | Low (three packages, simpler composition) |
| Proof value | **High** — proves all four packages and proactive→policy bridge | Medium — proves proactive engine | Medium — proves policy engine |
| **Recommended order** | **1st** | 2nd | 3rd |

CONSUMER_ADOPTION_MATRIX_READY
