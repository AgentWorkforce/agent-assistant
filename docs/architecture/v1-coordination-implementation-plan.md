# v1 Coordination Implementation Plan

**Date:** 2026-04-11
**Package:** `@relay-assistant/coordination`
**Status:** IMPLEMENTATION_READY

> **Post-review update (2026-04-11):** The public export is `validateDelegationPlan`, not `validatePlan`.
> This was decided during hardening review because the longer name is more descriptive and avoids
> ambiguity with future plan types. See `v1-coordination-hardening-plan.md` H-4.
>
> **Post-review update (2026-04-11):** The turnId prefix is `coord_`, not `turn_`.
> This avoids collision with session or conversation turn IDs. See
> `v1-coordination-hardening-plan.md` H-5.

---

## 1. Bounded v1 Coordination Scope

### What v1 Coordination Delivers

v1 coordination delivers the **minimal contracts** for one assistant to orchestrate multiple internal specialists and synthesize a single coherent response. The scope is:

1. **Specialist registry** — register and look up named specialists with declared capabilities
2. **Coordinator lifecycle** — create a coordinator that owns a delegation thread, delegates to specialists, collects results, and synthesizes one response
3. **Delegation plans** — structured descriptions of what work to delegate, to whom, and in what order
4. **Synthesis** — a contract for combining specialist results into a single assistant-facing output
5. **Connectivity integration** — the coordinator listens for connectivity signals from specialists and uses them to make coordination decisions (handoffs, escalations, conflicts)

### What v1 Coordination Does NOT Deliver

- **No product-specific specialist lineups.** Products register their own specialists.
- **No product-specific dispatch heuristics.** The coordinator delegates based on the plan; products supply the plan.
- **No memory integration.** Coordination does not read or write memory. Memory-aware delegation is post-v1.
- **No routing integration.** Coordination does not select models or response modes. It may receive routing-mode suggestions via connectivity escalation signals, but it does not call the routing package directly.
- **No surface awareness.** Coordination operates on text-in/text-out contracts. Surface formatting and delivery are handled by core + surfaces after synthesis.
- **No parallel execution engine.** v1 delegates sequentially within a plan. Parallel delegation is a post-v1 extension.
- **No persistent delegation state.** Delegation plans and specialist results are in-memory for the duration of one coordination turn. No storage backend is required.

---

## 2. File Manifest

All files are created under `packages/coordination/`.

### Package Infrastructure

| File | Purpose |
|---|---|
| `package.json` | Package manifest; depends on `@relay-assistant/connectivity` |
| `tsconfig.json` | TypeScript config; extends monorepo base if present, strict mode |

### Runtime Source (`src/`)

| File | Purpose |
|---|---|
| `src/types.ts` | All type definitions, error classes, and constants |
| `src/registry.ts` | `createSpecialistRegistry()` — register, unregister, lookup specialists |
| `src/delegation.ts` | `createDelegationPlan()` — build and validate delegation plans |
| `src/synthesis.ts` | `createSynthesizer()` — combine specialist results into one output |
| `src/coordinator.ts` | `createCoordinator()` — top-level orchestration: plan → delegate → signal-listen → synthesize |
| `src/index.ts` | Public API re-exports |

### Tests (`src/`)

| File | Purpose |
|---|---|
| `src/registry.test.ts` | Specialist registry unit tests |
| `src/delegation.test.ts` | Delegation plan unit tests |
| `src/synthesis.test.ts` | Synthesis unit tests |
| `src/coordinator.test.ts` | Coordinator orchestration tests including connectivity integration |

**Total: 12 files** (2 infrastructure + 6 runtime + 4 test)

---

## 3. Type Definitions (`src/types.ts`)

### 3.1 Specialist

