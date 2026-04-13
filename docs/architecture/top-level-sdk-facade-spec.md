# Top-Level SDK Facade Specification

Date: 2026-04-13
Status: SPEC_READY
Authoritative source: `docs/architecture/top-level-sdk-facade-boundary.md`

---

## 1. Purpose

This document is the canonical specification for `@agent-assistant/sdk` — a thin facade package that re-exports the stable v1-baseline API surface across the six core packages. It is derived from the facade boundary document and serves as the binding spec that the implementation must match exactly.

The facade exists for one reason: reduce the number of installs and import paths required to build a working assistant from three or more to one. It adds no logic, no state, and no runtime coupling beyond what the individual packages already implement.

---

## 2. Package Identity

```
name:     @agent-assistant/sdk
version:  0.1.0
license:  MIT
access:   public
```

The version tracks the SDK's logical release (`0.1.0` for initial open-source launch). It is bumped when the re-export surface changes, not when constituent packages release patches.

---

## 3. Exact Public Surface

The following is the complete, authoritative list of symbols re-exported by `@agent-assistant/sdk`. No symbol outside this list may be added to `src/index.ts` without a boundary doc update and PR review.

### 3.1 From `@agent-assistant/core`

**Concrete exports (functions, classes, errors):**

| Symbol | Kind |
|---|---|
| `createAssistant` | factory function |
| `AssistantDefinitionError` | error class |
| `OutboundEventError` | error class |

**Type-only exports:**

| Symbol | Kind |
|---|---|
| `AssistantDefinition` | interface |
| `AssistantRuntime` | interface |
| `InboundMessage` | interface |
| `OutboundEvent` | interface |
| `CapabilityHandler` | type alias |
| `CapabilityContext` | interface |
| `RuntimeStatus` | type alias |

**Not re-exported from `@agent-assistant/core`:**
- `AssistantHooks` — internal lifecycle hook interface
- `ContextLogger` — internal logging contract
- `RelayInboundAdapter` — foundation transport interface; advanced users import directly
- `RelayOutboundAdapter` — foundation transport interface; advanced users import directly
- `RuntimeConstraints` — internal execution constraint type

### 3.2 From `@agent-assistant/traits`

**Concrete exports:**

| Symbol | Kind |
|---|---|
| `createTraitsProvider` | factory function |
| `TraitsValidationError` | error class |

**Type-only exports:**

| Symbol | Kind |
|---|---|
| `AssistantTraits` | interface |
| `SurfaceFormattingTraits` | interface |
| `TraitsProvider` | interface |

### 3.3 From `@agent-assistant/sessions`

**Concrete exports:**

| Symbol | Kind |
|---|---|
| `createSessionStore` | factory function |
| `resolveSession` | utility function |
| `defaultAffinityResolver` | utility function |
| `InMemorySessionStoreAdapter` | class |
| `SessionConflictError` | error class |
| `SessionNotFoundError` | error class |
| `SessionStateError` | error class |

**Type-only exports:**

| Symbol | Kind |
|---|---|
| `Session` | interface |
| `SessionStore` | interface |
| `SessionStoreAdapter` | interface |
| `SessionStoreConfig` | interface |
| `SessionState` | type alias |

**Not re-exported from `@agent-assistant/sessions`:**
- `AffinityResolver` — advanced API; direct import only
- `CreateSessionInput` — narrow input type; direct import only
- `SessionQuery` — narrow query type; direct import only
- `SessionResolvableMessage` — narrow input type; direct import only

### 3.4 From `@agent-assistant/surfaces`

**Concrete exports:**

| Symbol | Kind |
|---|---|
| `createSurfaceRegistry` | factory function |
| `SurfaceConflictError` | error class |
| `SurfaceNotFoundError` | error class |
| `SurfaceDeliveryError` | error class |

**Type-only exports:**

| Symbol | Kind |
|---|---|
| `SurfaceConnection` | interface |
| `SurfaceRegistry` | interface |
| `SurfaceCapabilities` | interface |
| `SurfaceAdapter` | interface |
| `SurfaceFormatHook` | type alias |
| `SurfaceType` | type alias |
| `SurfaceState` | type alias |

