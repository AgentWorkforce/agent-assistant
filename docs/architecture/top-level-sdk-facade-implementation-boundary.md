# Top-Level SDK Facade — Implementation Boundary

Date: 2026-04-13
Status: TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_BOUNDARY_READY
Spec: `docs/architecture/top-level-sdk-facade-spec.md`
Boundary: `docs/architecture/top-level-sdk-facade-boundary.md`
Plan: `docs/architecture/top-level-sdk-facade-implementation-plan.md`

---

## 1. What `packages/sdk` Will Contain

The new `packages/sdk/` directory is a **pure re-export facade** with exactly three files:

```
packages/sdk/
  package.json          # package identity, dependencies on 6 constituent packages
  tsconfig.json         # TypeScript config with verbatimModuleSyntax: true
  src/
    index.ts            # re-export statements only — zero logic
```

### Invariants

- **No runtime code.** `src/index.ts` contains only `export` and `export type` statements. No function bodies, no classes, no variable declarations, no default exports, no star re-exports.
- **No tests.** The facade has zero logic to test. Correctness is proven by `tsc --noEmit` passing.
- **No configuration files** beyond `package.json` and `tsconfig.json`. No `.eslintrc`, no `vitest.config`, no `README.md`.

### `package.json` constraints

| Field | Value | Rationale |
|---|---|---|
| `name` | `@agent-assistant/sdk` | Single top-level entry point |
| `version` | `0.1.0` | Tracks SDK logical release, not constituent patch versions |
| `type` | `module` | ESM interop with all constituent packages |
| `dependencies` | 6 constituent packages with `>=0.1.0` | No `file:` paths — production consumers install from npm |
| `files` | `["dist"]` | Only compiled output is published |
| `license` | `MIT` | Matches constituent packages |

### `tsconfig.json` constraints

- Must set `verbatimModuleSyntax: true` to prevent TypeScript from stripping `export type` in ways that break downstream strict-mode consumers.
- Must use `NodeNext` module resolution to match constituent packages.
- Output to `dist/` directory.

---

## 2. What the Facade Re-Exports Now vs Later

### Re-exported in v1 (this implementation pass)

The facade re-exports **41 symbols** from 6 stable packages. The exact list is authoritative in `docs/architecture/top-level-sdk-facade-spec.md` Section 3. Summary:

| Source Package | Concrete Exports | Type-Only Exports |
|---|---|---|
| `@agent-assistant/core` | 3 (`createAssistant`, `AssistantDefinitionError`, `OutboundEventError`) | 7 (`AssistantDefinition`, `AssistantRuntime`, `InboundMessage`, `OutboundEvent`, `CapabilityHandler`, `CapabilityContext`, `RuntimeStatus`) |
| `@agent-assistant/traits` | 2 (`createTraitsProvider`, `TraitsValidationError`) | 3 (`AssistantTraits`, `SurfaceFormattingTraits`, `TraitsProvider`) |
| `@agent-assistant/sessions` | 7 (`createSessionStore`, `resolveSession`, `defaultAffinityResolver`, `InMemorySessionStoreAdapter`, `SessionConflictError`, `SessionNotFoundError`, `SessionStateError`) | 5 (`Session`, `SessionStore`, `SessionStoreAdapter`, `SessionStoreConfig`, `SessionState`) |
| `@agent-assistant/surfaces` | 4 (`createSurfaceRegistry`, `SurfaceConflictError`, `SurfaceNotFoundError`, `SurfaceDeliveryError`) | 7 (`SurfaceConnection`, `SurfaceRegistry`, `SurfaceCapabilities`, `SurfaceAdapter`, `SurfaceFormatHook`, `SurfaceType`, `SurfaceState`) |
| `@agent-assistant/policy` | 5 (`createActionPolicy`, `defaultRiskClassifier`, `InMemoryAuditSink`, `PolicyError`, `ClassificationError`) | 8 (`Action`, `PolicyEngine`, `PolicyEngineConfig`, `PolicyRule`, `PolicyDecision`, `EvaluationResult`, `AuditSink`, `RiskLevel`) |
| `@agent-assistant/proactive` | 4 (`createProactiveEngine`, `InMemorySchedulerBinding`, `ProactiveError`, `SchedulerBindingError`) | 5 (`ProactiveEngine`, `ProactiveEngineConfig`, `FollowUpRule`, `WatchRule`, `SchedulerBinding`) |

**Verification status:** All 41 symbols confirmed present in their respective `src/index.ts` files as of 2026-04-13.

### Explicitly excluded from v1 facade

These packages are **not** re-exported and are **not** listed in `packages/sdk/package.json` dependencies:

| Package | Reason | When it may be added |
|---|---|---|
| `@agent-assistant/routing` | DoD gap — 12 of 40+ tests passing. Not safe for general consumption. | When test coverage reaches DoD threshold and API stabilizes. |
| `@agent-assistant/connectivity` | Internal coordination primitive. Not needed for single-assistant use cases. | When multi-agent patterns are documented for external consumers. |
| `@agent-assistant/coordination` | Advanced multi-agent orchestration. Consumers building coordinator/specialist topologies import directly. | Same as connectivity — when multi-agent is a documented external path. |
| `@agent-assistant/memory` | Blocked on `@agent-relay/memory` which is not publicly installable. | When `@agent-relay/memory` is published to npm. |

### Categories of symbols never re-exported (regardless of package)

