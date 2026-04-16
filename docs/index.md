# Agent Assistant SDK Docs Index

Start here. For current package status and verified local test results, see [current-state.md](current-state.md).

> **Historical naming note:** some architecture docs in `docs/architecture/` still contain references to `@relay-assistant/*` and `RelayAssistant`. Those are historical records from before the rename to `@agent-assistant/*` / Agent Assistant SDK. Active code and packages use `@agent-assistant/*`.

## How this repo works

Development follows a **spec → implement → review** flow:

1. a spec is written and marked implementation-ready
2. an implementation workflow produces code and tests
3. a review verdict is written and the package/package-area becomes reconciled in code

A package being “specified” does not mean it is unimplemented forever; several parts of this repo have now progressed beyond older historical planning docs. When docs conflict, use the precedence rule below.

## Source of truth

When documents conflict:

**source code > specs > package READMEs > index/status docs > plans > verdicts**

That means:
- `docs/specs/` contains canonical contracts where specs exist
- package READMEs usually describe the current intended public surface better than older architecture plans
- plans and review verdicts in `docs/architecture/` are often historical records, not current status pages

## Current status

As of the latest verified local run:

- **566 tests passing**
- **23 test files passing**
- memory, turn-context, continuation, inbox, coordination, and integration coverage are all present in the current repo state

See [current-state.md](current-state.md) for the authoritative snapshot.

## Runtime primitive framing

Harness is not the umbrella runtime concept.

Read the runtime stack like this:
- `@agent-assistant/core` = runtime shell
- `@agent-assistant/sessions` = continuity
- `@agent-assistant/surfaces` = assistant-facing surface mediation
- `@agent-assistant/harness` = bounded turn executor
- `@agent-assistant/turn-context` = turn-scoped context assembly
- `@agent-assistant/traits` = stable identity floor
- `@agent-assistant/policy` = governance seam
- `@agent-assistant/memory` = memory supply
- `@agent-assistant/continuation` = unfinished-turn resume runtime
- `@agent-assistant/inbox` = trusted outsider ingestion boundary
- `@agent-assistant/routing`, `connectivity`, `coordination` = execution-envelope and backstage collaboration primitives
- product intelligence remains product-owned

Primary architecture anchors:
- [Runtime primitive map](architecture/agent-assistant-runtime-primitive-map.md)
- [Runtime primitives vs. product intelligence](architecture/runtime-primitives-vs-product-intelligence.md)
- [Turn-context enrichment boundary](architecture/v1-turn-context-enrichment-boundary.md)
- [Package boundary map](architecture/package-boundary-map.md)

## Fastest paths depending on what you need

### I want the current repo truth
- [Current state](current-state.md)
- [README](../README.md)

### I want the public facade / adoption path
- [Top-level SDK adoption guide](consumer/top-level-sdk-adoption-guide.md)
- [How to build an assistant](consumer/how-to-build-an-assistant.md)
- [How products should adopt agent-assistant-sdk](consumer/how-products-should-adopt-agent-assistant-sdk.md)

### I want architecture / package boundaries
- [Runtime primitive map](architecture/agent-assistant-runtime-primitive-map.md)
- [Runtime primitives vs. product intelligence](architecture/runtime-primitives-vs-product-intelligence.md)
- [Package boundary map](architecture/package-boundary-map.md)
- [Top-level SDK facade spec](architecture/top-level-sdk-facade-spec.md)
- [Assistant cloud interface](architecture/assistant-cloud-interface.md)

### I want workflow/program context
- [Workflow index](workflows/README.md)
- [V1 workflow backlog](workflows/v1-workflow-backlog.md)

## Consumer docs

- [Top-level SDK adoption guide](consumer/top-level-sdk-adoption-guide.md)
- [How to build an assistant](consumer/how-to-build-an-assistant.md)
- [How products should adopt agent-assistant-sdk](consumer/how-products-should-adopt-agent-assistant-sdk.md)
- [Connectivity adoption guide](consumer/connectivity-adoption-guide.md)

## Research

- [Landscape research](research/2026-04-11-assistant-sdk-landscape.md)
- [Connectivity patterns research](research/connectivity-patterns.md)
- [Internal system comparison](research/internal-system-comparison.md)

## Reference

- [Glossary](reference/glossary.md)
- [Stability and versioning](reference/stability-and-versioning.md)

## Important caution on older docs

A number of older documents still reflect intermediate states from before:
- the public rename settled
- turn-context was fully implemented
- memory/inbox/continuation landed in current form
- package-local counts reached the current local totals

Those docs are still useful as design history, but they should not override current code and current package READMEs.

---

Last reconciled: 2026-04-16
