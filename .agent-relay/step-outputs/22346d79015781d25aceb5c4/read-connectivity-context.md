---CONNECTIVITY PACKAGE SPEC---
# Connectivity Package Spec

Date: 2026-04-11

## Purpose

This document defines the intended scope of `@relay-assistant/connectivity`.

The package owns focused internal coordination messages for assistant systems with multiple active components, specialists, or subsystems.

It exists to make internal communication:

- faster
- smaller
- more selective
- easier to synthesize
- less chat-like

## Position In The Stack

Connectivity sits:

- above Relay transport and delivery primitives
- beside `@relay-assistant/coordination`
- adjacent to `@relay-assistant/routing`
- below product-specific specialist behavior in Sage, MSD, NightCTO, and future assistants

## Core Thesis

Assistant systems should not treat internal coordination as generic chatter.

Generic chatter causes predictable failures:

- broad fanout of low-value messages
- hidden urgency
- repeated restatement of local reasoning
- synthesis delays
- token waste
- poor interrupt discipline

Focused coordination messages solve for a different objective:

- communicate only what changes downstream action
- communicate it to the smallest useful audience
- make urgency, confidence, and state explicit
- suppress messages that do not materially move the system forward
- converge on one coherent assistant answer

## Boundary

### Connectivity owns

- message classes and signal classes for assistant-internal coordination
- signal envelopes above transport
- routing-aware delivery intent such as narrowcast, broadcast, or coordinator-only
- communication efficiency policies
- interruption and escalation semantics
- convergence semantics such as consensus and conflict handling

### Connectivity does not own

- raw transport or queue infrastructure
- provider SDK integration
- product-specific specialist taxonomies
- final work assignment graphs
- cloud-only communication systems

## Distinction From Adjacent Packages

### vs `@relay-assistant/coordination`

Coordination owns who is doing what.

Connectivity owns what minimal signals move between those participants while work is in progress.

Coordination examples:

- assign planner and reviewer
- collect outputs
- synthesize one answer

Connectivity examples:

- reviewer raises `conflict`
- memory emits `attention`
- planner emits `handoff.ready`
- policy gate emits `escalation.immediate`

### vs `@relay-assistant/routing`

Routing chooses the operating envelope.

Connectivity adapts internal communication policy inside that envelope.

Routing examples:

- choose `cheap`, `fast`, or `deep`
- decide model tier
- set latency or cost envelope

Connectivity examples:

- permit only narrowcast plus one synthesis pass in `cheap`
- allow broader conflict resolution in `deep`
- escalate from `fast` to `deep` when uncertainty crosses a threshold

### vs Relay transport

Relay transport answers how something is delivered.

Connectivity answers why a signal exists, who should receive it, how urgent it is, and when it can be dropped.

## Design Principles

### Low latency

Signals should be cheap to create, cheap to route, and cheap to interpret.

### Selective routing

Default to the smallest audience that can act.

### Bounded verbosity

Prefer compact summaries and deltas over narrative transcripts.

### Convergence over chatter

Measure success by reduced duplicate work and faster synthesis, not by communication volume.

### Fixed quality bar across tiers

Changing mode changes envelope, not correctness expectations.

### OSS-first interfaces

Specify portable contracts first. Defer hosted implementations to adapters.

## Conceptual Model

The package should standardize a small vocabulary.

### Message class

The broad intent category.

Initial message classes:

- `attention`
- `confidence`
- `conflict`
- `handoff`
- `escalation`

### Signal class

The specific signal inside a message class.

Illustrative signal classes:

- `attention.raise`
- `attention.dismiss`
- `confidence.high`
- `confidence.low`
- `confidence.blocker`
- `conflict.detected`
- `conflict.resolved`
- `handoff.partial`
- `handoff.ready`
- `handoff.blocked`
- `escalation.required`
- `escalation.immediate`

These names are illustrative for the spike. Exact API naming can be stabilized later.

## Baseline Signal Envelope

The OSS package should eventually expose a compact signal envelope shaped roughly like this:

```ts
type ConnectivitySignal = {
  id: string;
  threadId: string;
  source: string;
  audience: "self" | "coordinator" | "selected" | "all";
  messageClass: "attention" | "confidence" | "conflict" | "handoff" | "escalation";
  signalClass: string;
  priority: "low" | "normal" | "high" | "interrupt";
  confidence?: "high" | "medium" | "low" | "blocked";
  summary: string;
  details?: Record<string, unknown>;
  replaces?: string[];
  expiresAtStep?: string;
};
```

The spike does not require this exact type. It defines the fields the eventual code should likely support.

## Audience And Routing Semantics

Connectivity should express delivery intent semantically, not through transport details.

Supported audience semantics should include:

- `self`: local state update only
- `coordinator`: send only to the orchestrating component
- `selected`: narrowcast to a named subset
- `all`: broadcast to active participants only when justified

Recommended default:

- use `coordinator` or `selected` unless there is a concrete reason to broadcast

## Focused Coordination Messages vs Generic Chatter

This distinction should be explicit in the package docs and code comments.

Focused coordination messages:

- express a single state change or decision-relevant delta
- declare urgency and confidence
- identify intended audience
- reference prior signal when superseding earlier state
- avoid unnecessary reasoning transcript

Generic chatter:

- mixes multiple ideas and status updates
- has unclear urgency
- defaults to broad audience
- repeats context already known to the recipients
- leaves synthesis to infer what mattered

The package should make the focused path easier than the chatty path.

## Product Usage

### Sage

Expected use:

- memory, context shaping, proactive logic, and final synthesis exchange signals
- memory emits attention only for context that changes likely user intent or answer quality
- proactive emits handoff or uncertainty rather than interrupting every time a watch fires
- response synthesis escalates to deeper routing only when blocker uncertainty is real

### MSD

Expected use:

- planner, reviewer, and notifier components coordinate with compact review-grade messages
- code review findings become conflict or escalation signals, not free-form internal chat
- notifier paths subscribe to terminal or escalation outcomes, not intermediate reasoning
- synthesis receives bounded evidence from reviewers and planners

### NightCTO

Expected use:

- many specialists coordinate through coordinator-focused signaling
- partial results stay narrowcast unless they affect another active specialist
- consensus and conflict signals determine whether another pass is needed
- escalation semantics are strict because high-risk business or delivery issues should interrupt promptly

## Workforce-Informed Routing Reality

Connectivity must remain compatible with workforce-style routing and persona tiers.

The package should assume:

- `cheap` mode uses tighter token, time, and participant budgets
- `fast` mode optimizes low-latency convergence
- `deep` mode allows broader evidence gathering and conflict reconciliation
- all modes preserve a fixed quality bar

Implications for connectivity policy:

- `cheap` should prefer fewer signals, narrowcast only, and earlier summarization
- `fast` should favor direct coordinator updates and aggressive suppression of low-value detail
- `deep` can tolerate wider evidence exchange, but still should not devolve into chatter
- any mode may emit a signal that requests route escalation when confidence is too low for the quality bar

Non-negotiable:

- lower-cost routes are not allowed to lower correctness or policy quality expectations

## Workflow Shapes

The first OSS workflows should be conceptual and portable.

### Narrowcast workflow

Use when one component has a delta relevant to a small subset.

Steps:

1. emit compact signal
2. route to coordinator or selected recipients
3. suppress broad fanout
4. update synthesis state only if downstream action changes

### Escalation workflow

Use when continuing the current plan is unsafe or wasteful.

Steps:

1. emit interrupt-grade signal
2. route to coordinator and any policy gate
3. stop or pause current path
4. re-plan or route deeper

### Conflict workflow

Use when active outputs disagree.

Steps:

1. emit conflict signal with bounded evidence
2. coordinator decides resolve-now vs route-deeper vs hold
3. emit resolved or blocker outcome

### Handoff workflow

Use when downstream work can proceed without polling.

Steps:

1. emit `handoff.partial`, `handoff.ready`, or `handoff.blocked`
2. downstream component advances or pauses accordingly
3. prior pending state can be replaced

## OSS-First Implementation Direction

The first implementation should stay local and adapter-friendly.

Good first OSS artifacts:

- TypeScript types for signal envelope and policy hooks
- audience selection helpers
- message suppression and replacement helpers
- bounded summarization utilities
- in-memory reference dispatcher for tests and examples

Deferred behind adapters:

- hosted channels
- tenant-aware event infrastructure
- cloud observability backends
- vendor-specific real-time delivery systems

## From Docs To Specs To Workflows To Code

This spike should convert into implementation in a staged way.

### Stage 1: docs

Lock the boundary, vocabulary, and product use cases.

### Stage 2: specs

---CONNECTIVITY PATTERNS---
# Connectivity Patterns Research

Date: 2026-04-11

## Purpose

This note captures the practical patterns the connectivity package should support in its first spec and implementation passes.

It is intentionally narrower than a full protocol design.

## Research Thesis

The right abstraction is not "internal agents chatting."

The right abstraction is "specialized components exchanging compact signals that help the system converge."

That framing matters because it changes design defaults:

- from transcript to delta
- from broadcast to narrowcast
- from narration to actionability
- from unlimited context to bounded payloads

## Pattern 1: Attention Raise

Use when a component finds something another component should probably consider.

Good fit:

- memory finds prior context that changes likely intent
- retrieval finds contradictory background
- monitoring finds a newly relevant event

