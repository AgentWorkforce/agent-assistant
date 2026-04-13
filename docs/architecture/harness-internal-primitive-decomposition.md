# Harness Internal Primitive Decomposition

**Date:** 2026-04-13  
**Package:** `@agent-assistant/harness`  
**Purpose:** Clarify the internal sub-primitives inside the bounded turn executor so the package can stay narrow without pretending it is one indivisible blob.

---

## Executive summary

The recent runtime primitive map correctly narrowed `@agent-assistant/harness` to **the bounded turn executor**, not the whole assistant runtime.

That clarification creates a second question:

> inside the harness package itself, what are the real internal primitives?

The answer is: the package is still one coherent package, but it is not just “a loop.”
It already contains a small set of tightly-coupled internal sub-primitives that together make one bounded turn executable, inspectable, and resumable.

The current implementation and spec support the following internal decomposition:

1. **Turn loop controller**
2. **Model step contract**
3. **Tool orchestration layer**
4. **Outcome and stop-semantics engine**
5. **Continuation/resume contract**
6. **Trace and usage accounting layer**
7. **Approval seam**
8. **Config/limits/clock normalization layer**
9. **Execution-state and transcript shaping layer**

These are real internal sub-primitives.
They are useful for architecture and implementation reasoning.
But they are **not yet strong enough to justify package splitting**.

The key judgment is:

> `@agent-assistant/harness` should stay one package for now because these sub-primitives are all in service of one bounded-turn contract and currently share a single lifecycle, transcript, result model, and stop-semantics core.

---

## 1. What this document is and is not

This document is about the **internal decomposition of `@agent-assistant/harness` itself**.

It is **not** a re-argument of the higher-level runtime primitive map.
That higher-level decomposition is already established:
- harness = bounded turn executor
- turn-context = assembly above harness
- policy = governance outside harness
- traits = stable identity floor
- product logic = product-owned

This document asks a narrower question:

> once we accept that harness is the bounded turn executor, what are the internal building blocks inside that executor?

---

## 2. Reading of the current boundary and implementation

Across the current package boundary/spec/docs and implementation, the package consistently owns:
- one bounded turn
- iterative model → tool → model execution
- truthful stop reasons
- continuation payloads for clarification/approval/deferred states
- per-turn trace lifecycle
- adapter seams for model, tools, approvals, and trace sinks

The implementation in `packages/harness/src/harness.ts` is especially useful because it shows the package’s natural internal seams already, even though they are still mostly implemented in one file.

That file already has distinct logic for:
- config normalization and validation
- state initialization
- per-iteration limit checks
- model invocation
- tool request handling
- invalid-output handling
- limit-result construction
- continuation creation
- transcript summarization
- usage accumulation
- trace emission
- final result shaping

So the decomposition below is not speculative. It is already visible in the code.

---

## 3. Internal sub-primitives inside `@agent-assistant/harness`

## A. Turn loop controller

### What it is
The top-level bounded execution driver for one turn.

### Current implementation footprint
Primarily the `runTurn()` function in `packages/harness/src/harness.ts`.

### Owns
- one invocation of `runTurn(input)`
- iteration progression
- loop entry/exit
- ordering of model step → branch → tool execution → next model step
- integration of limit checks into loop progression
- final return of exactly one `HarnessResult`

### Does not own
- turn-context assembly
- tool definitions themselves
- policy decisions
- product-specific prompt shaping
- session persistence

### Why it is a real sub-primitive
This is the orchestration spine of the package.
Without it, the other harness concerns do not compose into a bounded turn.

### Why it should stay inside the package
It is the center of gravity for the entire package boundary.
Splitting it out now would not create a reusable independent primitive; it would just create a control-flow shell that still depends on every other harness concern.

---

## B. Model step contract

### What it is
The harness-owned boundary between the turn executor and a model adapter.

### Current implementation footprint
Public types in `packages/harness/src/types.ts`:
- `HarnessModelAdapter`
- `HarnessModelInput`
- `HarnessModelOutput`
- output variants such as `final_answer`, `tool_request`, `clarification`, `approval_request`, `refusal`, `invalid`

Runtime use in `runTurn()` when calling `config.model.nextStep(modelInput)` and branching on output type.

