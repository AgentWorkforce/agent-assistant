# v1 Routing Implementation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Date:** 2026-04-11
**Package:** `@relay-assistant/routing`
**Status:** IMPLEMENTATION_READY
**Spec:** `docs/specs/v1-routing-spec.md`
**Version target:** v0.1.0

---

## 1. Bounded v1 Routing Scope

### What v1 Routing Delivers

v1 routing delivers the **minimal contracts** for an assistant to make model-selection and response-mode decisions based on cost, latency, and quality requirements. The scope is:

1. **Routing modes** — the three-tier `cheap` / `fast` / `deep` model, informed by Workforce workload-router patterns
2. **Model selector** — given a routing context, returns a `ModelSpec` recommendation (not a concrete model ID)
3. **Routing policy** — per-assistant and per-capability routing rules; configures when to use each mode
4. **Routing context** — the signal envelope passed to the model selector for each invocation
5. **Cost envelope tracking** — per-thread accounting of accumulated cost; triggers mode downgrade when exceeded
6. **Latency envelope** — per-request latency target; routing selects models that can meet it
7. **Connectivity integration** — implements `RoutingEscalationHook` from `@relay-assistant/connectivity`; applies requested mode changes from escalation signals without taking ownership of connectivity

### What v1 Routing Does NOT Deliver

- **No provider SDK clients.** Routing returns `ModelSpec`; product code resolves it to a concrete model ID and makes the API call.
- **No load balancing, failover, or retries.** Those are Relay foundation or product concerns.
- **No semantic content inspection.** Routing reads structured context (capability name, cost envelope, escalation signals), never message text.
- **No multi-step planning.** One `RoutingDecision` per invocation context.
- **No session state or per-user history.** Routing is stateless except for per-thread cost accumulators.
- **No transport routing.** This is assistant-level model-choice routing, not network routing.
- **No product-specific commercial routing rules.** Products configure `RoutingPolicy`; routing applies it generically.
- **No persistent cost storage.** Per-thread cost accumulators are in-memory for the lifetime of the `Router` instance.

---

## 2. File Manifest

All files are created under `packages/routing/`.

### Package Infrastructure

| File | Purpose |
|---|---|
| `package.json` | Package manifest; no runtime dependency on connectivity (type-only import) |
| `tsconfig.json` | TypeScript config; strict mode |

### Runtime Source (`src/`)

| File | Purpose |
|---|---|
| `src/types.ts` | All type definitions, error classes, and constants |
| `src/router.ts` | `createRouter()` — factory that returns a `Router` implementing the decision algorithm and cost tracking |
| `src/index.ts` | Public API re-exports |

### Tests (`src/`)

| File | Purpose |
|---|---|
| `src/router.test.ts` | Router unit tests covering decision algorithm, cost tracking, escalation hook, and edge cases |

**Total: 6 files** (2 infrastructure + 3 runtime + 1 test)

### Why 3 Runtime Files

The routing spec defines a single decision algorithm with no complex internal subsystems. Unlike connectivity (signal lifecycle, suppression, audience resolution) or coordination (registry, delegation, synthesis, orchestrator), routing has one primary code path: `decide()`. Splitting the router across multiple files would create artificial boundaries. All logic fits naturally in `router.ts` alongside the `createRouter()` factory, with `types.ts` holding all type definitions and `index.ts` as the barrel export.

---

## 3. Type Definitions (`src/types.ts`)

### 3.1 Routing Mode

```ts
export type RoutingMode = 'cheap' | 'fast' | 'deep';
```

### 3.2 Model Tier and ModelSpec

```ts
export type ModelTier = 'small' | 'medium' | 'large' | 'frontier' | string;

export interface ModelSpec {
  mode: RoutingMode;
  tier: ModelTier;
  requiresToolUse: boolean;
  requiresStreaming: boolean;
  minContextTokens: number;
  maxLatencyMs: number;
  hints: Record<string, unknown>;
}
```

### 3.3 Routing Context

```ts
export interface EscalationSummary {
  signalClass: string;
  priority: string;
  requestedMode?: string;
}

export interface RoutingContext {
  threadId: string;
  capability: string;
  accumulatedCost?: number;
  requestedMaxLatencyMs?: number;
  requiresToolUse?: boolean;
  requiresStreaming?: boolean;
  minContextTokens?: number;
  activeEscalations?: EscalationSummary[];
  requestedMode?: RoutingMode;
}
```

