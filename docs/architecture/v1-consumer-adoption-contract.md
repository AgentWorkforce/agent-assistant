# v1 Consumer Adoption Contract

**Date:** 2026-04-12
**Audience:** NightCTO, Sage, My Senior Dev (MSD)
**Purpose:** Define what an adoption-path deliverable must include, how to distinguish ready-now from defer-later packages, what stays local in each consumer, how to choose the best first adopter, and what proof of adoption-readiness is required.

---

## 1. What an Adoption-Path Deliverable Must Include

Every consumer adoption deliverable must contain exactly these sections. Omitting any section makes the deliverable incomplete.

### Required sections per consumer

| Section | What it contains | Why it matters |
|---|---|---|
| **Package manifest** | Exact list of SDK packages the consumer adopts now, with version/status | Prevents adoption of blocked or DoD-failing packages |
| **Assembly file reference** | Which example file(s) from `packages/examples/src/` the consumer starts from | Anchors adoption to tested composition patterns, not prose |
| **Product-local inventory** | Explicit list of concerns that stay in the consumer's own repo | Prevents scope creep into the SDK and keeps product velocity |
| **Adapter replacement table** | For each in-memory stub in the referenced example, the concrete Relay or product adapter that replaces it | Makes adoption mechanically actionable, not aspirational |
| **Proof checklist** | Specific assertions the consumer must pass to confirm successful wiring | Defines done for adoption — see section 5 |
| **Deferred package schedule** | Which packages the consumer will adopt later and what milestone unblocks them | Prevents premature adoption of blocked packages |

### Deliverable shape

A consumer adoption deliverable is a single markdown document per consumer (e.g., `docs/consumer/nightcto-adoption-path.md`) that follows this template:

```
# [Product] Adoption Path
## Package Manifest (adopt now)
## Assembly Reference
## Product-Local Inventory
## Adapter Replacement Table
## Proof Checklist
## Deferred Packages
```

---

## 2. How to Distinguish Ready-Now from Defer-Later Packages

### Decision rule

A package is **ready-now** if and only if all three conditions hold:

1. Implementation exists with passing tests (not just claimed — verified via `npx vitest run`)
2. No blocking dependency gaps (no missing `nanoid`, no missing `@agent-relay/memory`, etc.)
3. Test count meets or exceeds the package's Definition of Done target

A package is **defer-later** if any of those conditions fail.

### Current classification (2026-04-12)

| Package | Ready-now? | Gate |
|---|---|---|
| `@agent-assistant/core` | **Yes** | 31 tests passing, SPEC_RECONCILED |
| `@agent-assistant/traits` | **Yes** | 32 tests passing, no downstream deps |
| `@agent-assistant/policy` | **Yes** | 64 tests passing |
| `@agent-assistant/proactive` | **Yes** | 45 tests passing |
| `@agent-assistant/sessions` | **Yes** | 25 tests passing, v1 baseline |
| `@agent-assistant/surfaces` | **Yes** | 28 tests passing, v1 baseline |
| `@agent-assistant/memory` | **No** | Placeholder — `@agent-relay/memory` dep missing; v1.1 milestone |
| `@agent-assistant/routing` | **No** | 12/40+ tests — DoD gap |
| `@agent-assistant/coordination` | **No** | Tests blocked — connectivity import failure |
| `@agent-assistant/connectivity` | **No** | Tests blocked — `nanoid` dep missing |

### Rule for consumers

- Adopt only ready-now packages.
- Do not adopt defer-later packages even if the consumer's ideal path calls for them.
- When a defer-later package becomes ready-now, the consumer adds it via the deferred package schedule in their adoption deliverable.

---

## 3. What Stays Local in Each Consumer Repo

### NightCTO — keeps local

| Concern | Reason |
|---|---|
| Founder/CTO communication style and register | Highly personalized — not generalizable across products |
| Specialist lineup and dispatch logic | NightCTO's internal agent roster is product-specific |
| Client-tier policy rules and service agreements | Business rules that vary per client engagement |
| Per-client memory and relationship continuity | Until `@agent-assistant/memory` ships; even then, client-tier scoping is NightCTO-owned |
| Escalation routing and human-CTO notification | Product UX concern, not an SDK contract |
| Monitoring window definitions | Domain-specific scheduling logic |

### Sage — keeps local

