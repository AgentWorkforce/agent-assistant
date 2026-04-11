# Relay Agent Assistant

Shared open-source assistant SDK/runtime for AgentWorkforce products such as Sage, MSD, NightCTO, and future assistants.

## What This Repo Is

This repository defines the shared assistant layer that sits above Relay foundation infrastructure and below product-specific assistants.

It exists to centralize assistant concerns that should not be reimplemented in every product:

- assistant identity and runtime composition
- memory contracts and shared retrieval/persistence patterns
- session continuity across surfaces
- proactive behavior and scheduled follow-up engines
- multi-agent coordination behind one assistant identity
- policy, approvals, and audit hooks

## Current Status

**6 packages implemented and passing tests. 4 packages are placeholder/README-only. 1 package (traits) is planned for v1.2.**

Implementation vs specification status at a glance:

| Package | Implementation | Spec | Tests | Notes |
| --- | --- | --- | --- | --- |
| `@relay-assistant/core` | **IMPLEMENTED** | `SPEC_RECONCILED` | 44 pass | matches `v1-core-spec.md` |
| `@relay-assistant/sessions` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | 25 pass | matches `v1-sessions-spec.md` |
| `@relay-assistant/surfaces` | **IMPLEMENTED** | `SPEC_RECONCILED` | 28 pass | matches `v1-surfaces-spec.md` |
| `@relay-assistant/routing` | **IMPLEMENTED** (DoD gap) | `IMPLEMENTATION_READY` | 12 pass | test count below 40+ DoD target — **do not consume in products until resolved** |
| `@relay-assistant/connectivity` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | 87 pass | matches `v1-connectivity-spec.md` |
| `@relay-assistant/coordination` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | 45 pass | routing integration reviewed; escalation pipeline dormant (v1 known gap) |
| `@relay-assistant/memory` | **placeholder** | `IMPLEMENTATION_READY` | — | spec exists at `docs/specs/v1-memory-spec.md`; roadmap: v1.1 |
| `@relay-assistant/policy` | **placeholder** | none | — | no formal spec yet; roadmap: v2 |
| `@relay-assistant/proactive` | **placeholder** | none | — | no formal spec yet; roadmap: v1.2 |
| `@relay-assistant/examples` | **placeholder** | N/A | — | reference examples; not production code |
| `@relay-assistant/traits` | **planned — v1.2** | none | — | assistant identity traits, voice, style, behavioral defaults — see [traits and persona layer](docs/architecture/traits-and-persona-layer.md) |

**Total implemented: 241 tests, all passing.**

**Blocking DoD failure:** `@relay-assistant/routing` has 12 tests against a 40+ target. Do not wire routing into product integration until resolved.

---

## What Consumers Should Expect

Products import focused SDK packages from this repo. The v1 baseline (stable for product adapter work):

- `@relay-assistant/core`
- `@relay-assistant/sessions`
- `@relay-assistant/surfaces`

Beyond v1 (implemented, review before consuming):

- `@relay-assistant/coordination`
- `@relay-assistant/connectivity`
- `@relay-assistant/routing` (**gated** — routing tests below DoD; see above)

Planned for future milestones:

- `@relay-assistant/memory` — v1.1
- `@relay-assistant/traits` — v1.2
- `@relay-assistant/proactive` — v1.2
- `@relay-assistant/policy` — v2

Products such as Sage, MSD, and NightCTO should use this repo for reusable assistant runtime behavior while keeping their own domain logic, prompts, tools, UI, and product policy in their own repositories.

---

## Layer Model

### Relay foundation stays elsewhere

Keep these concerns in Relay family repos such as `relay`, `gateway`, `relaycron`, `relayauth`, and `relayfile`:

- transport adapters and webhook verification
- normalized inbound/outbound message primitives
- channel/session transport substrate
- auth and connection wiring
- low-level action dispatch
- scheduler and wake-up infrastructure
- relaycast and transport observability

### Assistant SDK lives here

This repo should own reusable assistant behavior built on top of Relay primitives:

- assistant construction and lifecycle
- memory scopes and adapters
- proactive engines and watch rules
- assistant session models
- assistant-facing surface contracts
- specialist coordination
- action policy and audit integration

### Product logic stays in product repos

Keep these concerns in Sage, MSD, NightCTO, and future product repositories:

- prompts, workforce persona definitions, and persona behavior beyond baseline identity
- product-specific workflows and tools
- domain-specific watchers and automations
- product UX and dashboards
- pricing, tiering, escalation, and customer policy