### 3.4 Routing Decision

```ts
export type RoutingReason =
  | 'policy_default'
  | 'capability_override'
  | 'escalation_signal'
  | 'cost_envelope_exceeded'
  | 'latency_constraint'
  | 'caller_requested'
  | 'hard_constraint';

export interface RoutingDecision {
  mode: RoutingMode;
  modelSpec: ModelSpec;
  reason: RoutingReason;
  escalated: boolean;
  overridden: boolean;
}
```

### 3.5 Routing Policy

```ts
export interface RoutingPolicy {
  defaultMode?: RoutingMode;
  capabilityModes?: Record<string, RoutingMode>;
  costEnvelopeLimit?: number;
  modeCeiling?: RoutingMode;
  escalationModeMap?: Partial<Record<string, RoutingMode>>;
  modeModelSpecs?: Partial<Record<RoutingMode, Partial<ModelSpec>>>;
}
```

### 3.6 Router Interface

```ts
export interface Router {
  decide(context: RoutingContext): RoutingDecision;
  recordCost(threadId: string, cost: number): void;
  getAccumulatedCost(threadId: string): number;
  resetCost(threadId: string): void;
  onEscalation(signal: ConnectivityEscalationSignal): RequestedRoutingMode | void;
}
```

### 3.7 Connectivity Boundary Types

These types are defined in routing, not imported from connectivity, to avoid circular dependencies. Connectivity defines `RoutingEscalationHook`; routing's `Router.onEscalation` implements that interface. The types mirror the relevant fields.

```ts
export interface ConnectivityEscalationSignal {
  id: string;
  threadId: string;
  source: string;
  signalClass: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  summary: string;
}

export type RequestedRoutingMode = 'cheap' | 'fast' | 'deep';
```

### 3.8 Factory Config

```ts
export interface RouterConfig {
  policy?: RoutingPolicy;
}
```

### 3.9 Constants

```ts
export const ROUTING_MODES = ['cheap', 'fast', 'deep'] as const;
export const MODEL_TIERS = ['small', 'medium', 'large', 'frontier'] as const;
export const ROUTING_REASONS = [
  'policy_default',
  'capability_override',
  'escalation_signal',
  'cost_envelope_exceeded',
  'latency_constraint',
  'caller_requested',
  'hard_constraint',
] as const;

/**
 * Mode ordering for comparison. Higher index = deeper mode.
 * Used by modeCeiling enforcement and escalation priority.
 */
export const MODE_DEPTH: Record<RoutingMode, number> = {
  cheap: 0,
  fast: 1,
  deep: 2,
};

/**
 * Default ModelSpec values per mode when no modeModelSpecs override is configured.
 */
export const DEFAULT_MODE_SPECS: Record<RoutingMode, ModelSpec> = {
  cheap: {
    mode: 'cheap',
    tier: 'small',
    requiresToolUse: false,
    requiresStreaming: false,
    minContextTokens: 0,
    maxLatencyMs: 0,
    hints: {},
  },
  fast: {
    mode: 'fast',
    tier: 'medium',
    requiresToolUse: true,
    requiresStreaming: true,
    minContextTokens: 0,
    maxLatencyMs: 0,
    hints: {},
  },
  deep: {
    mode: 'deep',
    tier: 'large',
    requiresToolUse: true,
    requiresStreaming: true,
    minContextTokens: 0,
    maxLatencyMs: 0,
    hints: {},
  },
};
```

### 3.10 Error Classes

```ts
export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}

export class RoutingPolicyError extends RoutingError {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingPolicyError';
  }
}
```

---

## 4. Router Implementation (`src/router.ts`)

### 4.1 Factory: `createRouter(config)`

```ts
export function createRouter(config?: RouterConfig): Router;
```

The factory:

1. Normalizes `config.policy` — applies defaults (`defaultMode: 'fast'`, `modeCeiling: 'deep'`, no capability overrides, no cost limit, no escalation map)
2. Creates an internal `Map<string, number>` for per-thread cost accumulators
3. Returns a `Router` object with closure over the policy and cost map

### 4.2 Decision Algorithm: `decide(context)`

