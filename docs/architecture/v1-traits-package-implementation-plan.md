# v1 Traits Package Implementation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/traits`
**Version:** 0.1.0 (pre-1.0, provisional)
**Spec:** `docs/specs/v1-traits-spec.md`
**Scope:** `docs/architecture/v1-traits-scope.md`

---

## 1. Bounded v1 Slice

This plan covers the complete first implementation of `@relay-assistant/traits`. The v1 slice is deliberately narrow: three type definitions, one factory function, one error class, and one validation module. No async, no I/O, no SDK imports.

### What v1 delivers

- `AssistantTraits` type — four required identity fields, two optional
- `SurfaceFormattingTraits` type — three optional formatting hint fields
- `TraitsProvider` interface — read-only accessor contract for consumers
- `createTraitsProvider()` factory — validates, copies, freezes, returns
- `TraitsValidationError` — typed error identifying the failing field
- Integration point: optional `traits?: TraitsProvider` on `AssistantDefinition` in `@relay-assistant/core`

### What v1 explicitly excludes

- Trait inheritance, composition, or layered overrides
- Per-surface behavioral voice overrides
- Trait-driven prompt generation (traits are data, not prompts)
- Trait persistence, versioning, or migration
- Dynamic trait adjustment from runtime context
- Any import from `@relay-assistant/*` packages (leaf position enforced)
- Any reference to workforce persona types, tier names, or routing modes

---

## 2. Exact Files to Create

```
packages/traits/
  package.json          # zero runtime deps, vitest + typescript devDeps
  tsconfig.json         # strict mode, ES2022, match memory/sessions pattern
  src/
    types.ts            # AssistantTraits, SurfaceFormattingTraits, TraitsProvider
    errors.ts           # TraitsValidationError extends Error
    validation.ts       # known value sets, validateAssistantTraits, validateSurfaceFormattingTraits
    create.ts           # createTraitsProvider factory
    index.ts            # re-exports: 3 types (type-only), 1 class, 1 function
  __tests__/
    create.test.ts      # all tests — creation, validation, immutability, errors
```

**Total: 7 files + 1 test file.** No additional modules, helpers, or utilities.

### Coordinated change (after traits package passes all tests)

```
packages/core/src/types.ts   # add optional traits?: TraitsProvider to AssistantDefinition
packages/core/package.json   # add @relay-assistant/traits dependency
```

---

## 3. Schema, Provider, and Validation Details

### 3.1 `src/types.ts` — Pure type declarations, no logic

```typescript
export interface AssistantTraits {
  voice: string;          // known: "concise" | "conversational" | "formal" | "technical"
  formality: string;      // strict: "casual" | "professional" | "academic"
  proactivity: string;    // strict: "low" | "medium" | "high"
  riskPosture: string;    // strict: "cautious" | "moderate" | "assertive"
  domain?: string;        // non-empty string if present
  vocabulary?: string[];  // non-empty array of non-empty strings if present
}

export interface SurfaceFormattingTraits {
  preferredResponseLength?: number;  // positive integer hint
  preferRichBlocks?: boolean;
  preferMarkdown?: boolean;
}

export interface TraitsProvider {
  readonly traits: Readonly<AssistantTraits>;
  readonly surfaceFormatting?: Readonly<SurfaceFormattingTraits>;
}
```

Fields use `string` (not union types) so products can extend vocabulary without forking. Validation enforces known values at creation time; the type system does not.

### 3.2 `src/errors.ts` — Typed validation error

```typescript
export class TraitsValidationError extends Error {
  readonly field: keyof AssistantTraits | keyof SurfaceFormattingTraits;
  readonly invalidValue: unknown;
  constructor(field, invalidValue, message);
}
```

- `field` identifies which trait failed
- `invalidValue` captures the rejected value
- Prototype chain maintained via `Object.setPrototypeOf`

### 3.3 `src/validation.ts` — Known value sets and field checks

Known value constants (all as `Set<string>`):