> **Workforce persona vs. assistant traits:** Workforce personas are runtime execution profiles (model, harness, system prompt, tier). Assistant traits are identity and behavioral characteristics (voice, style, vocabulary, proactivity). These are distinct. See [traits and persona layer](docs/architecture/traits-and-persona-layer.md) for the full boundary definition.

---

## Package Map

| Package | Purpose | Status |
| --- | --- | --- |
| `@relay-assistant/core` | Assistant definition, lifecycle, shared runtime composition | **IMPLEMENTED** |
| `@relay-assistant/sessions` | Cross-surface session identity, resume, attachment rules | **IMPLEMENTED** |
| `@relay-assistant/surfaces` | Assistant-facing surface abstractions above Relay transport | **IMPLEMENTED** |
| `@relay-assistant/routing` | Model-choice, latency/depth/cost routing, workload-router-aligned policy | **IMPLEMENTED** (DoD gap — see above) |
| `@relay-assistant/connectivity` | Efficient inter-agent signaling, convergence, escalation, and communication contracts | **IMPLEMENTED** |
| `@relay-assistant/coordination` | Coordinator/specialist orchestration and synthesis contracts | **IMPLEMENTED** |
| `@relay-assistant/traits` | Assistant identity traits: voice, style, vocabulary, behavioral defaults, surface formatting preferences | **planned — v1.2** |
| `@relay-assistant/memory` | Memory scopes, stores, retrieval, promotion, compaction hooks | placeholder — v1.1 |
| `@relay-assistant/proactive` | Follow-up engines, watch rules, scheduler bindings | placeholder — v1.2 |
| `@relay-assistant/policy` | Approvals, external-action safeguards, audit hooks | placeholder — v2 |
| `@relay-assistant/examples` | Reference adoption examples, not production product code | placeholder |

---

## Read This First

- [Docs index](docs/index.md)
- [Package boundary map](docs/architecture/package-boundary-map.md)
- [Traits and persona layer](docs/architecture/traits-and-persona-layer.md)
- [SDK audit and alignment plan](docs/architecture/sdk-audit-and-traits-alignment-plan.md)
- [Connectivity package spec](docs/architecture/connectivity-package-spec.md)
- [Extraction roadmap](docs/architecture/extraction-roadmap.md)
- [OSS vs cloud split](docs/architecture/oss-vs-cloud-split.md)
- [How to build an assistant](docs/consumer/how-to-build-an-assistant.md)
- [How products should adopt this SDK](docs/consumer/how-products-should-adopt-relay-agent-assistant.md)
- [Connectivity adoption guide](docs/consumer/connectivity-adoption-guide.md)
- [Connectivity patterns research](docs/research/connectivity-patterns.md)
- [Internal system comparison](docs/research/internal-system-comparison.md)
- [Glossary](docs/reference/glossary.md)

---

## Implementation Direction

This repository should become the OSS core.

A later cloud implementation should be built on top of the OSS SDK in a separate package or repo, similar in spirit to other AgentWorkforce properties that keep the reusable core open-source and place Cloudflare-backed adapters and hosted infrastructure in a distinct cloud layer.

That later cloud layer should depend on this SDK, not replace it.

---

## Initial Adoption Rule

If a capability is reusable across multiple assistants with only configuration or adapter changes, it belongs here.

If a capability depends on product-specific ontology, customer workflow, or product policy, it stays in the product repo.

**Reuse-first rule for new package work:** Before authoring a new package implementation, inspect `relay` and related AgentWorkforce repos for reusable packages, contracts, or runtime capabilities. For memory specifically, treat `@relay-assistant/memory` as an assistant-facing adapter/composition layer over `@agent-relay/memory`, not a greenfield memory engine.

SDK_AUDIT_STATUS_UPDATED

## Future advanced memory direction

A later-stage capability of the SDK should be **cross-agent memory consolidation** (a librarian / night-crawler style layer). This is not a v1 feature. Treat it as a **v5-v8 level** capability that depends on stable memory, coordination, and connectivity foundations.

The purpose of that future layer is to:
- deduplicate facts produced by multiple agents
- reconcile contradictions
- preserve provenance and confidence
- publish consolidated shared/team memory

This is one of the places where the assistant SDK intentionally differs from one-agent/one-memory frameworks.


## Cloud boundary

RelayAssistant does not require a separate `relay-assistant-cloud` repo. Hosted/cloud implementation work should use the existing `AgentWorkforce/cloud` repo as the infrastructure layer behind the SDK.
