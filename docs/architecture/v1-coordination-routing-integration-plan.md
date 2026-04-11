# v1 Coordination-Routing Integration Plan

**Date:** 2026-04-11
**Packages:** `@relay-assistant/coordination`, `@relay-assistant/routing`, `@relay-assistant/connectivity`
**Input:** v1 routing review verdict, v1 coordination hardening review verdict, current package implementations
**Status:** PLAN

---

## 1. V1 Integration Scope

### In scope

1. **Add optional `Router` to `CoordinatorConfig`.** The coordinator calls `router.decide()` before each specialist step to determine the routing mode. The decision is passed to the specialist via `SpecialistContext`.
2. **Resolve `RequestedRoutingMode` ownership.** Connectivity currently redeclares the type independently. Establish a single canonical source to prevent drift.
3. **Wire `RoutingEscalationHook` through connectivity.** Connectivity already accepts a `routingEscalationHook` in its config. The integration ensures the router instance is passed as that hook when both packages are present.
4. **Accumulate per-turn cost in the router.** After each specialist step completes, coordination calls `router.recordCost()` if the specialist result includes cost metadata.
5. **Add integration tests** covering the coordinator-router interaction path.

### Out of scope (deferred to v1.1+)

- Provider SDK binding or concrete model resolution from `ModelSpec`
- Quality-preserving constraints (spec v1.2)
- Parallel delegation with routing
- Product-specific routing policies (Sage, MSD, NightCTO)
- Cost denomination (OQ-3 — remains abstract number)
- Dynamic re-routing mid-step

---

## 2. CoordinatorConfig Gains Routing Without Owning It

### Design principle

Coordination **accepts** a router but never **creates** one. The coordinator treats routing as an optional capability — if no router is provided, behavior is identical to the current implementation (no mode selection occurs). This preserves coordination's zero-dependency relationship with routing at the package level.

### Type changes to `@relay-assistant/coordination`

```ts
// coordination/src/types.ts — new additions

import type { RoutingMode } from '@relay-assistant/routing';

/**
 * Minimal routing interface consumed by coordination.
 * Mirrors the subset of Router that coordination needs,
 * avoiding a hard coupling to the full Router type.
 */
export interface CoordinationRouter {
  decide(context: {
    threadId: string;
    capability: string;
    accumulatedCost?: number;
    requestedMode?: RoutingMode;
  }): {
    mode: RoutingMode;
    modelSpec: { tier: string; hints: Record<string, unknown> };
    reason: string;
    escalated: boolean;
    overridden: boolean;
  };
  recordCost(threadId: string, cost: number): void;
  getAccumulatedCost(threadId: string): number;
}

// Updated CoordinatorConfig
export interface CoordinatorConfig {
  registry: SpecialistRegistry;
  connectivity: ConnectivityLayer;
  synthesis: SynthesisConfig;
  maxSteps?: number;
  router?: CoordinationRouter;  // NEW — optional
}
```

### Why a structural interface instead of importing `Router` directly

The `CoordinationRouter` interface is a **structural subset** of `Router`. This means:

- A real `Router` from `@relay-assistant/routing` satisfies it without an adapter.
- Coordination's `package.json` does **not** add `@relay-assistant/routing` as a runtime dependency.
- `@relay-assistant/routing` is a **dev dependency** only (for type imports and tests).
- Consumers that do not use routing are not forced to install the routing package.

The one type coordination does import directly is `RoutingMode` (`'cheap' | 'fast' | 'deep'`), which is a simple string union. This is acceptable because the type is stable by design (spec §4) and the import is type-only, erased at runtime.

### Alternative considered and rejected

**Importing `Router` directly:** This would create a hard runtime dependency edge from coordination to routing, violating the boundary map principle that packages below the product layer should be independently consumable. Rejected.

---

## 3. Shared Contract for `RequestedRoutingMode`

### Current state (drift risk)

`RequestedRoutingMode = 'cheap' | 'fast' | 'deep'` is independently declared in:

- `connectivity/src/types.ts` (line 26)
- `routing/src/types.ts` (line 68)

The routing review (F-4) correctly identifies this as a source of drift.

### Resolution

**Routing owns the canonical definition.** This follows the spec (§8) which says connectivity should import from routing.

#### Changes required

1. **`@relay-assistant/connectivity`** adds `@relay-assistant/routing` as a **type-only dev dependency**.

2. **`connectivity/src/types.ts`** replaces its local declaration:

   ```ts
   // BEFORE
   export type RequestedRoutingMode = 'cheap' | 'fast' | 'deep';

   // AFTER
   export type { RequestedRoutingMode } from '@relay-assistant/routing';
   ```

   Since this is a `type` re-export, it is erased at compile time. Connectivity retains zero runtime dependencies on routing.

3. **`connectivity/src/types.ts`** re-exports the type so downstream consumers that import from connectivity are not broken. The public API surface is unchanged.

