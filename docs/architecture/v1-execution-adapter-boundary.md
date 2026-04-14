# v1 Execution-Harness Adapter Boundary

**Status:** BOUNDED_DESIGN_READY  
**Date:** 2026-04-14  
**Purpose:** Define the BYOH execution-harness adapter boundary for Agent Assistant without collapsing product identity, Relay-native coordination, or product-owned behavior into a provider-specific runtime.

---

## 1. Why this boundary exists

The runtime primitive map already establishes the design rule:

> Product identity is canonical. Execution harnesses are replaceable. Relay remains the coordination and collaboration fabric.

What is still missing is the explicit seam that turns that principle into a usable integration contract.

Without that seam, BYOH support tends to fail in one of two ways:

1. **The external harness becomes the product**  
   Product tone, domain posture, Relay-native collaboration, and continuation semantics get flattened into a single provider call.

2. **The first-party harness becomes mandatory**  
   Agent Assistant keeps a clean product model, but users cannot swap execution backends without invasive product rewrites.

The missing boundary is the narrow layer between:
- canonical product/runtime turn intent, and
- a concrete execution backend such as the built-in harness, Claude, Codex, or another supported harness.

This document defines that layer as the **execution-harness adapter boundary**.

---

## 2. What this boundary is

The execution-harness adapter boundary is the contract that:
- receives a **canonical product-prepared turn**
- declares what an execution backend can and cannot do
- maps backend-specific behavior into **normalized Agent Assistant execution outcomes**
- preserves Relay-native orchestration and product-owned semantics outside the adapter

It is an **execution-plane seam**, not a new assistant runtime.

It exists so external harnesses can participate in Agent Assistant as interchangeable execution planes **without** becoming:
- the identity layer
- the coordination fabric
- the session layer
- the continuation system
- the policy engine
- the product intelligence layer

---

## 3. Package placement recommendation

## Recommendation: **do not publish a new package yet**

For v1, this should remain a **documented boundary + internal contract**, not a public standalone package.

### Why not a package yet

Because the shape is clear enough to guide implementation, but still too early to freeze publicly:
- the built-in harness already exists and should be the first proving implementation
- external harness adapters will likely expose capability mismatches that should inform the final public API
- there is not yet evidence that multiple adapters need a separately versioned reusable library rather than product/runtime-local glue
- publishing too early would overcommit naming and ownership before first-party and BYOH paths are both proven

### Recommended current placement

- **Architecture boundary:** `docs/architecture/v1-execution-adapter-boundary.md`
- **Concrete contract/spec:** `docs/specs/v1-execution-adapter-spec.md`
- **No public package name yet**

### Future extraction trigger

Only extract a real package after all of the following are true:
1. the built-in harness is implemented through the same adapter contract
2. at least one external harness adapter exists and is exercised end-to-end
3. the capability negotiation model survives real degradation cases
4. product assembly can use the boundary without adapter-specific branching everywhere

If that happens, the likely future package would sit:
- **below** `turn-context`
- **beside** `harness`
- **upstream of** concrete execution backends
- **outside** `policy`, `sessions`, and `continuation`

But v1 should not lock that in publicly.

---

## 4. What remains canonical on the product/runtime side

The following remain canonical on the Agent Assistant / product side and must not be delegated to the adapter:

- assistant identity
- traits and expression shaping
- product prompts, heuristics, and superpowers
- Relay-native coordination primitives
- session identity and lifecycle
- policy intent and policy outcomes
- continuation lifecycle and resume semantics
- user-facing output normalization expectations
- product-specific UX and orchestration decisions

Put simply:

- **turn-context** decides how the assistant should show up for this turn
- **product/runtime** decides what work should happen and under what rules
- **Relay** remains the collaboration/control fabric
- **execution adapter** only decides how to hand that bounded turn to a backend and normalize the result

---

## 5. What the adapter layer owns

The adapter layer owns only execution-facing translation and normalization.

### Adapter-owned responsibilities

1. **Backend capability description**
   - declare supported features
   - expose known limits or unsupported semantics

