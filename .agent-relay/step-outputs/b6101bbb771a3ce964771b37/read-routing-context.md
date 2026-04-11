---ROUTING SPEC---
# v1 Routing Spec — `@relay-assistant/routing`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/routing`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.2 (after core, sessions, surfaces, memory, connectivity land)

---

## 1. Responsibilities

`@relay-assistant/routing` manages model selection and routing-mode decisions across an assistant's coordination context. It is the layer that translates cost/latency/quality requirements into concrete model choices, without knowing about business logic or user-facing content.

This package is directly informed by Workforce routing patterns: cheap/fast/deep mode tiers, per-request cost envelopes, and quality-preserving routing with configurable thresholds.

**Owns:**
- `RoutingMode` — the three-tier model: `cheap`, `fast`, `deep`
- `ModelSelector` — given a routing context, returns a model specification
- `RoutingPolicy` — per-assistant and per-capability routing rules; configures when to use each mode
- `RoutingContext` — the signal envelope passed to the model selector for each invocation
- Cost envelope tracking — per-thread accounting of token/cost budget; trips mode escalation when exceeded
- Latency envelope — per-request latency target; routing selects models that can meet it
- Escalation receiver — implements `RoutingEscalationHook` from `@relay-assistant/connectivity`; applies requested mode changes

**Does NOT own:**
- The actual model API calls (→ product code or capability handlers; routing provides the model spec, not the invocation)
- Prompts, context assembly, or response formatting (→ product capability handlers)
- Coordination logic or specialist delegation (→ `@relay-assistant/coordination`)
- Connectivity signals (→ `@relay-assistant/connectivity`; routing receives escalation signals from connectivity, does not emit them)
- Session management (→ `@relay-assistant/sessions`)
- Surface delivery (→ `@relay-assistant/surfaces`)

---

## 2. Non-Goals

- Routing does not implement load balancing, failover, or retries across providers. Those are relay-foundation or product concerns.
- Routing does not make semantic content decisions. It does not read message text to decide routing; it reads structured context (capability name, cost envelope, escalation signals, constraints).
- Routing does not define model IDs. It defines `ModelSpec` — a structured description that product code resolves to a concrete model ID. This keeps routing OSS and provider-agnostic.
- Routing does not enforce policy; it recommends. The caller may override a routing decision if it has product-specific reasons.
- Routing is not a multi-step planner. It returns a single `RoutingDecision` per invocation context.
- Routing does not maintain session state or per-user history.

---

## 3. Routing Modes

Workforce-informed three-tier model:

| Mode | Intent | Typical characteristics |
|---|---|---|
| `cheap` | Minimize cost; quality bar is acceptable for routine tasks | Smaller model, limited context window, no tool use |
| `fast` | Minimize latency; quality bar is good for interactive responses | Mid-tier model, moderate context, standard tool use |
| `deep` | Maximize quality; cost and latency are secondary | Largest model, full context, full tool use, may include chain-of-thought |

Modes are advisory. The model selector maps modes to `ModelSpec`; products configure which concrete models correspond to each mode.

---

## 4. Interfaces and Contracts

### 4.1 `RoutingMode`

```typescript
export type RoutingMode = 'cheap' | 'fast' | 'deep';
```

### 4.2 `ModelSpec`

```typescript
/**
 * A routing recommendation, not a concrete model ID.
 * Product code resolves this to a provider-specific model ID.
 */
export interface ModelSpec {
  /** Routing mode this spec corresponds to. */
  mode: RoutingMode;

  /**
   * Capability tier requested. Products map tiers to model IDs in their
   * configuration. Standard tiers: 'small', 'medium', 'large', 'frontier'.
   */
  tier: ModelTier;

  /**
   * Whether tool use is required. When true, the resolved model must support
   * function calling / tool use.
   */
  requiresToolUse: boolean;

  /**
   * Whether streaming is required. When true, the resolved model must support
   * streaming responses.
   */
  requiresStreaming: boolean;

  /**
   * Minimum context window required, in tokens. 0 = no requirement.
   */
  minContextTokens: number;

  /**
   * Maximum acceptable latency to first token, in milliseconds.
   * 0 = no requirement.
   */
  maxLatencyMs: number;

  /**
   * Arbitrary routing hints for product-specific resolution. Routing populates
   * these from RoutingPolicy; product code may use them to select among
   * multiple models that otherwise match.
   */
  hints: Record<string, unknown>;
}

export type ModelTier = 'small' | 'medium' | 'large' | 'frontier' | string;
```

### 4.3 `RoutingContext`

```typescript
/**
 * Input to the routing decision. Built by the caller (capability handler or
 * coordinator) and passed to router.decide().
 */
export interface RoutingContext {
  /** Thread or session this invocation belongs to. */
  threadId: string;

  /**
   * The capability being invoked. Routing policy may have per-capability
   * mode overrides.
   */
  capability: string;

  /**
   * Current accumulated cost for this thread, in abstract units.
   * Routing uses this to determine if the cost envelope has been exceeded.
   */
  accumulatedCost?: number;

  /**
   * Desired maximum latency for this response, in milliseconds.
   * 0 = no requirement (routing uses its default).
   */
  requestedMaxLatencyMs?: number;

  /**
   * Whether this invocation requires tool use.
   */
  requiresToolUse?: boolean;

  /**
   * Whether this invocation requires streaming.
   */
  requiresStreaming?: boolean;

  /**
   * Minimum context window required.
   */
  minContextTokens?: number;

  /**
   * Escalation signals active in this thread, from the connectivity layer.
   * Routing reads escalation signals to potentially upgrade the mode.
   */
  activeEscalations?: EscalationSummary[];

  /**
   * Caller-requested mode override. When set, routing respects this unless
   * the RoutingPolicy has a hard constraint.
   */
  requestedMode?: RoutingMode;
}

export interface EscalationSummary {
  signalClass: string;
  priority: string;
  requestedMode?: string;
}
```

### 4.4 `RoutingDecision`

