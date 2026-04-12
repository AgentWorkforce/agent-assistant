# Connectivity Adoption Guide

Date: 2026-04-11

## Purpose

This guide explains when and how product teams should adopt `@agent-assistant/connectivity`.

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
