# v1 Traits Implementation Plan

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/traits`
**Spec:** `docs/specs/v1-traits-spec.md`
**Scope doc:** `docs/architecture/v1-traits-scope.md`
**Workflow:** WF-7 (standalone traits package)

---

## 1. Orientation

`@relay-assistant/traits` is a leaf data package. It has no runtime dependencies, no relay package imports, no upstream SDK imports, and no prompt generation logic. Its entire surface is type definitions, a factory, and a validation layer.

The implementation is narrow. The risk surface is low. The test target is 25+ tests. The coordinated change is one optional field on `AssistantDefinition` in `@relay-assistant/core`.

Read `docs/specs/v1-traits-spec.md` before writing any code.

---

## 2. Files to Create

```
packages/traits/
  package.json
  tsconfig.json
  src/
    types.ts          — AssistantTraits, SurfaceFormattingTraits, TraitsProvider
    errors.ts         — TraitsValidationError
    validation.ts     — field-level validation logic, known value sets
    create.ts         — createTraitsProvider factory
    index.ts          — public API exports
  __tests__/
    create.test.ts    — factory, validation, immutability, error type tests
```

Six source files, one test file. No additional modules needed.

---

## 3. File Contents

### 3.1 `package.json`

```json
{
  "name": "@relay-assistant/traits",
  "version": "0.1.0",
  "description": "Assistant identity traits for the Relay Agent Assistant SDK",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

**Zero runtime dependencies.** No relay packages, no SDK packages. This is enforced by the leaf position in the dependency graph.

### 3.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "__tests__"]
}
```

Match the tsconfig pattern used in `packages/memory` and `packages/sessions`.

### 3.3 `src/types.ts`

Define the three public types. No logic.

```typescript
export interface AssistantTraits {
  voice: string;
  formality: string;
  proactivity: string;
  riskPosture: string;
  domain?: string;
  vocabulary?: string[];
}

export interface SurfaceFormattingTraits {
  preferredResponseLength?: number;
  preferRichBlocks?: boolean;
  preferMarkdown?: boolean;
}

export interface TraitsProvider {
  readonly traits: Readonly<AssistantTraits>;
  readonly surfaceFormatting?: Readonly<SurfaceFormattingTraits>;
}
```

Keep the type file free of validation logic, imports, and side effects.

### 3.4 `src/errors.ts`

```typescript
import type { AssistantTraits, SurfaceFormattingTraits } from './types.js';

type TraitsField =
  | keyof AssistantTraits
  | keyof SurfaceFormattingTraits;

export class TraitsValidationError extends Error {
  readonly field: TraitsField;
  readonly invalidValue: unknown;

