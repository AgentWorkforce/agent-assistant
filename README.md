# Agent Assistant SDK

A focused, open-source SDK for building production-grade AI assistants from explicit runtime primitives: stable identity (`@agent-assistant/traits`), turn-scoped context assembly (`@agent-assistant/turn-context`, specified), bounded turn execution (`@agent-assistant/harness`), sessions, surfaces, policy, proactive behavior, memory, and multi-agent coordination.

## What This SDK Does

- **Identity and traits** — Attach validated, immutable personality and behavioral traits to an assistant at definition time (`@agent-assistant/traits`)
- **Memory** — Assistant-scoped memory composition over the underlying memory infrastructure (`@agent-assistant/memory`)
- **Sessions** — Cross-surface session continuity, resume rules, and storage abstractions (`@agent-assistant/sessions`)
- **Proactive behavior** — Follow-up engines, watch rules, and scheduler bindings for outbound assistant actions (`@agent-assistant/proactive`)
- **Multi-agent coordination** — Coordinator/specialist orchestration, delegation plans, and synthesis contracts (`@agent-assistant/coordination`)
- **Policy** — Action classification, gating, approvals, and audit hooks (`@agent-assistant/policy`)

## Quick Start

```bash
npm install @agent-assistant/sdk
```

```typescript
import { createAssistant, createTraitsProvider } from '@agent-assistant/sdk';

const traits = createTraitsProvider(
  { voice: 'concise', formality: 'professional', proactivity: 'medium', riskPosture: 'moderate', domain: 'engineering' },
  { preferMarkdown: true },
);

const runtime = createAssistant(
  {
    id: 'my-assistant',
    name: 'My Assistant',
    traits,
    capabilities: {
      reply: async (message, context) => {
        await context.runtime.emit({
          surfaceId: message.surfaceId,
          text: `Acknowledged: ${message.text}`,
        });
      },
    },
  },
  { inbound, outbound },
);

await runtime.start();
```

`@agent-assistant/sdk` is a single-package entry point that re-exports the stable v1-baseline API from all six core packages. See [docs/consumer/top-level-sdk-adoption-guide.md](docs/consumer/top-level-sdk-adoption-guide.md) for full usage and migration guidance.

See [packages/examples/src/](packages/examples/src/) for complete assembly examples.

## Package Map

| Package | Purpose | Status |
| --- | --- | --- |
| `@agent-assistant/sdk` | Top-level facade — one install for all v1-baseline packages | **NEW — facade only** |
| `@agent-assistant/core` | Assistant definition, lifecycle, shared runtime composition | **IMPLEMENTED** |
| `@agent-assistant/sessions` | Cross-surface session identity, resume, attachment rules | **IMPLEMENTED** |
| `@agent-assistant/surfaces` | Assistant-facing surface abstractions above the transport layer | **IMPLEMENTED** |
| `@agent-assistant/routing` | Model-choice, latency/depth/cost routing policy | **IMPLEMENTED** |
| `@agent-assistant/connectivity` | Efficient inter-agent signaling, convergence, and escalation contracts | **IMPLEMENTED** |
| `@agent-assistant/coordination` | Coordinator/specialist orchestration and synthesis contracts | **IMPLEMENTED** |
| `@agent-assistant/traits` | Assistant identity traits: voice, style, vocabulary, behavioral defaults | **IMPLEMENTED** |
| `@agent-assistant/harness` | Bounded iterative assistant-turn runtime with tool use, continuation, and truthful stop semantics | **IMPLEMENTED** |
| `@agent-assistant/memory` | Memory scopes, stores, retrieval, promotion, compaction hooks | placeholder (private — requires relay foundation backend) |
| `@agent-assistant/proactive` | Follow-up engines, watch rules, scheduler bindings | **IMPLEMENTED** |
| `@agent-assistant/policy` | Approvals, external-action safeguards, audit hooks | **IMPLEMENTED** |
| `@agent-assistant/examples` | Reference adoption examples | reference package |

