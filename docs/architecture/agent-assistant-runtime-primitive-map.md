# Agent Assistant Runtime Primitive Map

**Date:** 2026-04-13  
**Purpose:** Replace the broad and overloaded “harness” framing with an explicit runtime primitive map for Agent Assistant.

---

## Executive summary

`@agent-assistant/harness` is a real and useful package, but it is **not the whole runtime story**.

The current “harness” framing has been carrying too many concerns at once:
- bounded turn execution
- model/tool iteration
- truthful stop semantics
- continuation contracts
- traceability
- approvals seam
- prompt/context assembly
- assistant identity and character expression
- runtime enrichment from integrations or specialists
- product-specific domain intelligence

That is too much for one mental bucket.

The right decomposition is:

1. **Assistant assembly/runtime shell** — `@agent-assistant/core`
2. **Session continuity** — `@agent-assistant/sessions`
3. **Surface normalization and delivery** — `@agent-assistant/surfaces`
4. **Turn executor** — `@agent-assistant/harness`
5. **Routing / execution envelope selection** — `@agent-assistant/routing`
6. **Approval / action governance seam** — `@agent-assistant/policy`
7. **Memory and prepared context supply** — `@agent-assistant/memory`
8. **Identity / character composition** — `@agent-assistant/traits` today, richer composition missing
9. **Runtime enrichment / backstage signals** — partially `connectivity`/`coordination`, but still missing as a first-class assistant-turn input seam
10. **Product intelligence layer** — remains product-owned

That reframes “harness” from **the assistant runtime** to **one primitive inside the runtime stack**:

> `@agent-assistant/harness` should be thought of as the bounded turn executor, not the umbrella concept for identity, product logic, memory, policy, or enrichment.

---

## Design principle — product identity is canonical, execution harnesses are replaceable, Relay remains the coordination fabric

Agent Assistant must be designed so that a consuming product can preserve its own identity, behavior, and Relay-native collaboration model even when the underlying execution harness is not the default Agent Assistant harness.

### Principle statement

> Product identity is canonical. Execution harnesses are replaceable. Relay remains the coordination and collaboration fabric.

This means a product like Sage, MSD, or NightCTO should be able to:
- preserve its assistant identity, tone, humor, traits, and behavioral shaping
- preserve product-specific intelligence such as superpowers, g-stack logic, business heuristics, and UX decisions
- preserve Relay-native primitives such as relayauth, relayfile, relaycron, channel messaging, shared context exchange, and multi-agent coordination
- while optionally allowing the actual execution engine for some turns or sub-tasks to be backed by a user-selected external harness such as Claude, Codex, or other supported providers

### What remains canonical on the Agent Assistant / product side

The following must remain owned by Agent Assistant and/or the consuming product, not outsourced to the backing harness:
- assistant identity and stable traits
- turn-context assembly and expression shaping
- product-owned prompts, heuristics, superpowers, and domain logic
- policy and guardrail intent, even if enforcement may need adapter support
- continuation/follow-up semantics
- Relay-native coordination, messaging, scheduling, auth, and shared file/context primitives
- result normalization and user-facing behavior expectations

### What is replaceable

The execution harness may be replaceable. This includes:
- model/tool-loop implementation details
- provider-native execution semantics
- user-owned subscription/billing path for Claude/Codex/etc.
- some provider-specific runtime affordances

The replacement boundary is the execution plane, not the assistant’s identity or the overall collaboration substrate.

### Architectural model

The intended architecture should be understood as:
- **Product / Agent Assistant runtime** = identity, shaping, coordination, policy intent, continuation semantics, and normalized UX
- **Relay primitives** = coordination/control plane and collaboration fabric
- **Execution harness adapters** = bridge from canonical assistant/runtime intent into a specific execution backend
- **External harnesses** = pluggable execution planes

This is not “bring your own assistant.” It is “bring your own execution backend while keeping the assistant and collaboration model canonical.”

### Relay-native collaboration must survive external harness support

