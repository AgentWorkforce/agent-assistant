# v1 Traits Spec — `@relay-assistant/traits`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/traits`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.2 (after memory and proactive land)
**Scope doc:** `docs/architecture/v1-traits-scope.md`

---

## 1. Purpose

`@relay-assistant/traits` is a **leaf data package** that defines assistant identity and behavioral characteristics. It provides a shared, validated, immutable data contract so that format hooks, synthesizers, and product code can all read from a single authoritative source rather than maintaining parallel local trait objects.

It answers one question: **"How should this assistant present itself and behave?"**

It does not answer questions about runtime execution, routing mode, model selection, or product-specific behavior.

---

## 2. Scope Summary

### In scope (v1)

- `AssistantTraits` type
- `SurfaceFormattingTraits` type
- `TraitsProvider` read-only interface
- `createTraitsProvider` factory with validation and freeze
- `TraitsValidationError` typed error class
- Integration point: `AssistantDefinition.traits?: TraitsProvider` on `@relay-assistant/core`

### Out of scope (v1)

| Capability | Reason | Target |
|---|---|---|
| Trait inheritance / composition | No product signal yet | v1.3+ |
| Per-surface behavioral voice overrides | Not yet a product pattern | v1.3+ |
| Trait versioning or migration | Premature until field set stabilizes | v2+ |
| Trait-driven prompt generation | Prompt generation is a persona concern | Never in this package |
| Trait persistence or storage | Traits are static per assistant definition | v2+ if needed |
| Trait analytics or A/B testing | Product-layer concern | Never |
| Dynamic trait adjustment from runtime context | Requires mutable state; v1 traits are static | v2+ |

---

## 3. Trait Schema

### 3.1 `AssistantTraits`

```typescript
export interface AssistantTraits {
  /**
   * Communication register.
   * Known values: "concise" | "conversational" | "formal" | "technical"
   * Extensible: unknown values are accepted with a validation warning.
   */
  voice: string;

  /**
   * Formality level.
   * Allowed values: "casual" | "professional" | "academic"
   */
  formality: string;

  /**
   * How actively the assistant initiates.
   * Allowed values: "low" | "medium" | "high"
   */
  proactivity: string;

  /**
   * Tolerance for uncertain or high-impact actions.
   * Allowed values: "cautious" | "moderate" | "assertive"
   */
  riskPosture: string;

  /**
   * Domain framing phrase. Controls how the assistant contextualizes its role.
   * Examples: "knowledge-and-workspace", "code-review", "founder-advisory"
   * Optional. Must be a non-empty string if provided.
   */
  domain?: string;

  /**
   * Domain-specific vocabulary terms the assistant should prefer.
   * Optional. Must be a non-empty array of non-empty strings if provided.
   */
  vocabulary?: string[];
}
```

**Field semantics:**

- `voice` controls the register of responses — how clipped, warm, formal, or specialized the language is. `"concise"` means short, direct answers. `"conversational"` means warm, approachable language. `"formal"` means professional distance. `"technical"` means domain-native vocabulary without hedging.
- `formality` is distinct from `voice`. An assistant can be `voice: "technical"` and `formality: "casual"` (e.g., a developer tool with peer-level tone), or `voice: "concise"` and `formality: "professional"` (e.g., Sage).
- `proactivity` determines how much the assistant volunteers information, asks follow-up questions, or surfaces adjacent context unprompted.
- `riskPosture` determines how the assistant handles actions or recommendations under uncertainty. `"cautious"` means it asks before acting. `"moderate"` means it acts on clear signals and confirms ambiguous ones. `"assertive"` means it acts confidently and only escalates when there's a direct conflict.
- `domain` is a framing phrase, not a functional key. It is surfaced in prompt templates and synthesizer configs by product code. The package does not interpret it.
- `vocabulary` is a preference list, not a restriction. Products use it in prompt fragments (e.g., "prefer terms: [PR, diff, review cycle]"). The package does not enforce vocabulary at runtime.