- **Internal constants** (`ROUTING_MODES`, `SIGNAL_CLASSES`, `MESSAGE_CLASSES`) — implementation details
- **Narrow query/input types** (`SessionQuery`, `SignalQuery`, `MemoryQuery`) — advanced API surface only
- **Niche error subclasses** (`RuleNotFoundError`, `SignalNotFoundError`) — fine-grained catch blocks are an advanced pattern
- **Internal lifecycle/transport interfaces** (`AssistantHooks`, `ContextLogger`, `RelayInboundAdapter`, `RelayOutboundAdapter`) — foundation-level concerns

### Rules for future additions

1. A new symbol enters the facade only via a boundary doc update + PR review.
2. A new package enters the facade only when it meets the Definition of Done (test coverage, stable API) and is publicly installable.
3. No convenience helpers, wrappers, or "smart" re-exports. The facade is always a pure pass-through.

---

## 3. Tests and Build Proof Required

The facade has no unit tests — it has no logic. Instead, the following build-time proofs are required before the facade is considered complete:

### 3.1 TypeScript compilation must pass

```bash
cd packages/sdk && npx tsc --noEmit
```

**Pass criteria:** Zero errors, zero warnings. This proves:
- Every re-exported symbol exists in the source package
- Every `export type` is correctly categorized (not mixing runtime and type-only exports)
- `verbatimModuleSyntax` is properly configured

### 3.2 Export count must match spec

```bash
grep -c '^export' packages/sdk/src/index.ts
```

**Pass criteria:** The count equals the number of `export` and `export type` statements in the spec (Section 5 of `top-level-sdk-facade-spec.md`). Expected: **12 export lines** (6 concrete blocks + 6 type-only blocks).

### 3.3 No logic in facade

```bash
grep -E '(function |class |const |let |var |if |for |while |switch |=>)' packages/sdk/src/index.ts
```

**Pass criteria:** Zero matches. The facade must contain only `export` statements and comments.

### 3.4 Workspace resolution works

```bash
npm install && npm run build -w packages/sdk
```

**Pass criteria:** Install resolves all 6 workspace dependencies. Build produces `packages/sdk/dist/index.js` and `packages/sdk/dist/index.d.ts`.

### 3.5 Examples typecheck with facade imports

After updating `packages/examples/` to use `@agent-assistant/sdk`:

```bash
cd packages/examples && npx tsc --noEmit
```

**Pass criteria:** Zero errors. This proves the facade surface is sufficient for the documented hello-world and full-assembly patterns.

---

## 4. Docs and Examples Updated in the Same Pass

The following changes must ship in the same commit/PR as the facade package to avoid a window where docs reference a package that doesn't exist (or vice versa):

### 4.1 `packages/examples/package.json`

Replace individual package `devDependencies` with a single `@agent-assistant/sdk` dependency:

```json
"devDependencies": {
  "@agent-assistant/sdk": "file:../sdk",
  "typescript": "^5.9.3"
}
```

### 4.2 `packages/examples/src/00-hello-world.ts`

New file demonstrating the minimum viable assistant using only `@agent-assistant/sdk`. Must compile with `tsc --noEmit`. Content as specified in the implementation plan (Area 3.2).

### 4.3 Existing examples in `packages/examples/src/`

Update import paths from individual packages to `@agent-assistant/sdk` for all symbols covered by the facade. Symbols from excluded packages (`routing`, `connectivity`, `coordination`, `memory`) remain as direct imports.

### 4.4 Root `package.json`

- Add `"packages/sdk"` to the `workspaces` array, positioned before `"packages/examples"`.
- Add `"build:sdk": "npm run build -w packages/sdk"` to `scripts`.

### 4.5 `README.md` quick-start

Update the quick-start section to show:
- `npm install @agent-assistant/sdk` (single install)
- Imports from `@agent-assistant/sdk` (single source)

### 4.6 `docs/consumer/top-level-sdk-adoption-guide.md`

Must be present and accurate before the facade ships. Content as specified in the adoption guide appendix of the planning docs.

---

## 5. What Remains Intentionally Deferred

The following items are explicitly **out of scope** for the facade implementation pass:

| Item | Reason | Owner / Trigger |
|---|---|---|
| `@agent-assistant/routing` in facade | DoD gap — tests incomplete | Add when routing reaches test coverage threshold |
| `@agent-assistant/connectivity` in facade | Internal primitive, no external use case documented | Add when multi-agent docs ship |
| `@agent-assistant/coordination` in facade | Advanced orchestration, no external use case documented | Add when multi-agent docs ship |
| `@agent-assistant/memory` in facade | Blocked on `@agent-relay/memory` npm availability | Add when `@agent-relay/memory` is publicly installable |
| `packages/sdk/README.md` | Adoption guide serves this role; package README is optional | Create if/when publishing to npm |
| npm publish workflow | Facade is not published until the monorepo CI/CD pipeline is ready | Blocked on open-source launch decision |
| Barrel subpath exports (e.g., `@agent-assistant/sdk/sessions`) | No consumer need identified; adds maintenance burden | Revisit only if consumers request it |
| Convenience helpers or builder APIs | Violates "no logic" invariant; belongs in constituent packages | Never — the facade stays pure re-export |
| Integration tests for the facade | No runtime behavior to test; typecheck is sufficient proof | Never — unless the facade gains logic (which it must not) |
| Version sync automation | Facade version tracks SDK releases, not constituent patches | Build when publishing pipeline is established |

---

## Summary

The `@agent-assistant/sdk` facade is a thin, zero-logic re-export package that reduces the adoption surface from 6 installs + 6 import paths to 1 install + 1 import. It re-exports 41 symbols from 6 stable packages. It excludes 4 packages that are not ready for general consumption. It requires no tests — only build-time proof that the type surface compiles. Documentation and examples must ship in the same pass to avoid drift.

TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_BOUNDARY_READY
