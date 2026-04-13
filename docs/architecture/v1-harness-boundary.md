# v1 Harness Boundary

**Date:** 2026-04-13
**Proposed package:** `@agent-assistant/harness`
**Purpose:** Define a bounded, product-grade assistant harness/runtime capability that adds iterative tool-use, clarification, continuation, and truthful stop semantics without expanding the SDK into a general autonomous agent framework.

---

## 1. Why this boundary exists

The current SDK has strong foundational packages for assistant assembly (`core`, `sessions`, `surfaces`, `traits`, `policy`, `proactive`) plus deeper packages for routing/coordination. What it does **not** yet provide is the reusable assistant-turn runtime that many real products need once a simple one-shot plan is no longer enough.

The specific gap is not "agents in general." It is narrower:

> Products like Sage need a reusable harness that can run a bounded assistant turn with iterative tool use, recover when the first attempt is incomplete, ask for clarification when needed, stop honestly when it cannot proceed, and leave behind a structured continuation/trace.

Without this layer, product code tends to hand-roll brittle pipelines such as:
- one-shot planner
- tool executor
- one-shot synthesizer

That pipeline fails structurally when the initial plan is wrong, partial, or blocked. The missing primitive is a bounded assistant harness, not a giant autonomy framework.

---

## 2. Placement recommendation

## Recommendation

Create a **new package**: `@agent-assistant/harness`

Do **not** extend `@agent-assistant/core` to absorb this behavior.

## Rationale

### Why not `core`

`@agent-assistant/core` is intentionally the thin composition root:
- assistant definition
- runtime lifecycle
- capability dispatch
- subsystem registry
- outbound emit

The proposed harness is meaningfully heavier. It introduces:
- iterative turn execution
- model/tool loop control
- stop-reason semantics
- continuation contracts
- trace/telemetry hooks
- bounded recovery behavior

Those concerns are not universal to every assistant assembled with `core`. Folding them into `core` would blur the repo's clean dependency story and turn the base runtime into an opinionated orchestration engine.

### Why a separate package is the right seam

A harness package can:
- depend on `core` types without forcing all `core` consumers to adopt iterative tool orchestration
- remain optional for products that still want a simple custom handler
- integrate with `sessions`, `policy`, `routing`, and `surfaces` at the product seam rather than hard-coding those packages into `core`
- evolve as a bounded runtime package without destabilizing the fundamental assistant-definition contract

### Placement rule

The harness belongs in the SDK layer because it is:
- reusable across products with different prompts/tools/adapters
- assistant-facing rather than transport-facing
- broader than one product's business logic

But it must remain **below** product-specific toolkits/workflows and **outside** Workforce persona ownership.

### Workforce boundary

Workforce personas still own:
- model
- harness selection
- system prompt
- harness settings
- tier

`@agent-assistant/harness` owns the reusable **runtime contract** for one bounded assistant turn. Products compose Workforce persona choices into this package; this package does not define personas.

---

## 3. Exact v1 scope

v1 is a **bounded interactive-turn harness**. It is not a background agent platform.

### In scope

1. **Single-turn bounded execution loop**
   - one inbound user request enters the harness
   - the harness may iterate through model/tool/model steps
   - execution ends in an explicit outcome with a truthful stop reason

2. **Bounded iterative tool use**
   - the model may request multiple tool calls in a single turn
   - the harness may re-prompt after tool results
   - max iteration count, max tool calls, and timeout/budget ceilings are enforced

3. **Clarification as a first-class outcome**
   - when the assistant lacks enough information, the harness can stop with `needs_clarification`
   - this is not treated as failure; it is an expected product-grade behavior

4. **Structured continuation**
   - when a turn cannot or should not complete now, the harness returns a continuation payload
   - continuation supports cases like clarification, approval wait, or bounded deferral after hitting a turn/tool limit

5. **Truthful stop semantics**
   - the harness distinguishes between completed, blocked, clarification-needed, bounded-stop, and error outcomes
   - products are not forced to pretend everything is "done"

6. **Tool execution contract**
   - a typed adapter interface for tools available during the turn
   - tool calls produce structured results/errors consumed by the next model step
   - tool failures are surfaced to the loop rather than hidden behind product glue code

7. **Telemetry / trace emission**
   - every model attempt, tool call, stop reason, and continuation decision must be inspectable
   - traceability is package-owned; storage/export sinks remain adapter-based

8. **Product integration seam for existing assistants like Sage**
   - products can swap a brittle one-shot planner/executor/synthesizer path for a harness-driven turn runner
   - domain prompts, tools, workspace context shaping, and product policy remain product-owned

### Out of scope for v1