Applies rules in **spec §5 priority order** (highest to lowest). The first matching rule determines the mode. After selecting the mode, construct the `ModelSpec`.

**Step 1 — Resolve candidate mode:**

Walk the priority chain. Each rule either sets the mode and reason, or falls through.

| Priority | Rule | Mode | Reason | Notes |
|---|---|---|---|---|
| 1 | `modeCeiling` caps any candidate | capped mode | `'hard_constraint'` | Applied as a post-filter after every other rule, not as a standalone selector. Sets `overridden: true` if the candidate was capped. |
| 2 | `context.requestedMode` set | requested mode | `'caller_requested'` | Respected unless it violates `modeCeiling`. |
| 3 | `policy.capabilityModes[context.capability]` set | capability mode | `'capability_override'` | |
| 4 | `context.accumulatedCost > policy.costEnvelopeLimit` (and limit > 0) | `'cheap'` | `'cost_envelope_exceeded'` | |
| 5 | `context.activeEscalations` maps to a mode via `policy.escalationModeMap` | highest mapped mode | `'escalation_signal'` | Sets `escalated: true`. When multiple signals map, use the deepest mode. |
| 6 | `context.requestedMaxLatencyMs` set and `deep` mode's `maxLatencyMs` (from `modeModelSpecs`) exceeds it | `'fast'` or `'cheap'` | `'latency_constraint'` | Compare against `modeModelSpecs[mode].maxLatencyMs` if configured. |
| 7 | No other rule matched | `policy.defaultMode` | `'policy_default'` | |

**Step 2 — Apply `modeCeiling`:**

After selecting a candidate mode, if `MODE_DEPTH[candidate] > MODE_DEPTH[policy.modeCeiling]`, cap to `modeCeiling`. Set `overridden: true` and reason to `'hard_constraint'`.

**Step 3 — Construct `ModelSpec`:**

1. Start with `DEFAULT_MODE_SPECS[mode]` (deep copy)
2. Merge `policy.modeModelSpecs[mode]` overrides (if configured)
3. Apply context requirements: `requiresToolUse`, `requiresStreaming`, `minContextTokens`, `requestedMaxLatencyMs` → these override spec fields when context demands them (e.g., if context requires tool use but the mode default says false, set true)

**Step 4 — Return `RoutingDecision`.**

### 4.3 Cost Tracking

```ts
recordCost(threadId, cost):
  - Adds cost to the thread's accumulator (default 0)

getAccumulatedCost(threadId):
  - Returns the thread's accumulated cost (0 if no record)

resetCost(threadId):
  - Deletes the thread's cost record
```

Cost tracking is simple in-memory bookkeeping. The `decide()` method does **not** call `getAccumulatedCost` internally — the caller is expected to pass `accumulatedCost` in the context. This keeps `decide()` a pure function of its input. The cost methods exist for callers who want the router to be the single owner of cost state.

### 4.4 Escalation Hook: `onEscalation(signal)`

Implements `RoutingEscalationHook` from connectivity's perspective. Called by the connectivity layer when an escalation signal is emitted.

```ts
onEscalation(signal):
  1. If signal.signalClass starts with 'escalation.':
     a. Look up policy.escalationModeMap[signal.signalClass]
     b. If found, return the mapped RoutingMode
     c. If not found, return undefined (no routing opinion)
  2. If signal.signalClass does not start with 'escalation.':
     return undefined (routing only responds to escalation-class signals)
```

This is how connectivity calls routing without routing depending on connectivity. The connectivity layer holds a `RoutingEscalationHook` reference; routing's `onEscalation` method satisfies that interface. No import of `@relay-assistant/connectivity` is needed at runtime — only the mirrored `ConnectivityEscalationSignal` type defined in routing's own `types.ts`.

---

## 5. Connectivity Integration (Boundary Contract)

### 5.1 Dependency Direction

```
connectivity ──defines──> RoutingEscalationHook (interface)
connectivity ──calls───> router.onEscalation(signal)
routing ──implements──> RoutingEscalationHook
routing ──defines──> ConnectivityEscalationSignal (mirror type)
```

