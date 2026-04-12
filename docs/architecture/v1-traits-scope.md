# v1 Traits Scope

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-11
Status: SCOPE_DEFINED

## Purpose

This document defines the bounded scope for the first implementation of `@relay-assistant/traits` (v1.2). It establishes what the package owns, what it defers, and how it relates to adjacent SDK packages without collapsing into them.

---

## What Traits Are

Assistant traits are **identity and behavioral characteristics** that define how an assistant presents itself and behaves across interactions. They are SDK-layer source data, not runtime execution configuration.

Traits answer one question: **"How should this assistant present itself and behave?"**

A trait is a declarative data value. It is not a prompt, not a runtime config, and not a product-specific behavior. The trait `voice: "concise"` is data. The prompt fragment "Respond concisely" is a persona artifact derived from that data by product code.

---

## Traits vs. Workforce Personas

These are distinct concepts that must not be conflated.

| Concern | Workforce Persona | Assistant Trait |
| --- | --- | --- |
| **Answers** | "What runtime config should this agent use?" | "How should this assistant present itself?" |
| **Contains** | model, harness, system prompt, tier, skills | voice, style, vocabulary, proactivity, risk posture |
| **Owned by** | Workforce infrastructure | `@relay-assistant/traits` (this package) |
| **Scope** | One execution context | Constant across all tiers and execution contexts |
| **Cardinality** | Many personas may serve one assistant | One trait set per assistant identity |

A workforce persona's `systemPrompt` may **embed** trait values, but the prompt is a persona artifact. Traits are the source data that prompts, formatters, and behavioral policies read from. Products compose traits into personas, not the other way around.

**Rules:**
- Never import workforce persona definitions into this package.
- Never generate or own system prompts from this package.
- SDK routing modes (`cheap`/`fast`/`deep`) and workforce tier names (`minimum`/`best-value`/`best`) are separate vocabularies. This package uses neither.

---

## v1 Scope (In)

The first implementation of `@relay-assistant/traits` must deliver:

### 1. `AssistantTraits` type

A plain data type defining the core identity fields:

```typescript
export interface AssistantTraits {
  /** Communication register: "concise" | "conversational" | "formal" | "technical" */
  voice: string;
  /** Formality level: "casual" | "professional" | "academic" */
  formality: string;
  /** How actively the assistant initiates: "low" | "medium" | "high" */
  proactivity: string;
  /** Tolerance for uncertain or high-impact actions: "cautious" | "moderate" | "assertive" */
  riskPosture: string;
  /** Domain framing phrase, e.g. "knowledge-and-workspace", "code-review", "founder-advisory" */
  domain?: string;
  /** Domain-specific vocabulary terms the assistant should prefer */
  vocabulary?: string[];
}
```

The field set is deliberately minimal. Fields use `string` with documented allowed values rather than union types, so products can extend vocabulary without forking the package. Validation (see below) enforces known values at creation time.

### 2. `SurfaceFormattingTraits` type

Per-surface-type formatting preferences that inform format hooks:

```typescript
export interface SurfaceFormattingTraits {
  /** Default max response length hint (characters). Format hooks may override per surface. */
  preferredResponseLength?: number;
  /** Whether to prefer rich blocks (cards, attachments) over plain text when the surface supports them */
  preferRichBlocks?: boolean;
  /** Whether to use markdown formatting when the surface supports it */
  preferMarkdown?: boolean;
}
```

This type provides hints, not mandates. Format hooks read these values and apply surface-specific judgment.

### 3. `TraitsProvider` interface

A read-only accessor so consuming packages can depend on the trait contract without depending on trait construction:

```typescript
export interface TraitsProvider {
  readonly traits: Readonly<AssistantTraits>;
  readonly surfaceFormatting?: Readonly<SurfaceFormattingTraits>;
}
```

### 4. `createTraitsProvider` factory

```typescript
export function createTraitsProvider(
  traits: AssistantTraits,
  surfaceFormatting?: SurfaceFormattingTraits,
): TraitsProvider;
```

The factory validates trait values against known enums, freezes the result, and returns a `TraitsProvider`. Invalid values throw a `TraitsValidationError`.

### 5. Validation

- `voice` must be one of the documented values or a non-empty string (extensible with warning).
- `formality`, `proactivity`, `riskPosture` must be one of their documented values.
- `domain` if present must be a non-empty string.
- `vocabulary` if present must be a non-empty array of non-empty strings.

Validation runs at creation time only. Once created, a `TraitsProvider` is immutable.

### 6. `TraitsValidationError`

A typed error for invalid trait values, extending `Error` with a `field` property identifying which trait failed validation.

### 7. Integration point: `AssistantDefinition.traits?`

When this package ships, `@relay-assistant/core` gains an optional field:

```typescript
export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;  // NEW — optional, from @relay-assistant/traits
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
```

This is a non-breaking addition. Existing consumers are unaffected. The `traits` field is not added until this package ships — the current `types.ts` correctly has no such field.

---

## v1 Scope (Out / Deferred)

The following are explicitly **not** in v1 scope:

| Capability | Reason for deferral | Target |
| --- | --- | --- |
| Trait inheritance / composition (base traits + product overrides) | No evidence yet that products need layered traits vs. flat objects | v1.3+ if extraction signal appears |
| Per-surface trait overrides (e.g., different voice on Slack vs. web) | `SurfaceFormattingTraits` covers formatting; behavioral voice changes per surface are not yet a product pattern | v1.3+ |
| Trait versioning or migration | Premature until the field set stabilizes across multiple products | v2+ |
| Trait-driven prompt generation | Traits are data; prompt generation is a persona concern owned by products | Never in this package |
| Trait persistence or storage | Traits are defined at assistant construction time; runtime mutation is not a v1 pattern | v2+ if needed |
| Trait analytics or A/B testing | Product-layer concern | Never in this package |
| Dynamic trait adjustment based on context | Requires runtime state; v1 traits are static per assistant definition | v2+ |
| Product-specific behavioral logic | Stays in product repos regardless of version | Never |

---

## Relationship to Adjacent Packages

Traits relate to but must not collapse into adjacent packages. The relationships are read-only and downstream.

### Traits and Surfaces

`@relay-assistant/surfaces` format hooks may read `TraitsProvider` to adjust formatting per surface. The flow is:

```
traits ──read──> format hook (in surfaces) ──produces──> formatted output
```

- Surfaces never write to traits.
- Surfaces do not depend on traits at the type level — the format hook receives traits as a parameter from product code, not as an import dependency.
- `SurfaceFormattingTraits` provides hints that format hooks interpret; it does not replace `SurfaceCapabilities`.

### Traits and Memory

`@relay-assistant/memory` and traits are independent in v1.

- Memory does not store or retrieve traits. Traits are defined at assistant construction time.
- Memory may later store user-expressed preferences that *inform* trait selection, but that is a product-layer composition, not a package dependency.
- Memory's `v1-memory-spec.md` does not reference traits. This is correct for v1.

### Traits and Routing

`@relay-assistant/routing` and traits are independent.

- Routing decides depth/latency/cost mode. Traits decide identity and behavioral voice. These are orthogonal.
- A trait like `riskPosture: "cautious"` does not influence routing mode selection. If a product wants risk posture to affect routing, that is product-layer composition.
- Routing mode names (`cheap`/`fast`/`deep`) are SDK vocabulary. Traits do not use or reference them.

### Traits and Coordination

`@relay-assistant/coordination` synthesizers may read `TraitsProvider` to maintain consistent voice when merging specialist outputs.

```
traits ──read──> synthesizer (in coordination) ──produces──> unified response
```

- Coordination does not depend on traits at the type level in v1. Products pass traits to synthesizers as configuration.
- Specialist agents may have their own operational characteristics, but the assistant's traits apply to the synthesized output, not to individual specialist execution.

### Traits and Core

`@relay-assistant/core` will gain `traits?: TraitsProvider` on `AssistantDefinition`. Core does not interpret trait values — it stores the reference so other subsystems can access it via `runtime.definition.traits`.

---

## Dependency Direction

```
traits (leaf — zero SDK dependencies)
  ^
  |--- core (optional: AssistantDefinition.traits?)
  |--- surfaces (optional: format hooks may consume traits)
  |--- coordination (optional: synthesizer may consume traits)
  |--- proactive (optional: watch rules may consume traits, future)
```

`@relay-assistant/traits` has **zero upstream dependencies** on other SDK packages. It imports nothing from core, surfaces, memory, routing, or coordination. It is a leaf data package.

Consuming packages depend on the `TraitsProvider` interface, not on the concrete implementation. This keeps the dependency optional.

---

## Package Structure

```
packages/traits/
  package.json
  tsconfig.json
  src/
    index.ts          # public API exports
    types.ts          # AssistantTraits, SurfaceFormattingTraits, TraitsProvider
    create.ts         # createTraitsProvider factory + validation
    errors.ts         # TraitsValidationError
    validation.ts     # trait value validation logic
  __tests__/
    create.test.ts    # factory and validation tests
    types.test.ts     # type contract tests
```

Estimated test target: 25-35 tests covering:
- valid trait creation (all field combinations)
- validation failures for each field
- immutability of created providers
- `SurfaceFormattingTraits` creation and defaults
- error types and messages

---

## Extraction Signal

The extraction is justified by overlapping trait patterns across internal products:

| Product | Voice | Formality | Proactivity | Risk Posture | Domain |
| --- | --- | --- | --- | --- | --- |
| Sage | concise | professional | medium | moderate | knowledge-and-workspace |
| MSD | technical | professional | low | cautious | code-review |
| NightCTO | conversational | professional | high | assertive | founder-advisory |

Three products, overlapping field shapes, different values. This is the extraction signal described in the package boundary map.

---

## Migration Path for Products

Products currently define traits as local data objects. Migration to `@relay-assistant/traits` is:

1. Install `@relay-assistant/traits`.
2. Replace the local trait object with `createTraitsProvider(...)`.
3. Pass the `TraitsProvider` on `AssistantDefinition.traits`.
4. Update format hooks and synthesizers to read from `runtime.definition.traits` instead of closed-over local objects.

No product logic changes. The data shape is the same; the accessor becomes standardized.

---

## Success Criteria

The v1 traits implementation is complete when:

- [ ] `AssistantTraits`, `SurfaceFormattingTraits`, and `TraitsProvider` types are exported
- [ ] `createTraitsProvider` factory validates and freezes trait values
- [ ] `TraitsValidationError` provides clear error messages per field
- [ ] 25+ tests pass covering creation, validation, immutability, and error paths
- [ ] `@relay-assistant/core` `AssistantDefinition` gains optional `traits?: TraitsProvider` field
- [ ] Zero upstream SDK dependencies (leaf package)
- [ ] No prompt generation, no persona logic, no product behavior in the package

---

V1_TRAITS_SCOPE_READY
