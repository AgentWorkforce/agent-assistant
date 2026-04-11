---BUILD AN ASSISTANT---
# How To Build An Assistant

Date: 2026-04-11

## Purpose

This document explains how a consumer should think about building an assistant on top of this SDK once implementation begins.

It is intentionally architectural. It does not assume package code exists yet.

## Start With One Assistant Definition

A product should model one user-facing assistant as:

- one assistant identity
- one assistant session model
- zero or more internal specialists
- optional memory and proactive capabilities

The external user experience should remain one coherent assistant even if multiple internal runtimes contribute.

## Expected Package Imports

Consumers should expect to import only the packages they need.

Typical import shape:

```ts
import { createAssistant } from "@relay-assistant/core";
import { createSessionStore } from "@relay-assistant/sessions";
import { createSurfaceConnection } from "@relay-assistant/surfaces";
import { createMemoryStore } from "@relay-assistant/memory";
import { createProactiveEngine } from "@relay-assistant/proactive";
import { createCoordinator } from "@relay-assistant/coordination";
import { createConnectivityLayer } from "@relay-assistant/connectivity";
import { createActionPolicy } from "@relay-assistant/policy";
```

The names above are illustrative. They describe intended package ownership, not implemented APIs.

## Minimum Build Order

Build an assistant in this order:

1. define the assistant identity and runtime boundary in `@relay-assistant/core`
2. define how inbound activity maps into an assistant session via `@relay-assistant/sessions`
3. attach surfaces through `@relay-assistant/surfaces`
4. add memory via `@relay-assistant/memory` if continuity is needed
5. add proactive behavior via `@relay-assistant/proactive` if the assistant should act when the user is not actively messaging
6. add specialist orchestration via `@relay-assistant/coordination` if one assistant needs multiple internal agents
7. add focused internal signaling via `@relay-assistant/connectivity` when multiple subsystems or specialists must coordinate efficiently
8. govern external actions with `@relay-assistant/policy`

## What The Product Must Supply

The SDK should not replace product logic.

Each product still supplies:

- domain prompts and instruction sets
- product-specific tools and workflows
- domain-specific watcher definitions
- UI or surface presentation choices
- business policy and escalation rules

## Recommended Mental Model

Think in three layers:

### Layer 1: Relay foundation

Use Relay family repos for transport, webhook verification, delivery, auth, scheduler substrate, and low-level action dispatch.

### Layer 2: Assistant SDK

Use this repo for assistant runtime contracts and reusable assistant behavior.

### Layer 3: Product assistant

Use the product repo for the actual product experience.

## Basic Assembly Pattern

A typical product should assemble an assistant as follows:

1. define an assistant identity and capabilities
2. provide a session strategy
3. connect one or more surfaces
4. optionally provide memory adapters
5. optionally provide proactive engines and watcher rules
6. optionally provide specialist registry and synthesis policy
7. optionally provide focused internal connectivity rules for fast convergence across specialists
8. register action policy and audit hooks

## Skeletal Assembly Example

```ts
import { createAssistant } from "@relay-assistant/core";
import { createSessionStore } from "@relay-assistant/sessions";
import { createSurfaceConnection } from "@relay-assistant/surfaces";
import { createMemoryStore } from "@relay-assistant/memory";
import { createProactiveEngine } from "@relay-assistant/proactive";
import { createCoordinator } from "@relay-assistant/coordination";
import { createConnectivityLayer } from "@relay-assistant/connectivity";
import { createActionPolicy } from "@relay-assistant/policy";

const assistant = createAssistant({
  id: "msd-review-assistant",
  name: "MSD",
  capabilities: ["review", "session-continuity", "proactive-follow-up"],
});

const sessions = createSessionStore();
const memory = createMemoryStore({ scopes: ["user", "workspace", "object"] });
const proactive = createProactiveEngine();
const coordinator = createCoordinator();
const connectivity = createConnectivityLayer({ mode: "focused-coordination" });
const policy = createActionPolicy({ mode: "suggest-or-ask" });

assistant.useSessions(sessions);
assistant.useMemory(memory);
assistant.useProactive(proactive);
assistant.useCoordinator(coordinator);
assistant.useConnectivity(connectivity);
assistant.usePolicy(policy);
assistant.attachSurface(createSurfaceConnection({ type: "slack" }));
assistant.attachSurface(createSurfaceConnection({ type: "web" }));
```

The code above is illustrative only. It shows intended composition, not final APIs.

## Graceful Degradation Guidance

Consumers should assume that some assistant subsystems will be temporarily unavailable.

Examples:
- if memory is unavailable, the assistant should continue with reduced continuity rather than fail closed for every request
- if proactive scheduling is unavailable, inbound interactions should still work normally
- if coordination fails mid-turn, the assistant should prefer a narrower single-agent answer over total failure when safe
- if one surface is degraded, the session should remain intact for other attached surfaces

## What To Avoid

Do not:

- couple assistant runtime contracts directly to one surface
- put domain logic into shared SDK packages just because multiple products need something vaguely similar
- bypass session contracts by using raw thread IDs as the only continuity key
- assume any future cloud service exists

## Product Examples

### Sage-style assistant

Use:

- `core`
- `sessions`
- `surfaces`
- `memory`
- `proactive`

Keep in Sage:

- knowledge and workspace-specific prompt behavior
- product-specific follow-up heuristics

### MSD-style assistant

Use:

- `core`
- `sessions`
- `surfaces`
- `memory`
- `coordination`
- `connectivity`
- `policy`

Keep in MSD:

- review-specific tools
- PR and code-review heuristics

### NightCTO-style assistant

Use:

- `core`
- `sessions`
- `surfaces`
- `memory`
- `proactive`
- `coordination`
- `connectivity`
- `policy`

Keep in NightCTO:

- founder-facing service behavior
- specialist lineup choices
- business escalation and client-tier rules

---INTERNAL COMPARISON---
# Internal System Comparison

Date: 2026-04-11

## Purpose

Compare current internal systems to identify the assistant-runtime capabilities that should become shared SDK packages.

## Summary Table

| System | Strongest signal | What should inform this repo | What should stay product- or infra-specific |
| --- | --- | --- | --- |
| Relay foundation | transport and action substrate | normalized message, delivery, session substrate integration points | provider adapters, auth, webhook verification, raw action dispatch |
| Sage | memory and proactive continuity | memory contracts, follow-up engine concepts, stale-session patterns | workspace-specific prompt behavior, product heuristics |
| MSD | session and multi-surface convergence | assistant session model, surface attachment rules, runtime composition | review workflows, review tools, PR-specific logic |
| NightCTO | many-agents-one-assistant orchestration | coordination contracts, policy hooks, per-client continuity patterns | founder-facing product behavior, specialist lineup, service policy |
| Workforce | routing, persona tiers, and budget envelopes | assistant-facing routing contracts, latency/depth/cost policy, quality-preserving tier selection | product-agnostic persona library details that remain workforce-owned |

## Relay Foundation

Relay already appears to own the substrate this repo should build on:

- transport adapters
- inbound normalization
- outbound delivery
- auth and connection wiring
- scheduler substrate
- low-level action dispatch

Implication:

- this repo should compose with Relay
- this repo should not recreate transport infrastructure

## Sage

Sage contributes the strongest memory and proactive signals:

- persistent conversation or workspace continuity
- memory load and save behavior
- follow-up and stale-thread thinking
- context-aware reminders

Implication:

- memory and proactive packages are justified
- those packages should capture general contracts, not Sage’s exact product behavior

## MSD

MSD contributes the strongest session and surface signals:

- one assistant experience across multiple surfaces
- shared session semantics
- orchestrator or runtime assignment concepts
- strong need for policy around external review actions

Implication:

- `sessions` and `surfaces` should be first-class packages
- `core` and `policy` should support multi-surface runtime composition without being review-specific

## NightCTO

NightCTO contributes the strongest coordination signals:

- multiple internal specialists behind one assistant face
- per-client continuity and persistence
- proactive monitoring behavior
- need for governance and auditability

Implication:

- `coordination`, `policy`, `memory`, and `proactive` are all justified
- the many-agents-one-assistant model is not hypothetical; it already has a clear internal use case

## Cross-System Synthesis

Across the internal systems, the same assistant concerns keep recurring:

- continuity over time
- continuity across surfaces
- proactive behavior
- coordinated specialists
- focused internal connectivity
- policy around external actions

This is enough evidence to justify a dedicated assistant SDK layer.

## Overlap And Tension Analysis

### Sage vs NightCTO on memory

Sage's memory signals emphasize conversation continuity, workspace context retention, and proactive follow-up evidence. NightCTO's memory signals emphasize per-client continuity, specialist context, and durable service relationships.

Shared implication:
- a future `MemoryStore` interface must support more than one scope shape
- the memory layer cannot assume that every durable object is just a chat thread
- the likely shared scopes are user, session, workspace, org, and object/client

### MSD vs Sage on sessions and surfaces

MSD's strongest contribution is shared session convergence across multiple surfaces. Sage currently shows more product-specific memory and proactive behavior, but its runtime still implies the need for consistent session continuity when the assistant appears in multiple places.

Shared implication:
- the session layer should treat surfaces as attachments to one assistant session rather than as the primary continuity object
- that abstraction is likely reusable across both product styles

### NightCTO vs MSD on coordination

NightCTO makes the specialist pattern explicit through registry, dispatch, triage, and proactive flows. MSD's architecture implies orchestrator/notifier/reviewer roles and multi-surface runtime composition.

Shared implication:
- coordination should be separated from domain-specific specialist lineups
- both products need many-agents-one-assistant semantics even though their domains differ

### Why connectivity deserves its own package

The internal systems do not merely need transport; they need efficient communication between sophisticated subsystems.

This communication is not generic chatter. It needs to be:
- low-latency
- selective
- high-signal
- oriented toward convergence
- able to carry attention, uncertainty, escalation, and synthesis cues

That is why a distinct `@relay-assistant/connectivity` package is justified above Relay transport and alongside coordination.

## Boundary Conclusion

The right separation is:

- Relay foundation for transport and substrate
- `relay-agent-assistant` for shared assistant runtime contracts
- product repos for domain behavior

That separation is consistent with all three product directions and does not require cloud-specific assumptions.

## Workforce

Workforce contributes the strongest routing and token-budgeting signals:

- intent to persona selection
- tiered runtimes (`minimum`, `best-value`, `best`)
- explicit depth/latency/cost envelopes
- routing profiles that preserve quality while changing operating envelope

Implication:

- `routing` should be a first-class assistant-sdk package
- the assistant SDK should align with workforce workload-router concepts instead of inventing a divergent model-choice layer
- latency and cost policy should be explicit runtime concerns rather than ad hoc product logic
