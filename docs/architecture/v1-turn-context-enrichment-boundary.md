# v1 Turn-Context / Enrichment Boundary

**Date:** 2026-04-13
**Proposed package:** `@agent-assistant/turn-context`
**Purpose:** Define the missing runtime primitive that assembles the effective assistant-facing turn context for one bounded turn by composing stable identity, product-owned shaping, and runtime enrichment into a harness-ready input.

---

## 1. Why this boundary exists

The current primitive map correctly narrowed `@agent-assistant/harness` to the bounded turn executor.

That decomposition exposed the real missing seam:

> There is no explicit SDK primitive for assembling the visible assistant's effective turn context before the harness runs.

Today, the repo has three partial pieces:

1. `@agent-assistant/traits` provides stable assistant identity defaults.
2. `@agent-assistant/connectivity` and `@agent-assistant/coordination` provide backstage signals and specialist outputs.
3. `@agent-assistant/harness` accepts `instructions` and `context`, including `HarnessPreparedContext`.

What is still missing is the reusable primitive that answers:

> Given this assistant, this session, this turn, these memories, these backstage signals, and these product rules, what should the visible assistant actually be given as its effective character + context bundle for this turn?

Without that seam, products have to hand-roll inconsistent assembly code for:
- personality shaping
- humor and tone modulation
- runtime memory injection
- supporting-agent inputs
- session-aware expression
- product-specific instruction layering
- guardrail shaping

That work is too reusable to leave entirely implicit, but too product-specific to bury inside harness.

---

## 2. Primitive definition

## Recommended name

**Turn-context assembler**

## Recommended package

**`@agent-assistant/turn-context`**

This package should own the assistant-facing assembly contract for one turn.

It is the layer:
- **above** `@agent-assistant/traits`
- **adjacent to** memory / policy / coordination / connectivity inputs
- **below** product-specific prompts, UX logic, and domain workflows
- **upstream of** `@agent-assistant/harness`

## Core responsibility

`@agent-assistant/turn-context` assembles a **turn-scoped expression bundle** for the visible assistant.

That means it produces the structured, turn-ready inputs that the harness or equivalent product runtime consumes:
- effective instructions
- effective assistant-expression guidance
- prepared context blocks
- structured enrichment metadata
- provenance about where enrichment came from
- guardrail overlays that inform expression without taking over policy ownership

It does **not** execute the turn.

---

## 3. Placement recommendation

## Recommendation

Create a **new package**: `@agent-assistant/turn-context`

Do **not** extend:
- `@agent-assistant/harness` to own assembly
- `@agent-assistant/traits` to own runtime enrichment
- `@agent-assistant/core` to own turn shaping

## Why this package is the right seam

### Why not `harness`

Harness should remain the bounded turn executor.
It may consume prepared turn context, but it should not own:
- memory retrieval selection
- specialist enrichment selection
- product expression shaping
- session-aware tone assembly
- prompt-stack composition strategy

If harness owns those, “harness” becomes the overloaded umbrella again.

### Why not `traits`

Traits are stable identity data.
They answer: *how should this assistant generally present itself?*

Turn-context assembly answers a different question:

> Given stable identity plus live conditions, what should the assistant be given for this specific turn?

That requires turn-scoped composition, not just static data.

### Why not `core`

Core should remain the assistant lifecycle / dispatch shell.
Turn-context assembly is heavier and optional.
Not every assistant runtime will need the full enrichment model.

---

## 4. What this primitive owns

`@agent-assistant/turn-context` should own the **assembly contract**, not all upstream data systems.

### Owns

1. **Turn-context assembly pipeline**
   - gather inputs from stable identity, session context, runtime enrichment, and product shaping
   - normalize them into a single turn-ready contract

2. **Assistant-expression composition boundary**
   - combine stable identity with turn-scoped shaping
   - preserve a distinction between identity and transient enrichment

3. **Prepared context contract for visible turns**
   - context blocks intended for the visible assistant's next turn
   - structured enrichment fields intended for model/runtime consumers

4. **Enrichment provenance and salience metadata**
   - what source contributed a block or signal
   - how important / fresh / optional it is
   - whether it is user-visible, assistant-only, or product-internal

