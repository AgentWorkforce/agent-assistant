# Relay Agent Assistant Docs Index

Start here:

## How this repo works

Development follows a **spec → implement → review** flow:
1. A spec is written and marked `IMPLEMENTATION_READY`
2. An implementation workflow produces code and tests
3. A review verdict is written; packages that pass are marked `SPEC_RECONCILED` or `IMPLEMENTATION_READY`

A package being "specified" does not mean it is implemented. A package being "implemented" means it has passing tests against a reviewed spec.

## Status

**6 packages implemented (241 tests passing). 4 packages are placeholder/README-only. 1 package (`@relay-assistant/traits`) is planned for v1.2 with no spec yet.**

See [README.md](../README.md) for the full implementation vs specification status table.

**Blocking DoD failure:** `@relay-assistant/routing` has 12 tests against a 40+ target. Do not consume in products until resolved.

**Workforce persona vs. assistant traits:** These are distinct. Workforce personas are runtime execution profiles (model, harness, system prompt, tier) — owned by Workforce, not this SDK. Assistant traits are identity/behavioral characteristics (voice, style, proactivity) — will live in `@relay-assistant/traits` at v1.2; in v1, products define them as local data objects. See [traits and persona layer](architecture/traits-and-persona-layer.md).

---

## Architecture
- [Assistant cloud interface](architecture/assistant-cloud-interface.md)

- [Architecture draft](architecture/2026-04-11-relay-agent-assistant-architecture-draft.md)
- [Package boundary map](architecture/package-boundary-map.md) — what belongs where; workforce persona vs traits; reuse-first rule
- [Traits and persona layer](architecture/traits-and-persona-layer.md) — `@relay-assistant/traits` spec; workforce persona vs assistant traits distinction
- [SDK audit and traits alignment plan](architecture/sdk-audit-and-traits-alignment-plan.md) — implementation vs spec status audit; docs drift log; traits placement decision
- [Connectivity package spec](architecture/connectivity-package-spec.md)
- [Extraction roadmap](architecture/extraction-roadmap.md)
- [OSS vs cloud split](architecture/oss-vs-cloud-split.md)
- [Review verdict](architecture/review-verdict.md)
- [Spec program plan](architecture/spec-program-plan.md)

## Consumer docs

- [How to build an assistant](consumer/how-to-build-an-assistant.md)
- [How products should adopt relay-agent-assistant](consumer/how-products-should-adopt-relay-agent-assistant.md)
- [Connectivity adoption guide](consumer/connectivity-adoption-guide.md)

## Workflows

- [V1 workflow backlog](workflows/v1-workflow-backlog.md) — WF-1 through WF-6 COMPLETE; WF-7 OPEN; routing DoD gap noted
- [Weekend delivery plan](workflows/weekend-delivery-plan.md) — updated with implementation status; workspace:* gap documented

## Research

- [Landscape research](research/2026-04-11-assistant-sdk-landscape.md)
- [Connectivity patterns research](research/connectivity-patterns.md)
- [Internal system comparison](research/internal-system-comparison.md) — workforce persona vs traits; extraction signals per product

## Reference

- [Glossary](reference/glossary.md)
- [Stability and versioning](reference/stability-and-versioning.md)
