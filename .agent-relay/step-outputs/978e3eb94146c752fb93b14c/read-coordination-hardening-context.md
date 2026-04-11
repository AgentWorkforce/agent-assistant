---COORDINATION REVIEW VERDICT---
# v1 Coordination Review Verdict

**Date:** 2026-04-11
**Package:** `@relay-assistant/coordination`
**Verdict:** PASS_WITH_FOLLOWUPS

---

## Summary

The v1 coordination package implements the core contracts correctly and is properly bounded. The connectivity dependency is clean and injected through configuration. No forbidden packages are imported. The existing tests cover the most important end-to-end coordination behaviors.

Several follow-ups are required before memory/routing/product integration: test coverage falls well short of the 35-test minimum in the implementation plan, `registerSelectedResolver` is not called by the coordinator, one API name was changed from the spec, and the `turnId` prefix differs.

---

## Assessment

### 1. Is the coordination package properly bounded for v1?

**PASS with minor observations.**

The implemented scope matches the plan:

- Specialist registry with uniqueness enforcement and lookup ✓
- Delegation plan factory and validator ✓
- Sequential coordinator lifecycle (validate → delegate → observe signals → synthesize) ✓
- Three synthesis strategies (`concatenate`, `last-wins`, `custom`) ✓
- In-memory turn only; no persistence backend ✓

Non-ownership is correctly upheld. The package contains no imports from `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces`, `@relay-assistant/memory`, `@relay-assistant/routing`, or `@relay-assistant/policy`.

Minor structural divergence from the plan: the plan described six source files (`registry.ts`, `delegation.ts`, `synthesis.ts`, `coordinator.ts`, `types.ts`, `index.ts`). The implementation consolidates all factory functions into a single `coordination.ts` alongside `types.ts` and `index.ts`. This is a valid authoring choice that does not affect the public API surface or scope boundary.

One behavioral divergence: the plan specified that `createDelegationPlan()` should NOT validate against the registry (validation being the job of the separate `validatePlan()` function). The implementation's `createDelegationPlan()` calls `validateDelegationPlan()` internally and throws on failure. This is a reasonable simplification, but it means the function is not a pure factory — products cannot create a plan before the registry is populated. This should be documented as a deliberate choice or reverted to match the spec.

### 2. Does it depend on connectivity in a clean way?

**PASS.**

The package imports exactly three types from `@relay-assistant/connectivity`:

```ts
import type { ConnectivityLayer, ConnectivitySignal, SignalCallback }
  from '@relay-assistant/connectivity';
```

The `ConnectivityLayer` is injected into the coordinator via `CoordinatorConfig`, not constructed internally. Specialists receive the same instance through `SpecialistContext`. The coordinator uses the connectivity API only through the public interface (`onSignal`, `offSignal`, `query`, `resolve`, `advanceStep`). No connectivity internals are accessed.

The routing escalation hook is correctly left for the consumer to wire on the shared connectivity layer instance; the coordinator never calls routing.

**One gap:** The plan (§4.4) states the coordinator must call `registerSelectedResolver` so that `audience: 'selected'` signals can be routed to named specialists. The implementation does not call `registerSelectedResolver` at any point. As a result, `audience: 'selected'` signals emitted by specialists will resolve to an empty recipient list. This should be addressed before products emit `selected`-audience signals.

### 3. Does it avoid taking ownership of routing, memory, surfaces, and transport?

**PASS — clean boundary.**

- No routing imports; routing escalation is delegated to `RoutingEscalationHook` wired by the consumer on the connectivity layer.
- No memory imports; specialists may use memory inside their handlers, but coordination contracts are memory-agnostic.
- No surface imports; `SynthesisOutput.text` is plain text. Surface delivery is the consumer's responsibility.
- No transport imports; connectivity signals are in-memory within the layer.
- The `CoordinationTurn` correctly exposes `signals` as observable data for product-level resolution without the coordinator taking policy action.

The conflict handling is particularly well-bounded: the coordinator tracks `unresolvedConflicts` in the turn and degrades synthesis quality when conflicts remain, but never calls routing or takes policy decisions.

### 4. Do the tests cover the intended first coordination behaviors?

**PARTIAL PASS — coverage gap.**

The plan required a minimum of 35 tests across four test files. The implementation contains one consolidated test file (`coordination.test.ts`) with 5 tests. The tests that exist are high-value integration-style scenarios:

| Test | Coverage | Status |
|---|---|---|
| Registry duplicate rejection + plan validation | Registry uniqueness, plan validation with unknown specialist | ✓ |
| Sequential delegation with handoff signals | Two-specialist handoff, prior results threading, signal cleanup | ✓ |
| Optional step failure / degraded output | Optional-step skip, `skippedSteps`, degraded quality | ✓ |
| Blocker signal halts coordination | `confidence.blocker` → `CoordinationBlockedError` | ✓ |
| Conflict tracking without routing ownership | `conflict.active` / `conflict.resolved` signal lifecycle | ✓ |

Missing from the plan's test matrix:

- Registry: `list()` defensive copy, `has()` boolean correctness, empty-name validation, `unregister` no-op
- Delegation plan: `createDelegationPlan()` returns copy (not frozen in implementation), empty steps/intent/instruction validation, multiple-error accumulation
- Synthesis: unit tests for all three strategies, degraded-all-failed behavior, `SynthesisError` for missing `customFn`, partial results degrading quality
- Coordinator: `advanceStep` called per step, `onSignal`/`offSignal` lifecycle, max steps enforcement via `maxSteps`, `turnId` format, `registerSelectedResolver` call

These missing tests reduce confidence in edge cases that the integration tests do not exercise (e.g., synthesis strategy edge cases, empty registry, oversized plans, signal lifecycle correctness).

### 5. What follow-ups remain before memory/routing/product integration?