Support for external harnesses must not flatten the system into a single provider call. Agent Assistant should retain its Relay-native differentiators, including:
- multiple backing agents collaborating through Relay channels
- shared file/context exchange via relayfile
- authenticated collaboration and capability boundaries via relayauth
- scheduled follow-up / wake-up patterns via relaycron
- explicit runtime coordination semantics that are richer than a single external harness loop

External harnesses should participate in this fabric where possible, not replace it.

### Capability negotiation and graceful degradation

Because not all backing harnesses will support the same execution semantics, Agent Assistant should eventually model harness capabilities explicitly. At minimum, the architecture should anticipate capability differences around:
- iterative tool use
- structured tool invocation contracts
- continuation/resume support
- trace/telemetry depth
- approval/interrupt hooks
- result shape and error semantics

The runtime should preserve product identity strongly and degrade functionality explicitly and honestly where a selected harness lacks support.

### Tone and individuality requirement

A user-selected execution harness must not erase assistant individuality. Sage must still feel like Sage; MSD must still feel like MSD; NightCTO must still feel like NightCTO.

That means the canonical product/runtime layers must own:
- tone
- humor
- expression shaping
- domain posture
- runtime-enrichment rules
- product-specific interaction feel

External harnesses execute work; they do not define who the assistant is.

### Practical consequence for future package design

This principle implies a future need for a clean execution-backend adapter layer or harness-provider adapter model. That layer should connect:
- canonical turn-context + product shaping + policy/continuation intent
- to a specific execution harness implementation

without collapsing the rest of the runtime stack into harness-specific assumptions.

### Why this principle is important

Without this rule, Agent Assistant risks drifting into one of two bad states:
1. assuming the first-party harness is the only meaningful execution substrate
2. letting external harnesses overwrite product identity and dissolve Relay-native coordination advantages

Both would weaken the product. The correct design preserves canonical assistant identity and Relay-native collaboration while allowing execution backends to be swapped or user-supplied.

## 1. What is currently overloaded into “harness”

The existing boundary/spec docs for harness are directionally strong, but the word is still carrying several different layers at once.

### Overloaded concern 1 — turn control flow
This is the part harness actually owns well today:
- one bounded invocation
- model → tool → model loop
- iteration/tool/time/budget limits
- final/clarification/approval/deferred/failed outcomes

### Overloaded concern 2 — tool orchestration
Also legitimately harness-owned in v1:
- tool availability passed into the model
- tool request validation
- tool execution sequencing
- tool-result transcript accumulation

### Overloaded concern 3 — stop semantics and continuation
Also harness-owned:
- truthful stop reasons
- compact continuation payloads
- deferred/clarification/approval resume contract

### Overloaded concern 4 — traceability
Also harness-owned:
- per-turn trace schema
- step/tool lifecycle events
- stop/outcome visibility

### Overloaded concern 5 — approvals / policy interaction
This is a seam, not true harness ownership.
The harness should be able to stop in `awaiting_approval`, but:
- risk classification
- policy rule evaluation
- audit ownership
- approval recording semantics

belong to `@agent-assistant/policy` and product integration glue.

### Overloaded concern 6 — assistant identity / character
This is **not** harness ownership.
The harness docs correctly worry about character and runtime individuality, but those are separate concerns:
- stable assistant identity and tone → `@agent-assistant/traits`
- future richer character composition → missing primitive
- product voice/persona authoring → product-owned

### Overloaded concern 7 — runtime enrichment
This is only partially harness-owned.
The harness may *consume* enrichment, but it should not own:
- specialist memos
- backstage signals
- cultural/context injectors
- domain-specific enrichment pipelines

What is missing is a cleaner primitive for **prepared turn context / enrichment input assembly**.

### Overloaded concern 8 — product intelligence
This should stay out of harness entirely:
- domain heuristics
- tool-choice heuristics specific to one product
- workspace semantics
- business workflows
- customer-tier rules
- UX mapping choices

---

## 2. Explicit runtime primitive decomposition