```typescript
export interface RoutingDecision {
  /** The recommended routing mode. */
  mode: RoutingMode;

  /** The model specification for this decision. */
  modelSpec: ModelSpec;

  /**
   * The reason for this decision. Used for logging and debugging.
   * Not shown to users.
   */
  reason: RoutingReason;

  /**
   * Whether the mode was escalated from the policy default due to signals
   * or cost envelope.
   */
  escalated: boolean;

  /**
   * Whether the caller's requestedMode was overridden by policy.
   */
  overridden: boolean;
}

export type RoutingReason =
  | 'policy_default'
  | 'capability_override'
  | 'escalation_signal'
  | 'cost_envelope_exceeded'
  | 'latency_constraint'
  | 'caller_requested'
  | 'hard_constraint';
```

### 4.5 `Router`

```typescript
export interface Router {
  /**
   * Make a routing decision for the given context.
   * Never throws; returns a decision even when falling back to defaults.
   */
  decide(context: RoutingContext): RoutingDecision;

  /**
   * Record the actual cost of a completed invocation. Used for cost
   * envelope tracking within a thread.
   */
  recordCost(threadId: string, cost: number): void;

  /**
   * Get the current accumulated cost for a thread.
   */
  getAccumulatedCost(threadId: string): number;

  /**
   * Reset cost tracking for a thread (e.g., at session end).
   */
  resetCost(threadId: string): void;

  /**
   * Implements RoutingEscalationHook from @relay-assistant/connectivity.
   * Called by the connectivity layer when an escalation signal is emitted.
   * Returns the requested routing mode based on the signal.
   */
  onEscalation(signal: ConnectivityEscalationSignal): RequestedRoutingMode | void;
}
```

### 4.6 `RoutingPolicy`

```typescript
/**
 * Per-assistant routing configuration. Provided to createRouter().
 */
export interface RoutingPolicy {
  /**
   * Default mode when no other factor applies.
   * Defaults to 'fast'.
   */
  defaultMode?: RoutingMode;

  /**
   * Per-capability mode overrides. Key is capability name; value is the
   * mode to use for that capability regardless of context.
   */
  capabilityModes?: Record<string, RoutingMode>;

  /**
   * Cost envelope. When accumulatedCost exceeds this, routing escalates
   * to 'cheap' mode regardless of other factors.
   * 0 = no limit.
   */
  costEnvelopeLimit?: number;

  /**
   * Hard mode constraints. When set, routing never uses a mode that is
   * "deeper" than this ceiling. Useful for cost-capped deployments.
   * - 'cheap': only cheap allowed
   * - 'fast': cheap or fast allowed
   * - 'deep': all modes allowed (default)
   */
  modeCeiling?: RoutingMode;

  /**
   * How to respond to escalation signals by signal class.
   * Key is signalClass (e.g., 'escalation.interrupt').
   * Value is the mode to request.
   */
  escalationModeMap?: Partial<Record<string, RoutingMode>>;

  /**
   * Per-mode model spec overrides. Products use this to configure which
   * model tier corresponds to each routing mode for this assistant.
   */
  modeModelSpecs?: Partial<Record<RoutingMode, Partial<ModelSpec>>>;
}
```

### 4.7 `ConnectivityEscalationSignal`

```typescript
/**
 * Minimal type for what connectivity passes to the escalation hook.
 * Mirrors ConnectivitySignal fields relevant to routing. This type is
 * defined in routing (not imported from connectivity) to avoid a circular
 * dependency — connectivity imports routing's RequestedRoutingMode type;
 * routing imports this interface instead of connectivity's full type.
 */
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

---

## 5. Routing Decision Algorithm

`router.decide(context)` applies rules in this priority order (highest to lowest):

1. **Hard constraint** — if `policy.modeCeiling` is set and the candidate mode exceeds it, cap to ceiling. Reason: `'hard_constraint'`.

2. **Caller override** — if `context.requestedMode` is set and does not violate modeCeiling, use it. Reason: `'caller_requested'`.

3. **Capability override** — if `policy.capabilityModes[context.capability]` is set, use it. Reason: `'capability_override'`.

4. **Cost envelope** — if `context.accumulatedCost` exceeds `policy.costEnvelopeLimit`, use `'cheap'`. Reason: `'cost_envelope_exceeded'`.

5. **Escalation signals** — if `context.activeEscalations` contains signals that map to a mode in `policy.escalationModeMap`, use the highest-priority mapped mode. Reason: `'escalation_signal'`. Mark `escalated: true`.

6. **Latency constraint** — if `context.requestedMaxLatencyMs` is set and `'deep'` cannot meet it (per modeModelSpecs), prefer `'fast'` or `'cheap'`. Reason: `'latency_constraint'`.

7. **Policy default** — use `policy.defaultMode`. Reason: `'policy_default'`.

After selecting a mode, construct `ModelSpec` by merging:
- Base spec for the mode from `policy.modeModelSpecs[mode]`
- Requirements from context: `requiresToolUse`, `requiresStreaming`, `minContextTokens`, `maxLatencyMs`

---

## 6. `createRouter` Factory

```typescript
export function createRouter(config: RouterConfig): Router;