```ts
export interface SpecialistDefinition {
  /** Unique name within the coordinator scope. */
  name: string;
  /** Human-readable description of what this specialist does. */
  description: string;
  /** Declared capability tags. Used by products to match specialists to plan steps. */
  capabilities: string[];
}

export interface SpecialistHandler {
  /**
   * Execute a delegation step and return a result.
   * The handler receives the instruction text and a context object.
   */
  execute(instruction: string, context: SpecialistContext): Promise<SpecialistResult>;
}

export interface Specialist extends SpecialistDefinition {
  handler: SpecialistHandler;
}

export interface SpecialistContext {
  /** The delegation thread ID (same as the connectivity threadId). */
  threadId: string;
  /** Prior results from earlier steps in the plan, in order. */
  priorResults: SpecialistResult[];
  /** Connectivity layer for emitting signals back to the coordinator. */
  connectivity: ConnectivityLayer;
}

export interface SpecialistResult {
  /** Name of the specialist that produced this result. */
  specialistName: string;
  /** The output text from the specialist. */
  output: string;
  /** Specialist-reported confidence in its result (0.0–1.0). */
  confidence?: number;
  /** Whether the specialist considers its step complete or partial. */
  status: 'complete' | 'partial' | 'failed';
  /** Optional structured metadata for downstream synthesis. */
  metadata?: Record<string, unknown>;
}
```

### 3.2 Specialist Registry

```ts
export interface SpecialistRegistry {
  register(specialist: Specialist): void;
  unregister(name: string): void;
  get(name: string): Specialist | null;
  list(): Specialist[];
  has(name: string): boolean;
}
```

### 3.3 Delegation Plan

```ts
export interface DelegationStep {
  /** Which specialist to delegate to (must exist in the registry). */
  specialistName: string;
  /** Instruction text for the specialist. */
  instruction: string;
  /** If true, the coordinator may skip this step on failure rather than aborting the plan. */
  optional?: boolean;
}

export interface DelegationPlan {
  /** Ordered sequence of steps to execute. */
  steps: DelegationStep[];
  /** Human-readable description of the plan's intent. */
  intent: string;
}

export interface DelegationPlanValidation {
  valid: boolean;
  errors: string[];
}
```

### 3.4 Synthesis

```ts
export type SynthesisStrategy = 'concatenate' | 'last-wins' | 'custom';

export interface SynthesisConfig {
  strategy: SynthesisStrategy;
  /** Required when strategy is 'custom'. */
  customFn?: (results: SpecialistResult[], plan: DelegationPlan) => SynthesisOutput;
}

export interface SynthesisOutput {
  /** The synthesized text to return as the assistant's response. */
  text: string;
  /** Which specialist results were included. */
  contributingSpecialists: string[];
  /** Whether synthesis produced a complete or degraded result. */
  quality: 'complete' | 'degraded';
}

export interface Synthesizer {
  synthesize(results: SpecialistResult[], plan: DelegationPlan): SynthesisOutput;
}
```

### 3.5 Coordinator

```ts
export interface CoordinatorConfig {
  /** The specialist registry to use for lookups. */
  registry: SpecialistRegistry;
  /** The connectivity layer for signal exchange during delegation. */
  connectivity: ConnectivityLayer;
  /** Synthesis configuration. */
  synthesis: SynthesisConfig;
  /** Maximum number of delegation steps per turn. Defaults to 10. */
  maxSteps?: number;
}

export interface CoordinationTurn {
  /** Unique ID for this coordination turn. */
  turnId: string;
  /** The delegation plan executed. */
  plan: DelegationPlan;
  /** Ordered results from each executed step. */
  results: SpecialistResult[];
  /** The synthesized output. */
  output: SynthesisOutput;
  /** Steps that were skipped (optional steps that failed). */
  skippedSteps: DelegationStep[];
}

export interface Coordinator {
  /**
   * Execute a delegation plan: validate, delegate to specialists
   * in order, listen for connectivity signals, synthesize results.
   */
  execute(plan: DelegationPlan): Promise<CoordinationTurn>;
}
```

### 3.6 Error Classes

