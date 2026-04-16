# How To Build An Assistant

Date: 2026-04-16

## Purpose

This document explains how a consumer should think about building an assistant on top of this SDK in its current implemented state.

It is intentionally architectural and assembly-oriented. When examples here conflict with package code or package READMEs, trust the code and package READMEs first.

## Start With One Assistant Definition

A product should model one user-facing assistant as:

- one assistant identity
- one assistant session model
- one visible turn path
- zero or more internal specialists
- optional memory, continuation, inbox, and proactive capabilities

The external user experience should remain one coherent assistant even if multiple internal runtimes contribute.

## Recommended Mental Model

Think in runtime primitives, not in one monolithic “assistant brain.”

### Runtime stack

1. `@agent-assistant/core` — runtime shell
2. `@agent-assistant/sessions` — continuity unit
3. `@agent-assistant/surfaces` — assistant-facing surface mediation
4. `@agent-assistant/traits` — stable identity defaults
5. `@agent-assistant/turn-context` — one-turn context assembly
6. `@agent-assistant/harness` — bounded turn executor
7. `@agent-assistant/policy` — approval / action governance seam
8. `@agent-assistant/memory` — durable memory composition
9. `@agent-assistant/continuation` — unfinished-turn resume runtime
10. `@agent-assistant/inbox` — trusted outsider ingestion boundary
11. `@agent-assistant/proactive` — outbound follow-up/watch behavior
12. `@agent-assistant/connectivity` / `coordination` — backstage collaboration primitives

### Product-owned layer

Products still own:

- prompt wording
- domain heuristics
- tool inventories
- business rules
- UX decisions
- specialist meanings and ranking logic

## Minimum Build Order

For most products, build in this order:

1. define the assistant runtime boundary in `@agent-assistant/core`
2. define continuity with `@agent-assistant/sessions`
3. attach surfaces with `@agent-assistant/surfaces`
4. add traits with `@agent-assistant/traits`
5. add policy and/or proactive if needed
6. add `turn-context` + `harness` for bounded visible-turn execution
7. add memory if continuity needs durable recall
8. add continuation if unfinished-turn resumption matters
9. add inbox if trusted outsider ingestion matters
10. add coordination/connectivity if multiple internal agents truly help

## What The Product Must Supply

The SDK does not replace product logic.

Each product still supplies:

- domain prompts and instruction sets
- product-specific tools and workflows
- domain-specific watcher definitions
- UI or surface presentation choices
- business policy and escalation rules
- domain-specific enrichment ranking and filtering

## Basic Assembly Pattern

A typical product assembles an assistant in five steps:

1. declare an assistant definition with `id`, `name`, and capability handlers
2. create a session store
3. create a surface registry and register one or more connections
4. create the runtime via `createAssistant(...)`
5. register subsystems and start the runtime

Future subsystems (policy, proactive, memory, continuation, etc.) are also registered on the runtime through product-owned assembly.

## Minimal Assembly Example

```ts
import { createAssistant } from '@agent-assistant/core';
import { createSessionStore, InMemorySessionStoreAdapter } from '@agent-assistant/sessions';
import { createSurfaceRegistry } from '@agent-assistant/surfaces';
import { createTraitsProvider } from '@agent-assistant/traits';

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
  {
    inbound: surfaces,
    outbound: surfaces,
  },
);

runtime.register('sessions', sessions);
await runtime.start();
```

## Turn-Context + Harness Pattern

When a product wants an explicit bounded visible-turn runtime, the healthy composition is:

1. product code gathers inputs
2. `traits` provides identity defaults
3. `turn-context` assembles one-turn context
4. `harness` executes that prepared turn
5. product code operationalizes the result

```ts
import { createTurnContextAssembler } from '@agent-assistant/turn-context';
import { createHarness } from '@agent-assistant/harness';

const assembler = createTurnContextAssembler();
const harness = createHarness({ model: myModelAdapter });

const assembly = await assembler.assemble({
  assistantId: 'sage',
  turnId: 'turn-001',
  identity: {
    assistantName: 'Sage',
    baseInstructions: {
      systemPrompt: 'You are Sage, a workspace assistant.',
      developerPrompt: 'Keep answers focused and actionable.',
    },
  },
  shaping: {
    mode: 'review',
  },
});

const result = await harness.runTurn({
  assistantId: assembly.assistantId,
  turnId: assembly.turnId,
  sessionId: assembly.sessionId,
  userId: assembly.userId,
  message: incomingMessage,
  instructions: assembly.harnessProjection.instructions,
  context: assembly.harnessProjection.context,
});
```

## Continuation Pattern

Use `@agent-assistant/continuation` when the assistant stops honestly but not finally:

- needs clarification
- awaiting approval
- deferred external result
- scheduled wake

That package turns a resumable harness result into explicit state plus resume handling. It is not the same thing as general proactive behavior.

## Inbox Pattern

Use `@agent-assistant/inbox` only for trusted external inputs that are not already Relay-native participants.

Do not treat inbox as a replacement for Relay-native agent-to-agent communication.

## Graceful Degradation Guidance

Consumers should assume that some assistant subsystems may be temporarily unavailable.

Examples:

- if memory is unavailable, the assistant should continue with reduced continuity rather than fail closed for every request
- if proactive scheduling is unavailable, inbound interactions should still work normally
- if coordination fails mid-turn, the assistant should prefer a narrower single-agent answer over total failure when safe
- if one surface is degraded, the session should remain intact for other attached surfaces

## What To Avoid

Do not:

- treat `harness` as shorthand for the whole runtime
- move domain heuristics into shared packages just because multiple products sound vaguely similar
- bypass session contracts by using raw thread IDs as the only continuity key
- confuse inbox with Relay-native agent communication
- let external harness choice define product identity
- use older docs as status truth when package code and package READMEs disagree

## Recommended Product Examples

### Sage-style assistant

Likely emphasis:
- traits
- turn-context
- harness
- memory
- continuation
- proactive

### MSD-style assistant

Likely emphasis:
- core
- sessions
- surfaces
- policy
- coordination

### NightCTO-style assistant

Likely emphasis:
- policy
- proactive
- memory
- coordination
- connectivity
- inbox

These are examples of emphasis, not mandatory fixed stacks.

## Final Rule

Build the assistant by composing explicit runtime primitives.

Do not try to stuff identity, continuity, execution, governance, outsider ingestion, memory, and product intelligence into one abstraction. The SDK is strongest when those seams stay clean.
