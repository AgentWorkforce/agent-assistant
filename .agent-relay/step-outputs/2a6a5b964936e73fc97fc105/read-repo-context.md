---README---
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

This repo is intentionally docs-first. It establishes package boundaries, adoption guidance, and extraction order before implementation code is introduced.

Connectivity is one of the sharper early package candidates because internal assistant communication needs stronger rules than generic chatter. The package spike is documented here:

-  onnectivity package README](packages/connectivity/README.md)
-  onnectivity package spec](docs/architecture/connectivity-package-spec.md)
-  onnectivity adoption guide](docs/consumer/connectivity-adoption-guide.md)
-  onnectivity patterns research](docs/research/connectivity-patterns.md)

## What Consumers Should Expect

Products should eventually import focused SDK packages from this repo, for example:

- `@relay-assistant/core`
- `@relay-assistant/memory`
- `@relay-assistant/proactive`
- `@relay-assistant/sessions`
- `@relay-assistant/surfaces`
- `@relay-assistant/coordination`
- `@relay-assistant/connectivity`
- `@relay-assistant/routing`
- `@relay-assistant/policy`

Products such as Sage, MSD, and NightCTO should use this repo for reusable assistant runtime behavior while keeping their own domain logic, prompts, tools, UI, and product policy in their own repositories.

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

- prompts and persona details beyond baseline identity fields
- product-specific workflows and tools
- domain-specific watchers and automations
- product UX and dashboards
- pricing, tiering, escalation, and customer policy

## Package Map

| Package | Purpose |
| --- | --- |
| `@relay-assistant/core` | Assistant definition, lifecycle, shared runtime composition |
| `@relay-assistant/memory` | Memory scopes, stores, retrieval, promotion, compaction hooks |
| `@relay-assistant/proactive` | Follow-up engines, watch rules, scheduler bindings |
| `@relay-assistant/sessions` | Cross-surface session identity, resume, attachment rules |
| `@relay-assistant/surfaces` | Assistant-facing surface abstractions above Relay transport |
| `@relay-assistant/coordination` | Coordinator/specialist orchestration and synthesis contracts |
| `@relay-assistant/connectivity` | Efficient inter-agent signaling, convergence, escalation, and communication contracts |
| `@relay-assistant/routing` | Model-choice, latency/depth/cost routing, and workload-router-aligned assistant policy |
| `@relay-assistant/policy` | Approvals, external-action safeguards, audit hooks |
| `@relay-assistant/examples` | Reference adoption examples, not production product code |

## Read This First

- [Docs index](docs/index.md)
- [Package boundary map](docs/architecture/package-boundary-map.md)
-  onnectivity package spec](docs/architecture/connectivity-package-spec.md)
- [Extraction roadmap](docs/architecture/extraction-roadmap.md)
- [OSS vs cloud split](docs/architecture/oss-vs-cloud-split.md)
- [How to build an assistant](docs/consumer/how-to-build-an-assistant.md)
- [How products should adopt this SDK](docs/consumer/how-products-should-adopt-relay-agent-assistant.md)
-  onnectivity adoption guide](docs/consumer/connectivity-adoption-guide.md)
-  onnectivity patterns research](docs/research/connectivity-patterns.md)
- [Internal system comparison](docs/research/internal-system-comparison.md)
- [Glossary](docs/reference/glossary.md)

## Current Status

Current repo state:

- no implementation packages yet
- no product code extracted yet
- docs define target package boundaries and migration order
- most package directories currently contain README placeholders only

## Implementation Direction

This repository should become the OSS core.

A later cloud implementation should be built on top of the OSS SDK in a separate package or repo, similar in spirit to other AgentWorkforce properties that keep the reusable core open-source and place Cloudflare-backed adapters and hosted infrastructure in a distinct cloud layer.

That later cloud layer should depend on this SDK, not replace it.

## Initial Adoption Rule

If a capability is reusable across multiple assistants with only configuration or adapter changes, it belongs here.

If a capability depends on product-specific ontology, customer workflow, or product policy, it stays in the product repo.

DOCS_FIRST_SCAFFOLD_READY

---DOCS INDEX---
# Relay Agent Assistant Docs Index

Start here:

## Architecture
- [Architecture draft](architecture/2026-04-11-relay-agent-assistant-architecture-draft.md)
- [Package boundary map](architecture/package-boundary-map.md)
-  onnectivity package spec](architecture/connectivity-package-spec.md)
- [Extraction roadmap](architecture/extraction-roadmap.md)
- [OSS vs cloud split](architecture/oss-vs-cloud-split.md)
- [Review verdict](architecture/review-verdict.md)

## Consumer docs
- [How to build an assistant](consumer/how-to-build-an-assistant.md)
- [How products should adopt relay-agent-assistant](consumer/how-products-should-adopt-relay-agent-assistant.md)
-  onnectivity adoption guide](consumer/connectivity-adoption-guide.md)

## Research
- [Landscape research](research/2026-04-11-assistant-sdk-landscape.md)
-  onnectivity patterns research](research/connectivity-patterns.md)
- [Internal system comparison](research/internal-system-comparison.md)

## Reference
- [Glossary](reference/glossary.md)
- [Stability and versioning](reference/stability-and-versioning.md)

---STABILITY---
# Stability and Versioning

Date: 2026-04-11

## Current Stage

This repo is in a docs-first research stage.

Current status:
- package boundaries are proposed, not implemented
- API names shown in docs are illustrative, not stable contracts
- consumer adoption should begin only after Phase 1 package extraction starts producing real interfaces

## Stability Intent

Once packages begin implementation, the goal should be:

- stable package boundaries before broad product adoption
- cautious API evolution in `core`, `sessions`, `memory`, `surfaces`, `coordination`, `connectivity`, `proactive`, and `policy`
- explicit release notes for breaking changes

## Proposed Versioning Policy

### Phase 0 — research/docs-first
- versioning is informal
- docs may change substantially as boundaries sharpen

### Phase 1 — first package extraction
- use pre-1.0 versions
- treat every package contract as provisional but intentional
- announce all breaking changes in CHANGELOG/release notes

### Phase 2 — first real consumer adoption
- stabilize the most reused package boundaries first:
  - `core`
  - `sessions`
  - `memory`
  - `surfaces`
- keep more experimental layers clearly marked if needed:
  - `connectivity`
  - `coordination`
  - `proactive`

### Phase 3 — multi-product production use
- promote mature packages to 1.0 once they have held across multiple consumers without repeated contract churn

## Consumer Guidance

Consumers such as Sage, MSD, and NightCTO should prefer:
- stable package boundaries for foundational contracts
- adapter layers inside product repos for experimental integration points
- explicit upgrade steps when package contracts change

## Change Communication

When implementation begins, every release should include:
- what changed
- which packages changed
- whether changes are breaking or additive
- which consumers are expected to be affected