**Required (blocking):**

1. **Test coverage** — Expand `coordination.test.ts` (or add the four separate test files from the plan) to reach the 35-test minimum. At minimum, add unit coverage for registry edge cases, delegation plan validation accumulation, synthesis strategy edge cases, and coordinator signal lifecycle assertions. This is the most important gap.

2. **`registerSelectedResolver` not wired** — The coordinator must call `config.connectivity.registerSelectedResolver(...)` during initialization so that `audience: 'selected'` signals resolve correctly. Without this, products that emit `selected`-audience signals during delegation will find no recipients.

3. **`createDelegationPlan` factory semantics** — Decide and document whether `createDelegationPlan` is a validating factory (current behavior) or a pure constructor (plan behavior). If products need to construct plans before filling the registry, the current behavior is a regression.

**Non-blocking (address before product adoption):**

4. **API name divergence** — The plan's §6 specifies `validatePlan` as the public export name. The implementation exports `validateDelegationPlan`. This is internally consistent but diverges from the specification. Update the spec or keep the implementation name and mark the discrepancy resolved.

5. **`turnId` prefix** — The plan specifies `turn_<nanoid>`. The implementation uses `coord_<nanoid>`. Align with the spec or update the spec.

6. **`declarationMap` and `sourceMap`** — The plan's tsconfig includes `"declarationMap": true` and `"sourceMap": true`. The actual `tsconfig.json` omits these. These improve developer experience for downstream consumers debugging into the package. Low urgency, but worth adding before publishing.

7. **Integration test phase (§11)** — WF-C (core + coordination) and WF-CS (coordination + connectivity) integration tests are explicitly deferred but should be planned as the next milestone before NightCTO or MSD adopt the package.

---

## File-Level Notes

| File | Verdict | Notes |
|---|---|---|
| `package.json` | PASS | Single `@relay-assistant/*` dep; `prebuild`/`pretest` scripts ensure connectivity is built first; `file:../connectivity` is correct for local monorepo |
| `tsconfig.json` | PASS (minor) | Missing `declarationMap`/`sourceMap` vs. plan; `forceConsistentCasingInFileNames` added beyond plan spec (good) |
| `src/types.ts` | PASS | Clean types-only file; only imports from connectivity are type imports; `CoordinationBlockedError` and `SpecialistConflictError` are useful additions beyond the plan |
| `src/coordination.ts` | PASS with gaps | Correct orchestration logic; signal cleanup in `finally` is solid; `registerSelectedResolver` omitted; `createDelegationPlan` validates eagerly |
| `src/index.ts` | PASS (minor) | Exports `validateDelegationPlan` (not `validatePlan`); all other exports match §6 of the plan; `CoordinationSignals` type correctly exported |
| `coordination.test.ts` | PARTIAL | 5 integration tests cover the key workflows but miss 30 of the 35 specified unit tests |
| `README.md` | PASS | Accurately describes scope, non-scope, connectivity boundary, and failure model; examples are correct |

---

## Verdict Rationale

The core implementation is correct and the scope is properly bounded. The connectivity integration is the cleanest aspect of the implementation — the boundary is well-drawn and the signal lifecycle (subscribe before loop, unsubscribe in `finally`, resolve consumable signals post-synthesis, degrade quality on unresolved conflicts) is implemented correctly.

The reasons for PASS_WITH_FOLLOWUPS rather than PASS:

1. Test coverage (5/35) is too low to rely on for memory/routing/product integration. The plan's 35-test minimum was not met.
2. The missing `registerSelectedResolver` call means `audience: 'selected'` signals are silently dropped, which will cause hard-to-diagnose failures when product specialists use that audience mode.

Neither issue is an architectural problem — both are implementation gaps that can be closed with targeted additions to the existing files.

---

V1_COORDINATION_REVIEW_COMPLETE

---COORDINATION PLAN---
# v1 Coordination Implementation Plan

**Date:** 2026-04-11
**Package:** `@relay-assistant/coordination`
**Status:** IMPLEMENTATION_READY

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

Factory that builds a `DelegationPlan` from steps and intent, plus a standalone `validatePlan()` function.

**`validatePlan(plan, registry): DelegationPlanValidation`**
- Every step's `specialistName` must exist in the registry.
- `instruction` must be a non-empty string.
- `intent` must be a non-empty string.
- `steps` must contain at least one entry.
- Returns `{ valid: true, errors: [] }` or `{ valid: false, errors: [...] }`.

**`createDelegationPlan(input): DelegationPlan`**
- Accepts `{ steps, intent }` and returns a frozen `DelegationPlan` object.
- Does NOT validate against a registry (validation is a separate step before execution).

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

1. **Validate plan** — call `validatePlan(plan, config.registry)`. Throw `DelegationPlanError` if invalid.
2. **Generate turnId** — `turn_<nanoid>`.
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

The coordinator registers a `SelectedAudienceResolver` on the connectivity layer so that signals with `audience: 'coordinator'` are routed to it. The coordinator also registers itself as the `'coordinator'` source when emitting signals (e.g., to acknowledge handoffs).

Signal reactions:
- `escalation.interrupt` → abort remaining steps, synthesize what is available

---COORDINATION TYPES---
import type {
  ConnectivityLayer,
  ConnectivitySignal,
} from '@relay-assistant/connectivity';

export type SpecialistExecutionStatus = 'complete' | 'partial' | 'failed';
export type SynthesisStrategy = 'concatenate' | 'last-wins' | 'custom';
export type SynthesisQuality = 'complete' | 'degraded';

export interface SpecialistDefinition {
  name: string;
  description: string;
  capabilities: string[];
}

export interface SpecialistResult {
  specialistName: string;
  output: string;
  confidence?: number;
  status: SpecialistExecutionStatus;
  metadata?: Record<string, unknown>;
}

