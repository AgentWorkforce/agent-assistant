# Top-Level SDK Adoption Guide

Date: 2026-04-16
Audience: External consumers — product teams and open-source adopters building assistants with `@agent-assistant/sdk`

---

## What `@agent-assistant/sdk` Is

`@agent-assistant/sdk` is the top-level facade package for Agent Assistant SDK.

It is intended to make first adoption simpler by providing one public entry point for the baseline public surface. It should be understood as a convenience facade, not as a replacement for understanding the runtime primitive stack.

At the time of this document, the facade package directly depends on:

- `@agent-assistant/core`
- `@agent-assistant/inbox`
- `@agent-assistant/traits`
- `@agent-assistant/sessions`
- `@agent-assistant/surfaces`
- `@agent-assistant/policy`
- `@agent-assistant/proactive`

Advanced packages such as `turn-context`, `harness`, `memory`, `continuation`, `coordination`, `connectivity`, and `routing` should still be treated as explicit imports when your product needs them.

---

## Installation

```bash
npm install @agent-assistant/sdk
```

That is the simplest starting point for the common case.

---

## Good use cases for the facade

Use `@agent-assistant/sdk` when:

- you want the easiest first install path
- you are assembling around the baseline runtime shell + traits + sessions + surfaces + policy + proactive + inbox surface
- you want to reduce dependency noise in app-level `package.json`

Do **not** assume the facade contains every package in the repo.

---

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
          text: `Hello from ${context.runtime.definition.name}`,
        });
      },
    },
  },
  { inbound: surfaces, outbound: surfaces },
);

runtime.register('sessions', sessions);
await runtime.start();
```

---

## What is not in the facade

Install these separately when needed:

### Turn execution and context assembly

```bash
npm install @agent-assistant/turn-context @agent-assistant/harness
```

### Memory and continuation

```bash
npm install @agent-assistant/memory @agent-assistant/continuation
```

### Backstage collaboration

```bash
npm install @agent-assistant/connectivity @agent-assistant/coordination
```

### Routing / execution envelope selection

```bash
npm install @agent-assistant/routing
```

The reason is simple: these packages represent more advanced runtime seams and should remain explicit in product assembly rather than being silently implied by the first-install facade.

---

## Recommended adoption path

### Phase 1 — easiest start

Use only the facade:

- core
- traits
- sessions
- surfaces
- policy
- proactive
- inbox

### Phase 2 — bounded visible-turn execution

Add explicit package imports for:

- `@agent-assistant/turn-context`
- `@agent-assistant/harness`

### Phase 3 — deeper continuity

Add explicit package imports for:

- `@agent-assistant/memory`
- `@agent-assistant/continuation`

### Phase 4 — backstage collaboration

Add explicit package imports for:

- `@agent-assistant/connectivity`
- `@agent-assistant/coordination`

### Phase 5 — routing sophistication

Add explicit package imports for:

- `@agent-assistant/routing`

---

## Choosing facade vs direct imports

| Situation | Recommendation |
|---|---|
| New project evaluating the SDK | start with `@agent-assistant/sdk` |
| Product needs only baseline runtime shell + sessions + surfaces + policy/proactive | use the facade |
| Product needs turn-context + harness composition | use facade + direct imports |
| Product needs memory / continuation | use facade + direct imports |
| Product needs connectivity / coordination | direct imports for those packages |
| Product needs tight control over every dependency | import packages directly |

---

## Important note about reality vs historical docs

Some older documents in this repo may describe an earlier facade scope, an earlier package-readiness model, or earlier blocked-package assumptions.

For current adoption:

- trust `packages/*/package.json`
- trust package READMEs
- trust `docs/current-state.md`
- trust the code

Treat older architecture plans and review docs as design history, not install guidance.

---

## Final guidance

The facade is the easiest front door, not the whole house.

It exists to reduce first-adoption friction. As soon as your product needs bounded visible-turn execution, memory, continuation, or multi-agent collaboration, those runtime primitives should become explicit in your imports and product assembly.
