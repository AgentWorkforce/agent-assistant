# v1 Traits-Core Integration Plan

**Date:** 2026-04-12
**Packages:** `@relay-assistant/traits` (0.1.0), `@relay-assistant/core` (0.1.0)
**Input:** v1-traits-package-review-verdict, v1-core-review-verdict, v1-traits-core-integration-contract
**Status:** COMPLETE

---

## 1. Integration Scope

### In scope

1. **Confirm existing integration points** — the contract pre-staged three items that were already correct before this plan ran: `traits?: TraitsProvider` on `AssistantDefinition`, `Object.freeze(definition.traits)` in `freezeDefinition`, and the peer dependency declaration in `packages/core/package.json`.
2. **Write the integration test suite** (`packages/core/src/core-traits.test.ts`) covering the 6 contract-required scenarios plus 3 additional behavioral proofs (9 tests total).
3. **Document the integration proof** in `docs/architecture/v1-traits-core-integration-proof.md`.
4. **Update `packages/core/README.md`** with a Traits section showing how consumers wire `TraitsProvider` into `AssistantDefinition` and access trait values from capability handlers.
5. **Verify backward compatibility** — all pre-existing core and traits tests must pass without modification.

### Out of scope (deferred to downstream package integration, v1.x)

- Surface format hooks reading traits (requires `@relay-assistant/surfaces` integration)
- Coordination synthesizers reading traits (requires `@relay-assistant/coordination` integration)
- Proactive watch rules reading traits (requires `@relay-assistant/proactive` integration)
- Trait-driven capability routing (separate package concern)

### Out of scope (deferred to v2)

- Trait inheritance or composition (base traits + overrides)
- Runtime trait mutation (changing voice mid-session)
- Trait persistence or storage
- `toPrompt()` or prompt generation from traits (permanently out of scope for the SDK)

---

## 2. Boundary Design: Pass-Through Data Layer

### Design principle

Core treats `TraitsProvider` as **opaque, pass-through data**. It stores and exposes the provider without reading, interpreting, or branching on any trait field values.

```
┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│  @relay-assistant/   │       │  @relay-assistant/   │       │  Downstream          │
│  traits              │       │  core                │       │  consumers           │
│                      │       │                      │       │                      │
│  createTraitsProvider│──────▶│  createAssistant()   │──────▶│  capability handlers │
│  → validates inputs  │       │  → freezeDefinition()│       │  lifecycle hooks     │
│  → freezes inner     │       │  → stores on runtime │       │  surface format hooks│
│  → returns provider  │       │  → exposes via       │       │  coordination synth  │
│                      │       │    runtime.definition│       │  proactive rules     │
└──────────────────────┘       └──────────────────────┘       └──────────────────────┘
```

Core performs zero reads of trait field values. The derivation of behavior from traits belongs entirely to downstream consumers.

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

Core's import is `import type { TraitsProvider }` — type-only. At runtime, core has zero calls into traits code. Consumers who do not use traits do not need to install it.

---

## 3. What Was Already in Place (Pre-Staged)

The contract specified three implementation points that were already correct when this integration plan ran. No code changes were required for these:

| Item | Location | Status |
|---|---|---|
| `traits?: TraitsProvider` on `AssistantDefinition` | `packages/core/src/types.ts:83` | Already present |
| `import type { TraitsProvider }` | `packages/core/src/types.ts:1` | Already present |
| `Object.freeze(definition.traits)` in `freezeDefinition` | `packages/core/src/core.ts:59` | Already present |
| Peer dependency `@relay-assistant/traits: >=0.1.0` | `packages/core/package.json` | Already present |

---

## 4. Integration Test Suite

### Location

`packages/core/src/core-traits.test.ts`

### Test inventory (9 tests)

All 6 contract-required scenarios (§5.2) plus 3 additional behavioral proofs:

