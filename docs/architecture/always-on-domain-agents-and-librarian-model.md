# Always-On Domain Agents and Librarian Model

Date: 2026-04-12

## Why this note exists

RelayAssistant should not assume that the visible assistant is the only active intelligence in the system.

A more capable long-lived assistant may be better modeled as:
- one **visible assistant identity** that speaks to the user
- many **domain agents** that continuously observe, fetch, encode, and prepare relevant material
- one or more **librarian / synthesis layers** that decide what should be elevated, remembered, surfaced, or ignored

This note captures that architecture direction.

## Core mental model

### 1. The visible assistant is the actress
The user experiences one assistant identity:
- one voice
- one persona
- one conversation thread
- one accountable surface presence

This visible assistant is the front-stage actor.

### 2. The library is backstage
Behind the visible assistant, the system may maintain a library of:
- fetched facts
- domain updates
- watch-state changes
- candidate reminders
- summaries
- memos from specialists
- synthesized interpretations
- provenance-linked memory artifacts

The user does not need to interact with this library directly for it to be useful.

### 3. Domain agents are always-on background workers
Domain agents should be able to work continuously rather than only waking up when directly addressed.

Examples:
- a finance agent keeps up with billing, balances, and anomalies
- a work agent watches PRs, issues, and inbox state
- a family/home agent keeps track of schedule changes, errands, and reminders
- a research agent watches selected topics and accumulates updates

These agents are not necessarily always speaking. They are always *maintaining situational awareness*.

## Key architectural question

How do hive/domain agents relate to the main assistant?

There should not be only one answer. RelayAssistant should support multiple interaction modes.

## Interaction modes

### A. Memo mode
Domain agents prepare structured memos for the main assistant.

Pattern:
1. domain agent observes or infers something relevant
2. domain agent writes a memo / update artifact
3. memo is stored or queued with provenance and relevance metadata
4. visible assistant consumes the memo when needed

Good for:
- low urgency observations
- periodic summaries
- background research
- preserving specialist findings without interrupting the user

### B. Debate mode
Multiple agents deliberate among themselves before anything reaches the visible assistant.

Pattern:
1. question/problem is posed
2. specialists discuss, compare, challenge, or estimate
3. output is synthesized into a recommendation or dissent set
4. visible assistant receives the synthesized result

Good for:
- planning
- estimation
- conflicting interpretations
- strategy or triage decisions

This is where future consensus / decision protocols become important.

### C. Direct advisory mode
A domain agent can directly signal the visible assistant when urgency or confidence is high.

Pattern:
1. domain agent detects a condition that crosses a threshold
2. it emits an advisory signal with evidence and confidence
3. policy decides whether the assistant should surface it now, later, or never

Good for:
- urgent alerts
- user-critical reminders
- safety-relevant signals
- time-sensitive updates

### D. Librarian-mediated mode
Domain agents do not communicate directly to the visible assistant at all.
Instead, they write into a librarian layer that curates and elevates only what matters.

Pattern:
1. domain agents produce observations, memos, candidates, and updates
2. librarian groups, deduplicates, ranks, and contextualizes them
3. only curated material is exposed to the visible assistant

Good for:
- high-volume systems
- noisy environments
- multi-domain personal assistants
- long-horizon memory consolidation

## What the librarian does

The librarian is not just storage.
It is a curation and synthesis layer.

Possible responsibilities:
- collect outputs from domain agents
- deduplicate repeated observations
- reconcile conflicting reports
- attach provenance and confidence
- decide whether a fact is ephemeral, durable, or actionable
- prepare user-facing summaries or assistant-facing context bundles
- promote information into longer-term memory when appropriate
- support forgetting/supersession later

This is closely related to future cross-agent memory consolidation.

## Domain agents as always-on context builders

The important idea is that domain agents do not exist only to answer direct tasks.
They can continuously:
- fetch new information
- encode signals into structured artifacts
- monitor for change
- maintain local state
- produce periodic or event-driven memos
- raise candidates for reminders or proactive actions

This makes the assistant feel less like a stateless chatbot and more like a living system with ongoing awareness.

