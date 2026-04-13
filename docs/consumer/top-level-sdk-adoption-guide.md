# Top-Level SDK Adoption Guide

Date: 2026-04-13
Audience: External consumers — product teams and open-source adopters building assistants with `@agent-assistant/sdk`

---

## What `@agent-assistant/sdk` Is

`@agent-assistant/sdk` is a single-package entry point to the Agent Assistant SDK. It re-exports the stable v1-baseline API from six constituent packages:

- `@agent-assistant/core` — assistant lifecycle and dispatch
- `@agent-assistant/traits` — identity, voice, and formatting traits
- `@agent-assistant/sessions` — cross-surface session continuity
- `@agent-assistant/surfaces` — surface connection registry and dispatch
- `@agent-assistant/policy` — action classification, gating, and audit
- `@agent-assistant/proactive` — follow-up engines and watch rules

Installing `@agent-assistant/sdk` is equivalent to installing all six packages. No behavior changes, no abstraction layer — the facade is a pure re-export surface.

---

## Installation

```bash
npm install @agent-assistant/sdk
```

That is the only install command needed for the common case. The six constituent packages are installed as transitive dependencies.

---

## Hello World

The minimum viable assistant requires one install and one import:

```typescript
import {
  createAssistant,
  createTraitsProvider,
  createSessionStore,
  InMemorySessionStoreAdapter,
  createSurfaceRegistry,
} from '@agent-assistant/sdk';
import type {
  InboundMessage,
  CapabilityContext,
  SurfaceConnection,
  SurfaceCapabilities,
} from '@agent-assistant/sdk';

// 1. Define traits — voice, style, and formatting preferences
const traits = createTraitsProvider(
  {
    voice: 'concise',
    formality: 'professional',
    proactivity: 'medium',
    riskPosture: 'moderate',
    domain: 'engineering',
  },
  { preferMarkdown: true },
);

// 2. Create a session store
const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

// 3. Create a surface registry and register a connection
const surfaceRegistry = createSurfaceRegistry();

const capabilities: SurfaceCapabilities = {
  markdown: true,
  richBlocks: false,
  attachments: false,
  streaming: false,
  maxResponseLength: 2000,
};

const connection: SurfaceConnection = {
  id: 'my-surface',
  type: 'slack',     // 'slack' | 'web' | 'api' | custom string
  state: 'registered',
  capabilities,
  adapter: mySlackAdapter, // provided by your relay/transport layer
};

surfaceRegistry.register(connection);

// 4. Create and start the runtime
const runtime = createAssistant(
  {
    id: 'my-assistant',
    name: 'My Assistant',
    traits,
    capabilities: {
      reply: async (message: InboundMessage, context: CapabilityContext) => {
        await context.runtime.emit({
          surfaceId: message.surfaceId,
          text: `Hello from ${context.runtime.definition.name}`,
        });
      },
    },
  },
  { inbound: surfaceRegistry, outbound: surfaceRegistry },
);

runtime.register('sessions', sessionStore);
await runtime.start();
```

---

## Full Assembly

All six v1-baseline packages can be imported from the same single source:

```typescript
import {
  // Core
  createAssistant,
  AssistantDefinitionError,
  OutboundEventError,

  // Traits
  createTraitsProvider,
  TraitsValidationError,

  // Sessions
  createSessionStore,
  resolveSession,
  defaultAffinityResolver,
  InMemorySessionStoreAdapter,
  SessionConflictError,
  SessionNotFoundError,
  SessionStateError,

  // Surfaces
  createSurfaceRegistry,
  SurfaceConflictError,
  SurfaceNotFoundError,
  SurfaceDeliveryError,

  // Policy
  createActionPolicy,
  defaultRiskClassifier,
  InMemoryAuditSink,
  PolicyError,
  ClassificationError,

  // Proactive
  createProactiveEngine,
  InMemorySchedulerBinding,
  ProactiveError,
  SchedulerBindingError,
} from '@agent-assistant/sdk';

import type {
  // Core types
  AssistantDefinition,
  AssistantRuntime,
  InboundMessage,
  OutboundEvent,
  CapabilityHandler,
  CapabilityContext,
  RuntimeStatus,

  // Traits types
  AssistantTraits,
  SurfaceFormattingTraits,
  TraitsProvider,

  // Sessions types
  Session,
  SessionStore,
  SessionStoreAdapter,
  SessionStoreConfig,
  SessionState,

  // Surfaces types
  SurfaceConnection,
  SurfaceRegistry,
  SurfaceCapabilities,
  SurfaceAdapter,
  SurfaceFormatHook,
  SurfaceType,
  SurfaceState,

  // Policy types
  Action,
  PolicyEngine,
  PolicyEngineConfig,
  PolicyRule,
  PolicyDecision,
  EvaluationResult,
  AuditSink,
  RiskLevel,

  // Proactive types
  ProactiveEngine,
  ProactiveEngineConfig,
  FollowUpRule,
  WatchRule,
  SchedulerBinding,
} from '@agent-assistant/sdk';
```