export interface RouterConfig {

---WORKFORCE COMPARISON---
# Internal System Comparison

Date: 2026-04-11

## Purpose

Compare current internal systems to identify the assistant-runtime capabilities that should become shared SDK packages.

## Summary Table

| System | Strongest signal | What should inform this repo | What should stay product- or infra-specific |
| --- | --- | --- | --- |
| Relay foundation | transport and action substrate | normalized message, delivery, session substrate integration points | provider adapters, auth, webhook verification, raw action dispatch |
| Sage | memory and proactive continuity | memory contracts, follow-up engine concepts, stale-session patterns | workspace-specific prompt behavior, product heuristics |
| MSD | session and multi-surface convergence | assistant session model, surface attachment rules, runtime composition | review workflows, review tools, PR-specific logic |
| NightCTO | many-agents-one-assistant orchestration | coordination contracts, policy hooks, per-client continuity patterns | founder-facing product behavior, specialist lineup, service policy |
| Workforce | routing, persona tiers, and budget envelopes | assistant-facing routing contracts, latency/depth/cost policy, quality-preserving tier selection | product-agnostic persona library details that remain workforce-owned |

## Relay Foundation

Relay already appears to own the substrate this repo should build on:

- transport adapters
- inbound normalization
- outbound delivery
- auth and connection wiring
- scheduler substrate
- low-level action dispatch

Implication:

- this repo should compose with Relay
- this repo should not recreate transport infrastructure

## Sage

Sage contributes the strongest memory and proactive signals:

- persistent conversation or workspace continuity
- memory load and save behavior
- follow-up and stale-thread thinking
- context-aware reminders

Implication:

- memory and proactive packages are justified
- those packages should capture general contracts, not Sage’s exact product behavior

## MSD

MSD contributes the strongest session and surface signals:

- one assistant experience across multiple surfaces
- shared session semantics
- orchestrator or runtime assignment concepts
- strong need for policy around external review actions

Implication:

- `sessions` and `surfaces` should be first-class packages
- `core` and `policy` should support multi-surface runtime composition without being review-specific

## NightCTO

NightCTO contributes the strongest coordination signals:

- multiple internal specialists behind one assistant face
- per-client continuity and persistence
- proactive monitoring behavior
- need for governance and auditability

Implication:

- `coordination`, `policy`, `memory`, and `proactive` are all justified
- the many-agents-one-assistant model is not hypothetical; it already has a clear internal use case

## Cross-System Synthesis

Across the internal systems, the same assistant concerns keep recurring:

- continuity over time
- continuity across surfaces
- proactive behavior
- coordinated specialists
- focused internal connectivity
- policy around external actions

This is enough evidence to justify a dedicated assistant SDK layer.

## Overlap And Tension Analysis

### Sage vs NightCTO on memory

Sage's memory signals emphasize conversation continuity, workspace context retention, and proactive follow-up evidence. NightCTO's memory signals emphasize per-client continuity, specialist context, and durable service relationships.

Shared implication:
- a future `MemoryStore` interface must support more than one scope shape
- the memory layer cannot assume that every durable object is just a chat thread
- the likely shared scopes are user, session, workspace, org, and object/client

### MSD vs Sage on sessions and surfaces

MSD's strongest contribution is shared session convergence across multiple surfaces. Sage currently shows more product-specific memory and proactive behavior, but its runtime still implies the need for consistent session continuity when the assistant appears in multiple places.

Shared implication:
- the session layer should treat surfaces as attachments to one assistant session rather than as the primary continuity object
- that abstraction is likely reusable across both product styles

### NightCTO vs MSD on coordination

NightCTO makes the specialist pattern explicit through registry, dispatch, triage, and proactive flows. MSD's architecture implies orchestrator/notifier/reviewer roles and multi-surface runtime composition.

Shared implication:
- coordination should be separated from domain-specific specialist lineups
- both products need many-agents-one-assistant semantics even though their domains differ

### Why connectivity deserves its own package

The internal systems do not merely need transport; they need efficient communication between sophisticated subsystems.

This communication is not generic chatter. It needs to be:
- low-latency
- selective
- high-signal
- oriented toward convergence
- able to carry attention, uncertainty, escalation, and synthesis cues

That is why a distinct `@relay-assistant/connectivity` package is justified above Relay transport and alongside coordination.

## Boundary Conclusion

The right separation is:

- Relay foundation for transport and substrate
- `relay-agent-assistant` for shared assistant runtime contracts
- product repos for domain behavior

That separation is consistent with all three product directions and does not require cloud-specific assumptions.

## Workforce

Workforce contributes the strongest routing and token-budgeting signals:

- intent to persona selection
- tiered runtimes (`minimum`, `best-value`, `best`)
- explicit depth/latency/cost envelopes
- routing profiles that preserve quality while changing operating envelope

Implication:

- `routing` should be a first-class assistant-sdk package
- the assistant SDK should align with workforce workload-router concepts instead of inventing a divergent model-choice layer
- latency and cost policy should be explicit runtime concerns rather than ad hoc product logic

---PACKAGE BOUNDARY MAP---
# Package Boundary Map

Date: 2026-04-11

## Purpose

This document defines what belongs in:

- Relay foundation repos
- `relay-agent-assistant` OSS SDK packages
- product repositories such as Sage, MSD, and NightCTO

The goal is to prevent duplicate assistant-runtime work while avoiding leakage of transport infrastructure or product-specific behavior into the wrong layer.

## Boundary Rule

Use this rule first:

- if the capability is transport, auth, scheduling substrate, or low-level action dispatch, keep it in Relay foundation
- if the capability assumes an assistant identity, memory model, session continuity model, specialist orchestration model, or focused inter-agent connectivity model, move it here
- if the capability only makes sense for one product's domain, keep it in that product repo

## Layer Ownership

### Relay foundation

Relay family repos should continue to own:

- inbound webhook verification and provider-specific parsing
- normalized message and outbound delivery primitives
- channel and transport session substrate
- auth and connection wiring
- low-level action dispatch
- scheduler and wake-up substrate
- relaycast or other communication infrastructure
- transport-level observability

Examples that stay out of this repo:

- Slack signature verification
- WhatsApp payload parsing
- generic cron registration
- raw `spawn_agent` or message-delivery plumbing

### Relay Agent Assistant SDK

This repo should own reusable assistant-runtime behavior:

- assistant definition and capability registration
- memory scopes, retrieval, persistence contracts, promotion, compaction
- proactive engines, watch rules, reminders, scheduler bindings
- assistant session continuity across surfaces
- assistant-facing surface abstractions above normalized transport events
- coordinator and specialist orchestration
- focused inter-agent connectivity, signaling, and convergence contracts
- assistant-level routing, latency, depth, and budget-aware policy hooks
- policy, approvals, audit hooks, and action risk classification

Examples that should land here:

- a shared `AssistantSession` model
- a reusable `MemoryStore` contract
- a generic `ProactiveEngine`
- a coordinator that can delegate to specialists and synthesize one assistant response

### Product repositories

Product repos should continue to own:

- prompts and persona behavior beyond baseline assistant identity fields
- product-specific tools and workflows
- domain-specific watcher rules
- product UX and surface conventions
- business policy, escalation, and commercial rules
- product-specific specialist definitions

Examples:

- MSD review heuristics and PR-specific workflows
- Sage knowledge-capture behavior and workspace semantics
- NightCTO founder communication patterns and service-tier policy

## Package Responsibilities

### `@relay-assistant/core`

Owns:

- `createAssistant()` and assistant definition types
- runtime lifecycle and capability registration
- assistant identity fields shared across packages
- lightweight composition entrypoints and shared cross-package types

Composition note:
- `core` should not become a heavy package that hard-depends on every other package by default
- prefer interface-first composition and optional package wiring so consumers can adopt only the packages they need
- if `core` exposes convenience assembly helpers, they should live alongside modular entrypoints rather than replacing them

Must not own:

- provider-specific transport code
- memory backend implementation details
- product workflows

### `@relay-assistant/memory`

Owns:

- memory scopes such as user, session, workspace, org, and object
- retrieval, write, compaction, and promotion contracts
- memory adapter interfaces for future backends

Must not own:

- one product's tag taxonomy
- one surface's thread model as the only memory key shape

### `@relay-assistant/proactive`

Owns:

- follow-up engines
- watcher definitions
- reminder policies
- scheduler bindings over Relay substrate
- evidence contracts for stale-session or follow-up decisions

Must not own:

- product-only trigger logic
- surface-specific evidence collection that cannot generalize

### `@relay-assistant/sessions`

Owns:

- assistant session identity
- attachment of multiple surfaces to one assistant session
- resume, reattach, and affinity rules
- scoping rules across user, workspace, org, and object contexts

Must not own:

- raw transport sessions
- provider webhook semantics

### `@relay-assistant/surfaces`

Owns:

- assistant-facing inbound and outbound abstractions
- assistant-layer fanout policy describing which connected surfaces should receive a given assistant response
- formatter and capability hooks above Relay normalization
- surface metadata such as threading or attachment support

Fanout boundary note:
- Relay foundation still owns actual transport delivery to each destination
- `surfaces` only decides assistant-level targeting and formatting across attached surfaces
- Example: deciding that one assistant summary should go to web plus Slack belongs here; the actual Slack API post and web transport delivery remain in Relay foundation

Must not own:

- webhook verification
- provider SDK clients as foundational transport code

### `@relay-assistant/coordination`

Owns:

- coordinator and specialist registry contracts
- delegation plan and synthesis contracts
- many-agents-one-assistant orchestration semantics

Must not own:

- a fixed specialist lineup for any one product
- product-specific dispatch heuristics that cannot generalize

### `@relay-assistant/connectivity`

Owns:

- focused inter-agent signaling contracts
- convergence and escalation semantics
- attention, salience, confidence, and handoff message classes
- communication efficiency rules for internal assistant coordination

Must not own:

- raw message transport or relaycast substrate
- product-specific specialist registries
- generic user-facing messaging APIs

### `@relay-assistant/routing`

Owns:

- assistant-facing routing contracts
- latency/depth/cost response modes
- model-choice policy above raw provider clients
- integration points for workforce workload-router style persona/tier resolution

Must not own:

- raw transport routing
- provider SDK implementation details
- product-specific commercial routing rules

### `@relay-assistant/policy`

Owns:

- approval modes
- external-action safeguards
- action risk classification
- audit hooks

Must not own:

- one product's commercial rules or customer-tier behavior

### `@relay-assistant/examples`

Owns:

- reference examples showing how products should integrate the SDK
- skeletal example assistants and adoption patterns

Must not own:

- production product code
- private cloud adapters

## Extraction Guidance From Existing Systems

| Source | Signal | Destination |
| --- | --- | --- |
| Relay gateway and adapter infrastructure | transport, verification, normalization, raw actions | stay in Relay foundation |
| Sage memory and proactive behavior | reusable memory and follow-up patterns | `memory`, `proactive`, parts of `core` |
| MSD session and surface convergence design | shared chat surface and runtime/session attachment | `sessions`, `surfaces`, parts of `core` |
| NightCTO specialist orchestration and per-client continuity | many-agents-one-assistant and proactive monitoring | `coordination`, `connectivity`, `policy`, `memory`, `proactive` |
| Workforce workload-router and persona tiers | quality-preserving routing across depth/latency/cost envelopes | `routing`, parts of `core`, links to `coordination` |

## Import Guidance For Consumers

Consumers should import only the package boundaries they need.

Examples:

- a simple assistant may import `@relay-assistant/core`, `@relay-assistant/sessions`, and `@relay-assistant/surfaces`
- a memory-heavy assistant may additionally import `@relay-assistant/memory`
- a specialist-based assistant may add `@relay-assistant/coordination` and `@relay-assistant/policy`

Consumers should not import Relay infrastructure directly to bypass assistant-level contracts unless they are implementing a transport adapter or other foundational infrastructure outside this repo.

---CONNECTIVITY REVIEW---
# v1 Connectivity Package Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Reviewer:** v1-connectivity-package-review agent
**Package:** `@relay-assistant/connectivity`
**Files reviewed:**
- `docs/specs/v1-connectivity-spec.md`
- `docs/architecture/v1-connectivity-package-implementation-plan.md`
- `docs/reference/connectivity-signal-catalog.md`
- `docs/specs/v1-routing-spec.md`
- `packages/connectivity/package.json`
- `packages/connectivity/tsconfig.json`
- `packages/connectivity/src/index.ts`
- `packages/connectivity/src/types.ts`
- `packages/connectivity/src/connectivity.ts`
- `packages/connectivity/src/connectivity.test.ts`
- `packages/connectivity/README.md`

---

## 1. Spec Conformance

### Types — PASS

All types in `types.ts` match the canonical spec (§2.1–2.3, §7.2, §8–10) exactly:

| Type | Spec source | Match |
|---|---|---|
| `ConnectivitySignal` | §2.1 | ✓ All 14 fields present, correct optionality |
| `EmitSignalInput` | §2.3 | ✓ Excludes `id`, `emittedAt`, `state` |
| `SignalAudience` | §2.2 | ✓ 4 values |
| `MessageClass` | §2.2 | ✓ 5 values |
| `SignalClass` | §2.2 | ✓ 11 values, matches v1 vocabulary |
| `SignalPriority` | §2.2 | ✓ |
| `SignalState` | §2.2 | ✓ |
| `SignalEvent` | §8.2 | ✓ |
| `RequestedRoutingMode` | §9 | ✓ `'cheap' \| 'fast' \| 'deep'` |
| `SignalQuery` | §8.1 | ✓ Uses `since` per spec; adds `before` (harmless extension) |
| `SuppressionConfig` | §7.2 | ✓ |
| `RoutingEscalationHook` | §9 | ✓ |
| `ConnectivityLayerConfig` | §10 | ✓ |
| `ConnectivityLayer` interface | §8 | ✓ All 8 methods present with matching signatures |
| `SelectedAudienceResolver` | §8.3 | ✓ |
| `SignalCallback` | §8.2 | ✓ |

The implementation plan called for `errors.ts` as a separate file. The implementation places error classes inside `types.ts`. This is a non-functional structural deviation — acceptable.

### `emit()` Orchestration — PASS

The emit order in `connectivity.ts` matches spec §8 and implementation plan Step 8:

1. Validate input ✓
2. Validate `replaces` cross-thread ✓
3. Suppression check (critical bypasses) ✓
4. Supersede target + fire `'superseded'` callback ✓
5. Create signal with `id`, `emittedAt`, `state='emitted'` ✓
6. Store in thread array and by-ID index ✓
7. Routing escalation hook called (wrapped in try/catch) ✓
8. `onSignal(signal, 'emitted')` fired ✓
9. `state` promoted to `'active'` if any callback fired ✓
10. Return signal ✓

### Lifecycle State Machine — PASS

All transitions implemented correctly:
- `emitted → active`: after first `onSignal` callback fires ✓
- `active → superseded`: via `emit(replaces=...)` ✓
- `active → expired`: via `advanceStep()` ✓
- `active → resolved`: via `resolve()` ✓
- Terminal states blocked from further transition ✓
- `resolve()` idempotent for already-resolved signals ✓
- `resolve()` throws `ConnectivityError` for `superseded`/`expired` signals ✓

### Suppression — PASS

Duplicate key: `threadId|source|signalClass|audience` ✓

Suppression rules from spec §7.3:
- Returns existing signal unchanged on duplicate ✓
- `priority='critical'` bypasses suppression ✓
- `priority='high'` escalation with different `summary` bypasses suppression ✓
- Resolved signals do not count as duplicates; new signal is created ✓
- Step-basis: suppresses within same step, resets on `advanceStep()` ✓
- Time-basis: `windowMs` sliding window (defaults to 5000ms) ✓

### Validation — PASS

All rules from spec §2.3 enforced:
- `threadId`, `source`, `summary` non-empty strings ✓
- `messageClass`/`signalClass` cross-consistency check ✓
- `confidence` required for `confidence.*` and `conflict.*` classes ✓
- `confidence` range `[0.0, 1.0]` enforced when present ✓
- Per-class confidence ranges enforced (e.g., `confidence.high` requires `0.8–1.0`) ✓
- `expiresAtStep` must be non-negative integer ✓
- `replaces` must reference a signal in the same `threadId` ✓

### `advanceStep()` — PASS

Increments step counter, scans thread for `expiresAtStep <= currentStep` on non-terminal signals, transitions to `'expired'`, fires `onSignal(signal, 'expired')`. No-op on unknown thread. ✓

### `query()` — PASS

Matches spec §8.1:
- Default state filter `['emitted', 'active']` ✓
- All filters AND-combined, array-valued filters OR-within ✓
- `since`/`before` ISO-8601 time filters ✓
- `limit` defaults to 50 ✓
- `order` defaults to `'newest'` ✓

### Audience Resolution — PASS

| Audience | Behavior | Match |
|---|---|---|
| `self` | `[signal.source]` | ✓ |
| `coordinator` | `['coordinator']` | ✓ |
| `selected` | calls `SelectedAudienceResolver`; `[]` if none registered | ✓ |
| `all` | all thread sources + `'coordinator'` | ✓ |

Per spec: resolved recipients are informational only; `onSignal` fires to all subscribers regardless of audience. ✓

### File Structure Deviation — ACCEPTABLE

The implementation plan specified 24 files (8 runtime + 12 test + 4 integration test). The implementation uses 3 runtime files (`types.ts`, `connectivity.ts`, `index.ts`). All logic from the planned 8 runtime files is correctly consolidated into `connectivity.ts` (~445 lines). This is a pragmatic simplification that does not affect correctness or the public API surface.

### One Spec Deviation — MINOR

The implementation plan §7 explicitly required `"exactOptionalPropertyTypes": true` in `tsconfig.json`. The actual `tsconfig.json` omits this flag. Without it, TypeScript allows assigning `undefined` to optional properties as if they were present (e.g., `{ confidence: undefined }` satisfies `{ confidence?: number }`). The code is likely correct as written, but this weakens the type safety of the `EmitSignalInput` and `ConnectivitySignal` interfaces.

---

## 2. Boundary Cleanliness

### Routing Boundary — PASS

- `RoutingEscalationHook` is an interface defined in connectivity; routing implements it. ✓
- `RequestedRoutingMode` is defined in connectivity; routing re-defines its own mirror (`ConnectivityEscalationSignal`) to avoid circular imports per routing spec §4.7. ✓
- `connectivity.ts` calls `config.routingEscalationHook?.onEscalation(signal)` and ignores the returned mode. ✓
- No `@relay-assistant/routing` in `package.json` dependencies. ✓

### Coordination Boundary — PASS

- Coordination is not imported or referenced anywhere. ✓
- `SelectedAudienceResolver` is registered by coordination, called by connectivity — correct inversion. ✓
- Connectivity never calls coordination. ✓

### Transport / Persistence / Session / Surface Boundary — PASS

- All signals are in-process. ✓
- No network, queue, or storage dependencies. ✓
- `package.json` has exactly one runtime dependency: `nanoid`. ✓

### Public API Surface — NEAR PASS

Spec §15 specifies the exact export surface. The implementation exports everything from spec §15 and additionally exports the runtime constants:

```
MESSAGE_CLASSES, MESSAGE_CLASS_TO_SIGNAL_PREFIX, SIGNAL_AUDIENCES,
SIGNAL_CLASSES, SIGNAL_EVENTS, SIGNAL_PRIORITIES, SIGNAL_STATES, TERMINAL_STATES
```

These are beyond the spec's stated API surface. They do not expose internals (no `SignalLog`, `SuppressionWindow`, etc.) and are useful for downstream consumers doing validation. However, they widen the public API beyond what the spec intended for v1.

---

## 3. Test Coverage Assessment

### What Is Covered — STRONG

The consolidated `connectivity.test.ts` covers all four workflow shapes and the most important behaviors:

| Workflow / Behavior | Covered |
|---|---|
| WF-C1: Narrowcast attention, selected resolver called, signal queryable + resolvable | ✓ |
| WF-C2: Two conflict.active signals queryable; resolve clears them from active set | ✓ (partial — resolves only one, not both) |
| WF-C3: handoff.ready emits and fires onSignal | ✓ |
| WF-C4: escalation.uncertainty triggers hook; hook failure does not block callbacks | ✓ |
| ID format (`sig_<nanoid>`), ISO-8601 timestamp, initial state=emitted | ✓ |
| get() returns null for unknown IDs | ✓ |
| query() by messageClass, state, priority, limit, order, unknown thread | ✓ |
| resolve() emitted→resolved, active→resolved, idempotent | ✓ |
| resolve() throws for unknown signal, superseded signal | ✓ |
| Suppression within step, bypass on resolve, bypass on step advance | ✓ |
| Critical priority bypasses suppression | ✓ |
| High-priority escalation with different summary bypasses suppression | ✓ |
| Time-basis suppression with fake timers | ✓ |
| expiresAtStep expiry on advanceStep | ✓ |
| Already-terminal signals not re-expired | ✓ |
| advanceStep on unknown thread is no-op | ✓ |
| onSignal fires emitted/superseded/resolved/expired events | ✓ |
| offSignal stops delivery | ✓ |
| Callback exception isolation | ✓ |
| Routing hook called for escalation.interrupt and escalation.uncertainty, not for others | ✓ |
| Hook failure does not block onSignal callbacks | ✓ |
| messageClass/signalClass cross-consistency rejected | ✓ |
| Per-class confidence range rejected (confidence.blocker at 0.1) | ✓ |

### What Is Missing — GAPS

These scenarios from the implementation plan's minimum test spec are absent:

| Missing scenario | Plan source |
|---|---|
| `handoff.partial` → `handoff.ready` with `replaces` supersedes the partial signal | `wf-c3.test.ts` test 2 |
| `audience='self'` resolves to `[signal.source]` | `audience.test.ts` |
| `audience='all'` includes all thread sources + coordinator | `audience.test.ts` |
| `audience='selected'` with no resolver returns `[]` | `audience.test.ts` |
| Registering a new resolver replaces the prior one | `audience.test.ts` |
| Different `audience` bypasses suppression | `suppression.test.ts` |
| Superseding a terminal signal throws `ConnectivityError` | `lifecycle.test.ts` |
| Signal without `expiresAtStep` does not expire | `step.test.ts` |
| Signal with `expiresAtStep=2` not expired after one advanceStep | `step.test.ts` |
| EmitSignalInput does not include id/emittedAt/state (structural) | `types.test.ts` |
| Suppressed emit does NOT fire callbacks | `callbacks.test.ts` + `suppression.test.ts` |
| WF-C2: resolving BOTH conflict.active signals clears both from active query | `wf-c2.test.ts` test 2 |

**Overall test count:** approximately 16–20 `it()` blocks vs. the plan's minimum of 60. The plan's 12-file / 60-test target is not met.

---

## 4. Follow-ups Before Integration Work Begins

The following items should be addressed or tracked before `@relay-assistant/connectivity` is integrated as a dependency in `@relay-assistant/coordination` or product code:

### Required Before Integration

**FU-1: Add `exactOptionalPropertyTypes: true` to tsconfig.json**
The implementation plan explicitly required this flag. Without it, optional property semantics are weaker than intended. Risk: low for current code, higher as consumers start passing `EmitSignalInput` objects with explicit `undefined` values.

**FU-2: Add missing test scenarios**
The following gaps should be closed before coordination starts writing integration tests that depend on this package:
- `handoff.partial` → `handoff.ready` supersession (WF-C3 second case)
- `audience='self'` and `audience='all'` resolution paths
- `audience='selected'` with no resolver returns `[]`
- Different `audience` bypasses suppression
- Superseding a terminal signal throws `ConnectivityError`
- Suppressed emit does NOT fire callbacks
- Resolving both conflict signals clears both from active query (WF-C2 complete)

**FU-3: Decide on extra constant exports**
`MESSAGE_CLASSES`, `SIGNAL_CLASSES`, `SIGNAL_AUDIENCES`, `SIGNAL_EVENTS`, `SIGNAL_PRIORITIES`, `SIGNAL_STATES`, `TERMINAL_STATES`, and `MESSAGE_CLASS_TO_SIGNAL_PREFIX` are exported beyond spec §15's stated surface. This is useful for downstream consumers but was not in the spec. Either document these as intentional v1 extensions or remove them before consumers take a dependency.

### Advisory (Can Follow Integration)

**FU-4: Run `tsc --noEmit` and verify zero errors**
The implementation plan's Definition of Done (§9, item 3) requires `tsc --noEmit` to pass with strict mode. This was not independently verified during this review. Run before marking v1 complete.

**FU-5: Verify `advanceStep()` expiry boundary condition**
The expiry condition is `expiresAtStep <= currentStep`. With step-basis suppression, a signal emitted at step 0 with `expiresAtStep=1` should expire after the first `advanceStep()` (step becomes 1, `1 <= 1` is true). This is correct per implementation plan test target. Add an explicit test to lock this behavior before routing integration tests depend on it.

**FU-6: Document the `active` state promotion edge case**
`state='active'` is assigned after callbacks fire, conditioned on `callbacks.size > 0 && signal.state === 'emitted'`. If a callback calls `resolve()` on the signal during the fire loop, the signal lands in `'resolved'` rather than `'active'`. This is correct but worth a comment in the code and a test for coordination's benefit.

---

## Summary

| Dimension | Verdict |
|---|---|
| Type definitions match spec | PASS |

---COORDINATION HARDENING REVIEW---
# v1 Coordination Hardening Review Verdict

**Date:** 2026-04-11
**Package:** `@relay-assistant/coordination`
**Input:** v1-coordination-hardening-plan.md (COORDINATION_HARDENING_IMPLEMENTED)
**Verdict:** PASS_WITH_FOLLOWUPS

---

## Summary

All three required hardening items (H-1, H-2, H-3) are fully addressed. The selected-audience resolver is now wired and tested, the 35-test minimum is met exactly, and the validating-factory semantics are documented in both source and README. The two non-blocking name decisions (H-4, H-5) are implemented consistently and verified by tests. One non-blocking item (H-6: tsconfig source maps) could not be confirmed from the reviewed files and is flagged as a minor follow-up. The package is ready for memory/routing/product integration.

---

## Assessment

### 1. Were the highest-value review follow-ups actually addressed?

**YES — all three required items are closed.**

| Item | Required? | Status | Evidence |
|---|---|---|---|
| H-1: Wire `registerSelectedResolver` | Required | **DONE** | `coordination.ts` lines 298–303, inside `execute()` before `onSignal` |
| H-2: 35-test minimum | Required | **DONE** | 35 tests counted in `coordination.test.ts` |
| H-3: Document `createDelegationPlan` semantics | Required | **DONE** | JSDoc at `coordination.ts` lines 202–209; README lines 65–68 |
| H-4: Keep `validateDelegationPlan` name | Non-blocking | **DONE** | `index.ts` line 6 exports `validateDelegationPlan` consistently; decision documented in hardening plan |
| H-5: Keep `coord_` prefix | Non-blocking | **DONE** | `coordination.ts` line 286; verified by test at line 849 |
| H-6: `declarationMap`/`sourceMap` in tsconfig | Non-blocking | **UNCONFIRMED** | Not mentioned in hardening plan implementation notes; unverified from reviewed files |

---

### 2. Is selected-audience resolution now properly wired?

**YES — correctly implemented and verified.**

`coordination.ts` lines 298–303 register the resolver inside `execute()`, after `normalizedPlan` is built and before `config.connectivity.onSignal(callback)`:

```ts
config.connectivity.registerSelectedResolver((signal) => {
  return normalizedPlan.steps
    .map((step) => step.specialistName)
    .filter((name) => name !== signal.source);
});
```

This satisfies the hardening plan's specification exactly: the resolver is scoped to the current plan's participants, excludes the emitting source, and does not take routing ownership.

Test #35 (`coordination.test.ts` line 866) directly verifies the behavior: it captures the resolver via a patched `registerSelectedResolver`, then asserts that calling the resolver on a `handoff.ready` signal from `researcher` returns `['writer', 'reviewer']` — the two other plan participants. This is a high-quality behavioral assertion, not just a call-count check.

**One minor observation on re-registration:** The resolver is re-registered on every `execute()` call. If the connectivity layer accumulates rather than replaces resolvers, concurrent coordinator instances sharing the same connectivity layer could interfere. For v1 sequential execution this is not a concern, but should be documented before parallel delegation is introduced.

---

### 3. Is test coverage meaningfully stronger where it matters?

**YES — 35 tests across all four logical groups, up from 5.**

**Test inventory (35 total):**

**Specialist registry (7 tests):**
1. Duplicate registration rejection + plan validation with unknown specialist
2. `list()` defensive copy — mutating returned array does not affect registry
3. `has()` returns `false` before and `true` after registration
4. `register()` throws `CoordinationError` for empty string name
5. `register()` throws `CoordinationError` for whitespace-only name
6. `unregister()` is a no-op for an unregistered name
7. `get()` returns `null` for an unregistered name

**Delegation plan validation (7 tests):**
8. Returns `valid: false` when `intent` is empty
9. Returns `valid: false` when `steps` is empty
10. Returns `valid: false` when a step `instruction` is empty
11. Returns `valid: false` when a step `specialistName` is empty
12. Accumulates multiple errors in a single pass (empty intent + unknown specialist + empty instruction)
13. Returns `valid: false` when `steps.length` exceeds `maxSteps`
14. `createDelegationPlan()` returns a copy — mutating the returned plan does not affect the original input

**Synthesis strategies (8 tests):**
15. `concatenate` joins two `complete` results with double newline, `quality: 'complete'`
16. `concatenate` excludes `failed` results from text and `contributingSpecialists`
17. `concatenate` returns `quality: 'degraded'` with empty text when all results failed
18. `concatenate` returns `quality: 'degraded'` when a result is `partial`
19. `last-wins` returns only the last non-failed result's output
20. `last-wins` returns `quality: 'degraded'` with empty text when all results failed
21. `custom` delegates to `customFn` and returns its output unchanged
22. `custom` throws `SynthesisError` when `customFn` is not provided

**Coordinator lifecycle and signal handling (13 tests):**
23. Sequential delegation with handoff signals — resolves handoffs post-synthesis
24. Optional step failure produces degraded output without aborting
25. `confidence.blocker` halts the turn with `CoordinationBlockedError`
26. Conflict tracking without routing or transport ownership
27. Throws `CoordinationError` when `maxSteps` is zero
28. Throws `CoordinationError` when `maxSteps` is negative
29. Throws `CoordinationError` when `maxSteps` is not an integer
30. `advanceStep()` called exactly once per successfully executed step
31. `offSignal()` called with the registered callback even when execution throws
32. Required step failure aborts — subsequent steps are not executed
33. Plan exceeding `maxSteps` throws `DelegationPlanError` during execution
34. `turnId` starts with the `coord_` prefix
35. `registerSelectedResolver` scoped to plan participants, source excluded

**Quality observation:** The lifecycle tests are particularly well-constructed. Test #31 patches both `onSignal` and `offSignal`, captures the registered callback, and asserts the same reference is passed to `offSignal` after a throw — this is a proper finally-block verification, not a stub call count. Test #30 patches `advanceStep` and verifies it receives the correct `threadId` twice, once per step. Test #35 directly invokes the captured resolver with a real signal and asserts the return value.

---

### 4. Are the key spec/API mismatches now resolved or intentionally documented?

**YES — all three are resolved.**

**`validateDelegationPlan` vs `validatePlan`:** The longer name is kept. `index.ts` exports `validateDelegationPlan` at line 6. No usage of `validatePlan` as a public export exists. Decision documented in the hardening plan as H-4 (non-blocking, no code change required).

**`coord_` prefix vs `turn_`:** The `coord_` prefix is kept. `coordination.ts` line 286 uses `coord_${nanoid()}`. Test #34 verifies the prefix. Decision documented in the hardening plan as H-5 (non-blocking, no code change required).

**`createDelegationPlan` validating-factory semantics:** The function validates on construction and throws `DelegationPlanError` on failure. JSDoc at `coordination.ts` lines 202–209 documents this explicitly and provides guidance for the pre-population use case (use the `DelegationPlan` interface directly). README lines 65–68 repeat this guidance. Test #14 verifies the factory returns a copy, not the original object.

---

### 5. What follow-ups remain?

**Non-blocking (minor):**

1. **H-6 unconfirmed — `declarationMap`/`sourceMap` in `tsconfig.json`:** The hardening plan implementation notes do not mention this item, and it was not confirmed from the reviewed files. It should be verified with `npm run build` before publishing. Low urgency.

2. **README test list is stale:** `README.md` lines 153–157 still enumerate only five test scenarios (the original integration test set). The suite now has 35 tests across four groups. The list should be expanded or replaced with a summary count before product adoption to avoid misleading downstream contributors.

3. **`registerSelectedResolver` re-registration pattern:** As noted above, the resolver is re-registered on every `execute()` call. For v1 sequential execution this is safe. Before parallel delegation is introduced, document whether the connectivity layer replaces or accumulates registered resolvers, and add a deregistration path if accumulation occurs.

4. **WF-C/WF-CS integration tests still deferred:** Per hardening plan Section 5, these are explicitly out of scope for this pass. They remain the next milestone before NightCTO or MSD adopt the package.

---

## File-Level Notes

| File | Verdict | Notes |
|---|---|---|
| `src/types.ts` | PASS | Unchanged from prior review; all error classes and types are clean |
| `src/coordination.ts` | PASS | `registerSelectedResolver` correctly wired before `onSignal`; JSDoc added to `createDelegationPlan`; all prior correct behaviors preserved |
| `src/index.ts` | PASS | All 35-test-verified exports present; `validateDelegationPlan` name consistent |
| `coordination.test.ts` | PASS | 35 tests, all four groups covered, lifecycle assertions are high-quality behavioral tests |
| `README.md` | PASS (minor) | Connectivity boundary section updated to mention selected-audience resolver; test list at bottom is stale (still enumerates 5 scenarios) |

---

## Verdict Rationale

The hardening pass closed both integration-blocking issues from the prior review:

- `registerSelectedResolver` is wired, scoped, and tested with a behavioral assertion that directly verifies resolver output.
- Test coverage reached the 35-test minimum with comprehensive unit tests for registry edge cases, synthesis strategy edge cases, and coordinator lifecycle — the exact gaps the prior review identified.

The validating-factory semantics for `createDelegationPlan` are now clearly documented as a deliberate decision, not an accidental divergence. The two spec name mismatches (`validateDelegationPlan`, `coord_` prefix) are implemented consistently and verified by tests.

The reasons for PASS_WITH_FOLLOWUPS rather than PASS are limited to minor items: H-6 tsconfig flags are unconfirmed (non-blocking, trivial to verify), the README test list is stale (cosmetic), and the resolver re-registration pattern is safe for v1 but should be documented before parallel delegation. None of these affect runtime correctness or integration readiness.

**The package is integration-ready for memory, routing, and product packages.**

---

V1_COORDINATION_HARDENING_REVIEW_COMPLETE

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

---ROUTING README---
# @relay-assistant/routing

Status: docs-first placeholder

## Purpose

Own assistant-level routing policy for:
- model choice
- cheap / fast / deep response modes
- latency envelopes
- cost and token budgeting posture
- specialist engagement policy
- alignment with `workforce` workload-router concepts

## Why this package exists

The assistant SDK should not invent model-choice and budget logic independently in every product. Sage, MSD, and NightCTO all need shared decisions around:
- when a response should be fast versus deep
- when to prefer best-value versus best tiers
- when a specialist is worth the latency/cost
- how to preserve a fixed quality bar while varying depth, latency, and cost envelope

`workforce` already provides important prior art through workload-router, persona tiers, and routing profiles. This package should align with those concepts rather than diverge from them.

## Must Own

- assistant-facing routing contracts
- response mode definitions
- latency budget policy hooks
- model-depth/cost envelope selection rules
- integration points to workforce-style workload routing

## Must Not Own

- raw provider SDK clients
- transport routing
- product-only specialist taxonomies
- cloud-only hosted policy engines

## Key Principle

Quality bar should stay fixed.

Routing changes:
- depth
- verbosity
- latency envelope
- cost envelope
- specialist participation

Routing should not silently lower correctness or safety standards.