### 3.2 `SurfaceFormattingTraits`

```typescript
export interface SurfaceFormattingTraits {
  /**
   * Default max response length hint in characters.
   * Format hooks may override per surface. This is a hint, not a hard limit.
   */
  preferredResponseLength?: number;

  /**
   * Whether to prefer rich blocks (cards, attachments) over plain text
   * when the surface supports them.
   */
  preferRichBlocks?: boolean;

  /**
   * Whether to use markdown formatting when the surface supports it.
   */
  preferMarkdown?: boolean;
}
```

`SurfaceFormattingTraits` provides **hints to format hooks**. They do not replace `SurfaceCapabilities`. A format hook reads both: capabilities tell it what the surface can render; formatting traits tell it what the assistant would prefer. The hook applies judgment.

All fields are optional. A `SurfaceFormattingTraits` object with no fields set is valid and means "use surface defaults."

### 3.3 Validation Rules

| Field | Rule |
|---|---|
| `voice` | Must be a non-empty string. Known values: `"concise"`, `"conversational"`, `"formal"`, `"technical"`. Unknown values accepted with warning logged at creation. |
| `formality` | Must be one of: `"casual"`, `"professional"`, `"academic"`. Other values throw `TraitsValidationError`. |
| `proactivity` | Must be one of: `"low"`, `"medium"`, `"high"`. Other values throw `TraitsValidationError`. |
| `riskPosture` | Must be one of: `"cautious"`, `"moderate"`, `"assertive"`. Other values throw `TraitsValidationError`. |
| `domain` | If present, must be a non-empty string. |
| `vocabulary` | If present, must be a non-empty array where each element is a non-empty string. |
| `preferredResponseLength` | If present, must be a positive integer. |
| `preferRichBlocks` | If present, must be a boolean. |
| `preferMarkdown` | If present, must be a boolean. |

Validation runs at `createTraitsProvider` call time only. Once a provider is created, it is immutable.

---

## 4. `TraitsProvider` Interface

```typescript
export interface TraitsProvider {
  readonly traits: Readonly<AssistantTraits>;
  readonly surfaceFormatting?: Readonly<SurfaceFormattingTraits>;
}
```

Consuming packages depend on `TraitsProvider`, not on the concrete type returned by `createTraitsProvider`. This keeps the dependency lightweight and allows consumers to satisfy the interface without importing the package in test or stub contexts.

---

## 5. `createTraitsProvider` Factory

```typescript
export function createTraitsProvider(
  traits: AssistantTraits,
  surfaceFormatting?: SurfaceFormattingTraits,
): TraitsProvider;
```

**Behavior:**

1. Validates `traits` against the rules in §3.3. Throws `TraitsValidationError` on the first invalid field.
2. Validates `surfaceFormatting` if provided.
3. Deep-freezes both objects using `Object.freeze`.
4. Returns a `TraitsProvider` where `traits` and `surfaceFormatting` are both `Readonly`.

**Frozen output:** mutation attempts on the returned objects throw in strict mode and are silently ignored in sloppy mode. The factory is the only creation path. No mutable traits objects are exported.

---

## 6. `TraitsValidationError`

```typescript
export class TraitsValidationError extends Error {
  readonly field: keyof AssistantTraits | keyof SurfaceFormattingTraits;
  readonly invalidValue: unknown;

  constructor(
    field: keyof AssistantTraits | keyof SurfaceFormattingTraits,
    invalidValue: unknown,
    message: string,
  );
}
```

`field` names the trait field that failed validation. `invalidValue` is the value that was rejected. `message` is a human-readable explanation.

Example: `new TraitsValidationError('formality', 'semi-formal', "formality must be 'casual', 'professional', or 'academic'; got 'semi-formal'")`

---

## 7. `AssistantDefinition` Integration

When this package ships, `@relay-assistant/core` gains an optional `traits` field on `AssistantDefinition`:

```typescript
// in @relay-assistant/core types.ts
export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;          // NEW — from @relay-assistant/traits
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
```