```ts
export class CoordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinationError';
  }
}

export class SpecialistNotFoundError extends CoordinationError {
  constructor(name: string) {
    super(`Specialist not found: ${name}`);
    this.name = 'SpecialistNotFoundError';
  }
}

export class DelegationPlanError extends CoordinationError {
  constructor(message: string) {
    super(message);
    this.name = 'DelegationPlanError';
  }
}

export class SynthesisError extends CoordinationError {
  constructor(message: string) {
    super(message);
    this.name = 'SynthesisError';
  }
}
```

---

## 4. Implementation Details

### 4.1 `createSpecialistRegistry()` (`src/registry.ts`)

Creates an in-memory `SpecialistRegistry`.

**Behavior:**
- `register(specialist)` — validates `name` is non-empty, `capabilities` is an array. Throws `CoordinationError` if a specialist with the same name is already registered.
- `unregister(name)` — removes by name. No-op if not found.
- `get(name)` — returns `Specialist | null`.
- `list()` — returns a defensive copy of all registered specialists.
- `has(name)` — boolean check.

### 4.2 `createDelegationPlan()` (`src/delegation.ts`)

Factory that builds a `DelegationPlan` from steps and intent, plus a standalone
`validateDelegationPlan()` function.

**`validateDelegationPlan(plan, registry): DelegationPlanValidation`**
- Every step's `specialistName` must exist in the registry.
- `instruction` must be a non-empty string.
- `intent` must be a non-empty string.
- `steps` must contain at least one entry.
- Returns `{ valid: true, errors: [] }` or `{ valid: false, errors: [...] }`.

**`createDelegationPlan(input): DelegationPlan`**
- Accepts `{ steps, intent }` and returns a `DelegationPlan` copy.
- Validates against the registry and throws `DelegationPlanError` on invalid structure or
  unknown specialists.
- To construct a plan before registry population, use the `DelegationPlan` interface directly and
  validate later with `validateDelegationPlan()`.

### 4.3 `createSynthesizer()` (`src/synthesis.ts`)

Creates a `Synthesizer` from a `SynthesisConfig`.

**Built-in strategies:**
- `concatenate` — joins all `complete` and `partial` results with double newlines. `failed` results are excluded. If all results failed, returns `quality: 'degraded'` with a fallback message.
- `last-wins` — returns the last non-failed result. If all failed, `quality: 'degraded'`.
- `custom` — delegates to `customFn`. Throws `SynthesisError` if `customFn` is not provided.

**All strategies:**
- Populate `contributingSpecialists` from included results.
- Set `quality: 'complete'` if at least one `complete` result was included, `'degraded'` otherwise.

### 4.4 `createCoordinator()` (`src/coordinator.ts`)

Creates a `Coordinator` from a `CoordinatorConfig`.

**`execute(plan): Promise<CoordinationTurn>`**

Orchestration sequence:

1. **Validate plan** — call `validateDelegationPlan(plan, config.registry)`. Throw
   `DelegationPlanError` if invalid.
2. **Generate turnId** — `coord_<nanoid>`.
3. **Create connectivity thread** — use `plan` intent as the thread context. The `threadId` is the `turnId`.
4. **Subscribe to connectivity signals** — call `connectivity.onSignal(callback)` to listen for specialist signals during execution.
5. **Execute steps sequentially:**
   - For each `DelegationStep`:
     a. Look up specialist via `registry.get(step.specialistName)`.
     b. Build `SpecialistContext` with `threadId`, `priorResults`, and `connectivity`.
     c. Call `specialist.handler.execute(step.instruction, context)`.
     d. On success: push result to `priorResults`. Call `connectivity.advanceStep(threadId)`.
     e. On failure (handler throws): if `step.optional`, record in `skippedSteps` and continue. If required, push a `failed` result and abort remaining steps.
   - Check for `escalation.interrupt` signals after each step. If received, abort remaining steps.
   - Check for `conflict.active` signals. If present, include them in the turn for product-level resolution.
6. **Unsubscribe** — call `connectivity.offSignal(callback)`.
7. **Synthesize** — call `synthesizer.synthesize(results, plan)`.
8. **Return `CoordinationTurn`** with `turnId`, `plan`, `results`, `output`, `skippedSteps`.