Recommended properties:

- small summary
- explicit audience
- no full transcript
- suppress if the same attention state is already active

## Pattern 2: Confidence Gradient

Use when a component needs to tell the rest of the system how stable its local result is.

Useful outputs:

- high confidence
- medium confidence
- low confidence
- blocker uncertainty

Why this matters:

- low confidence can trigger another pass without pretending the work is finished
- blocker uncertainty can trigger route escalation instead of silent failure

## Pattern 3: Conflict Detection

Use when two active views disagree in a way that affects the final answer.

Examples:

- reviewer evidence contradicts the current draft
- memory context and live surface context diverge
- two specialists propose incompatible next actions

Recommended behavior:

- send bounded evidence
- route to coordinator first
- do not broadcast conflict to everyone unless another participant must act

## Pattern 4: Handoff Ready

Use when a downstream component can proceed without more polling.

Examples:

- planner finished a bounded plan
- reviewer completed a pass
- memory finished enrichment and synthesis can continue

Why this matters:

- it turns implicit readiness into explicit state
- it reduces repeated "are you done?" traffic

## Pattern 5: Escalation Interrupt

Use when the current path should stop or change immediately.

Examples:

- policy issue
- unsafe action recommendation
- deadline risk
- invalid assumptions discovered

Recommended behavior:

- make interrupt semantics explicit
- route to coordinator and policy gate immediately
- replace prior non-urgent state

## Pattern 6: Consensus Compression

Use when several partial findings are all pointing to the same outcome.

Instead of forwarding every intermediate agreement:

- accumulate locally
- emit one compressed consensus signal
- preserve enough provenance for the coordinator to trust the result

This is especially important in `deep` mode, where more participants may be active.

## Focused Coordination vs Chatter

The package should actively encourage focused coordination patterns.

### Focused coordination looks like

- "conflict detected, reviewer evidence contradicts planned response"
- "handoff ready, summary attached, confidence medium"
- "escalation immediate, unsafe action path"

### Generic chatter looks like

- broad status narration
- multi-topic updates
- restating local scratch work
- describing thought process without a clear action implication

The difference is not cosmetic. It determines whether the system can act quickly.

## Routing-Aware Communication

Connectivity should react to route envelope.

### `cheap`

Target behavior:

- minimal participants
- hard cap on message volume
- summarize early
- avoid optional conflict loops

### `fast`

Target behavior:

- coordinator-first updates
- aggressive narrowcast
- only interrupt-worthy changes break through

### `deep`

Target behavior:

- broader evidence gathering
- explicit conflict and consensus handling
- still bounded verbosity

Across all routes:

- quality expectations remain fixed
- policy standards remain fixed
- escalation remains available

The route changes how much process the system can afford, not how correct it is allowed to be.

## Product Lens

### Sage

Likely dominant patterns:

- attention raise
- confidence gradient
- handoff ready

Reason:

- the main need is coordinating memory, proactive context, and final synthesis without over-notifying

### MSD

Likely dominant patterns:

- conflict detection
- handoff ready
- escalation interrupt

Reason:

- review workflows need clear contradiction handling and bounded synthesis inputs

### NightCTO

Likely dominant patterns:

- coordinator narrowcast
- conflict detection
- consensus compression
- escalation interrupt

Reason:

- many-specialist operation is where chatter risk is highest and convergence discipline matters most

## Implications For Specs

The first spec should emphasize:

- small conceptual message vocabulary
- explicit audience semantics
- explicit interrupt semantics
- confidence and conflict as first-class signals
- replacement and suppression rules

The first spec should avoid:

- giant protocol surface area
- product-specific signal types
- transport-specific fields
- hosted-only assumptions

## Implications For Workflows

The first reusable workflows should be:

1. narrowcast attention
2. reviewer conflict escalation
3. specialist handoff ready
4. blocker uncertainty requesting deeper routing

Those four workflows are enough to prove the package shape without overcommitting.

## Implications For Code

The first code should be small and testable:

- signal types
- audience selection helper
- suppression and replacement helper
- in-memory dispatcher
- example tests for Sage, MSD, and NightCTO style flows

Cloud-specific delivery should remain adapter-based and out of scope for the first OSS implementation.

---CONNECTIVITY ADOPTION---
# Connectivity Adoption Guide

Date: 2026-04-11

## Purpose

This guide explains when and how product teams should adopt `@relay-assistant/connectivity`.

Use it when a product has multiple active subsystems or specialists that need to coordinate efficiently under one assistant identity.

Do not use it as a generic message bus replacement.

## When To Adopt

Adopt connectivity when at least one of these is true:

- multiple specialists produce inputs for one final answer
- components keep polling each other for readiness
- internal transcripts are verbose and hard to synthesize
- urgent issues are discovered too late
- low-value broadcasts are causing token or latency waste