## Boundaries and risks

Always-on domain agents create power and risk at the same time.

### Benefits
- better situational awareness
- reduced cold-start cost per query
- more continuity across time
- domain specialization without fragmenting the user-facing identity
- richer proactive behavior

### Risks
- noisy or excessive background activity
- runaway accumulation of low-value memory
- stale or conflicting derived state
- too many agents trying to influence the visible assistant
- unclear accountability for what gets surfaced to the user

That means this model depends on:
- policy gating
- librarian/synthesis controls
- provenance and confidence tracking
- explicit relevance thresholds
- careful forgetting/supersession semantics over time

## Relationship to current RelayAssistant packages

### Coordination
Coordination manages specialist orchestration and synthesis. It is the closest current home for domain-agent interaction patterns.

### Connectivity
Connectivity handles signaling and convergence. It can carry advisory signals, memo publication, and escalation events.

### Proactive
Proactive decides when the assistant should act without a direct prompt. Domain agents can feed it candidate conditions and signals.

### Memory
Memory stores source and derived artifacts with provenance. The librarian model likely builds on top of this rather than replacing it.

### Policy
Policy should decide which background findings can surface directly, which need approval, and which should remain backstage.

### Consensus (future)
Debate mode and structured multi-agent decisions belong here.

## Recommended staged roadmap

### Near-term
- keep one visible assistant identity
- allow bounded specialist memo production
- use coordination/connectivity for specialist signaling
- let proactive consume selected background signals

### Mid-term
- introduce explicit librarian/synthesis behavior
- support memo ranking, deduplication, and promotion
- define when specialists can signal directly vs. only through curation

### Later
- add richer consensus/debate protocols
- add cross-agent memory consolidation
- add more sophisticated always-on domain-agent ecosystems

## Design stance

RelayAssistant should eventually support a system where:
- the visible assistant is not the only thinking component
- background domain agents are continuously maintaining awareness
- a librarian/synthesis layer decides what rises to attention
- the user still experiences one coherent assistant identity

That is a stronger and more realistic architecture than pretending long-lived intelligence comes from one monolithic conversational loop.


## Per-user personal agents, company agents, and privacy-scoped memory

A practical deployment model is not one universal assistant with one flat memory. It is a network of assistant identities with overlapping but non-identical access patterns.

Example shape:
- each human user has a **personal agent** they can interact with privately over direct surfaces like Telegram or WhatsApp
- an organization also has one or more **company agents** that users interact with in shared work surfaces like Slack
- these agents may share some context and capabilities, but they should not share memory indiscriminately

### Memory implications

RelayAssistant memory should model at least these layers clearly:
- **personal/private user memory** — only visible to that user's personal assistant context
- **shared company memory** — relevant across company agents and shared work contexts
- **session/thread memory** — local to a specific conversation or surface thread
- **agent/library memory** — backstage memos, domain observations, and synthesis artifacts

### Unification without privacy collapse

The system should support unified identity where useful while still preserving privacy boundaries.

Examples:
- the same human can interact with a personal agent on Telegram and a company agent on Slack
- both systems may know they refer to the same human identity
- but the company agent should not automatically gain access to the person's private personal-memory room
- selective promotion or projection from personal -> shared must be explicit and policy-controlled

### Memory rooms / compartments

A useful design metaphor is a memory palace or room model:
- each user has private rooms
- each company/workspace has shared rooms
- conversations open temporary rooms
- librarian/domain agents can move, summarize, or reference material across rooms only with the right scope and policy

This maps well onto RelayAssistant's scope-oriented memory direction:
- session scope
- user/private scope
- workspace/org scope
- future backstage/library scopes

The important principle is:
**identity can be unified while memory visibility stays compartmentalized.**

### Architectural consequence

RelayAssistant should eventually support:
- one human having multiple assistant touchpoints
- scoped memories per touchpoint and trust domain
- explicit promotion/bridging between private and shared memory spaces
- policy-controlled privacy boundaries between personal and company assistants
- librarian-aware compartmentalization rather than one flat memory pool
