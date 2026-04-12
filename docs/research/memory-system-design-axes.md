# Memory System Design Axes

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-12

## Why this doc exists

Long-term conversational memory for assistants remains unsolved. The practical design problem is not choosing a single perfect memory strategy. It is choosing a coherent set of trade-offs across multiple design axes while preserving enough provenance, adaptability, and retrieval quality to remain useful over time.

RelayAssistant should treat memory as a trade-off system, not a solved component.

## Core framing: raw vs. derived

There are two broad classes of memory artifacts:

### Raw
Original material captured with minimal interpretation.

Examples:
- source messages
- transcript excerpts
- direct event logs
- verbatim user notes
- original assistant outputs

Properties:
- high fidelity
- good provenance
- expensive to search and reason over at scale
- inert without additional interpretation or indexing

### Derived
Artifacts produced by interpreting or compressing raw material.

Examples:
- summaries
- compactions
- extracted preferences
- profiles
- narratives
- relationship maps
- future graph-style entity structures

Properties:
- more usable and compact
- easier to retrieve and act on
- vulnerable to drift, over-inference, and compounding loss

### RelayAssistant position

Neither raw nor derived is sufficient by itself.

RelayAssistant should aim for:
- provenance-preserving derivation
- source-linked summaries and compactions
- re-derivable abstractions where practical
- explicit supersession/correction handling
- bounded derivation rather than unconstrained memory narration

## Memory design axes

Every memory system makes choices across a stable set of axes.

### 1. What gets stored
- raw only
- derived only
- mixed raw + derived

RelayAssistant direction:
- mixed, with reuse-first storage over `@agent-relay/memory`
- explicit provenance fields so derived artifacts can point back to source material

### 2. When derivation happens
- write time
- scheduled background compaction
- retrieval time
- hybrid

RelayAssistant direction:
- bounded hybrid
- allow write-time direct entries plus scheduled compaction and later assistant-side summarization

### 3. What triggers a write
- every turn
- explicit user intent (`remember this`)
- policy/rule-triggered capture
- scheduled background inference
- human curation

RelayAssistant direction:
- explicit writes + bounded rule-triggered writes first
- avoid unconstrained always-write behavior in v1

### 4. Where it gets stored
- filesystem/doc store
- relational database
- vector store
- graph store
- multiple backends

RelayAssistant direction:
- reuse-first via `@agent-relay/memory`
- do not assume vector DB or graph DB as the primary identity of the memory layer

### 5. How it gets retrieved
- exact lookup
- scoped list/filter
- semantic search
- graph traversal
- active file exploration

RelayAssistant direction:
- scoped retrieval first
- retrieval strategy should remain adaptable behind the assistant-facing contracts

### 6. Post-retrieval processing
- reranking
- deduplication
- filtering by recency or scope
- confidence/provenance checks
- compaction-aware narrowing

RelayAssistant direction:
- retrieval quality should not rely on retrieval alone
- post-processing is a first-class part of memory usefulness

### 7. When retrieval happens
- always injected into every turn
- hook-driven/background retrieval
- tool-driven retrieval
- hybrid

RelayAssistant direction:
- hybrid over time
- avoid unconditional always-injected memory pollution
- support explicit retrieval plus selective policy/proactive-triggered retrieval later

### 8. Who curates memory
- user
- main assistant model
- cheap support model
- scheduled compactor/librarian
- human operator

RelayAssistant direction:
- mixed curation
- user intent and bounded runtime rules first
- more advanced librarian-style curation deferred to later roadmap phases

### 9. Forgetting policy
- hard delete
- expiry/TTL
- supersession
- archival
- recomputation from raw corpus
- provenance-aware cascade delete

RelayAssistant direction:
- treat forgetting as a first-class design problem
- provenance and supersession should shape future forgetting behavior

## Evaluation paradox

Memory is harder to evaluate than retrieval.

Why:
- the true ground truth for long-horizon memory is the evolving full relationship history
- the significance of an event may only become clear much later
- facts can be revised, contradicted, or superseded
- synthetic benchmarks capture slices of recall but not evolving meaning over time

RelayAssistant implication:
- benchmark retrieval and scoped behaviors where possible
- remain honest that long-horizon memory quality is only partially benchmarkable
- design for inspectability and provenance, not just benchmark wins

## Common failure modes

These failure modes should explicitly inform package and roadmap design.

- **session amnesia** — no continuity between sessions
- **entity confusion** — people, projects, or concepts are merged incorrectly
- **over-inference** — plausible guesses are stored as facts
- **derivation drift** — repeated summarization diverges from the source
- **retrieval misfire** — semantically close but contextually wrong memory is surfaced
- **stale context dominance** — old memories crowd out more relevant recent ones
- **selective retrieval bias** — relevant memory is invisible under a different framing
- **compaction information loss** — useful detail disappears into summaries
- **confidence without provenance** — no way to verify where a memory came from
- **memory-induced bias** — assistant responses become over-colored by remembered context

## Roadmap implications for RelayAssistant

### v1 / near-term
- reuse-first assistant-facing memory layer over `@agent-relay/memory`
- scope-aware writes, retrieval, promotion, compaction
- strong provenance and metadata preservation
- bounded compaction and summarization contracts

### later
- better forgetting semantics
- supersession/correction propagation
- richer retrieval/re-ranking strategies
- assistant-side memory quality instrumentation
- librarian / cross-agent consolidation and reconciliation

## Important product stance

RelayAssistant should not claim that conversational memory is solved.

A stronger and more honest claim is:
- RelayAssistant provides a structured, provenance-aware memory substrate
- it is designed around explicit trade-offs
- and it leaves room for more advanced consolidation and evaluation layers over time


## Compartmentalized memory and room models

Another important design axis is whether memory is treated as one flat pool or as a set of rooms/compartments with different visibility rules.

RelayAssistant should favor compartmentalized memory over a flat memory pool.

Examples:
- a user can have a private personal-memory room used by their direct agent on Telegram or WhatsApp
- the same user can participate in a shared company-memory room through a Slack-facing company agent
- backstage/librarian/domain-agent rooms can hold memos and synthesized observations that are not automatically visible to every assistant context

This means a strong memory system needs not just retrieval and provenance, but also:
- visibility boundaries
- explicit promotion/projection across rooms
- identity linkage without privacy collapse
- policy-controlled access to compartmented memory