Do not adopt connectivity just because there are multiple modules in a codebase.

The package is for coordination signals, not ordinary function calls.

## The Core Behavioral Shift

Before connectivity:

- components narrate progress in generic internal messages
- recipients infer urgency and actionability from prose
- broadcasts are common
- the coordinator reads too much

After connectivity:

- components emit focused coordination messages
- urgency, confidence, and audience are explicit
- narrowcast is the default
- synthesis receives bounded, decision-relevant inputs

## Focused Coordination Messages

A focused coordination message should answer:

- what changed
- who needs to know
- how urgent it is
- how confident the source is
- whether this supersedes an earlier state

It should not include a full reasoning transcript unless the current workflow specifically calls for supporting evidence.

## Suggested Adoption Sequence

### 1. Start with one workflow

Pick a concrete path with visible coordination pain.

Good starting points:

- reviewer to coordinator conflict reporting
- memory to synthesis attention signals
- specialist handoff readiness

### 2. Define message classes first

Before building code, map the current internal messages into:

- attention
- confidence
- conflict
- handoff
- escalation

### 3. Set routing defaults

Choose audience defaults up front:

- coordinator-only unless another recipient must act
- selected subset for specialized follow-up
- broadcast only when broad state change is actually needed

### 4. Add suppression rules

Prevent repeated low-value updates.

Examples:

- drop identical low-priority signals within a short window
- replace earlier partial states when a newer one supersedes them
- summarize repeated low-confidence chatter into one blocker signal

### 5. Add route-escalation hooks

Let connectivity request a deeper route when the fixed quality bar cannot be met in the current envelope.

## Product-Specific Guidance

### Sage

Adopt connectivity around memory and proactive behavior first.

Suggested first workflows:

- memory emits `attention` when retrieved context materially changes interpretation
- proactive emits `handoff.blocked` or `confidence.low` instead of interrupting with speculative follow-up
- final synthesis listens for blocker uncertainty before asking routing for a deeper pass

What to avoid:

- forwarding every retrieved memory note
- turning watch activity into constant status chatter

### MSD

Adopt connectivity around review and synthesis first.

Suggested first workflows:

- reviewer emits `conflict.detected` when code evidence contradicts the current plan
- planner emits `handoff.ready` with bounded summary for response composition
- notifier subscribes only to final or escalation-grade signals

What to avoid:

- free-form internal review commentary as the default machine-readable interface
- broadcasting partial reviewer reasoning to every participant

### NightCTO

Adopt connectivity around specialist coordination first.

Suggested first workflows:

- specialists narrowcast to coordinator by default
- coordinator tracks consensus and conflict state explicitly
- urgent risk signals interrupt active work instead of waiting for the next synthesis cycle

What to avoid:

- all-to-all specialist chat
- repeated restatement of partial findings

## Cheap, Fast, And Deep Modes

Connectivity should be aware of route envelope without owning route selection.

Practical guidance:

- `cheap`: emit fewer signals, summarize earlier, restrict audience aggressively
- `fast`: prioritize low-latency narrowcast and direct coordinator updates
- `deep`: allow broader evidence collection and conflict handling, but still cap verbosity

Across all three modes:

- the quality bar stays fixed
- policy requirements stay fixed
- escalation standards stay fixed

If the current mode cannot meet the quality bar, emit a connectivity signal that requests a deeper route rather than forcing a weak answer through.

## OSS-First Adoption Rule

Build against portable interfaces first.

Good OSS-first choices:

- in-process dispatch
- local policy helpers
- testable signal envelopes
- adapter hooks for future hosted delivery

Defer cloud-specific behavior:

- tenant-aware event buses
- hosted channels
- cloud observability backends
- provider-managed real-time delivery

## Practical Definition Of Done

Connectivity adoption is working when:

- internal messages are shorter and more legible
- synthesis sees fewer but better inputs
- urgent issues surface earlier
- duplicate work drops
- the same core signal classes make sense across Sage, MSD, and NightCTO

## How This Becomes Real Code

Follow this order:

1. write the package-level spec and message vocabulary
2. define workflow docs for a small number of high-value coordination paths
3. implement portable TypeScript types and policy helpers
4. add in-memory reference dispatch and tests
5. integrate product-specific adapters without widening the core vocabulary for one product

## Initial Anti-Patterns

Avoid these during adoption:

- using connectivity for normal request-response code paths
- introducing product-specific signal classes too early
- treating every internal update as broadcast-worthy
- using low-cost routes as an excuse for lower answer quality
- binding the package to hosted infrastructure in the first OSS cut

---CONNECTIVITY README---
# @relay-assistant/connectivity

