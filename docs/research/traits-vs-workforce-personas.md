# Traits vs. Workforce Personas

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-11
Status: REFERENCE

---

## Purpose

This document defines the boundary between workforce personas and assistant traits for contributors, product teams, and implementation workflows. Confusion between these two concepts causes scope drift in both directions: workforce behavior leaking into the SDK, and SDK trait logic leaking into product-owned persona definitions.

---

## The Core Distinction

**Workforce personas** answer: **"What runtime configuration should this agent use to execute a task?"**

**Assistant traits** answer: **"How should this assistant present itself and behave across interactions?"**

These questions have different answers, different owners, and different lifecycles. They must not be collapsed.

---

## Workforce Personas

A workforce persona is a **runtime execution profile**. It is defined and owned by Workforce infrastructure. It is not part of the Relay Agent Assistant SDK.

A persona contains:

| Field | Purpose |
|---|---|
| `model` | Which LLM to invoke |
| `harness` | Execution harness (Claude, Codex, OpenCode) |
| `systemPrompt` | The full system prompt for that execution context |
| `harnessSettings` | Temperature, max tokens, stop sequences, etc. |
| `skills` | Optional skill list for this persona |
| `tier` | Service tier: `best`, `best-value`, `minimum` |

Workforce uses tier names (`best`, `best-value`, `minimum`) that are distinct from SDK routing mode names (`cheap`, `fast`, `deep`). These vocabularies must not be mixed. Products map between them at the integration boundary.

A routing profile selects which persona tier to use per intent. The workload-router resolves `intent → persona + tier → concrete runtime config`. This resolution happens in Workforce infrastructure, not in the SDK.

### What personas must not contain

- Assistant identity declarations beyond what is needed for a single execution context
- Long-term behavioral continuity data
- References to SDK packages
- Cross-session state

---

## Assistant Traits

An assistant trait is an **identity and behavioral characteristic**. Traits are owned by `@relay-assistant/traits` (v1.2). Until that package ships, products define traits as local data objects.

A trait set contains:

| Field | Purpose |
|---|---|
| `voice` | Communication register: concise, conversational, formal, technical |
| `formality` | Formality level: casual, professional, academic |
| `proactivity` | How actively the assistant initiates: low, medium, high |
| `riskPosture` | Tolerance for uncertain or high-impact actions: cautious, moderate, assertive |
| `domain` | Domain framing phrase (e.g., "code-review", "founder-advisory") |
| `vocabulary` | Domain-specific vocabulary terms to prefer |

Additionally, `SurfaceFormattingTraits` provides formatting hints:

| Field | Purpose |
|---|---|
| `preferredResponseLength` | Default max response length hint |
| `preferRichBlocks` | Prefer rich blocks over plain text |
| `preferMarkdown` | Prefer markdown when surface supports it |

Traits are **static per assistant identity**. They are defined at assistant construction time and do not change across sessions, tiers, or surfaces. A single assistant identity (e.g., "Sage") may be served by multiple workforce personas at different tiers. The traits remain constant across all of them.

### What traits must not contain

- System prompts — prompts are persona artifacts
- Model selection or routing mode
- Product-specific behavioral logic
- Workforce tier names or persona definitions
- Session or memory state

---

## How They Relate

```
workforce persona (runtime config)        assistant traits (identity + behavior)
         │                                          │
         ▼                                          ▼
  ┌─────────────────┐                    ┌────────────────────┐
  │ model            │                    │ voice               │
  │ harness          │                    │ formality           │
  │ system prompt ◄──┼── may embed ───────┤ vocabulary          │
  │ tier policy      │   trait values     │ proactivity         │
  │ skills           │                    │ risk posture        │
  └─────────────────┘                    └────────────────────┘
```

A workforce persona's `systemPrompt` **may embed trait values** (e.g., "You are Sage, a professional assistant who responds concisely"), but:

- The prompt is a **persona artifact**, not a trait.
- Traits are the **source data** that the prompt was derived from.
- Products compose traits into personas, not the other way around.
- The package that owns traits (`@relay-assistant/traits`) never generates prompts. That is always product code.

