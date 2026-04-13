# Harness Package Boundary Review

**Date:** 2026-04-13  
**Package:** `@agent-assistant/harness`  
**Purpose:** Review whether the current harness package should remain one package after clarifying its internal sub-primitives.

---

## Executive verdict

`@agent-assistant/harness` should **stay one package for now**.

That recommendation is not because the package is simple.
It is because the package’s internal sub-primitives are still all part of one coherent bounded-turn runtime contract.

The package now has a clearer internal decomposition:
- turn loop controller
- model step contract
- tool orchestration
- outcome/stop semantics
- continuation contract
- trace/usage layer
- approval seam
- config/limit normalization
- execution-state/transcript shaping

Those are meaningful internal architecture slices.
But they do **not yet justify publishing multiple packages** because they still share:
- one lifecycle
- one transcript/state model
- one result contract
- one truthfulness boundary
- one continuation model
- one turn-scoped execution responsibility

So the right move is:

> keep one package, clarify the internals, and resist premature package fission.

---

## 1. What changed since the earlier harness framing

The repo previously needed a bigger clarification first:

> “harness” should not mean the whole assistant runtime.

That clarification is now in place across the runtime primitive map and adjacent docs.
Harness is the **bounded turn executor**.

Once that external boundary became crisp, the remaining ambiguity moved inward:

> is the harness package itself actually several smaller runtime primitives in disguise?

After reviewing the current docs, spec, and implementation, the answer is:
- **yes**, there are multiple internal execution sub-primitives
- **no**, they should not yet become separate published packages

That is the key package-boundary judgment.

---

## 2. What the package clearly owns today

The current boundary/spec/implementation consistently support the package owning:
- one bounded turn
- iterative model/tool/model execution
- turn-scoped tool mediation
- truthful stop reasons
- structured `HarnessResult`
- compact continuation payloads
- trace lifecycle for the turn
- approval-blocked stop handling via adapter seam

This is a strong package boundary.
It is already narrow enough at the runtime-stack level.

The remaining question is therefore only whether the inside of this package has matured into multiple separately-owned publishable primitives.
Current evidence says not yet.

---

## 3. Internal sub-primitives identified

## A. Turn loop controller
Owns execution order and bounded progression for one turn.

## B. Model step contract
Owns the normalized grammar of model outputs and the step input contract.

## C. Tool orchestration layer
Owns per-turn tool availability, validation, execution sequencing, result handling, and tool-specific error paths.

## D. Outcome and stop-semantics engine
Owns the truthfulness contract for outcomes and stop reasons.

## E. Continuation contract
Owns resumable bounded-turn payloads for clarification, approval, and deferred states.

## F. Trace and usage layer
Owns execution event schema, lifecycle emission, trace summary, and aggregated usage accounting.

## G. Approval seam
Owns the executor-facing handoff for approval-blocked turns without absorbing policy ownership.

## H. Config/limits/clock normalization
Owns construction-time validation and bounded runtime defaults.

## I. Execution-state/transcript shaping
Owns the internal state model that lets the turn remain inspectable and resumable.

These are the right internal architectural units for implementation thinking.
But they remain one package-level responsibility.

---

## 4. Why the package should stay together

## Reason 1 — one user-facing contract dominates the internal structure

The package exposes a single coherent public story:
- create a harness runtime
- run one bounded turn
- receive one truthful result

The internal slices are all subordinate to that one contract.
That is a strong sign of one package, not many.

## Reason 2 — the sub-primitives share one central state machine

These internal areas all depend on the same turn-scoped state:
- iteration count
- tool call count
- transcript
- usage totals
- current stop context
- continuation summary

That shared state machine is the package.
A package split would be artificial unless that state begins to separate naturally.

## Reason 3 — the contracts are highly interdependent

Examples:
- tool orchestration depends on transcript semantics, stop semantics, trace events, and usage aggregation
- continuation depends on transcript shaping and outcome semantics
- approval handling depends on continuation semantics and final-result shaping
- trace emission depends on the same lifecycle boundaries the loop controller owns

These are real separations of concern, but not yet independent ownership domains.

## Reason 4 — there is no demonstrated reuse outside harness yet

No internal slice currently shows strong evidence of being reused by:
- proactive runtime
- coordination runtime
- routing
- policy
- other assistant execution packages