Status: docs spike

`@relay-assistant/connectivity` defines the assistant-level signaling layer for internal coordination.

It is not a generic chat bus.

It exists so assistant subsystems and specialists can exchange compact, decision-relevant coordination messages instead of flooding each other with generic chatter.

## What This Package Owns

- focused coordination message contracts above Relay transport
- conceptual signal classes such as attention, confidence, conflict, handoff, and escalation
- routing-aware communication policy for who should hear what and when
- efficiency rules for bounded verbosity and fast convergence
- OSS-first interfaces that products can adopt before any hosted implementation exists

## What This Package Does Not Own

- raw transport delivery
- webhook parsing or provider integrations
- product-specific specialist registries
- cloud-only queues or event buses
- user-facing message formatting

## Core Thesis

Internal assistant communication should look more like disciplined signaling than like a group chat transcript.

Focused coordination messages are:

- small enough to parse quickly
- scoped to the right recipient set
- explicit about urgency and confidence
- safe to suppress when they add no new information
- designed to help a system converge on one answer

Generic chatter is the opposite:

- verbose status narration
- broad fanout by default
- hidden urgency
- repeated restatement of local reasoning
- slow synthesis because every participant has to read too much

Connectivity exists to push systems toward focused coordination messages and away from generic chatter.

## Efficiency Principles

Every implementation should preserve these principles:

### Low latency

Signals should be cheap to emit, cheap to route, and cheap to interpret.

### Selective routing

Most messages should be narrowcast to the smallest audience that can act on them.

### Bounded verbosity

A signal should carry only the minimum useful payload for the current step.

### Convergence over chatter

The purpose of connectivity is to reduce decision time and duplicate work, not to maximize internal discussion.

## Conceptual Message Classes

The package should expose a small conceptual vocabulary rather than a product-specific ontology.

### Attention

Used when something becomes newly relevant outside one component's local scope.

Examples:

- a memory lookup finds high-salience context
- a reviewer detects a likely safety issue
- a planner sees a missing dependency

### Confidence

Used to communicate how stable or unstable a local conclusion is.

Examples:

- high confidence: ready for synthesis
- low confidence: proceed carefully
- blocker uncertainty: do not finalize yet

### Conflict

Used when active participants disagree or when two claims cannot both be true.

Examples:

- memory says one thing, live evidence says another
- one specialist recommends escalation, another recommends silent retry

### Handoff

Used to move work forward without polling.

Examples:

- partial result ready
- blocked pending more scope
- final result ready for synthesis

### Escalation

Used when a state change should interrupt the normal flow.

Examples:

- policy risk
- deadline risk
- invalid plan
- stop-current-path now

## Signal Classes vs Message Classes

Use these terms consistently:

- message class: the top-level intent such as `attention`, `confidence`, `conflict`, `handoff`, or `escalation`
- signal class: a more precise subtype within that message class such as `attention.raise`, `confidence.low`, `handoff.ready`, or `escalation.immediate`

The package should standardize the conceptual classes first, then stabilize concrete type names later.

## Routing Reality

Connectivity must reflect workforce-style routing realities without absorbing routing ownership.

Routing decides the operating envelope.

Connectivity adapts message behavior inside that envelope.

Important realities to preserve:

- `cheap` mode still must meet the same quality bar; it just uses tighter budgets and fewer participants
- `fast` mode prioritizes low-latency convergence with minimal fanout
- `deep` mode permits broader evidence gathering and more conflict resolution before synthesis
- the quality bar should stay fixed across tiers even when depth, latency, and cost envelope change

That means connectivity policy can vary:

- how many specialists are engaged
- how many signals are allowed before summarization
- what counts as interrupt-worthy
- when a low-confidence result should request a deeper route

But it should not vary:

- correctness expectations
- policy compliance
- escalation standards

## How Sage, MSD, and NightCTO Use Connectivity

### Sage

Sage uses connectivity to coordinate memory, context shaping, proactive follow-up, and final response generation.

Typical patterns:

- memory emits an attention signal when prior workspace context materially changes likely interpretation
- proactive logic emits a low-confidence handoff instead of interrupting the user thread with speculative follow-up
- synthesis requests a deeper route only when uncertainty crosses a threshold

### MSD

MSD uses connectivity to coordinate reviewer, planner, and notifier behavior without turning review flows into internal chat transcripts.

Typical patterns:

- a reviewer raises conflict when code evidence disagrees with the claimed fix
- a planner emits handoff-ready with bounded evidence for the final response composer
- notifier paths subscribe only to final or escalation-grade outcomes, not to intermediate reasoning

### NightCTO

NightCTO uses connectivity for many-specialist coordination under one assistant identity.

Typical patterns:

- specialists narrowcast partial findings to the coordinator instead of broadcasting to the whole lineup
- high-risk signals interrupt quickly
- consensus and conflict signals determine whether the coordinator can synthesize or needs another pass

## OSS-First Scope

This package should start as portable interfaces, policies, and local runtime utilities.

Cloud-specific behavior belongs behind adapters and should be deferred.

Examples that should be adapter-based later, not baked into the package now:

- hosted event buses
- tenant-aware delivery infrastructure
- cloud-only observability pipelines
- provider-managed real-time channels

## From Docs To Code

The intended progression is:

1. docs
2. specs
3. workflows
4. code

In practice:

1. document the conceptual classes, boundaries, and efficiency rules
2. define stable signal envelopes and policy hooks in the architecture spec
3. define reusable workflows such as narrowcast, escalation, conflict resolution, and handoff
4. implement small OSS interfaces and in-process reference behavior

See:

-  onnectivity package spec](../../docs/architecture/connectivity-package-spec.md)
-  onnectivity adoption guide](../../docs/consumer/connectivity-adoption-guide.md)
-  onnectivity patterns research](../../docs/research/connectivity-patterns.md)

CONNECTIVITY_DOCS_READY

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

---FOUNDATION INTEGRATION REVIEW---
# v1 Foundation Integration Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-11
**Reviewer:** Non-interactive review agent
**Scope:** WF-4 (core + sessions) and WF-6 (core + sessions + surfaces)
**Artifacts reviewed:**
- `docs/architecture/v1-foundation-integration-plan.md`
- `packages/core/src/core.ts`
- `packages/core/src/core-sessions.test.ts`
- `packages/core/src/core-sessions-surfaces.test.ts`
- `packages/sessions/src/sessions.ts`
- `packages/surfaces/src/surfaces.ts`
- `docs/architecture/v1-core-review-verdict.md`
- `docs/architecture/v1-sessions-review-verdict.md`
- `docs/architecture/v1-surfaces-review-verdict.md`

---

## 1. Do the Integration Tests Actually Prove WF-4 and WF-6 Behavior?

### WF-4 Coverage (`core-sessions.test.ts`)

The plan specified 9 tests. All 9 are present and correctly exercising the intended behaviors.

| Plan item | Test name | Result |
|---|---|---|
| 2.1 — Subsystem registration | "registers the session store as a runtime subsystem" | ✅ |
| 2.2 — Session resolution (new) + touch | "resolves a new session on first message, attaches the surface, and touches it active" | ✅ |
| 2.2 — Session resolution (existing) | "resolves the existing session for subsequent messages" | ✅ |
| 2.3 — Emit → session → per-surface send | "emits to every surface attached to the session when fanout is unavailable" | ✅ |
| 2.3 — Emit → session → fanout | "uses outbound fanout when the adapter exposes it" | ✅ |
| 2.5 — Nonexistent sessionId throws | "throws when emit references a nonexistent session" | ✅ |
| 2.5 — No routing target throws OutboundEventError | "throws OutboundEventError when emit lacks both surfaceId and sessionId" | ✅ |
| 2.4 — Touch updates lastActivityAt | "updates lastActivityAt when the session is touched during dispatch integration" | ✅ with gap (see §4) |
| WF-4 2.4 — Attach/detach affects fanout | "reflects surface attach and detach effects in runtime fanout targets" | ✅ |

**Finding:** All 9 behaviors are exercised. The WF-4 proof is substantially complete.

**One weak point — test 8 ("dispatch integration"):** The test title implies wiring through `runtime.dispatch()`, but the test calls `resolveSession()` directly with a mock resolver. `resolveSession` is shown to call `store.touch()`, which is correct. However, the path from `runtime.dispatch()` → capability handler → `resolveSession()` → `store.touch()` is NOT exercised end-to-end in this test. Plan spec item 2.4 states "every dispatch through the integration path calls `store.touch(sessionId)`" — but since session touching is a responsibility of capability handlers (not the runtime itself), the test validates the mechanism but not the wiring. This is a naming/scoping mismatch, not a correctness failure, but it's worth clarifying in follow-ups.

### WF-6 Coverage (`core-sessions-surfaces.test.ts`)

The plan specified 10 tests. The implementation consolidates some into 6 tests that collectively cover all 10 plan behaviors.