### Owns
- the bounded vocabulary of what the model may return to the harness
- the data the harness provides to the model at each step
- iteration-aware interaction shape
- transcript + available-tools exposure to the model

### Does not own
- provider-specific SDK calls
- routing/model selection
- prompt assembly above `HarnessInstructions` and `HarnessPreparedContext`
- product-specific reasoning conventions

### Why it is a real sub-primitive
This is more than a helper type.
It is the harness’s internal decision grammar.
The turn loop only works because model outputs are normalized into a finite set of harness-owned next-step types.

### Why it should stay inside the package
The model step contract only makes sense in combination with harness stop semantics, transcript rules, and tool orchestration.
Pulled out too early, it would become either:
- a generic model protocol that is too weak to be useful, or
- a harness-specific protocol living outside harness for no gain.

---

## C. Tool orchestration layer

### What it is
The internal machinery that turns model-requested tool calls into bounded, typed, traceable execution inside the turn.

### Current implementation footprint
Public contracts in `types.ts`:
- `HarnessToolRegistry`
- `HarnessToolDefinition`
- `HarnessToolCall`
- `HarnessToolExecutionContext`
- `HarnessToolResult`
- `HarnessToolError`

Runtime handling in `runTurn()`:
- tool availability resolution
- unavailable-tool failure path
- sequential tool execution
- transcript insertion of tool results
- retryable vs unrecoverable tool error handling

### Owns
- listing tools available for this turn
- validation that requested tools exist
- enforcement of tool-call limits
- execution sequencing in v1
- normalization of tool results into transcript-usable state
- handoff back into the next model step

### Does not own
- tool implementation logic
- per-product tool inventories
- policy rules for when a tool should exist
- broader workflow orchestration beyond the current turn

### Why it is a real sub-primitive
Tool execution is not incidental behavior.
It is a first-class internal primitive because it has its own contracts, counters, error model, and trace lifecycle.

### Why it should stay inside the package
The tool layer is deeply coupled to:
- the turn loop
- stop semantics
- transcript accumulation
- usage accounting
- trace events

A separate package would be justified only if tool orchestration needed to serve multiple non-harness runtimes with the same contract. That is not true today.

---

## D. Outcome and stop-semantics engine

### What it is
The harness-owned truthfulness layer that converts step-level events into a final turn outcome and stop reason.

### Current implementation footprint
Public types:
- `HarnessOutcome`
- `HarnessStopReason`
- `HarnessResult`

Runtime helpers and branches:
- `buildResult()`
- `buildLimitResult()`
- `handleInvalidOutput()`
- refusal/tool-unavailable/tool-error/runtime-error branches

### Owns
- the distinction between `completed`, `needs_clarification`, `awaiting_approval`, `deferred`, and `failed`
- truthful stop reasons
- when a condition is a bounded stop versus a hard failure
- whether an assistant message is attached
- shaping the final `HarnessResult`

### Does not own
- UI mapping for those outcomes
- policy meaning of approvals
- product-facing copy beyond what the model already produced

### Why it is a real sub-primitive
This is the package’s most important semantic layer after the loop itself.
It is the reason the package is a bounded turn executor instead of a thin “run model and maybe tools” helper.

### Why it should stay inside the package
Splitting this from harness would split the package’s core truthfulness contract away from the code that actually executes the turn.
That would weaken the boundary instead of sharpening it.

---

## E. Continuation and resume contract

### What it is
The compact turn-resumption contract the harness emits when a turn stops in a resumable state.

### Current implementation footprint
Public types:
- `HarnessContinuation`
- `HarnessPreparedApproval`
- continuation-bearing `HarnessResult`

Runtime helpers:
- `createContinuation()`
- transcript summarization via `summarizeTranscript()`
- continuation creation for clarification, approval, and deferred states

### Owns
- the bounded shape of resumable turn state
- continuation types: `clarification`, `approval`, `deferred`
- creation of resume tokens and minimal state payloads
- transcript compaction for continuation state

### Does not own
- persistence of continuation state
- approval storage systems
- session lifecycle
- cross-turn memory storage

### Why it is a real sub-primitive
Continuation is one of the package’s defining differentiators.
It is not just metadata; it is the formal contract for truthful resumption after bounded stops.

