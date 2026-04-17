# Agent Assistant SDK

A focused, open-source SDK for building production-grade AI assistants from explicit runtime primitives: stable identity (`@agent-assistant/traits`), turn-scoped context assembly (`@agent-assistant/turn-context`), bounded turn execution (`@agent-assistant/harness`), continuation, inbox, sessions, surfaces, policy, proactive behavior, memory, and multi-agent coordination.

## What This SDK Does

- **Identity and traits** — Attach validated, structured assistant identity defaults at definition time (`@agent-assistant/traits`)
- **Turn-context assembly** — Build the effective assistant-facing instructions + context bundle for one bounded turn (`@agent-assistant/turn-context`)
- **Bounded turn execution** — Execute one honest model/tool/model loop with truthful stop semantics (`@agent-assistant/harness`)
- **Continuation** — Persist and resume unfinished turn lineages (`@agent-assistant/continuation`)
- **Inbox** — Normalize trusted outsider inputs into turn-context-friendly projections (`@agent-assistant/inbox`)
- **Memory** — Assistant-scoped memory composition over the underlying relay memory layer (`@agent-assistant/memory`)
- **Sessions** — Cross-surface session continuity, resume rules, and storage abstractions (`@agent-assistant/sessions`)
- **Surfaces** — Assistant-facing inbound/outbound surface contracts above raw transport (`@agent-assistant/surfaces`)
- **Policy** — Action classification, approvals, and audit hooks (`@agent-assistant/policy`)
- **Proactive behavior** — Follow-up engines, watch rules, and scheduler bindings for outbound assistant actions (`@agent-assistant/proactive`)
- **Routing / execution envelope selection** — Model-choice and latency/depth/cost routing policy (`@agent-assistant/routing`)
- **Connectivity and coordination** — Inter-agent signaling plus coordinator/specialist orchestration (`@agent-assistant/connectivity`, `@agent-assistant/coordination`)
- **Virtual filesystem navigation** — Provider-neutral contracts and Bash-friendly navigation helpers for assistant-readable VFS surfaces (`@agent-assistant/vfs`)

## Quick Start

```bash
npm install @agent-assistant/sdk
```

