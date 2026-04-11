---CONNECTIVITY SPEC---
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

---CONNECTIVITY VERDICT---
# Connectivity Package Spike — Review Verdict

Date: 2026-04-11
Verdict: **PASS_WITH_FOLLOWUPS**

---

## Files Reviewed

- `packages/connectivity/README.md`
- `docs/architecture/connectivity-package-spec.md`
- `docs/consumer/connectivity-adoption-guide.md`
- `docs/research/connectivity-patterns.md`
- `README.md`
- `docs/index.md`

---

## Assessment

### 1. Is connectivity clearly distinct from coordination and transport?

**Yes. The distinctions are crisp and well-anchored.**

The spec draws three explicit boundaries:

- **vs coordination**: "Coordination owns who is doing what. Connectivity owns what minimal signals move between those participants while work is in progress."
- **vs routing**: "Routing chooses the operating envelope. Connectivity adapts internal communication policy inside that envelope."
- **vs transport**: "Relay transport answers how something is delivered. Connectivity answers why a signal exists, who should receive it, how urgent it is, and when it can be dropped."

Each distinction is stated with concrete examples on both sides. There is no meaningful overlap or ambiguity in what each package owns. The layering model — transport below, routing alongside, coordination alongside, product specialists above — is internally consistent across the README, spec, adoption guide, and research doc.

The only area that could use sharper treatment is the API surface between connectivity and coordination. The spec says connectivity sits "beside" coordination but does not define the call direction. Does coordination call into connectivity to emit signals? Does connectivity call coordination to resolve conflicts? That interaction boundary needs a sentence in the spec before implementation begins.

---

### 2. Is the neural-style framing practical rather than fluffy?

**Yes. The vocabulary is grounded, not decorative.**

The five message classes — attention, confidence, conflict, handoff, escalation — could sound abstract in isolation. They are not abstract here. Every class has concrete product examples immediately attached:

- attention: "memory lookup finds high-salience context"
- confidence: "high confidence: ready for synthesis / blocker uncertainty: do not finalize yet"
- conflict: "memory says one thing, live evidence says another"
- handoff: "partial result ready / blocked pending more scope"
- escalation: "policy risk / deadline risk / invalid plan"

The focused-coordination-vs-generic-chatter distinction is not cosmetic framing. It is actionable design guidance: narrowcast over broadcast, delta over transcript, explicit urgency over inferred urgency. The adoption guide translates this into concrete behavioral before/after comparisons that a product team can act on directly.

The TypeScript `ConnectivitySignal` type in the spec grounds the conceptual model in a real artifact. The combination of vocabulary + examples + type definition is enough for an engineer to understand what a signal is and what it is not.

No concerns with fluffy framing here.

---

### 3. Is the package useful for Sage, MSD, and NightCTO specifically?

**Yes. The fit is differentiated per product, not generic.**

Each product has a dedicated usage section in the README, spec, adoption guide, and research doc, and the guidance is meaningfully different for each:

**Sage** — the primary coordination need is memory-to-synthesis attention and proactive-to-synthesis handoff without over-notifying. The recommended first workflows are correctly scoped: emit attention only when retrieved context materially changes interpretation, emit handoff.blocked instead of interrupting with speculative follow-up.

**MSD** — the primary need is structured review feedback that does not become free-form internal chat. The conflict-detection and handoff-ready patterns map cleanly to reviewer-to-planner and planner-to-composer flows. The guidance that notifiers subscribe only to terminal or escalation-grade signals is specific and correct.

**NightCTO** — the primary challenge is many-specialist coordination under one identity. The research doc correctly identifies consensus compression as the dominant pattern for NightCTO that the other two products need less. The guidance that specialists narrowcast to coordinator by default and that urgency interrupts without waiting for the next synthesis cycle directly addresses the coordination failure mode specific to many-specialist operation.

The product sections avoid being generic rewrites of each other. Each one describes a real coordination problem and maps it to specific signal classes.

---

### 4. Are the docs detailed enough to become implementation specs next?

**Mostly yes. The conceptual foundation is complete. Several concrete decisions need to be locked before code is written.**

What is already spec-ready:

- the five message classes and illustrative signal subtypes
- the `ConnectivitySignal` type shape (noted as illustrative but well-formed)
- the four audience semantics (`self`, `coordinator`, `selected`, `all`) with a clear default recommendation
- the four workflow shapes (narrowcast, escalation, conflict, handoff) with step-by-step outlines
- the routing-mode policy matrix (cheap / fast / deep) with the non-negotiable fixed-quality-bar rule
- the staged implementation plan (types → policy helpers → dispatcher → workflow examples → tests)

