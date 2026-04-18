# Agent Assistant Improvement Protocol Note

This note captures the bounded, reusable part of the recent “self-evolving agent protocol” paper that is actually worth adopting into Agent Assistant.

## Why this note exists

The paper’s strongest useful idea is not unconstrained self-modification. It is the claim that agent systems benefit from an explicit, auditable improvement lifecycle instead of ad hoc glue, hidden prompt drift, and undocumented runtime mutation.

Agent Assistant already has many of the right ingredients:

- bounded workflows
- proof plans
- review verdicts
- package seams
- relay-native specialist collaboration
- explicit turn-context and policy boundaries

What is missing is a first-class substrate for **improvement proposals** as a runtime and architecture concept.

## Recommendation

Agent Assistant should adopt a bounded **improvement proposal protocol**, not a broad autonomous self-evolution protocol.

The protocol should make it possible for an assistant, specialist, workflow, or product runtime to:

1. identify a capability or behavior gap
2. describe a proposed improvement in a structured way
3. define required validation and evidence
4. carry a review/adoption decision
5. preserve rejection/defer outcomes instead of silently mutating behavior

This should remain explicitly compatible with the project’s existing discipline:

- workflow-generated candidate changes
- deterministic validation gates
- reviewable artifacts
- human-controlled adoption

## What not to adopt

Agent Assistant should not adopt:

- unconstrained self-modification in production
- hidden prompt or tool mutations without explicit evidence
- a monolithic protocol that collapses turn-context, policy, execution, inbox, and Relay-native coordination into one abstraction
- any improvement path that bypasses review, evidence, or reproducibility

In Agent Assistant, “self-improvement” should mean **protocolized improvement proposals**, not autonomous runtime mutation.

## Proposed primitive

Add a new bounded architecture concept: **Improvement Proposal**.

This can begin as a spec/package-level contract before any runtime automation is added.

### Core shape

An improvement proposal should minimally capture:

- `proposalId`
- `source`
  - user request
  - workflow finding
  - specialist finding
  - runtime observation
  - proactive audit
- `target`
  - package
  - assistant runtime seam
  - specialist
  - workflow
  - product integration
- `gap`
  - what is missing, broken, weak, or under-specified
- `proposedChange`
  - bounded textual or structured remediation description
- `artifacts`
  - links/paths to evidence, diffs, trajectories, relayfile manifests, logs, benchmarks
- `validationPlan`
  - exact tests, commands, proof gates, or expected behavioral checks
- `riskClass`
  - docs-only, bounded code, package seam, runtime behavior, external side effect
- `decision`
  - proposed
  - in_review
  - accepted
  - rejected
  - deferred
  - superseded
- `decisionRationale`
- `supersedes` / `supersededBy`

## Where it fits in Agent Assistant

This proposal protocol fits best as a cross-cutting architecture seam above existing primitives, not as a replacement for them.

### Relationship to continuation

Continuation answers: how does work resume over time?

Improvement proposals answer: what candidate change is being carried through that continuation?

A continuation may execute an improvement program, but the proposal is the object being tracked.

### Relationship to proactive

Proactive systems can originate improvement proposals from:

- recurring failures
- stale review debt
- repeated operator interventions
- drift between documented and actual behavior

But proactive should not auto-adopt changes. It should emit or advance proposals.

### Relationship to specialists

Specialists can produce structured findings that become proposal inputs.

Examples:

- GitHub specialist identifies recurring PR review failures
- observability specialist identifies repeated runtime instability
- routing specialist identifies misrouted turn classes

The proposal protocol gives those findings a reusable path into bounded improvement work.

### Relationship to relayfile

Relayfile should remain the durable evidence substrate when proposal evidence must be shared, preserved, or handed across agents/runs.

Improvement proposals should reference durable evidence rather than treating chat context as the source of truth.

### Relationship to workflows

This is the most immediate payoff.

Today, workflows already approximate an improvement lifecycle. The proposal protocol would make that lifecycle explicit and portable:

- specify proposal
- implement bounded change
- validate
- review
- adopt or reject

This would reduce hidden process knowledge and make workflow-generated improvements more reusable across products.

## Suggested bounded rollout

### Slice 1: Architecture/spec only

Add a docs-first architecture note and a lightweight spec for `ImprovementProposal`.

Goal:
- lock the shape and lifecycle
- keep implementation out until the contract is clear

### Slice 2: Workflow artifact integration

Allow workflows to emit a proposal artifact alongside review verdicts.

Goal:
- make proposal output explicit
- avoid changing runtime behavior yet

### Slice 3: Specialist finding to proposal bridge

Define one bounded bridge where a specialist result can be normalized into an improvement proposal draft.

Goal:
- prove that reusable findings can seed reusable improvement programs

### Slice 4: Optional package/runtime support

Only after the above is stable, consider whether Agent Assistant needs a dedicated package such as:

- `@agent-assistant/improvement`
- or a narrower addition under continuation/coordination

This should happen only if the shape proves genuinely reusable across products.

## Why this matters

Agent Assistant already has strong opinions about:

- canonical ingress through turn-context
- policy as a separate gate
- execution backend choice as a separate concern
- Relay-native collaboration as the default multi-agent model
- bounded workflow-first validation for important slices

The missing piece is a canonical way to represent **improvement work itself**.

A bounded improvement proposal protocol would:

- reduce hidden process glue
- make improvement programs more transferable across Sage, NightCTO, and future assistants
- preserve auditability
- keep human review in the loop
- capture the useful part of “self-evolving agents” without importing the risky part

## Recommendation summary

Adopt the paper’s best idea in a constrained form:

- **yes** to explicit improvement lifecycle and structured proposal state
- **yes** to auditable validation-gated evolution
- **no** to unconstrained autonomous self-modification
- **no** to monolithic protocol collapse

The right Agent Assistant move is a first-class **Improvement Proposal** architecture seam.