4. **`RoutingEscalationHook` dual definition (F-3):** Routing owns the canonical `RoutingEscalationHook`. Connectivity re-exports it from routing via type-only import:

   ```ts
   // connectivity/src/types.ts
   export type { RoutingEscalationHook } from '@relay-assistant/routing';
   ```

   This eliminates the latent drift risk while keeping connectivity's runtime dependency set unchanged.

### Verification

Add a TypeScript compilation test (or a simple `.ts` file in the connectivity test suite) that assigns a `Router` to a `RoutingEscalationHook` variable, confirming structural compatibility is maintained at build time.

---

## 4. Connectivity Escalation vs. Routing Selection: Conceptual Separation

These two concerns must remain distinct even though they interact:

| Concern | Owner | Responsibility |
|---|---|---|
| **Escalation signaling** | Connectivity | Detects when a specialist emits an escalation signal (e.g., `escalation.uncertainty`). Notifies the routing hook if one is registered. |
| **Mode selection** | Routing | Evaluates the full decision context (escalations, cost, latency, policy) and returns a `RoutingDecision`. |
| **Step orchestration** | Coordination | Calls `router.decide()` before each step. Passes the resulting mode to the specialist context. Does not interpret the mode — just forwards it. |

### Data flow

```
Specialist emits escalation signal
        │
        ▼
Connectivity layer captures signal
        │
        ├──► routingEscalationHook.onEscalation(signal)
        │         │
        │         ▼
        │    Router maps signal to mode (or ignores)
        │    (result stored internally for next decide() call)
        │
        ▼
Coordinator calls router.decide(context) before next step
        │
        ▼
Router evaluates full priority chain:
  caller request → capability → cost → escalation → latency → default → ceiling
        │
        ▼
RoutingDecision returned to coordinator
        │
        ▼
Coordinator passes decision.mode to SpecialistContext
```

### Key invariants

1. **Connectivity never selects a mode.** It only asks the routing hook "what mode does this signal suggest?" The hook's return value is advisory — routing uses it as one input among many in the priority chain.
2. **Routing never queries connectivity.** The router receives escalation signals via its `onEscalation()` hook (push model), and receives accumulated escalation summaries via `RoutingContext.activeEscalations` (pull model via coordinator). It does not hold a reference to the connectivity layer.
3. **Coordination never interprets routing decisions.** It does not check whether a mode is "sufficient" for a specialist. It forwards `decision.mode` and `decision.modelSpec` to the specialist context. The specialist (or the product layer above it) decides how to use the mode information.

### How coordination wires the hook

When creating a coordinator with both connectivity and router:

```ts
// Product-layer wiring (not inside coordination or routing packages)
const router = createRouter({ policy: { ... } });
const connectivity = createConnectivityLayer({
  routingEscalationHook: router,  // Router satisfies RoutingEscalationHook
});
const coordinator = createCoordinator({
  registry,
  connectivity,
  synthesis: { strategy: 'concatenate' },
  router,  // Optional — coordinator calls decide() if present
});
```

Coordination does not wire the routing hook into connectivity. That is the product layer's responsibility. This keeps the three packages independently testable.

---

## 5. Coordination Implementation Changes

### 5.1 SpecialistContext extension

```ts
// coordination/src/types.ts
export interface SpecialistContext {
  turnId: string;
  threadId: string;
  stepIndex: number;
  plan: DelegationPlan;
  priorResults: SpecialistResult[];
  connectivity: ConnectivityLayer;
  routingDecision?: {                     // NEW — optional
    mode: RoutingMode;
    tier: string;
    hints: Record<string, unknown>;
    reason: string;
    escalated: boolean;
    overridden: boolean;
  };
}
```

The `routingDecision` field is a plain object (not the full `RoutingDecision` type) to avoid coupling `SpecialistContext` to routing's type surface. It contains only the fields a specialist needs to act on.

### 5.2 Coordinator execute() changes

Inside the step loop in `createCoordinator`, before calling `specialist.handler.execute()`:

```ts
// Inside execute(), before specialist invocation
let routingDecision: SpecialistContext['routingDecision'] | undefined;

if (config.router) {
  const decision = config.router.decide({
    threadId,
    capability: step.specialistName,
    accumulatedCost: config.router.getAccumulatedCost(threadId),
  });

  routingDecision = {
    mode: decision.mode,
    tier: decision.modelSpec.tier,
    hints: decision.modelSpec.hints,
    reason: decision.reason,
    escalated: decision.escalated,
    overridden: decision.overridden,
  };
}
```

After specialist execution completes successfully:

```ts
// After specialist returns a result
if (config.router && result.metadata?.cost != null) {
  const cost = Number(result.metadata.cost);
  if (Number.isFinite(cost) && cost > 0) {
    config.router.recordCost(threadId, cost);
  }
}
```

### 5.3 CoordinationTurn extension

```ts
// coordination/src/types.ts — optional addition
export interface CoordinationTurn {
  // ... existing fields ...
  routingDecisions?: Array<{             // NEW — optional
    stepIndex: number;
    specialistName: string;
    mode: RoutingMode;
    reason: string;
  }>;
}
```