Without demonstrated reuse and stable external consumers, package extraction would be mostly theoretical.

## Reason 5 — the repo’s bigger architectural need is above harness

The sharper missing seam is still the upstream turn-context/enrichment assembly layer.
That is the area where packaging clarity will actually reduce architecture confusion right now.
Internal harness splitting would be a lower-value move.

---

## 5. Why not split now

## Do not split a separate tool package yet
Because current tool orchestration is still specifically “tool execution inside a bounded harness turn,” not a generally reusable runtime primitive.

## Do not split a continuation package yet
Because the continuation model is specifically the harness resume contract, not a generic workflow continuation system.

## Do not split a trace package yet
Because current trace events are the harness lifecycle schema, not a cross-runtime execution event system.

## Do not split an approval-bridge package yet
Because the reusable abstraction is still policy at the higher layer; the harness approval seam is the executor-facing subset.

## Do not split a state-machine package yet
Because the state machine is essentially the harness itself.

---

## 6. What should stay external to the package

To keep the harness package healthy, these concerns should remain outside it:

### External input 1 — turn-context assembly
- instructions assembly
- prepared context assembly
- memory/context enrichment selection
- identity/runtime-expression composition

### External input 2 — policy ownership
- action classification
- allow/deny/approval decisions
- audit systems
- approval UX and product workflow

### External input 3 — product intelligence
- domain prompts
- business rules
- workspace semantics
- outcome-to-UX mapping
- commercial logic

### External input 4 — tool definition and implementation
- concrete tool code
- auth/provider handling
- domain-specific availability heuristics

### External input 5 — routing and persona selection
- model selection
- execution tier choice
- workforce persona ownership

### External input 6 — sessions and durable memory
- session lifecycle
- continuation persistence
- cross-turn memory storage/retrieval

Keeping these external matters more than internal harness splitting.
That is the real protection against harness becoming the umbrella abstraction again.

---

## 7. What future signs would justify package splitting

The package should only split when one internal slice becomes a real reusable primitive with its own boundary.

### Split trigger A — cross-runtime reuse
If one harness-internal slice starts serving multiple packages with the same contract, that is real split pressure.

### Split trigger B — independent ownership/lifecycle
If a slice develops distinct maintainers, release cadence, tests, and external consumers, it may deserve its own package.

### Split trigger C — stable lower-level contract emerges
If a lower-level contract becomes strong enough to stand on its own without the rest of the harness semantics, splitting becomes more plausible.

### Split trigger D — internal coupling materially decreases
If the turn loop no longer depends heavily on shared transcript/outcome/continuation semantics, that would indicate a stronger modular break than exists today.

### Split trigger E — public imports spread beyond harness use cases
If other packages begin importing `HarnessContinuation`, `HarnessTool*`, or `HarnessTrace*` types without actually depending on bounded turn execution, that may justify shared contract extraction.

Current repo evidence does not show those triggers strongly enough.

---

## 8. Recommended implementation posture now

## Recommendation
Keep `@agent-assistant/harness` as one published package, but treat the internal decomposition as the package’s implementation map.

### Practical next steps
1. Keep the current public naming and package boundary
2. Use the internal decomposition doc as a guide for future internal file/module refactors
3. Avoid exporting new lower-level public contracts unless real reuse appears
4. Put cross-package design energy into the upstream `turn-context` seam and product integration proof rather than internal package splitting

### Optional internal cleanup path
If the codebase grows, restructure **inside the package** around:
- `loop`
- `tools`
- `outcomes`
- `continuation`
- `trace`
- `state`
- `config`

That gets the clarity benefit without the package-cost penalty.

---

## 9. Final judgment

The harness package boundary is still the right one.

More specifically:

- **Harness is no longer the umbrella runtime concept.** Good.
- **Harness does contain several internal execution sub-primitives.** Also true.
- **Those sub-primitives should not yet be promoted to separate packages.** This is the important conclusion.

So the package-level recommendation is:

> keep `@agent-assistant/harness` as one bounded-turn package for now, make the internal decomposition explicit, and wait for real reuse or independent ownership signals before considering any split.

HARNESS_PACKAGE_BOUNDARY_REVIEW_READY