**Not re-exported from `@agent-assistant/surfaces`:**
- `FanoutOutcome`, `FanoutPolicy`, `FanoutResult` — internal fanout mechanics
- `NormalizedInboundMessage` — foundation-adjacent input type
- `SurfaceOutboundEvent`, `SurfacePayload` — internal delivery types
- `SurfaceRegistryConfig` — advanced configuration; direct import only

### 3.5 From `@agent-assistant/policy`

**Concrete exports:**

| Symbol | Kind |
|---|---|
| `createActionPolicy` | factory function |
| `defaultRiskClassifier` | utility function |
| `InMemoryAuditSink` | class |
| `PolicyError` | error class |
| `ClassificationError` | error class |

**Type-only exports:**

| Symbol | Kind |
|---|---|
| `Action` | interface |
| `PolicyEngine` | interface |
| `PolicyEngineConfig` | interface |
| `PolicyRule` | interface |
| `PolicyDecision` | interface |
| `EvaluationResult` | interface |
| `AuditSink` | interface |
| `RiskLevel` | type alias |

**Not re-exported from `@agent-assistant/policy`:**
- `RuleNotFoundError` — niche error subclass; consumers who need fine-grained catch blocks import directly
- `RiskClassifier` — advanced interface; direct import only
- `PolicyEvaluationContext` — internal evaluation type
- `ApprovalHint`, `ApprovalResolution` — advanced approval flow types
- `AuditEvent` — internal audit record type

### 3.6 From `@agent-assistant/proactive`

**Concrete exports:**

| Symbol | Kind |
|---|---|
| `createProactiveEngine` | factory function |
| `InMemorySchedulerBinding` | class |
| `ProactiveError` | error class |
| `SchedulerBindingError` | error class |

**Type-only exports:**

| Symbol | Kind |
|---|---|
| `ProactiveEngine` | interface |
| `ProactiveEngineConfig` | interface |
| `FollowUpRule` | interface |
| `WatchRule` | interface |
| `SchedulerBinding` | interface |

**Not re-exported from `@agent-assistant/proactive`:**
- `RuleNotFoundError` — niche error subclass; direct import only
- `RoutingHint`, `SuppressionReason` — internal decision types
- `FollowUpAction`, `WatchAction` — internal rule action types
- `ReminderPolicy` — advanced rule configuration
- `EvidenceEntry`, `FollowUpEvidenceSource` — internal evidence types
- `FollowUpEvaluationContext`, `WatchEvaluationContext`, `WakeUpContext` — internal evaluation types
- `FollowUpDecision`, `WatchTrigger`, `WatchRuleStatus`, `WatchRuleLifecycleStatus` — internal state types

---

## 4. Packages Explicitly Outside the Facade

The following packages are never re-exported through `@agent-assistant/sdk` in v1:

| Package | Reason | Consumer path |
|---|---|---|
| `@agent-assistant/routing` | DoD gap (12/40+ tests). Not safe for general consumption. | `import ... from '@agent-assistant/routing'` |
| `@agent-assistant/connectivity` | Internal coordination primitive. | `import ... from '@agent-assistant/connectivity'` |
| `@agent-assistant/coordination` | Advanced multi-agent orchestration. | `import ... from '@agent-assistant/coordination'` |
| `@agent-assistant/memory` | Blocked on `@agent-relay/memory` (not publicly available). | Will be added to facade when unblocked. |

These packages are excluded from the facade's `dependencies` in `package.json`. Consumers who need them install them directly.

---

## 5. Canonical `src/index.ts`

The following is the exact intended content of `packages/sdk/src/index.ts`. This file is pure re-export — zero logic, zero wrappers.