2. **Canonical turn handoff**
   - accept a normalized execution request from Agent Assistant
   - translate it into backend-native invocation shape

3. **Backend result normalization**
   - map provider-native outputs into normalized execution outcomes
   - normalize stop reasons, tool usage signals, and failure categories

4. **Execution trace normalization**
   - preserve inspectable execution facts where available
   - downgrade gracefully when the backend exposes less telemetry

5. **Capability-aware refusal/degradation**
   - reject unsupported requests explicitly
   - return structured degradation reasons rather than silently pretending support

6. **Provider-specific bridging**
   - adapt provider-native tool calling, approval hooks, or resume affordances into the canonical contract when possible

---

## 6. What the adapter layer does **not** own

The adapter layer must not own:

- assistant identity authoring
- turn-context assembly
- memory retrieval or ranking
- session creation, merging, or lifecycle
- continuation storage or resume policy
- policy evaluation, risk classification, or approval decisions
- Relay coordination, messaging, auth, scheduler, or file exchange
- product workflows, domain intelligence, or business heuristics
- specialist orchestration or shared-context policy

This is the key anti-flattening rule:

> The adapter may execute a turn or a bounded subtask, but it does not redefine the assistant runtime around itself.

---

## 7. Canonical model: external harnesses participate without flattening the system

External harnesses participate as **execution planes**.

They do **not** replace:
- Relay as the coordination fabric
- Agent Assistant as the runtime shell
- product code as the owner of identity and behavior

### Correct model

```text
product/runtime intent
  -> turn-context assembly
  -> policy / session / continuation / Relay coordination decisions
  -> execution-harness adapter
  -> concrete backend
  -> normalized execution result
  -> product/runtime acts on result
```

### Incorrect model

```text
product request
  -> external harness
  -> whatever comes back becomes the product behavior
```

The external harness can supply execution strength, but it cannot become the source of truth for:
- who the assistant is
- what Relay coordination means
- how approvals work
- how resumability works
- how sessions are tracked

---

## 8. Capability negotiation and graceful degradation

Capability negotiation is central to this boundary.

Different harnesses will vary on:
- iterative tool use
- structured tool invocation
- continuation/resume support
- approval interrupts
- trace depth
- context window shape
- attachment support
- deterministic stop reason signaling

### Required v1 posture

The runtime must know, before execution or at invocation time, whether a backend supports the required semantics for the requested turn.

### Negotiation model

The product/runtime expresses **required** and **preferred** execution semantics.

The adapter responds with one of:
- **supported as requested**
- **supported with degradation**
- **unsupported**

### Graceful degradation rules

Degradation must be:
- explicit
- inspectable
- truthful
- bounded

Examples:
- if a backend lacks structured tool calls, the adapter must not claim full tool-loop support
- if a backend cannot produce resumable turn state, the adapter must not fabricate continuation fidelity it cannot provide
- if a backend cannot pause for approval, the adapter must surface that the product must gate before invocation or route elsewhere
- if a backend exposes only shallow telemetry, the adapter returns reduced trace fidelity rather than fake step-level traces

### Fallback principle

When a required capability is absent, the runtime chooses among:
- reroute to another harness
- reduce the requested execution mode
- pre-handle the missing concern in product/runtime code
- refuse the execution path honestly

The adapter does not make product-policy choices by itself.

---

## 9. How Relay primitives stay central

Relay primitives remain central because they are upstream and lateral to execution, not adapter-owned.

### Relay stays canonical for

- channel messaging and transport participation
- shared context exchange
- multi-agent collaboration
- file exchange
- auth / actor identity boundaries
- scheduling / wake-up infrastructure
- coordination topology

### Important rule

An external harness may be used:
- **inside** a Relay-coordinated turn
- **inside** a Relay-managed specialist execution path
- **inside** a product-managed continuation resume

But it must not replace the Relay-native collaboration model with a single opaque provider interaction.

That means:
- specialists still coordinate through Relay-native channels/contracts
- shared files still move through Relay-native file/context paths
- approval and wake-up flows still belong to product/runtime + Relay-adjacent layers
- backend execution is one participant in the broader runtime, not the runtime itself

