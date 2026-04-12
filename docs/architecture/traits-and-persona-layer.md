# Traits and Persona Layer

Date: 2026-04-11
Source: [sdk-audit-and-traits-alignment-plan.md](sdk-audit-and-traits-alignment-plan.md) §3–4

## Purpose

This document defines where assistant traits and identity live in the package architecture, how they differ from workforce personas, and what the planned `@agent-assistant/traits` package will own.

---

## Workforce Personas vs. Assistant Traits

These solve different problems. They must not be collapsed into one concept.

### Workforce personas

Workforce personas are **runtime execution profiles**. A persona defines:

- system prompt
- model
- harness (Claude, Codex, OpenCode)
- harness settings
- optional skills
- service tiers (`best`, `best-value`, `minimum`)

Personas answer: **"What runtime configuration should this agent use to execute a task?"**

A routing profile selects which persona tier to use per intent. The workload-router resolves `intent → persona + tier → concrete runtime config`. Personas are defined in and owned by Workforce infrastructure. They are not imported into this SDK.

### Assistant traits

Assistant traits are **identity and behavioral characteristics**. Traits define:

- voice and communication style
- domain vocabulary and framing
- behavioral defaults (proactivity level, formality, risk tolerance)
- formatting preferences per surface
- personality continuity across sessions

Traits answer: **"How should this assistant present itself and behave across interactions?"**

Traits are SDK-layer data, owned by `@agent-assistant/traits` (planned for v1.2). Until that package ships, products define traits as local data objects.

---

## Relationship Without Collapse

```
workforce persona (runtime config)     assistant traits (identity + behavior)
         │                                        │
         ▼                                        ▼
  ┌─────────────┐                        ┌──────────────┐
  │ model        │                        │ voice         │
  │ harness      │                        │ style         │
  │ system prompt│◄── prompt may embed ───│ vocabulary    │
  │ tier policy  │    trait values         │ proactivity   │
  │ skills       │                        │ risk posture  │
  └─────────────┘                        └──────────────┘
```

- A workforce persona's `systemPrompt` may **embed** trait values (e.g., "You are Sage, a knowledge-focused assistant who speaks concisely"), but the prompt itself is a persona artifact — the execution-time artifact.
- Traits are the **source data** that multiple prompts, formatters, and behavioral policies read from.
- A single assistant identity (e.g., "Sage") may be served by multiple workforce personas at different tiers. The traits remain constant across all tiers.
- Products compose traits into personas, not the other way around.

### Routing mode naming is distinct from persona naming

SDK routing modes (`cheap`/`fast`/`deep`) are SDK vocabulary for latency/depth/cost decisions. Workforce uses `minimum`/`best-value`/`best` for tier names. The mapping is intentional and explicit — products map between them. Neither package should adopt the other's naming.

---

## Integration Points

| Concern | Owner | Consumes traits? |
| --- | --- | --- |
| Persona resolution (`resolvePersona`) | Workforce workload-router | No — personas are self-contained runtime configs. Products may inject trait values into prompt templates before passing to the persona. |
| Routing mode selection (`router.decide()`) | `@agent-assistant/routing` | No — routing is about depth/latency/cost, not identity. |
| Surface formatting (`formatHook`) | `@agent-assistant/surfaces` | Yes — a format hook may read traits to adjust voice, block style, or formality per surface. |
| Session continuity | `@agent-assistant/sessions` | No — sessions track state, not identity. |
| Coordination synthesis | `@agent-assistant/coordination` | Yes — a synthesizer may read traits to maintain consistent voice when merging specialist outputs. |
| Proactive behavior (future) | `@agent-assistant/proactive` | Yes — traits like proactivity level and risk posture inform watch rules and follow-up thresholds. |

---

## Current State (v1)

**No traits package exists.** `@agent-assistant/traits` is planned for v1.2.

In v1:
- Products define traits as local data objects (not imported from this SDK).
- Trait values are injected manually into persona prompts, format hooks, and synthesizer configs by the product.
- The SDK does not enforce trait consistency. That is the product's responsibility until a traits package exists.

Interim pattern for products that want to pass trait context through the runtime:

```typescript
// Product-owned local traits object — not from SDK
const sageTraits = {
  voice: 'concise',
  formality: 'professional',
  proactivity: 'medium',
  domain: 'knowledge-and-workspace',
};

// Injected into format hook at surface connection definition time
const slackConnection: SurfaceConnection = {
  id: 'sage-slack',
  type: 'slack',
  // ...
  formatHook: (event, caps) => formatWithTraits(event, caps, sageTraits),
};
```