### Why it should stay inside the package
The continuation contract only has meaning relative to the harness transcript, stop semantics, and loop state.
A separate package would likely become a thin type bucket with no independent value.

---

## F. Trace and usage accounting layer

### What it is
The per-turn observability layer that makes the harness inspectable.

### Current implementation footprint
Public types:
- `HarnessTraceSink`
- `HarnessTraceEvent` variants
- `HarnessTraceSummary`
- `HarnessUsage`
- `HarnessAggregateUsage`

Runtime helpers:
- `emit()`
- `emitFinishedSafely()`
- `accumulateUsage()`
- `buildTraceSummary()`

### Owns
- the trace event schema for harness execution
- lifecycle emission points
- basic aggregated usage accumulation across model and tool steps
- final trace summary included in results

### Does not own
- log shipping backends
- dashboards
- hosted observability infrastructure
- cross-package analytics conventions beyond the harness event contract

### Why it is a real sub-primitive
Traceability is part of the package boundary, not an optional afterthought.
The docs explicitly treat inspectability as package-owned.

### Why it should stay inside the package
The trace model is tightly synchronized with harness events and state transitions.
Separating it now would mostly add indirection without unlocking reuse.

---

## G. Approval seam

### What it is
The adapter boundary that lets the harness stop in `awaiting_approval` without absorbing policy ownership.

### Current implementation footprint
Public types:
- `HarnessApprovalAdapter`
- `HarnessApprovalRequestInput`
- `HarnessApprovalRequest`
- `HarnessPreparedApproval`

Runtime path in `runTurn()`:
- branch on `approval_request`
- call `approvals.prepareRequest(...)` when present
- otherwise synthesize a continuation directly

### Owns
- expressing that the model/runtime has reached an approval-blocked step
- preparing a continuation-bearing approval result
- keeping approval as a bounded runtime seam instead of silent product glue

### Does not own
- action classification
- risk policy
- allow/deny decisions
- audit ownership
- approval UX

### Why it is a real sub-primitive
This is an important seam because it protects the harness boundary from policy sprawl while still making approval-blocked turns first-class.

### Why it should stay inside the package
It is not a separate approval system.
It is the harness-facing adapter slice of the turn executor.
That makes it an internal harness sub-primitive, not an independent package.

---

## H. Config, limits, and clock normalization layer

### What it is
The package-internal setup layer that turns raw config into a valid executable harness runtime.

### Current implementation footprint
- `createHarness()`
- `normalizeConfig()`
- `validatePositiveInteger()`
- default limits and default clock

### Owns
- validation of adapter presence/shape
- default bounded limits
- default clock behavior
- budget/limit normalization
- fail-fast config errors via `HarnessConfigError`

### Does not own
- runtime routing decisions
- persona config selection
- product-specific defaults

### Why it is a real sub-primitive
This is the construction-time integrity layer for the package.
It keeps the runtime contract honest before a turn ever starts.

### Why it should stay inside the package
It is an implementation-support primitive for the harness package, not a reusable runtime primitive in its own right.

---

## I. Execution-state and transcript shaping layer

### What it is
The internal state model the harness uses to make step-by-step execution resumable, traceable, and inspectable.

### Current implementation footprint
- `MutableState`
- `executionState()`
- `toAssistantStep()`
- `summarizeTranscript()`
- transcript item types in `types.ts`

### Owns
- mutable counters for iteration/tool calls/invalid outputs
- transcript accumulation
- transformation of model outputs into transcript items
- compact execution-state snapshots for hooks
- compact transcript summaries for continuation state

### Does not own
- raw conversation history persistence
- session storage
- broader turn-context assembly

### Why it is a real sub-primitive
This is the harness’s internal memory of the current turn.
Without it, the loop, continuation, and trace layers cannot function coherently.

### Why it should stay inside the package
The transcript/state layer is specific to harness execution semantics.
It is not yet a reusable primitive outside this package.

---

## 4. How these sub-primitives fit together

The important structural point is that these are **adjacent internal primitives with one shared center of gravity**.

A useful dependency reading is:

1. **Config/limits/clock normalization** makes a valid runtime
2. **Turn loop controller** runs the bounded turn
3. **Model step contract** defines possible next-step outputs
4. **Tool orchestration** executes requested actions inside the turn
5. **Execution-state/transcript shaping** records the evolving turn state
6. **Outcome/stop semantics** decide truthful end states
7. **Continuation contract** captures resumable state when needed
8. **Trace/usage** makes all of the above inspectable
9. **Approval seam** plugs into stop semantics without absorbing policy ownership

That is one coherent package architecture.
It is not a random pile of helpers.

---

## 5. What should stay together

The following should stay together inside `@agent-assistant/harness` for now:

### Keep together as one package core
- turn loop controller
- model step contract
- tool orchestration layer
- outcome and stop-semantics engine
- continuation/resume contract
- execution-state/transcript shaping
- trace lifecycle tied to harness execution
- approval seam as a harness-facing adapter
- config/limit normalization

### Why these belong together
They all share the same:
- lifecycle: one bounded turn
- central state: transcript, iteration count, tool count, usage
- public result contract: `HarnessResult`
- truthfulness contract: outcome + stop reason
- resumption contract: `HarnessContinuation`
- execution-specific event schema: harness trace events

If these were split into separate packages today, each package would still be mostly defined by the same single runtime contract and same single state machine.
That is not a strong package split; that is mostly moving files around.

---

## 6. What should not yet split into separate packages

## Do not split out a standalone “tool runner” package yet

Why not:
- the orchestration contract is harness-specific
- the tool transcript/result semantics are defined relative to the harness loop
- there is no evidence yet of reuse by non-harness runtimes

## Do not split out a standalone “continuation” package yet

Why not:
- continuation semantics are not generic workflow continuations
- they are specifically bounded-turn harness resumptions
- the shape is derived from harness transcript and stop reasons

## Do not split out a standalone “trace” package yet

Why not:
- the trace schema is tightly coupled to harness lifecycle events
- general observability infra belongs elsewhere, but harness event semantics belong here

## Do not split out a standalone “approval bridge” package yet

Why not:
- the approval seam here is intentionally narrow
- the actual reusable primitive is policy, not a separate approval helper beneath it
- this harness slice is just the executor-facing handoff

## Do not split out a standalone “state machine” package yet

Why not:
- the state machine is almost definitionally the harness itself
- package extraction would create ceremony without real ownership separation

---

## 7. What should remain external inputs to the harness package

The harness package should continue to **consume** these concerns, not own them.

## A. Turn-context assembly
Own externally:
- `HarnessInstructions`
- `HarnessPreparedContext`
- future `@agent-assistant/turn-context` assembly

Why external:
- this is the upstream visible-turn preparation seam
- if pulled into harness, “harness” becomes the umbrella term again

## B. Policy and governance logic
Own externally:
- risk classification
- allow/deny/require-approval decisions
- audit storage
- product approval UX

Why external:
- harness should stop at `awaiting_approval`, not decide governance policy

## C. Product logic and domain behavior
Own externally:
- prompt strategy
- business rules
- tool inventory decisions
- workspace semantics
- outcome-to-UX mapping

Why external:
- this is product intelligence, not reusable bounded-turn execution

## D. Tool implementations and product tool catalogs
Own externally:
- concrete tool code
- product-specific availability heuristics
- auth/provider integrations

Why external:
- harness orchestrates tools; it does not define them

## E. Routing and persona selection
Own externally:
- model selection
- execution tier choice
- workforce persona content
- harness settings selection

Why external:
- harness runs with the chosen envelope; it does not choose the envelope

## F. Session persistence and long-term memory
Own externally:
- session identity/lifecycle
- durable continuation storage
- long-term memory retrieval/promotion

Why external:
- harness owns one bounded turn, not the cross-turn continuity system

---

## 8. Signs that would justify future package splitting

The right bar for future splitting is not “we can name sub-parts.”
The right bar is “a sub-part has become a reusable primitive with its own clean ownership boundary.”

### Split signal 1 — multiple runtimes need the same tool orchestration contract
If a non-harness runtime also needs:
- the same tool request format
- the same tool result model
- the same execution context
- the same retryability/error semantics

then a shared lower-level tool-execution package might become justified.

### Split signal 2 — continuation becomes a cross-runtime contract
If multiple packages need the same resumable-step contract independent of harness, continuation logic may deserve its own package or a shared runtime contract module.
Today it is still too harness-specific.

