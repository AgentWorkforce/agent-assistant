# How To Build An Assistant

Date: 2026-04-11
Revised: 2026-04-11 (spec-reconciliation pass — all examples updated to match canonical specs)

> **Canonical source of truth:** Package specs in `docs/specs/` override any example or description in this document. If an API name, import path, or assembly pattern in this document conflicts with a spec, trust the spec. See `docs/architecture/spec-reconciliation-rules.md` for the full replacement table.

## Purpose

This document explains how a consumer should think about building an assistant on top of this SDK once implementation begins.

It is intentionally architectural. It does not assume package code exists yet.

## Start With One Assistant Definition

A product should model one user-facing assistant as:

- one assistant identity
- one assistant session model
- zero or more internal specialists
- optional memory and proactive capabilities

The external user experience should remain one coherent assistant even if multiple internal runtimes contribute.

## Expected Package Imports

> **Facade path:** All imports shown below can also be sourced from a single `@agent-assistant/sdk` install.
> See [top-level-sdk-adoption-guide.md](top-level-sdk-adoption-guide.md) for the one-install equivalent.

Consumers should expect to import only the packages they need.

Canonical import shape for v1 packages (core, sessions, surfaces):

```ts
// Core
import { createAssistant } from "@agent-assistant/core";
import type {
  AssistantDefinition,
  AssistantRuntime,
  InboundMessage,
  OutboundEvent,
  CapabilityHandler,
  CapabilityContext,
} from "@agent-assistant/core";

// Sessions
import {
  createSessionStore,
  InMemorySessionStoreAdapter,
  resolveSession,
  createDefaultAffinityResolver,
} from "@agent-assistant/sessions";
import type { Session, SessionStore } from "@agent-assistant/sessions";

// Surfaces
import { createSurfaceRegistry } from "@agent-assistant/surfaces";
import type {
  SurfaceConnection,
  SurfaceRegistry,
  SurfaceAdapter,
  SurfaceCapabilities,
  SurfaceFormatHook,
} from "@agent-assistant/surfaces";
```

Later packages (v1.1+) follow the same pattern:

```ts
import { createMemoryStore } from "@agent-assistant/memory";
import { createProactiveEngine } from "@agent-assistant/proactive";
import { createCoordinator } from "@agent-assistant/coordination";
import { createConnectivityLayer } from "@agent-assistant/connectivity";
import { createActionPolicy } from "@agent-assistant/policy";
```

The names above for future packages are illustrative. v1 names (`createAssistant`, `createSessionStore`, `createSurfaceRegistry`) are spec-confirmed.

## Minimum Build Order

Build an assistant in this order:

1. define the assistant identity and runtime boundary in `@agent-assistant/core`
2. define how inbound activity maps into an assistant session via `@agent-assistant/sessions`
3. attach surfaces through `@agent-assistant/surfaces`
4. add memory via `@agent-assistant/memory` if continuity is needed
5. add proactive behavior via `@agent-assistant/proactive` if the assistant should act when the user is not actively messaging
6. add specialist orchestration via `@agent-assistant/coordination` if one assistant needs multiple internal agents
7. add focused internal signaling via `@agent-assistant/connectivity` when multiple subsystems or specialists must coordinate efficiently
8. govern external actions with `@agent-assistant/policy`

## What The Product Must Supply

The SDK should not replace product logic.

Each product still supplies:

- domain prompts and instruction sets
- product-specific tools and workflows
- domain-specific watcher definitions
- UI or surface presentation choices
- business policy and escalation rules

## Recommended Mental Model

Think in three layers:

### Layer 1: Relay foundation

Use Relay family repos for transport, webhook verification, delivery, auth, scheduler substrate, and low-level action dispatch.

### Layer 2: Assistant SDK

Use this repo for assistant runtime contracts and reusable assistant behavior.

### Layer 3: Product assistant

Use the product repo for the actual product experience.

## Basic Assembly Pattern

A typical product assembles an assistant in five steps:

1. declare an `AssistantDefinition` with `id`, `name`, and `capabilities` (`Record<string, CapabilityHandler>`)
2. create a `SessionStore` via `createSessionStore({ adapter })`
3. create a `SurfaceRegistry` via `createSurfaceRegistry()` and register one or more `SurfaceConnection` objects
4. create the runtime via `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })` — the surface registry implements both relay adapter interfaces
5. call `runtime.register("sessions", sessionStore)` then `runtime.start()`

Future subsystems (memory, proactive, coordination, policy) are also registered on the runtime via `runtime.register(name, subsystem)`.

## Skeletal Assembly Example

