# v1 Traits-Core Integration Proof

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Date:** 2026-04-12
**Status:** COMPLETE
**Packages:** `@relay-assistant/traits` (0.1.0), `@relay-assistant/core` (0.1.0)
**Contract:** v1-traits-core-integration-contract.md

---

## Proof Summary

All contract requirements have been implemented and verified. The traits-core integration is complete as a pass-through data layer. Core stores, freezes, and exposes `TraitsProvider` without interpreting or branching on trait values.

---

## 1. Implementation Locations

### `packages/core/src/types.ts`

The `AssistantDefinition` interface has `traits?: TraitsProvider` as an optional field:

```typescript
import type { TraitsProvider } from '@relay-assistant/traits';

export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;  // ← integration entry point
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
```

This is a type-only import. Core has no runtime dependency on the traits package.

### `packages/core/src/core.ts` — `freezeDefinition`

The `freezeDefinition` function freezes the traits provider during definition assembly:

```typescript
function freezeDefinition(definition: AssistantDefinition): Readonly<AssistantDefinition> {
  // ...
  const frozenTraits = definition.traits ? Object.freeze(definition.traits) : undefined;

  return Object.freeze({
    ...definition,
    // ...
    traits: frozenTraits,
  });
}
```

- If the definition includes a `TraitsProvider` from `createTraitsProvider()`, it is already deeply frozen (inner `traits` and `surfaceFormatting` objects are frozen by the traits package).
- If a plain object conforming to `TraitsProvider` is passed (e.g., in tests), `Object.freeze` ensures the outer provider object is frozen by core.

### `packages/core/package.json`

```json
{
  "peerDependencies": {
    "@relay-assistant/traits": ">=0.1.0"
  },
  "devDependencies": {
    "@relay-assistant/traits": "file:../traits"
  }
}
```

Traits is a peer dependency. Consumers that do not use traits are not forced to install it.

---

## 2. Test Proof

**Test file:** `packages/core/src/core-traits.test.ts`

All 9 tests pass. The 6 contract-required scenarios plus 3 additional behavioral proofs:

| # | Test | Result |
|---|---|---|
| 1 | Definition with traits creates a valid runtime and exposes traits on `runtime.definition` | PASS |
| 2 | Definition without traits creates a valid runtime with traits as `undefined` | PASS |
| 3 | Traits are frozen on the runtime definition — mutating voice throws `TypeError` | PASS |
| 4 | Traits are accessible inside capability handlers via `context.runtime.definition.traits` | PASS |
| 5 | Traits are accessible in the `onStart` lifecycle hook via `runtime.definition.traits` | PASS |
| 6 | Raw plain-object traits passed as `definition.traits` are frozen by core during assembly | PASS |
| 7 | Traits field coexists cleanly with all other `AssistantDefinition` fields | PASS |
| 8 | Two assistants with different traits dispatch identically — core does not branch on trait values | PASS |
| 9 | Surface formatting traits are accessible and unmodified on the runtime definition | PASS |

**Full test results:**

```
 ✓ src/core-traits.test.ts (9 tests) 3ms
 ✓ src/core-sessions.test.ts (9 tests) 5ms
 ✓ src/core-sessions-surfaces.test.ts (6 tests) 106ms
 ✓ src/core.test.ts (16 tests) 132ms

 Test Files  4 passed (4)
      Tests  40 passed (40)
```

---

## 3. Backward Compatibility

All pre-existing core tests (31 tests across 3 files) pass without modification:

- `core.test.ts` — 16 tests covering `createAssistant`, lifecycle, dispatch, emit, concurrency
- `core-sessions.test.ts` — 9 tests covering core + sessions integration (WF-4)
- `core-sessions-surfaces.test.ts` — 6 tests covering core + sessions + surfaces integration

All traits package tests (32 tests in `traits.test.ts`) pass without modification.

Adding `traits?: TraitsProvider` as an optional field is non-breaking. Existing definitions without `traits` work identically.

---

## 4. Proof Scenarios (From Contract §5)

### Scenario 1: Assistant definition accepts traits in a first-class way

