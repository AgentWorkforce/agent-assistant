# Relay Agent Assistant Docs Index

Start here. For current test results and blockers see [current-state.md](current-state.md).

## How this repo works

Development follows a **spec → implement → review** flow:
1. A spec is written and marked `IMPLEMENTATION_READY`
2. An implementation workflow produces code and tests
3. A review verdict is written; packages that pass are marked `SPEC_RECONCILED` or `IMPLEMENTATION_READY`

A package being "specified" does not mean it is implemented. A package being "implemented" means it has passing tests against a reviewed spec.

## Source of truth

When documents conflict: source code > specs > READMEs > index/status docs > plans > verdicts.
Specs in `docs/specs/` are the canonical contracts. Plans and verdicts in `docs/architecture/` are historical records.

## Status

**7 packages implemented (128 tests verified passing; connectivity and coordination tests blocked by missing dependencies). 3 packages are placeholder/README-only.**

See [README.md](../README.md) for the full implementation vs specification status table.
See [current-state.md](current-state.md) for the authoritative per-package test results and blockers.

**Blocking DoD failure:** `@relay-assistant/routing` has 12 tests against a 40+ target. Do not consume in products until resolved.

**Workforce persona vs. assistant traits:** These are distinct. Workforce personas are runtime execution profiles (model, harness, system prompt, tier) — owned by Workforce, not this SDK. Assistant traits are identity/behavioral characteristics (voice, style, proactivity) — will live in `@relay-assistant/traits` at v1.2; in v1, products define them as local data objects. See [traits and persona layer](architecture/traits-and-persona-layer.md).

---

## Architecture
- [Source of truth](architecture/source-of-truth.md) — precedence hierarchy; canonical vs. duplicate spec pointers
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

- [Workflow index](workflows/README.md) — directory overview and status summary
- [V1 workflow backlog](workflows/v1-workflow-backlog.md) — WF-1 through WF-6 COMPLETE; WF-7 OPEN; routing DoD gap noted
- [Weekend delivery plan](workflows/weekend-delivery-plan.md) — updated with implementation status; workspace:* gap documented

## Research

- [Landscape research](research/2026-04-11-assistant-sdk-landscape.md)
- [Connectivity patterns research](research/connectivity-patterns.md)
- [Internal system comparison](research/internal-system-comparison.md) — workforce persona vs traits; extraction signals per product

## Reference

- [Glossary](reference/glossary.md)
- [Stability and versioning](reference/stability-and-versioning.md)

---

## Implementation archive

Plans and review verdicts from completed implementation work. These are historical records, not active design docs.

### Core
- [Core implementation plan](architecture/v1-core-implementation-plan.md)
- [Core review verdict](architecture/v1-core-review-verdict.md)

### Sessions
- [Sessions implementation plan](architecture/v1-sessions-implementation-plan.md)
- [Sessions review verdict](architecture/v1-sessions-review-verdict.md)

### Surfaces
- [Surfaces implementation plan](architecture/v1-surfaces-implementation-plan.md)
- [Surfaces review verdict](architecture/v1-surfaces-review-verdict.md)

### Routing
- [Routing implementation plan](architecture/v1-routing-implementation-plan.md)
- [Routing review verdict](architecture/v1-routing-review-verdict.md)

### Connectivity
- [Connectivity scope](architecture/v1-connectivity-scope.md)
- [Connectivity implementation plan](architecture/v1-connectivity-implementation-plan.md)
- [Connectivity package implementation plan](architecture/v1-connectivity-package-implementation-plan.md)
- [Connectivity review verdict](architecture/v1-connectivity-review-verdict.md)
- [Connectivity package review verdict](architecture/v1-connectivity-package-review-verdict.md)
- [Connectivity hardening plan](architecture/v1-connectivity-hardening-plan.md)
- [Connectivity hardening review verdict](architecture/v1-connectivity-hardening-review-verdict.md)

### Coordination
- [Coordination implementation plan](architecture/v1-coordination-implementation-plan.md)
- [Coordination review verdict](architecture/v1-coordination-review-verdict.md)
- [Coordination hardening plan](architecture/v1-coordination-hardening-plan.md)
- [Coordination hardening review verdict](architecture/v1-coordination-hardening-review-verdict.md)
- [Coordination–routing integration plan](architecture/v1-coordination-routing-integration-plan.md)
- [Coordination–routing integration review verdict](architecture/v1-coordination-routing-integration-review-verdict.md)

### Memory
- [Memory scope](architecture/v1-memory-scope.md)
- [Memory implementation plan](architecture/v1-memory-implementation-plan.md)
- [Memory package implementation plan](architecture/v1-memory-package-implementation-plan.md)
- [Memory review verdict](architecture/v1-memory-review-verdict.md)
- [Memory package review verdict](architecture/v1-memory-package-review-verdict.md)
- [Memory reconciliation plan](architecture/v1-memory-reconciliation-plan.md)
- [Memory reconciliation review verdict](architecture/v1-memory-reconciliation-review-verdict.md)

### Traits
- [Traits scope](architecture/v1-traits-scope.md)
- [Traits implementation plan](architecture/v1-traits-implementation-plan.md)
- [Traits package implementation plan](architecture/v1-traits-package-implementation-plan.md)
- [Traits review verdict](architecture/v1-traits-review-verdict.md)
- [Traits package review verdict](architecture/v1-traits-package-review-verdict.md)

### Foundation integration
- [Foundation integration plan](architecture/v1-foundation-integration-plan.md)
- [Foundation integration review verdict](architecture/v1-foundation-integration-review-verdict.md)

### Cross-cutting
- [Sectioning and priorities](architecture/v1-sectioning-and-priorities.md)
- [Spec reconciliation rules](architecture/spec-reconciliation-rules.md)
- [Spec reconciliation review verdict](architecture/spec-reconciliation-review-verdict.md)
- [Canonical spec fix plan](architecture/canonical-spec-fix-plan.md)
- [Canonical spec review verdict](architecture/canonical-spec-review-verdict.md)
- [Spec program plan](architecture/spec-program-plan.md)
- [Spec program review verdict](architecture/spec-program-review-verdict.md)
- [SDK audit and traits alignment review verdict](architecture/sdk-audit-and-traits-alignment-review-verdict.md)
- [Post-audit cleanup plan](architecture/post-audit-cleanup-plan.md)
- [Post-audit cleanup review verdict](architecture/post-audit-cleanup-review-verdict.md)
- [Connectivity review verdict (general)](architecture/connectivity-review-verdict.md)
- [Repo tightening plan](architecture/repo-tightening-plan.md)
- [Repo tightening review verdict](architecture/repo-tightening-review-verdict.md)

---

Last tightened: 2026-04-12