```typescript
// =============================================================================
// @agent-assistant/sdk — Top-Level Facade
// Re-exports the stable v1-baseline API surface across core SDK packages.
// No logic lives here. See individual packages for implementation details.
// =============================================================================

// --- @agent-assistant/core ---
export { createAssistant, AssistantDefinitionError, OutboundEventError } from '@agent-assistant/core';
export type {
  AssistantDefinition,
  AssistantRuntime,
  InboundMessage,
  OutboundEvent,
  CapabilityHandler,
  CapabilityContext,
  RuntimeStatus,
} from '@agent-assistant/core';

// --- @agent-assistant/traits ---
export { createTraitsProvider, TraitsValidationError } from '@agent-assistant/traits';
export type {
  AssistantTraits,
  SurfaceFormattingTraits,
  TraitsProvider,
} from '@agent-assistant/traits';

// --- @agent-assistant/sessions ---
export {
  createSessionStore,
  resolveSession,
  defaultAffinityResolver,
  InMemorySessionStoreAdapter,
  SessionConflictError,
  SessionNotFoundError,
  SessionStateError,
} from '@agent-assistant/sessions';
export type {
  Session,
  SessionStore,
  SessionStoreAdapter,
  SessionStoreConfig,
  SessionState,
} from '@agent-assistant/sessions';

// --- @agent-assistant/surfaces ---
export {
  createSurfaceRegistry,
  SurfaceConflictError,
  SurfaceNotFoundError,
  SurfaceDeliveryError,
} from '@agent-assistant/surfaces';
export type {
  SurfaceConnection,
  SurfaceRegistry,
  SurfaceCapabilities,
  SurfaceAdapter,
  SurfaceFormatHook,
  SurfaceType,
  SurfaceState,
} from '@agent-assistant/surfaces';

// --- @agent-assistant/policy ---
export {
  createActionPolicy,
  defaultRiskClassifier,
  InMemoryAuditSink,
  PolicyError,
  ClassificationError,
} from '@agent-assistant/policy';
export type {
  Action,
  PolicyEngine,
  PolicyEngineConfig,
  PolicyRule,
  PolicyDecision,
  EvaluationResult,
  AuditSink,
  RiskLevel,
} from '@agent-assistant/policy';

// --- @agent-assistant/proactive ---
export {
  createProactiveEngine,
  InMemorySchedulerBinding,
  ProactiveError,
  SchedulerBindingError,
} from '@agent-assistant/proactive';
export type {
  ProactiveEngine,
  ProactiveEngineConfig,
  FollowUpRule,
  WatchRule,
  SchedulerBinding,
} from '@agent-assistant/proactive';
```

---

## 6. Canonical `package.json`

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

### Dependency version strategy

All constituent package dependencies use `>=0.1.0` ranges (not `file:` paths, not exact pins). This lets consumers override individual package versions when needed while guaranteeing a known-compatible baseline at initial install.

---

## 7. Canonical `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

`verbatimModuleSyntax: true` ensures `export type` is preserved in emitted declarations, which is required for type-only re-exports across package boundaries.

---

## 8. Facade Invariants

These rules govern all future maintenance of `packages/sdk/src/index.ts`:

1. **No logic.** The facade file is `export` statements only. Any helper, wrapper, or convenience function belongs in a constituent package.

2. **No conditional exports.** Every re-exported symbol is always available at all times. Optional or advanced packages are omitted entirely, not conditionally loaded.

3. **Gate on stability.** A package is added to the facade only when it reaches v1-baseline status: passing tests at or above the DoD target, spec reconciled or implementation-ready, no blocking DoD gaps.

4. **One review per addition.** Adding a package to the facade requires a PR that updates the boundary doc, the facade `src/index.ts`, and the README quick-start simultaneously.

5. **Symbol count is a governance signal.** If this file grows to include narrow query types, internal constants, or niche error subclasses, that is a sign that the inclusion criteria have drifted. Revert to this spec.

---

## 9. How This Spec Relates to the Boundary Document

The boundary document (`docs/architecture/top-level-sdk-facade-boundary.md`) is the authoritative design artifact. This spec translates the boundary into exact symbol-level precision by:

- Enumerating what is excluded from each package (not only what is included)
- Specifying exact `tsconfig.json` settings
- Codifying the facade invariants as rules rather than prose guidance
- Capturing the precise difference between what each package exports and what the facade surfaces

When the boundary document and this spec conflict, the boundary document governs. Update this spec to match.

---

TOP_LEVEL_SDK_FACADE_SPEC_READY