---

## Cardinality

| Dimension | Persona | Trait Set |
|---|---|---|
| Per assistant identity | Many personas (one per tier, one per harness type, etc.) | One trait set |
| Per session | May vary if routing selects different tiers | Constant |
| Per surface | May vary if different tiers handle web vs. Slack | Constant |
| Mutability | Persona definitions are static configs; tier selection is dynamic | Immutable after creation |

---

## Integration Points

| Consuming concern | Reads traits? | Reads persona? | Notes |
|---|---|---|---|
| Surface format hook | Yes — voice, formality, formatting hints | No | Product code passes `TraitsProvider` to the format hook |
| Coordination synthesizer | Yes — voice, formality | No | Synthesizer maintains voice consistency across specialist outputs |
| Workforce workload-router | No | Yes — full persona | Personas are self-contained runtime configs |
| SDK routing (`router.decide()`) | No | No | Routing is about depth/latency/cost, not identity |
| Session continuity | No | No | Sessions track state, not identity |
| Proactive watch rules (future) | Yes — proactivity, riskPosture | No | Future `@relay-assistant/proactive` integration |

---

## Common Mistakes

### Mistake 1: Putting persona fields in traits

**Wrong:** Adding `model` or `tier` to `AssistantTraits`.

These fields belong in workforce personas. Routing mode selection (`cheap`/`fast`/`deep`) belongs in `@relay-assistant/routing`. Traits are identity data, not execution config.

### Mistake 2: Generating prompts from traits

**Wrong:** Adding a `toPrompt()` method to `TraitsProvider`, or having `createTraitsProvider` return a prompt string.

Traits are data. Prompt generation is always product code. The `traits` package never emits a string that a model will receive.

### Mistake 3: Treating traits as per-execution state

**Wrong:** Changing trait values based on routing tier, session context, or user inputs.

Traits are static per assistant definition. They do not vary by session, surface, or execution context. Products that want dynamic personalization must handle that at the product layer, not by mutating the traits provider.

### Mistake 4: Importing workforce personas into SDK packages

**Wrong:** Adding `import type { Persona } from '@workforce/personas'` to any SDK package.

Workforce personas are not SDK types. The SDK provides traits (identity data) and routing (mode selection). Products compose these at the integration boundary without requiring the SDK to import workforce types.

### Mistake 5: Conflating SDK routing modes with workforce tier names

**Wrong:** Using `minimum`/`best-value`/`best` in SDK code, or using `cheap`/`fast`/`deep` in workforce code.

SDK routing modes are SDK vocabulary. Workforce tier names are workforce vocabulary. Products map between them. The mapping is explicit, not implicit.

---

## Extraction Signal

The `@relay-assistant/traits` package extraction is justified by overlapping trait patterns across Sage, MSD, and NightCTO:

| Product | Voice | Formality | Proactivity | Risk Posture | Domain |
|---|---|---|---|---|---|
| Sage | concise | professional | medium | moderate | knowledge-and-workspace |
| MSD | technical | professional | low | cautious | code-review |
| NightCTO | conversational | professional | high | assertive | founder-advisory |

Three products. Overlapping field shapes. Different values. This is the extraction signal. When all three products are maintaining local data objects with the same structure, the structure belongs in a shared package.

---

## Rules for Implementation Workflows

1. **Never import workforce personas into the assistant SDK.** The boundary is absolute.

2. **Traits are not prompts.** A trait is a data value. A prompt is a persona artifact derived from that data by product code.

3. **`AssistantDefinition.traits?` does not exist until `@relay-assistant/traits` ships.** Do not add it prematurely.

4. **`@relay-assistant/traits` has zero SDK dependencies.** It imports nothing from other SDK packages.

5. **Products compose traits into personas.** Workforce persona system prompts may embed trait values, but that composition happens at the product layer, not in the SDK.

6. **Routing mode names (`cheap`/`fast`/`deep`) are SDK vocabulary.** Do not use workforce tier names (`minimum`/`best-value`/`best`) in SDK code.

---

TRAITS_VS_PERSONAS_READY
