# Top-Level SDK Facade Implementation Plan

Date: 2026-04-13
Status: IMPLEMENTATION_READY
Spec: `docs/architecture/top-level-sdk-facade-spec.md`
Boundary: `docs/architecture/top-level-sdk-facade-boundary.md`

---

## Overview

This plan defines every file change required to ship `@agent-assistant/sdk` as a working, publishable facade package. The work falls into four areas:

1. Create `packages/sdk/` — the new facade package
2. Wire `packages/sdk/` into the workspace
3. Update `packages/examples/` to use the facade
4. Update docs to reference the facade as the primary entry point

No constituent package implementation changes are required for this work. The facade is purely additive.

---

## Area 1: Create `packages/sdk/`

### 1.1 Create `packages/sdk/src/index.ts`

Create the file at `packages/sdk/src/index.ts` with the exact content specified in `docs/architecture/top-level-sdk-facade-spec.md` Section 5.

This file is pure re-exports. Enforce the following before committing:
- No function bodies, classes, or variable declarations
- No default exports
- No star re-exports (`export * from '...'`) — all exports are explicit
- Every `export type` block uses the named symbol list, not a wildcard

**Verification:** Run `grep -c '^export' packages/sdk/src/index.ts`. The count should equal the number of `export` and `export type` lines in the spec. Any extra lines indicate drift.

### 1.2 Create `packages/sdk/package.json`

Create at `packages/sdk/package.json` with the exact content from `docs/architecture/top-level-sdk-facade-spec.md` Section 6.

Key constraints:
- All six constituent packages listed in `dependencies` with `>=0.1.0` range
- No `file:` paths in `dependencies` — production consumers install from npm
- `"type": "module"` required for ESM interop with constituent packages
- `"files": ["dist"]` — only the compiled output is published

### 1.3 Create `packages/sdk/tsconfig.json`

Create at `packages/sdk/tsconfig.json` with the exact content from `docs/architecture/top-level-sdk-facade-spec.md` Section 7.

The `verbatimModuleSyntax: true` setting is required. Without it, TypeScript may strip `export type` in a way that breaks downstream consumers in strict type environments.

### 1.4 Directory structure after creation

```
packages/sdk/
  package.json
  tsconfig.json
  src/
    index.ts
```

No test file is required for the facade itself. The facade has zero logic to test. Type-correctness is verified by `tsc --noEmit`.

---

## Area 2: Wire into workspace

### 2.1 Update root `package.json` workspace array

The root `package.json` defines the npm workspaces array. Add `packages/sdk` to it.

Current array (abbreviated):
```json
"workspaces": [
  "packages/core",
  "packages/sessions",
  "packages/surfaces",
  "packages/traits",
  "packages/routing",
  "packages/proactive",
  "packages/policy",
  "packages/connectivity",
  "packages/coordination",
  "packages/integration",
  "packages/examples"
]
```

Updated array — add `"packages/sdk"` before `"packages/examples"`:
```json
"workspaces": [
  "packages/core",
  "packages/sessions",
  "packages/surfaces",
  "packages/traits",
  "packages/routing",
  "packages/proactive",
  "packages/policy",
  "packages/connectivity",
  "packages/coordination",
  "packages/integration",
  "packages/sdk",
  "packages/examples"
]
```

**Note:** `packages/memory` must remain absent from this array. It is excluded due to the `@agent-relay/memory` blocker.

### 2.2 Add build script to root

The root `package.json` `scripts` section should include a `build:sdk` entry:

```json
"build:sdk": "npm run build -w packages/sdk"
```

And update the top-level `build` script (if present) to include sdk after the constituent packages:

```
build:core && build:traits && build:sessions && build:surfaces && build:policy && build:proactive && build:sdk
```

The facade must be built **after** all constituent packages it depends on.

### 2.3 Run workspace install after wiring

After editing the root `package.json`:

```bash
npm install
```

This links the workspace packages so `packages/sdk` can resolve `@agent-assistant/core` etc. via workspace symlinks during local development.