### Split signal 3 — trace schema needs independent consumers beyond harness lifecycle
If the trace model becomes a shared execution observability contract used by harness, proactive, coordination, and other runtimes with one common event vocabulary, then a broader runtime-trace package could be justified.
Today the schema is specifically harness lifecycle trace.

### Split signal 4 — approval preparation becomes a generic runtime-governance adapter used everywhere
If several runtime packages all need the same approval-preparation bridge with identical correlation/continuation behavior, that seam may deserve extraction.
Today the stronger primitive remains `@agent-assistant/policy`, not a sub-package under harness.

### Split signal 5 — harness internals need independent release cadence or ownership
If one internal area starts changing on a materially different schedule, with separate tests, maintainers, and external consumers, that is evidence of a real package boundary.
No such evidence exists yet.

### Split signal 6 — the current public types become overloaded across unrelated use cases
If `HarnessTool*`, `HarnessContinuation`, or `HarnessTrace*` types start being imported broadly by packages that do not otherwise need the bounded turn executor, that suggests a shared-contract extraction might help.
That is not yet the dominant pattern.

---

## 9. Recommended internal code organization, without package splitting

The package should likely remain one package but can become internally clearer by organizing around these sub-primitives.

A reasonable future internal structure would be something like:

- `src/harness.ts` — public factory and top-level assembly
- `src/loop/` — turn loop controller and limit checks
- `src/model/` — model input/output shaping helpers
- `src/tools/` — tool orchestration helpers
- `src/outcomes/` — result builders and stop semantics
- `src/continuation/` — continuation creation and transcript summarization
- `src/trace/` — event emission and trace summary helpers
- `src/state/` — mutable execution state and transcript shaping
- `src/config/` — normalization and validation
- `src/types.ts` — public contracts

That would improve maintainability without prematurely multiplying packages.

---

## 10. Practical judgment: should harness stay one package for now?

## Yes.

### Reason 1 — one bounded-turn ownership center
All current internal sub-primitives exist to implement exactly one product-facing contract:
- `createHarness(config)`
- `runTurn(input)`
- `HarnessResult`

### Reason 2 — shared semantics are stronger than the internal separations
The sub-primitives are real, but they are not independent enough yet.
Their contracts are defined by shared execution semantics more than by separate ownership domains.

### Reason 3 — premature package splitting would create false modularity
Splitting now would likely produce packages that:
- still depend on each other almost completely
- expose harness-specific contracts outside harness
- increase versioning/import complexity
- make the architecture look cleaner on paper than it is in reality

### Reason 4 — the bigger missing seam is above harness, not inside it
The repo’s real missing primitive is still the turn-context/enrichment seam above harness.
That external clarification matters more than internal package fission right now.

---

## 11. Recommended next step after this clarification

The recommended next move is:

> keep `@agent-assistant/harness` as one package, but explicitly document and optionally refactor its internals around the sub-primitives above while focusing cross-package work on the upstream `turn-context` seam rather than splitting harness.

Concretely:

1. **Keep the package boundary unchanged**
   - harness remains the bounded turn executor

2. **Use this internal decomposition as the implementation map**
   - helps future work avoid re-overloading “harness” even inside the package

3. **Refactor internally only if implementation pressure appears**
   - move helpers into internal modules when file size or test targeting warrants it
   - do not create new published packages yet

4. **Continue clarifying external seams instead of internal package multiplication**
   - especially `turn-context`
   - and, later, clearer policy/memory integration examples around harness

---

## Final verdict

`@agent-assistant/harness` is best understood as **one package containing several tightly-coupled internal execution sub-primitives**.

The most important internal sub-primitives are:
- turn loop controller
- model step contract
- tool orchestration layer
- outcome and stop-semantics engine
- continuation/resume contract
- trace and usage accounting layer
- approval seam
- config/limits/clock normalization layer
- execution-state and transcript shaping layer

These should be treated as real internal architecture.
But they should **not** be split into separate packages yet.

The package should stay one package for now because its internal pieces still form one coherent bounded-turn runtime rather than multiple independently reusable runtime primitives.

HARNESS_INTERNAL_PRIMITIVE_DECOMPOSITION_READY
