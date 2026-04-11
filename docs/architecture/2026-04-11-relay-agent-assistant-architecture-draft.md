# Relay Agent Assistant — Architecture Draft

Date: 2026-04-11

## Thesis

AgentWorkforce products increasingly need the same assistant-runtime capabilities:

- memory
- proactivity
- multi-surface continuity
- runtime/session routing
- specialist coordination
- assistant identity consistency

These capabilities should not be re-implemented independently in Sage, MSD, NightCTO, and future products.

Instead, they should become a shared SDK/runtime built on top of Agent Relay primitives.

---

## Layer model

### Layer 1 — Relay foundation

Owned by the relay family of repos:
- `relay`
- `gateway`
- `relaycron`
- `relayauth`
- `relayfile`
- relaycast / channels / sessions / auth / scheduler / delivery infrastructure

Responsibilities:
- message transport
- channel/session primitives
- delivery adapters
- auth and identity wiring
- scheduling/wakeup substrate
- low-level action dispatch

### Layer 2 — Relay Agent Assistant SDK

Owned by this repo.

Responsibilities:
- assistant identity
- memory model
- proactive runtime
- session continuity
- surface abstraction contracts
- internal agent coordination
- action policy and approvals
- shared runtime lifecycle

### Layer 3 — Product assistants

Examples:
- Sage
- MSD
- NightCTO

Responsibilities:
- domain-specific prompts
- domain-specific tools/workflows
- product-specific UI and policies
- domain-specific specialist roles

---

## Package proposal

### `@relay-assistant/core`

Responsibilities:
- assistant definition / creation
- identity model (name, style, persona, formatting hints)
- runtime lifecycle
- shared configuration surface
- capability registration

Possible concepts:
- `createAssistant()`
- `AssistantIdentity`
- `AssistantRuntime`
- `AssistantContext`

### `@relay-assistant/memory`

Responsibilities:
- short-term conversation memory
- long-term user memory
- workspace/org memory
- memory retrieval and ranking
- summarization and compaction
- memory promotion rules

Possible concepts:
- `MemoryStore`
- `MemoryScope`
- `MemoryPolicy`
- `ContextCompactor`
- `MemoryPromotionRule`

### `@relay-assistant/proactive`

Responsibilities:
- scheduled tasks
- follow-up rules
- stale-thread detection
- watcher jobs
- event-triggered nudges
- relaycron integration

Possible concepts:
- `ProactiveEngine`
- `WatchRule`
- `ReminderPolicy`
- `ScheduledFlow`
- `RelayCronBinding`

### `@relay-assistant/sessions`

Responsibilities:
- cross-surface session identity
- resume/re-attach semantics
- thread/session convergence
- per-user/per-workspace/per-object session scoping

Possible concepts:
- `AssistantSession`
- `SessionStore`
- `SessionAffinity`
- `SurfaceAttachment`

### `@relay-assistant/surfaces`

Responsibilities:
- surface-agnostic adapter contracts
- formatting hooks
- delivery fanout
- input normalization contracts above relay/gateway level

Possible concepts:
- `SurfaceAdapter`
- `SurfaceConnection`
- `NormalizedUserMessage`
- `AssistantResponseFormatter`

### `@relay-assistant/coordination`

Responsibilities:
- coordinator + specialist orchestration
- many-agent / one-assistant synthesis
- delegation policies
- specialist discovery and dispatch

Possible concepts:
- `Coordinator`
- `SpecialistRegistry`
- `DelegationPlan`
- `SynthesisPolicy`

### `@relay-assistant/policy`

Responsibilities:
- action approvals
- external-action safeguards
- audit logging hooks
- policy modes (silent, suggest, ask, auto)

Possible concepts:
- `ActionPolicy`
- `ApprovalRequirement`
- `AuditSink`
- `RiskLevel`

### `@relay-assistant/examples`

Responsibilities:
- reference implementations
- example assistants:
  - Sage-style memory + proactivity assistant
  - MSD-style multi-surface review assistant
  - NightCTO-style specialist coordinator assistant

---

## Design principles

1. **Relay-native, not relay-replacement**
   - This SDK should compose with relay, not compete with it.

2. **Many agents, one assistant**
   - Internal modularity is allowed, but the external assistant identity should remain coherent.

3. **Memory and proactivity are first-class**
   - They are not optional add-ons.

4. **Multi-surface continuity is foundational**
   - Web, desktop, chat, and other surfaces should attach to the same assistant/session model.

5. **Policy is built in, not bolted on**
   - External actions and risky operations must be governable.

6. **Products own domain logic**
   - The SDK provides universal primitives, not product-specific business logic.

---

## Why this is needed now

The shared concerns are already visible in three active AgentWorkforce efforts:

- **Sage** → memory + proactive context management
- **MSD** → multi-surface review runtime + shared sessions + review memory
- **NightCTO** → specialist orchestration + relaycast channels + proactive monitoring + per-client continuity

As additional agents appear, duplication will increase unless these capabilities are extracted.

---

## Open questions

1. What should remain in `relay` versus move into this SDK?
2. Should assistant identity live in `core` or a separate package?
3. Should memory backends remain pluggable via adapters, or should one default stack be blessed first?
4. How much of proactive scheduling belongs in `relaycron` vs `@relay-assistant/proactive`?
5. Should `Communicate SDK` concepts fold into this repo or remain separate?
6. Do we want to standardize a session model that all product surfaces must adopt?

---

## Immediate next steps

1. Refine the research notes with deeper Sage/MSD/NightCTO comparisons.
2. Add a package-boundary doc mapping existing code to proposed SDK packages.
3. Define the minimum viable package extraction order.
4. Decide repo naming and npm scope conventions.
5. Start with docs first, then extract one narrow package (likely memory or sessions) as the first proving move.