**Connectivity signal handling during execution:**

The coordinator registers a per-turn `SelectedAudienceResolver` on the connectivity layer so that
signals with `audience: 'selected'` are scoped to the current plan participants other than the
emitting specialist. The coordinator does not take ownership of routing policy or transport.

Signal reactions:
- `escalation.interrupt` → abort remaining steps, synthesize what is available
- `escalation.uncertainty` → logged, but does not abort (routing may react via its own hook)
- `handoff.ready` → the specialist is done; proceed to next step (this is the normal flow)
- `handoff.partial` → the specialist yielded a partial result; proceed but mark the result as `partial`
- `confidence.low` or `confidence.blocker` → logged; the coordinator includes confidence in the `SpecialistResult` for synthesis decisions
- `conflict.active` → recorded in turn metadata for product-level resolution

---

## 5. Dependency Boundaries

### 5.1 Coordination → Connectivity (DEPENDS)

Coordination **imports** from `@relay-assistant/connectivity`:

```ts
import type {
  ConnectivityLayer,
  ConnectivitySignal,
  SignalCallback,
  SelectedAudienceResolver,
} from '@relay-assistant/connectivity';
```

Coordination uses connectivity for:
- **Signal subscription** (`onSignal` / `offSignal`) — the coordinator listens for specialist signals during delegation
- **Signal emission** (`emit`) — the coordinator emits acknowledgment signals (e.g., after resolving a handoff)
- **Step advancement** (`advanceStep`) — the coordinator advances the connectivity step counter after each delegation step, which expires step-scoped signals and resets suppression
- **Signal query** (`query`) — the coordinator may query for active signals at synthesis time to inform degraded-quality decisions
- **Signal resolution** (`resolve`) — the coordinator resolves signals it has acted on (e.g., conflict.active after product-level resolution)
- **Audience resolver** (`registerSelectedResolver`) — the coordinator registers a resolver so `audience: 'selected'` signals can target specific specialists

Coordination does NOT:
- Create or configure the connectivity layer (the consumer passes it in via `CoordinatorConfig`)
- Override suppression configuration
- Access connectivity internals beyond the `ConnectivityLayer` interface

### 5.2 Coordination → Routing (DOES NOT DEPEND)

Coordination does **not** import `@relay-assistant/routing`. The separation works as follows:

- If a specialist emits an `escalation.uncertainty` or `escalation.interrupt` signal, the **connectivity layer's routing escalation hook** (configured by the consumer, not by coordination) may notify the routing package.
- Coordination never calls routing APIs. It never selects models, response modes, or cost tiers.
- If a consumer wants routing-aware coordination, they wire the `RoutingEscalationHook` on the shared `ConnectivityLayer` instance before passing it to `createCoordinator()`.

### 5.3 Coordination → Memory (DOES NOT DEPEND)

Coordination does **not** import `@relay-assistant/memory`. Specialists may use memory internally (via their handler implementations), but the coordination contracts are memory-agnostic. Memory-aware delegation planning (e.g., "use the specialist that last handled this topic") is a post-v1 extension.

### 5.4 Coordination → Surfaces (DOES NOT DEPEND)

Coordination does **not** import `@relay-assistant/surfaces`. The coordinator produces a `SynthesisOutput` with plain text. The capability handler in `@relay-assistant/core` is responsible for emitting the synthesized text to the correct surfaces via `context.runtime.emit()`.

### 5.5 Coordination → Core (DOES NOT DEPEND at runtime)

Coordination does **not** import `@relay-assistant/core` at runtime. It is designed to be registered as a subsystem on the `AssistantRuntime` via `runtime.register('coordination', coordinator)`, but this registration is performed by the consumer, not by the coordination package itself.

The consumer's capability handler bridges core and coordination:

```ts
// In the product's capability handler (NOT inside coordination package)
const coordinator = context.runtime.get<Coordinator>('coordination');
const plan = buildPlanFromMessage(message); // product logic
const turn = await coordinator.execute(plan);
await context.runtime.emit({ surfaceId: message.surfaceId, text: turn.output.text });
```