### 2.4 Verify typecheck passes

```bash
cd packages/sdk && npx tsc --noEmit
```

This must pass with zero errors before the facade is considered complete. A type error here indicates either:
- A symbol listed in the spec does not exist in the constituent package
- A symbol is exported with an incompatible signature
- A `verbatimModuleSyntax` violation in the import style

**Likely issues to check:**

| Package | Potential issue |
|---|---|
| `@agent-assistant/policy` | `PolicyDecision` is a type export — verify `export type` used in facade |
| `@agent-assistant/sessions` | `defaultAffinityResolver` is a function — verify it is in the concrete export block, not the type block |
| `@agent-assistant/proactive` | `InMemorySchedulerBinding` is a class — verify it is in the concrete export block |

---

## Area 3: Update `packages/examples/`

### 3.1 Update `packages/examples/package.json` devDependencies

Switch from six individual package deps to a single `@agent-assistant/sdk` dep for the common assembly examples. Keep direct package deps only for symbols not in the facade.

Current:
```json
"devDependencies": {
  "@agent-assistant/core": "file:../core",
  "@agent-assistant/traits": "file:../traits",
  "@agent-assistant/policy": "file:../policy",
  "@agent-assistant/proactive": "file:../proactive",
  "typescript": "^5.9.3"
}
```

Updated:
```json
"devDependencies": {
  "@agent-assistant/sdk": "file:../sdk",
  "@agent-assistant/sessions": "file:../sessions",
  "@agent-assistant/surfaces": "file:../surfaces",
  "typescript": "^5.9.3"
}
```

Sessions and surfaces are retained as direct deps because the examples need to pass actual adapter instances (e.g., `slackAdapter`) that require the direct package types. Alternatively, once the facade covers all needed symbols, sessions and surfaces can be dropped here too — the facade re-exports everything examples need.

**Simpler alternative (preferred):** Keep only `@agent-assistant/sdk` and use facade imports for all six packages. Direct deps are only needed if examples use symbols not in the facade.

```json
"devDependencies": {
  "@agent-assistant/sdk": "file:../sdk",
  "typescript": "^5.9.3"
}
```

### 3.2 Create `packages/examples/src/00-hello-world.ts`

Create a new example demonstrating the absolute minimum assembly. This file should use only `@agent-assistant/sdk` and demonstrate that a single import covers the full hello-world case.

```typescript
/**
 * 00-hello-world.ts
 * Minimum viable assistant using @agent-assistant/sdk.
 * One install. One import. Zero additional packages.
 */
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

const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

const surfaceRegistry = createSurfaceRegistry();

const capabilities: SurfaceCapabilities = {
  markdown: true,
  richBlocks: false,
  attachments: false,
  streaming: false,
  maxResponseLength: 2000,
};

const connection: SurfaceConnection = {
  id: 'hello-world-surface',
  type: 'slack',
  state: 'registered',
  capabilities,
  adapter: surfaceRegistry as any, // replace with real adapter in production
};

surfaceRegistry.register(connection);

const runtime = createAssistant(
  {
    id: 'hello-world-assistant',
    name: 'Hello World',
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

### 3.3 Update existing examples to use facade imports

For each existing example in `packages/examples/src/` that imports from individual packages covered by the facade, update the import source to `@agent-assistant/sdk`.

Change pattern:
```typescript
// Before
import { createAssistant } from '@agent-assistant/core';
import { createTraitsProvider } from '@agent-assistant/traits';
import { createSessionStore, InMemorySessionStoreAdapter } from '@agent-assistant/sessions';
import { createSurfaceRegistry } from '@agent-assistant/surfaces';
import { createActionPolicy, InMemoryAuditSink } from '@agent-assistant/policy';
import { createProactiveEngine, InMemorySchedulerBinding } from '@agent-assistant/proactive';

// After
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

Symbols not in the facade (coordination, connectivity, routing) continue to use direct package imports.

---

## Area 4: Update documentation

### 4.1 Update `README.md` quick-start section