export interface SpecialistContext {
  turnId: string;
  threadId: string;
  stepIndex: number;
  plan: DelegationPlan;
  priorResults: SpecialistResult[];
  connectivity: ConnectivityLayer;
}

export interface SpecialistHandler {
  execute(instruction: string, context: SpecialistContext): Promise<SpecialistResult>;
}

export interface Specialist extends SpecialistDefinition {
  handler: SpecialistHandler;
}

export interface SpecialistRegistry {
  register(specialist: Specialist): void;
  unregister(name: string): void;
  get(name: string): Specialist | null;
  list(): Specialist[];
  has(name: string): boolean;
}

export interface DelegationStep {
  specialistName: string;
  instruction: string;
  optional?: boolean;
}

export interface DelegationPlan {
  intent: string;
  steps: DelegationStep[];
}

export interface DelegationPlanValidation {
  valid: boolean;
  errors: string[];
}

export interface SynthesisOutput {
  text: string;
  contributingSpecialists: string[];
  quality: SynthesisQuality;
}

export interface SynthesisConfig {
  strategy: SynthesisStrategy;
  customFn?: (results: SpecialistResult[], plan: DelegationPlan) => SynthesisOutput;
}

export interface Synthesizer {
  synthesize(results: SpecialistResult[], plan: DelegationPlan): SynthesisOutput;
}

export interface CoordinationSignals {
  observed: ConnectivitySignal[];
  handoffs: ConnectivitySignal[];
  escalations: ConnectivitySignal[];
  unresolvedConflicts: ConnectivitySignal[];
}

export interface CoordinationTurn {
  turnId: string;
  threadId: string;
  plan: DelegationPlan;
  results: SpecialistResult[];
  output: SynthesisOutput;
  skippedSteps: DelegationStep[];
  signals: CoordinationSignals;
}

export interface CoordinatorConfig {
  registry: SpecialistRegistry;
  connectivity: ConnectivityLayer;
  synthesis: SynthesisConfig;
  maxSteps?: number;
}

export interface Coordinator {
  execute(plan: DelegationPlan): Promise<CoordinationTurn>;
}

export class CoordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinationError';
  }
}

export class SpecialistConflictError extends CoordinationError {
  constructor(name: string) {
    super(`Specialist already registered: ${name}`);
    this.name = 'SpecialistConflictError';
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

export class CoordinationBlockedError extends CoordinationError {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinationBlockedError';
  }
}

---COORDINATION IMPLEMENTATION---
import { nanoid } from 'nanoid';

import type { ConnectivitySignal, SignalCallback } from '@relay-assistant/connectivity';

import {
  CoordinationBlockedError,
  CoordinationError,
  DelegationPlanError,
  SpecialistConflictError,
  SpecialistNotFoundError,
  SynthesisError,
} from './types.js';
import type {
  CoordinationSignals,
  CoordinationTurn,
  Coordinator,
  CoordinatorConfig,
  DelegationPlan,
  DelegationPlanValidation,
  Specialist,
  SpecialistRegistry,
  SpecialistResult,
  Synthesizer,
  SynthesisConfig,
  SynthesisOutput,
} from './types.js';

const DEFAULT_MAX_STEPS = 10;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return error.message;
  }

  return 'Unknown specialist execution failure';
}

function clonePlan(plan: DelegationPlan): DelegationPlan {
  return {
    intent: plan.intent,
    steps: plan.steps.map((step) => ({ ...step })),
  };
}

function cloneResult(result: SpecialistResult): SpecialistResult {
  return {
    specialistName: result.specialistName,
    output: result.output,
    status: result.status,
    ...(result.confidence === undefined ? {} : { confidence: result.confidence }),
    ...(result.metadata === undefined ? {} : { metadata: { ...result.metadata } }),
  };
}

function ensureConfidence(confidence: number | undefined): number | undefined {
  if (confidence === undefined) {
    return undefined;
  }

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new CoordinationError('Specialist result confidence must be between 0.0 and 1.0');
  }

  return confidence;
}

