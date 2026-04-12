# Agent Assistant SDK

A focused, open-source SDK for building production-grade AI assistants with identity, memory, sessions, proactive behavior, multi-agent coordination, and policy.

## What This SDK Does

- **Identity and traits** — Attach validated, immutable personality and behavioral traits to an assistant at definition time (`@agent-assistant/traits`)
- **Memory** — Assistant-scoped memory composition over the underlying memory infrastructure (`@agent-assistant/memory`)
- **Sessions** — Cross-surface session continuity, resume rules, and storage abstractions (`@agent-assistant/sessions`)
- **Proactive behavior** — Follow-up engines, watch rules, and scheduler bindings for outbound assistant actions (`@agent-assistant/proactive`)
- **Multi-agent coordination** — Coordinator/specialist orchestration, delegation plans, and synthesis contracts (`@agent-assistant/coordination`)
- **Policy** — Action classification, gating, approvals, and audit hooks (`@agent-assistant/policy`)

## Quick Start

```bash
npm install @agent-assistant/core @agent-assistant/traits
```

```typescript
import { createAssistant } from '@agent-assistant/core';
import { createTraitsProvider } from '@agent-assistant/traits';

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

See [packages/examples/src/](packages/examples/src/) for more complete assembly examples.

## Package Map

| Package | Purpose | Status |
| --- | --- | --- |
| `@agent-assistant/core` | Assistant definition, lifecycle, shared runtime composition | **IMPLEMENTED** |
| `@agent-assistant/sessions` | Cross-surface session identity, resume, attachment rules | **IMPLEMENTED** |
| `@agent-assistant/surfaces` | Assistant-facing surface abstractions above the transport layer | **IMPLEMENTED** |
| `@agent-assistant/routing` | Model-choice, latency/depth/cost routing policy | **IMPLEMENTED** (DoD gap — see below) |
| `@agent-assistant/connectivity` | Efficient inter-agent signaling, convergence, and escalation contracts | **IMPLEMENTED** |
| `@agent-assistant/coordination` | Coordinator/specialist orchestration and synthesis contracts | **IMPLEMENTED** |
| `@agent-assistant/traits` | Assistant identity traits: voice, style, vocabulary, behavioral defaults | **IMPLEMENTED** |
| `@agent-assistant/memory` | Memory scopes, stores, retrieval, promotion, compaction hooks | placeholder — v1.1 |
| `@agent-assistant/proactive` | Follow-up engines, watch rules, scheduler bindings | placeholder — v1.2 |
| `@agent-assistant/policy` | Approvals, external-action safeguards, audit hooks | placeholder — v2 |
| `@agent-assistant/examples` | Reference adoption examples | placeholder |

## Current Status

**7 packages implemented. 128 tests verified passing. 3 packages are placeholder/README-only.**

- `@agent-assistant/core`: 31 pass
- `@agent-assistant/sessions`: 25 pass
- `@agent-assistant/surfaces`: 28 pass
- `@agent-assistant/traits`: 32 pass
- `@agent-assistant/routing`: 12 pass (DoD gap — 40+ target; do not consume in products until resolved)
- `@agent-assistant/connectivity`: 87 claimed — blocked by missing `nanoid` dep
- `@agent-assistant/coordination`: 45 claimed — blocked by connectivity import failure

See [docs/current-state.md](docs/current-state.md) for authoritative per-package test results and blockers.

## Architecture

This SDK sits between the underlying messaging and runtime infrastructure and product-specific assistant logic.

### Foundation layer (not this repo)

The underlying messaging and runtime infrastructure (transport adapters, webhook verification, normalized message primitives, channel/session transport substrate, auth and connection wiring, scheduler and wake-up infrastructure) lives in the Relay foundation repos.

### Assistant SDK (this repo)

Reusable assistant behavior built on top of the foundation:

- assistant construction and lifecycle
- memory scopes and adapters
- proactive engines and watch rules
- assistant session models
- assistant-facing surface contracts
- specialist coordination
- action policy and audit integration

### Product logic (product repos)

Product-specific concerns stay in each product's own repository:

- prompts, workforce persona definitions, and persona behavior
- product-specific workflows and tools
- domain-specific watchers and automations
- product UX and dashboards
- pricing, tiering, escalation, and customer policy

> **Workforce persona vs. assistant traits:** Workforce personas are runtime execution profiles (model, harness, system prompt, tier). Assistant traits are identity and behavioral characteristics (voice, style, vocabulary, proactivity). These are distinct. See [traits and persona layer](docs/architecture/traits-and-persona-layer.md).

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