**Current quick-start:**
```bash
npm install @agent-assistant/core @agent-assistant/traits
```
```typescript
import { createAssistant } from '@agent-assistant/core';
import { createTraitsProvider } from '@agent-assistant/traits';
```

**Updated quick-start:**
```bash
npm install @agent-assistant/sdk
```
```typescript
import { createAssistant, createTraitsProvider } from '@agent-assistant/sdk';
```

Retain the full multi-package example as a collapsed "Advanced" section or a link to the relevant example. The quick-start code block should be minimal and show the one-install, one-import path.

Also update the package map table to add a `@agent-assistant/sdk` row:

```
| `@agent-assistant/sdk` | Top-level facade — one install for all v1-baseline packages | **NEW — facade only** |
```

### 4.2 Update `docs/index.md`

Add a new section under "Consumer docs":

```markdown
- [Top-level SDK adoption guide](consumer/top-level-sdk-adoption-guide.md) — one-install quick start for new consumers
```

Add a new section under "Architecture":

```markdown
- [Top-level SDK facade spec](architecture/top-level-sdk-facade-spec.md) — exact public surface of `@agent-assistant/sdk`
- [Top-level SDK facade implementation plan](architecture/top-level-sdk-facade-implementation-plan.md) — this document
```

### 4.3 Update `docs/architecture/package-boundary-map.md`

Add `@agent-assistant/sdk` to the Package Responsibilities section:

```markdown
### `@agent-assistant/sdk` (facade)

**Implementation status: facade — no logic, no tests**

Re-exports the stable v1-baseline API surface from six constituent packages. Owns nothing. Adds no behavior.

The facade gate: a package is included here only when it reaches v1-baseline (passing tests at DoD target, spec reconciled). Packages below that bar remain direct-import only.

Current facade members: `core`, `traits`, `sessions`, `surfaces`, `policy`, `proactive`
Excluded (direct-import only): `routing` (DoD gap), `connectivity` (advanced), `coordination` (advanced), `memory` (blocked)
```

### 4.4 Update `docs/consumer/how-to-build-an-assistant.md`

At the top of the "Expected Package Imports" section, add a note:

```markdown
> **Facade path:** All imports shown below can also be sourced from a single `@agent-assistant/sdk` install.
> See [top-level-sdk-adoption-guide.md](top-level-sdk-adoption-guide.md) for the one-install equivalent.
```

The "Explained" import examples in the existing doc should remain as-is — they serve as explainers showing which package owns each symbol. The note makes the facade visible without restructuring the existing explanatory content.

---

## Completion Checklist

- [ ] `packages/sdk/src/index.ts` created — pure re-exports matching spec Section 5
- [ ] `packages/sdk/package.json` created — matching spec Section 6
- [ ] `packages/sdk/tsconfig.json` created — matching spec Section 7
- [ ] Root `package.json` workspaces array updated to include `packages/sdk`
- [ ] `npm install` run from root — workspace links resolved
- [ ] `cd packages/sdk && npx tsc --noEmit` passes with zero errors
- [ ] `packages/examples/src/00-hello-world.ts` created
- [ ] Existing examples updated to import from `@agent-assistant/sdk` where possible
- [ ] `packages/examples/package.json` updated to reference `file:../sdk`
- [ ] `README.md` quick-start updated to show single-package install
- [ ] `README.md` package map table includes `@agent-assistant/sdk` row
- [ ] `docs/index.md` updated with facade links
- [ ] `docs/architecture/package-boundary-map.md` updated with facade entry
- [ ] `docs/consumer/how-to-build-an-assistant.md` updated with facade note

---

## What This Plan Does NOT Change

- No constituent package implementations are modified
- No constituent package `index.ts` files are modified
- No new tests are added to any constituent package
- `@agent-assistant/memory`, `@agent-assistant/routing`, `@agent-assistant/connectivity`, `@agent-assistant/coordination` are not added to the workspace install graph or the facade
- The `packages/memory` `private: true` flag is not changed

---

TOP_LEVEL_SDK_FACADE_IMPLEMENTATION_PLAN_READY