What needs to be decided before writing implementation specs:

1. **Signal lifecycle** — the spec defines fields but not the state machine. What are the valid states (emitted → active → superseded → expired)? What triggers each transition? This is needed before suppression and replacement rules can be implemented.

2. **Suppression and replacement semantics** — the spec lists `replaces` as a field and mentions suppression windows but leaves both undefined. The open questions section asks "whether signal replacement should be explicit or inferred" and "what the default suppression window should be." These must be answered in the spec before code is written.

3. **`selected` audience resolution** — how does a sender specify the selected subset? By component name? By role? By capability tag? The spec defines the audience value but not the mechanism for declaring who is in the selection.

4. **Route-escalation hint contract** — the spec says connectivity should be able to request a deeper route when confidence is too low, but does not define the interface between connectivity and `@relay-assistant/routing`. This is a cross-package contract that needs to be defined jointly.

5. **Error handling** — what happens when a signal cannot be routed? When coordinator is unreachable? When a handoff.ready arrives but the downstream component has already finalized? Silence is not a safe default.

6. **Observability boundary** — what signal metadata belongs in OSS logging vs cloud-only pipelines? This affects what fields go in the base type vs adapter extensions.

---

### 5. What is still missing before this package is ready to move into specs/workflows/code?

**Six specific gaps, ordered by blocking risk:**

#### Gap 1: Signal lifecycle state machine (blocks suppression and replacement implementation)

The `replaces` field exists but the rules for when replacement is allowed, required, or forbidden are not defined. Define the lifecycle:

```
emitted → active → [superseded | expired | resolved]
```

Include: who can supersede a signal, what happens to downstream listeners that already consumed the original, whether coordinators must be notified of supersession.

#### Gap 2: Suppression window definition (blocks efficiency implementation)

The spec mentions suppressing repeated low-value signals "within a short window" but does not define the window. Before the first spec is written, define:

- the default suppression window for low-priority signals
- whether the window is step-based, time-based, or token-budget-based
- whether suppression can be overridden per signal class

#### Gap 3: `selected` audience resolution mechanism (blocks narrowcast implementation)

The spec defines the `selected` audience value but not how a sender identifies who is in the selection. This needs a concrete answer. Options to evaluate: named component IDs, capability tags, coordinator-managed role lists. Pick one for the first spec.

#### Gap 4: Connectivity-to-routing escalation interface (blocks route-escalation workflow)

The route-escalation hint workflow appears in the spec and adoption guide but the interface with `@relay-assistant/routing` is undefined. This is a cross-package contract. Before the escalation workflow spec is written, the routing package owner and the connectivity spec need to agree on:

- what signal or hook connectivity emits
- how routing receives and processes it
- what feedback, if any, routing sends back

#### Gap 5: Coordination-connectivity interaction boundary (blocks integration with coordination package)

The spec says connectivity sits "beside" coordination but does not define the call direction or contract. Does coordination invoke connectivity to emit signals? Does connectivity surface conflict signals to coordination for resolution? A single diagram or table of owned interfaces would close this gap.

#### Gap 6: First four concrete workflow specs (prerequisite for workflow stage)

The spec identifies the four first workflows:
1. narrowcast attention
2. reviewer conflict escalation
3. specialist handoff ready
4. blocker uncertainty requesting deeper routing

These are named but not yet written as workflow specs. The gap here is not that the workflows are wrong — they are the right four — but that each needs to be written as a full step-by-step spec with signal types, audience choices, error conditions, and expected coordinator behavior before any implementation begins.

---

## Summary

The connectivity package spike is well-conceived and internally consistent. The conceptual foundation — message classes, signal envelope, routing-mode policy, focused-coordination-vs-chatter — is sound and can move into implementation specs without rethinking the design. The product fit for Sage, MSD, and NightCTO is specific and differentiated. The framing is practical.

The six gaps above are not design problems. They are decisions that the spike correctly deferred to the spec stage but that must be made before the spec can be called complete. None of them require revisiting the core thesis.

Recommended next steps:

1. Write the signal lifecycle state machine as a section addition to the existing spec.
2. Define suppression window and replacement semantics as a named subsection.
3. Resolve the `selected` audience mechanism with the coordination package owner.
4. Define the connectivity-to-routing escalation interface jointly with the routing package owner.
5. Write the four first workflow specs as separate documents under `docs/workflows/`.
6. Update `docs/index.md` to reference the workflow specs when they exist.

---

CONNECTIVITY_REVIEW_COMPLETE