| Field | Known values | Behavior on unknown |
|---|---|---|
| `voice` | concise, conversational, formal, technical | `console.warn` — accepted, not thrown |
| `formality` | casual, professional, academic | throw `TraitsValidationError` |
| `proactivity` | low, medium, high | throw `TraitsValidationError` |
| `riskPosture` | cautious, moderate, assertive | throw `TraitsValidationError` |

Optional field rules:
- `domain`: if present, must be a non-empty string (after trim)
- `vocabulary`: if present, must be non-empty array where every element is a non-empty string
- `preferredResponseLength`: if present, must be a positive integer
- `preferRichBlocks`, `preferMarkdown`: TypeScript enforces boolean type; no extra runtime check

Two exported functions:
- `validateAssistantTraits(traits: AssistantTraits): void`
- `validateSurfaceFormattingTraits(fmt: SurfaceFormattingTraits): void`

Both throw `TraitsValidationError` on the first invalid field. Both are synchronous.

### 3.4 `src/create.ts` — Factory function

```typescript
export function createTraitsProvider(
  traits: AssistantTraits,
  surfaceFormatting?: SurfaceFormattingTraits,
): TraitsProvider;
```

Steps:
1. Call `validateAssistantTraits(traits)` — throws on first invalid field
2. If `surfaceFormatting` provided, call `validateSurfaceFormattingTraits(surfaceFormatting)`
3. Shallow-copy both inputs (`{ ...traits }`, `{ ...surfaceFormatting }`)
4. `Object.freeze` both copies
5. Return `Object.freeze({ traits: frozenTraits, surfaceFormatting: frozenFormatting })`

The shallow copy before freeze ensures caller mutations to the original objects do not affect the provider. `vocabulary` is an array reference within the shallow copy — this is acceptable for v1 since the provider is frozen at the top level and mutation of the array would require the caller to hold a reference to the original, which is a documented non-contract.

### 3.5 `src/index.ts` — Public API surface

```typescript
// Type-only exports
export type { AssistantTraits, SurfaceFormattingTraits, TraitsProvider } from './types.js';

// Value exports
export { TraitsValidationError } from './errors.js';
export { createTraitsProvider } from './create.js';
```

This is the entire public API. No validation internals, no known-value sets, no internal helpers exported.

---

## 4. Traits vs. Workforce Personas — Boundary Rules

These rules are **non-negotiable** for this implementation:

1. **No persona imports.** `packages/traits/` must never import from workforce infrastructure, persona definitions, or any `@agentworkforce/*` package. The boundary is absolute.

2. **No prompt generation.** Traits are data values. The package never produces a string that a model will receive. `toPrompt()`, `toSystemPrompt()`, or any string template method is forbidden.

3. **No tier or routing vocabulary.** Workforce tier names (`best`, `best-value`, `minimum`) and SDK routing modes (`cheap`, `fast`, `deep`) must not appear anywhere in this package — not in types, not in comments, not in tests.

4. **No runtime config fields.** Model selection, temperature, max tokens, harness type, skills — all belong in workforce personas. None appear in `AssistantTraits` or `SurfaceFormattingTraits`.

5. **Read-only downstream flow.** Consuming packages (surfaces, coordination, proactive) read `TraitsProvider`. They never write to it, extend it, or import the factory. Products pass the provider as configuration — it flows one way.

6. **Products compose traits into personas.** A persona's system prompt may embed `voice: "concise"` as the instruction "Respond concisely." That composition is product code. This package provides the data; it never performs the composition.

---

## 5. Coordinated Core Change

After all traits package tests pass, apply one change to `packages/core/src/types.ts`:

```typescript
// Current AssistantDefinition:
export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}

// Updated:
import type { TraitsProvider } from '@relay-assistant/traits';

export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;                        // NEW — optional
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
```

- Add `@relay-assistant/traits` to `packages/core/package.json` dependencies
- Confirm all existing core tests pass (field is optional, non-breaking)
- Do **not** add this field until the traits package builds and tests pass