- multi-agent swarm execution
- background autonomous looping after the user turn ends
- cron-driven self-revival or always-on agent daemons
- long-horizon planning across many turns
- durable memory engine ownership
- product/business workflow engines
- routing policy ownership
- specialist orchestration ownership
- generic browser/desktop automation abstractions
- human-task inboxes or work queues
- retry-until-success semantics without user visibility
- hidden continuation that keeps acting after surfacing a final answer

---

## 4. Exact non-goals

These are intentionally excluded so v1 stays commercially meaningful **and** bounded.

### A. Not a giant autonomous-agent framework

v1 does **not** provide:
- open-ended goals
- self-directed task decomposition across arbitrary time
- unattended recursive delegation
- persistent worker fleets
- "keep going until you figure it out" semantics

### B. Not a memory/librarian system

v1 does **not** own:
- long-term memory storage
- retrieval ranking
- compaction/promotion pipelines
- cross-session summarization engines

The harness may consume memory/context prepared by product code or future memory packages, but it does not become the memory layer.

### C. Not a coordination replacement

v1 does **not** subsume `@agent-assistant/coordination`.
It runs one assistant turn. If a product wants specialists later, the coordinator can become an input/tool/provider for the harness rather than the harness swallowing coordination whole.

### D. Not a transport/runtime foundation replacement

v1 does **not** own:
- relay transport
- socket/webhook infrastructure
- message delivery guarantees
- queueing substrate
- hosted observability backend

### E. Not product policy/business logic

v1 does **not** decide:
- which Sage workspace actions need approval
- which customer tiers may trigger which actions
- product-specific escalation rules
- domain heuristics for tool availability or response formatting

---

## 5. Outcome model boundary

The harness must produce a structured result that is more truthful than "assistant text or exception."

## Required v1 outcome classes

1. **`completed`**
   - The harness can return a user-facing answer for this turn.

2. **`needs_clarification`**
   - The harness cannot proceed responsibly without more input from the user.

3. **`awaiting_approval`**
   - The harness is blocked on a product/policy approval step before continuing.

4. **`deferred`**
   - The harness intentionally stops because a bounded limit or external wait condition was reached, and continuation is possible.

5. **`failed`**
   - The harness encountered an unrecoverable runtime/model/tool error and could not produce a safe completion or a truthful clarification request.

## Required v1 stop reasons

At minimum, the result must distinguish:
- `answer_finalized`
- `clarification_required`
- `approval_required`
- `max_iterations_reached`
- `max_tool_calls_reached`
- `timeout_reached`
- `budget_reached`
- `tool_unavailable`
- `tool_error_unrecoverable`
- `model_refused`
- `model_invalid_response`
- `runtime_error`
- `cancelled`

The point is not to maximize enum length. The point is to prevent fake certainty and make product UX/telemetry honest.

---

## 6. Iterative tool-use loop boundary

v1 should support a bounded loop with a clear contract.

## Canonical loop shape

1. Build turn input from:
   - user message
   - product-supplied instructions/system prompt
   - session/context snapshot
   - optional continuation payload from a prior harness stop
   - available tools metadata

2. Ask the model for the next step.

3. Interpret the model output as one of:
   - final answer candidate
   - clarification request
   - tool call request(s)
   - explicit refusal/block
   - invalid output

4. If tool calls are requested:
   - validate against available tools
   - execute them through the tool adapter
   - record results/errors in trace
   - continue the loop with tool results appended

5. Stop when one of the following happens:
   - final answer accepted by harness boundary rules
   - clarification is required
   - approval is required
   - bounded limits are reached
   - runtime/model/tool failure forces stop

## Required bounded controls

v1 must expose limits for:
- `maxIterations`
- `maxToolCalls`
- `maxElapsedMs`
- optional abstract budget ceiling
- optional max consecutive invalid model outputs

## Loop behavior constraints

- No hidden infinite loop
- No silent tool retries beyond bounded, traceable policy
- No synthesizer-only "paper over the failure" step that hides an earlier structural miss
- No pretending a bounded stop is a successful completion

---

## 7. Session and continuation expectations

The harness must integrate cleanly with `@agent-assistant/sessions` without taking over session ownership.

## Session boundary

- `sessions` continues to own session identity/lifecycle
- the harness consumes `sessionId` and session-scoped context supplied by product code
- the harness may emit structured session updates/continuation hints, but it does not become the session store

## Continuation boundary

v1 continuation should be **explicit and product-managed**.

The harness returns a continuation payload when needed. The product decides where to persist it:
- session metadata
- product thread state
- temporary store
- approval record

## What continuation must support

1. **clarification continuation**
   - resume after user answers the pending question

2. **approval continuation**
   - resume after explicit allow/deny result

3. **bounded deferral continuation**
   - resume after the product chooses to continue a turn that hit a limit or external wait state

## What continuation should not become

- hidden long-running autonomous memory
- arbitrary serialized agent brain state
- a second persistence system parallel to sessions/memory

