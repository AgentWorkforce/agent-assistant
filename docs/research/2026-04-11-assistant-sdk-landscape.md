# Assistant SDK Landscape Research

Date: 2026-04-11

## Goal

Understand how existing systems handle:

- memory
- proactivity
- cross-device / cross-surface continuity
- session routing
- multi-agent coordination
- always-on behavior
- assistant identity / consistency

And determine whether AgentWorkforce should create a dedicated shared assistant SDK/runtime.

---

## External systems reviewed

### OpenClaw

Observed strengths:
- always-on local-first gateway/control plane
- wide messaging/channel support
- session routing and multi-agent routing
- cron/wakeups/webhooks
- workspace/context shaping
- companion-device continuity

Most useful ideas:
- the assistant is a runtime, not just a prompt loop
- sessions/channels/cron/tools are first-class primitives
- surface continuity matters as much as model quality

Limitations relative to our goal:
- broad and product-heavy rather than a crisp reusable assistant SDK
- less clear separation between universal assistant primitives and product-specific behavior

### Hermes Agent

Observed strengths:
- persistent memory and user modeling
- scheduled automations / cron
- messaging gateway
- subagents / delegation
- cross-session continuity
- not tied to one local laptop

Most useful ideas:
- memory and learning are central, not optional
- scheduled background behavior is part of the product, not an afterthought
- the assistant can run anywhere while preserving continuity across surfaces

Limitations relative to our goal:
- also framed as a full agent product/runtime rather than a shared relay-native SDK
- less centered on relay-style agent-to-agent communication as the architectural core

### General ecosystem pattern

The strongest recurring themes across current assistants/frameworks are:
- persistent memory
- proactive scheduled behavior
- multiple surfaces/channels
- session continuity
- tool use and delegation
- safety / approval boundaries

What still appears under-served is a clean SDK specifically for:
- relay-native assistant communication
- many-agent / one-assistant architecture
- cross-surface continuity
- reusable assistant traits across multiple domain products

---

## Internal AgentWorkforce systems reviewed

### relay

Important existing primitives already live in `AgentWorkforce/relay`, especially `packages/gateway`.

What exists today:
- surface adapters for Slack / Telegram / WhatsApp
- normalized inbound message model
- outbound delivery abstraction
- rules engine
- action model (`spawn_agent`, `message_agent`, `post_comment`, `create_issue`, custom action)
- `Gateway` router for verify → parse → normalize → match rules → emit actions

Implication:
- relay already provides strong low-level communication, routing, and action-dispatch primitives
- a future assistant SDK should sit **above** relay rather than rebuilding these foundations

### sage

Observed assistant traits already present:
- persistent memory (`SageMemory`, `OrgMemory`)
- context load/save across threads/workspaces
- proactive follow-ups
- stale-thread detection
- PR matching
- context watching
- Slack-centered surface behavior with room for expansion

Implication:
- Sage is an important reference implementation for memory + proactive runtime behavior
- these should be generalized rather than left app-specific

### My-Senior-Dev (MSD)

Observed architecture direction in docs:
- surface-agnostic review runtime
- shared session across multiple surfaces
- relay channels as the coordination primitive
- notifier / orchestrator / adapter roles
- proactive review operations
- runtime heartbeat / lease / assignment model
- review memory and preferences

Important file:
- `docs/architecture/shared-chat-surface.md`

Implication:
- MSD already contains a strong design for multi-surface runtime + session convergence
- many of these concepts are broader than MSD and should likely move into a shared assistant runtime

### NightCTO

NightCTO adds another strong signal that a shared SDK is needed.

Observed repo/runtime concepts:
- OpenClaw agent runtime per client
- Supermemory per-client persistent memory containers
- Communicate SDK for founder ↔ CTO interaction patterns
- agent-relay / relaycast channels as the coordination layer
- cron-triggered proactive monitoring
- shared specialist sandboxes
- specialist registry + dispatch
- model routing / triage hooks
- webhook ingestion / alert evaluation / digest flows
- runtime heartbeat concepts in the broader workflow program

Particularly important:
- NightCTO is explicitly architected around multiple specialist agents behind one per-client CTO surface
- this maps directly to the “many agents, one assistant” model

Implication:
- NightCTO is not just another app; it is a proof that shared assistant-runtime concepts are multiplying across products
- once Sage + MSD + NightCTO all need these foundations, a shared SDK becomes essential

---

## Synthesis

### What seems universal

The following traits appear to be universal assistant concerns across products:

1. Identity / voice consistency
2. Persistent memory
3. Session continuity
4. Multi-surface delivery and normalization
5. Proactivity / scheduled behavior
6. Coordination across multiple internal specialist agents
7. Action gating / policy / auditability
8. Runtime assignment / wake / routing

### What seems product-specific

- MSD-specific review intelligence and PR operations
- Sage-specific knowledge/search/conversation workflows
- NightCTO-specific founder/CTO interaction patterns and specialist lineup

### Architectural takeaway

AgentWorkforce should likely formalize a new layer:

- **relay foundation** → communication, gateway, auth, cron, channels
- **assistant runtime / SDK** → memory, proactivity, identity, sessions, surfaces, coordination, policy
- **product agents** → Sage, MSD, NightCTO, future domain assistants

---

## Provisional conclusion

There does not appear to be a clean existing open-source project that already provides the exact thing we need:

> a relay-native assistant SDK for persistent, proactive, multi-surface, many-agent assistants that feel like one coherent assistant.

There are adjacent systems, but the package boundary we want still appears open.

That makes a new repo justified.
