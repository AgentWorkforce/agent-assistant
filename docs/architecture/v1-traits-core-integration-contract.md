# v1 Traits-Core Integration Contract

**Date:** 2026-04-12
**Status:** Active
**Packages:** `@relay-assistant/traits` (0.1.0), `@relay-assistant/core` (0.1.0)
**Prerequisite reviews:** v1-traits-package-review-verdict (PASS_WITH_FOLLOWUPS), v1-core-review-verdict (PASS_WITH_FOLLOWUPS), v1-foundation-integration-review-verdict (PASS_WITH_FOLLOWUPS)

---

## 1. How Traits Enter Core Assistant Composition

Traits enter core through a single optional field on `AssistantDefinition`:

```typescript
// packages/core/src/types.ts
import type { TraitsProvider } from '@relay-assistant/traits';

export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;  // optional — existing consumers unaffected
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
```

Products wire a `TraitsProvider` at definition time. The provider is created by `createTraitsProvider()` from `@relay-assistant/traits`, which validates all fields and returns a frozen, immutable object. Core receives the already-validated, already-frozen provider and stores it on the frozen definition.

Downstream packages and capability handlers access traits via `runtime.definition.traits`:

```typescript
// In a capability handler or hook
const traits = context.runtime.definition.traits;
if (traits) {
  const voice = traits.traits.voice;        // 'concise' | 'conversational' | ...
  const fmt = traits.surfaceFormatting;      // optional formatting hints
}
```

This is a **read-only data flow**. Core does not interpret, transform, or act on trait values. It stores and exposes them.

---

## 2. Interface Boundary: Direct TraitsProvider vs. Narrower Type

**Decision: Core depends directly on the `TraitsProvider` interface from `@relay-assistant/traits`.**

### Why not a narrower interface?

A narrower core-local interface (e.g., `{ readonly traits: Readonly<Record<string, unknown>> }`) was considered and rejected for these reasons:

1. **TraitsProvider is already narrow.** It has exactly two readonly fields (`traits`, `surfaceFormatting?`). There is no method surface, no lifecycle, no side effects. It is a data record, not a service.

2. **Type safety matters for consumers.** If core used a generic `Record<string, unknown>`, capability handlers would need to cast or validate trait fields at every access site. Using the typed `TraitsProvider` gives handlers compile-time access to `traits.voice`, `traits.formality`, etc.

3. **No circular dependency risk.** Traits has zero SDK dependencies. Core depends on traits (type-only). The dependency arrow is one-directional: `core → traits`. There is no inversion risk.

4. **Duck-typing is unnecessary here.** Duck-typing (as used for `SessionSubsystem` in core) is appropriate when the implementing package hasn't shipped yet or when multiple implementations with different shapes are expected. Traits has shipped, and `TraitsProvider` is its stable contract.

### Dependency declaration

```jsonc
// packages/core/package.json
{
  "peerDependencies": {
    "@relay-assistant/traits": ">=0.1.0"
  },
  "devDependencies": {
    "@relay-assistant/traits": "file:../traits"
  }
}
```

Core declares traits as a **peer dependency**, not a regular dependency:

- Core's import is `import type { TraitsProvider }` — type-only. At runtime, core has zero calls into traits code.
- Consumers who don't use traits don't need to install it (peer deps are optional warnings, not hard failures).
- Consumers who do use traits control the version they install.
- The `devDependencies` entry enables local builds and tests within the monorepo.

---

## 3. How Traits Affect Assembly Without Collapsing Into Persona Logic

### What core does with traits

Core treats `TraitsProvider` as **opaque, pass-through data**:

1. **Stores it** on the frozen definition at `createAssistant()` time.
2. **Freezes it** during definition freeze (`Object.freeze(definition.traits)`) for defense-in-depth. Providers from `createTraitsProvider()` are already frozen, but raw objects passed by tests or prototype code get frozen here.
3. **Exposes it** via `runtime.definition.traits` to capability handlers, hooks, and any registered subsystem that holds a runtime reference.

