# @agent-assistant/routing

`@agent-assistant/routing` is the assistant-level routing package for model-selection policy. It implements the bounded v1 routing surface described in `docs/specs/v1-routing-spec.md`: cheap/fast/deep mode selection, abstract `ModelSpec` recommendations, per-thread cost tracking, latency-aware mode selection, and a narrow escalation hook for connectivity integration.

The package is TypeScript-first, provider-agnostic, and runnable in isolation. It does not call model providers, own transport, inspect user content, or import connectivity runtime code.

## Responsibilities

- Define the three Workforce-aligned routing modes: `cheap`, `fast`, `deep`
- Convert structured routing context into a `RoutingDecision`
- Track accumulated per-thread cost in memory
- Apply policy primitives for depth, latency, and cost envelopes
- Expose a clean `onEscalation()` hook that connectivity can call without handing routing ownership of signals or transports

## Non-Goals

- No provider SDK ownership
- No concrete model IDs
- No cloud assumptions
- No transport implementation
- No product-specific business logic
- No semantic message inspection

## Installation

```bash
cd packages/routing
npm install
```

## API

```ts
import { createRouter } from '@agent-assistant/routing';
```

### Core Types

- `RoutingMode`: `cheap | fast | deep`
- `RoutingPolicy`: assistant or capability-level routing policy
- `RoutingContext`: structured decision input for one invocation
- `RoutingDecision`: recommended mode plus the merged `ModelSpec`
- `RoutingEscalationHook`: connectivity-facing hook contract

### Default Mode Semantics

- `cheap`: minimize cost, typically small-tier and constrained features
- `fast`: default interactive mode, optimized for responsiveness
- `deep`: maximize depth/quality when latency and cost are secondary

## Usage

```ts
import { createRouter } from '@agent-assistant/routing';

const router = createRouter({
  policy: {
    defaultMode: 'fast',
    costEnvelopeLimit: 25,
    capabilityModes: {
      summarize: 'cheap',
      codegen: 'deep',
    },
    escalationModeMap: {
      'escalation.interrupt': 'deep',
      'escalation.review': 'fast',
    },
    modeModelSpecs: {
      cheap: {
        tier: 'small',
        hints: { workforceLane: 'cheap' },
      },
      fast: {
        tier: 'medium',
        hints: { workforceLane: 'fast' },
      },
      deep: {
        tier: 'large',
        hints: { workforceLane: 'deep' },
      },
    },
  },
});

const decision = router.decide({
  threadId: 'thread-123',
  capability: 'codegen',
  requestedMaxLatencyMs: 4000,
  requiresToolUse: true,
  minContextTokens: 24000,
});
```

## Decision Order

`router.decide()` applies routing rules in bounded priority order:

1. Caller-requested mode
2. Capability override
3. Cost envelope downgrade
4. Active escalation mapping
5. Latency constraint downgrade
6. Policy default
7. Hard ceiling cap over the selected candidate

If a selected mode exceeds `policy.modeCeiling`, the final decision is capped and marked with reason `hard_constraint`.

When multiple escalation signals map to the same priority, the deepest mapped mode wins as the tiebreaker.

## Connectivity Boundary

Connectivity can integrate with routing by passing escalation signals into `router.onEscalation(signal)`. The routing package mirrors the minimal signal shape it needs:

- `signalClass`
- `priority`
- thread metadata fields for correlation

This keeps the integration explicit and narrow:

- connectivity owns signal lifecycle
- routing owns mapping signal classes to requested routing modes
- product code wires the two together

Example:

```ts
const requestedMode = router.onEscalation({
  id: 'sig-1',
  threadId: 'thread-123',
  source: 'connectivity',
  signalClass: 'escalation.interrupt',
  priority: 'critical',
  summary: 'Supervisor requested escalation',
});
```

## Cost Tracking

The router exposes in-memory helpers:

- `recordCost(threadId, cost)`
- `getAccumulatedCost(threadId)`
- `resetCost(threadId)`

`decide()` remains input-driven. Callers can pass `accumulatedCost` directly, or use the router’s bookkeeping methods and feed the current value back into the next decision.

## Testing

The package includes unit coverage for:

- default routing
- caller and capability overrides
- hard ceiling enforcement and `escalated` flag correctness
- cost envelope downgrade and edge conditions
- escalation-driven routing, priority ordering, and tiebreak behavior
- latency constraint selection
- model-spec merging
- cost tracking
- connectivity hook behavior

Current coverage is 52 tests. The routing package hardening slice closed the explicit 40+ test DoD gap and fixed the `hard_constraint`/`escalated` correctness bug. See `docs/architecture/v1-routing-hardening-boundary.md` and `docs/architecture/v1-routing-hardening-review-verdict.md`.

Run:

```bash
cd packages/routing
npm test
```

ROUTING_PACKAGE_IMPLEMENTED