function normalizeSpecialistResult(
  specialistName: string,
  result: SpecialistResult,
): SpecialistResult {
  if (!isNonEmptyString(result.output) && result.status !== 'failed') {
    throw new CoordinationError(
      `Specialist ${specialistName} returned an empty output for a non-failed result`,
    );
  }

  const confidence = ensureConfidence(result.confidence);

  return {
    specialistName,
    output: result.output,
    status: result.status,
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function collectSignals(
  observedSignals: ConnectivitySignal[],
  threadId: string,
): CoordinationSignals {
  const relevant = observedSignals.filter((signal) => signal.threadId === threadId);
  const handoffs = relevant.filter((signal) => signal.messageClass === 'handoff');
  const escalations = relevant.filter((signal) => signal.messageClass === 'escalation');
  const unresolvedConflicts = relevant.filter(
    (signal) => signal.signalClass === 'conflict.active' && signal.state !== 'superseded',
  );

  return {
    observed: relevant,
    handoffs,
    escalations,
    unresolvedConflicts,
  };
}

function resolveSignals(
  coordinatorConfig: CoordinatorConfig,
  signals: ConnectivitySignal[],
): void {
  for (const signal of signals) {
    if (signal.state === 'resolved' || signal.state === 'superseded' || signal.state === 'expired') {
      continue;
    }

    if (signal.signalClass === 'conflict.active') {
      continue;
    }

    coordinatorConfig.connectivity.resolve(signal.id);
  }
}

export function createSpecialistRegistry(): SpecialistRegistry {
  const specialists = new Map<string, Specialist>();

  return {
    register(specialist) {
      if (!isNonEmptyString(specialist.name)) {
        throw new CoordinationError('Specialist name must be a non-empty string');
      }

      if (specialists.has(specialist.name)) {
        throw new SpecialistConflictError(specialist.name);
      }

      specialists.set(specialist.name, specialist);
    },

    unregister(name) {
      specialists.delete(name);
    },

    get(name) {
      return specialists.get(name) ?? null;
    },

    list() {
      return [...specialists.values()];
    },

    has(name) {
      return specialists.has(name);
    },
  };
}

export function validateDelegationPlan(
  plan: DelegationPlan,
  registry: SpecialistRegistry,
  maxSteps = DEFAULT_MAX_STEPS,
): DelegationPlanValidation {
  const errors: string[] = [];

  if (!isNonEmptyString(plan.intent)) {
    errors.push('plan.intent must be a non-empty string');
  }

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('plan.steps must contain at least one step');
  }

  if (plan.steps.length > maxSteps) {
    errors.push(`plan.steps exceeds maxSteps (${maxSteps})`);
  }

  for (const [index, step] of plan.steps.entries()) {
    if (!isNonEmptyString(step.specialistName)) {
      errors.push(`plan.steps[${index}].specialistName must be a non-empty string`);
      continue;
    }

    if (!registry.has(step.specialistName)) {
      errors.push(`plan.steps[${index}] references unknown specialist ${step.specialistName}`);
    }

    if (!isNonEmptyString(step.instruction)) {
      errors.push(`plan.steps[${index}].instruction must be a non-empty string`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function createDelegationPlan(
  plan: DelegationPlan,
  registry: SpecialistRegistry,
  maxSteps = DEFAULT_MAX_STEPS,
): DelegationPlan {
  const validation = validateDelegationPlan(plan, registry, maxSteps);

  if (!validation.valid) {
    throw new DelegationPlanError(validation.errors.join('; '));
  }

  return clonePlan(plan);
}

export function createSynthesizer(config: SynthesisConfig): Synthesizer {
  return {
    synthesize(results, plan) {
      const usableResults = results.filter((result) => result.status !== 'failed');

      if (config.strategy === 'custom') {
        if (!config.customFn) {
          throw new SynthesisError('customFn is required when strategy is custom');
        }

        return config.customFn(usableResults.map(cloneResult), clonePlan(plan));
      }

      if (usableResults.length === 0) {
        return {
          text: '',
          contributingSpecialists: [],
          quality: 'degraded',
        };
      }

      const contributingSpecialists = usableResults.map((result) => result.specialistName);
      const quality =
        usableResults.length === plan.steps.length &&
        usableResults.every((result) => result.status === 'complete')
          ? 'complete'
          : 'degraded';

      if (config.strategy === 'last-wins') {
        const lastResult = usableResults[usableResults.length - 1];
        if (!lastResult) {
          throw new SynthesisError('last-wins synthesis requires at least one result');
        }

        return {
          text: lastResult.output,
          contributingSpecialists,
          quality,
        };
      }

      return {
        text: usableResults.map((result) => result.output).join('\n\n'),
        contributingSpecialists,
        quality,
      };
    },
  };
}

export function createCoordinator(config: CoordinatorConfig): Coordinator {
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;

  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new CoordinationError('maxSteps must be a positive integer');
  }

  const synthesizer = createSynthesizer(config.synthesis);

  return {
    async execute(plan): Promise<CoordinationTurn> {
      const normalizedPlan = createDelegationPlan(plan, config.registry, maxSteps);
      const turnId = `coord_${nanoid()}`;
      const threadId = turnId;
      const results: SpecialistResult[] = [];
      const skippedSteps: DelegationPlan['steps'] = [];
      const observedSignals: ConnectivitySignal[] = [];

      const callback: SignalCallback = (signal) => {
        if (signal.threadId === threadId) {
          observedSignals.push(signal);
        }
      };

      config.connectivity.onSignal(callback);

      try {
        for (const [stepIndex, step] of normalizedPlan.steps.entries()) {
          const specialist = config.registry.get(step.specialistName);
          if (!specialist) {
            throw new SpecialistNotFoundError(step.specialistName);
          }

          try {
            const rawResult = await specialist.handler.execute(step.instruction, {
              turnId,
              threadId,
              stepIndex,
              plan: normalizedPlan,
              priorResults: results.map(cloneResult),
              connectivity: config.connectivity,
            });
            const result = normalizeSpecialistResult(specialist.name, rawResult);
            results.push(result);
          } catch (error) {
            const failure: SpecialistResult = {
              specialistName: specialist.name,
              output: normalizeErrorMessage(error),
              status: 'failed',
            };
            results.push(failure);

            if (step.optional) {
              skippedSteps.push({ ...step });
            } else {
              throw new CoordinationError(
                `Specialist ${specialist.name} failed: ${failure.output}`,
              );
            }
          }

          const activeSignals = config.connectivity.query({
            threadId,
            source: specialist.name,
            state: ['emitted', 'active'],
          });

          const blocker = activeSignals.find((signal) => signal.signalClass === 'confidence.blocker');
          if (blocker) {
            resolveSignals(config, [blocker]);
            if (step.optional) {
              skippedSteps.push({ ...step });
              config.connectivity.advanceStep(threadId);
              continue;
            }

            throw new CoordinationBlockedError(
              `Specialist ${specialist.name} reported a blocker: ${blocker.summary}`,
            );
          }

          const interrupt = activeSignals.find(
            (signal) => signal.signalClass === 'escalation.interrupt',
          );
          if (interrupt) {
            resolveSignals(config, [interrupt]);
            throw new CoordinationBlockedError(
              `Coordination interrupted by ${specialist.name}: ${interrupt.summary}`,
            );
          }

          config.connectivity.advanceStep(threadId);
        }

        const output = synthesizer.synthesize(results, normalizedPlan);
        const allSignals = config.connectivity.query({
          threadId,
          state: ['emitted', 'active', 'resolved', 'superseded'],
          order: 'oldest',
          limit: 500,
        });

        resolveSignals(config, allSignals);

        const signals = collectSignals(
          config.connectivity.query({
            threadId,
            state: ['emitted', 'active', 'resolved', 'superseded', 'expired'],
            order: 'oldest',
            limit: 500,
          }),
          threadId,
        );

        const effectiveOutput: SynthesisOutput =
          signals.unresolvedConflicts.length > 0 && output.quality === 'complete'
            ? { ...output, quality: 'degraded' }
            : output;

        return {
          turnId,
          threadId,
          plan: normalizedPlan,
          results,
          output: effectiveOutput,
          skippedSteps,
          signals,
        };
      } finally {
        config.connectivity.offSignal(callback);
      }
    },
  };
}

---COORDINATION TESTS---
import { describe, expect, it } from 'vitest';

import { createConnectivityLayer } from '@relay-assistant/connectivity';

import {
  CoordinationBlockedError,
  CoordinationError,
  createCoordinator,
  createDelegationPlan,
  createSpecialistRegistry,
  validateDelegationPlan,
} from './index.js';
import type { DelegationPlan, SpecialistResult } from './types.js';

describe('specialist registry and plan validation', () => {
  it('registers specialists, rejects duplicates, and validates known specialists', () => {
    const registry = createSpecialistRegistry();
    registry.register({
      name: 'researcher',
      description: 'Collects evidence',
      capabilities: ['research'],
      handler: {
        async execute(): Promise<SpecialistResult> {
          return {
            specialistName: 'researcher',
            output: 'facts',
            status: 'complete',
          };
        },
      },
    });

    expect(registry.has('researcher')).toBe(true);
    expect(registry.list()).toHaveLength(1);
    expect(() =>
      registry.register({
        name: 'researcher',
        description: 'duplicate',
        capabilities: [],
        handler: {
          async execute() {
            return {
              specialistName: 'researcher',
              output: 'duplicate',
              status: 'complete',
            };
          },
        },
      }),
    ).toThrowError(CoordinationError);

    const validation = validateDelegationPlan(
      {
        intent: 'answer safely',
        steps: [
          { specialistName: 'researcher', instruction: 'find facts' },
          { specialistName: 'missing', instruction: 'write answer' },
        ],
      },
      registry,
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'plan.steps[1] references unknown specialist missing',
    );
    expect(() =>
      createDelegationPlan(
        {
          intent: 'answer safely',
          steps: [{ specialistName: 'missing', instruction: 'write answer' }],
        },
        registry,
      ),
    ).toThrowError();
  });
});

describe('coordinator execution', () => {
  it('executes sequential delegation and resolves handoff signals after synthesis', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();

    registry.register({
      name: 'researcher',
      description: 'Collects evidence',
      capabilities: ['research'],
      handler: {
        async execute(_instruction, context) {
          context.connectivity.emit({
            threadId: context.threadId,
            source: 'researcher',
            audience: 'selected',
            messageClass: 'handoff',
            signalClass: 'handoff.ready',
            priority: 'normal',
            summary: 'Evidence package ready for writing',
          });

          return {
            specialistName: 'researcher',
            output: 'Key evidence: the answer needs three concrete facts.',
            status: 'complete',
            confidence: 0.91,
          };
        },
      },
    });

    registry.register({
      name: 'writer',
      description: 'Writes the final answer',
      capabilities: ['write'],
      handler: {
        async execute(_instruction, context) {
          expect(context.priorResults).toHaveLength(1);
          expect(context.priorResults[0]?.specialistName).toBe('researcher');

          context.connectivity.emit({
            threadId: context.threadId,
            source: 'writer',
            audience: 'coordinator',
            messageClass: 'confidence',
            signalClass: 'confidence.high',
            priority: 'normal',
            confidence: 0.93,
            summary: 'Final draft is ready',
          });

          return {
            specialistName: 'writer',
            output: `Final answer based on: ${context.priorResults[0]?.output}`,
            status: 'complete',
          };
        },
      },
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'last-wins' },
    });

    const turn = await coordinator.execute({
      intent: 'produce one coherent answer',
      steps: [
        { specialistName: 'researcher', instruction: 'gather evidence' },
        { specialistName: 'writer', instruction: 'write the answer' },
      ],
    });

    expect(turn.results).toHaveLength(2);
    expect(turn.output.text).toContain('Final answer based on:');
    expect(turn.output.quality).toBe('complete');
    expect(turn.signals.handoffs).toHaveLength(1);
    expect(
      connectivity.query({
        threadId: turn.threadId,
        state: ['emitted', 'active'],
      }),
    ).toEqual([]);
  });

  it('skips optional failures and returns a degraded synthesized answer', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();

    registry.register({
      name: 'reviewer',
      description: 'Optional review step',
      capabilities: ['review'],
      handler: {
        async execute() {
          throw new Error('Reviewer unavailable');
        },
      },
    });

    registry.register({
      name: 'writer',
      description: 'Writes the answer',
      capabilities: ['write'],
      handler: {
        async execute() {
          return {
            specialistName: 'writer',
            output: 'Fallback final answer',
            status: 'complete',
          };
        },
      },
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
    });

    const turn = await coordinator.execute({
      intent: 'answer even if review is unavailable',
      steps: [
        { specialistName: 'reviewer', instruction: 'review draft', optional: true },
        { specialistName: 'writer', instruction: 'write final answer' },
      ],
    });

    expect(turn.results).toHaveLength(2);
    expect(turn.skippedSteps).toHaveLength(1);
    expect(turn.skippedSteps[0]?.specialistName).toBe('reviewer');
    expect(turn.output.text).toBe('Fallback final answer');
    expect(turn.output.quality).toBe('degraded');
  });

  it('halts when a specialist emits a blocker signal', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();

    registry.register({
      name: 'reviewer',
      description: 'Raises blockers',
      capabilities: ['review'],
      handler: {
        async execute(_instruction, context) {
          context.connectivity.emit({
            threadId: context.threadId,
            source: 'reviewer',
            audience: 'coordinator',
            messageClass: 'confidence',
            signalClass: 'confidence.blocker',
            priority: 'high',
            confidence: 0,
            summary: 'Missing required evidence',
          });

          return {
            specialistName: 'reviewer',
            output: 'Cannot continue',
            status: 'failed',
          };
        },
      },
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'last-wins' },
    });

    await expect(
      coordinator.execute({
        intent: 'validate critical evidence',
        steps: [{ specialistName: 'reviewer', instruction: 'review evidence' }],
      }),
    ).rejects.toThrowError(CoordinationBlockedError);
  });

  it('tracks resolved conflicts without taking routing or transport ownership', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();
    let conflictId = '';

    registry.register({
      name: 'analyst',
      description: 'Finds disagreement',
      capabilities: ['analysis'],
      handler: {
        async execute(_instruction, context) {
          const signal = context.connectivity.emit({
            threadId: context.threadId,
            source: 'analyst',
            audience: 'coordinator',
            messageClass: 'conflict',
            signalClass: 'conflict.active',
            priority: 'high',
            confidence: 0.42,
            summary: 'Two sources disagree on the timeline',
          });
          conflictId = signal.id;

          return {
            specialistName: 'analyst',
            output: 'Conflict detected and isolated.',
            status: 'partial',
          };
        },
      },
    });

    registry.register({
      name: 'arbiter',
      description: 'Resolves disagreement',
      capabilities: ['analysis', 'arbitration'],
      handler: {
        async execute(_instruction, context) {
          context.connectivity.emit({
            threadId: context.threadId,
            source: 'arbiter',
            audience: 'coordinator',
            messageClass: 'conflict',
            signalClass: 'conflict.resolved',
            priority: 'normal',
            confidence: 0.88,
            summary: 'Timeline conflict resolved',
            replaces: conflictId,
          });

          return {
            specialistName: 'arbiter',
            output: 'Resolved answer: source B has the correct timeline.',
            status: 'complete',
          };
        },
      },
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'last-wins' },
    });

    const turn = await coordinator.execute({
      intent: 'resolve conflicting evidence into one answer',
      steps: [
        { specialistName: 'analyst', instruction: 'identify conflicts' },
        { specialistName: 'arbiter', instruction: 'resolve conflict' },
      ],
    });

    expect(turn.output.text).toContain('Resolved answer:');
    expect(turn.output.quality).toBe('degraded');
    expect(turn.signals.escalations).toHaveLength(0);
    expect(turn.signals.unresolvedConflicts).toHaveLength(0);
    expect(
      connectivity.query({
        threadId: turn.threadId,
        signalClass: 'conflict.active',
        state: ['superseded'],
      }),
    ).toHaveLength(1);
  });
});