### 5.6 Dependency Direction Summary

```
Consumer (product code)
  ├── @relay-assistant/core        (runtime, dispatch, emit)
  ├── @relay-assistant/sessions    (session resolution)
  ├── @relay-assistant/surfaces    (surface delivery)
  ├── @relay-assistant/coordination (coordinator, registry, plans)
  │     └── @relay-assistant/connectivity (signal exchange)
  └── @relay-assistant/connectivity (shared instance passed to coordinator)
```

Coordination has exactly **one** package dependency: `@relay-assistant/connectivity`. All other packages are reached through the consumer's wiring code.

---

## 6. Public API Surface (`src/index.ts`)

```ts
// Factory functions
export { createSpecialistRegistry } from './registry.js';
export { createDelegationPlan, validatePlan } from './delegation.js';
export { createSynthesizer } from './synthesis.js';
export { createCoordinator } from './coordinator.js';

// Error classes
export {
  CoordinationError,
  SpecialistNotFoundError,
  DelegationPlanError,
  SynthesisError,
} from './types.js';

// Types
export type {
  Specialist,
  SpecialistDefinition,
  SpecialistHandler,
  SpecialistContext,
  SpecialistResult,
  SpecialistRegistry,
  DelegationStep,
  DelegationPlan,
  DelegationPlanValidation,
  SynthesisStrategy,
  SynthesisConfig,
  SynthesisOutput,
  Synthesizer,
  CoordinatorConfig,
  CoordinationTurn,
  Coordinator,
} from './types.js';
```

---

## 7. Minimum Tests

### 7.1 `registry.test.ts` — Specialist Registry (8 tests)

| # | Test | Asserts |
|---|---|---|
| 1 | Register a specialist and retrieve by name | `get(name)` returns the specialist |
| 2 | Register populates list | `list()` includes the specialist |
| 3 | Duplicate name throws CoordinationError | Second `register()` with same name throws |
| 4 | Unregister removes specialist | `get(name)` returns null after unregister |
| 5 | Unregister unknown name is no-op | Does not throw |
| 6 | `has()` returns true for registered, false for unregistered | Boolean correctness |
| 7 | Register validates non-empty name | Empty string throws |
| 8 | `list()` returns defensive copy | Mutating returned array does not affect registry |

### 7.2 `delegation.test.ts` — Delegation Plans (7 tests)

| # | Test | Asserts |
|---|---|---|
| 1 | `createDelegationPlan()` returns frozen plan | Object.isFrozen is true; steps and intent match input |
| 2 | `validatePlan()` passes for valid plan | All specialists exist, returns `{ valid: true, errors: [] }` |
| 3 | Unknown specialist fails validation | `errors` includes specialist name |
| 4 | Empty steps array fails validation | `valid` is false |
| 5 | Empty intent fails validation | `valid` is false |
| 6 | Empty instruction in step fails validation | `valid` is false |
| 7 | Multiple errors accumulated | Two bad steps produce two error messages |

### 7.3 `synthesis.test.ts` — Synthesis (8 tests)

| # | Test | Asserts |
|---|---|---|
| 1 | Concatenate strategy joins complete results | `text` contains both outputs, `quality: 'complete'` |
| 2 | Concatenate strategy excludes failed results | Failed output not in `text`, `contributingSpecialists` excludes it |
| 3 | Concatenate with all failed returns degraded | `quality: 'degraded'`, fallback message present |
| 4 | Last-wins returns final non-failed result | `text` matches last success, `contributingSpecialists` has one entry |
| 5 | Last-wins with all failed returns degraded | `quality: 'degraded'` |
| 6 | Custom strategy calls customFn | Provided function invoked with results and plan |
| 7 | Custom strategy without customFn throws SynthesisError | Error thrown on synthesize() |
| 8 | Partial results included in concatenate, quality is degraded | `text` includes partial output, `quality: 'degraded'` |

### 7.4 `coordinator.test.ts` — Coordinator Orchestration (12 tests)