  constructor(field: TraitsField, invalidValue: unknown, message: string) {
    super(message);
    this.name = 'TraitsValidationError';
    this.field = field;
    this.invalidValue = invalidValue;

    // Maintain prototype chain in environments that transpile extends Error
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

### 3.5 `src/validation.ts`

Contains all known value sets and per-field validation logic. Validation is invoked only from `create.ts`.

```typescript
import { TraitsValidationError } from './errors.js';
import type { AssistantTraits, SurfaceFormattingTraits } from './types.js';

// Known strict values
const KNOWN_VOICE_VALUES = new Set(['concise', 'conversational', 'formal', 'technical']);
const VALID_FORMALITY = new Set(['casual', 'professional', 'academic']);
const VALID_PROACTIVITY = new Set(['low', 'medium', 'high']);
const VALID_RISK_POSTURE = new Set(['cautious', 'moderate', 'assertive']);

export function validateAssistantTraits(traits: AssistantTraits): void {
  // voice — extensible, warn only for unknowns
  if (typeof traits.voice !== 'string' || traits.voice.trim() === '') {
    throw new TraitsValidationError(
      'voice',
      traits.voice,
      "voice must be a non-empty string; known values: 'concise', 'conversational', 'formal', 'technical'",
    );
  }
  if (!KNOWN_VOICE_VALUES.has(traits.voice)) {
    // Unknown voice value: accepted but logged
    console.warn(
      `[traits] Unknown voice value '${traits.voice}'. ` +
      `Known values: ${[...KNOWN_VOICE_VALUES].join(', ')}`,
    );
  }

  // formality — strict enum
  if (!VALID_FORMALITY.has(traits.formality)) {
    throw new TraitsValidationError(
      'formality',
      traits.formality,
      `formality must be 'casual', 'professional', or 'academic'; got '${traits.formality}'`,
    );
  }

  // proactivity — strict enum
  if (!VALID_PROACTIVITY.has(traits.proactivity)) {
    throw new TraitsValidationError(
      'proactivity',
      traits.proactivity,
      `proactivity must be 'low', 'medium', or 'high'; got '${traits.proactivity}'`,
    );
  }

  // riskPosture — strict enum
  if (!VALID_RISK_POSTURE.has(traits.riskPosture)) {
    throw new TraitsValidationError(
      'riskPosture',
      traits.riskPosture,
      `riskPosture must be 'cautious', 'moderate', or 'assertive'; got '${traits.riskPosture}'`,
    );
  }

  // domain — optional, must be non-empty string
  if (traits.domain !== undefined) {
    if (typeof traits.domain !== 'string' || traits.domain.trim() === '') {
      throw new TraitsValidationError(
        'domain',
        traits.domain,
        'domain must be a non-empty string when provided',
      );
    }
  }

  // vocabulary — optional, must be non-empty array of non-empty strings
  if (traits.vocabulary !== undefined) {
    if (!Array.isArray(traits.vocabulary) || traits.vocabulary.length === 0) {
      throw new TraitsValidationError(
        'vocabulary',
        traits.vocabulary,
        'vocabulary must be a non-empty array when provided',
      );
    }
    for (const term of traits.vocabulary) {
      if (typeof term !== 'string' || term.trim() === '') {
        throw new TraitsValidationError(
          'vocabulary',
          term,
          'each vocabulary term must be a non-empty string',
        );
      }
    }
  }
}

export function validateSurfaceFormattingTraits(fmt: SurfaceFormattingTraits): void {
  if (
    fmt.preferredResponseLength !== undefined &&
    (typeof fmt.preferredResponseLength !== 'number' ||
      !Number.isInteger(fmt.preferredResponseLength) ||
      fmt.preferredResponseLength <= 0)
  ) {
    throw new TraitsValidationError(
      'preferredResponseLength',
      fmt.preferredResponseLength,
      'preferredResponseLength must be a positive integer when provided',
    );
  }
  // preferRichBlocks and preferMarkdown are optional booleans — TypeScript
  // enforces the type; no extra runtime check needed given strict mode compilation.
}
```

### 3.6 `src/create.ts`

```typescript
import type { AssistantTraits, SurfaceFormattingTraits, TraitsProvider } from './types.js';
import {
  validateAssistantTraits,
  validateSurfaceFormattingTraits,
} from './validation.js';

export function createTraitsProvider(
  traits: AssistantTraits,
  surfaceFormatting?: SurfaceFormattingTraits,
): TraitsProvider {
  validateAssistantTraits(traits);
  if (surfaceFormatting !== undefined) {
    validateSurfaceFormattingTraits(surfaceFormatting);
  }

  const frozenTraits = Object.freeze({ ...traits });
  const frozenFormatting =
    surfaceFormatting !== undefined
      ? Object.freeze({ ...surfaceFormatting })
      : undefined;

  return Object.freeze({
    traits: frozenTraits,
    surfaceFormatting: frozenFormatting,
  });
}
```

The factory shallow-copies both inputs before freezing, so callers who mutate their input objects after creation do not affect the provider.

### 3.7 `src/index.ts`

```typescript
export type {
  AssistantTraits,
  SurfaceFormattingTraits,
  TraitsProvider,
} from './types.js';

export { TraitsValidationError } from './errors.js';
export { createTraitsProvider } from './create.js';
```

That is the entire public API. No internal implementation details are exported.

---

## 4. Test Plan

All tests live in `__tests__/create.test.ts`. Use `vitest`.

### 4.1 Valid creation

```
- createTraitsProvider with all four required fields set to known values
- createTraitsProvider with all optional fields (domain, vocabulary, surfaceFormatting)
- createTraitsProvider with no surfaceFormatting
- voice = 'concise', 'conversational', 'formal', 'technical' — all accepted
- formality = 'casual', 'professional', 'academic' — all accepted
- proactivity = 'low', 'medium', 'high' — all accepted
- riskPosture = 'cautious', 'moderate', 'assertive' — all accepted
```

### 4.2 Validation failures — throw `TraitsValidationError`

```
- formality = 'semi-formal' → throws, field = 'formality', invalidValue = 'semi-formal'
- proactivity = 'very-high' → throws, field = 'proactivity'
- riskPosture = 'reckless' → throws, field = 'riskPosture'
- domain = '' → throws, field = 'domain'
- domain = '   ' → throws, field = 'domain'
- vocabulary = [] → throws, field = 'vocabulary'
- vocabulary = ['', 'term'] → throws, field = 'vocabulary'
- preferredResponseLength = 0 → throws, field = 'preferredResponseLength'
- preferredResponseLength = -1 → throws, field = 'preferredResponseLength'
- preferredResponseLength = 1.5 → throws, field = 'preferredResponseLength'
```

### 4.3 Unknown voice value — warn, do not throw

```
- voice = 'empathetic' → createTraitsProvider does not throw
- returned provider.traits.voice === 'empathetic'
```

### 4.4 Immutability

```
- attempt to mutate provider.traits.voice after creation → no-op (frozen)
- attempt to mutate provider.surfaceFormatting.preferMarkdown → no-op (frozen)
- attempt to add a new key to provider.traits → no-op (frozen)
- original input object mutation after creation does not affect provider.traits
```

### 4.5 `TraitsValidationError` contract

```
- error.field equals the field name that failed
- error.invalidValue equals the value that was rejected
- error.message is a non-empty string
- error.name === 'TraitsValidationError'
- error instanceof TraitsValidationError
- error instanceof Error
```

### 4.6 `SurfaceFormattingTraits` defaults

```
- all formatting fields absent → provider.surfaceFormatting is undefined
- all formatting fields present → all values accessible and correct
- only preferMarkdown set → preferRichBlocks and preferredResponseLength are undefined
```

---

## 5. Coordinated Change: `@relay-assistant/core`

When the traits package is ready (all tests passing, types exported), apply a single change to `packages/core/src/types.ts`:

```typescript
// Add import at top of file:
import type { TraitsProvider } from '@relay-assistant/traits';

// Add optional field to AssistantDefinition:
export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;   // NEW — from @relay-assistant/traits
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
```

Add `@relay-assistant/traits` to `packages/core/package.json` as a dependency.

Confirm that existing core tests still pass after this change. The field is optional; no existing code paths should break.

---

## 6. Verification Checklist

Before marking the implementation workflow complete:

- [ ] `packages/traits/src/types.ts` — three types exported
- [ ] `packages/traits/src/errors.ts` — `TraitsValidationError` with `field`, `invalidValue`, `message`
- [ ] `packages/traits/src/validation.ts` — all validation rules from §3.3 of the spec
- [ ] `packages/traits/src/create.ts` — factory validates, copies, freezes, returns
- [ ] `packages/traits/src/index.ts` — only public API exported
- [ ] `packages/traits/__tests__/create.test.ts` — 25+ tests, all passing
- [ ] `packages/traits/package.json` — zero runtime dependencies
- [ ] `packages/core/src/types.ts` updated with optional `traits?: TraitsProvider`
- [ ] Core tests still passing after `AssistantDefinition` change
- [ ] `npm run build` succeeds in `packages/traits`
- [ ] `npm test` in `packages/traits` reports all passing

---

## 7. What Not to Build

These are explicit non-goals for this implementation workflow:

- **No trait inheritance, composition, or layering.** The factory takes one `AssistantTraits` object. No merging, no base + override pattern.
- **No system prompt generation.** The package does not produce prompt strings from trait values. That is always product code.
- **No persona definitions or imports.** Workforce persona types must not appear in this package at any level.
- **No per-surface trait overrides.** `SurfaceFormattingTraits` is a single formatting hint set, not a map keyed by surface type.
- **No dynamic mutation.** The factory is the only creation path. There are no setters, no update functions, no mutable providers.
- **No model calls or async operations.** The factory is synchronous. There is nothing to await.
- **No SDK package imports.** `packages/traits` must have zero imports from `@relay-assistant/*` packages.

---

V1_TRAITS_IMPLEMENTATION_PLAN_READY