The continuation payload should be compact, inspectable, and scoped to resuming the bounded turn.

---

## 8. Telemetry / trace requirements

A paid-product-quality harness needs auditability. Without traceability, products cannot debug user-visible failures or explain why a turn stopped.

## Required trace events

At minimum, v1 must expose structured events for:
- turn started
- turn finished
- model step started
- model step finished
- tool call requested
- tool call started
- tool call finished
- tool call failed
- clarification requested
- approval requested
- limit reached
- stop reason finalized

## Required trace fields

At minimum, each trace should include:
- `assistantId`
- `sessionId` when available
- `turnId`
- step index
- tool call count
- elapsed time
- stop reason/outcome
- model/tool identifiers used
- abstract usage/cost fields when available
- correlation fields for continuation

## Telemetry boundary

The package owns:
- trace event schema
- callback/sink contract
- lifecycle points where events fire

The package does **not** own:
- vendor-specific observability backends
- hosted dashboards
- product-specific log shipping

---

## 9. Product integration seam, especially for Sage

## Sage seam recommendation

Sage should treat the harness as the replacement for a brittle one-shot planner/executor/synthesizer turn path.

### What Sage supplies

- product prompt and instruction shaping
- workspace context assembly
- tool inventory and tool adapters
- approval/policy bridge when needed
- surface UX for clarification / approval / deferred states
- Workforce persona selection (model, harness settings, system prompt)

### What the harness supplies

- bounded iterative execution
- structured tool loop
- truthful stop outcomes
- continuation payloads
- traceability

### Minimal Sage v1 integration shape

1. inbound Slack/user turn reaches Sage capability handler
2. Sage resolves session/context using existing SDK/session contracts
3. Sage invokes `harness.runTurn(...)`
4. harness returns `HarnessResult`
5. Sage maps result to user-visible behavior:
   - `completed` → emit answer
   - `needs_clarification` → ask question and store continuation
   - `awaiting_approval` → surface approval request and store continuation
   - `deferred` → communicate bounded pause honestly
   - `failed` → emit truthful failure response and log trace

This is the right seam because Sage keeps product logic while reusing the hard part: a competent bounded assistant turn runtime.

---

## 10. Dependency and composition boundary

## Allowed dependencies

`@agent-assistant/harness` may depend on:
- `@agent-assistant/core` types/runtime contracts
- optional type-level contracts from `sessions`, `policy`, or `routing` where clearly justified

## Preferred composition rule

The harness should depend primarily on **adapter interfaces**, not concrete package implementations.

Examples:
- model client adapter
- tool executor adapter
- trace sink
- approval bridge adapter
- continuation serializer

## Dependency rule

- `core` must not depend on `harness`
- products may use `harness` directly without forcing it into the top-level facade on day one
- `harness` should likely start as **direct-import only / wave-2**, then graduate into `@agent-assistant/sdk` only after implementation and consumer proof

---

## 11. Definition of Done for a paid-product-quality v1

A truthful v1 is ready only if all of the following are true.

### Contract and docs
- canonical spec exists in `docs/specs/v1-harness-spec.md`
- boundary doc clearly states scope and non-goals
- README/docs explain the product seam and stop semantics

### Implementation quality
- bounded loop implementation exists
- stop-reason and outcome contracts are enforced in code
- continuation payloads are emitted for clarification/approval/deferred cases
- trace hooks are implemented and exercised

### Test quality
- strong package-local tests for:
  - final answer path
  - multi-tool iterative recovery path
  - clarification path
  - approval-blocked path
  - max-iteration stop
  - max-tool-call stop
  - timeout/budget stop
  - tool failure path
  - invalid model output path
  - resume-from-continuation path
- tests prove behavior, not only type construction

### Product credibility
- at least one realistic reference assembly shows the harness inside a product-style assistant flow
- Sage integration seam is demonstrated or proven by a runnable example/adapter proof
- the package is clearly useful beyond a toy demo

### Boundaries remain intact
- no background autonomous loop shipped as part of v1
- no memory-engine sprawl
- no swarm/worker framework hidden inside the harness
- no leakage of Workforce persona ownership into SDK package design

---

## 12. Implementation readiness judgment

This boundary is implementation-worthy **if and only if** the implementation stays inside the following sentence:

> `@agent-assistant/harness` is the bounded runtime for one assistant turn with iterative tool use, clarification, continuation, and truthful stop semantics.

If implementation drifts into:
- multi-agent orchestration,
- long-running autonomy,
- memory architecture expansion,
- product workflow engines,

then the boundary has been violated.

The boundary is intentionally strong enough to start implementation next because it defines:
- package placement
- exact scope
- exact non-goals
- outcome/stop semantics
- loop behavior
- continuation expectations
- telemetry requirements
- product seam
- Definition of Done

V1_HARNESS_BOUNDARY_READY