---

## 6. Minimum Tests

All tests in `__tests__/create.test.ts` using vitest. Target: 25+ tests minimum.

### 6.1 Valid creation (8 tests)

| Test | Assertion |
|---|---|
| Required fields only (known values) | Provider created, traits accessible |
| All fields including domain and vocabulary | All values present on provider |
| No surfaceFormatting argument | `provider.surfaceFormatting` is undefined |
| With surfaceFormatting (all fields) | All formatting values accessible |
| Each known voice value (concise, conversational, formal, technical) | No throw, value preserved |

### 6.2 Validation failures — throws TraitsValidationError (11 tests)

| Test | Input | Expected |
|---|---|---|
| Invalid formality | `formality: 'semi-formal'` | throws, field='formality' |
| Invalid proactivity | `proactivity: 'very-high'` | throws, field='proactivity' |
| Invalid riskPosture | `riskPosture: 'reckless'` | throws, field='riskPosture' |
| Empty voice | `voice: ''` | throws, field='voice' |
| Whitespace-only voice | `voice: '   '` | throws, field='voice' |
| Empty domain | `domain: ''` | throws, field='domain' |
| Whitespace-only domain | `domain: '   '` | throws, field='domain' |
| Empty vocabulary array | `vocabulary: []` | throws, field='vocabulary' |
| Vocabulary with empty string | `vocabulary: ['', 'ok']` | throws, field='vocabulary' |
| Zero preferredResponseLength | `preferredResponseLength: 0` | throws |
| Non-integer preferredResponseLength | `preferredResponseLength: 1.5` | throws |

### 6.3 Unknown voice — warn, not throw (2 tests)

| Test | Assertion |
|---|---|
| Unknown voice value 'empathetic' | Does not throw |
| Returned provider preserves unknown voice | `provider.traits.voice === 'empathetic'` |

### 6.4 Immutability (4 tests)

| Test | Assertion |
|---|---|
| Mutation of `provider.traits.voice` | Value unchanged after attempted mutation |
| Mutation of `provider.surfaceFormatting.preferMarkdown` | Value unchanged |
| Adding new key to `provider.traits` | Key does not appear |
| Mutating original input after creation | Provider unaffected |

### 6.5 TraitsValidationError contract (3 tests)

| Test | Assertion |
|---|---|
| `error.field` matches failing field | Correct field name |
| `error instanceof TraitsValidationError` | True |
| `error instanceof Error` | True |

**Total: 28 tests minimum** covering creation, each validation rule, extensible voice, immutability, and error type contract.

---

## 7. Build and Verify

### Package-level checks

```bash
cd packages/traits
npm install
npm run build    # tsc compiles without errors
npm test         # vitest — 25+ tests pass
```

### Cross-package checks (after core integration)

```bash
cd packages/core
npm run build    # still compiles with new optional field
npm test         # existing tests unbroken
```

### Leaf isolation confirmed

- `packages/traits/package.json` has zero `dependencies` (empty object)
- No `import` from `@relay-assistant/*` or `@agentworkforce/*` anywhere in `packages/traits/src/`
- Package builds and tests independently with no monorepo context required

---

## 8. Implementation Order

1. **`src/types.ts`** — type declarations first, everything depends on them
2. **`src/errors.ts`** — error class, depends only on types
3. **`src/validation.ts`** — validation logic, depends on types and errors
4. **`src/create.ts`** — factory, depends on types and validation
5. **`src/index.ts`** — barrel exports
6. **`package.json` + `tsconfig.json`** — project config
7. **`__tests__/create.test.ts`** — full test suite
8. **Build + test** — confirm green
9. **Core integration** — add `traits?: TraitsProvider` to `AssistantDefinition`
10. **Core re-test** — confirm no regressions

Steps 1-5 can be written in any order since they are pure source files, but the logical dependency flow is types → errors → validation → create → index.

---

V1_TRAITS_PACKAGE_IMPLEMENTATION_PLAN_READY