---CONNECTIVITY TYPES---
export type SignalAudience = 'self' | 'coordinator' | 'selected' | 'all';

export type MessageClass =
  | 'attention'
  | 'confidence'
  | 'conflict'
  | 'handoff'
  | 'escalation';

export type SignalClass =
  | 'attention.raise'
  | 'confidence.high'
  | 'confidence.medium'
  | 'confidence.low'
  | 'confidence.blocker'
  | 'conflict.active'
  | 'conflict.resolved'
  | 'handoff.ready'
  | 'handoff.partial'
  | 'escalation.interrupt'
  | 'escalation.uncertainty';

export type SignalPriority = 'low' | 'normal' | 'high' | 'critical';
export type SignalState = 'emitted' | 'active' | 'superseded' | 'expired' | 'resolved';
export type SignalEvent = 'emitted' | 'superseded' | 'resolved' | 'expired';
export type RequestedRoutingMode = 'cheap' | 'fast' | 'deep';

export interface ConnectivitySignal {
  id: string;
  threadId: string;
  source: string;
  audience: SignalAudience;
  messageClass: MessageClass;
  signalClass: SignalClass;
  priority: SignalPriority;
  confidence?: number;
  summary: string;
  details?: string;
  replaces?: string;
  expiresAtStep?: number;
  emittedAt: string;
  state: SignalState;
}