| Plan item | Covered by | Result |
|---|---|---|
| 3.1 — Registry as inbound+outbound adapter | Test 1 | ✅ |
| 3.2 — receiveRaw → normalize → dispatch → handler fires | Test 2 | ✅ |
| 3.3 — Handler emits → sessionId → fanout → all surfaces | Test 2 | ✅ |
| 3.4 — Attach expands fanout targets | Test 3 | ✅ |
| 3.4 — Detach shrinks fanout targets | Test 3 | ✅ |
| 3.6 — Inactive surface skipped (default policy) | Test 4 | ✅ |
| 3.5 — Full lifecycle start → receive → emit → stop | Test 2 (implicitly), Test 5 | ✅ |
| 3.5 — Stop drains in-flight handlers | Test 5 | ✅ |
| Normalization drop (missing userId) | Test 6 | ✅ |
| maxConcurrentHandlers enforced | Test 5 | ✅ |

**Finding:** All 10 WF-6 behaviors are exercised. The consolidation is pragmatic and the combined tests are readable. Test 5 correctly validates both drain-on-stop and concurrency limiting in one well-structured scenario.

**One compositional note — Test 2:** This test is complex and multi-purpose (inbound normalization + session resolution + emit + fanout in one test). If it fails, the failure site is harder to identify. The plan intended these as separate tests. This is acceptable for v1 but slightly reduces diagnostic clarity.

---

## 2. Are the Package Interactions Clean and Spec-Aligned?

### Core ↔ Sessions

**Duck-type contract (clean):** `core.ts` defines an internal `SessionSubsystem` type that accepts either `{ get(id) }` or `{ getSession(id) }`. `SessionStore.get(sessionId)` satisfies the `get` branch. `Session` is a structural superset of `SessionRecord`. No adapter or wrapper is needed. This was pre-verified with a compile-time contract check in the sessions test file.

**Registration pattern (clean):** `runtime.register('sessions', store)` / `runtime.get<SessionStore>('sessions')` is direct and type-safe via the generic.

**Emit path (correct):** `core.ts:resolveAttachedSurfaces()` (lines 165–179) correctly calls either `getSession` or `get` depending on what the registered subsystem exposes, then copies `attachedSurfaces` defensively.

### Core ↔ Surfaces

**Adapter contract (clean):** `surfaces.ts` defines local `CoreInboundAdapterShape` and `CoreOutboundAdapterShape` types that mirror core's `RelayInboundAdapter` and `RelayOutboundAdapter` without importing from core. `createSurfaceRegistry()` returns the intersection type. The surfaces test file has compile-time contract checks (`const _inboundContractCheck: CoreInboundAdapter = createSurfaceRegistry()`).

**Fanout return-type asymmetry (acceptable):** `surfaces.ts:fanout()` returns `Promise<FanoutResult>`, but `CoreOutboundAdapterShape.fanout?` specifies `Promise<void>`. This is reconciled via a `as` type assertion on line 196. This works correctly because `core.ts` ignores the fanout return value (just `await`s it). However, `Promise<FanoutResult>` is assignable to `Promise<void>` in TypeScript's structural system, so the `as` cast is defensively correct but introduces an implicit contract that should be confirmed at compile time rather than only at runtime. See follow-up item I-1.

**Fanout third parameter (acceptable):** `surfaces.ts:fanout()` accepts an optional third `policy?` parameter not present in `CoreOutboundAdapterShape`. TypeScript allows extra optional parameters in function types, so the structural assignment is valid. This is a non-issue.

### Sessions ↔ Surfaces

**Correct absence of coupling:** Surfaces does not import sessions. The fanout receives `string[]` of surfaceIds, with session-to-surfaceId resolution performed in `core.ts:resolveAttachedSurfaces()`. The dependency direction is correct: `core → sessions` (session resolution), `core → surfaces` (delivery). `surfaces → sessions` coupling is absent.

---

## 3. Were Changes Kept Narrow and Integration-Focused?

**Yes.** The plan explicitly stated "None expected" for changes to `core.ts`, `sessions.ts`, and `surfaces.ts`. The implementation delivered this constraint exactly:

- Two new test files were created: `core-sessions.test.ts` and `core-sessions-surfaces.test.ts`.
- No modifications to the three package implementation files were required to make the integration tests pass.
- The tests import from package source files directly without introducing new exports, types, or adapters.
- Tests use `InMemorySessionStoreAdapter` with no external dependencies.
- Surface adapters in WF-6 tests are simple mock objects tracking sent payloads.
- No new packages, no cloud assumptions, no product-specific logic were introduced.

This confirms the plan's key architectural claim: the three packages were designed with these integration contracts already in mind and required no retroactive changes to satisfy cross-package use.

---

## 4. Follow-ups Before Moving to the Next Package Layers

The following items are ordered by priority. Items marked **MUST** block progression to the next phase. Items marked **SHOULD** are recommended before the next phase. Advisory items can be deferred.

### I-1 — Clarify the `fanout()` return-type mismatch at compile time [SHOULD]