This is a **non-breaking addition**. Existing consumers that do not pass `traits` are unaffected. Products that want trait-aware formatting or synthesis wire a `TraitsProvider` at definition time. Downstream packages access it via `runtime.definition.traits`.

**Do not add this field to `packages/core/src/types.ts` until `@relay-assistant/traits` ships.** The implementation plan describes the coordinated change.

---

## 8. Adaptation Hooks

Traits are data. They do not contain hooks. But they inform hooks in consuming packages.

### 8.1 Surface format hook pattern

Format hooks in `@relay-assistant/surfaces` may receive traits as a parameter from product code:

```typescript
// Product code — not SDK
const formatHook: FormatHook = (event, caps) => {
  const traits = runtime.definition.traits;
  if (!traits) return defaultFormat(event, caps);

  return formatWithTraits(event, caps, traits);
};
```

The `formatWithTraits` helper (product-owned or SDK-provided in a future surfaces update) reads:
- `traits.traits.voice` — to set response register
- `traits.traits.formality` — to set tone
- `traits.surfaceFormatting?.preferMarkdown` — to decide whether to emit markdown blocks
- `traits.surfaceFormatting?.preferRichBlocks` — to decide whether to use card/attachment formats
- `traits.surfaceFormatting?.preferredResponseLength` — as a length hint

Surfaces never write to traits. Surfaces never import `createTraitsProvider`. They read `TraitsProvider` and that is all.

### 8.2 Coordination synthesis hook pattern

Coordination synthesizers may receive traits to maintain voice consistency across specialist outputs:

```typescript
// Product code / coordination configuration
const synthesizer: SynthesizerFn = (results, context) => {
  const traits = context.definition?.traits;
  return assembleResponse(results, {
    voice: traits?.traits.voice ?? 'concise',
    formality: traits?.traits.formality ?? 'professional',
  });
};
```

Specialist agents have their own operational characteristics. Traits apply to the **synthesized output**, not to specialist invocations.

### 8.3 Proactive behavior hook pattern (v1.2+)

Future `@relay-assistant/proactive` watch rules may gate follow-up logic on trait values:

```typescript
// Example — proactive package, not yet implemented
if (traits?.traits.proactivity === 'high') {
  scheduleFollowUp(event, context);
}
```

This is forward-looking. The v1 traits package does not import or reference the proactive package.

---

## 9. Dependency Direction

```
@relay-assistant/traits   (leaf — zero SDK dependencies)
        ^
        |--- @relay-assistant/core       (optional: AssistantDefinition.traits?)
        |--- @relay-assistant/surfaces   (optional: format hooks read TraitsProvider)
        |--- @relay-assistant/coordination (optional: synthesizers read TraitsProvider)
        |--- @relay-assistant/proactive  (optional: watch rules read traits, future)
```

`@relay-assistant/traits` imports nothing from other SDK packages. It has no runtime dependencies. It is a `peerDependency`-free, zero-dep package in the SDK graph.

---

## 10. Expression Rules

These rules constrain how products express and consume traits. They are design rules, not runtime enforcement.

**Rule T-1:** Traits are defined at assistant construction time. A `TraitsProvider` created once applies for the lifetime of the assistant definition. Products must not attempt to mutate or replace the provider at runtime.

**Rule T-2:** Products compose traits into personas, not the other way around. A workforce persona's system prompt may embed trait values, but the prompt is a persona artifact. Traits do not contain prompts.

**Rule T-3:** The `voice` field governs register, not content. `voice: "technical"` does not mean "produce code." It means "speak in the register of the domain." Domain content is capability-governed.

**Rule T-4:** `riskPosture` informs product code that decides how to handle ambiguous or high-impact actions. It is not a capability gate or a safety control. Policy and approval decisions belong in `@relay-assistant/policy`.

**Rule T-5:** `vocabulary` is a preference list for prompt injection, not a vocabulary filter. Products are responsible for including vocabulary terms in their persona prompts if they want the assistant to prefer those terms.