| # | Test | Asserts |
|---|---|---|
| 1 | Execute valid single-step plan | Returns `CoordinationTurn` with one result, synthesized output |
| 2 | Execute multi-step plan passes prior results to later specialists | Second specialist's context.priorResults contains first result |
| 3 | Invalid plan throws DelegationPlanError | Unknown specialist in plan triggers validation error |
| 4 | Required step failure aborts remaining steps | Failed required step stops execution; synthesis receives partial results |
| 5 | Optional step failure skips and continues | Failed optional step appears in `skippedSteps`; next step executes |
| 6 | `advanceStep()` called after each successful step | Connectivity `advanceStep` invoked with threadId per step |
| 7 | `escalation.interrupt` signal aborts remaining steps | Coordinator stops after receiving interrupt; synthesizes available results |
| 8 | `handoff.partial` signal marks result as partial | Result status reflects partial when specialist emits handoff.partial |
| 9 | Connectivity `onSignal`/`offSignal` lifecycle | Coordinator subscribes before execution and unsubscribes after |
| 10 | Max steps limit enforced | Plan with more steps than `maxSteps` throws `DelegationPlanError` |
| 11 | Turn ID format | `turnId` matches `turn_<nanoid>` pattern |
| 12 | Coordinator registers selected audience resolver | `registerSelectedResolver` called on connectivity layer |

**Total: 35 tests minimum**

---

## 8. Package Configuration

### `package.json`

```json
{
  "name": "@relay-assistant/coordination",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@relay-assistant/connectivity": "workspace:*",
    "nanoid": "^5.1.6"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

### `tsconfig.json`

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
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

---

## 9. Implementation Order

Execute in this order to maintain testability at each step:

| Step | File(s) | Depends On | Gate |
|---|---|---|---|
| 1 | `package.json`, `tsconfig.json` | — | `npm install` succeeds |
| 2 | `src/types.ts` | — | `tsc --noEmit` passes |
| 3 | `src/registry.ts` + `src/registry.test.ts` | types | 8 tests pass |
| 4 | `src/delegation.ts` + `src/delegation.test.ts` | types, registry (for validatePlan) | 7 tests pass |
| 5 | `src/synthesis.ts` + `src/synthesis.test.ts` | types | 8 tests pass |
| 6 | `src/coordinator.ts` + `src/coordinator.test.ts` | types, registry, delegation, synthesis, connectivity | 12 tests pass |
| 7 | `src/index.ts` | all source files | `tsc --noEmit` passes, all 35 tests pass |

---

## 10. Definition of Done

1. All 12 files listed in §2 exist.
2. `tsc --noEmit` passes with strict mode and `exactOptionalPropertyTypes: true`.
3. All 35 minimum tests pass via `vitest run`.
4. `@relay-assistant/connectivity` is the **only** `@relay-assistant/*` package dependency.
5. No imports from `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces`, `@relay-assistant/memory`, `@relay-assistant/routing`, or `@relay-assistant/policy` exist anywhere in `packages/coordination/src/`.
6. The public API surface matches §6 exactly.
7. The `README.md` is updated to reflect the implemented API (replace placeholder content).

---

## 11. Integration Guidance (Post-Implementation)

After coordination is implemented, a follow-up integration plan should cover:

1. **WF-C (core + coordination)** — integration tests proving that a capability handler can create a coordinator, execute a plan, and emit the synthesized result via `context.runtime.emit()`.
2. **WF-CS (coordination + connectivity)** — integration tests proving the four connectivity workflow shapes (WF-C1 through WF-C4 from the connectivity review) work end-to-end through coordination delegation.
3. **Product adoption examples** — skeletal examples showing how NightCTO and MSD would register specialists and build delegation plans.

These integration tests are **not** part of v1 coordination package scope. They belong in a subsequent integration phase, analogous to `core-sessions.test.ts` and `core-sessions-surfaces.test.ts` for the foundation packages.

---

V1_COORDINATION_IMPLEMENTATION_PLAN_READY