**Current state:** `surfaces.ts` returns `registry as SurfaceRegistry & CoreInboundAdapterShape & CoreOutboundAdapterShape` using a type assertion. `fanout()` returns `Promise<FanoutResult>` while `CoreOutboundAdapterShape.fanout` declares `Promise<void>`.

**Risk:** The `as` cast suppresses compile-time enforcement of the return type. If `core.ts` is ever updated to read the fanout result, the mismatch would silently produce `undefined` instead of a `FanoutResult`.

**Action:** Either (a) update `CoreOutboundAdapterShape.fanout` to return `Promise<void | FanoutResult>`, or (b) add a compile-time narrowing check in the surfaces test alongside the existing contract checks, verifying the fanout return type is at minimum compatible with `Promise<void>`.

---

### I-2 — Rename or clarify test 8 in `core-sessions.test.ts` [SHOULD]

**Current state:** The test is named "updates lastActivityAt when the session is touched during dispatch integration" but does not call `runtime.dispatch()`. It tests `resolveSession()` directly.

**Risk:** Future contributors may expect a full dispatch loop in this test and be misled by the title.

**Action:** Either (a) rename the test to "resolveSession touches the session and updates lastActivityAt" to match what it actually does, or (b) extend it to push a message through `runtime.dispatch()` with a capability handler that calls `resolveSession`, then assert the updated timestamp. Option (b) would close the proof gap for spec item 2.4 more completely.

---

### I-3 — Add a dedicated end-to-end lifecycle test in `core-sessions-surfaces.test.ts` [SHOULD]

**Current state:** The full lifecycle path (start → receive → dispatch → emit → fanout → stop) is covered by test 2 implicitly and test 5 partially, but there is no single test that exercises all steps together while asserting clean shutdown.

**Action:** Add a focused test matching plan item 3.5 ("Full runtime lifecycle") with explicit assertions on `runtime.status().ready` before and after stop, and that no in-flight handlers remain. This improves diagnostic clarity without duplicating existing coverage.

---

### Carried-over items (not yet resolved)

The following follow-ups from prior package reviews remain open and are unaffected by the integration work:

| Item | Source | Priority | Description |
|---|---|---|---|
| C-4.1 | Core review | SHOULD | Add test for missing `name` validation |
| C-4.2 | Core review | SHOULD | Export `SessionSubsystem` from core types |
| C-4.3 | Core review | ADVISORY | Document stop-drain timeout behavior |
| S-F-2 | Sessions review | SHOULD | Add expire() from created/suspended state tests |
| S-F-3 | Sessions review | SHOULD | Expand find() query filter tests |
| S-F-4 | Sessions review | MINOR | Remove dead `?? defaultTtlMs` in sweepStale |
| S-F-5 | Sessions review | MINOR | Document MAX_SAFE_INTEGER bypass in sweepStale |
| S-F-6 | Sessions review | OPEN | Resolve OQ-2 (max surfaces) and OQ-3 (delete vs. retain) |
| Su-F-1 | Surfaces review | SHOULD | Resolve OQ-2: send() behavior for inactive surfaces |
| Su-F-2 | Surfaces review | SHOULD | Add concurrency test for fanout |
| Su-F-6 | Surfaces review | NICE | Document normalizationHook null/undefined drop behavior |

Items S-F-6 (OQ-2, OQ-3) and Su-F-1 (inactive surface in send()) are the most load-bearing of the carried items. OQ-2 in particular needs an owner and resolution before WF-7 assembly, since it affects session attachment limits which are exercised in the integration tests.

---

## Summary

| Dimension | Result |
|---|---|
| WF-4 behaviors proved (9/9 plan items) | ✅ All covered; one naming/scoping note on test 8 |
| WF-6 behaviors proved (10/10 plan items) | ✅ All covered; some tests are composite |
| Package interaction cleanliness | ✅ Clean; one return-type asymmetry worth confirming at compile time |
| Spec alignment of package contracts | ✅ Correct; duck-typing verified structurally |
| Scope discipline (no spurious package changes) | ✅ Strictly integration-test-only additions |
| Prior required follow-ups fulfilled | ✅ Sessions F-1 and Surfaces F-3/F-4 (WF-4, WF-6 integration tests) complete |
| New follow-ups introduced | 3 items (I-1 through I-3), all SHOULD or lower |

The v1 foundation integration is functionally complete and correct. The three packages wire together as the spec intended, with no glue code, no retroactive modifications, and no cross-package runtime imports. The integration tests cover all planned behaviors across both WF-4 and WF-6.

**VERDICT: PASS_WITH_FOLLOWUPS**

The foundation is ready for the next package layers (connectivity, memory, policy). The three new follow-up items (I-1 through I-3) should be resolved during that phase or as a targeted patch before WF-7 assembly begins.

---

V1_FOUNDATION_INTEGRATION_REVIEW_COMPLETE