```ts
import { createAssistant } from "@agent-assistant/core";
import type {
  AssistantDefinition,
  InboundMessage,
  CapabilityContext,
} from "@agent-assistant/core";
import {
  createSessionStore,
  InMemorySessionStoreAdapter,
  resolveSession,
  createDefaultAffinityResolver,
} from "@agent-assistant/sessions";
import type { SessionStore } from "@agent-assistant/sessions";
import { createSurfaceRegistry } from "@agent-assistant/surfaces";
import type { SurfaceConnection, SurfaceCapabilities } from "@agent-assistant/surfaces";

// Step 1: Define assistant identity and capabilities
const definition: AssistantDefinition = {
  id: "my-assistant",
  name: "My Assistant",
  capabilities: {
    chat: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);
      await store.attachSurface(session.id, message.surfaceId);

      // Targeted send: reply to the originating surface (surfaceId present)
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "response text", // product logic here
      });

      // Session fanout: broadcast to ALL attached surfaces (surfaceId absent)
      // Only needed when a session spans multiple surfaces (e.g., Slack + web).
      // await context.runtime.emit({
      //   sessionId: session.id,
      //   text: "broadcast to all session surfaces",
      // });

      // Invalid (throws OutboundEventError): neither surfaceId nor sessionId present.
    },
  },
};

// Step 2: Create session store
const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

// Step 3: Define and register surface connections
const slackCapabilities: SurfaceCapabilities = {
  markdown: false,
  richBlocks: true,
  attachments: true,
  streaming: false,
  maxResponseLength: 3000,
};

const slackConnection: SurfaceConnection = {
  id: "my-assistant-slack",
  type: "slack",
  state: "registered",
  capabilities: slackCapabilities,
  adapter: slackAdapter, // provided by relay foundation or product code
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);

// Step 4: Create runtime — surfaces implement both relay adapter interfaces
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});

// Step 5: Register subsystems and start
runtime.register("sessions", sessionStore);
await runtime.start();
```

The example above is spec-conformant for v1. Future packages (memory, proactive, etc.) register the same way: `runtime.register("memory", memoryStore)`.

## Graceful Degradation Guidance

Consumers should assume that some assistant subsystems will be temporarily unavailable.

Examples:
- if memory is unavailable, the assistant should continue with reduced continuity rather than fail closed for every request
- if proactive scheduling is unavailable, inbound interactions should still work normally
- if coordination fails mid-turn, the assistant should prefer a narrower single-agent answer over total failure when safe
- if one surface is degraded, the session should remain intact for other attached surfaces

## What To Avoid

Do not:

- couple assistant runtime contracts directly to one surface
- put domain logic into shared SDK packages just because multiple products need something vaguely similar
- bypass session contracts by using raw thread IDs as the only continuity key
- assume any future cloud service exists
- use stale API names — see `docs/architecture/spec-reconciliation-rules.md` Rule 1 for the full replacement table:

| Stale (do not use) | Current |
|---|---|
| `AssistantConfig` | `AssistantDefinition` |
| `Assistant` (live object type) | `AssistantRuntime` |
| `handleMessage(msg)` | `runtime.dispatch(msg)` |
| `assistant.onMessage(handler)` | `AssistantDefinition.capabilities` (`Record<string, CapabilityHandler>`) |
| `AssistantMessage` | `InboundMessage` (inbound) / `OutboundEvent` (outbound) |
| `createSurfaceConnection(config)` | `SurfaceConnection` registered via `createSurfaceRegistry()` |
| `assistant.attachSurface(surface)` | `surfaceRegistry.register(connection)` |
| `sessions.suspend(id)` | `sessionStore.sweepStale(ttlMs)` |
| `sessions.resume(id)` | `sessionStore.touch(id)` |
| `sessions.close(id)` | `sessionStore.expire(id)` |
| Session state `resumed` | Session state `active` (reached via `touch()`) |
| Session state `closed` | Session state `expired` |

## Canonical Assembly Path (v1 Implemented Packages)

Four packages are now implemented with passing test suites and can be composed today:

- `@agent-assistant/core` — runtime, lifecycle, dispatch (31+ tests, SPEC_RECONCILED)
- `@agent-assistant/traits` — personality and formatting traits (32 tests, IMPLEMENTATION_READY)
- `@agent-assistant/policy` — action classification, gating, audit (64 tests, implemented)
- `@agent-assistant/proactive` — follow-up rules, watch rules, scheduler binding (45 tests, implemented)

These replace the "future packages" placeholders from earlier in this document for v1 assembly.

### Full four-package assembly sketch