5. **Guardrail overlays for expression assembly**
   - constraints that shape the visible assistant's framing
   - examples: do not be overly jokey in serious contexts; keep tone formal for this workspace; avoid surfacing backstage speculation as fact

6. **Compatibility contract to harness**
   - a deterministic output that harness can consume without understanding the upstream enrichment topology

### Does not own

- model/tool execution loop
- continuation handling or stop semantics
- policy decision engine or approval workflow
- memory persistence or retrieval engine
- connectivity transport or signaling lifecycle
- coordination orchestration logic
- workforce persona definitions
- product business logic or UX branching

---

## 5. Relationship to adjacent packages

## `@agent-assistant/traits`

Traits provide the **base identity floor**.
Turn-context assembly reads them as stable defaults.

Traits are not overwritten by runtime enrichment.
Instead:
- traits define who the assistant is
- turn-context assembly defines how that identity is expressed on this turn

## `@agent-assistant/sessions`

Sessions provide continuity inputs such as:
- session id / thread id
- attached surface context
- recent turn posture
- continuation metadata
- session-local framing

Sessions do not decide expression.
Turn-context assembly may read session state and use it to shape:
- response directness
- amount of recap
- whether clarification is preferred
- whether the assistant should sound already-in-context or newly-entering

## `@agent-assistant/memory`

Memory provides candidate retrieval inputs.
Turn-context assembly decides which retrieved memory artifacts are useful for this turn and how to project them into:
- context blocks
- structured fields
- assistant-facing reminders

Memory stores and retrieves.
Turn-context assembly curates and packages.

## `@agent-assistant/policy`

Policy remains the owner of action governance.
Turn-context assembly may consume policy-derived framing inputs, such as:
- current approval constraints
- sensitivity classification summaries
- product-approved expression constraints

But it does not evaluate policy or replace approval logic.

## `@agent-assistant/harness`

Harness consumes turn-context output.
The output of this package should become the canonical upstream source for what harness currently receives as:
- `instructions`
- `context`
- related expression metadata

Important boundary:

> `HarnessPreparedContext` is a harness-facing payload shape, not the full missing primitive.

A useful v1 path is for `@agent-assistant/turn-context` to produce a richer output that can be losslessly projected into `HarnessPreparedContext` plus `HarnessInstructions`.

## Product code

Products still own:
- domain heuristics
- brand and product voice strategy
- prompt phrasing choices
- which integrations and backstage systems exist
- what counts as relevant enrichment
- commercial / business rules

The SDK owns the reusable assembly seam.
The product owns the content policy and domain strategy flowing through it.

---

## 6. Inputs this primitive composes

The primitive should explicitly support these input classes.

### A. Base identity

Stable assistant identity from product definition and traits:
- assistant id / name
- `TraitsProvider`
- stable voice defaults
- stable formality / proactivity / risk posture
- domain framing defaults
- surface-formatting defaults where relevant

### B. Product-owned behavioral shaping

Turn-scoped product intent that is not just raw traits:
- desired response style for this product flow
- domain/task mode for this turn
- tone adjustments for context
- product prompt fragments
- response contract hints
- audience framing

This remains product-authored, but the package should provide the slot for it.

### C. Session-aware continuity

Inputs derived from active conversation state:
- whether this is an ongoing thread or cold-open turn
- continuation payload presence
- current conversational momentum
- recent unresolved questions
- local thread posture

### D. Memory enrichment

Candidate memory artifacts such as:
- relevant session memory
- user preferences
- workspace memory
- prior decisions
- saved facts / summaries / reminders

### E. Supporting-agent / backstage enrichment

Structured internal inputs from coordination or connectivity:
- specialist memos
- handoffs
- review findings
- confidence flags
- urgency indicators
- backstage summaries
- proposed focus areas

### F. Live contextual enrichment

Runtime facts assembled elsewhere:
- current workspace state
- current document/repo context
- active tool-derived observations
- recent external data snapshots
- cultural/reference context from integrations

### G. Guardrails and coherence constraints