---

## Full Assembly Example

```typescript
import {
  createAssistant,
  createTraitsProvider,
  createSessionStore,
  InMemorySessionStoreAdapter,
  resolveSession,
  defaultAffinityResolver,
  createSurfaceRegistry,
  createActionPolicy,
  InMemoryAuditSink,
  createProactiveEngine,
  InMemorySchedulerBinding,
} from '@agent-assistant/sdk';
import type {
  InboundMessage,
  CapabilityContext,
  Action,
  SessionStore,
} from '@agent-assistant/sdk';

// Traits
const traits = createTraitsProvider(
  { voice: 'concise', formality: 'professional', proactivity: 'medium', riskPosture: 'moderate', domain: 'engineering' },
  { preferMarkdown: true, preferredResponseLength: 600 },
);

// Session store
const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

// Surface registry
const surfaceRegistry = createSurfaceRegistry();
// ... register surface connections ...

// Policy engine
const auditSink = new InMemoryAuditSink();
const policyEngine = createActionPolicy({ auditSink, fallbackDecision: 'allow' });

// Proactive engine
const proactiveEngine = createProactiveEngine({
  schedulerBinding: new InMemorySchedulerBinding(),
});

// Runtime
const runtime = createAssistant(
  {
    id: 'my-assistant',
    name: 'My Assistant',
    traits,
    capabilities: {
      reply: async (message: InboundMessage, context: CapabilityContext) => {
        // Resolve or create session
        const store = context.runtime.get<SessionStore>('sessions');
        const session = await resolveSession(
          message,
          store,
          defaultAffinityResolver(store),
        );
        await store.touch(session.id);
        await store.attachSurface(session.id, message.surfaceId);

        // Gate through policy
        const action: Action = {
          id: `action-${message.id}`,
          type: 'assistant_reply',
          description: `Reply to: ${message.text}`,
          sessionId: session.id,
          userId: message.userId,
          proactive: false,
        };
        const { decision } = await policyEngine.evaluate(action);

        if (decision.action !== 'allow') {
          await context.runtime.emit({
            surfaceId: message.surfaceId,
            text: 'Request blocked by policy.',
          });
          return;
        }

        // Send reply
        await context.runtime.emit({
          surfaceId: message.surfaceId,
          sessionId: session.id,
          text: `Acknowledged: ${message.text}`,
        });
      },
    },
  },
  { inbound: surfaceRegistry, outbound: surfaceRegistry },
);

runtime.register('sessions', sessionStore);
runtime.register('policy', policyEngine);
runtime.register('proactive', proactiveEngine);
await runtime.start();
```

---

## What Is Not in the Facade

The following packages are not re-exported from `@agent-assistant/sdk`. Install them separately when you need them.

### Advanced multi-agent packages

These require specialized assembly knowledge and are intentionally outside the one-install path:

```bash
npm install @agent-assistant/coordination
npm install @agent-assistant/connectivity
```

```typescript
// Only when building coordinator/specialist topologies
import { createCoordinator, createSpecialistRegistry } from '@agent-assistant/coordination';

// Only when building efficient inter-agent signaling
import { createConnectivityLayer } from '@agent-assistant/connectivity';
```

### Routing (DoD gap — not ready for products)

```bash
npm install @agent-assistant/routing
```

```typescript
import { createRouter } from '@agent-assistant/routing';
```

`@agent-assistant/routing` has a known test-count gap (12 tests vs. 40+ target). Do not wire it into production assistants until the DoD is resolved. It is excluded from the facade precisely because it is not yet safe for general consumption.

### Memory (blocked — not yet installable)

`@agent-assistant/memory` depends on `@agent-relay/memory` (relay foundation infrastructure) which is not yet publicly available. It cannot be installed until that dependency is published. It will be added to the facade when the blocker is resolved.

---

## Migrating From Direct Package Imports

If you are already importing from individual packages, migration is a mechanical find-and-replace. No runtime behavior changes.

