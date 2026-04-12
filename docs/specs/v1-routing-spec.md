# v1 Routing Spec — `@agent-assistant/routing`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@agent-assistant/routing`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.2 (after core, sessions, surfaces, memory, connectivity land)

---

## 1. Responsibilities

`@agent-assistant/routing` manages model selection and routing-mode decisions across an assistant's coordination context. It is the layer that translates cost/latency/quality requirements into concrete model choices, without knowing about business logic or user-facing content.

This package is directly informed by Workforce routing patterns: cheap/fast/deep mode tiers, per-request cost envelopes, and quality-preserving routing with configurable thresholds.

**Owns:**
- `RoutingMode` — the three-tier model: `cheap`, `fast`, `deep`
- `ModelSelector` — given a routing context, returns a model specification
- `RoutingPolicy` — per-assistant and per-capability routing rules; configures when to use each mode
- `RoutingContext` — the signal envelope passed to the model selector for each invocation
- Cost envelope tracking — per-thread accounting of token/cost budget; trips mode escalation when exceeded
- Latency envelope — per-request latency target; routing selects models that can meet it
- Escalation receiver — implements `RoutingEscalationHook` from `@agent-assistant/connectivity`; applies requested mode changes

**Does NOT own:**
- The actual model API calls (→ product code or capability handlers; routing provides the model spec, not the invocation)
- Prompts, context assembly, or response formatting (→ product capability handlers)
- Coordination logic or specialist delegation (→ `@agent-assistant/coordination`)
- Connectivity signals (→ `@agent-assistant/connectivity`; routing receives escalation signals from connectivity, does not emit them)
- Session management (→ `@agent-assistant/sessions`)
- Surface delivery (→ `@agent-assistant/surfaces`)

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
   * Implements RoutingEscalationHook from @agent-assistant/connectivity.
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
  policy: RoutingPolicy;

  /**
   * Default model specs by mode, used when policy.modeModelSpecs does not
   * fully specify a mode. These represent the OSS defaults and can be
   * overridden per-assistant via RoutingPolicy.
   */
  defaultModelSpecs?: Partial<Record<RoutingMode, Partial<ModelSpec>>>;
}
```

Built-in defaults (OSS):

| Mode | Default tier | requiresToolUse | requiresStreaming | minContextTokens | maxLatencyMs |
|---|---|---|---|---|---|
| cheap | small | false | false | 0 | 0 |
| fast | medium | true | true | 16000 | 5000 |
| deep | large | true | true | 64000 | 0 |

Products override these via `RouterConfig.defaultModelSpecs` or `RoutingPolicy.modeModelSpecs`.

---

## 7. Package Boundaries

### Depends on
- `@agent-assistant/core` — import `AssistantRuntime` for `runtime.register('routing', router)` pattern.
- `@agent-assistant/connectivity` — imports `RequestedRoutingMode` type only (to satisfy `RoutingEscalationHook` interface). Routing does not import ConnectivityLayer or call its methods.

### Depended on by
- `@agent-assistant/coordination` — calls `router.decide()` before delegating work to a specialist.
- `@agent-assistant/connectivity` — calls `router.onEscalation()` via the hook interface.
- Product capability handlers — may call `router.decide()` directly for single-turn routing.

### Relay foundation boundary
- No dependency on relay foundation. Model specs are resolved to concrete model IDs by product code, which may call a relay-managed model gateway.

---

## 8. Dependency Rules

| Direction | Rule |
|---|---|
| Routing → core | Allowed. Import types only. |
| Routing → connectivity | Import `RequestedRoutingMode` type only. Do not import ConnectivityLayer or call its methods. |
| Routing → sessions | Forbidden. |
| Routing → surfaces | Forbidden. |
| Routing → memory | Forbidden. |
| Routing → coordination | Forbidden. Coordination depends on routing. |
| Coordination → routing | Allowed. Calls router.decide(). |
| Connectivity → routing | Import `RequestedRoutingMode` type only. Implements `RoutingEscalationHook` interface that routing defines. |

---

## 9. Workforce-Informed Design Notes

The cheap/fast/deep tier model directly mirrors Workforce routing semantics:

- **Cheap** maps to Workforce's low-cost internal routing tier: appropriate for summarization, classification, or simple factual queries that do not require deep reasoning.
- **Fast** maps to Workforce's standard interactive tier: the default for most user-facing turns where latency matters more than maximum quality.
- **Deep** maps to Workforce's high-quality tier: appropriate for multi-step reasoning, complex code generation, or synthesis tasks where quality is the primary constraint.

The cost envelope pattern (`costEnvelopeLimit`) mirrors Workforce's per-session budget tracking: once a session has spent its allocated budget at the deep tier, it automatically falls back to cheaper tiers for subsequent turns.

Workforce uses a quality-preserving constraint: mode changes must not violate a minimum quality bar. This spec does not implement that constraint in v1 (it would require a quality model spec field and a comparison function). This is flagged as a v1.2 addition.

---

## 10. OSS vs Cloud Boundary

All types, factory functions, decision algorithm, and cost tracking are OSS.

`ModelSpec.tier` is an abstract string. Concrete model ID resolution (tier → specific Claude or GPT model ID) is product code and may call a cloud service. Routing never makes that call.

Policy configuration (`RoutingPolicy`) is OSS. Cloud-managed policy updates (e.g., dynamic policy pushed from a control plane) are a cloud layer concern; they would implement a `RoutingPolicyProvider` interface (not specified in v1) that the cloud layer wraps around the router.

---

## 11. Open Questions

| # | Question | Owner | Resolution target |
|---|---|---|---|
| OQ-1 | Should `router.decide()` be synchronous (current spec) or async? Async would allow policy fetches from remote sources, but adds complexity for the common in-process case. | Routing | First implementation slice |
| OQ-2 | Should the mode ceiling also apply to caller-requested modes, or only to policy-derived modes? Current spec: ceiling applies to all. | Routing | First implementation slice |
| OQ-3 | Should cost units be abstract (current spec) or denominated in a specific currency (USD, tokens)? Abstract is portable but makes cross-product comparison harder. | Routing | Before Sage/MSD integration |
| OQ-4 | Should routing expose a `explain()` method that returns the full decision trace (not just the reason code) for debugging? | Routing | v1.1 (not blocking) |
| OQ-5 | When multiple escalation signals are active, should routing use the highest-priority signal's mode or the union? Current spec: highest-priority signal wins. | Routing + Connectivity | Before WF-C4 |
| OQ-6 | Should `modeCeiling` also gate `onEscalation()` responses? If an escalation requests 'deep' but ceiling is 'fast', should routing return 'fast'? Current answer: yes, ceiling always applies. | Routing | First implementation slice |

---

## 12. First Implementation Slice

**Step 1 — Type exports only**
- Export all interfaces, types, and enums.
- Tests: TypeScript structural validation.

**Step 2 — `createRouter` with decision algorithm**
- Implement the seven-step decision algorithm from §5.
- Tests: each rule fires correctly; priority order holds when multiple rules apply; hard constraint overrides caller.

**Step 3 — Default model spec construction**
- Merge base spec from policy + context requirements into `ModelSpec`.
- Tests: requiresToolUse from context overrides default; tier from policy is preserved.

**Step 4 — Cost tracking**
- Implement `recordCost`, `getAccumulatedCost`, `resetCost` with per-thread Map.
- Tests: cost accumulates across calls; reset clears thread; envelope trip uses 'cheap'.

**Step 5 — Escalation hook**
- Implement `onEscalation()` using `policy.escalationModeMap`.
- Tests: signal class maps to mode; ceiling applies to escalation responses.

**Step 6 — `runtime.register` integration**
- Register router on `AssistantRuntime`; capability handler retrieves it and calls `decide()`.
- Tests: end-to-end from capability invocation to model spec in hand.

**Step 7 — Connectivity wiring integration test**
- Stub connectivity layer emits an escalation signal; calls `router.onEscalation()`; router returns 'deep'; subsequent `decide()` for the same thread reflects the escalation.
- Tests: integration test covering the full escalation path.

**Definition of done:** A coordinator can call `router.decide()` for each specialist delegation and receive a `RoutingDecision` that reflects cost envelope, escalation signals, and capability overrides — without the router knowing about any specific model API.

SPEC_READY