- **Routing does NOT import `@relay-assistant/connectivity`** at runtime. No dependency in `package.json`.
- **Routing defines its own `ConnectivityEscalationSignal`** — a minimal mirror of the fields connectivity passes. This avoids circular imports per spec §4.7.
- **Connectivity passes a `Router` as its `routingEscalationHook`** at construction time. The wiring is done by the consumer (product code or `@relay-assistant/core`), not by either package.

### 5.2 Wiring Example (for consumer documentation)

```ts
import { createConnectivityLayer } from '@relay-assistant/connectivity';
import { createRouter } from '@relay-assistant/routing';

const router = createRouter({ policy: { /* ... */ } });
const connectivity = createConnectivityLayer({
  routingEscalationHook: router, // Router satisfies RoutingEscalationHook
});
```

### 5.3 What Routing Does NOT Do With Connectivity

- Routing does not subscribe to `onSignal`. It only receives individual escalation signals via `onEscalation`.
- Routing does not emit signals. It has no reference to the connectivity layer.
- Routing does not query signals. It receives `activeEscalations` in `RoutingContext`, pre-assembled by the caller.
- Routing does not know about signal lifecycle (superseded, expired, resolved). It reads the `signalClass` and `priority` of what it receives.

---

## 6. Public API Surface (`src/index.ts`)

### Exported Functions

```ts
export { createRouter } from './router.js';
```

### Exported Types

```ts
export type {
  RoutingMode,
  ModelTier,
  ModelSpec,
  RoutingContext,
  EscalationSummary,
  RoutingDecision,
  RoutingReason,
  RoutingPolicy,
  Router,
  RouterConfig,
  ConnectivityEscalationSignal,
  RequestedRoutingMode,
} from './types.js';
```

### Exported Constants

```ts
export {
  ROUTING_MODES,
  MODEL_TIERS,
  ROUTING_REASONS,
  MODE_DEPTH,
  DEFAULT_MODE_SPECS,
} from './types.js';
```

### Exported Error Classes

```ts
export { RoutingError, RoutingPolicyError } from './types.js';
```

---

## 7. Package Infrastructure

### 7.1 `package.json`

```json
{
  "name": "@relay-assistant/routing",
  "version": "0.1.0",
  "description": "Assistant-level routing: cheap/fast/deep mode selection, cost/latency envelopes, model-spec recommendations",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "files": ["dist"],
  "license": "MIT"
}
```

**Key:** No runtime dependencies. No dependency on `@relay-assistant/connectivity`. The connectivity boundary types are mirrored in routing's own `types.ts`. No dependency on `nanoid` — routing does not generate IDs.

### 7.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

---

## 8. Implementation Steps (Ordered by Dependency)

### Step 1: `src/types.ts`

Write all types, interfaces, constants, and error classes from §3. This file has no imports. It is the dependency root.

**Acceptance:** `tsc --noEmit` passes. All types from spec §4.1–4.7 are present. Constants from §3.9 are defined.

### Step 2: `src/router.ts`

Implement `createRouter()` per §4.

Internal structure:

```ts
import {
  type Router,
  type RouterConfig,
  type RoutingContext,
  type RoutingDecision,
  type RoutingMode,
  type ModelSpec,
  type ConnectivityEscalationSignal,
  type RequestedRoutingMode,
  MODE_DEPTH,
  DEFAULT_MODE_SPECS,
} from './types.js';

export function createRouter(config?: RouterConfig): Router {
  const policy = normalizePolicy(config?.policy);
  const costMap = new Map<string, number>();

  return {
    decide(context) { /* §4.2 algorithm */ },
    recordCost(threadId, cost) { /* §4.3 */ },
    getAccumulatedCost(threadId) { /* §4.3 */ },
    resetCost(threadId) { /* §4.3 */ },
    onEscalation(signal) { /* §4.4 */ },
  };
}
```

Internal helpers (not exported):

- `normalizePolicy(policy?)` — fills in defaults
- `selectMode(context, policy)` — the priority-chain from §4.2
- `applyModeCeiling(mode, ceiling)` — caps mode depth
- `buildModelSpec(mode, policy, context)` — merges defaults, policy overrides, and context requirements

**Acceptance:** `tsc --noEmit` passes. All `Router` methods are implemented.

### Step 3: `src/index.ts`

Barrel export per §6. Re-exports factory, types, constants, and error classes.

**Acceptance:** `tsc --noEmit` passes. Import `{ createRouter, type Router, type RoutingDecision }` works from the package.