## Primitive A — Assistant runtime shell
**Primary package:** `@agent-assistant/core`

### Owns
- assistant definition
- capability registration
- lifecycle (`start`, `stop`)
- dispatch
- subsystem registry
- outbound emit contract

### Does not own
- iterative turn execution
- session persistence
- surface normalization internals
- policy logic
- memory retrieval
- product prompts/workflows

### Exists today?
**Yes — implemented and stable.**

### Why it matters
This is the outer shell the other runtime primitives plug into. It is the assistant container, not the turn brain.

---

## Primitive B — Session continuity
**Primary package:** `@agent-assistant/sessions`

### Owns
- assistant session identity
- session lifecycle and reactivation rules
- cross-surface continuity attachment
- affinity metadata

### Does not own
- turn execution logic
- continuation contents
- message delivery
- memory persistence

### Exists today?
**Yes — implemented and stable.**

### Why it matters
A turn executor needs a continuity unit to run inside, but should not become that continuity unit.

---

## Primitive C — Surface mediation
**Primary package:** `@agent-assistant/surfaces`

### Owns
- normalized inbound assistant messages
- assistant-facing outbound delivery abstraction
- fanout/format hooks across attached surfaces

### Does not own
- assistant reasoning loop
- policy evaluation
- product response semantics

### Exists today?
**Yes — implemented and stable.**

### Why it matters
This is the transport-facing seam above Relay. Harness should operate on normalized turn input, not raw provider payloads.

---

## Primitive D — Bounded turn executor
**Primary package:** `@agent-assistant/harness`

### Owns
- one bounded turn
- model/tool/model iteration
- tool call mediation
- truthful stop outcomes and stop reasons
- compact continuation payload contract
- per-turn trace lifecycle

### Does not own
- assistant lifecycle
- session store ownership
- memory store ownership
- routing policy ownership
- policy engine ownership
- product intelligence
- deep character system

### Exists today?
**Yes — implemented.**

### Notes on current reality
The package is now real, not hypothetical. It already covers the core bounded-turn primitive well enough for product use.

### Why it matters
This is the primitive that should retain the name “harness” if that term is kept at all.

---

## Primitive E — Execution envelope / routing
**Primary package:** `@agent-assistant/routing`

### Owns
- choosing execution mode/depth/cost envelope
- model-choice policy contracts
- cost/latency/depth selection logic
- escalation-aware routing input

### Does not own
- the turn loop itself
- persona definitions
- product commercial rules
- provider transport

### Exists today?
**Yes — implemented.**

### Why it matters
The turn executor should run with a selected envelope, but should not own the logic that selects that envelope.

---

## Primitive F — Approval and action-governance seam
**Primary package:** `@agent-assistant/policy`

### Owns
- action classification
- allow / deny / require_approval / escalate decisions
- audit trail
- approval recording correlation

### Does not own
- turn loop
- tool execution
- proactive scheduling
- product-specific rule definitions

### Exists today?
**Yes — implemented.**

### Why it matters
Harness can stop at `awaiting_approval`, but policy decides whether approval is needed and what the governance result is.

---

## Primitive G — Memory and prepared context supply
**Primary package:** `@agent-assistant/memory` for storage/retrieval  
**Adjacent contract:** product-owned turn-context assembly

### Owns
- durable memory scopes and retrieval contracts
- promotion/compaction/storage semantics
- assistant-facing memory API

### Does not own
- the turn loop
- raw surface messages
- product heuristics for what context to inject this turn

### Exists today?
**Partially.**
- memory spec exists
- package is blocked on `@agent-relay/memory`
- prepared turn-context assembly is still mostly product glue

### Why it matters
A competent assistant needs prepared context, but that is not the same as harness.

---

## Primitive H — Identity / character composition
**Primary package today:** `@agent-assistant/traits`  
**Missing next primitive:** richer character-composition / runtime-expression layer

### Owns today
- stable identity traits
- voice/style defaults
- behavioral defaults
- surface formatting preferences

### Does not own
- turn execution
- workforce persona config
- dynamic runtime enrichment
- domain/business prompt stacks

