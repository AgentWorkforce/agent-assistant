# Relay-native agents vs harness subagents decision

## Status

Accepted direction for Agent Assistant, Sage, and NightCTO.

## Decision

We should treat **Relay-native actual agents** as the default architecture for real multi-agent collaboration, and treat **harness subagents** as an execution aid rather than the core collaboration model.

In short:

- **Relay-native agents are for collaboration**
- **harness subagents are for execution assistance**
- **execution backend choice and collaboration topology are separate decisions**

We should stand by the Relay-native direction, but use it deliberately rather than turning every helper task into a first-class agent.

## Why this matters

Many harnesses offer subagents. Those are useful, but they usually behave like helper executions owned by a parent run.

That is not the same thing as what Sage and NightCTO are trying to become.

The architecture we are building requires:
- stable product identity
- durable collaboration roles
- structured evidence exchange
- agent-to-agent communication
- proactive behavior triggered by real-world events
- execution backend flexibility without losing product shape

That set of requirements points toward Relay-native collaborating agents, not subagents alone.

## Definitions

### Relay-native actual agents

Addressable participants that collaborate through Relay-native transport and coordination primitives.

Properties:
- product-meaningful identity
- agent-to-agent communication
- can own role-specific behavior
- can exchange structured findings/evidence
- can participate proactively when events arrive
- can outlive a single parent run or execution session

Examples:
- GitHub investigator
- observability investigator
- evidence librarian
- future planning or Notion specialist

### Harness subagents

Execution helpers spawned within a harness/runtime to do bounded work on behalf of a parent.

Properties:
- usually ephemeral
- primarily execution-oriented
- commonly scoped to one parent run
- weaker identity and continuity
- weaker fit for durable collaboration and cross-agent evidence exchange

Examples:
- one-shot coding helper
- repo review helper
- bounded research worker
- implementation or summarization worker

## Decision drivers

### 1. Product identity must remain canonical

Sage should remain Sage.
NightCTO should remain NightCTO.

Execution can vary underneath, but the product should not be redefined by whichever harness or provider happens to execute a turn.

Relay-native specialists preserve this better because the product remains the orchestrator of an actual collaborating system.

### 2. Collaboration is a first-class requirement

The system direction is not just “one assistant with helper calls.”
It is:
- orchestrator + specialists
- agent-to-agent communication
- durable/shared evidence
- future multi-turn and proactive collaboration

That is a better fit for real agents than for harness-only subagents.

### 3. relayfile-backed evidence matters

We explicitly want durable, shared evidence between agents where needed.
That architecture fits naturally with actual agents exchanging findings and artifacts.
It is much less natural if every helper is just an internal child execution.

### 4. Proactivity requires more than helper execution

A real specialist may need to act when the world changes, not only when the parent asks a question.

Example:
- a GitHub specialist receives or is informed about a webhook that a PR merged
- the specialist recognizes the event matters
- it can produce a structured finding or alert candidate for the product orchestrator
- Sage or NightCTO can decide whether and how to tell the user

That is materially easier to model if the specialist is an actual agent role, not just a helper subprocess.

### 5. Execution must remain replaceable

The system should support:
- direct API / OpenRouter execution
- BYOH harness execution

Those are execution-plane choices.
They should not replace the collaboration fabric.

## Pros of Relay-native actual agents

### Real collaboration

Relay-native agents are actual participants, not merely helper invocations.
This makes it easier to model:
- addressing
- role ownership
- structured inter-agent communication
- durable evidence exchange
- specialist follow-up and reuse

### Better separation of concerns

Relay-native agents let us keep these layers separate:
- turn-context
- execution backend
- collaboration topology
- policy and delivery

### Stronger proactive model

A true specialist can become event-aware and proactive.
That matters for:
- GitHub events
- observability/runtime events
- future external signal ingestion

### Better long-term product differentiation

Many products can wrap a harness with subagents.
Fewer products provide a coherent collaboration fabric with durable agent roles.

### Better fit for NightCTO and Sage

NightCTO especially benefits from runtime-aware specialists.
Sage benefits from specialized investigators and evidence-producing collaborators.

## Cons of Relay-native actual agents

### More system complexity

This path requires real solutions for:
- addressing
- lifecycle
- startup
- retries/timeouts
- dedupe
- coordination semantics
- evidence routing
- debugging and observability

### Heavier operator ergonomics

Local and hosted usability is harder than with in-harness helpers.

### Easier to overuse

Not every helper needs to be a real agent.
If we over-agentize trivial tasks, we add ceremony without enough value.

### More failure modes

Actual multi-agent systems have more ways to fail than a single runtime with internal helpers.

## Pros of harness subagents

### Fast and simple

For bounded work, harness subagents are often cheaper to reason about and easier to run.

### Good for execution-heavy tasks

They work well when the need is simply:
- inspect this repo
- implement this change
- review this diff
- summarize this material

### Lower operational overhead

No separate collaboration substrate is required for many simple cases.

## Cons of harness subagents

### Weak collaboration model

They are usually subordinate helper executions, not durable peers.

### Weak identity and continuity

They do not naturally model product roles with persistence across runs and events.

### Weaker proactive/event-driven fit

If a specialist should respond to external events or produce ongoing findings, harness subagents are usually an awkward fit.

## Rule of use

### Use Relay-native actual agents when:
- the participant has a durable product role
- collaboration matters more than mere parallelism
- evidence should persist or be shareable
- the participant may act proactively on external events
- identity, addressing, or routing matters
- the product is orchestrating a real specialist team

### Use harness subagents when:
- the helper is ephemeral
- the problem is execution-heavy rather than role-heavy
- no durable collaboration model is needed
- the work is bounded and parent-owned

## Explicit example: proactive GitHub specialist

A GitHub specialist should not be thought of only as a reactive PR investigator.
It can also be proactive.

Example event flow:
1. a trusted GitHub webhook or other ingress event indicates a PR merged
2. the GitHub specialist receives or is informed about the event
3. it determines whether the event matters to the user
4. it produces structured findings, evidence, or an alert candidate
5. the user-facing orchestrator decides whether and how to notify the user

This is a strong argument for modeling some specialists as actual agents instead of helper executions.

## What this decision does not mean

- it does not mean every helper must become a Relay agent
- it does not mean Relay must execute every turn
- it does not mean BYOH is unimportant
- it does not mean direct API execution is second-class

It means:
- collaboration should stay Relay-native when the system is genuinely multi-agent
- execution remains a replaceable plane underneath
- products should not collapse collaboration design into harness convenience

## Consequences

### For Agent Assistant

Agent Assistant should document and preserve:
- Relay-native collaboration as the default multi-agent model
- direct API and BYOH harnesses as execution backends
- a clear separation between collaboration, execution, turn-context, and policy

### For Sage

Sage should continue acting as the user-facing orchestrator with Relay-native specialists where the role is real, especially for GitHub investigation and future proactive GitHub awareness.

### For NightCTO

NightCTO should continue adopting Relay-native specialist roles for observability/runtime work where durable identity, proactive signals, and structured evidence matter.

## Review trigger

Revisit this decision only if:
- Relay-native collaboration proves too operationally heavy for real product use, or
- harness subagents demonstrably cover durable identity, proactive event handling, and shared evidence exchange without architectural distortion

Until then, the current direction remains the correct one.