| # | Test | Contract §5.2 | Asserts |
|---|---|---|---|
| 1 | Definition with traits creates a valid runtime | Required | `runtime.definition.traits` is defined; all trait fields match input |
| 2 | Definition without traits creates a valid runtime | Required | `runtime.definition.traits` is `undefined`; backward compatible |
| 3 | Traits are frozen on the runtime definition | Required | `Object.isFrozen(runtime.definition.traits)` is `true`; mutating `voice` throws `TypeError` |
| 4 | Traits are accessible in capability handlers | Required | Handler reads `context.runtime.definition.traits?.traits.voice` and gets expected value |
| 5 | Traits are accessible in lifecycle hooks | Required | `onStart` hook reads `runtime.definition.traits` and receives typed provider |
| 6 | Raw plain-object traits are frozen by core | Required | Passing an unfrozen plain object → `runtime.definition.traits` is frozen |
| 7 | Traits coexist with all other definition fields | Additional | Full definition with traits + hooks + constraints + multiple capabilities works cleanly |
| 8 | Two assistants with different traits dispatch identically | Additional | Core does not branch on trait values; both handlers invoked exactly once |
| 9 | Surface formatting traits flow through unmodified | Additional | `preferredResponseLength`, `preferRichBlocks`, `preferMarkdown`, `domain`, `vocabulary` all intact |

### Backward compatibility tests (pre-existing)

All pre-existing tests pass without modification:

| File | Tests | Result |
|---|---|---|
| `core.test.ts` | 16 | PASS |
| `core-sessions.test.ts` | 9 | PASS |
| `core-sessions-surfaces.test.ts` | 6 | PASS |
| `traits/src/traits.test.ts` | 32 | PASS |

---

## 5. README Update

`packages/core/README.md` received a **Traits** section documenting:

- How to create a `TraitsProvider` using `createTraitsProvider()` from `@relay-assistant/traits`
- How to wire the provider into `AssistantDefinition` via the `traits` field
- How to access trait values from capability handlers via `context.runtime.definition.traits`
- The distinction between traits (data) and personas (product-layer execution config)
- Which packages interpret trait values (surfaces, coordination, proactive — not core)

---

## 6. Implementation Order

| Step | Change | Location | Depends on |
|---|---|---|---|
| 1 | Read contract, review verdict, existing code | `docs/architecture/`, `packages/core/src/`, `packages/traits/src/` | — |
| 2 | Confirm pre-staged implementation points are correct | `types.ts`, `core.ts`, `package.json` | Step 1 |
| 3 | Write 9-test integration suite | `packages/core/src/core-traits.test.ts` | Step 2 |
| 4 | Run full test suite to confirm 9/9 pass + no regression | `packages/core/` | Step 3 |
| 5 | Update `packages/core/README.md` with Traits section | `packages/core/README.md` | Step 2 |
| 6 | Write integration proof document | `docs/architecture/v1-traits-core-integration-proof.md` | Steps 3–4 |

---

## 7. What This Plan Does NOT Change

- **`@relay-assistant/traits`:** No code changes. Traits package is used through its existing public API (`createTraitsProvider`, `TraitsProvider`).
- **`@relay-assistant/core` runtime behavior:** No behavioral changes. Core continues to dispatch, emit, and manage lifecycle identically for all assistants regardless of trait values.
- **Package dependency graph:** Traits remains a type-only peer dependency of core. No circular dependency risk. No new runtime coupling.
- **Existing consumers:** The `traits?` field is optional. All existing `AssistantDefinition` objects without traits continue to work with zero modification.

---

## 8. Definition of Done

- [x] `traits?: TraitsProvider` is present on `AssistantDefinition` in `packages/core/src/types.ts`
- [x] `import type { TraitsProvider }` is a type-only import in `packages/core/src/types.ts`
- [x] `freezeDefinition` freezes the traits provider in `packages/core/src/core.ts`
- [x] Peer dependency `@relay-assistant/traits: >=0.1.0` declared in `packages/core/package.json`
- [x] `packages/core/src/core-traits.test.ts` implements all 6 required scenarios + 3 additional (9 total)
- [x] All 9 integration tests pass (`npm test` in `packages/core`)
- [x] All pre-existing core tests pass without modification (31 tests across 3 files)
- [x] All traits package tests pass without modification (32 tests)
- [x] `packages/core/README.md` updated with Traits section
- [x] `docs/architecture/v1-traits-core-integration-proof.md` documents all scenarios and backward compatibility

---

V1_TRAITS_CORE_INTEGRATION_PLAN_READY