### Exists today?
**Partially.**
- traits exist
- richer structured character composition does not

### Why it matters
This is one of the biggest sources of harness confusion. “How the assistant feels” is not the same primitive as “how the turn executes.”

---

## Primitive I — Runtime enrichment / backstage intelligence ingress
**Likely packages:** `@agent-assistant/connectivity`, `@agent-assistant/coordination`, future assistant-facing enrichment contract

### Owns
- specialist/backstage signals
- structured internal memos or handoffs
- enrichment that informs a visible turn without replacing identity

### Does not own
- visible assistant identity
- durable memory storage
- product-specific domain rules
- the bounded turn loop itself

### Exists today?
**Partially / fragmented.**
- connectivity exists for signaling
- coordination exists for orchestration
- what is still missing is a clean assistant-turn-facing enrichment primitive that says: “here is what the visible assistant should consider on this turn.”

### Why it matters
This is another concern that the harness docs correctly sense, but it should not be collapsed into the turn runner.

---

## Primitive J — Product intelligence layer
**Owner:** product repos

### Owns
- product prompts and instruction shaping
- domain heuristics
- tool inventories and gating rules
- workspace semantics
- business workflows
- product UX mapping of outcomes
- product-specific escalation/commercial policy
- product-specific enrichment assembly

### Does not own
- reusable assistant runtime contracts
- session/surface/core primitives
- generic turn execution contracts

### Exists today?
**Yes — but mostly outside this repo, which is correct.**

### Why it matters
This is the layer that should stay product-owned no matter how capable the SDK becomes.

---

## 3. Ownership table

| Primitive | Owns | Does not own | State |
| --- | --- | --- | --- |
| Runtime shell | assistant lifecycle, dispatch, registry | turn loop, policy, memory | Implemented |
| Session continuity | session identity/lifecycle | continuation payload semantics, reasoning | Implemented |
| Surface mediation | normalized inbound/outbound, fanout | reasoning loop | Implemented |
| Bounded turn executor | iterative execution, tool loop, stop semantics, continuation, trace | lifecycle, memory, product logic | Implemented |
| Execution envelope | mode/model choice, cost/latency/depth policy | turn loop, personas | Implemented |
| Action governance | risk/approval/audit | turn loop, tool execution | Implemented |
| Memory/storage | durable scoped memory | turn execution, turn-context shaping | Spec ready / blocked |
| Identity/character | stable voice/style defaults | runtime enrichment, domain logic | Partial |
| Runtime enrichment ingress | backstage/internal signals into a turn | identity ownership, memory store, business rules | Partial / missing seam |
| Product intelligence | product behavior, prompts, tools, UX, business rules | reusable SDK runtime | Product-owned |

---

## 4. What exists today vs what is missing

## Already solid
- `@agent-assistant/core`
- `@agent-assistant/sessions`
- `@agent-assistant/surfaces`
- `@agent-assistant/harness`
- `@agent-assistant/routing`
- `@agent-assistant/policy`
- `@agent-assistant/proactive`
- `@agent-assistant/connectivity`
- `@agent-assistant/coordination`
- `@agent-assistant/traits`

## Partially solved
- **identity composition** — traits exist, but only as stable data defaults
- **runtime enrichment** — signaling/orchestration exists, but not as a crisp visible-assistant turn input primitive
- **turn-context assembly** — supported structurally via `HarnessPreparedContext`, but still mostly product glue rather than an explicit SDK primitive
- **approval seam** — enough for v1, but still product-mediated rather than end-to-end assistant-runtime assembly

## Missing or still under-specified
1. **Prepared turn-context / enrichment assembler**
   - a reusable contract for taking memory, specialist output, live workspace state, and product rules and producing the turn-ready context bundle
2. **Richer character composition layer**
   - something above `traits` and below product personas/prompts that can compose stable character + runtime enrichment cleanly
3. **Canonical runtime stack doc**
   - current docs talk about harness, but not yet with a crisp full-stack primitive map