Core does not:
- Read any trait field values
- Branch on trait values to alter dispatch, lifecycle, or routing behavior
- Generate prompts from traits
- Validate trait content (that is the traits package's responsibility)

### Where trait interpretation happens (not in core)

| Consumer | What it reads | What it does with it |
|---|---|---|
| Surface format hooks | `traits.surfaceFormatting`, `traits.traits.voice` | Adjusts response length, block style, markdown preference |
| Coordination synthesizers | `traits.traits.voice`, `traits.traits.formality` | Maintains consistent voice when merging specialist outputs |
| Proactive watch rules | `traits.traits.proactivity`, `traits.traits.riskPosture` | Tunes follow-up thresholds and watch aggressiveness |
| Product persona composition | All trait fields | Embeds trait values into workforce persona prompt templates |

All of these are **downstream consumers**, not core itself. Core's role is to carry the `TraitsProvider` on the definition so these consumers can read it. This preserves core as a reusable runtime engine without behavioral policy.

### The persona boundary in practice

```
TraitsProvider (SDK data)          Workforce Persona (runtime config)
        │                                    │
        │  products compose ──────►          │
        │  trait values into                 │
        │  persona prompts                   │
        ▼                                    ▼
  voice: "concise"              systemPrompt: "You are Sage, a concise..."
  formality: "professional"     model: "claude-sonnet-4-6"
  proactivity: "medium"         harness: "claude"
                                tier: "best-value"
```

- Traits are identity data. Personas are execution configs.
- Products map traits → prompts at the integration boundary.
- Core never performs this mapping. It doesn't know what a persona is.

---

## 4. What Belongs in Core vs. What Stays in Traits

### Core owns

| Concern | Rationale |
|---|---|
| `AssistantDefinition.traits?: TraitsProvider` field | Core owns the definition type |
| Freezing the traits provider during definition freeze | Core owns immutability of the definition |
| Exposing traits via `runtime.definition.traits` | Core owns the runtime accessor surface |
| Type-only import of `TraitsProvider` | Minimal coupling for the definition type |

### Traits owns

| Concern | Rationale |
|---|---|
| `AssistantTraits` type (voice, formality, proactivity, riskPosture, domain, vocabulary) | Traits defines what identity fields exist |
| `SurfaceFormattingTraits` type (preferredResponseLength, preferRichBlocks, preferMarkdown) | Traits defines formatting hints |
| `TraitsProvider` interface (readonly accessor) | Traits defines the read-only contract |
| `createTraitsProvider()` factory with validation | Traits owns construction and validation |
| `TraitsValidationError` with field/value diagnostics | Traits owns error reporting |
| Known-value sets and validation rules | Traits owns what values are valid |
| Freezing and deep-copying during construction | Traits owns immutability at creation time |

### Neither core nor traits owns

| Concern | Actual owner |
|---|---|
| Interpreting trait values for formatting | `@relay-assistant/surfaces` format hooks |
| Interpreting trait values for synthesis | `@relay-assistant/coordination` synthesizers |
| Interpreting trait values for proactive behavior | `@relay-assistant/proactive` watch rules |
| Turning traits into prompt fragments | Product code (workforce persona composition) |
| Storing or persisting traits | Product code (traits are definition-time constants) |

---

## 5. Assembly and Test Proof Required

### 5.1 Compile-time proof

The following must type-check without errors:

```typescript
import { createTraitsProvider } from '@relay-assistant/traits';
import type { TraitsProvider } from '@relay-assistant/traits';
import { createAssistant } from '@relay-assistant/core';
import type { AssistantDefinition } from '@relay-assistant/core';

// TraitsProvider from createTraitsProvider is assignable to definition.traits
const provider: TraitsProvider = createTraitsProvider({
  voice: 'concise',
  formality: 'professional',
  proactivity: 'medium',
  riskPosture: 'moderate',
});

const definition: AssistantDefinition = {
  id: 'test-assistant',
  name: 'Test',
  traits: provider,
  capabilities: { reply: async () => {} },
};

// createAssistant accepts a definition with traits
const runtime = createAssistant(definition, adapters);

// traits are accessible and correctly typed on the frozen definition
const t: TraitsProvider | undefined = runtime.definition.traits;
```

### 5.2 Runtime integration tests

The following tests must pass in `packages/core/src/core-traits.test.ts`:

| # | Test | Asserts |
|---|---|---|
| 1 | Definition with traits creates a valid runtime | `runtime.definition.traits` is defined and matches input |
| 2 | Definition without traits creates a valid runtime | `runtime.definition.traits` is `undefined`; no regression |
| 3 | Traits are frozen on the runtime definition | Mutating `runtime.definition.traits.traits.voice` throws `TypeError` |
| 4 | Traits are accessible in capability handlers | Handler reads `context.runtime.definition.traits.traits.voice` and gets expected value |
| 5 | Traits are accessible in lifecycle hooks | `onStart` hook reads `runtime.definition.traits` successfully |
| 6 | Raw (non-frozen) traits object is frozen by core | Passing a plain object as `traits` on the definition results in a frozen provider on the runtime |

### 5.3 Backward compatibility proof

| Test | Asserts |
|---|---|
| All existing core tests pass without modification | Adding `traits?` to `AssistantDefinition` is non-breaking |
| All existing traits tests pass without modification | Traits package is unchanged |
| All existing integration tests (core-sessions, core-sessions-surfaces) pass | No regression in foundation integration |

---

## 6. What Is Explicitly Deferred From This Integration

### Deferred to downstream package integration (v1.x)

| Item | Reason for deferral |
|---|---|
| Surface format hooks reading traits | Requires `@relay-assistant/surfaces` integration work |
| Coordination synthesizers reading traits | Requires `@relay-assistant/coordination` integration work |
| Proactive watch rules reading traits | Requires `@relay-assistant/proactive` integration work |
| Trait-driven capability routing | Not in scope — routing is a separate package concern |

### Deferred to v2

| Item | Reason for deferral |
|---|---|
| Trait inheritance or composition (base traits + overrides) | v1 traits are flat, single-level |
| Runtime trait mutation (changing voice mid-session) | v1 traits are immutable definition-time constants |
| Trait persistence or storage | v1 traits live on the definition, not in a store |
| `toPrompt()` or prompt generation from traits | Permanently out of scope for the SDK; products own this |

### Not deferred (must be proven in this integration)

| Item | Status |
|---|---|
| `traits?: TraitsProvider` on `AssistantDefinition` | Present in `packages/core/src/types.ts` |
| Type-only import from `@relay-assistant/traits` | Present in `packages/core/src/types.ts` |
| Peer dependency declaration | Present in `packages/core/package.json` |
| `freezeDefinition` includes traits | Present in `packages/core/src/core.ts` |
| Integration test suite | Required (§5.2) |
| All existing tests pass | Required (§5.3) |

---

## Contract Summary

| Dimension | Contract |
|---|---|
| Entry point | `AssistantDefinition.traits?: TraitsProvider` |
| Interface | Direct `TraitsProvider` import (type-only), not a narrower duck-type |
| Dependency | Peer dependency (`>=0.1.0`) |
| Core's role | Store, freeze, expose — never interpret |
| Traits' role | Define, validate, construct — never execute |
| Persona boundary | Traits are data; personas are runtime configs; products compose |
| Test proof | 6 integration tests + compile-time check + backward compatibility |
| Deferred | Downstream package consumers, trait inheritance, runtime mutation |

---

V1_TRAITS_CORE_INTEGRATION_CONTRACT_READY