### Step 4: `src/router.test.ts`

Write all tests from §9.

**Acceptance:** `vitest run` passes. All minimum tests from §9 are green.

---

## 9. Minimum Tests

Tests are organized in `describe` blocks matching the logical groups below. **Minimum: 35 tests.**

### Group 1: Default Behavior (4 tests)

| # | Test | Assertion |
|---|---|---|
| 1 | `createRouter()` with no config uses `fast` default mode | `decide({ threadId: 't1', capability: 'chat' }).mode === 'fast'` |
| 2 | Default decision reason is `'policy_default'` | `decide(...).reason === 'policy_default'` |
| 3 | Default decision is not escalated | `decide(...).escalated === false` |
| 4 | Default decision is not overridden | `decide(...).overridden === false` |

### Group 2: Policy Default Mode (2 tests)

| # | Test | Assertion |
|---|---|---|
| 5 | Policy with `defaultMode: 'cheap'` returns `'cheap'` | `decide(...).mode === 'cheap'` |
| 6 | Policy with `defaultMode: 'deep'` returns `'deep'` | `decide(...).mode === 'deep'` |

### Group 3: Caller Override (3 tests)

| # | Test | Assertion |
|---|---|---|
| 7 | `requestedMode: 'deep'` overrides default `'fast'` | `decide({ ..., requestedMode: 'deep' }).mode === 'deep'` |
| 8 | Caller override reason is `'caller_requested'` | `.reason === 'caller_requested'` |
| 9 | `requestedMode: 'deep'` capped by `modeCeiling: 'fast'` | `decide(...).mode === 'fast'`, `reason === 'hard_constraint'`, `overridden === true` |

### Group 4: Capability Override (3 tests)

| # | Test | Assertion |
|---|---|---|
| 10 | `capabilityModes: { summarize: 'cheap' }` returns `'cheap'` for `capability: 'summarize'` | `.mode === 'cheap'` |
| 11 | Capability override reason is `'capability_override'` | `.reason === 'capability_override'` |
| 12 | Capability override does not apply to a different capability | `decide({ capability: 'analyze' }).mode === 'fast'` (default) |

### Group 5: Cost Envelope (4 tests)

| # | Test | Assertion |
|---|---|---|
| 13 | Cost exceeds envelope → `'cheap'` mode | Policy `costEnvelopeLimit: 100`, context `accumulatedCost: 101` → `.mode === 'cheap'` |
| 14 | Cost envelope reason is `'cost_envelope_exceeded'` | `.reason === 'cost_envelope_exceeded'` |
| 15 | Cost at exactly the limit does NOT trigger downgrade | `accumulatedCost: 100`, limit `100` → mode is default, not `'cheap'` |
| 16 | Cost envelope limit of 0 means no limit | `accumulatedCost: 9999`, limit `0` → mode is default |

### Group 6: Escalation Signals (4 tests)

| # | Test | Assertion |
|---|---|---|
| 17 | Active escalation maps to configured mode | `escalationModeMap: { 'escalation.interrupt': 'deep' }`, context has matching escalation → `.mode === 'deep'` |
| 18 | Escalation sets `escalated: true` | `.escalated === true` |
| 19 | Escalation reason is `'escalation_signal'` | `.reason === 'escalation_signal'` |
| 20 | Multiple escalations → deepest mapped mode wins | Two escalations, one maps to `'fast'`, one to `'deep'` → `.mode === 'deep'` |

### Group 7: Latency Constraint (3 tests)

| # | Test | Assertion |
|---|---|---|
| 21 | Latency constraint downgrades from `'deep'` to `'fast'` | `modeModelSpecs: { deep: { maxLatencyMs: 5000 } }`, context `requestedMaxLatencyMs: 2000`, default `'deep'` → `.mode === 'fast'` |
| 22 | Latency constraint reason is `'latency_constraint'` | `.reason === 'latency_constraint'` |
| 23 | Latency constraint does not apply when no `requestedMaxLatencyMs` | Default `'deep'` → `.mode === 'deep'` |

### Group 8: Mode Ceiling (3 tests)