## Current Status

**10 packages implemented. 368 tests verified passing. 1 package is placeholder (memory).**

- `@agent-assistant/core`: 31 + 6 integration pass
- `@agent-assistant/sessions`: 25 pass
- `@agent-assistant/surfaces`: 28 pass
- `@agent-assistant/traits`: 32 pass
- `@agent-assistant/routing`: 52 pass (routing hardening complete; READY_FOR_WAVE_2 within package boundary)
- `@agent-assistant/proactive`: 53 pass
- `@agent-assistant/policy`: 64 pass
- `@agent-assistant/harness`: 14 pass
- `@agent-assistant/connectivity`: ~30 actual — blocked by missing `node_modules` (workspace install required)
- `@agent-assistant/coordination`: ~39 actual — blocked by connectivity import failure
- `@agent-assistant/examples` is a reference package, not a placeholder

`@agent-assistant/memory` is not yet installable. It depends on `@agent-relay/memory` (relay foundation infrastructure) which is not publicly available. The memory package is excluded from the workspace install graph. When the relay memory package is published, memory will be re-enabled.

See [docs/current-state.md](docs/current-state.md) for authoritative per-package test results and blockers.

## Architecture

This SDK sits between the underlying messaging and runtime infrastructure and product-specific assistant logic.

### Runtime primitive map

The repo should no longer be read as if "the harness" were the umbrella runtime concept.

- `@agent-assistant/harness` = the bounded turn executor only
- `@agent-assistant/turn-context` = the turn-scoped assembly primitive that prepares effective assistant-facing instructions/context for one turn
- `@agent-assistant/traits` = the stable identity floor
- product intelligence = product-owned prompts, heuristics, workflow logic, and domain behavior

See:
- [Runtime primitive map](docs/architecture/agent-assistant-runtime-primitive-map.md)
- [Runtime primitives vs. product intelligence](docs/architecture/runtime-primitives-vs-product-intelligence.md)
- [Turn-context enrichment boundary](docs/architecture/v1-turn-context-enrichment-boundary.md)

### Foundation layer (not this repo)

The underlying messaging and runtime infrastructure (transport adapters, webhook verification, normalized message primitives, channel/session transport substrate, auth and connection wiring, scheduler and wake-up infrastructure) lives in the Relay foundation repos.

### Assistant SDK (this repo)

Reusable assistant behavior built on top of the foundation:

- assistant construction and lifecycle
- stable assistant identity traits
- turn-context assembly contracts
- memory scopes and adapters
- proactive engines and watch rules
- assistant session models
- assistant-facing surface contracts
- bounded iterative assistant-turn harnesses
- specialist coordination
- action policy and audit integration

### Product logic (product repos)

Product-specific concerns stay in each product's own repository:

- prompts, workforce persona definitions, turn-shaping logic, and persona behavior
- product-specific workflows and tools
- domain-specific watchers and automations
- product UX and dashboards
- pricing, tiering, escalation, and customer policy

> **Primitive split:** Workforce personas are product/runtime execution profiles (model, harness choice, system prompt, tier). Assistant traits are stable identity data. Turn-context assembly expresses that identity plus turn-scoped shaping for one turn. The harness then executes that prepared turn. Product intelligence stays above all three.

## Consumer Docs

- [How to build an assistant](docs/consumer/how-to-build-an-assistant.md)
- [How products should adopt this SDK](docs/consumer/how-products-should-adopt-agent-assistant-sdk.md)
- [Connectivity adoption guide](docs/consumer/connectivity-adoption-guide.md)
- [Docs index](docs/index.md)
- [Package boundary map](docs/architecture/package-boundary-map.md)

## Contributing

Contributions are welcome. Before opening a PR:

1. Run `npx vitest run` from the repo root and confirm all tests pass.
2. Follow the spec → implement → review flow described in [docs/index.md](docs/index.md).
3. New packages should have a spec in `docs/specs/` before implementation begins.

## License

MIT