```typescript
const provider = createTraitsProvider(
  { voice: 'concise', formality: 'professional', proactivity: 'medium', riskPosture: 'moderate' },
  { preferredResponseLength: 800, preferMarkdown: true, preferRichBlocks: false },
);

const runtime = createAssistant({
  id: 'assistant-1',
  name: 'Test',
  traits: provider,
  capabilities: { reply: async () => undefined },
}, adapters);

runtime.definition.traits?.traits.voice;        // 'concise' — typed, no cast
runtime.definition.traits?.surfaceFormatting;   // { preferMarkdown: true, ... }
```

`TraitsProvider` is a first-class typed field on `AssistantDefinition`. No casts needed at access sites.

### Scenario 2: Traits flow through core assembly cleanly

The flow:

```
createTraitsProvider(traits, surfaceFormatting)
  → validates inputs
  → freezes inner objects
  → returns frozen TraitsProvider

createAssistant({ ..., traits: provider }, adapters)
  → validateDefinition() — checks id, name, capabilities only; ignores traits content
  → freezeDefinition()   — Object.freeze(provider) for defense-in-depth
  → stores on frozenDefinition.traits
  → exposed via runtime.definition.traits
```

Core performs zero reads of trait field values during assembly. Traits pass through as an opaque data payload.

### Scenario 3: Surface-facing formatting/voice defaults derivable from traits without product persona logic in core

Capability handlers and hooks can read trait values and derive surface behavior:

```typescript
// In a capability handler — surface format decision lives here, not in core
const handler: CapabilityHandler = async (message, context) => {
  const traits = context.runtime.definition.traits;
  const voice = traits?.traits.voice;
  const preferMarkdown = traits?.surfaceFormatting?.preferMarkdown;

  // Handler derives formatting from traits — core has no knowledge of this
  const formatted = preferMarkdown ? toMarkdown(response) : response;
  await context.runtime.emit({ surfaceId: message.surfaceId, text: formatted });
};
```

Core never touches `voice`, `preferMarkdown`, or any other trait field. The derivation belongs to surface-layer consumers.

### Scenario 4: Traits remain distinct from workforce/runtime personas

```
TraitsProvider (SDK data record)          Workforce Persona (runtime execution config)
─────────────────────────────────         ─────────────────────────────────────────────
voice: 'concise'               →          systemPrompt: "You are Sage, a concise..."
formality: 'professional'      →          model: 'claude-sonnet-4-6'
proactivity: 'medium'          →          harness: 'claude'
riskPosture: 'moderate'        →          tier: 'best-value'

Stored on: AssistantDefinition.traits     Stored on: workforce config (product layer)
Owned by: @relay-assistant/traits         Owned by: product code
Frozen at: createTraitsProvider() time    Constructed at: workforce assembly time
Core role: store and expose               Core role: none (core knows nothing of personas)
```

Traits are identity data. Personas are execution configurations. Products map one to the other at their integration boundary. Core is unaware of personas.

---

## 5. What Was Not Implemented (Deferred per Contract §6)

| Item | Status |
|---|---|
| Surface format hooks reading traits | Deferred — requires `@relay-assistant/surfaces` integration |
| Coordination synthesizers reading traits | Deferred — requires `@relay-assistant/coordination` integration |
| Proactive watch rules reading traits | Deferred — requires `@relay-assistant/proactive` integration |
| Trait-driven capability routing | Deferred — not in scope |
| Trait inheritance / composition | Deferred to v2 |
| Runtime trait mutation | Deferred to v2 |
| `toPrompt()` or prompt generation | Permanently out of scope for the SDK |

---

## 6. Files Changed

| File | Change |
|---|---|
| `packages/core/src/types.ts` | `traits?: TraitsProvider` on `AssistantDefinition` (already present) |
| `packages/core/src/core.ts` | `frozenTraits` in `freezeDefinition` (already present) |
| `packages/core/package.json` | Peer dependency on `@relay-assistant/traits` (already present) |
| `packages/core/src/core-traits.test.ts` | **New** — 9 integration tests |
| `docs/architecture/v1-traits-core-integration-proof.md` | **New** — this document |
| `packages/core/README.md` | **Updated** — traits assembly section added |

---

V1_TRAITS_CORE_INTEGRATION_PROOF_COMPLETE
