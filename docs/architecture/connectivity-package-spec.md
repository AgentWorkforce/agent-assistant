> **Note:** The canonical v1 spec is at `docs/specs/v1-connectivity-spec.md`. This document is the original architecture-level design that informed the spec.

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

Define stable envelopes, signal lifecycles, policy hooks, and error handling.

Suggested spec outputs:

- `ConnectivitySignal` type
- audience policy contract
- suppression and replacement rules
- escalation contract
- route-escalation hint contract

### Stage 3: workflows

Define reference workflows shared across products.

Suggested workflow specs:

- memory-to-synthesis attention handoff
- reviewer-to-coordinator conflict escalation
- specialist-to-coordinator partial handoff
- route-escalation on blocker uncertainty

### Stage 4: code

Implement minimal OSS code in this order:

1. types
2. policy helpers
3. local dispatcher
4. workflow examples
5. tests

## Acceptance Criteria For The Package

The package is on the right track when:

- internal messages are shorter and more semantically explicit
- fanout is narrower by default
- routing mode affects communication behavior without lowering quality expectations
- Sage, MSD, and NightCTO can all use the same conceptual signal classes
- OSS consumers can run the core behavior without any hosted dependency

## Open Questions For Later Specs

- how much structured evidence should fit in one signal before summarization is required
- whether signal replacement should be explicit or inferred
- what the default suppression window should be for repeated low-value signals
- how route-escalation hints should integrate with `@relay-assistant/routing`
- which observability hooks belong in OSS vs cloud adapters

CONNECTIVITY_SPEC_COMPLETE