The coordinator collects routing decisions made during execution and includes them in the turn result. This gives the product layer visibility into what modes were selected and why, without requiring it to instrument the router separately.

---

## 6. Minimum Integration Tests

These tests are added to `coordination.test.ts` (or a new `coordination-routing.test.ts` file if preferred for isolation). They use a mock router that satisfies `CoordinationRouter`.

### Test inventory (12 tests)

**Group: Coordinator with router (7 tests)**

| # | Test | Asserts |
|---|---|---|
| 1 | Router decide() called once per step | `decide` call count === plan step count |
| 2 | RoutingDecision forwarded to SpecialistContext | `context.routingDecision.mode` matches router output |
| 3 | Router receives correct threadId and capability | `decide` called with `{ threadId, capability: step.specialistName }` |
| 4 | Cost recorded after step with cost metadata | `recordCost` called with `metadata.cost` value |
| 5 | Cost not recorded when metadata.cost is absent | `recordCost` not called |
| 6 | Cost not recorded when metadata.cost is non-finite | `recordCost` not called for `NaN`, `Infinity` |
| 7 | Accumulated cost passed to subsequent decide() calls | Second `decide()` call receives updated `accumulatedCost` |

**Group: Coordinator without router (2 tests)**

| # | Test | Asserts |
|---|---|---|
| 8 | No router — SpecialistContext.routingDecision is undefined | `context.routingDecision === undefined` |
| 9 | No router — coordinator behavior identical to pre-integration | Turn result matches existing test expectations exactly |

**Group: Routing decisions in turn result (3 tests)**

| # | Test | Asserts |
|---|---|---|
| 10 | Turn result includes routingDecisions array when router present | `turn.routingDecisions.length === plan.steps.length` |
| 11 | Each routing decision includes stepIndex, specialistName, mode, reason | Field presence and correctness |
| 12 | Turn result has no routingDecisions when router absent | `turn.routingDecisions === undefined` |

### Mock router factory for tests

```ts
function createMockRouter(overrides?: Partial<CoordinationRouter>): CoordinationRouter {
  const costs = new Map<string, number>();
  return {
    decide: overrides?.decide ?? (() => ({
      mode: 'fast' as const,
      modelSpec: { tier: 'medium', hints: {} },
      reason: 'policy_default',
      escalated: false,
      overridden: false,
    })),
    recordCost(threadId, cost) {
      costs.set(threadId, (costs.get(threadId) ?? 0) + cost);
    },
    getAccumulatedCost(threadId) {
      return costs.get(threadId) ?? 0;
    },
  };
}
```

---

## 7. Implementation Order

| Step | Change | Package | Depends on |
|---|---|---|---|
| 1 | Resolve `RequestedRoutingMode` — routing owns, connectivity re-exports | connectivity, routing | — |
| 2 | Resolve `RoutingEscalationHook` — routing owns, connectivity re-exports | connectivity, routing | Step 1 |
| 3 | Add `CoordinationRouter` interface and optional `router` to `CoordinatorConfig` | coordination | — |
| 4 | Extend `SpecialistContext` with optional `routingDecision` | coordination | Step 3 |
| 5 | Extend `CoordinationTurn` with optional `routingDecisions` | coordination | Step 3 |
| 6 | Implement routing calls in coordinator `execute()` | coordination | Steps 3–5 |
| 7 | Add 12 integration tests | coordination | Step 6 |
| 8 | Verify all existing 35 coordination tests still pass | coordination | Step 6 |
| 9 | Update coordination README with routing section | coordination | Step 7 |

Steps 1–2 and 3–5 are independent and can be done in parallel.

---

## 8. What This Plan Does NOT Change

- **Routing package:** No code changes. The router already satisfies `CoordinationRouter` structurally.
- **Connectivity implementation:** Only `types.ts` changes (type re-exports). No runtime code changes.
- **Existing coordination tests:** All 35 tests continue to pass. The router is optional; existing tests do not provide one.
- **Package dependency graph at runtime:** Coordination still has zero runtime dependency on routing. Connectivity still has zero runtime dependency on routing.

---

## 9. Definition of Done

- [ ] `RequestedRoutingMode` and `RoutingEscalationHook` have single canonical definitions in routing, re-exported by connectivity
- [ ] `CoordinatorConfig` accepts an optional `router: CoordinationRouter`
- [ ] `SpecialistContext` includes optional `routingDecision`
- [ ] `CoordinationTurn` includes optional `routingDecisions`
- [ ] Coordinator calls `router.decide()` before each step when router is present
- [ ] Coordinator calls `router.recordCost()` after steps with cost metadata
- [ ] 12 new integration tests pass
- [ ] All 35 existing coordination tests pass unchanged
- [ ] No new runtime dependencies added to any package
- [ ] Coordination README updated with routing integration section

---

V1_COORD_ROUTING_INTEGRATION_PLAN_READY
COORD_ROUTING_INTEGRATION_IMPLEMENTED