export interface EmitSignalInput {
  threadId: string;
  source: string;
  audience: SignalAudience;
  messageClass: MessageClass;
  signalClass: SignalClass;
  priority: SignalPriority;
  summary: string;
  confidence?: number;
  details?: string;
  replaces?: string;
  expiresAtStep?: number;
}

export interface SignalQuery {
  threadId: string;
  source?: string;
  messageClass?: MessageClass | MessageClass[];
  signalClass?: SignalClass | SignalClass[];
  state?: SignalState | SignalState[];
  priority?: SignalPriority | SignalPriority[];
  since?: string;
  before?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
}

export interface SuppressionConfig {
  basis: 'step' | 'time';
  windowMs?: number;
}

export interface RoutingEscalationHook {
  onEscalation(signal: ConnectivitySignal): RequestedRoutingMode | void;
}

export type SelectedAudienceResolver = (signal: ConnectivitySignal) => string[];
export type SignalCallback = (signal: ConnectivitySignal, event: SignalEvent) => void;

export interface ConnectivityLayerConfig {
  suppressionConfig?: SuppressionConfig;
  routingEscalationHook?: RoutingEscalationHook;
}

export interface ConnectivityLayer {
  emit(input: EmitSignalInput): ConnectivitySignal;
  resolve(signalId: string): ConnectivitySignal;
  get(signalId: string): ConnectivitySignal | null;
  query(query: SignalQuery): ConnectivitySignal[];
  advanceStep(threadId: string): void;
  registerSelectedResolver(resolver: SelectedAudienceResolver): void;
  onSignal(callback: SignalCallback): void;
  offSignal(callback: SignalCallback): void;
}