Inputs that shape expression without replacing identity:
- seriousness / sensitivity hints
- channel appropriateness
- workspace norms
- no-unverified-claims rule for backstage memos
- instructions to keep stable identity recognizable

---

## 7. Output contract

The package should produce a turn-scoped output contract that is richer than `HarnessPreparedContext`.

## Recommended v1 output shape

The exact type can evolve, but the output should include these sections.

### 1. Effective instructions

What the visible assistant should be told for this turn:
- base identity guidance
- product-specific developer guidance
- turn-scoped behavioral shaping
- guardrail overlays

### 2. Prepared context blocks

Human-readable context blocks for the next turn.
These should be curated, prioritized, and provenance-labeled.

### 3. Structured enrichment

Machine-readable fields for the harness/model adapter or downstream tools, such as:
- salience scores
- provenance records
- sensitivity flags
- source categories
- optional confidence summaries

### 4. Expression profile

A structured summary of the intended assistant expression for this turn.
For v1 this can stay simple, but it should exist explicitly so expression is not trapped in prompt text.
Examples:
- tone posture
- directness
- humor allowance
- explanation density
- initiative level

### 5. Projection fields for harness

A clear projection to:
- `HarnessInstructions`
- `HarnessPreparedContext`

This preserves clean backward compatibility with the existing harness contract.

---

## 8. Identity vs runtime enrichment rule

This primitive must follow one hard rule:

> Runtime enrichment informs identity expression for a turn; it does not replace assistant identity.

### Examples

- A specialist memo can make NightCTO sound more certain about an ops issue, but it should not make NightCTO stop sounding like NightCTO.
- A cultural/trend integration can make Sage more current in references, but it should not rewrite Sage into a different persona.
- A serious compliance context can suppress humor, but it should not replace the assistant's stable warmth or voice completely.

### Architectural implication

The output contract should preserve separation between:
- **identity-derived fields**
- **runtime-enrichment-derived fields**
- **product-authored overlays**

If these are collapsed into one flat prompt blob, future implementations will not be able to preserve identity precedence cleanly.

---

## 9. What remains product-owned

Even with this package, products still own:

- exact prompt text and prompt-stack authoring
- the strategy for when humor is desirable or inappropriate in their domain
- which backstage agents exist and what their outputs mean
- domain-specific enrichment ranking
- business/commercial escalation logic
- the final decision to include or exclude optional enrichment
- UX-specific mapping from assembled context into product response flows
- product-specific policy rules
- integration credentials and network calls

The SDK should not absorb Sage's, MSD's, or NightCTO's commercial distinctiveness.
It should only provide a reusable assembly seam.

---

## 10. Explicit non-goals

This primitive is **not**:

- a memory engine
- a policy engine
- a prompt-management CMS
- a specialist orchestrator
- a model router
- a tool registry
- a persona system
- a background agent platform
- a replacement for product prompt craftsmanship
- an excuse to move product business logic into the SDK

It also should not promise:
- perfect ranking of enrichment relevance
- fully automatic product personality generation
- universal prompt composition across all products

---

## 11. Useful v1 definition of done

A useful v1 is done when the repo has:

1. A dedicated package boundary: `@agent-assistant/turn-context`
2. A typed input contract covering:
   - traits / base identity
   - product-owned shaping
   - session inputs
   - memory candidates
   - enrichment candidates
   - guardrail overlays
3. A typed output contract covering:
   - effective instructions
   - prepared context blocks
   - structured enrichment
   - harness projection
4. An explicit rule that runtime enrichment cannot replace identity
5. A clean statement of what is still product-owned
6. A compatibility story with `@agent-assistant/harness`
7. At least one documented assembly flow from product inputs to harness-ready output
8. Explicit non-goals preventing package sprawl

Implementation is not required for this documentation slice.

---

## 12. Concrete recommendation

The missing primitive should now be named and treated explicitly as:

> **`@agent-assistant/turn-context` — the assistant turn-context / enrichment assembly primitive**

That package should be the canonical place where:
- stable assistant identity
- product-authored shaping
- session continuity
- memory retrieval output
- backstage specialist input
- live runtime enrichment
- expression guardrails

are assembled into the visible assistant's effective turn context.

The harness should then consume that result, not define it.