| Concern | Reason |
|---|---|
| Workspace knowledge workflows and context shaping | Product domain — does not generalize |
| Product-specific follow-up heuristics (conditions) | Sage product logic — delivered as `condition` functions on proactive rules |
| Slack-specific behavior not general enough yet | May move to SDK later if MSD/NightCTO also need it |
| Memory retrieval and workspace context assembly | Until `@agent-assistant/memory` ships in v1.1 |
| Knowledge digest generation | Sage-specific output format |

### MSD — keeps local

| Concern | Reason |
|---|---|
| Code review operations and PR workflow tools | MSD-specific domain — does not generalize |
| Review-specific orchestration and delegation | Until `@agent-assistant/coordination` ships and only if the pattern generalizes |
| Action risk classifier taxonomy | MSD's risk categories are domain-specific (merge, deploy, comment, approve) |
| Review escalation chains | Business rules owned by MSD |
| Coordinator/notifier/reviewer role dispatch | Product-specific multi-agent pattern — keep local until coordination package unblocks |

### Cross-consumer invariant

No consumer should move the following into the SDK:
- Workforce persona definitions (model, harness, system prompt, tier) — these stay in Workforce
- Product prompts and instruction sets
- Product dashboards or UI
- Commercial rules (pricing, tiering, escalation)
- One-off automations that serve only one product

---

## 4. Choosing the Best First Adopter

### Evaluation criteria

Score each consumer on these four dimensions:

| Criterion | What it measures | Why it matters |
|---|---|---|
| **Package coverage** | How many ready-now packages the consumer needs | More packages exercised = more SDK validation per adoption |
| **Assembly complexity** | Whether the consumer needs the full four-package composition | Full assembly proves the hardest composition patterns |
| **Adoption friction** | How much product-side restructuring is required before wiring | Lower friction = faster proof of value |
| **Proof value** | What the adoption proves for the other two consumers | High proof value reduces risk for subsequent adopters |

### Scoring (2026-04-12)

| Criterion | NightCTO | Sage | MSD |
|---|---|---|---|
| Package coverage | 4/4 (core, traits, policy, proactive) | 3/4 (core, traits, proactive) | 3/4 (core, traits, policy) |
| Assembly complexity | Full (`05-full-assembly.ts`) | Partial (`04-proactive-assistant.ts`) | Partial (`03-policy-gated-assistant.ts`) |
| Adoption friction | Medium — needs four packages wired, but clear example exists | Low — three packages, simpler composition | Low — three packages, simpler composition |
| Proof value | **High** — proves all four packages compose correctly; validates the proactive→policy bridge that both Sage and MSD will eventually need | Medium — proves proactive engine but not policy gating | Medium — proves policy gating but not proactive engine |

### Recommendation

**NightCTO is the best first adopter.**

Rationale:
1. It exercises all four ready-now packages in one assembly, which no other consumer does at v1
2. It proves the proactive→policy bridge — the hardest composition pattern — which both Sage and MSD will need later
3. `05-full-assembly.ts` already exists as the canonical reference, reducing implementation guesswork
4. Success with NightCTO de-risks Sage and MSD adoption by proving the full composition path
5. NightCTO's monitoring-heavy, policy-governed architecture is the most demanding consumer — if it works for NightCTO, the simpler Sage and MSD paths are lower risk

**Second adopter:** Sage (adds proactive engine validation with different domain rules).
**Third adopter:** MSD (adds policy engine validation with different domain rules).

### Adoption order for weekend product goal

| Order | Consumer | Assembly reference | Expected outcome |
|---|---|---|---|
| 1st | NightCTO | `05-full-assembly.ts` | Full four-package composition proven; proactive→policy bridge validated |
| 2nd | Sage | `04-proactive-assistant.ts` → `05` later | Proactive engine proven with knowledge-domain rules; traits validated with different personality |
| 3rd | MSD | `03-policy-gated-assistant.ts` → `05` later | Policy engine proven with code-review domain rules; adapter pattern validated independently |

---

## 5. Proof of Adoption-Readiness Required in Docs

### What counts as proof

Adoption-readiness is not proven by prose descriptions. It is proven by specific, verifiable assertions.

### Required proof artifacts per consumer

Each consumer adoption deliverable must include a proof checklist with these categories:

#### A. Assembly proof (all consumers)

- [ ] `createAssistant()` called with a valid `AssistantDefinition` containing product-specific capabilities
- [ ] `runtime.start()` completes without error
- [ ] At least one inbound message dispatches to the correct capability handler
- [ ] `runtime.stop()` completes without error
- [ ] In-memory adapter stubs replaced with concrete adapter references (even if the concrete adapter is still a TODO — the replacement target must be named)

