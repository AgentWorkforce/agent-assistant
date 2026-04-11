# `@relay-assistant/coordination`

`@relay-assistant/coordination` implements the bounded v1 many-agents-one-assistant runtime for Relay Agent Assistant. It provides a specialist registry, delegation plan validation, sequential coordinator execution, synthesis helpers, and clean integration with `@relay-assistant/connectivity` for handoffs, conflicts, and escalations.

## Scope

This package owns:

- specialist registration and lookup
- delegation plan validation and bounded execution
- coordinator lifecycle for one in-memory coordination turn
- synthesis of multiple specialist outputs into one assistant-facing result
- consumption of connectivity signals during delegation without taking over connectivity itself

This package does not own:

- routing policy or model selection
- memory retrieval or persistence
- surface formatting or delivery
- transport, relaycast, queues, or cross-process orchestration
- product-specific specialist lineups or dispatch heuristics

## Install Shape

The package is TypeScript-first and builds to `dist/`.

```ts
import {
  createCoordinator,
  createDelegationPlan,
  createSpecialistRegistry,
  createSynthesizer,
  validateDelegationPlan,
} from '@relay-assistant/coordination';
```

## Core Concepts

### Specialist registry

Products register their own specialists. The package only enforces uniqueness and lookup.

```ts
const registry = createSpecialistRegistry();

registry.register({
  name: 'researcher',
  description: 'Collects relevant evidence',
  capabilities: ['research'],
  handler: {
    async execute(instruction, context) {
      return {
        specialistName: 'researcher',
        output: `Evidence for: ${instruction}`,
        status: 'complete',
      };
    },
  },
});
```

### Delegation plan

Plans are ordered and sequential in v1.

`createDelegationPlan()` is a validating factory: it throws if the structure is invalid
or if any step references an unknown registered specialist. If a product needs to
construct a plan before registry population, it can build a raw `DelegationPlan`
object and call `validateDelegationPlan()` later.

```ts
const plan = createDelegationPlan(
  {
    intent: 'produce one coherent answer',
    steps: [
      { specialistName: 'researcher', instruction: 'gather evidence' },
      { specialistName: 'writer', instruction: 'write final answer' },
    ],
  },
  registry,
);
```

### Coordinator

The coordinator validates the plan, executes each step in order, observes connectivity signals on the turn thread, and synthesizes a final output.

```ts
import { createConnectivityLayer } from '@relay-assistant/connectivity';

const connectivity = createConnectivityLayer();

const coordinator = createCoordinator({
  registry,
  connectivity,
  synthesis: { strategy: 'last-wins' },
});

const turn = await coordinator.execute(plan);
console.log(turn.output.text);
```

## Connectivity Boundary

Coordination depends on `@relay-assistant/connectivity` as a signaling substrate only.

What coordination does with connectivity:

- passes the connectivity layer into each specialist context
- registers a per-turn selected-audience resolver scoped to the plan participants
- observes per-turn signals such as `handoff.ready`, `confidence.blocker`, `conflict.active`, and `escalation.interrupt`
- resolves consumable signals after synthesis or coordinator action
- exposes the observed signal set on the returned coordination turn

What coordination does not do:

- choose routing modes
- import or call the routing package
- own transport delivery for signals
- persist signal history outside the in-memory layer supplied by the consumer

## Routing Integration

Coordination can optionally accept a router via `createCoordinator({ router, ... })`.

When a router is present:

- each specialist step receives `context.routingDecision`
- the returned turn may include `turn.routingDecisions`
- specialist-reported `metadata.cost` values are recorded back to the router per thread

Current v1 limitation:

- coordination does not yet pass `activeEscalations` into `router.decide()`, so the escalation-routing path remains a documented v1 gap rather than a complete end-to-end flow

## Synthesis

v1 includes three synthesis modes:

- `concatenate`
- `last-wins`
- `custom`

`custom` requires a function and keeps product-specific output shaping outside the package core.

## Failure Model

v1 execution is intentionally simple:

- steps run sequentially
- optional step failures are skipped and degrade output quality instead of aborting the whole turn
- `confidence.blocker` and `escalation.interrupt` halt the turn
- unresolved conflicts degrade synthesis quality but do not introduce routing or policy ownership

## Development

Run inside `packages/coordination`:

```sh
npm install
npm test
npm run build
```

The test suite covers 45 tests across five groups:

- specialist registry (7 tests): duplicate rejection, defensive copy, empty or whitespace names, unregister/get edge cases
- delegation plan validation (7 tests): empty intent, steps, instruction, and specialist name handling; multi-error accumulation; `maxSteps`; copy isolation
- synthesis strategies (8 tests): concatenate, last-wins, custom, degraded quality, and failure exclusion
- coordinator lifecycle and signal handling (13 tests): sequential handoff, optional and required step failure, blocker halt, conflict tracking, `turnId` prefix, `offSignal` cleanup, `advanceStep`, selected-audience resolver
- routing integration (10 tests): per-step mode selection, cost accumulation, ceiling enforcement, and fallback without a router

COORDINATION_PACKAGE_IMPLEMENTED