---

## 10. Relationship to turn-context, harness, continuation, policy, and sessions

## `turn-context`

`turn-context` remains the canonical upstream assembly seam.

It owns:
- identity projection
- expression shaping
- prepared context
- harness projection

The execution adapter consumes a **product-prepared execution request** derived from this assembly. It does not re-assemble identity.

## `harness`

The built-in harness is one concrete execution backend.

That means the adapter boundary sits **above** the built-in harness when Agent Assistant uses the first-party turn executor, and also above external harness implementations.

The adapter boundary does not replace harness. It generalizes the execution entry seam so:
- the built-in harness can participate as one backend
- external harnesses can participate through the same normalized result model

## `continuation`

Continuation stays canonical outside the adapter.

The adapter may:
- report whether the backend supports resumable execution affordances
- map backend-native pause/resume handles into normalized execution metadata when possible

But continuation still owns:
- persisted continuation records
- wait conditions
- resume triggers
- resumed-turn lifecycle
- follow-up delivery state

The adapter must not become a shadow continuation system.

## `policy`

Policy stays fully canonical outside the adapter.

The adapter may expose execution facts relevant to policy handling, but it does not:
- classify risk
- decide allow/deny/approval
- own approval audit correlation

If a backend cannot pause cleanly for approval, that is a capability fact. The product/runtime must decide whether to:
- policy-gate before invocation
- route to a different harness
- refuse the action

## `sessions`

Sessions remain the continuity container across surfaces and turns.

The adapter may receive session identifiers as correlation inputs, but it does not:
- create sessions
- merge sessions
- attach surfaces
- expire sessions

The adapter is turn-scoped execution glue, not continuity ownership.

---

## 11. Suggested v1 boundary shape

The minimum useful v1 boundary is a contract with three parts:

1. **Execution request** — canonical turn execution input from product/runtime
2. **Capability descriptor / negotiation result** — what the backend can honor
3. **Execution result** — normalized outcome back to product/runtime

That is enough to support:
- first-party harness through the same seam
- BYOH adapters with explicit degradation
- product/runtime ownership of policy, continuation, sessions, and Relay coordination

It is intentionally **not** a full orchestration framework.

---

## 12. Explicit non-goals

This boundary is not trying to define:
- a universal prompt schema for all providers
- a generic provider SDK
- a replacement for `@agent-assistant/harness`
- a replacement for `@agent-assistant/turn-context`
- a new continuation engine
- a new approval framework
- a cross-provider workflow engine
- an external-harness-first product architecture
- a policy-aware autonomous router inside the adapter
- a requirement that all Relay collaboration happens inside the external backend

Also out of scope for v1:
- multi-backend speculative execution
- adapter-managed load balancing
- shared distributed traces across arbitrary third-party systems
- provider-specific file sync semantics becoming canonical SDK semantics

---

## 13. Definition of done for a useful v1

This boundary is useful in v1 when all of the following are true:

1. **A product can prepare one canonical execution request without baking in one harness.**
2. **The built-in harness can be described as one backend under the same contract.**
3. **At least one external harness can declare capability gaps explicitly.**
4. **Unsupported semantics degrade truthfully instead of silently flattening behavior.**
5. **Policy, continuation, sessions, and Relay coordination remain outside adapter ownership.**
6. **Products do not need provider-specific branches for basic execution success/failure/clarification/defer handling.**
7. **The normalized result shape is concrete enough to drive product orchestration after execution.**
8. **The boundary can be implemented without reopening package ownership of turn-context, continuation, sessions, or policy.**

If those conditions hold, the boundary is implementation-ready as a v1 internal contract.

---

## 14. Bottom line

The execution-harness adapter boundary should be treated as a **real architectural seam**, but **not yet a public package**.

Its job is narrow:
- preserve canonical product/runtime intent
- expose backend capabilities honestly
- translate to and from concrete execution backends
- keep Relay-native coordination and product identity central

That is the right BYOH model for Agent Assistant:

> users may bring their own execution backend, but not their own replacement runtime.