---

## 5. Recommended implementation / dependency order

This is the practical build order if the goal is a competent customizable assistant, not just isolated packages.

### Order 1 — base shell and continuity
1. `@agent-assistant/core`
2. `@agent-assistant/sessions`
3. `@agent-assistant/surfaces`

Reason: no assistant exists without a runtime shell, continuity unit, and inbound/outbound message contract.

### Order 2 — truthful bounded turn execution
4. `@agent-assistant/harness`

Reason: this is the first primitive that upgrades the system from a thin dispatcher to a competent assistant turn runtime.

### Order 3 — identity and governance seams
5. `@agent-assistant/traits`
6. `@agent-assistant/policy`
7. `@agent-assistant/routing`

Reason:
- traits gives stable assistant feel
- policy gives safe external-action seam
- routing gives controllable execution envelope

### Order 4 — context and enrichment depth
8. `@agent-assistant/memory`
9. turn-context/enrichment assembly seam (currently missing as explicit package/contract)
10. `@agent-assistant/connectivity`
11. `@agent-assistant/coordination`

Reason:
- memory without a good turn executor is less valuable
- enrichment needs a clean ingress into the visible turn
- connectivity/coordination should feed the assistant, not redefine the assistant runtime around themselves

### Order 5 — proactive and product convergence
12. `@agent-assistant/proactive`
13. product-specific full assemblies/examples

Reason: proactive is most useful after there is a coherent runtime stack for continuity, policy, execution, and context.

---

## 6. Product-owned vs SDK-owned

## SDK-owned
The SDK should own reusable runtime primitives:
- runtime shell
- sessions
- surfaces
- bounded turn execution
- routing contracts
- policy contracts
- memory contracts
- traits
- connectivity / coordination primitives
- proactive engine

## Product-owned
Products should continue to own:
- workforce persona selection and persona content
- domain prompts and instruction assembly
- domain tools and action implementations
- business policy rules
- context selection heuristics
- runtime enrichment sources and shaping rules
- outcome-to-UX mapping
- product-specific “what good looks like” logic

## Important boundary
The SDK can own **the seams** for enrichment and identity composition, but should not own the final product personality or product strategy.

---

## 7. How “harness” should be thought about after this decomposition

Old mental model:
- harness = the assistant runtime / the place where the real intelligence lives

Better mental model:
- harness = the **bounded turn executor** inside a larger assistant runtime stack

That means:
- harness is important, but not the umbrella abstraction
- traits are not harness
- memory is not harness
- policy is not harness
- routing is not harness
- specialist/backstage enrichment is not harness
- product intelligence is definitely not harness

If the term “harness” is kept, it should now be read narrowly:

> the runtime primitive that executes one assistant turn honestly and iteratively

That narrower reading is healthier for package boundaries and for future implementation.

---

## 8. Recommended doc adjustment

The current harness docs are good, but they should stop carrying the burden of being the informal runtime master doc.

### Recommended adjustment
- Keep `docs/architecture/v1-harness-boundary.md` as the package boundary for `@agent-assistant/harness`
- Add this document as the authoritative runtime-stack decomposition
- Update references to say the harness is **one primitive in the stack**, not the broad umbrella for identity, enrichment, and product behavior

### Specific wording change to reinforce
Where docs say or imply:
- “the harness must support deep assistant individuality as a first-class runtime concern”

prefer language like:
- “the runtime stack must support deep assistant individuality; the harness must remain compatible with that composition model without owning it outright”

That preserves the useful warning without overloading the package.

---

## Final judgment

The repo should stop using “harness” as shorthand for the whole Agent Assistant runtime.

The explicit primitive map is:
- shell
- continuity
- surfaces
- bounded turn execution
- routing
- policy
- memory/context
- identity composition
- runtime enrichment ingress
- product intelligence

`@agent-assistant/harness` remains a good package name, but it should now mean exactly one thing:

> the bounded turn executor for Agent Assistant.

RUNTIME_PRIMITIVE_MAP_READY
