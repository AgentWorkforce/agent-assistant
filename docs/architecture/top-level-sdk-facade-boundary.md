# Top-Level SDK Facade Boundary

Date: 2026-04-13

## Purpose

This document defines the boundary for a top-level `@agent-assistant/sdk` package — a thin facade that simplifies adoption for external consumers while preserving the internal modular package architecture.

---

## 1. Why `@agent-assistant/sdk` Should Exist

Today, building the simplest assistant requires three or more imports:

```ts
import { createAssistant } from '@agent-assistant/core';
import { createTraitsProvider } from '@agent-assistant/traits';
import { createSessionStore, InMemorySessionStoreAdapter } from '@agent-assistant/sessions';
import { createSurfaceRegistry } from '@agent-assistant/surfaces';
```

This is fine for power users but creates unnecessary friction for first-time adopters. Every additional `npm install` and import path is a decision point where a potential contributor can drop off.

A facade package solves this by offering:

- **One install**: `npm install @agent-assistant/sdk`
- **One import for the common case**: `import { createAssistant, createTraitsProvider } from '@agent-assistant/sdk'`
- **Zero loss of modularity**: advanced consumers still install individual packages directly

The facade is a re-export surface, not a new runtime. It adds no logic, no state, and no coupling beyond what the individual packages already expose.

---

## 2. What the Facade Re-Exports

The facade re-exports **factory functions, primary types, and essential error classes** from stable v1-baseline packages. It does not re-export every symbol — only the ones needed for the "first 30 minutes" experience.

### Tier 1: Core assembly (always re-exported)

From `@agent-assistant/core`:
- `createAssistant`
- `AssistantDefinitionError`, `OutboundEventError`
- Types: `AssistantDefinition`, `AssistantRuntime`, `InboundMessage`, `OutboundEvent`, `CapabilityHandler`, `CapabilityContext`, `RuntimeStatus`

From `@agent-assistant/traits`:
- `createTraitsProvider`
- `TraitsValidationError`
- Types: `AssistantTraits`, `SurfaceFormattingTraits`, `TraitsProvider`

### Tier 2: Session and surface wiring (always re-exported)

From `@agent-assistant/sessions`:
- `createSessionStore`, `resolveSession`, `defaultAffinityResolver`, `InMemorySessionStoreAdapter`
- `SessionConflictError`, `SessionNotFoundError`, `SessionStateError`
- Types: `Session`, `SessionStore`, `SessionStoreAdapter`, `SessionStoreConfig`, `SessionState`

From `@agent-assistant/surfaces`:
- `createSurfaceRegistry`
- `SurfaceConflictError`, `SurfaceNotFoundError`, `SurfaceDeliveryError`
- Types: `SurfaceConnection`, `SurfaceRegistry`, `SurfaceCapabilities`, `SurfaceAdapter`, `SurfaceFormatHook`, `SurfaceType`, `SurfaceState`

### Tier 3: Behavioral packages (always re-exported)

From `@agent-assistant/policy`:
- `createActionPolicy`, `defaultRiskClassifier`, `InMemoryAuditSink`
- `PolicyError`, `ClassificationError`
- Types: `Action`, `PolicyEngine`, `PolicyEngineConfig`, `PolicyRule`, `PolicyDecision`, `EvaluationResult`, `AuditSink`, `RiskLevel`

From `@agent-assistant/proactive`:
- `createProactiveEngine`, `InMemorySchedulerBinding`
- `ProactiveError`, `SchedulerBindingError`
- Types: `ProactiveEngine`, `ProactiveEngineConfig`, `FollowUpRule`, `WatchRule`, `SchedulerBinding`

### What is NOT re-exported through the facade

The following remain **direct-import only** from their respective packages:

| Package | Reason |
|---|---|
| `@agent-assistant/routing` | DoD gap (12/40+ tests). Not safe for general consumption. Advanced users who need it import directly. |
| `@agent-assistant/connectivity` | Internal coordination primitive. Consumers building multi-agent systems import directly. |
| `@agent-assistant/coordination` | Advanced multi-agent orchestration. Consumers building coordinator/specialist topologies import directly. |
| `@agent-assistant/memory` | Blocked on `@agent-relay/memory`. Will be added to the facade when publicly installable. |

Additionally, these symbol categories are never re-exported through the facade regardless of package:

- **Internal constants** (e.g., `ROUTING_MODES`, `SIGNAL_CLASSES`, `MESSAGE_CLASSES`) — implementation details, not assembly primitives
- **Narrow query/input types** (e.g., `SessionQuery`, `SignalQuery`, `MemoryQuery`) — only needed when using a package's advanced API surface
- **Niche error subclasses** (e.g., `RuleNotFoundError`, `SignalNotFoundError`) — consumers who need fine-grained catch blocks are already advanced users importing directly

---

## 3. Canonical Starter Import Path

### Hello world (one package)

```bash
npm install @agent-assistant/sdk
```

```ts
import { createAssistant, createTraitsProvider } from '@agent-assistant/sdk';

const traits = createTraitsProvider(
  { voice: 'concise', formality: 'professional', proactivity: 'medium', riskPosture: 'moderate', domain: 'engineering' },
  { preferMarkdown: true },
);

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
  { inbound, outbound },
);

await runtime.start();
```

### Full assembly (still one install)

```ts
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

### Advanced (direct package imports)

```ts
// Only when you need coordination, connectivity, or routing
import { createCoordinator, createSpecialistRegistry } from '@agent-assistant/coordination';
import { createConnectivityLayer } from '@agent-assistant/connectivity';
import { createRouter } from '@agent-assistant/routing';
```

---

## 4. Facade Package Structure

### `packages/sdk/package.json`

```json
{
  "name": "@agent-assistant/sdk",
  "version": "0.1.0",
  "description": "Top-level facade for the Agent Assistant SDK",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@agent-assistant/core": ">=0.1.0",
    "@agent-assistant/traits": ">=0.1.0",
    "@agent-assistant/sessions": ">=0.1.0",
    "@agent-assistant/surfaces": ">=0.1.0",
    "@agent-assistant/policy": ">=0.1.0",
    "@agent-assistant/proactive": ">=0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/AgentWorkforce/agent-assistant-sdk"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

### `packages/sdk/src/index.ts`

The facade is a pure re-export file. No logic, no wrappers, no convenience helpers.

```ts
// --- @agent-assistant/core ---
export { createAssistant, AssistantDefinitionError, OutboundEventError } from '@agent-assistant/core';
export type {
  AssistantDefinition, AssistantRuntime, InboundMessage, OutboundEvent,
  CapabilityHandler, CapabilityContext, RuntimeStatus,
} from '@agent-assistant/core';

// --- @agent-assistant/traits ---
export { createTraitsProvider, TraitsValidationError } from '@agent-assistant/traits';
export type { AssistantTraits, SurfaceFormattingTraits, TraitsProvider } from '@agent-assistant/traits';

// --- @agent-assistant/sessions ---
export {
  createSessionStore, resolveSession, defaultAffinityResolver,
  InMemorySessionStoreAdapter, SessionConflictError, SessionNotFoundError, SessionStateError,
} from '@agent-assistant/sessions';
export type {
  Session, SessionStore, SessionStoreAdapter, SessionStoreConfig, SessionState,
} from '@agent-assistant/sessions';

// --- @agent-assistant/surfaces ---
export {
  createSurfaceRegistry,
  SurfaceConflictError, SurfaceNotFoundError, SurfaceDeliveryError,
} from '@agent-assistant/surfaces';
export type {
  SurfaceConnection, SurfaceRegistry, SurfaceCapabilities,
  SurfaceAdapter, SurfaceFormatHook, SurfaceType, SurfaceState,
} from '@agent-assistant/surfaces';

// --- @agent-assistant/policy ---
export {
  createActionPolicy, defaultRiskClassifier, InMemoryAuditSink,
  PolicyError, ClassificationError,
} from '@agent-assistant/policy';
export type {
  Action, PolicyEngine, PolicyEngineConfig, PolicyRule,
  PolicyDecision, EvaluationResult, AuditSink, RiskLevel,
} from '@agent-assistant/policy';

// --- @agent-assistant/proactive ---
export {
  createProactiveEngine, InMemorySchedulerBinding,
  ProactiveError, SchedulerBindingError,
} from '@agent-assistant/proactive';
export type {
  ProactiveEngine, ProactiveEngineConfig,
  FollowUpRule, WatchRule, SchedulerBinding,
} from '@agent-assistant/proactive';
```

### Rules for maintaining the facade

1. **No logic.** The facade file is `export` statements only. If you need a helper, it belongs in a package.
2. **No conditional exports.** Every re-exported symbol is always available. Optional packages are omitted entirely, not conditionally loaded.
3. **Gate on stability.** A package is added to the facade only when it reaches v1-baseline status (passing tests, spec reconciled or implementation-ready, no blocking DoD gaps).
4. **One review per addition.** Adding a package to the facade requires a PR that updates this boundary doc, the facade source, and the README.

---

## 5. Impact on Docs, Examples, and Publish Strategy

### Documentation

- **README quick-start** changes from multi-package install to `npm install @agent-assistant/sdk`. The quick-start code block uses `@agent-assistant/sdk` as the sole import.
- **How to Build an Assistant** retains direct-package import examples as the "explained" form, but adds a note at the top showing the facade equivalent.
- **Package boundary map** adds `@agent-assistant/sdk` as a facade entry with no "owns" section — it owns nothing, it re-exports.
- **Advanced guides** (coordination, connectivity, routing) continue to show direct imports.

### Examples

- `packages/examples/src/01-*` through `05-*` are updated to import from `@agent-assistant/sdk` where possible. Direct imports are used only for symbols not in the facade.
- A new `packages/examples/src/00-hello-world.ts` demonstrates the absolute minimum: `createAssistant` + `createTraitsProvider` from `@agent-assistant/sdk`.

### Publish strategy

- The facade is published to npm as `@agent-assistant/sdk` with `"access": "public"`.
- All constituent packages continue to be published independently. The facade depends on them via version ranges (`>=0.1.0`), not `file:` paths.
- Publish order: constituent packages first, then facade. The facade never pins exact versions — it uses `>=` ranges so consumers can override individual package versions when needed.
- The facade version tracks the SDK's logical release (e.g., `0.1.0` for initial open-source launch) and is bumped when the re-export surface changes.

---

## 6. Python Parity Path

The facade boundary directly enables a future `agent-assistant` Python package with the same philosophy:

### Structural mapping

| TypeScript | Python |
|---|---|
| `@agent-assistant/sdk` | `agent_assistant` (top-level package on PyPI) |
| `@agent-assistant/core` | `agent_assistant.core` |
| `@agent-assistant/traits` | `agent_assistant.traits` |
| `@agent-assistant/sessions` | `agent_assistant.sessions` |
| `@agent-assistant/surfaces` | `agent_assistant.surfaces` |
| `@agent-assistant/policy` | `agent_assistant.policy` |
| `@agent-assistant/proactive` | `agent_assistant.proactive` |

### Import equivalence

```python
# Python hello world — mirrors TypeScript facade
from agent_assistant import create_assistant, create_traits_provider

# Advanced direct import — mirrors TypeScript direct packages
from agent_assistant.coordination import create_coordinator
```

### Design constraints for parity

1. **Factory function names translate directly.** `createAssistant` becomes `create_assistant`. No creative renaming.
2. **The facade re-export list is the Python `__init__.py` export list.** The TypeScript boundary doc governs both languages.
3. **Types become dataclasses/TypedDicts.** The facade types list defines which types get first-class Python equivalents vs. which remain internal.
4. **Advanced packages follow the same inclusion rule.** Routing, connectivity, and coordination are submodule imports in Python too — not in the top-level `__init__.py`.

This means every decision about what enters the TypeScript facade is simultaneously a decision about the Python public API. The bar for facade inclusion applies to both.

---

## Decision Log

| Decision | Rationale |
|---|---|
| Facade is re-exports only, no logic | Prevents the facade from becoming a maintenance bottleneck or diverging from constituent packages |
| Six packages in facade, four excluded | Balances adoption simplicity against shipping unstable or blocked packages |
| `routing` excluded despite being implemented | 12/40+ test target is a DoD failure; including it signals false readiness |
| `connectivity` and `coordination` excluded | These are advanced multi-agent primitives; including them bloats the starter surface without helping the common case |
| `memory` excluded | Blocked on external dependency; will enter facade when publicly installable |
| `>=` version ranges, not exact pins | Lets advanced consumers override individual package versions without fighting the facade |
| Python parity as a design constraint | Prevents TypeScript-only conveniences that cannot translate, keeping the API surface portable |

---

TOP_LEVEL_SDK_FACADE_BOUNDARY_READY
