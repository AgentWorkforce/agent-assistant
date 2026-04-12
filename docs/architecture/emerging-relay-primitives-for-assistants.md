# Emerging Relay Primitives for Assistants

Date: 2026-04-12

## Purpose

Capture the primitive categories that appear to be emerging as Relay and RelayAssistant evolve from messaging/runtime infrastructure into a broader assistant operating substrate.

## Current visible primitives

### Relayauth
Primary role:
- identity
- authentication
- principals
- claims
- memberships
- access-boundary inputs

Core question answered:
- **who is this principal and what are they allowed to access?**

### Relaycast
Primary role:
- communication and signaling substrate
- channelized interaction
- runtime event flow
- workspace presence and observation

Core question answered:
- **who is signaling, to whom, and through what channel/context?**

### Relayfile
Primary role:
- durable file/document/artifact substrate
- object movement and externalizable storage
- assistant-accessible durable artifacts

Core question answered:
- **what durable artifacts exist and how are they accessed?**

## Additional primitive families that are emerging

These may not all require standalone repos immediately, but they are becoming distinct enough that the architecture should treat them as real primitive categories.

### 1. Memory
Core concerns:
- scope-aware persistence
- provenance
- promotion
- compaction
- forgetting/supersession later
- private/shared compartments
- assistant-facing retrieval contracts

Core question answered:
- **what persists semantically over time, and in which compartment?**

Why it matters:
- storage and retrieval alone are not enough
- assistants need structured continuity, not just searchable logs

### 2. Time / scheduling / wake-up
Core concerns:
- reminders
- follow-up timers
- watch rule wake-ups
- delayed work
- periodic re-evaluation
- background cadence

Core question answered:
- **when should something happen again?**

Why it matters:
- proactive assistants depend on temporal orchestration
- this is not reducible to messaging or memory alone

### 3. Policy / governance
Core concerns:
- allow / deny / escalate decisions
- approvals
- risk/action classes
- trust levels
- audit hooks
- privacy boundaries

Core question answered:
- **what is allowed, what requires approval, and what must be logged or suppressed?**

Why it matters:
- proactive and background agents need governance
- private/shared compartment models depend on explicit policy boundaries

### 4. Coordination / consensus
Core concerns:
- specialist orchestration
- synthesis
- delegation
- deliberation protocols
- structured decision-making
- consensus/revote patterns later

Core question answered:
- **how do multiple agents work together to produce one accountable outcome?**

Why it matters:
- assistant systems increasingly rely on multi-agent work behind one visible identity
- this becomes more than app glue once it is reused across products

### 5. Librarian / synthesis / curation
Core concerns:
- memo collection
- deduplication
- reconciliation
- relevance ranking
- promotion into durable memory
- backstage context preparation for the visible assistant

Core question answered:
- **what deserves elevation, consolidation, or attention?**

Why it matters:
- a long-lived assistant likely needs a backstage curation layer
- neither raw storage nor naive retrieval is enough

## A practical primitive stack

A useful working stack is:

- **Auth** — who is this? (`relayauth`)
- **Cast** — who is signaling to whom? (`relaycast`)
- **File** — what artifacts exist? (`relayfile`)
- **Time** — when should something happen? (relay scheduling substrate)
- **Memory** — what persists semantically? (assistant memory layer)
- **Policy** — what is allowed? (assistant policy layer)
- **Coordination** — how do many agents work together? (assistant coordination layer)
- **Librarian** — what gets elevated or ignored? (future synthesis layer)

## Important caution

Not every primitive family needs its own top-level repo immediately.

Some should begin as:
- packages inside RelayAssistant
- packages inside existing Relay-family repos
- explicit architectural layers before they become standalone products

The key is to recognize them early enough that they are designed intentionally rather than emerging accidentally as scattered application logic.

## Design conclusion

Relay is already more than a transport/messaging system.
RelayAssistant is revealing which additional primitive families are necessary for real assistant operating systems.

The most obvious emerging primitives are:
- memory
- policy
- time/scheduling
- coordination/consensus
- librarian/synthesis

These should be treated as first-class architectural categories even if their final repo/package boundaries continue evolving.