export const SIGNAL_AUDIENCES = [
  'self',
  'coordinator',
  'selected',
  'all',
] as const satisfies readonly SignalAudience[];

export const MESSAGE_CLASSES = [
  'attention',
  'confidence',
  'conflict',
  'handoff',
  'escalation',
] as const satisfies readonly MessageClass[];

export const SIGNAL_CLASSES = [
  'attention.raise',
  'confidence.high',
  'confidence.medium',
  'confidence.low',
  'confidence.blocker',
  'conflict.active',
  'conflict.resolved',
  'handoff.ready',
  'handoff.partial',
  'escalation.interrupt',
  'escalation.uncertainty',
] as const satisfies readonly SignalClass[];

export const SIGNAL_PRIORITIES = [
  'low',
  'normal',
  'high',
  'critical',
] as const satisfies readonly SignalPriority[];

export const SIGNAL_STATES = [
  'emitted',
  'active',
  'superseded',
  'expired',
  'resolved',
] as const satisfies readonly SignalState[];

export const SIGNAL_EVENTS = [
  'emitted',
  'superseded',
  'resolved',
  'expired',
] as const satisfies readonly SignalEvent[];

export const MESSAGE_CLASS_TO_SIGNAL_PREFIX: Record<MessageClass, string> = {
  attention: 'attention.',
  confidence: 'confidence.',
  conflict: 'conflict.',
  handoff: 'handoff.',
  escalation: 'escalation.',
};

export const TERMINAL_STATES = [
  'superseded',
  'expired',
  'resolved',
] as const satisfies readonly SignalState[];

export class ConnectivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectivityError';
  }
}

export class SignalValidationError extends ConnectivityError {
  constructor(message: string) {
    super(message);
    this.name = 'SignalValidationError';
  }
}

export class SignalNotFoundError extends ConnectivityError {
  constructor(signalId: string) {
    super(`Signal not found: ${signalId}`);
    this.name = 'SignalNotFoundError';
  }
}

---CONNECTIVITY IMPLEMENTATION---
import { nanoid } from 'nanoid';

import {
  ConnectivityError,
  MESSAGE_CLASSES,
  MESSAGE_CLASS_TO_SIGNAL_PREFIX,
  SIGNAL_AUDIENCES,
  SIGNAL_CLASSES,
  SIGNAL_PRIORITIES,
  SIGNAL_STATES,
  SignalNotFoundError,
  SignalValidationError,
  TERMINAL_STATES,
} from './types.js';
import type {
  ConnectivityLayer,
  ConnectivityLayerConfig,
  ConnectivitySignal,
  EmitSignalInput,
  MessageClass,
  SelectedAudienceResolver,
  SignalCallback,
  SignalEvent,
  SignalPriority,
  SignalQuery,
  SignalState,
  SuppressionConfig,
} from './types.js';

const DEFAULT_LIMIT = 50;
const DEFAULT_SUPPRESSION_CONFIG: SuppressionConfig = {
  basis: 'step',
};

const CLASS_CONFIDENCE_RULES: Partial<Record<ConnectivitySignal['signalClass'], [number, number]>> = {
  'confidence.high': [0.8, 1.0],
  'confidence.medium': [0.4, 0.79],
  'confidence.low': [0.1, 0.39],
  'confidence.blocker': [0.0, 0.0],
  'conflict.active': [0.0, 1.0],
  'conflict.resolved': [0.0, 1.0],
};

function nowIso(): string {
  return new Date().toISOString();
}

function generateSignalId(): string {
  return `sig_${nanoid()}`;
}

function toArray<T>(value?: T | T[]): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}

function isTerminalState(state: SignalState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new SignalValidationError(`Invalid ${label}: ${value}`);
  }
}

function validateConfidenceForSignal(input: EmitSignalInput): void {
  const confidenceRequired =
    input.messageClass === 'confidence' || input.messageClass === 'conflict';

  if (confidenceRequired && input.confidence === undefined) {
    throw new SignalValidationError(
      `confidence is required for ${input.messageClass} signals`,
    );
  }

  if (input.confidence === undefined) {
    return;
  }

  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new SignalValidationError('confidence must be between 0.0 and 1.0');
  }

  const rule = CLASS_CONFIDENCE_RULES[input.signalClass];
  if (!rule) {
    return;
  }

  const [min, max] = rule;
  if (input.confidence < min || input.confidence > max) {
    throw new SignalValidationError(
      `confidence for ${input.signalClass} must be between ${min} and ${max}`,
    );
  }
}

function validateEmitInput(input: EmitSignalInput): void {
  if (!isNonEmptyString(input.threadId)) {
    throw new SignalValidationError('threadId must be a non-empty string');
  }

  if (!isNonEmptyString(input.source)) {
    throw new SignalValidationError('source must be a non-empty string');
  }

  if (!isNonEmptyString(input.summary)) {
    throw new SignalValidationError('summary must be a non-empty string');
  }

  assertEnum(input.audience, SIGNAL_AUDIENCES, 'audience');
  assertEnum(input.messageClass, MESSAGE_CLASSES, 'messageClass');
  assertEnum(input.signalClass, SIGNAL_CLASSES, 'signalClass');
  assertEnum(input.priority, SIGNAL_PRIORITIES, 'priority');

  const expectedPrefix = MESSAGE_CLASS_TO_SIGNAL_PREFIX[input.messageClass];
  if (!input.signalClass.startsWith(expectedPrefix)) {
    throw new SignalValidationError(
      `signalClass ${input.signalClass} does not match messageClass ${input.messageClass}`,
    );
  }

  if (
    input.expiresAtStep !== undefined &&
    (!Number.isInteger(input.expiresAtStep) || input.expiresAtStep < 0)
  ) {
    throw new SignalValidationError('expiresAtStep must be a non-negative integer');
  }

  validateConfidenceForSignal(input);
}