---

## Planned Package: `@agent-assistant/traits` (v1.2)

### Position in package map

| Package | Purpose |
| --- | --- |
| `@agent-assistant/core` | Assistant definition, lifecycle, runtime composition |
| **`@agent-assistant/traits`** | **Assistant identity traits: voice, style, vocabulary, behavioral defaults, surface formatting preferences** |
| `@agent-assistant/memory` | Memory scopes, stores, retrieval, promotion |
| `@agent-assistant/sessions` | Session identity, lifecycle, surface attachment |
| `@agent-assistant/surfaces` | Surface abstractions, normalization, fanout |
| `@agent-assistant/coordination` | Specialist orchestration, synthesis |
| `@agent-assistant/connectivity` | Inter-agent signaling, convergence |
| `@agent-assistant/routing` | Depth/latency/cost mode selection |
| `@agent-assistant/proactive` | Follow-ups, watchers, schedulers |
| `@agent-assistant/policy` | Approvals, safeguards, audit |

### What `@agent-assistant/traits` owns

- `AssistantTraits` type definition (voice, style, vocabulary, proactivity level, risk posture, formality, domain framing)
- `SurfaceFormattingTraits` type definition (per-surface-type formatting preferences that inform format hooks)
- `TraitsProvider` interface — a read-only accessor that packages can consume without hard-depending on traits
- `createTraitsProvider(traits: AssistantTraits)` factory
- Validation that trait values are within acceptable ranges/enums

### What `@agent-assistant/traits` must not own

- Persona definitions — those stay in workforce
- System prompts — those are persona artifacts, not traits
- Product-specific behavioral logic — stays in product repos
- Model selection or routing — stays in `routing`
- Memory or session state — stays in those packages

### Dependency direction

```
traits ← core (optional: AssistantDefinition may reference a TraitsProvider)
traits ← surfaces (optional: format hooks may consume traits)
traits ← coordination (optional: synthesizer may consume traits)
traits ← proactive (optional: watch rules may consume traits)
```

Traits has **zero upstream dependencies** on other SDK packages. It is a leaf data package.

### Integration with `AssistantDefinition`

The current `AssistantDefinition` has `id`, `name`, `description?`. When the v1.2 traits package ships:

```typescript
export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;  // NEW — optional, from @agent-assistant/traits
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
```

The `traits?` field is optional so existing consumers are unaffected. Products that want trait-driven formatting, synthesis, or proactive behavior wire a `TraitsProvider` at definition time. Packages that consume traits access it via `runtime.definition.traits`.

---

## Extraction Timeline

- **v1 (current):** No traits package. Products define traits as local data objects. Acceptable for the current adoption phase.
- **v1.1 (with memory):** Memory may begin storing trait-like user preferences, but `AssistantDefinition` still does not gain a `traits` field at this stage. Keep trait objects product-local until the traits package exists.
- **v1.2 (with proactive + coordination maturity):** Implement `@agent-assistant/traits` package. By this point, multiple products will have local trait patterns worth extracting.

### Extraction signal

The same rule that governs all SDK extraction applies: if a capability is reusable across multiple assistants with only configuration changes, it belongs here. When Sage, MSD, and NightCTO all have local trait objects with overlapping field shapes, the extraction is justified.

---

## Rules for Future Workflows

1. **Never import workforce personas into the assistant SDK.** Personas are runtime configs owned by workforce. The SDK provides traits (identity data) and routing (mode selection). Products compose these at the integration boundary.

2. **Routing mode names (`cheap`/`fast`/`deep`) are SDK vocabulary, not workforce vocabulary.** Do not adopt workforce tier naming in SDK packages.

3. **Traits are not prompts.** A trait like `voice: "concise"` is a data value. The prompt that says "Respond concisely" is a persona artifact. Products turn traits into prompt fragments; the SDK does not.

4. **The `AssistantDefinition.traits?` field does not exist yet** and must not be added until `@agent-assistant/traits` ships. The current `packages/core/src/types.ts` has no `traits` field on `AssistantDefinition` — that is correct. When the traits package ships, the field will be added as `traits?: TraitsProvider` (optional, non-breaking).

5. **Future workflows touching identity, formatting, or behavioral consistency** should check whether the traits package exists before implementing product-local workarounds.

---

TRAITS_PERSONA_LAYER_READY