#### B. Package-specific proof

**Traits (all consumers):**
- [ ] `createTraitsProvider()` called with product-specific trait values
- [ ] `runtime.definition.traits` is frozen and accessible in capability handlers
- [ ] At least one handler reads a trait value and uses it to influence output

**Policy (MSD, NightCTO):**
- [ ] `createActionPolicy()` called with product-specific audit sink
- [ ] At least one product-specific rule registered via `policyEngine.registerRule()`
- [ ] Capability handler constructs an `Action` from the inbound message and calls `policyEngine.evaluate()`
- [ ] All four decision branches (`allow`, `deny`, `require_approval`, `escalate`) have handling code, even if some are stubbed

**Proactive (Sage, NightCTO):**
- [ ] `createProactiveEngine()` called with a scheduler binding
- [ ] At least one follow-up rule registered with a product-specific `condition` function
- [ ] `proactiveEngine.evaluateFollowUp()` called and decisions inspected
- [ ] Engine retrievable from runtime via `runtime.get('proactive')`

**Proactive→Policy bridge (NightCTO, later Sage and MSD):**
- [ ] `followUpToAction()` or equivalent bridge function defined in product code
- [ ] At least one proactive `fire` decision converted to an `Action` and evaluated by `policyEngine.evaluate()`
- [ ] Policy audit trail contains entries for both inbound-originated and proactive-originated actions

#### C. Boundary proof (all consumers)

- [ ] No product-specific logic exists inside SDK package source code
- [ ] No SDK package imports another SDK package at runtime (composition happens in product code only)
- [ ] Product-local concerns listed in the adoption deliverable are confirmed to remain in the product repo

### Proof format in docs

Each proof item must be one of:
- **Demonstrated:** the assertion is exercised in a runnable example or test
- **Inspectable:** the assertion is visible in source code but not executed in an automated test
- **Planned:** the assertion cannot be verified yet due to a deferred dependency

Do not claim "Demonstrated" for items that are only "Inspectable." The assembly review verdict (see `v1-assistant-assembly-examples-review-verdict.md`) flagged this as a recurring problem — be precise.

### Where proof lives

- SDK-level proof: `packages/examples/src/` files and their proof scenarios in `packages/examples/README.md`
- Consumer-level proof: each consumer's adoption-path document, proof checklist section
- Cross-consumer proof: `docs/consumer/v1-product-adoption-matrix.md` — the canonical mapping of which examples and packages apply to each consumer

---

## Reconciliation Notes

### Stale guidance in existing docs

The "Product-Specific Guidance" section in `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md` (lines 54-104) recommends packages that the same document's v1 readiness table (lines 154-171) marks as not ready for adoption:
- Sage starting with `memory` — memory is a placeholder, not ready
- NightCTO starting with `coordination` and `memory` — both are blocked

**This contract supersedes that stale guidance.** The ready-now classification in section 2 above is authoritative. The stale guidance should be reconciled in a follow-up edit to `how-products-should-adopt-agent-assistant-sdk.md`.

### Assembly review follow-ups

The assembly review verdict (`v1-assistant-assembly-examples-review-verdict.md`) identified four required follow-ups. Two affect this contract:

1. `05-full-assembly.ts` does not yet exercise watch-trigger-to-policy flow — NightCTO's adoption proof should track this gap explicitly until resolved
2. `03-policy-gated-assistant.ts` only drives the `allow` path — MSD's adoption proof should note which decision branches are "Inspectable" vs. "Demonstrated"

These gaps do not block adoption planning but must be tracked in the consumer adoption deliverables.

---

## Contract Summary

| Question | Answer |
|---|---|
| What must an adoption deliverable include? | Package manifest, assembly reference, product-local inventory, adapter replacement table, proof checklist, deferred schedule |
| How do we distinguish ready-now vs. defer-later? | Three gates: tests pass, no dep gaps, test count meets DoD |
| What stays local? | Product prompts, tools, business policy, domain workflows, persona definitions |
| Who adopts first? | **NightCTO** — exercises all four packages, proves the hardest bridge, de-risks the other two |
| What proof is required? | Specific assertions categorized as Demonstrated, Inspectable, or Planned — no uncategorized claims |

---

V1_CONSUMER_ADOPTION_CONTRACT_READY