function getDuplicateKey(input: EmitSignalInput): string {
  return `${input.threadId}|${input.source}|${input.signalClass}|${input.audience}`;
}

function fireCallbacks(
  callbacks: Set<SignalCallback>,
  signal: ConnectivitySignal,
  event: SignalEvent,
): void {
  for (const callback of callbacks) {
    try {
      callback(signal, event);
    } catch (error) {
      console.error('Connectivity signal callback failed', error);
    }
  }
}

function resolveAudience(
  signal: ConnectivitySignal,
  threadSignals: ConnectivitySignal[],
  selectedResolver?: SelectedAudienceResolver,
): string[] {
  switch (signal.audience) {
    case 'self':
      return [signal.source];
    case 'coordinator':
      return ['coordinator'];
    case 'selected':
      return selectedResolver ? selectedResolver(signal) : [];
    case 'all': {
      const recipients = new Set<string>(['coordinator']);
      for (const candidate of threadSignals) {
        recipients.add(candidate.source);
      }
      return [...recipients];
    }
    default:
      return [];
  }
}

function shouldSuppress(
  input: EmitSignalInput,
  candidates: ConnectivitySignal[],
  suppressionConfig: SuppressionConfig,
  currentStep: number,
  emittedSteps: Map<string, number>,
): ConnectivitySignal | null {
  if (input.priority === 'critical') {
    return null;
  }

  const duplicateKey = getDuplicateKey(input);
  for (const existing of candidates) {
    if (isTerminalState(existing.state)) {
      continue;
    }

    if (getDuplicateKey(existing) !== duplicateKey) {
      continue;
    }

    if (
      input.priority === 'high' &&
      input.messageClass === 'escalation' &&
      existing.summary !== input.summary
    ) {
      continue;
    }

    if (suppressionConfig.basis === 'step') {
      const emittedStep = emittedSteps.get(existing.id);
      if (emittedStep === currentStep) {
        return existing;
      }
      continue;
    }

    const windowMs = suppressionConfig.windowMs ?? 5_000;
    if (Date.now() - Date.parse(existing.emittedAt) <= windowMs) {
      return existing;
    }
  }

  return null;
}

function ensureMutableSignal(signal: ConnectivitySignal): void {
  if (isTerminalState(signal.state)) {
    throw new ConnectivityError(
      `Signal ${signal.id} is already in terminal state ${signal.state}`,
    );
  }
}

function filterByEnum<T extends string>(value: T, filter?: T[]): boolean {
  if (!filter || filter.length === 0) {
    return true;
  }

  return filter.includes(value);
}

export function createConnectivityLayer(
  config: ConnectivityLayerConfig = {},
): ConnectivityLayer {
  const suppressionConfig = config.suppressionConfig ?? DEFAULT_SUPPRESSION_CONFIG;
  const signalsByThread = new Map<string, ConnectivitySignal[]>();
  const signalsById = new Map<string, ConnectivitySignal>();
  const stepsByThread = new Map<string, number>();
  const emittedSteps = new Map<string, number>();
  const callbacks = new Set<SignalCallback>();
  let selectedResolver: SelectedAudienceResolver | undefined;

  const getThreadSignals = (threadId: string): ConnectivitySignal[] => {
    return signalsByThread.get(threadId) ?? [];
  };

  const getSignal = (signalId: string): ConnectivitySignal => {
    const signal = signalsById.get(signalId);
    if (!signal) {
      throw new SignalNotFoundError(signalId);
    }
    return signal;
  };

  return {
    emit(input) {
      validateEmitInput(input);

      if (input.replaces) {
        const replaced = getSignal(input.replaces);
        if (replaced.threadId !== input.threadId) {
          throw new SignalValidationError(
            `replaces must reference a signal in thread ${input.threadId}`,
          );
        }
      }

      const currentStep = stepsByThread.get(input.threadId) ?? 0;
      const threadSignals = getThreadSignals(input.threadId);
      const suppressed = shouldSuppress(
        input,
        threadSignals,
        suppressionConfig,
        currentStep,
        emittedSteps,
      );
      if (suppressed) {
        return suppressed;
      }

      if (input.replaces) {
        const replaced = getSignal(input.replaces);
        ensureMutableSignal(replaced);
        replaced.state = 'superseded';
        fireCallbacks(callbacks, replaced, 'superseded');
      }

      const signal: ConnectivitySignal = {
        ...input,
        id: generateSignalId(),
        emittedAt: nowIso(),
        state: 'emitted',
      };

      const nextThreadSignals = [...threadSignals, signal];
      signalsByThread.set(input.threadId, nextThreadSignals);
      signalsById.set(signal.id, signal);
      emittedSteps.set(signal.id, currentStep);

      resolveAudience(signal, nextThreadSignals, selectedResolver);

      if (
        signal.signalClass === 'escalation.interrupt' ||
        signal.signalClass === 'escalation.uncertainty'

---COORDINATION README---
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
- observes per-turn signals such as `handoff.ready`, `confidence.blocker`, `conflict.active`, and `escalation.interrupt`
- resolves consumable signals after synthesis or coordinator action
- exposes the observed signal set on the returned coordination turn

What coordination does not do:

- choose routing modes
- import or call the routing package
- own transport delivery for signals
- persist signal history outside the in-memory layer supplied by the consumer

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

The test suite covers the intended first workflows:

- registry and delegation plan validation
- sequential specialist handoff
- optional-step degradation
- blocker interruption
- conflict detection and resolution

COORDINATION_PACKAGE_IMPLEMENTED
