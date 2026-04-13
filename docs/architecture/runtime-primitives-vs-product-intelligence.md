# Runtime Primitives vs Product Intelligence

**Date:** 2026-04-13  
**Purpose:** Make the SDK/product ownership seam explicit so Agent Assistant does not collapse product intelligence into `@agent-assistant/harness` or any other single runtime package.

---

## The short version

The SDK should own **reusable runtime primitives**.
Products should own **what makes one assistant commercially distinct**.

A good rule:

- If multiple assistants/products should be able to reuse it with mostly the same contract, it belongs in the SDK.
- If it encodes one product’s domain semantics, UX choices, business rules, or “taste,” it belongs in the product.

---

## 1. What counts as a runtime primitive

A runtime primitive is a reusable assistant capability with a stable ownership boundary.

Examples:
- assistant lifecycle
- session continuity
- surface normalization/delivery
- bounded turn execution
- routing envelope selection
- policy decision contracts
- memory storage/retrieval contracts
- specialist coordination signals
- proactive scheduling contracts

A primitive should answer:
- what it receives
- what it returns
- what state it owns
- what it refuses to own

That is why `@agent-assistant/harness` works when defined narrowly: it has a clean input/output/state boundary.

---

## 2. What counts as product intelligence

Product intelligence is the layer that makes Sage not feel like MSD, and MSD not feel like NightCTO.

Examples:
- prompt strategy
- domain heuristics
- tool inventories
- workspace semantics
- business workflows
- customer-tier rules
- escalation style
- tone and experience decisions beyond reusable trait primitives
- when to ask, when to act, when to summarize, when to defer
- how much evidence is enough before acting in that product

Product intelligence is not a generic runtime capability. It is a product decision system.

---

## 3. Ownership matrix

| Concern | SDK-owned | Product-owned |
| --- | --- | --- |
| Assistant lifecycle | Yes | No |
| Session identity and continuity | Yes | No |
| Surface normalization and fanout primitives | Yes | No |
| Bounded model/tool turn loop | Yes | No |
| Stop reason and continuation contract | Yes | No |
| Trace event schema | Yes | No |
| Routing mode contract | Yes | Product chooses policy values |
| Policy engine contract | Yes | Product writes rules and approval UX |
| Durable memory contract | Yes | Product decides what to remember and inject |
| Traits schema | Yes | Product provides actual trait values |
| Domain prompts | No | Yes |
| Domain tools | No | Yes |
| Business rules | No | Yes |
| Workspace semantics | No | Yes |
| Commercial/customer-tier rules | No | Yes |
| Outcome-to-UX mapping | No | Yes |
| Enrichment assembly logic | seam maybe SDK later | Yes today |

---

## 4. The important seam for `@agent-assistant/harness`

`@agent-assistant/harness` should own:
- the bounded execution loop
- tool mediation during a turn
- truthful stop semantics
- continuation shape
- trace lifecycle

It should not own:
- what instructions the product sends
- what tools exist
- what memory/context is chosen
- what policy rules are active
- what the assistant’s product-specific domain behavior should be
- how the UI responds to each outcome

So the product does this:
1. assemble instructions
2. assemble prepared context
3. choose tools
4. decide routing/persona envelope
5. call harness
6. interpret result in product UX

That is the correct split.

---

## 5. Examples by package

## `@agent-assistant/core`
### SDK owns
- assistant definition
- lifecycle
- capability dispatch
- subsystem registry

### Product owns
- what capabilities exist for that assistant
- capability handler logic
- how handlers compose product subsystems

---

## `@agent-assistant/sessions`
### SDK owns
- session contract
- session transitions
- affinity and attached-surface model

### Product owns
- when to create/merge/archive sessions
- any product-specific identity heuristics above the generic contract

---

## `@agent-assistant/surfaces`
### SDK owns
- assistant-facing inbound/outbound abstractions
- formatting hooks
- fanout primitives

### Product owns
- product-specific response formatting policy
- what gets sent where and why in product terms
- channel UX decisions

---

## `@agent-assistant/harness`
### SDK owns
- turn loop
- iteration/tool/time/budget bounds
- clarification/approval/deferred outcomes
- continuation payload contract
- trace event contract

### Product owns
- prompt/instruction assembly
- tool definitions and implementations
- prepared context selection
- approval orchestration around policy
- response UX after each result

---

## `@agent-assistant/routing`
### SDK owns
- routing mode vocabulary
- model-selection decision contract
- cost/latency/depth routing mechanism

### Product owns
- actual routing policy values
- business rules for using deep vs fast modes
- mapping between product personas/tiers and SDK routing modes

---

## `@agent-assistant/policy`
### SDK owns
- action classification contract
- rule evaluation engine
- decision types
- audit trail mechanism

### Product owns
- policy rules
- approval UX
- escalation destinations
- how approvals affect product workflow

---

## `@agent-assistant/memory`
### SDK owns
- scopes
- store/query contracts
- promotion/compaction semantics

### Product owns
- what to store
- what to retrieve for a given turn
- summarization heuristics
- memory importance policy

---

## `@agent-assistant/traits`
### SDK owns
- trait schema
- validation
- stable assistant-facing identity fields

### Product owns
- actual trait values
- prompt phrasing that expresses those traits
- how traits interact with domain behavior

---

## `@agent-assistant/connectivity` / `coordination`
### SDK owns
- signaling/orchestration primitives
- specialist coordination contracts

### Product owns
- which specialists exist
- what they are asked to do
- when backstage work should influence a visible assistant turn

---

## 6. Three things the SDK should resist absorbing

## A. Product prompt systems
The SDK can expose structured seams, but it should not become the owner of one product’s prompt stack.

## B. Product domain heuristics
“Which repo evidence matters for MSD?” or “Which workspace notes matter for Sage?” are product questions.

## C. Product workflow semantics
Approval UIs, escalation playbooks, client-tier handling, and domain-specific branching should stay outside the SDK.

---

## 7. Where the repo still needs a sharper seam

The biggest gap is not in the harness loop itself.
The biggest gap is the space between:
- reusable primitives like memory / coordination / traits
- and product-owned turn assembly

Today, that layer is mostly product glue.

### Missing explicit seam
A future runtime contract should probably make this more explicit, something like:
- turn-context assembler
- enrichment provider
- character/runtime-expression composer

Not because the SDK should own product intelligence, but because it should own the **shape of the integration seam** where reusable primitives feed a visible assistant turn.

That would reduce the pressure to overload “harness” with everything upstream of `runTurn()`.

---

## 8. A practical rule for future package decisions

When deciding whether something belongs in `@agent-assistant/*`, ask four questions:

1. **Can more than one product reuse this with the same contract?**
2. **Does it own a clean state/input/output boundary?**
3. **Can it avoid hard-coding one product’s domain behavior?**
4. **Would pulling it into the SDK reduce duplication without flattening product individuality?**

If yes to all four, it probably belongs in the SDK.
If not, keep it product-owned.

---

## 9. Final judgment

The right mental model is:
- SDK = reusable runtime primitives
- Product = domain intelligence and experience strategy

In that model, `@agent-assistant/harness` is not where product intelligence should go.
It is where **bounded turn execution** should go.

Everything that makes an assistant uniquely Sage-ish, MSD-ish, or NightCTO-ish should sit above that primitive, not inside it.

RUNTIME_VS_PRODUCT_BOUNDARY_READY