**Rule T-6:** `SurfaceFormattingTraits` provides hints to format hooks. A hint is not a mandate. Format hooks apply surface-specific judgment and may not follow a hint if the surface cannot render the requested format.

---

## 11. Product Examples

### Sage

```typescript
const sageTraits = createTraitsProvider(
  {
    voice: 'concise',
    formality: 'professional',
    proactivity: 'medium',
    riskPosture: 'moderate',
    domain: 'knowledge-and-workspace',
    vocabulary: ['digest', 'workspace', 'context', 'capture'],
  },
  {
    preferMarkdown: true,
    preferRichBlocks: false,
    preferredResponseLength: 800,
  },
);
```

### MSD

```typescript
const msdTraits = createTraitsProvider(
  {
    voice: 'technical',
    formality: 'professional',
    proactivity: 'low',
    riskPosture: 'cautious',
    domain: 'code-review',
    vocabulary: ['PR', 'diff', 'review cycle', 'merge', 'blocking comment'],
  },
  {
    preferMarkdown: true,
    preferRichBlocks: false,
  },
);
```

### NightCTO

```typescript
const nightCTOTraits = createTraitsProvider(
  {
    voice: 'conversational',
    formality: 'professional',
    proactivity: 'high',
    riskPosture: 'assertive',
    domain: 'founder-advisory',
    vocabulary: ['runway', 'traction', 'technical debt', 'team capacity'],
  },
  {
    preferMarkdown: false,
    preferRichBlocks: true,
    preferredResponseLength: 1200,
  },
);
```

---

## 12. Test Coverage Targets

Minimum 25 tests covering:

| Category | Count |
|---|---|
| Valid trait creation — all field combinations | 6 |
| Validation failures — `formality` invalid | 1 |
| Validation failures — `proactivity` invalid | 1 |
| Validation failures — `riskPosture` invalid | 1 |
| Validation failures — `domain` empty string | 1 |
| Validation failures — `vocabulary` empty array | 1 |
| Validation failures — `vocabulary` with empty-string element | 1 |
| Validation failures — `preferredResponseLength` non-positive | 1 |
| Unknown `voice` value — warning, no throw | 1 |
| Immutability — mutation of `traits` object | 2 |
| Immutability — mutation of `surfaceFormatting` object | 2 |
| `TraitsValidationError` field and value | 2 |
| `TraitsValidationError` message content | 2 |
| `SurfaceFormattingTraits` — all optional fields absent | 1 |
| `SurfaceFormattingTraits` — all optional fields present | 1 |

---

## 13. Migration Path for Products

Products currently define trait-like objects as local data. Migration when `@relay-assistant/traits` ships:

1. `npm install @relay-assistant/traits`
2. Replace the local traits object with `createTraitsProvider(...)`.
3. Pass the returned `TraitsProvider` on `AssistantDefinition.traits`.
4. Update format hooks and synthesizer configs to read from `runtime.definition.traits` instead of closed-over local objects.

The data shape is identical. No product behavioral logic changes. Only the accessor is standardized.

---

## 14. Success Criteria

- [ ] `AssistantTraits`, `SurfaceFormattingTraits`, `TraitsProvider` types exported
- [ ] `createTraitsProvider` validates all fields and throws `TraitsValidationError` on invalid values
- [ ] `createTraitsProvider` returns a frozen, immutable `TraitsProvider`
- [ ] Unknown `voice` values accepted with warning; all other fields validate strictly
- [ ] `TraitsValidationError` exposes `field`, `invalidValue`, and a readable `message`
- [ ] 25+ tests covering creation, validation, immutability, error types, and surface formatting
- [ ] Zero upstream SDK dependencies
- [ ] No prompt generation, no persona logic, no product-specific behavior in the package
- [ ] `@relay-assistant/core` `AssistantDefinition` gains `traits?: TraitsProvider` in the same implementation workflow

---

V1_TRAITS_SPEC_READY