| # | Test | Assertion |
|---|---|---|
| 24 | `modeCeiling: 'fast'` caps `'deep'` to `'fast'` | Escalation requests `'deep'`, ceiling is `'fast'` → `.mode === 'fast'` |
| 25 | `modeCeiling: 'cheap'` caps everything to `'cheap'` | Default `'fast'` → `.mode === 'cheap'` |
| 26 | `modeCeiling: 'deep'` does not cap anything | Default `'deep'` → `.mode === 'deep'` |

### Group 9: ModelSpec Construction (4 tests)

| # | Test | Assertion |
|---|---|---|
| 27 | Default `'fast'` mode produces `tier: 'medium'` | `.modelSpec.tier === 'medium'` |
| 28 | `modeModelSpecs` override replaces tier | `modeModelSpecs: { fast: { tier: 'large' } }` → `.modelSpec.tier === 'large'` |
| 29 | Context `requiresToolUse: true` overrides spec | Mode `'cheap'` (default no tool use), context `requiresToolUse: true` → `.modelSpec.requiresToolUse === true` |
| 30 | `requestedMaxLatencyMs` propagates to `modelSpec.maxLatencyMs` | Context `requestedMaxLatencyMs: 3000` → `.modelSpec.maxLatencyMs === 3000` |

### Group 10: Cost Tracking (4 tests)

| # | Test | Assertion |
|---|---|---|
| 31 | `getAccumulatedCost` returns 0 for unknown thread | `router.getAccumulatedCost('unknown') === 0` |
| 32 | `recordCost` accumulates | `recordCost('t1', 10)`, `recordCost('t1', 20)` → `getAccumulatedCost('t1') === 30` |
| 33 | `resetCost` clears accumulator | `recordCost('t1', 50)`, `resetCost('t1')` → `getAccumulatedCost('t1') === 0` |
| 34 | Cost tracking is per-thread | `recordCost('t1', 10)`, `recordCost('t2', 20)` → `getAccumulatedCost('t1') === 10`, `getAccumulatedCost('t2') === 20` |

### Group 11: Escalation Hook (4 tests)

| # | Test | Assertion |
|---|---|---|
| 35 | `onEscalation` returns mapped mode for `escalation.interrupt` | `escalationModeMap: { 'escalation.interrupt': 'deep' }` → `router.onEscalation({ signalClass: 'escalation.interrupt', ... }) === 'deep'` |
| 36 | `onEscalation` returns mapped mode for `escalation.uncertainty` | Mapped to `'fast'` → returns `'fast'` |
| 37 | `onEscalation` returns `undefined` for unmapped escalation class | No map entry → returns `undefined` |
| 38 | `onEscalation` returns `undefined` for non-escalation signal class | `signalClass: 'attention.raise'` → returns `undefined` |

### Group 12: Priority Chain (2 tests)

| # | Test | Assertion |
|---|---|---|
| 39 | Caller override takes precedence over capability override | `capabilityModes: { chat: 'cheap' }`, `requestedMode: 'deep'` → `.mode === 'deep'`, `.reason === 'caller_requested'` |
| 40 | Cost envelope takes precedence over escalation signals | Cost exceeded + active escalation requesting `'deep'` → `.mode === 'cheap'`, `.reason === 'cost_envelope_exceeded'` |

---

## 10. Definition of Done

1. All 6 files from §2 exist under `packages/routing/`
2. All types from §3 are defined in `src/types.ts`
3. `tsc --noEmit` passes with strict mode and `exactOptionalPropertyTypes: true`
4. `createRouter()` implements the full decision algorithm from §4.2
5. All 40 tests from §9 pass via `vitest run`
6. No runtime dependency on `@relay-assistant/connectivity` — boundary types are mirrored
7. No runtime dependency on any provider SDK
8. `src/index.ts` exports exactly the surface from §6

---

## 11. Post-v1 Extensions (Explicitly Deferred)

These are mentioned here only to establish that v1 intentionally excludes them:

- **Routing analytics / metrics emission** — tracking which modes are selected over time
- **Dynamic policy updates** — changing routing policy without recreating the router
- **Multi-model strategies** — selecting multiple models for consensus or fallback
- **Provider-aware routing** — failover between providers when one is down
- **Session-scoped routing memory** — remembering past routing decisions to inform future ones
- **Coordination-aware routing** — routing decisions informed by the delegation plan or specialist lineup

---

V1_ROUTING_IMPLEMENTATION_PLAN_READY