```typescript
import { createAssistant, createTraitsProvider } from '@agent-assistant/sdk';

const traits = createTraitsProvider(
  {
    voice: 'concise',
    formality: 'professional',
    proactivity: 'medium',
    riskPosture: 'moderate',
    domain: 'engineering',
  },
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

`@agent-assistant/sdk` is the single-package entry point for the public baseline surfaces. See [docs/consumer/top-level-sdk-adoption-guide.md](docs/consumer/top-level-sdk-adoption-guide.md) for full usage and migration guidance.

## Runtime Primitive Map

The repo should not be read as if “the harness” were the umbrella runtime concept.

- `@agent-assistant/core` = assistant runtime shell
- `@agent-assistant/sessions` = continuity unit
- `@agent-assistant/surfaces` = assistant-facing surface mediation
- `@agent-assistant/harness` = bounded turn executor only
- `@agent-assistant/turn-context` = turn-scoped assembly primitive
- `@agent-assistant/traits` = stable identity floor
- `@agent-assistant/policy` = approval / action governance seam
- `@agent-assistant/memory` = memory and prepared context supply
- `@agent-assistant/vfs` = assistant-readable virtual filesystem navigation primitive
- `@agent-assistant/continuation` = resumable unfinished turn lineage runtime
- `@agent-assistant/inbox` = trusted outsider ingestion boundary
- `@agent-assistant/routing`, `connectivity`, `coordination` = execution envelope + backstage collaboration primitives
- product intelligence = product-owned prompts, heuristics, workflows, and domain behavior

See:
- [Runtime primitive map](docs/architecture/agent-assistant-runtime-primitive-map.md)
- [Runtime primitives vs. product intelligence](docs/architecture/runtime-primitives-vs-product-intelligence.md)
- [Turn-context enrichment boundary](docs/architecture/v1-turn-context-enrichment-boundary.md)

## Package Map

| Package | Purpose | Status |
| --- | --- | --- |
| `@agent-assistant/sdk` | Top-level facade for public baseline surfaces | **IMPLEMENTED** |
| `@agent-assistant/core` | Assistant definition, lifecycle, shared runtime composition | **IMPLEMENTED** |
| `@agent-assistant/sessions` | Cross-surface session identity, resume, attachment rules | **IMPLEMENTED** |
| `@agent-assistant/surfaces` | Assistant-facing surface abstractions above the transport layer | **IMPLEMENTED** |
| `@agent-assistant/routing` | Model-choice, latency/depth/cost routing policy | **IMPLEMENTED** |
| `@agent-assistant/connectivity` | Inter-agent signaling, escalation, and convergence contracts | **IMPLEMENTED** |
| `@agent-assistant/coordination` | Coordinator/specialist orchestration and synthesis contracts | **IMPLEMENTED** |
| `@agent-assistant/traits` | Assistant identity traits: voice, style, behavior defaults | **IMPLEMENTED** |
| `@agent-assistant/harness` | Bounded iterative assistant-turn runtime with truthful stop semantics | **IMPLEMENTED** |
| `@agent-assistant/turn-context` | Turn-scoped assistant-facing context assembly | **IMPLEMENTED** |
| `@agent-assistant/memory` | Assistant-scoped memory composition over relay memory | **IMPLEMENTED** |
| `@agent-assistant/vfs` | Provider-neutral virtual filesystem contracts and Bash CLI runner | **IMPLEMENTED** |
| `@agent-assistant/continuation` | Resumable unfinished turn state and validated resume triggers | **IMPLEMENTED** |
| `@agent-assistant/inbox` | Trusted outsider ingestion primitives and turn-context projection | **IMPLEMENTED** |
| `@agent-assistant/proactive` | Follow-up engines, watch rules, scheduler bindings | **IMPLEMENTED** |
| `@agent-assistant/policy` | Approvals, external-action safeguards, audit hooks | **IMPLEMENTED** |
| `@agent-assistant/integration-tests` | Cross-package integration coverage | **IMPLEMENTED** (private package) |
| `@agent-assistant/examples` | Reference adoption examples | reference package |

## Current Status

**16 package areas are active in the monorepo. 566 tests are currently passing locally across 23 test files.**

Highlights from the latest local verification run (`npx vitest run`):

- `routing`: 52 pass
- `connectivity`: 30 pass
- `proactive`: 53 pass
- `surfaces`: 28 pass + 11 Slack thread gate pass
- `memory`: 53 pass
- `continuation`: 49 pass
- `integration`: 14 pass
- `policy`: 64 pass
- `coordination`: 39 pass
- `traits`: 32 pass
- `sessions`: 25 pass
- `core`: 16 + 9 + 9 + 6 pass across focused suites
- `inbox`: 15 + 13 + 11 pass
- `turn-context`: 5 pass
- `harness`: 14 pass + 9 Claude Code adapter pass + 9 BYOH proof pass

See [docs/current-state.md](docs/current-state.md) for the authoritative current snapshot and known remaining gaps.

## What Is Actually Still Pending

The repo is no longer primarily blocked on package implementation. The main remaining concerns are:

- **documentation/status drift** — some older docs still describe earlier package states
- **publish/install truth** — public npm install/consumer verification should be treated as a first-class gate
- **product-proof slices** — Sage / NightCTO / BYOH proving remains important even when package-local tests are green

## Foundation Layer (not this repo)

The underlying messaging and runtime infrastructure (transport adapters, webhook verification, normalized transport primitives, channel/session substrate, auth/connection wiring, scheduler/wake infrastructure) lives in the Relay foundation repos.

## Product Logic (product repos)

Product-specific concerns stay in each product's own repository:

- prompts, workforce persona definitions, and turn-shaping logic
- product-specific workflows and tools
- domain-specific watchers and automations
- UX and dashboards
- pricing, tiering, escalation, and customer policy

> **Primitive split:** Workforce personas are product/runtime execution profiles (model, harness choice, system prompt, tier). Assistant traits are stable identity data. Turn-context assembly expresses that identity plus turn-scoped shaping for one turn. The harness then executes that prepared turn. Product intelligence stays above all three.

## Consumer Docs

- [Docs index](docs/index.md)
- [Current state](docs/current-state.md)
- [How to build an assistant](docs/consumer/how-to-build-an-assistant.md)
- [How products should adopt this SDK](docs/consumer/how-products-should-adopt-agent-assistant-sdk.md)
- [Connectivity adoption guide](docs/consumer/connectivity-adoption-guide.md)
- [Package boundary map](docs/architecture/package-boundary-map.md)

## Contributing

Before opening a PR:

1. Run `npx vitest run` from the repo root and confirm all tests pass.
2. Follow the spec → implement → review flow described in [docs/index.md](docs/index.md).
3. When docs conflict, use the precedence rule in `docs/index.md`: source code > specs > READMEs > index/status docs > plans > verdicts.

## License

MIT
