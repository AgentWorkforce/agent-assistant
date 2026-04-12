# `@agent-assistant/traits`

`@agent-assistant/traits` is a TypeScript-first leaf package for validated, immutable assistant trait data.

It defines how an assistant presents itself and which formatting hints it prefers. It does not own runtime config, persona prompts, routing, model choice, memory, or product behavior.

## API

```typescript
import {
  createTraitsProvider,
  TraitsValidationError,
} from '@agent-assistant/traits';

import type {
  AssistantTraits,
  SurfaceFormattingTraits,
  TraitsProvider,
} from '@agent-assistant/traits';
```

## Data Model

### `AssistantTraits`

```typescript
interface AssistantTraits {
  voice: string;
  formality: string;
  proactivity: string;
  riskPosture: string;
  domain?: string;
  vocabulary?: string[];
}
```

Rules:

- `voice` must be a non-empty string. Known values are `concise`, `conversational`, `formal`, and `technical`.
- Unknown `voice` values are accepted with `console.warn` so products can extend the register without forking the package.
- `formality` must be `casual`, `professional`, or `academic`.
- `proactivity` must be `low`, `medium`, or `high`.
- `riskPosture` must be `cautious`, `moderate`, or `assertive`.
- `domain`, if present, must be a non-empty string.
- `vocabulary`, if present, must be a non-empty array of non-empty strings.

### `SurfaceFormattingTraits`

```typescript
interface SurfaceFormattingTraits {
  preferredResponseLength?: number;
  preferRichBlocks?: boolean;
  preferMarkdown?: boolean;
}
```

Rules:

- `preferredResponseLength`, if present, must be a positive integer.
- `preferRichBlocks`, if present, must be a boolean.
- `preferMarkdown`, if present, must be a boolean.

These are hints for product-owned format hooks. They do not replace surface capability checks.

### `TraitsProvider`

```typescript
interface TraitsProvider {
  readonly traits: Readonly<AssistantTraits>;
  readonly surfaceFormatting?: Readonly<SurfaceFormattingTraits>;
}
```

Consumers should depend on the read-only provider contract, not mutate or rebuild the provider at runtime.

## Creating a Provider

```typescript
import { createTraitsProvider } from '@agent-assistant/traits';

const traits = createTraitsProvider(
  {
    voice: 'concise',
    formality: 'professional',
    proactivity: 'medium',
    riskPosture: 'moderate',
    domain: 'knowledge-and-workspace',
    vocabulary: ['digest', 'workspace', 'context'],
  },
  {
    preferredResponseLength: 800,
    preferRichBlocks: false,
    preferMarkdown: true,
  },
);
```

`createTraitsProvider` validates inputs, copies them, freezes the returned provider, freezes the nested trait objects, and freezes the copied `vocabulary` array when present.

## Validation Errors

```typescript
import { createTraitsProvider, TraitsValidationError } from '@agent-assistant/traits';

try {
  createTraitsProvider({
    voice: 'concise',
    formality: 'semi-formal',
    proactivity: 'medium',
    riskPosture: 'moderate',
  });
} catch (error) {
  if (error instanceof TraitsValidationError) {
    console.error(error.field);
    console.error(error.invalidValue);
    console.error(error.message);
  }
}
```

`TraitsValidationError` extends `Error` and exposes:

- `field`: the failing trait field name
- `invalidValue`: the rejected value
- `message`: a readable explanation

## Usage Boundaries

This package owns trait data only.

- No workforce persona ownership
- No prompt generation
- No product-specific logic
- No cloud or runtime service assumptions
- No dynamic learning or adaptation engine
- No imports from other Relay Assistant packages

Traits and workforce personas are intentionally separate. Products may compose trait values into persona prompts or synthesizer inputs, but that composition belongs outside this package.

## Adaptation Pattern

The v1 adaptation layer is read-only and product-owned: packages and products read a `TraitsProvider` and apply its values to their own formatting or synthesis logic.

Example formatting usage:

```typescript
const traits = runtime.definition.traits;

const useMarkdown =
  caps.supportsMarkdown && (traits?.surfaceFormatting?.preferMarkdown ?? true);

const responseVoice = traits?.traits.voice ?? 'concise';
```

Example synthesis usage:

```typescript
const traits = context.definition?.traits;

return assembleResponse(results, {
  voice: traits?.traits.voice ?? 'concise',
  formality: traits?.traits.formality ?? 'professional',
});
```

The package does not generate prompts, emit formatted output, or interpret domain vocabulary beyond validation.

## Core Integration

`@agent-assistant/core` can attach a provider on `AssistantDefinition`:

```typescript
const assistant = createAssistant({
  id: 'sage',
  name: 'Sage',
  traits: createTraitsProvider({
    voice: 'concise',
    formality: 'professional',
    proactivity: 'medium',
    riskPosture: 'moderate',
  }),
  capabilities: {
    reply: () => undefined,
  },
});
```

The field is optional. Assistants without traits continue to work unchanged.

## Local Development

From `packages/traits`:

```bash
npm install
npm run build
npm test
```

This package is runnable in isolation and has zero runtime dependencies.

TRAITS_PACKAGE_IMPLEMENTED
