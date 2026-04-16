# `@agent-assistant/sdk`

`@agent-assistant/sdk` is the top-level facade package for Agent Assistant SDK.

It exists to make first adoption simpler by giving consumers one install and one import surface for the baseline public runtime packages.

## What it includes

At the current package boundary, the facade directly depends on and re-exports the baseline public surface from:

- `@agent-assistant/core`
- `@agent-assistant/inbox`
- `@agent-assistant/traits`
- `@agent-assistant/sessions`
- `@agent-assistant/surfaces`
- `@agent-assistant/policy`
- `@agent-assistant/proactive`

This is the easiest first entry point for product teams who want a working assistant shell without deciding every package boundary up front.

## What it does not include

The facade is not the whole runtime stack.

Install these packages directly when your product needs them:

- `@agent-assistant/turn-context`
- `@agent-assistant/harness`
- `@agent-assistant/memory`
- `@agent-assistant/continuation`
- `@agent-assistant/connectivity`
- `@agent-assistant/coordination`
- `@agent-assistant/routing`

That split is intentional. Those packages represent more explicit runtime seams and should stay visible in product assembly rather than being silently implied by the first-install path.

## Installation

```bash
npm install @agent-assistant/sdk
```

## Minimal example

```ts
import {
  createAssistant,
  createTraitsProvider,
  createSessionStore,
  InMemorySessionStoreAdapter,
  createSurfaceRegistry,
} from '@agent-assistant/sdk';

const traits = createTraitsProvider(
  {
    voice: 'concise',
    formality: 'professional',
    proactivity: 'medium',
    riskPosture: 'moderate',
  },
  { preferMarkdown: true },
);

const sessions = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

const surfaces = createSurfaceRegistry();

const runtime = createAssistant(
  {
    id: 'my-assistant',
    name: 'My Assistant',
    traits,
    capabilities: {
      reply: async (message, context) => {
        await context.runtime.emit({
          surfaceId: message.surfaceId,
          text: `Acknowledged: ${message.text}`,
        });
      },
    },
  },
  { inbound: surfaces, outbound: surfaces },
);

runtime.register('sessions', sessions);
await runtime.start();
```

## When to use direct package imports instead

Use direct imports when:

- you want explicit control over every runtime primitive
- you need turn-context + harness composition
- you need memory / continuation
- you need connectivity / coordination
- you need routing-specific policy surfaces

The facade is the front door, not the whole house.

## Related docs

- `../../docs/consumer/top-level-sdk-adoption-guide.md`
- `../../docs/current-state.md`
- `../../docs/architecture/package-boundary-map.md`