```ts
import { createAssistant } from '@agent-assistant/core';
import type { InboundMessage, AssistantRuntime } from '@agent-assistant/core';
import { createTraitsProvider } from '@agent-assistant/traits';
import { createActionPolicy, InMemoryAuditSink, type Action } from '@agent-assistant/policy';
import { createProactiveEngine, InMemorySchedulerBinding } from '@agent-assistant/proactive';

// 1. Traits — declarative personality and formatting preferences
const traits = createTraitsProvider(
  { voice: 'concise', formality: 'professional', proactivity: 'medium', riskPosture: 'moderate' },
  { preferMarkdown: true, preferredResponseLength: 600 },
);

// 2. Policy engine — product supplies rules
const auditSink = new InMemoryAuditSink();
const policyEngine = createActionPolicy({ auditSink, fallbackDecision: 'allow' });
// Register product-specific rules here

// 3. Proactive engine — product supplies rules
const proactiveEngine = createProactiveEngine({
  schedulerBinding: new InMemorySchedulerBinding(), // replace with real scheduler in production
});
// Register product-specific follow-up and watch rules here

// 4. Assemble the runtime
const runtime = createAssistant(
  {
    id: 'my-assistant',
    name: 'My Assistant',
    traits,
    capabilities: {
      reply: async (message: InboundMessage, context) => {
        // Gate every reply through policy
        const action: Action = {
          id: `action-${message.id}`,
          type: 'assistant_reply',
          description: `Reply to: ${message.text}`,
          sessionId: message.sessionId ?? 'default-session',
          userId: message.userId,
          proactive: false,
        };
        const { decision } = await policyEngine.evaluate(action);

        if (decision.action !== 'allow') {
          await context.runtime.emit({ surfaceId: message.surfaceId, text: 'Request blocked.' });
          return;
        }

        // Apply traits-aware formatting (product logic)
        const md = context.runtime.definition.traits?.surfaceFormatting?.preferMarkdown;
        const text = md ? `**Assistant:** ${message.text}` : message.text;
        await context.runtime.emit({ surfaceId: message.surfaceId, text });
      },
    },
    hooks: {
      async onStart(rt) {
        rt.register('policy', policyEngine);
        rt.register('proactive', proactiveEngine);
      },
    },
  },
  {
    inbound: { onMessage(h) { /* connect to transport */ void h; }, offMessage() {} },
    outbound: { async send(event) { /* deliver to surface */ void event; } },
  },
);

await runtime.start();
```

See `packages/examples/` for five complete, runnable-shape examples that cover every composition pattern:
- `src/01-minimal-assistant.ts` — core only (universal starting point)
- `src/02-traits-assistant.ts` — core + traits
- `src/03-policy-gated-assistant.ts` — core + policy
- `src/04-proactive-assistant.ts` — core + proactive
- `src/05-full-assembly.ts` — all four packages (canonical reference)

---

## Product Examples

> **Spec conformance:** All assembly code in this section and in `docs/workflows/weekend-delivery-plan.md` conforms to the reconciled v1 specs. If these examples ever drift from the specs in `docs/specs/`, **trust the specs**. The replacement table in `docs/architecture/spec-reconciliation-rules.md` Rule 1 is the primary stale-term reference.

### Sage-style assistant

Use today (v1 packages):

- `core` + `traits` + `proactive`

Use when available:

- `sessions`, `surfaces` (v1 baseline)
- `memory` (v1.1)
- `policy` (when gating proactive actions)

Keep in Sage:

- knowledge and workspace-specific prompt behavior
- product-specific follow-up heuristics
- memory retrieval logic (until `@agent-assistant/memory` ships in v1.1)

Starting example: `packages/examples/src/04-proactive-assistant.ts`

### MSD-style assistant

Use today (v1 packages):

- `core` + `traits` + `policy`

Use when available:

- `sessions`, `surfaces` (v1 baseline)
- `memory` (v1.1)
- `coordination` (v1.2)
- `connectivity` (v1.1)
- `proactive` (v1.2)

Keep in MSD:

- review-specific tools
- PR and code-review heuristics
- coordinator delegation (until `@agent-assistant/coordination` ships in v1.2)

Starting example: `packages/examples/src/03-policy-gated-assistant.ts`

### NightCTO-style assistant

Use today (v1 packages):

- `core` + `traits` + `policy` + `proactive` (all four)

Use when available:

- `sessions`, `surfaces` (v1 baseline)
- `memory` (v1.1)
- `coordination`, `connectivity` (v1.2)

Keep in NightCTO:

- founder-facing service behavior
- specialist lineup choices
- business escalation and client-tier rules
- per-client memory (until `@agent-assistant/memory` ships in v1.1)

Starting example: `packages/examples/src/05-full-assembly.ts`