**Before:**
```typescript
import { createAssistant } from '@agent-assistant/core';
import { createTraitsProvider } from '@agent-assistant/traits';
import { createSessionStore, InMemorySessionStoreAdapter } from '@agent-assistant/sessions';
import { createSurfaceRegistry } from '@agent-assistant/surfaces';
import { createActionPolicy, InMemoryAuditSink } from '@agent-assistant/policy';
import { createProactiveEngine, InMemorySchedulerBinding } from '@agent-assistant/proactive';
```

**After:**
```typescript
import {
  createAssistant,
  createTraitsProvider,
  createSessionStore,
  InMemorySessionStoreAdapter,
  createSurfaceRegistry,
  createActionPolicy,
  InMemoryAuditSink,
  createProactiveEngine,
  InMemorySchedulerBinding,
} from '@agent-assistant/sdk';
```

You can also remove the six individual package entries from your `package.json` dependencies and replace them with the single `@agent-assistant/sdk` entry.

### Symbols not in the facade

Some symbols from constituent packages are intentionally excluded from the facade. If your import breaks during migration, the symbol is either:

1. An internal type (narrow query/input types, internal constants, niche error subclasses)
2. From an advanced package outside the facade (coordination, connectivity, routing, memory)

For case 1, continue importing from the constituent package directly — this is by design. The facade covers the "first 30 minutes" surface, not every exported symbol.

For case 2, add the specific package to your dependencies and import from it directly.

---

## Choosing Between Facade and Direct Imports

| Situation | Recommendation |
|---|---|
| New project, evaluating the SDK | `@agent-assistant/sdk` — one install, less friction |
| Production assistant using core + traits + sessions + surfaces + policy + proactive | `@agent-assistant/sdk` — cleaner deps |
| Need `@agent-assistant/coordination` or `@agent-assistant/connectivity` | Install those directly; use facade for everything else |
| Need narrow query types or internal error subclasses | Import from the specific constituent package |
| Building transport infrastructure | Import from `@agent-assistant/core` directly; the facade is not the right entry point |
| Working in a monorepo alongside constituent packages | You can use either — `file:` paths work alongside the facade |

---

## TypeScript Configuration

The SDK requires TypeScript 5.x with module resolution set to `NodeNext` or `Bundler`:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "verbatimModuleSyntax": true
  }
}
```

`verbatimModuleSyntax: true` is required to preserve `export type` boundaries across the package boundary. Without it, you may encounter subtle type stripping issues with type-only exports.

---

## Error Handling Reference

All errors from the facade are standard JavaScript classes extending `Error`. No new error types are introduced by the facade.

| Error class | Source package | When thrown |
|---|---|---|
| `AssistantDefinitionError` | core | Invalid `AssistantDefinition` at construction time |
| `OutboundEventError` | core | `emit()` called with neither `surfaceId` nor `sessionId` |
| `TraitsValidationError` | traits | Trait values outside allowed enum set |
| `SessionConflictError` | sessions | Session ID collision on create |
| `SessionNotFoundError` | sessions | Operation on non-existent session |
| `SessionStateError` | sessions | Invalid state transition |
| `SurfaceConflictError` | surfaces | Duplicate surface ID on register |
| `SurfaceNotFoundError` | surfaces | Emit targeting an unregistered surface |
| `SurfaceDeliveryError` | surfaces | Adapter delivery failure |
| `PolicyError` | policy | Policy engine misconfiguration |
| `ClassificationError` | policy | Risk classification failure |
| `ProactiveError` | proactive | Proactive engine misconfiguration |
| `SchedulerBindingError` | proactive | Scheduler binding operation failure |

---

## Publish Lifecycle

### How the facade is versioned

- `@agent-assistant/sdk` version tracks the SDK's logical release (`0.1.0` for initial launch)
- The facade version is bumped when its re-export surface changes, not when constituent packages release patches
- Constituent packages continue to release independently with their own versions

### Dependency ranges

The facade declares all constituent packages with `>=0.1.0` ranges. This means:
- You can `npm install @agent-assistant/core@0.2.0` alongside `@agent-assistant/sdk@0.1.0` if you need a specific version
- The range allows patch and minor upgrades without requiring a facade version bump
- Pinning is your responsibility if you need exact constituent versions

### Publish order

When releasing new versions:
1. Constituent packages are published first
2. Facade is published after all constituent packages are available at the declared version range
3. The facade is never published before its dependencies are available on npm

---

## Getting Help

- Reference examples: `packages/examples/src/`
- Architecture overview: `docs/architecture/package-boundary-map.md`
- Per-package specs: `docs/specs/`
- How to build a full assistant: `docs/consumer/how-to-build-an-assistant.md`
- Current test results and blockers: `docs/current-state.md`

---

TOP_LEVEL_SDK_ADOPTION_GUIDE_READY
